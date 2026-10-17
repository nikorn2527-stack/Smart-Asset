/**
 * Unified Report Builder — aggregation logic extracted from
 * src/app/api/reports/unified/route.ts (Milestone 2b).
 *
 * This module owns all 6 report group builders (devices, meters,
 * workorders, stock, maintenance, approvals). All DB access goes
 * through reportReadRepository — no @/lib/db imports here.
 *
 * Route handler becomes a thin adapter:
 *   module gate → auth → authz context → parse request → builder → response
 */
import { reportReadRepository } from './report-read-repository'
import { db } from '@/lib/db'
import { normalizeStatus, isActiveStatus } from '@/lib/status-utils'
import { demoFilter, type DemoAwareUser } from '@/lib/demo-mode'

export type ReportGroup =
  | 'devices'
  | 'meters'
  | 'workorders'
  | 'stock'
  | 'maintenance'
  | 'approvals'

export const VALID_GROUPS: ReportGroup[] = [
  'devices',
  'meters',
  'workorders',
  'stock',
  'maintenance',
  'approvals',
]

// ── Helpers ────────────────────────────────────────────
// BUGFIX (QA-ROUND-2026-09-16-C): `lang` was referenced but never defined in
// this module → ReferenceError: lang is not defined → /api/reports/unified
// ?group=meters and ?group=maintenance returned {"error":"lang is not defined"}.
// Now an explicit parameter threaded from each builder (defaults to 'th').
export type ReportLang = 'th' | 'en'
const localeOf = (lang: ReportLang) => (lang === 'th' ? 'th-TH' : 'en-GB')

// QA-ROUND-2026-09-16-C: demo isolation for unified reports — previously the
// builders saw ALL rows, so real users (admin) got demo rows mixed into the
// devices/workorders/stock summaries (e.g. total 20 instead of 12).
function demoW(user?: DemoAwareUser | null): Record<string, unknown> {
  return user ? demoFilter(user) : {}
}

