/**
 * Monthly Report Builder — aggregation logic extracted from
 * src/app/api/reports/monthly/route.ts (Milestone 2).
 *
 * This module owns the "shape" of the monthly report data. It calls
 * reportReadRepository for all DB access — no @/lib/db imports here.
 *
 * Route handler becomes a thin adapter:
 *   module gate → auth → parse request → monthlyReportBuilder.build() → response
 */
import { reportReadRepository } from './report-read-repository'

// ── Types ──

export interface MonthRange {
  month: string // YYYY-MM
  startISO: string
  endISO: string
  start: Date
  end: Date
}

export interface WorkOrderSummary {
  total: number
  byStatus: Record<string, number>
  byPriority: Record<string, number>
  bySubject: Array<{ subject: string; count: number }>
  avgResponseTimeMin: number | null
  avgRating: number | null
  byStaff: Array<{ name: string; count: number; completed: number }>
}

export interface StockSummary {
  totalIn: number
  totalOut: number
  topItems: Array<{ productName: string; productCode: string | null; quantity: number; type: string }>
  lowStockItems: Array<{ productCode: string; productName: string; quantity: number; minQuantity: number; unit: string }>
  totalValue: number
}

export interface DeviceSummary {
  total: number
  newDevices: number
  byStatus: Record<string, number>
}

export interface MonthlyReportResult {
  month: string
  range: { start: string; end: string }
  generatedAt: string
  filters: { site: string | null; type: string }
  workOrders: WorkOrderSummary | null
  stock: StockSummary | null
  devices: DeviceSummary | null
  meta: { avgResponseTimeLabel: string }
}

// ── Helpers (moved verbatim from route) ──

export function parseMonth(input: string | null): MonthRange {
  const now = new Date()
  const fallbackY = now.getFullYear()
  const fallbackM = now.getMonth()

  let y: number
  let m: number

  if (input && /^\d{4}-\d{2}$/.test(input)) {
    const [yy, mm] = input.split('-')
    y = parseInt(yy, 10)
    m = parseInt(mm, 10) - 1
    if (Number.isNaN(y) || Number.isNaN(m) || m < 0 || m > 11 || y < 1900 || y > 9999) {
      y = fallbackY
      m = fallbackM
    }
  } else {
    y = fallbackY
    m = fallbackM
  }

  const mmStr = String(m + 1).padStart(2, '0')
  const startISO = `${y}-${mmStr}-01`
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const endISO = `${y}-${mmStr}-${String(daysInMonth).padStart(2, '0')}`
  const start = new Date(y, m, 1, 0, 0, 0, 0)
  const end = new Date(y, m, daysInMonth, 23, 59, 59, 999)
  return { month: `${y}-${mmStr}`, startISO, endISO, start, end }
}

function formatResponseTime(min: number | null): string {
  if (min == null) return '—'
  const h = min / 60
  if (h < 24) return `${h.toFixed(1)} ชม.`
  const d = h / 24
  return `${d.toFixed(1)} วัน`
}

// ── Builders (call repository, not db) ──

