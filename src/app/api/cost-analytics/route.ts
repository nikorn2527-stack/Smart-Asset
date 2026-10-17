import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { moduleUnavailableResponse } from '@/lib/module-gate'

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

function readingDateWhere(range: RangeInfo): Record<string, unknown> {
  // BUGFIX: MeterReading uses `readingDate` (ISO string) + `readingMonth` (YYYY-MM),
  // not `date`. Fix the where clause to use the correct field.
  if (range.start === null && range.end === null) return {}
  if (range.start && range.end) {
    return { readingDate: { gte: range.start, lte: range.end } }
  }
  if (range.start) return { readingDate: { gte: range.start } }
  if (range.end) return { readingDate: { lte: range.end } }
  return {}
}

const METERABLE_TYPES = ['PRINTER', 'COPIER', 'MFP']

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('reports')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'VIEW_DASHBOARD')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const { searchParams } = new URL(req.url)
    const rawRange = (searchParams.get('range')?.trim() ?? 'month') as RangeKey
    const range: RangeInfo = ['month', '30d', 'quarter', 'all'].includes(
      rawRange,
    )
      ? computeRange(rawRange)
      : computeRange('month')

    const [devices, rates] = await Promise.all([
      db.device.findMany({
        select: {
          id: true,
          assetCode: true,
          name: true,
          site: true,
          type: true,
        },
        orderBy: { assetCode: 'asc' },
      }),
      db.siteRate.findMany({ select: { siteCode: true, bwRate: true, colorRate: true } }),
    ])
    const rateMap = new Map(rates.map((r) => [r.siteCode, { bwRate: r.bwRate ?? 0.5, colorRate: r.colorRate ?? 2.0 }]))
    const defaultBwRate = 0.5
    const defaultColorRate = 2.0

    const meterableDevices = devices.filter((d) =>
      METERABLE_TYPES.includes(d.type),
    )

    const where = readingDateWhere(range)
    const readings = await db.meterReading.findMany({
      where,
      // BUGFIX: MeterReading has no `delta` field. Use pagesBw + pagesColor
      // (both default 0) which represent sheets printed in this reading.
      select: { deviceId: true, pagesBw: true, pagesColor: true },
    })

    // Track BW and Color pages SEPARATELY so we can apply different rates.
    const usageByDeviceBw = new Map<string, number>()
    const usageByDeviceColor = new Map<string, number>()
    for (const r of readings) {
      const curBw = usageByDeviceBw.get(r.deviceId) ?? 0
      const curColor = usageByDeviceColor.get(r.deviceId) ?? 0
      usageByDeviceBw.set(r.deviceId, curBw + (r.pagesBw ?? 0))
      usageByDeviceColor.set(r.deviceId, curColor + (r.pagesColor ?? 0))
    }

    const deviceRows = meterableDevices.map((d) => {
      const bwSheets = usageByDeviceBw.get(d.id) ?? 0
      const colorSheets = usageByDeviceColor.get(d.id) ?? 0
      const sheets = bwSheets + colorSheets
      const rates = rateMap.get(d.site) ?? { bwRate: defaultBwRate, colorRate: defaultColorRate }
      // SiteRate.bwRate / colorRate are Prisma `Decimal` columns — coerce with
      // Number() before arithmetic, otherwise `pages * Decimal` is a type error.
      const bwRate = Number(rates.bwRate)
      const colorRate = Number(rates.colorRate)
      const bwCost = Math.round(bwSheets * bwRate * 100) / 100
      const colorCost = Math.round(colorSheets * colorRate * 100) / 100
      const cost = Math.round((bwCost + colorCost) * 100) / 100
      return {
        id: d.id,
        assetCode: d.assetCode,
        name: d.name,
        site: d.site,
        sheets,
        bwSheets,
        colorSheets,
        rate: rates.bwRate, // backward compat — show BW rate in the rate column
        bwRate: rates.bwRate,
        colorRate: rates.colorRate,
        cost,
        bwCost,
        colorCost,
      }
    })
    deviceRows.sort((a, b) => b.cost - a.cost)

    const totalCost =
      Math.round(deviceRows.reduce((s, r) => s + r.cost, 0) * 100) / 100
    const totalSheets = deviceRows.reduce((s, r) => s + r.sheets, 0)

    // Aggregate by site
    const siteMap = new Map<
      string,
      { site: string; cost: number; sheets: number }
    >()
    for (const r of deviceRows) {
      const cur = siteMap.get(r.site) ?? { site: r.site, cost: 0, sheets: 0 }
      cur.cost += r.cost
      cur.sheets += r.sheets
      siteMap.set(r.site, cur)
    }
    const bySite = Array.from(siteMap.values())
      .map((s) => ({
        site: s.site,
        cost: Math.round(s.cost * 100) / 100,
        sheets: s.sheets,
      }))
      .sort((a, b) => b.cost - a.cost)

    return NextResponse.json({
      devices: deviceRows,
      totalCost,
      totalSheets,
      bySite,
      range,
    })
  } catch (err) {
    console.error('GET /api/cost-analytics', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to compute cost analytics') : 'Internal server error' },
      { status: 500 },
    )
  }
}
