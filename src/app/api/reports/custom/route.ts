import { NextRequest, NextResponse } from 'next/server'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { parseConfig, type DataSourceName } from '@/lib/custom-report-runner'
import { z } from 'zod'

export const maxDuration = 60

// ── GET: list saved report templates ─────────────────────────────────
//
// Returns templates owned by the user OR shared (`isShared = true`).
// Sorted by updatedAt desc.

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('reports')
  if (unavailable) return unavailable

  const auth = await requireAuth(req, 'VIEW_REPORTS')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const templates = await db.customReport.findMany({
      where: {
        OR: [{ createdBy: auth.user.email }, { isShared: true }],
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })

    return NextResponse.json({
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        dataSource: t.dataSource as DataSourceName,
        isShared: t.isShared,
        createdBy: t.createdBy,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        // Note: don't return the full config string here — clients can fetch
        // a single template via GET /api/reports/custom/[id] when they
        // actually need to render the wizard.
        config: undefined,
      })),
    })
  } catch (err) {
    console.error('GET /api/reports/custom', err)
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
}

// ── POST: save a new template ───────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  dataSource: z.enum(['devices', 'workorders', 'meterreadings', 'stockitems']),
  config: z.record(z.string(), z.unknown()), // validated via parseConfig below
  isShared: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('reports')
  if (unavailable) return unavailable

  const auth = await requireAuth(req, 'MANAGE_REPORTS')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    // Validate the config by parsing it through the whitelist.
    const configStr = JSON.stringify(parsed.data.config)
    let config
    try {
      config = parseConfig(configStr)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Invalid config' },
        { status: 400 },
      )
    }
    if (config.dataSource !== parsed.data.dataSource) {
      return NextResponse.json(
        { error: 'dataSource in config does not match top-level dataSource' },
        { status: 400 },
      )
    }

    const created = await db.customReport.create({
      data: {
        name: parsed.data.name.trim(),
        description: parsed.data.description?.trim() || null,
        dataSource: parsed.data.dataSource,
        config: configStr,
        createdBy: auth.user.email,
        isShared: parsed.data.isShared ?? false,
      },
    })

    await logAudit(
      'CUSTOM_REPORT_CREATE',
      'CustomReport',
      created.id,
      `สร้างรายงาน "${created.name}" (dataSource=${created.dataSource})`,
      { id: created.id, name: created.name, dataSource: created.dataSource },
      auth.user.email,
    )

    return NextResponse.json({ template: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/reports/custom', err)
    return NextResponse.json({ error: 'Failed to save template' }, { status: 500 })
  }
}