async function buildWorkOrderSummary(month: MonthRange): Promise<WorkOrderSummary> {
  const workOrders = await reportReadRepository.findWorkOrdersForMonth(month.start, month.end)
  const reviews = await reportReadRepository.findReviewsForMonth(month.start, month.end)

  const total = workOrders.length

  const byStatus: Record<string, number> = { PENDING: 0, IN_PROGRESS: 0, WAITING_PARTS: 0, COMPLETED: 0, CANCELLED: 0 }
  for (const w of workOrders) byStatus[w.status] = (byStatus[w.status] ?? 0) + 1

  const byPriority: Record<string, number> = { 'ปกติ': 0, 'ปานกลาง': 0, 'สูง': 0, 'ด่วน': 0 }
  for (const w of workOrders) byPriority[w.priority] = (byPriority[w.priority] ?? 0) + 1

  const subjectMap = new Map<string, number>()
  for (const w of workOrders) {
    const key = w.subject?.trim() || 'ไม่ระบุ'
    subjectMap.set(key, (subjectMap.get(key) ?? 0) + 1)
  }
  const bySubject = Array.from(subjectMap.entries())
    .map(([subject, count]) => ({ subject, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  const responseTimesMin: number[] = []
  for (const w of workOrders) {
    if (w.assignedAt && w.createdAt) {
      const diffMs = w.assignedAt.getTime() - w.createdAt.getTime()
      if (diffMs >= 0) responseTimesMin.push(diffMs / (1000 * 60))
    }
  }
  const avgResponseTimeMin = responseTimesMin.length > 0
    ? responseTimesMin.reduce((a, b) => a + b, 0) / responseTimesMin.length
    : null

  const ratings = reviews.map(r => r.rating).filter((r): r is number => r != null && r > 0)
  const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null

  const staffMap = new Map<string, { count: number; completed: number }>()
  for (const w of workOrders) {
    if (!w.assignedTo) continue
    const entry = staffMap.get(w.assignedTo) ?? { count: 0, completed: 0 }
    entry.count++
    if (w.status === 'COMPLETED') entry.completed++
    staffMap.set(w.assignedTo, entry)
  }
  const byStaff = Array.from(staffMap.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.count - a.count)

  return { total, byStatus, byPriority, bySubject, avgResponseTimeMin, avgRating, byStaff }
}

async function buildStockSummary(month: MonthRange, siteFilter: string | null): Promise<StockSummary> {
  const txns = await reportReadRepository.findStockTxnsForMonth(month.start, month.end, siteFilter)
  const items = await reportReadRepository.findStockItems(siteFilter)

  const totalIn = txns.filter(t => t.type === 'IN').reduce((sum, t) => sum + t.quantity, 0)
  const totalOut = txns.filter(t => t.type === 'OUT').reduce((sum, t) => sum + t.quantity, 0)

  const itemMap = new Map<string, { productName: string; productCode: string | null; quantity: number; type: string }>()
  for (const t of txns) {
    const key = t.productCode || t.productName || 'unknown'
    const entry = itemMap.get(key) ?? { productName: t.productName ?? 'ไม่ระบุ', productCode: t.productCode, quantity: 0, type: t.type }
    entry.quantity += t.quantity
    itemMap.set(key, entry)
  }
  const topItems = Array.from(itemMap.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 10)

  const lowStockItems = items
    .filter(i => i.quantity <= i.minQuantity)
    .map(i => ({ productCode: i.productCode ?? '', productName: i.productName, quantity: i.quantity, minQuantity: i.minQuantity, unit: i.unit }))

  const totalValue = items.reduce((sum, i) => sum + (i.unitCost ?? 0) * i.quantity, 0)

  return { totalIn, totalOut, topItems, lowStockItems, totalValue }
}

async function buildDeviceSummary(month: MonthRange, siteFilter: string | null): Promise<DeviceSummary> {
  const devices = await reportReadRepository.findDevicesForMonth(month.start, month.end, siteFilter)
  const total = devices.length
  const newDevices = devices.filter(d => d.createdAt >= month.start && d.createdAt <= month.end).length
  const byStatus: Record<string, number> = {}
  for (const d of devices) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1
  return { total, newDevices, byStatus }
}

// ── Public API ──

export const monthlyReportBuilder = {
  async build(monthParam: string | null, siteParam: string | null, typeParam: string): Promise<MonthlyReportResult> {
    const month = parseMonth(monthParam)

    const includeWO = typeParam === 'all' || typeParam === 'work-order'
    const includeStock = typeParam === 'all' || typeParam === 'stock'
    const includeDevices = typeParam === 'all' || typeParam === 'devices'

    const [workOrders, stock, devices] = await Promise.all([
      includeWO ? buildWorkOrderSummary(month) : null,
      includeStock ? buildStockSummary(month, siteParam) : null,
      includeDevices ? buildDeviceSummary(month, siteParam) : null,
    ])

    return {
      month: month.month,
      range: { start: month.startISO, end: month.endISO },
      generatedAt: new Date().toISOString(),
      filters: { site: siteParam || null, type: typeParam },
      workOrders,
      stock,
      devices,
      meta: {
        avgResponseTimeLabel: workOrders ? formatResponseTime(workOrders.avgResponseTimeMin) : '—',
      },
    }
  },
}

