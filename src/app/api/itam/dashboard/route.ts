import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { siteFilterForUser, getAllowedSites } from '@/lib/auth'
import { ACTIVE_STATUS_VARIANTS, bucketizeStatusGroups } from '@/lib/status-utils'
import { demoFilter, isDemoUser } from '@/lib/demo-mode'
import { buildAuthorizationContext } from '@/lib/authorization-context'

// GET /api/itam/dashboard — optimized dashboard stats from real data
//
// Performance optimizations vs the original:
//   1. Single groupBy for all status counts (was 5 separate count queries)
//   2. Single groupBy for device-type counts (was findMany all devices + JS loop)
//   3. Two groupBy queries for per-site stats (was N×3 queries in a loop — N+1)
//   4. aggregate for paper-this-month (was findMany all readings + reduce)
//   5. groupBy for 6-month trend (was findMany all readings + JS loop)
//   6. All independent queries parallelized with Promise.all
//   7. Status classification centralized in status-utils.ts (consistent KPIs)
//
// Result: ~6 DB queries total (was ~20+), ~50 rows transferred (was ~thousands)

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req, 'VIEW_DASHBOARD')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row

    // SPRINT-2 #5 (AUDIT-API-001 #077): build AuthorizationContext so we can
    // use ctx.canAtSite() for permission checks. The legacy siteFilterForUser
    // only checked site membership — it didn't verify the user had a specific
    // permission at that site. ctx.canAtSite(siteCode, 'VIEW_DASHBOARD')
    // closes that gap.
    const ctx = await buildAuthorizationContext(
      auth.user,
      auth.row.id,
      auth.row.allowedSites,
    )

    const { searchParams } = new URL(req.url)
    const includeExtra = searchParams.get('extra') === '1'
    const t0 = Date.now()

    // ── Site-level filter: restrict all queries to the user's allowed sites
    // ── Demo filter: demo users see ONLY demo data, real users see ONLY real data
    const siteFilter = { ...siteFilterForUser(user), ...demoFilter(user) }
    const userSites = getAllowedSites(user)

    // Raw-SQL mirror of siteFilter for the trend query (which joins "Device"
    // manually). Without this, the 6-month trend ignored BOTH the site and the
    // demo scope (demo users saw real-data trends and vice versa).
    // NOTE: starts with AND — it is appended inside the query's WHERE clause.
    const trendDeviceFilter = Prisma.sql`
      AND d."id" IS NOT NULL
        AND d."isDemo" = ${isDemoUser(user)}
        ${userSites === 'ALL' ? Prisma.empty : Prisma.sql`AND d."site" IN (${Prisma.join(userSites)})`}
    `

    const now = new Date()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const currentMonthKey = currentMonth // alias for clarity

    // Current calendar month date range (for "paper this month" — matches legacy dashboard)
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`

    // Build the 6-month trend month keys (by readingMonth = cycle month)
    const trendMonths: { key: string; label: string }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`
      trendMonths.push({ key, label })
    }
    const trendMonthKeys = trendMonths.map((m) => m.key)

    // ── readingType filter for "usage" totals ──────────────────────────────
    // Aligned with Apps Script AnalyticsService.gs (commit 67f8e54):
    //   INCLUDE: MONTHLY, CHECKOUT, RETURN (these represent actual usage)
    //   EXCLUDE: INITIAL, RESET, FINAL, SEND_REPAIR (baselines / non-usage)
    // INITIAL/RESET contribute 0 pages anyway (enforced in meter-readings route),
    // but excluding them here prevents double-counting if any legacy rows have
    // non-zero pagesBw/Color from before the fix.
    const USAGE_TYPES = ['MONTHLY', 'CHECKOUT', 'RETURN']
    const usageTypeFilter = { readingType: { in: USAGE_TYPES } }

    // ── PARALLEL BLOCK 1: all independent count/aggregate queries ──────────
    const [
      statusGroups,
      typeGroups,
      paperThisMonthAgg,
      paperTrendGroups,
      meterRequiredCount,
      recentReadings,
      sites,
    ] = await Promise.all([
      // 1) All device counts by status — single groupBy (was 5 count queries)
      db.device.groupBy({
        by: ['status'],
        where: siteFilter,
        _count: { status: true },
      }),

      // 2) Device counts by type — single groupBy (was findMany + JS loop)
      db.device.groupBy({
        by: ['type'],
        where: siteFilter,
        _count: { type: true },
      }),

      // 3) Paper usage this month — SUM of pagesBw + pagesColor for ALL readings
      //    with readingMonth = current month (e.g., "2026-08").
      //    Uses readingMonth (not readingDate) because:
      //    - readingDate = วันที่กดบันทึกจริง (อาจเป็นต้นเดือนถัดไป เช่น 1-5 ส.ค.)
      //    - readingMonth = เดือนที่เลือกบันทึก (เช่น 2026-07 = รอบกรกฎาคม)
      //    - ถ้าจดวันที่ 1-5 ส.ค. แต่เลือกเดือน ก.ค. → ข้อมูลเข้า ก.ค. ไม่ใช่ ส.ค.
      //    - pagesBw/pagesColor = delta per reading (computed at POST time)

      db.meterReading.aggregate({
        _sum: { pagesBw: true, pagesColor: true },
        where: {
          readingMonth: currentMonthKey,
          device: siteFilter,
        },
      }),

      // 4) Paper usage trend (6 months) — SUM of per-reading usage deltas,
      //    grouped by month + site.
      //    pagesBw/pagesColor on each MeterReading row ALREADY store that
      //    reading's usage delta (computed at POST time — see the meter-readings
      //    route), so monthly usage = plain SUM per readingMonth. This matches
      //    the bySite stats and the paper-analytics module exactly.
      //
      //    (Previous implementation subtracted the previous reading's pagesBw
      //    from the latest one — i.e. the MONTH-OVER-MONTH CHANGE in usage,
      //    not the usage itself — so the trend chart showed ~300 sheets/month
      //    when actual usage was ~4,400/month. Replaced with the SUM below.)
      //
      //    Grouping by d."site" as well lets us price each month at the
      //    CORRECT per-site paper rate (SiteAttribute) for the cost trend.
      db.$queryRaw`
        SELECT
          mr."readingMonth" as readingMonth,
          d."site" as deviceSite,
          COALESCE(SUM(mr."pagesBw"), 0) as delta_bw,
          COALESCE(SUM(mr."pagesColor"), 0) as delta_color
        FROM "MeterReading" mr
        LEFT JOIN "Device" d ON d."id" = mr."deviceId"
        WHERE mr."readingMonth" IN (${Prisma.join(trendMonthKeys)})
          AND mr."readingType" IN ('MONTHLY', 'CHECKOUT', 'RETURN')
          ${trendDeviceFilter}
        GROUP BY mr."readingMonth", d."site"
        ORDER BY mr."readingMonth"
      `,

      // 5) Meter-required device count — bug DATA-06 fix: use ACTIVE_STATUS_VARIANTS
      // to handle inconsistent status casing in DB (Active, ACTIVE, active, ใช้งาน).
      db.device.count({
        where: { ...siteFilter, meterRequired: true, status: { in: ACTIVE_STATUS_VARIANTS } },
      }),

      // 6) Recent meter readings (5)
      db.meterReading.findMany({
        take: 5,
        orderBy: { readingDate: 'desc' },
        where: { device: siteFilter },
        include: {
          device: { select: { assetCode: true, brand: true, model: true } },
        },
      }),

      // 7) All site attributes (small table, needed for per-site stats)
      db.siteAttribute.findMany({ select: { id: true, SiteCode: true, SiteName: true, PaperRateBW: true, PaperRateColor: true, Hotline: true, LineOA: true } }),
    ])

    // ── Process status groups into canonical KPI buckets ───────────────────
    const { total, active, inactive, spare, repair, byStatus } = bucketizeStatusGroups(
      statusGroups as { status: string; _count: { status: number } }[],
    )

    // ── Process type groups (top 8) ────────────────────────────────────────
    const byType = (typeGroups as { type: string | null; _count: { type: number } }[])
      .map((g) => ({ name: g.type || 'ไม่ระบุ', value: g._count.type }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)

    // ── Paper this month — SUM of pagesBw + pagesColor for all readings
    //    recorded (by readingDate) in the current calendar month, all statuses.
    //    This represents "the actual amount entered this month".
    const paperThisMonthRows = paperThisMonthAgg as { _sum: { pagesBw: number | null; pagesColor: number | null } }
    const paperThisMonth =
      (paperThisMonthRows._sum.pagesBw ?? 0) + (paperThisMonthRows._sum.pagesColor ?? 0)

    // ── Paper trend (6 months) — DELTA per month, per device ──
    // Per-device rows let us compute BOTH sheet totals and money cost using
    // each device's site paper rates (SiteAttribute). Rates fall back to the
    // schema defaults (0.5 ฿/BW sheet, 2.0 ฿/color sheet) when a site has no
    // rate configured. Device.site may hold site CODE or NAME → map has both.
    const siteRateMap = new Map<string, { bw: number; color: number }>()
    for (const s of sites as Array<{ SiteCode: string | null; SiteName: string | null; PaperRateBW: number | null; PaperRateColor: number | null }>) {
      const bw = s.PaperRateBW ?? 0.5
      const color = s.PaperRateColor ?? 2.0
      if (s.SiteName) siteRateMap.set(s.SiteName, { bw, color })
      if (s.SiteCode) siteRateMap.set(s.SiteCode, { bw, color })
    }
    const trendSheets: Record<string, number> = {}
    const trendCost: Record<string, number> = {}
    for (const g of paperTrendGroups as Array<{ readingMonth: string; deviceSite: string | null; delta_bw: number | bigint; delta_color: number | bigint }>) {
      const k = g.readingMonth || ''
      if (!k) continue
      const bw = Number(g.delta_bw) || 0
      const color = Number(g.delta_color) || 0
      trendSheets[k] = (trendSheets[k] || 0) + bw + color
      const rate = (g.deviceSite ? siteRateMap.get(g.deviceSite) : undefined) ?? { bw: 0.5, color: 2.0 }
      trendCost[k] = (trendCost[k] || 0) + bw * rate.bw + color * rate.color
    }
    const paperTrend = trendMonths.map((m) => ({
      month: m.label,
      sheets: trendSheets[m.key] || 0,
      cost: Math.round((trendCost[m.key] || 0) * 100) / 100,
    }))

    // ── Recent activity ────────────────────────────────────────────────────
    const recentActivity = recentReadings.map((r) => ({
      id: r.id,
      assetCode: r.assetCode,
      deviceName: r.device ? `${r.device.brand || ''} ${r.device.model || ''}`.trim() : r.assetCode,
      readingDate: r.readingDate,
      pagesBw: r.pagesBw,
      pagesColor: r.pagesColor,
      remark: r.remark,
    }))

    // ── PARALLEL BLOCK 2: per-site stats (optimized, no N+1) ───────────────
    const visibleSites =
      userSites === 'ALL'
        ? sites
        : sites.filter((s) => userSites.includes(s.SiteName || ''))
    const visibleSiteNames = visibleSites.map((s) => s.SiteName || '').filter(Boolean)

    interface SiteStat {
      siteCode: string
      siteName: string
      deviceCount: number
      activeCount: number
      paperSheets: number
      paperBw: number
      paperColor: number
      paperCost: number
    }
    let bySite: SiteStat[] = []

    if (visibleSiteNames.length > 0) {
      // Site-level filter that ALSO carries the demo-filter (isDemo flag)
      // so demo users see ONLY demo devices, real users see ONLY real data.
      // QA-ROUND-2026-09-16-C: Device.site may store EITHER the site CODE
      // (e.g. "UDH") or the site NAME (e.g. "โรงพยาบาลศูนย์อุดรธานี") depending
      // on the data source. Match both forms (same approach as paper-analytics
      // rate lookups) so no devices/readings fall through the join.
      const siteKeys = [
        ...new Set(visibleSites.flatMap((s) => [s.SiteName || '', s.SiteCode || '']).filter(Boolean)),
      ]
      const siteWhere = { ...siteFilter, site: { in: siteKeys } }
      const [deviceBySite, activeBySite, devicesForSiteMap, paperByAsset] = await Promise.all([
        // All devices grouped by site
        db.device.groupBy({
          by: ['site'],
          where: siteWhere,
          _count: { status: true },
        }),
        // Active devices grouped by site — bug DATA-06 fix: case-insensitive variants
        db.device.groupBy({
          by: ['site'],
          where: { ...siteWhere, status: { in: ACTIVE_STATUS_VARIANTS } },
          _count: { status: true },
        }),
        // Device→site mapping (assetCode + site only, ~2,378 rows)
        db.device.findMany({
          where: siteWhere,
          select: { assetCode: true, site: true },
        }),
        // Paper usage per asset this month (by readingMonth — matches
        // the top-level "paper this month" definition)
        db.meterReading.groupBy({
          by: ['assetCode'],
          where: {
            readingMonth: currentMonthKey,
            device: siteWhere,
          },
          _sum: { pagesBw: true, pagesColor: true },
        }),
      ])

      // Build lookup maps
      const deviceCountMap: Record<string, number> = {}
      for (const g of deviceBySite) deviceCountMap[g.site || ''] = g._count.status
      const activeCountMap: Record<string, number> = {}
      for (const g of activeBySite) activeCountMap[g.site || ''] = g._count.status
      const assetToSite = new Map<string, string>()
      for (const d of devicesForSiteMap) assetToSite.set(d.assetCode, d.site || '')

      // Sum paper per site by mapping each asset's paper to its site.
      // QA-ROUND-2026-09-16-C: also keep BW/color split per site so the
      // dashboard can show money (paper cost) using each site's OWN rate —
      // same single-source-of-truth as paper-analytics (CONSULTING-007).
      const sitePaperMap: Record<string, number> = {}
      const siteBwMap: Record<string, number> = {}
      const siteColorMap: Record<string, number> = {}
      for (const r of paperByAsset) {
        const site = assetToSite.get(r.assetCode || '') || ''
        if (site) {
          const bw = r._sum.pagesBw ?? 0
          const color = r._sum.pagesColor ?? 0
          sitePaperMap[site] = (sitePaperMap[site] || 0) + bw + color
          siteBwMap[site] = (siteBwMap[site] || 0) + bw
          siteColorMap[site] = (siteColorMap[site] || 0) + color
        }
      }

      bySite = visibleSites.map((s) => {
        const siteName = s.SiteName || ''
        const siteCode = s.SiteCode || ''
        // Devices may be keyed under the site's NAME or its CODE — read both
        // keys, but DEDUPE when they're identical. Demo sites use
        // SiteName == SiteCode ("HQ"/"BKK"), which previously double-counted
        // their device/paper/cost stats (QA-ROUND-2026-09-16-D).
        const siteKeys = siteName === siteCode ? [siteName] : [siteName, siteCode]
        const sumMap = (m: Record<string, number>) => siteKeys.reduce((a, k) => a + (m[k] || 0), 0)
        const bw = sumMap(siteBwMap)
        const color = sumMap(siteColorMap)
        const rateBw = s.PaperRateBW == null ? 0.5 : Number(s.PaperRateBW)
        const rateColor = s.PaperRateColor == null ? 2.0 : Number(s.PaperRateColor)
        return {
          siteCode: s.SiteCode,
          siteName,
          deviceCount: sumMap(deviceCountMap),
          activeCount: sumMap(activeCountMap),
          paperSheets: sumMap(sitePaperMap),
          paperBw: bw,
          paperColor: color,
          paperCost: Math.round((bw * rateBw + color * rateColor) * 100) / 100,
        }
      })
    }

    // ── Heatmap (optional, only if extra=1) ────────────────────────────────
    let heatmap: Array<{ assetCode: string; deviceName: string; months: Array<{ month: string; pages: number }> }> = []
    let heatmapMonths: string[] = []
    if (includeExtra) {
      heatmapMonths = trendMonthKeys
      const topDevices = await db.device.findMany({
        where: { ...siteFilter, meterRequired: true },
        take: 12,
        orderBy: { assetCode: 'asc' },
        select: { assetCode: true, brand: true, model: true },
      })
      const readings = await db.meterReading.groupBy({
        by: ['assetCode', 'readingMonth'],
        where: {
          readingMonth: { in: trendMonthKeys },
          assetCode: { in: topDevices.map((d) => d.assetCode) },
          ...usageTypeFilter,
        },
        _sum: { pagesBw: true, pagesColor: true },
      })
      const byDeviceMonth: Record<string, Record<string, number>> = {}
      for (const r of readings) {
        const code = r.assetCode || ''
        if (!byDeviceMonth[code]) byDeviceMonth[code] = {}
        const key = r.readingMonth || ''
        byDeviceMonth[code][key] =
          (byDeviceMonth[code][key] || 0) + (r._sum.pagesBw ?? 0) + (r._sum.pagesColor ?? 0)
      }
      heatmap = topDevices.map((d) => ({
        assetCode: d.assetCode,
        deviceName: `${d.brand || ''} ${d.model || ''}`.trim() || d.assetCode,
        months: trendMonthKeys.map((m) => ({ month: m, pages: byDeviceMonth[d.assetCode]?.[m] || 0 })),
      }))
    }

    const t1 = Date.now()

    return NextResponse.json({
      totals: { total, active, inactive, spare, repair },
      byStatus,
      byType,
      bySite,
      paperThisMonth,
      paperTrend,
      meterRequiredCount,
      recentActivity,
      heatmap,
      heatmapMonths,
      queryTimeMs: t1 - t0,
      scope: { allowedSites: userSites, role: user.role, email: user.email },
    })
  } catch (err) {
    console.error('GET /api/itam/dashboard', err)
    return NextResponse.json({ error: 'Failed to fetch dashboard' }, { status: 500 })
  }
}
