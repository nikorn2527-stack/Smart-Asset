// ============================================================
// Monthly Report API — Milestone 2 refactor
// ============================================================
// This route is now a THIN ADAPTER that delegates to the Reports
// module's monthlyReportBuilder. No @/lib/db imports remain — all
// DB access goes through reportReadRepository (inside the module).
//
// GET /api/reports/monthly?month=YYYY-MM&site=&type=work-order|stock|devices|all
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { requireAuth } from '@/lib/auth-middleware'
import { monthlyReportBuilder } from '@/modules/reports'

type ReportType = 'work-order' | 'stock' | 'devices' | 'all'

const VALID_TYPES = new Set<ReportType>([
  'work-order', 'stock', 'devices', 'all',
])

// Heavy operation — needs longer timeout (Vercel Hobby: max 60s)
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('reports')
  if (unavailable) return unavailable

  // Milestone 1 — Security baseline: require VIEW_REPORTS
  const auth = await requireAuth(req, 'VIEW_REPORTS')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(req.url)
    const monthParam = searchParams.get('month')?.trim() || null
    const siteParam = searchParams.get('site')?.trim() || null
    const typeParam = (searchParams.get('type')?.trim() || 'all') as ReportType

    if (!VALID_TYPES.has(typeParam)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: work-order, stock, devices, all` },
        { status: 400 },
      )
    }

    // Delegate to the Reports module's builder — no @/lib/db here
    const result = await monthlyReportBuilder.build(monthParam, siteParam, typeParam)

    return NextResponse.json(result)
  } catch (err) {
    console.error('GET /api/reports/monthly', err)
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to fetch monthly report',
      },
      { status: 500 },
    )
  }
}
