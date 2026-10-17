import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { demoFilter } from '@/lib/demo-mode'
import { siteFilterForUser } from '@/lib/auth'

type RangeKey = 'month' | '30d' | 'quarter' | 'all'

interface RangeInfo {
  key: RangeKey
  start: string | null
  end: string | null
}

function computeRange(key: RangeKey): RangeInfo {
  const now = new Date()
  const todayISO = now.toISOString().slice(0, 10)

  if (key === '30d') {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    return { key, start, end: todayISO }
  }

  if (key === 'quarter') {
    const month = now.getMonth()
    const qStartMonth = Math.floor(month / 3) * 3
    const startY = now.getFullYear()
    const start = `${startY}-${String(qStartMonth + 1).padStart(2, '0')}-01`
    const endMonth = qStartMonth + 2
    const endY = endMonth > 11 ? startY + 1 : startY
    const endMonthIdx = endMonth > 11 ? endMonth - 12 : endMonth
    const daysInEnd = new Date(endY, endMonthIdx + 1, 0).getDate()
    const end = `${endY}-${String(endMonthIdx + 1).padStart(2, '0')}-${String(daysInEnd).padStart(2, '0')}`
    return { key, start, end }
  }

  if (key === 'all') {
    return { key, start: null, end: null }
  }

  const startY = now.getFullYear()
  const startMonth = now.getMonth()
  const start = `${startY}-${String(startMonth + 1).padStart(2, '0')}-01`
  const daysInMonth = new Date(startY, startMonth + 1, 0).getDate()
  const end = `${startY}-${String(startMonth + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
  return { key, start, end }
}

const METERABLE_TYPES = ['PRINTER', 'COPIER', 'MFP']

interface MonthlyReading {
  month: string // YYYY-MM
  sheets: number
}

interface DeviceUtilization {
  deviceId: string
  assetCode: string
  name: string
  brand: string
  model: string
  site: string
  monthlyReadings: MonthlyReading[]
  totalSheets: number
  avgPerMonth: number
  maxMonth: { month: string; sheets: number } | null
  minMonth: { month: string; sheets: number } | null
  utilizationScore: number
  trend: 'up' | 'down' | 'stable'
}

interface UtilizationSummary {
  avgUtilization: number
  topDevice: DeviceUtilization | null
  lowDevice: DeviceUtilization | null
}

// Heavy operation — needs longer timeout (Vercel Hobby: max 60s)
export const maxDuration = 60

/**
 * Compute month list to display based on the range:
 * - month: last 3 months (current + 2 prior) for trend visibility
 * - 30d:   last 3 months
 * - quarter: last 6 months
 * - all:   last 12 months
 */
function monthColumns(range: RangeKey): string[] {
  const now = new Date()
  const count = range === 'quarter' ? 6 : range === 'all' ? 12 : 3
  const months: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    )
  }
  return months
}

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { searchParams } = new URL(req.url)
    const rawRange = (searchParams.get('range')?.trim() ?? 'month') as RangeKey
    const range: RangeKey = ['month', '30d', 'quarter', 'all'].includes(rawRange)
      ? rawRange
      : 'month'
    const rangeInfo = computeRange(range)

    // QA-ROUND-2026-09-16-E: scope to the caller's data (demo isolation +
    // allowed sites) — readings are already bounded to these device ids below.
    const devices = await db.device.findMany({
      where: {
        type: { in: METERABLE_TYPES },
        ...demoFilter(auth.user),
        ...siteFilterForUser(auth.row),
      },
      select: {
        id: true,
        assetCode: true,
        name: true,
        brand: true,
        model: true,
        site: true,
      },
      orderBy: { assetCode: 'asc' },
    })

    if (devices.length === 0) {
      return NextResponse.json({
        devices: [],
        summary: { avgUtilization: 0, topDevice: null, lowDevice: null },
        months: monthColumns(range),
        range: rangeInfo,
      })
    }

    // Pull all readings for the displayed months.
    // QA-ROUND-2026-09-16-F: filter by `readingMonth IN (months)` (the same
    // semantics as the dashboard trend + paper-analytics grouping) instead of
    // a readingDate window — month-end-dated readings for the CURRENT month
    // (e.g. 2026-09-30 while today is 2026-09-16) were wrongly excluded by
    // the old `readingDate <= todayISO` bound, dropping all of September.
    // QA-ROUND-2026-09-16-E: the real schema fields are readingDate (ISO
    // string) and pagesBw/pagesColor (per-reading usage deltas).
    const months = monthColumns(range)

    const readings = await db.meterReading.findMany({
      where: {
        readingMonth: { in: months },
        deviceId: { in: devices.map((d) => d.id) },
        // Only usage readings — mirrors the dashboard trend filter.
        readingType: { in: ['MONTHLY', 'CHECKOUT', 'RETURN'] },
      },
      select: { deviceId: true, pagesBw: true, pagesColor: true, readingMonth: true },
    })

    // Aggregate per device per month (pagesBw+pagesColor = sheets printed)
    const perDeviceMonth = new Map<string, Map<string, number>>()
    for (const r of readings) {
      const m = (r.readingMonth || '').slice(0, 7) // YYYY-MM
      if (!m) continue
      let inner = perDeviceMonth.get(r.deviceId)
      if (!inner) {
        inner = new Map<string, number>()
        perDeviceMonth.set(r.deviceId, inner)
      }
      const sheets = (r.pagesBw > 0 ? r.pagesBw : 0) + (r.pagesColor > 0 ? r.pagesColor : 0)
      inner.set(m, (inner.get(m) ?? 0) + sheets)
    }

    // Build device rows
    const deviceRows: DeviceUtilization[] = devices.map((d) => {
      const inner = perDeviceMonth.get(d.id) ?? new Map<string, number>()
      const monthlyReadings: MonthlyReading[] = months.map((m) => ({
        month: m,
        sheets: inner.get(m) ?? 0,
      }))
      const totalSheets = monthlyReadings.reduce((s, r) => s + r.sheets, 0)
      const nonZero = monthlyReadings.filter((r) => r.sheets > 0)
      const avgPerMonth =
        monthlyReadings.length > 0
          ? Math.round(totalSheets / monthlyReadings.length)
          : 0

      let maxMonth: { month: string; sheets: number } | null = null
      let minMonth: { month: string; sheets: number } | null = null
      if (nonZero.length > 0) {
        maxMonth = nonZero.reduce((a, b) => (b.sheets > a.sheets ? b : a))
        minMonth = nonZero.reduce((a, b) => (b.sheets < a.sheets ? b : a))
      }

      // Trend: compare last two non-zero months (if any)
      let trend: 'up' | 'down' | 'stable' = 'stable'
      if (nonZero.length >= 2) {
        const last = nonZero[nonZero.length - 1]
        const prev = nonZero[nonZero.length - 2]
        const diff = last.sheets - prev.sheets
        const pct = prev.sheets > 0 ? diff / prev.sheets : 0
        if (pct > 0.1) trend = 'up'
        else if (pct < -0.1) trend = 'down'
        else trend = 'stable'
      } else if (nonZero.length === 1) {
        // Single point — treat as stable
        trend = 'stable'
      }

      return {
        deviceId: d.id,
        assetCode: d.assetCode,
        name: d.name,
        brand: d.brand,
        model: d.model,
        site: d.site,
        monthlyReadings,
        totalSheets,
        avgPerMonth,
        maxMonth,
        minMonth,
        utilizationScore: 0, // assigned after normalization
        trend,
      }
    })

    // Normalize utilization score: totalSheets / maxTotalSheets * 100
    const maxTotal = Math.max(1, ...deviceRows.map((d) => d.totalSheets))
    for (const row of deviceRows) {
      row.utilizationScore = Math.round((row.totalSheets / maxTotal) * 100)
    }

    deviceRows.sort((a, b) => b.totalSheets - a.totalSheets)

    const avgUtilization =
      deviceRows.length > 0
        ? Math.round(
            deviceRows.reduce((s, d) => s + d.utilizationScore, 0) /
              deviceRows.length,
          )
        : 0

    const topDevice = deviceRows[0] ?? null
    // Low device = lowest non-zero usage; if all zero, pick the first
    const lowDevice =
      deviceRows.slice().reverse().find((d) => d.totalSheets > 0) ??
      deviceRows[deviceRows.length - 1] ??
      null

    const summary: UtilizationSummary = {
      avgUtilization,
      topDevice,
      lowDevice,
    }

    return NextResponse.json({
      devices: deviceRows,
      summary,
      months,
      range: rangeInfo,
    })
  } catch (err) {
    console.error('GET /api/devices/utilization', err)
    return NextResponse.json(
      { error: 'Failed to compute utilization' },
      { status: 500 },
    )
  }
}
