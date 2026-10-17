import { NextRequest, NextResponse } from 'next/server'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import {
  parseConfig,
  runCustomReport,
  type ReportConfig,
} from '@/lib/custom-report-runner'
import { z } from 'zod'

export const maxDuration = 60

// POST /api/reports/custom/[id]/run
//
// Body (all optional):
//   { limit?: number, configOverride?: Partial<ReportConfig> }
//
// The optional `configOverride` is a partial config that is merged over the
// saved template's config — lets the wizard run an unsaved preview before
// the user commits. When omitted, the saved config is used as-is.

const runSchema = z.object({
  limit: z.number().int().positive().max(5000).optional(),
  configOverride: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(
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
  // Owner or shared.
  const canView = template.isShared || template.createdBy === auth.user.email
  if (!canView) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  let body: unknown = {}
  try {
    body = await req.json()
  } catch {
    // Allow empty body — fall back to the saved config.
  }
  const parsed = runSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  // Merge the override (if any) over the saved config.
  const baseConfig = parseConfig(template.config)
  let mergedConfig: ReportConfig = baseConfig
  if (parsed.data.configOverride) {
    mergedConfig = parseConfig(
      JSON.stringify({ ...baseConfig, ...parsed.data.configOverride }),
    )
  }

  const authzCtx = await buildAuthorizationContext(
    auth.user,
    auth.row.id,
    auth.row.allowedSites,
  )

  try {
    const result = await runCustomReport({
      config: mergedConfig,
      user: auth.user,
      ctx: authzCtx,
      limitOverride: parsed.data.limit,
    })

    await logAudit(
      'CUSTOM_REPORT_RUN',
      'CustomReport',
      template.id,
      `เรียกใช้รายงาน "${template.name}" — ${result.rows.length}/${result.total} rows`,
      {
        templateId: template.id,
        templateName: template.name,
        rows: result.rows.length,
        total: result.total,
        truncated: result.truncated,
      },
      auth.user.email,
    )

    return NextResponse.json({
      result,
      template: {
        id: template.id,
        name: template.name,
        dataSource: template.dataSource,
      },
    })
  } catch (err) {
    console.error('POST /api/reports/custom/[id]/run', err)
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to run report',
      },
      { status: 500 },
    )
  }
}
