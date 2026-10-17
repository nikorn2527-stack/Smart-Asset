import { NextRequest, NextResponse } from 'next/server'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import {
  parseConfig,
  runCustomReport,
} from '@/lib/custom-report-runner'
import { buildCsvBytes, buildReportPdfBytes } from '@/lib/custom-report-export'

export const maxDuration = 60

// GET /api/reports/custom/[id]/export?format=csv|pdf
//
// Runs the report server-side (without writing to a JSON file) and returns
// the result either as a CSV attachment or a PDF attachment.

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('reports')
  if (unavailable) return unavailable

  // EXPORT_PRINT covers exporting; VIEW_REPORTS lets users export what they can see.
  // Admins with MANAGE_REPORTS get implicit EXPORT_PRINT through MANAGE_REPORTS role.
  const auth = await requireAuth(req, 'EXPORT_PRINT')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { id } = await ctx.params
  const template = await db.customReport.findUnique({ where: { id } })
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }
  const canView = template.isShared || template.createdBy === auth.user.email
  if (!canView) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  const url = new URL(req.url)
  const format = (url.searchParams.get('format') ?? 'csv').toLowerCase()
  if (format !== 'csv' && format !== 'pdf') {
    return NextResponse.json(
      { error: 'Invalid format. Use ?format=csv or ?format=pdf' },
      { status: 400 },
    )
  }

  let config
  try {
    config = parseConfig(template.config)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid template config' },
      { status: 500 },
    )
  }

  const authzCtx = await buildAuthorizationContext(
    auth.user,
    auth.row.id,
    auth.row.allowedSites,
  )

  let result
  try {
    result = await runCustomReport({
      config,
      user: auth.user,
      ctx: authzCtx,
    })
  } catch (err) {
    console.error('export run failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to run report' },
      { status: 500 },
    )
  }

  // SPRINT-1 #9 (DEV-HANDOVER B-06): cap PDF export at 500 rows to avoid
  // Vercel Hobby 10s timeout. CSV is allowed beyond the cap because CSV
  // generation is fast (no per-row PDF rendering).
  const MAX_PDF_ROWS = 500
  if (format === 'pdf' && result.rows.length > MAX_PDF_ROWS) {
    return NextResponse.json(
      {
        error: `รายงานมี ${result.rows.length} แถว เกินกว่าขีดจำกัด PDF (${MAX_PDF_ROWS}) กรุณาใช้ CSV แทน หรือกรองข้อมูลให้น้อยลง`,
        code: 'EXPORT_TOO_LARGE',
        count: result.rows.length,
        max: MAX_PDF_ROWS,
        hint: 'Use ?format=csv for large exports, or narrow the date range / site filter.',
      },
      { status: 413 },
    )
  }

  const safeName = template.name.replace(/[^\p{L}\p{N}\-_ ]/gu, '_').slice(0, 80)
  const stamp = new Date().toISOString().slice(0, 10)

  await logAudit(
    'CUSTOM_REPORT_EXPORT',
    'CustomReport',
    template.id,
    `ส่งออกรายงาน "${template.name}" เป็น ${format.toUpperCase()}`,
    {
      templateId: template.id,
      templateName: template.name,
      format,
      rows: result.rows.length,
    },
    auth.user.email,
  )

  if (format === 'csv') {
    const bytes = buildCsvBytes(result)
    return new NextResponse(new Blob([new Uint8Array(bytes)]), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeName}-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  // PDF
  try {
    const pdfBytes = await buildReportPdfBytes({
      title: template.name,
      description: template.description ?? undefined,
      result,
      generatedBy: auth.user.email,
    })
    return new NextResponse(new Blob([new Uint8Array(pdfBytes)]), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}-${stamp}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('PDF export failed:', err)
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `PDF export failed: ${err.message}`
            : 'PDF export failed',
      },
      { status: 500 },
    )
  }
}
