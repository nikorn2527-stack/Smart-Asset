import { NextRequest, NextResponse } from 'next/server'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { parseConfig, type DataSourceName } from '@/lib/custom-report-runner'
import { z } from 'zod'

export const maxDuration = 60

// ── GET: fetch a single template (full config string included) ─────

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('reports')
  if (unavailable) return unavailable

  const auth = await requireAuth(req, 'VIEW_REPORTS')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { id } = await ctx.params
  const template = await db.customReport.findUnique({ where: { id } })
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }
  // Owner or shared — otherwise 404 (don't leak existence)
  const canView =
    template.isShared ||
    template.createdBy === auth.user.email
  if (!canView) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  // Parse + validate the config before returning (catches hand-edited rows).
  let parsedConfig
  try {
    parsedConfig = parseConfig(template.config)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid template config' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    template: {
      ...template,
      dataSource: template.dataSource as DataSourceName,
      config: parsedConfig,
    },
  })
}

// ── PATCH: update an existing template ──────────────────────────────

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  dataSource: z.enum(['devices', 'workorders', 'meterreadings', 'stockitems']).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  isShared: z.boolean().optional(),
})

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('reports')
  if (unavailable) return unavailable

  const auth = await requireAuth(req, 'MANAGE_REPORTS')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { id } = await ctx.params
  const existing = await db.customReport.findUnique({ where: { id } })
  if (!existing) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }
  // Only the owner (or superadmin/admin via MANAGE_REPORTS) may edit.
  // We don't enforce isShared edits here — anyone with MANAGE_REPORTS can
  // toggle sharing (they are admins).
  if (existing.createdBy !== auth.user.email && auth.user.role !== 'admin' && auth.user.role !== 'superadmin') {
    return NextResponse.json({ error: 'Not the template owner' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const updates: Record<string, unknown> = {}
  if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim()
  if (parsed.data.description !== undefined) {
    updates.description = parsed.data.description?.trim() || null
  }
  if (parsed.data.isShared !== undefined) updates.isShared = parsed.data.isShared
  if (parsed.data.dataSource !== undefined) updates.dataSource = parsed.data.dataSource
  if (parsed.data.config !== undefined) {
    const configStr = JSON.stringify(parsed.data.config)
    try {
      const cfg = parseConfig(configStr)
      if (parsed.data.dataSource && cfg.dataSource !== parsed.data.dataSource) {
        return NextResponse.json(
          { error: 'dataSource in config does not match top-level dataSource' },
          { status: 400 },
        )
      }
      updates.config = configStr
      // Keep the denormalized dataSource column in sync.
      if (!parsed.data.dataSource) updates.dataSource = cfg.dataSource
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Invalid config' },
        { status: 400 },
      )
    }
  }

  const updated = await db.customReport.update({
    where: { id },
    data: updates,
  })

  await logAudit(
    'CUSTOM_REPORT_UPDATE',
    'CustomReport',
    updated.id,
    `แก้ไขรายงาน "${updated.name}"`,
    { id: updated.id, name: updated.name, updates: Object.keys(updates) },
    auth.user.email,
  )

  return NextResponse.json({ template: updated })
}

// ── DELETE ───────────────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('reports')
  if (unavailable) return unavailable

  const auth = await requireAuth(req, 'MANAGE_REPORTS')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { id } = await ctx.params
  const existing = await db.customReport.findUnique({ where: { id } })
  if (!existing) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }
  if (existing.createdBy !== auth.user.email && auth.user.role !== 'admin' && auth.user.role !== 'superadmin') {
    return NextResponse.json({ error: 'Not the template owner' }, { status: 403 })
  }

  await db.customReport.delete({ where: { id } })

  await logAudit(
    'CUSTOM_REPORT_DELETE',
    'CustomReport',
    id,
    `ลบรายงาน "${existing.name}"`,
    { id, name: existing.name, dataSource: existing.dataSource },
    auth.user.email,
  )

  return NextResponse.json({ ok: true })
}