export function parseMonth(
  monthStr: string | null,
  lang: ReportLang = 'th',
): { start: string; end: string; label: string } | null {
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) return null
  const [y, m] = monthStr.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) return null
  const start = `${monthStr}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const end = `${monthStr}-${String(lastDay).padStart(2, '0')}`
  const label = new Date(y, m - 1, 1).toLocaleDateString(localeOf(lang), {
    month: 'long',
    year: 'numeric',
  })
  return { start, end, label }
}

export function currentMonthStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function previousMonthStr(monthStr: string): string {
  const [y, m] = monthStr.split('-').map(Number)
  const d = new Date(y, m - 2, 1) // m-2 because month is 1-indexed, and we want prev month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const STATUS_LABELS_DEV: Record<string, string> = {
  Active: 'ใช้งานอยู่',
  'In Repair': 'ส่งซ่อม',
  Retired: 'ปลดระวาง',
  Spare: 'สำรอง',
  Inactive: 'ไม่ใช้งาน',
}

const STATUS_LABELS_WO: Record<string, string> = {
  PENDING: 'รอดำเนินการ',
  IN_PROGRESS: 'กำลังซ่อม',
  WAITING_PARTS: 'รออะไหล่',
  COMPLETED: 'เสร็จแล้ว',
  CANCELLED: 'ยกเลิก',
}

const DEVICE_TYPE_LABELS: Record<string, string> = {
  PRINTER: 'เครื่องพิมพ์',
  SCANNER: 'สแกนเนอร์',
  COMPUTER: 'คอมพิวเตอร์',
  NETWORK: 'อุปกรณ์เครือข่าย',
  OTHER: 'อื่น ๆ',
}

// ── Group builders ────────────────────────────────────

export async function buildDevicesReport(siteCodes: string[] | null, user?: DemoAwareUser | null) {
  const where: Record<string, unknown> = { ...demoW(user) }
  if (siteCodes !== null) where.site = { in: siteCodes }

  const devices = await db.device.findMany({
    where,
    select: {
      id: true,
      assetCode: true,
      name: true,
      brand: true,
      model: true,
      type: true,
      status: true,
      site: true,
      department: true,
      purchaseDate: true,
      purchasePrice: true,
      salvageValue: true,
      usefulLife: true,
      warrantyEnd: true,
      warrantyMonths: true,
    },
    orderBy: { assetCode: 'asc' },
  })

  const total = devices.length

  // by status — bug DATA-06 fix: normalize status (Active/ACTIVE/active/ใช้งาน → 'Active')
  // so KPI counts are consistent across all modules.
  const statusMap = new Map<string, number>()
  for (const d of devices) {
    const canonical = normalizeStatus(d.status)
    statusMap.set(canonical, (statusMap.get(canonical) ?? 0) + 1)
  }
  const byStatus = Array.from(statusMap.entries())
    .map(([name, value]) => ({
      name: STATUS_LABELS_DEV[name] ?? name,
      raw: name,
      value,
    }))
    .sort((a, b) => b.value - a.value)

  // by type
  const typeMap = new Map<string, number>()
  for (const d of devices) {
    typeMap.set(d.type, (typeMap.get(d.type) ?? 0) + 1)
  }
  const byType = Array.from(typeMap.entries())
    .map(([name, value]) => ({
      name: DEVICE_TYPE_LABELS[name] ?? name,
      raw: name,
      value,
    }))
    .sort((a, b) => b.value - a.value)

  // by site (Bug Group H fix)
  // ──────────────────────────────────────────────────────────────────
  // Device.site is a free-text field that may contain EITHER a
  // SiteCode ("UDH") OR a SiteName ("โรงพยาบาลศูนย์อุดรธานี").
  // Without canonicalization, the same physical site appears twice in
  // the chart (e.g. "โรงพยาบาลศูนย์อุดรธานี" 2231 + "UDH" 7).
  // Fix: load SiteAttribute, build a SiteName→SiteCode lookup, and
  // aggregate by canonical SiteCode so duplicates merge.
  // ──────────────────────────────────────────────────────────────────
  const siteAttrs = await db.siteAttribute.findMany({
    select: { SiteCode: true, SiteName: true },
  })
  const nameToCode = new Map<string, string>()
  for (const sa of siteAttrs) {
    if (sa.SiteName) nameToCode.set(sa.SiteName, sa.SiteCode)
  }
  const resolveSiteCode = (rawSite: string): string => {
    // If the raw value IS already a known SiteCode, use it directly.
    const upper = rawSite.toUpperCase()
    for (const sa of siteAttrs) {
      if (sa.SiteCode.toUpperCase() === upper) return sa.SiteCode
    }
    // Otherwise look up by SiteName.
    return nameToCode.get(rawSite) ?? rawSite
  }

  const siteMap = new Map<string, number>()
  for (const d of devices) {
    const code = resolveSiteCode(d.site)
    siteMap.set(code, (siteMap.get(code) ?? 0) + 1)
  }
  const bySite = Array.from(siteMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)

  // warranty analysis
  const today = new Date()
  const todayISO = today.toISOString().slice(0, 10)
  const ninetyDaysLater = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  const warrantyExpiringSoon = devices
    .filter((d) => {
      if (!d.warrantyEnd) return false
      return d.warrantyEnd >= todayISO && d.warrantyEnd <= ninetyDaysLater
    })
    .map((d) => {
      const daysLeft = Math.ceil(
        (new Date(d.warrantyEnd!).getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      )
      return {
        assetCode: d.assetCode,
        name: d.name,
        site: d.site,
        warrantyEnd: d.warrantyEnd,
        daysLeft,
      }
    })
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 50)

  const warrantyExpired = devices
    .filter((d) => d.warrantyEnd && d.warrantyEnd < todayISO)
    .map((d) => ({
      assetCode: d.assetCode,
      name: d.name,
      site: d.site,
      warrantyEnd: d.warrantyEnd,
    }))
    .sort((a, b) => (a.warrantyEnd ?? '').localeCompare(b.warrantyEnd ?? ''))
    .slice(0, 50)

  // depreciation (straight-line)
  const depreciation = devices
    .filter((d) => Number(d.purchasePrice ?? 0) > 0 && Boolean(d.usefulLife))
    .map((d) => {
      const purchasePrice = Number(d.purchasePrice ?? 0)
      const salvageValue = Number(d.salvageValue ?? 0)
      const usefulLife = d.usefulLife ?? 1
      const purchaseDate = d.purchaseDate ? new Date(d.purchaseDate) : null
      const ageYears = purchaseDate
        ? (today.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
        : 0
      const annualDepreciation = (purchasePrice - salvageValue) / usefulLife
      const accumulatedDepreciation = Math.min(
        purchasePrice - salvageValue,
        annualDepreciation * ageYears,
      )
      const bookValue = Math.max(salvageValue, purchasePrice - accumulatedDepreciation)
      return {
        assetCode: d.assetCode,
        name: d.name,
        site: d.site,
        type: d.type,
        purchasePrice,
        salvageValue,
        usefulLife,
        ageYears: Number(ageYears.toFixed(2)),
        annualDepreciation: Number(annualDepreciation.toFixed(2)),
        accumulatedDepreciation: Number(accumulatedDepreciation.toFixed(2)),
        bookValue: Number(bookValue.toFixed(2)),
      }
    })
    .sort((a, b) => b.accumulatedDepreciation - a.accumulatedDepreciation)
    .slice(0, 100)

  // BUGFIX (QA-ROUND-2026-09-16-C): purchasePrice is a Prisma Decimal —
  // Decimal + number returned a Decimal-like object whose .toFixed chain
  // produced "totalPurchaseValue.toFixed is not a function". Convert first.
  const totalPurchaseValue = devices.reduce(
    (s, d) => s + Number(d.purchasePrice ?? 0),
    0,
  )
  const totalBookValue = depreciation.reduce((s, d) => s + d.bookValue, 0)
  const totalAccumDepreciation = depreciation.reduce(
    (s, d) => s + d.accumulatedDepreciation,
    0,
  )

  return {
    group: 'devices',
    generatedAt: new Date().toISOString(),
    site: siteCodes === null ? 'all' : siteCodes.join(','),
    summary: {
      total,
      active: statusMap.get('Active') ?? 0,
      repair: statusMap.get('In Repair') ?? 0,
      retired: statusMap.get('Retired') ?? 0,
      spare: statusMap.get('Spare') ?? 0,
      inactive: statusMap.get('Inactive') ?? 0,
      totalPurchaseValue: Number(totalPurchaseValue.toFixed(2)),
      totalBookValue: Number(totalBookValue.toFixed(2)),
      totalAccumDepreciation: Number(totalAccumDepreciation.toFixed(2)),
      warrantyExpiringCount: warrantyExpiringSoon.length,
      warrantyExpiredCount: warrantyExpired.length,
    },
    byStatus,
    byType,
    bySite,
    warrantyExpiringSoon,
    warrantyExpired,
    depreciation,
  }
}

export async function buildMetersReport(
  month: string,
  siteCodes: string[] | null,
  lang: ReportLang = 'th',
  user?: DemoAwareUser | null,
) {
  const monthInfo = parseMonth(month)!
  const previousMonth = previousMonthStr(month)

  // Current month readings
  const deviceWhere: Record<string, unknown> = { ...demoW(user) }
  if (siteCodes !== null) deviceWhere.site = { in: siteCodes }

  const devices = await db.device.findMany({
    where: deviceWhere,
    select: {
      id: true,
      assetCode: true,
      name: true,
      site: true,
      department: true,
      meterRequired: true,
      lastMeterBw: true,
      lastMeterColor: true,
      status: true, // bug DATA-02 fix: needed for isActiveStatus filter
    },
  })

  const deviceIds = devices.map((d) => d.id)

  const currentReadings = await db.meterReading.findMany({
    where: {
      readingMonth: month,
      deviceId: { in: deviceIds },
    },
    select: {
      deviceId: true,
      pagesBw: true,
      pagesColor: true,
      readingDate: true,
    },
  })

  const prevReadings = await db.meterReading.findMany({
    where: {
      readingMonth: previousMonth,
      deviceId: { in: deviceIds },
    },
    select: {
      deviceId: true,
      pagesBw: true,
      pagesColor: true,
    },
  })

  // ── METER-REDESIGN: load per-site paper rates from SiteAttribute ──
  // Previously the report used hardcoded rates BW_RATE=0.5 / COLOR_RATE=5
  // (incorrectly 5 instead of SiteAttribute default 2.0). Now we look up
  // `SiteAttribute.PaperRateBW` and `SiteAttribute.PaperRateColor` per site.
  // Sites without an attribute row fall back to 0.5 / 2.0 baht/page (the
  // SiteAttribute column defaults).
  const siteCodesInResult = Array.from(new Set(devices.map((d) => d.site).filter(Boolean)))
  const siteAttrs = await db.siteAttribute.findMany({
    where: { SiteCode: { in: siteCodesInResult } },
    select: { SiteCode: true, PaperRateBW: true, PaperRateColor: true },
  })
  const rateBySite = new Map<string, { bw: number; color: number }>()
  for (const sa of siteAttrs) {
    rateBySite.set(sa.SiteCode, {
      bw: Number(sa.PaperRateBW ?? 0.5),
      color: Number(sa.PaperRateColor ?? 2.0),
    })
  }
  const getRate = (site: string | null): { bw: number; color: number } =>
    rateBySite.get(site ?? '') ?? { bw: 0.5, color: 2.0 }

  // Aggregate per device for current month
  const currByDevice = new Map<
    string,
    { bw: number; color: number; lastDate: string | null }
  >()
  for (const r of currentReadings) {
    const entry = currByDevice.get(r.deviceId) ?? {
      bw: 0,
      color: 0,
      lastDate: null,
    }
    entry.bw += r.pagesBw ?? 0
    entry.color += r.pagesColor ?? 0
    if (!entry.lastDate || r.readingDate > entry.lastDate) {
      entry.lastDate = r.readingDate
    }
    currByDevice.set(r.deviceId, entry)
  }

  const prevByDevice = new Map<string, { bw: number; color: number }>()
  for (const r of prevReadings) {
    const entry = prevByDevice.get(r.deviceId) ?? { bw: 0, color: 0 }
    entry.bw += r.pagesBw ?? 0
    entry.color += r.pagesColor ?? 0
    prevByDevice.set(r.deviceId, entry)
  }

  // Paper usage per device
  const paperUsageByDevice = devices
    .map((d) => {
      const cur = currByDevice.get(d.id) ?? { bw: 0, color: 0, lastDate: null }
      const rate = getRate(d.site)
      return {
        assetCode: d.assetCode,
        name: d.name,
        site: d.site,
        department: d.department ?? '-',
        bw: cur.bw,
        color: cur.color,
        total: cur.bw + cur.color,
        lastReadingDate: cur.lastDate,
        cost: Number((cur.bw * rate.bw + cur.color * rate.color).toFixed(2)),
      }
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 50)

  // Cost by site — uses each site's own PaperRateBW / PaperRateColor
  const costBySiteMap = new Map<string, { bw: number; color: number }>()
  for (const d of devices) {
    const cur = currByDevice.get(d.id) ?? { bw: 0, color: 0, lastDate: null }
    const entry = costBySiteMap.get(d.site) ?? { bw: 0, color: 0 }
    entry.bw += cur.bw
    entry.color += cur.color
    costBySiteMap.set(d.site, entry)
  }
  const costBySite = Array.from(costBySiteMap.entries())
    .map(([site, v]) => {
      const rate = getRate(site)
      return {
        site,
        bw: v.bw,
        color: v.color,
        total: v.bw + v.color,
        cost: Number((v.bw * rate.bw + v.color * rate.color).toFixed(2)),
        // Surface the rates used so the UI / receipts show transparency.
        rates: { bw: rate.bw, color: rate.color },
      }
    })
    .sort((a, b) => b.cost - a.cost)

  // Cost by department — uses the rate of the site the department is in
  // (looked up via the device.site → site rate).
  const costByDeptMap = new Map<
    string,
    { bw: number; color: number; site: string }
  >()
  for (const d of devices) {
    const dept = d.department ?? '-'
    const cur = currByDevice.get(d.id) ?? { bw: 0, color: 0, lastDate: null }
    const existingEntry = costByDeptMap.get(dept)
    if (existingEntry) {
      existingEntry.bw += cur.bw
      existingEntry.color += cur.color
    } else {
      costByDeptMap.set(dept, { bw: cur.bw, color: cur.color, site: d.site })
    }
  }
  const costByDepartment = Array.from(costByDeptMap.entries())
    .map(([department, v]) => {
      const rate = getRate(v.site)
      return {
        department,
        site: v.site,
        bw: v.bw,
        color: v.color,
        total: v.bw + v.color,
        cost: Number((v.bw * rate.bw + v.color * rate.color).toFixed(2)),
      }
    })
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 30)

  // Unmetered devices (meterRequired=true + Active status but no reading this month)
  // bug DATA-02 fix: previously didn't filter by status, leading to mismatch with dashboard
  const unmeteredDevices = devices
    .filter((d) => d.meterRequired && isActiveStatus(d.status) && !currByDevice.has(d.id))
    .map((d) => ({
      assetCode: d.assetCode,
      name: d.name,
      site: d.site,
      department: d.department ?? '-',
      lastMeterBw: d.lastMeterBw,
      lastMeterColor: d.lastMeterColor,
    }))
    .sort((a, b) => a.site.localeCompare(b.site))

  // Monthly comparison (current vs previous)
  let prevBw = 0
  let prevColor = 0
  for (const v of prevByDevice.values()) {
    prevBw += v.bw
    prevColor += v.color
  }
  let curBw = 0
  let curColor = 0
  for (const v of currByDevice.values()) {
    curBw += v.bw
    curColor += v.color
  }

  // Total cost — sum of per-site costs (each site uses its own rate).
  const totalCost = costBySite.reduce((s, v) => s + v.cost, 0)
  // Average rates across all sites (weighted by usage) for the summary line.
  const totalBwCost = costBySite.reduce((s, v) => s + v.bw * (v.rates.bw), 0)
  const totalColorCost = costBySite.reduce((s, v) => s + v.color * (v.rates.color), 0)

  const monthlyComparison = [
    {
      month: previousMonth,
      label: new Date(previousMonth + '-01').toLocaleDateString(localeOf(lang), {
        month: 'short',
        year: 'numeric',
      }),
      bw: prevBw,
      color: prevColor,
      total: prevBw + prevColor,
    },
    {
      month,
      label: monthInfo.label,
      bw: curBw,
      color: curColor,
      total: curBw + curColor,
    },
  ]

  return {
    group: 'meters',
    generatedAt: new Date().toISOString(),
    month,
    monthLabel: monthInfo.label,
    site: siteCodes === null ? 'all' : siteCodes.join(','),
    // Surface the per-site rate map for transparency (used by receipt UIs).
    rates: {
      // Aggregated weighted averages for the summary card.
      avgBwRate: curBw > 0 ? Number((totalBwCost / curBw).toFixed(2)) : 0.5,
      avgColorRate: curColor > 0 ? Number((totalColorCost / curColor).toFixed(2)) : 2.0,
      perSite: Array.from(rateBySite.entries()).map(([site, r]) => ({
        site,
        bwRate: r.bw,
        colorRate: r.color,
      })),
    },
    summary: {
      totalBw: curBw,
      totalColor: curColor,
      totalSheets: curBw + curColor,
      deviceCount: devices.length,
      meterRequiredCount: devices.filter((d) => d.meterRequired && isActiveStatus(d.status)).length,
      unmeteredCount: unmeteredDevices.length,
      // METER-REDESIGN: totalCost now uses per-site SiteAttribute rates instead
      // of hardcoded 0.5/5 baht/page. This is the actual billable amount.
      totalCost: Number(totalCost.toFixed(2)),
      prevMonthTotal: prevBw + prevColor,
      growthPct:
        prevBw + prevColor > 0
          ? Number(
              (
                ((curBw + curColor - (prevBw + prevColor)) /
                  (prevBw + prevColor)) *
                100
              ).toFixed(1),
            )
          : 0,
    },
    paperUsageByDevice,
    costBySite,
    costByDepartment,
    unmeteredDevices,
    monthlyComparison,
  }
}

export async function buildWorkOrdersReport(
  month: string,
  siteCodes: string[] | null,
  user?: DemoAwareUser | null,
) {
  const monthInfo = parseMonth(month)!

  // BUGFIX (QA-ROUND-2026-09-16-C): passing JS Date objects to Prisma filter
  // args breaks under the Bun runtime (Prisma 6.19 mis-detects the Date as a
  // field-ref object → "Argument `_ref` is missing"). ISO strings are valid
  // DateTime filter inputs and work in both Node and Bun.
  const where: Record<string, unknown> = {
    ...demoW(user),
    createdAt: {
      gte: monthInfo.start + 'T00:00:00Z',
      lte: monthInfo.end + 'T23:59:59Z',
    },
  }
  // Apply Site scope via siteCode OR device.site (legacy rows where
  // siteCode was never backfilled fall back to the linked device's site).
  if (siteCodes !== null) {
    where.OR = [
      { siteCode: { in: siteCodes } },
      { siteCode: null, device: { site: { in: siteCodes } } },
    ]
  }

  const workOrders = await db.workOrder.findMany({
    where,
    select: {
      id: true,
      woNumber: true,
      subject: true,
      status: true,
      priority: true,
      assignedTo: true,
      building: true,
      location: true,
      isSpecialFee: true,
      createdAt: true,
      closedAt: true,
      workCompletedAt: true,
      device: { select: { site: true } },
      reviews: { select: { rating: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  // All filtering is now done in the DB query (no post-filter needed).
  const filtered = workOrders

  const total = filtered.length

  // by status
  const statusMap = new Map<string, number>()
  for (const w of filtered) {
    statusMap.set(w.status, (statusMap.get(w.status) ?? 0) + 1)
  }
  const byStatus = Array.from(statusMap.entries())
    .map(([name, value]) => ({
      name: STATUS_LABELS_WO[name] ?? name,
      raw: name,
      value,
    }))
    .sort((a, b) => b.value - a.value)

  // by staff
  const staffMap = new Map<
    string,
    { count: number; completed: number; ratings: number[] }
  >()
  for (const w of filtered) {
    const staff = w.assignedTo?.trim() || '— ยังไม่มอบหมาย'
    const entry = staffMap.get(staff) ?? {
      count: 0,
      completed: 0,
      ratings: [],
    }
    entry.count += 1
    if (w.status === 'COMPLETED') entry.completed += 1
    for (const r of w.reviews) entry.ratings.push(r.rating)
    staffMap.set(staff, entry)
  }
  const byStaff = Array.from(staffMap.entries())
    .map(([name, v]) => ({
      name,
      count: v.count,
      completed: v.completed,
      avgRating:
        v.ratings.length > 0
          ? Number(
              (v.ratings.reduce((s, r) => s + r, 0) / v.ratings.length).toFixed(2),
            )
          : null,
    }))
    .sort((a, b) => b.count - a.count)

  // by subject
  const subjectMap = new Map<string, number>()
  for (const w of filtered) {
    const subj = w.subject || '— ไม่ระบุ'
    subjectMap.set(subj, (subjectMap.get(subj) ?? 0) + 1)
  }
  const bySubject = Array.from(subjectMap.entries())
    .map(([subject, count]) => ({ subject, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)

  // 50-baht special fee cases
  const specialFeeCases = filtered
    .filter((w) => w.isSpecialFee)
    .map((w) => ({
      id: w.id,
      woNumber: w.woNumber,
      subject: w.subject,
      status: w.status,
      statusLabel: STATUS_LABELS_WO[w.status] ?? w.status,
      assignedTo: w.assignedTo ?? '— ยังไม่มอบหมาย',
      building: w.building ?? '-',
      createdAt: w.createdAt.toISOString(),
      closedAt: w.closedAt?.toISOString() ?? null,
    }))

  // ratings distribution
  const allRatings: number[] = []
  for (const w of filtered) {
    for (const r of w.reviews) allRatings.push(r.rating)
  }
  const ratingBuckets = [1, 2, 3, 4, 5].map((star) => ({
    star,
    count: allRatings.filter((r) => r === star).length,
  }))
  const avgRating =
    allRatings.length > 0
      ? Number(
          (allRatings.reduce((s, r) => s + r, 0) / allRatings.length).toFixed(2),
        )
      : null

  return {
    group: 'workorders',
    generatedAt: new Date().toISOString(),
    month,
    monthLabel: monthInfo.label,
    site: siteCodes === null ? 'all' : siteCodes.join(','),
    summary: {
      total,
      pending: statusMap.get('PENDING') ?? 0,
      inProgress: statusMap.get('IN_PROGRESS') ?? 0,
      waitingParts: statusMap.get('WAITING_PARTS') ?? 0,
      completed: statusMap.get('COMPLETED') ?? 0,
      cancelled: statusMap.get('CANCELLED') ?? 0,
      specialFeeCount: specialFeeCases.length,
      avgRating,
      reviewCount: allRatings.length,
    },
    byStatus,
    byStaff,
    bySubject,
    specialFeeCases,
    ratingBuckets,
  }
}

export async function buildStockReport(siteCodes: string[] | null, user?: DemoAwareUser | null) {
  const itemWhere: Record<string, unknown> = { ...demoW(user) }
  if (siteCodes !== null) itemWhere.site = { in: siteCodes }

  const items = await db.stockItem.findMany({
    where: itemWhere,
    select: {
      id: true,
      productCode: true,
      productName: true,
      category: true,
      quantity: true,
      minQuantity: true,
      unit: true,
      unitCost: true,
      site: true,
    },
    orderBy: { productName: 'asc' },
  })

  const totalItems = items.length
  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0)
  const totalValue = items.reduce(
    (s, i) => s + (i.quantity * Number(i.unitCost ?? 0)),
    0,
  )

  const lowStock = items
    .filter((i) => i.minQuantity > 0 && i.quantity > 0 && i.quantity <= i.minQuantity)
    .map((i) => ({
      productCode: i.productCode ?? '-',
      productName: i.productName,
      category: i.category ?? '-',
      quantity: i.quantity,
      minQuantity: i.minQuantity,
      unit: i.unit ?? '',
      site: i.site ?? '-',
      shortage: i.minQuantity - i.quantity,
    }))
    .sort((a, b) => a.shortage - b.shortage)

  const outOfStock = items
    .filter((i) => i.quantity === 0)
    .map((i) => ({
      productCode: i.productCode ?? '-',
      productName: i.productName,
      category: i.category ?? '-',
      minQuantity: i.minQuantity,
      unit: i.unit ?? '',
      site: i.site ?? '-',
    }))

  // recent transactions (last 30 days)
  // StockTransaction has no direct `site` foreign key — we filter via
  // the related StockItem.site field (canonical Site predicate), NOT
  // via remark/department contains (which was unreliable: a remark
  // like "รับเข้า UDH/NKP" would match both Sites).
  // When siteCodes is null (superadmin all-sites), no filter is applied.
  // When siteCodes is an empty array (fail-closed), `in: []` matches
  // nothing — see route handler for the empty-array guard.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
  const txnWhere: Record<string, unknown> = {
    ...demoW(user),
    txnDate: { gte: thirtyDaysAgo },
  }
  if (siteCodes !== null) {
    txnWhere.stockItem = { site: { in: siteCodes } }
  }

  const recentTxns = await db.stockTransaction.findMany({
    where: txnWhere,
    select: {
      id: true,
      txnNumber: true,
      type: true,
      productName: true,
      productCode: true,
      quantity: true,
      unit: true,
      txnDate: true,
      requester: true,
      approver: true,
      approvalStatus: true,
      workOrderNo: true,
      cost: true,
    },
    orderBy: { txnDate: 'desc' },
    take: 100,
  })

  const recentTransactions = recentTxns.map((t) => ({
    id: t.id,
    txnNumber: t.txnNumber ?? '-',
    type: t.type,
    typeLabel: t.type === 'IN' ? 'รับเข้า' : t.type === 'OUT' ? 'เบิกออก' : 'ปรับปรุง',
    productName: t.productName ?? '-',
    productCode: t.productCode ?? '-',
    quantity: t.quantity,
    unit: t.unit ?? '',
    txnDate: t.txnDate,
    requester: t.requester ?? '-',
    approver: t.approver ?? '-',
    approvalStatus: t.approvalStatus ?? '-',
    workOrderNo: t.workOrderNo ?? '-',
    cost: t.cost ?? null,
  }))

  // pending approvals — scoped via canonical stockItem.site predicate
  // (see comment above on the recentTxns filter).
  const pendingWhere: Record<string, unknown> = { ...demoW(user), approvalStatus: 'PENDING' }
  if (siteCodes !== null) {
    pendingWhere.stockItem = { site: { in: siteCodes } }
  }
  const pendingApprovals = await db.stockTransaction.findMany({
    where: pendingWhere,
    select: {
      id: true,
      txnNumber: true,
      productName: true,
      productCode: true,
      quantity: true,
      unit: true,
      type: true,
      requester: true,
      department: true,
      createdAt: true,
      txnDate: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return {
    group: 'stock',
    generatedAt: new Date().toISOString(),
    site: siteCodes === null ? 'all' : siteCodes.join(','),
    summary: {
      totalItems,
      totalQuantity,
      totalValue: Number(totalValue.toFixed(2)),
      lowStockCount: lowStock.length,
      outOfStockCount: outOfStock.length,
      pendingCount: pendingApprovals.length,
      recentTxnCount: recentTransactions.length,
    },
    lowStock,
    outOfStock,
    recentTransactions,
    pendingApprovals: pendingApprovals.map((t) => ({
      id: t.id,
      txnNumber: t.txnNumber ?? '-',
      productName: t.productName ?? '-',
      productCode: t.productCode ?? '-',
      quantity: t.quantity,
      unit: t.unit ?? '',
      type: t.type,
      requester: t.requester ?? '-',
      department: t.department ?? '-',
      createdAt: t.createdAt.toISOString(),
      txnDate: t.txnDate,
    })),
  }
}

export async function buildMaintenanceReport(
  month: string,
  siteCodes: string[] | null,
  lang: ReportLang = 'th',
  user?: DemoAwareUser | null,
) {
  const monthInfo = parseMonth(month)!

  // Maintenance logs (all-time, but filter for cost analysis)
  const deviceWhere: Record<string, unknown> = { ...demoW(user) }
  if (siteCodes !== null) deviceWhere.site = { in: siteCodes }

  const devices = await db.device.findMany({
    where: deviceWhere,
    select: { id: true, assetCode: true, name: true, site: true, type: true },
  })
  const deviceMap = new Map(devices.map((d) => [d.id, d]))
  const deviceIds = devices.map((d) => d.id)

  const logs = await db.maintenanceLog.findMany({
    where: { deviceId: { in: deviceIds } },
    select: {
      id: true,
      deviceId: true,
      type: true,
      status: true,
      startDate: true,
      endDate: true,
      cost: true,
      vendor: true,
      description: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  // by device
  const byDeviceMap = new Map<
    string,
    { repairCount: number; totalCost: number; lastRepairDate: string | null }
  >()
  for (const l of logs) {
    const entry = byDeviceMap.get(l.deviceId) ?? {
      repairCount: 0,
      totalCost: 0,
      lastRepairDate: null,
    }
    entry.repairCount += 1
    entry.totalCost += Number(l.cost ?? 0)
    if (!entry.lastRepairDate || l.startDate > entry.lastRepairDate) {
      entry.lastRepairDate = l.startDate
    }
    byDeviceMap.set(l.deviceId, entry)
  }
  const byDevice = Array.from(byDeviceMap.entries())
    .map(([deviceId, v]) => {
      const d = deviceMap.get(deviceId)
      return {
        assetCode: d?.assetCode ?? '-',
        name: d?.name ?? '-',
        site: d?.site ?? '-',
        type: d?.type ?? '-',
        repairCount: v.repairCount,
        totalCost: Number(v.totalCost.toFixed(2)),
        lastRepairDate: v.lastRepairDate,
      }
    })
    .sort((a, b) => b.repairCount - a.repairCount || b.totalCost - a.totalCost)
    .slice(0, 50)

  // cost by month (last 6 months including current)
  const monthBuckets: Array<{ month: string; cost: number; count: number }> = []
  const [cy, cm] = month.split('-').map(Number)
  for (let i = 5; i >= 0; i--) {
    const d = new Date(cy, cm - 1 - i, 1)
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthBuckets.push({ month: m, cost: 0, count: 0 })
  }
  for (const l of logs) {
    const logMonth = (l.startDate ?? '').slice(0, 7)
    const bucket = monthBuckets.find((b) => b.month === logMonth)
    if (bucket) {
      bucket.cost += Number(l.cost ?? 0)
      bucket.count += 1
    }
  }
  const costByMonth = monthBuckets.map((b) => ({
    month: b.month,
    label: new Date(b.month + '-01').toLocaleDateString(localeOf(lang), {
      month: 'short',
      year: 'numeric',
    }),
    cost: Number(b.cost.toFixed(2)),
    count: b.count,
  }))

  // cost by site
  const costBySiteMap = new Map<string, { cost: number; count: number }>()
  for (const l of logs) {
    const d = deviceMap.get(l.deviceId)
    const siteName = d?.site ?? '-'
    const entry = costBySiteMap.get(siteName) ?? { cost: 0, count: 0 }
    entry.cost += Number(l.cost ?? 0)
    entry.count += 1
    costBySiteMap.set(siteName, entry)
  }
  const costBySite = Array.from(costBySiteMap.entries())
    .map(([site, v]) => ({
      site,
      cost: Number(v.cost.toFixed(2)),
      count: v.count,
    }))
    .sort((a, b) => b.cost - a.cost)

  // Top parts used (from stock transactions linked to work orders).
  // Filter via canonical stockItem.site predicate (same pattern as
  // buildStockReport's recentTxns). When siteCodes is null (superadmin
  // all-sites), no Site filter is applied.
  const partTxnsWhere: Record<string, unknown> = {
    ...demoW(user),
    type: 'OUT',
    workOrderNo: { not: null },
  }
  if (siteCodes !== null) {
    partTxnsWhere.stockItem = { site: { in: siteCodes } }
  }
  const partTxns = await db.stockTransaction.findMany({
    where: partTxnsWhere,
    select: {
      productName: true,
      productCode: true,
      quantity: true,
      cost: true,
      unit: true,
    },
    take: 500,
  })
  const partMap = new Map<
    string,
    { productName: string; productCode: string; quantity: number; totalCost: number }
  >()
  for (const t of partTxns) {
    const key = t.productCode ?? t.productName ?? '-'
    const entry = partMap.get(key) ?? {
      productName: t.productName ?? '-',
      productCode: t.productCode ?? '-',
      quantity: 0,
      totalCost: 0,
    }
    entry.quantity += t.quantity
    entry.totalCost += Number(t.cost ?? 0)
    partMap.set(key, entry)
  }
  const topParts = Array.from(partMap.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10)

  // Summary
  const totalCost = logs.reduce((s, l) => s + Number(l.cost ?? 0), 0)
  const openCount = logs.filter((l) => l.status === 'open').length
  const completedCount = logs.filter((l) => l.status === 'completed').length

  // Current month cost
  const currentMonthCost = logs
    .filter((l) => (l.startDate ?? '').startsWith(month))
    .reduce((s, l) => s + Number(l.cost ?? 0), 0)

  return {
    group: 'maintenance',
    generatedAt: new Date().toISOString(),
    month,
    monthLabel: monthInfo.label,
    site: siteCodes === null ? 'all' : siteCodes.join(','),
    summary: {
      totalLogs: logs.length,
      totalCost: Number(totalCost.toFixed(2)),
      avgCostPerRepair:
        logs.length > 0 ? Number((totalCost / logs.length).toFixed(2)) : 0,
      openCount,
      completedCount,
      currentMonthCost: Number(currentMonthCost.toFixed(2)),
      deviceWithRepairCount: byDeviceMap.size,
    },
    byDevice,
    costByMonth,
    costBySite,
    topParts,
  }
}

export async function buildApprovalsReport(
  month: string,
  siteCodes: string[] | null,
  user?: DemoAwareUser | null,
) {
  const monthInfo = parseMonth(month)!

  // Pending stock approvals — scoped via canonical stockItem.site
  // predicate. (StockTransaction has no direct site FK, but it has a
  // required `stockItem` relation whose `site` field is the canonical
  // Site of the transaction.)
  const pendingStockWhere: Record<string, unknown> = { ...demoW(user), approvalStatus: 'PENDING' }
  if (siteCodes !== null) {
    pendingStockWhere.stockItem = { site: { in: siteCodes } }
  }
  const pendingStock = await db.stockTransaction.findMany({
    where: pendingStockWhere,
    select: {
      id: true,
      txnNumber: true,
      productName: true,
      productCode: true,
      quantity: true,
      unit: true,
      type: true,
      requester: true,
      department: true,
      createdAt: true,
      txnDate: true,
      workOrderNo: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  // Approved/rejected in current month — scoped via canonical
  // stockItem.site predicate (same pattern as pendingStock above).
  // (QA-ROUND-2026-09-16-C) ISO strings instead of Date objects — see the
  // Bun/Prisma filter note in buildWorkOrdersReport above.
  const monthStart = monthInfo.start + 'T00:00:00Z'
  const monthEnd = monthInfo.end + 'T23:59:59Z'
  const approvedTxnsWhere: Record<string, unknown> = {
    ...demoW(user),
    approvalStatus: { in: ['APPROVED', 'REJECTED'] },
    approvedAt: { gte: monthInfo.start, lte: monthInfo.end },
  }
  if (siteCodes !== null) {
    approvedTxnsWhere.stockItem = { site: { in: siteCodes } }
  }
  const approvedTxns = await db.stockTransaction.findMany({
    where: approvedTxnsWhere,
    select: {
      id: true,
      txnNumber: true,
      productName: true,
      quantity: true,
      type: true,
      approvalStatus: true,
      approver: true,
      approvedAt: true,
      requester: true,
      rejectReason: true,
    },
    orderBy: { approvedAt: 'desc' },
    take: 100,
  })

  // Pending work orders (status PENDING or WAITING_PARTS)
  const woWhere: Record<string, unknown> = {
    ...demoW(user),
    status: { in: ['PENDING', 'WAITING_PARTS'] },
  }
  if (siteCodes !== null) {
    woWhere.OR = [
      { siteCode: { in: siteCodes } },
      { siteCode: null, device: { site: { in: siteCodes } } },
    ]
  }
  const pendingWO = await db.workOrder.findMany({
    where: woWhere,
    select: {
      id: true,
      woNumber: true,
      subject: true,
      status: true,
      priority: true,
      assignedTo: true,
      building: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  // Special fee cases in current month — also scoped by Site
  const specialFeeWhere: Record<string, unknown> = {
    ...demoW(user),
    isSpecialFee: true,
    createdAt: { gte: monthStart, lte: monthEnd },
  }
  if (siteCodes !== null) {
    specialFeeWhere.OR = [
      { siteCode: { in: siteCodes } },
      { siteCode: null, device: { site: { in: siteCodes } } },
    ]
  }
  const specialFeeCases = await db.workOrder.findMany({
    where: specialFeeWhere,
    select: {
      id: true,
      woNumber: true,
      subject: true,
      status: true,
      assignedTo: true,
      building: true,
      createdAt: true,
      closedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  // B5/NF-1/NF-2 FIX: Use AuditLog.siteCode column directly (set-based SQL).
  // Filters by siteCode in the DB query — no entity resolution loop (N+1).
  // Legacy entries (siteCode=null) are excluded for Site-scoped users (fail-closed).
  // A backfill script should populate siteCode for existing entries.
  const APPROVAL_ACTIONS = [
    'STOCK_PENDING_APPROVE',
    'STOCK_PENDING_REJECT',
    'WO_PARTS_APPROVE',
    'GRANT_CREATE',
    'GRANT_UPDATE',
    'GRANT_DELETE',
  ]
  const approvalHistoryWhere: Record<string, unknown> = {
    ...demoW(user),
    action: { in: APPROVAL_ACTIONS },
    createdAt: { gte: monthStart, lte: monthEnd },
  }
  if (siteCodes !== null) {
    // Site-scoped user: filter by AuditLog.siteCode directly
    if (siteCodes.length > 0) {
      approvalHistoryWhere.siteCode = { in: siteCodes }
    } else {
      approvalHistoryWhere.siteCode = { equals: '__NO_MATCH__' }
    }
  }
  // superadmin (siteCodes === null) → no siteCode filter → all entries
  const approvalHistory = await db.auditLog.findMany({
    where: approvalHistoryWhere,
    select: {
      id: true,
      action: true,
      entity: true,
      entityId: true,
      summary: true,
      actor: true,
      siteCode: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  const approvedCount = approvedTxns.filter((t) => t.approvalStatus === 'APPROVED').length
  const rejectedCount = approvedTxns.filter((t) => t.approvalStatus === 'REJECTED').length

  return {
    group: 'approvals',
    generatedAt: new Date().toISOString(),
    month,
    monthLabel: monthInfo.label,
    site: siteCodes === null ? 'all' : siteCodes.join(','),
    summary: {
      pendingStockCount: pendingStock.length,
      pendingWOCount: pendingWO.length,
      specialFeeCount: specialFeeCases.length,
      approvedCount,
      rejectedCount,
      approvalHistoryCount: approvalHistory.length,
      totalPending:
        pendingStock.length + pendingWO.length + specialFeeCases.length,
    },
    pendingStock: pendingStock.map((t) => ({
      id: t.id,
      txnNumber: t.txnNumber ?? '-',
      productName: t.productName ?? '-',
      productCode: t.productCode ?? '-',
      quantity: t.quantity,
      unit: t.unit ?? '',
      type: t.type,
      requester: t.requester ?? '-',
      department: t.department ?? '-',
      workOrderNo: t.workOrderNo ?? '-',
      createdAt: t.createdAt.toISOString(),
      txnDate: t.txnDate,
    })),
    pendingWO: pendingWO.map((w) => ({
      id: w.id,
      woNumber: w.woNumber ?? '-',
      subject: w.subject,
      status: w.status,
      statusLabel: STATUS_LABELS_WO[w.status] ?? w.status,
      priority: w.priority,
      assignedTo: w.assignedTo ?? '— ยังไม่มอบหมาย',
      building: w.building ?? '-',
      createdAt: w.createdAt.toISOString(),
    })),
    specialFeeCases: specialFeeCases.map((w) => ({
      id: w.id,
      woNumber: w.woNumber ?? '-',
      subject: w.subject,
      status: w.status,
      statusLabel: STATUS_LABELS_WO[w.status] ?? w.status,
      assignedTo: w.assignedTo ?? '— ยังไม่มอบหมาย',
      building: w.building ?? '-',
      createdAt: w.createdAt.toISOString(),
      closedAt: w.closedAt?.toISOString() ?? null,
    })),
    approvalHistory: approvalHistory.map((l) => ({
      id: l.id,
      action: l.action,
      entity: l.entity,
      entityId: l.entityId ?? '-',
      summary: l.summary,
      actor: l.actor,
      createdAt: l.createdAt.toISOString(),
    })),
    approvedTransactions: approvedTxns.map((t) => ({
      id: t.id,
      txnNumber: t.txnNumber ?? '-',
      productName: t.productName ?? '-',
      quantity: t.quantity,
      type: t.type,
      approvalStatus: t.approvalStatus,
      approver: t.approver ?? '-',
      requester: t.requester ?? '-',
      approvedAt: t.approvedAt,
      rejectReason: t.rejectReason,
    })),
  }
}

// ── Route handler ─────────────────────────────────────

