// Heavy operation — needs longer timeout (Vercel Hobby: max 60s)
export const maxDuration = 60

/**
 * GET /api/reports/unified?group=<group>&month=YYYY-MM&site=CODE|all
 *
 * Unified reports endpoint — Milestone 2b refactor.
 * This route is now a THIN ADAPTER that delegates to the Reports
 * module's unified-report-builder. No @/lib/db imports remain — all
 * DB access goes through the module's repository.
 *
 * Groups:
 *   • devices      — status / type / site / warranty / depreciation
 *   • meters       — paper usage / cost by site & dept / unmetered / monthly compare
 *   • workorders   — status / staff / subject / 50-baht special fee / ratings
 *   • stock        — summary / low & out-of-stock / recent txns / pending approvals
 *   • maintenance  — repair history per device / cost by month & site / top parts
 *   • approvals    — pending counts across stock/WO/special fee + approval history
 */

import { NextRequest, NextResponse } from 'next/server'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { requireAuth } from '@/lib/auth-middleware'
import { logAudit } from '@/lib/audit'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import {
  VALID_GROUPS,
  currentMonthStr,
  parseMonth,
  buildDevicesReport,
  buildMetersReport,
  buildWorkOrdersReport,
  buildStockReport,
  buildMaintenanceReport,
  buildApprovalsReport,
  type ReportGroup,
} from '@/modules/reports'

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('reports')
  if (unavailable) return unavailable

  // Milestone 1 — Security baseline
  const auth = await requireAuth(req, 'VIEW_REPORTS')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // ── Build authorization context for Site scope ──
  const ctx = await buildAuthorizationContext(
    auth.user,
    auth.row.id,
    auth.row.allowedSites,
  )

  try {
    const { searchParams } = new URL(req.url)
    const group = String(searchParams.get('group') ?? '') as ReportGroup
    const monthParam = searchParams.get('month') ?? currentMonthStr()
    const siteParam = searchParams.get('site') ?? 'all'

    if (!VALID_GROUPS.includes(group)) {
      return NextResponse.json(
        { error: `Invalid group. Must be one of: ${VALID_GROUPS.join(', ')}` },
        { status: 400 },
      )
    }

    const monthInfo = parseMonth(monthParam)
    if (!monthInfo && group !== 'devices' && group !== 'stock') {
      return NextResponse.json(
        { error: 'Invalid month format. Use YYYY-MM.' },
        { status: 400 },
      )
    }

    // ── Resolve effective Site scope as siteCodes[] ──
    let siteCodes: string[] | null
    if (ctx.isSuperAdmin) {
      siteCodes = siteParam === 'all' ? null : [siteParam.toUpperCase()]
    } else if (ctx.siteScope.kind === 'none') {
      return NextResponse.json({
        group,
        generatedAt: new Date().toISOString(),
        month: monthParam,
        site: siteParam,
        summary: {},
        error: 'ไม่มี Site ที่ได้รับอนุญาต — ติดต่อผู้ดูแลเพื่อขอสิทธิ์เข้าถึง',
      })
    } else if (ctx.siteScope.kind === 'sites') {
      const allowed = ctx.siteScope.siteCodes
      if (siteParam === 'all') {
        siteCodes = allowed.length > 0 ? allowed : []
      } else {
        const requested = siteParam.toUpperCase()
        if (!allowed.includes(requested)) {
          return NextResponse.json(
            { error: 'ไม่พบรายการที่ระบุ หรือคุณไม่มีสิทธิ์เข้าถึง' },
            { status: 404 },
          )
        }
        siteCodes = [requested]
      }
    } else {
      siteCodes = siteParam === 'all' ? null : [siteParam.toUpperCase()]
    }

    // Fail-closed
    if (!ctx.isSuperAdmin && siteCodes !== null && siteCodes.length === 0) {
      return NextResponse.json({
        group,
        generatedAt: new Date().toISOString(),
        month: monthParam,
        site: siteParam,
        summary: {},
        error: 'ไม่มี Site ที่ได้รับอนุญาต — ติดต่อผู้ดูแลเพื่อขอสิทธิ์เข้าถึง',
      })
    }

    // ── Delegate to module builders ──
    let data: unknown
    switch (group) {
      case 'devices':
        data = await buildDevicesReport(siteCodes, auth.user)
        break
      case 'meters':
        data = await buildMetersReport(monthParam, siteCodes, 'th', auth.user)
        break
      case 'workorders':
        data = await buildWorkOrdersReport(monthParam, siteCodes, auth.user)
        break
      case 'stock':
        data = await buildStockReport(siteCodes, auth.user)
        break
      case 'maintenance':
        data = await buildMaintenanceReport(monthParam, siteCodes, 'th', auth.user)
        break
      case 'approvals':
        data = await buildApprovalsReport(monthParam, siteCodes, auth.user)
        break
      default:
        return NextResponse.json({ error: 'Unknown group' }, { status: 400 })
    }

    // Audit log — non-blocking
    void logAudit(
      'GENERATE',
      'Report',
      group,
      `ดูรายงาน ${group} (${monthParam}${siteCodes ? '/' + siteCodes.join(',') : ''})`,
      { group, month: monthParam, site: siteParam },
    )

    return NextResponse.json(data)
  } catch (err) {
    console.error('GET /api/reports/unified', err)
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to fetch unified report',
      },
      { status: 500 },
    )
  }
}
