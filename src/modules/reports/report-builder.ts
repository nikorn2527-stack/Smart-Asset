import { db } from '@/lib/db'

/**
 * Legacy report aggregations, now owned by the reports module.
 * This adapter preserves current report payloads while later slices split
 * the underlying device, meter, audit, and utilization reads into ports.
 */

export type ReportType = 'dashboard_summary' | 'cycle' | 'audit' | 'utilization'
export type RangeKey = 'month' | '30d' | 'quarter' | 'all'

export interface RangeInfo {
  key: RangeKey
  label: string
  start: string | null
  end: string | null
}

export function computeRange(key: RangeKey): RangeInfo {
  const now = new Date()
  const todayISO = now.toISOString().slice(0, 10)

  if (key === '30d') {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    return { key, label: '30 วันล่าสุด', start, end: todayISO }
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
    return { key, label: 'ไตรมาสนี้', start, end }
  }

  if (key === 'all') {
    return { key, label: 'ทั้งหมด', start: null, end: null }
  }

  // month
  const startY = now.getFullYear()
  const startMonth = now.getMonth()
  const start = `${startY}-${String(startMonth + 1).padStart(2, '0')}-01`
  const daysInMonth = new Date(startY, startMonth + 1, 0).getDate()
  const end = `${startY}-${String(startMonth + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
  return { key, label: 'เดือนนี้', start, end }
}

function readingDateWhere(range: RangeInfo): Record<string, unknown> {
  if (range.start === null && range.end === null) return {}
  if (range.start && range.end) {
    return { readingDate: { gte: range.start, lte: range.end } }
  }
  if (range.start) return { readingDate: { gte: range.start } }
  if (range.end) return { readingDate: { lte: range.end } }
  return {}
}

const STATUS_LABEL_MAP: Record<string, string> = {
  active: 'ใช้งานอยู่',
  spare: 'สำรอง',
  repair: 'ส่งซ่อม',
  disposed: 'ตัดของออก',
}

function readingUsage(reading: { pagesBw?: number | null; pagesColor?: number | null }): number {
  return (reading.pagesBw ?? 0) + (reading.pagesColor ?? 0)
}

async function buildDashboardSummary(rangeKey: RangeKey) {
  const range = computeRange(rangeKey)
  const devices = await db.device.findMany({
    orderBy: { createdAt: 'desc' },
  })

  const total = devices.length
  // Device statuses are legacy mixed-case values in existing databases.
  // Normalize at the report boundary so dashboard counts stay correct across
  // both legacy and newly seeded records.
  const active = devices.filter((d) => d.status.toLowerCase() === 'active').length
  const spare = devices.filter((d) => d.status.toLowerCase() === 'spare').length
  const repair = devices.filter((d) => d.status.toLowerCase() === 'repair').length

  const statusMap = new Map<string, number>()
  for (const d of devices) {
    statusMap.set(d.status, (statusMap.get(d.status) ?? 0) + 1)
  }
  const byStatus = Array.from(statusMap.entries()).map(([name, value]) => ({
    name: STATUS_LABEL_MAP[name.toLowerCase()] ?? name,
    raw: name,
    value,
  }))

  const typeMap = new Map<string, number>()
  for (const d of devices) {
    typeMap.set(d.type, (typeMap.get(d.type) ?? 0) + 1)
  }
  const byType = Array.from(typeMap.entries()).map(([name, value]) => ({
    name,
    value,
  }))

  const rangeReadings = await db.meterReading.findMany({
    where: readingDateWhere(range),
    select: { deviceId: true, pagesBw: true, pagesColor: true },
  })
  const usageMap = new Map<string, number>()
  for (const r of rangeReadings) {
    usageMap.set(r.deviceId, (usageMap.get(r.deviceId) ?? 0) + (r.pagesBw ?? 0) + (r.pagesColor ?? 0))
  }
  const topUsage = devices
    .map((d) => ({
      id: d.id,
      name: d.name,
      assetCode: d.assetCode,
      value: usageMap.get(d.id) ?? 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)

  const recent = await db.meterReading.findMany({
    where: readingDateWhere(range),
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { device: { select: { id: true, name: true, assetCode: true } } },
  })
  const recentActivity = recent.map((r) => ({
    id: r.id,
    deviceName: r.device?.name ?? '-',
    assetCode: r.device?.assetCode ?? '-',
    reading: (r.meterBw ?? 0) + (r.meterColor ?? 0),
    delta: readingUsage(r),
    date: r.readingDate,
    remark: r.remark,
  }))

  const paperUsage = rangeReadings.reduce(
    (sum, r) => sum + Math.max(0, readingUsage(r)),
    0,
  )

  return {
    type: 'dashboard_summary',
    generatedAt: new Date().toISOString(),
    range,
    summary: {
      totals: { total, active, spare, repair },
      paperThisMonth: paperUsage,
    },
    byStatus,
    byType,
    topUsage,
    recentActivity,
  }
}

async function buildCycleReport(rangeKey: RangeKey) {
  const range = computeRange(rangeKey)
  const cycles = await db.cycle.findMany({
    orderBy: { startDate: 'desc' },
    take: 20,
  })
  const readings = await db.meterReading.findMany({
    where: readingDateWhere(range),
    include: {
      device: {
        select: { id: true, name: true, assetCode: true, site: true },
      },
    },
    orderBy: { readingDate: 'desc' },
    take: 200,
  })

  const totalDelta = readings.reduce(
    (sum, r) => sum + Math.max(0, readingUsage(r)),
    0,
  )
  const byDeviceMap = new Map<string, { name: string; assetCode: string; site: string; delta: number; count: number }>()
  for (const r of readings) {
    const key = r.deviceId
    const entry = byDeviceMap.get(key) ?? {
      name: r.device?.name ?? '-',
      assetCode: r.device?.assetCode ?? '-',
      site: r.device?.site ?? '-',
      delta: 0,
      count: 0,
    }
    entry.delta += readingUsage(r)
    entry.count += 1
    byDeviceMap.set(key, entry)
  }
  const byDevice = Array.from(byDeviceMap.entries())
    .map(([deviceId, v]) => ({ deviceId, ...v }))
    .sort((a, b) => b.delta - a.delta)

  return {
    type: 'cycle',
    generatedAt: new Date().toISOString(),
    range,
    cycles: cycles.map((c) => ({
      id: c.id,
      name: c.name,
      startDate: c.startDate,
      endDate: c.endDate,
      status: c.status,
    })),
    readingCount: readings.length,
    totalSheets: totalDelta,
    byDevice,
    recentReadings: readings.slice(0, 20).map((r) => ({
      id: r.id,
      date: r.readingDate,
      reading: (r.meterBw ?? 0) + (r.meterColor ?? 0),
      delta: readingUsage(r),
      remark: r.remark,
      deviceName: r.device?.name ?? '-',
      assetCode: r.device?.assetCode ?? '-',
    })),
  }
}

async function buildAuditReport(rangeKey: RangeKey) {
  const range = computeRange(rangeKey)
  const where: Record<string, unknown> = readingDateWhere(range)
  // AuditLog stores createdAt as DateTime — apply range as date-gte/lte on
  // ISO date strings (works for SQLite when Prisma converts).
  if (range.start && range.end) {
    // (QA-ROUND-2026-09-16-C) ISO strings, not Date objects — Date instances
    // in Prisma filter args break under Bun ("Argument `_ref` is missing").
    where.createdAt = {
      gte: range.start + 'T00:00:00Z',
      lte: range.end + 'T23:59:59Z',
    }
  } else if (range.start) {
    where.createdAt = { gte: range.start + 'T00:00:00Z' }
  } else if (range.end) {
    where.createdAt = { lte: range.end + 'T23:59:59Z' }
  }

  const logs = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  const actionMap = new Map<string, number>()
  for (const l of logs) {
    actionMap.set(l.action, (actionMap.get(l.action) ?? 0) + 1)
  }
  const byAction = Array.from(actionMap.entries()).map(([action, count]) => ({
    action,
    count,
  }))
  const entityMap = new Map<string, number>()
  for (const l of logs) {
    entityMap.set(l.entity, (entityMap.get(l.entity) ?? 0) + 1)
  }
  const byEntity = Array.from(entityMap.entries()).map(([entity, count]) => ({
    entity,
    count,
  }))

  return {
    type: 'audit',
    generatedAt: new Date().toISOString(),
    range,
    totalCount: logs.length,
    byAction,
    byEntity,
    logs: logs.map((l) => ({
      id: l.id,
      action: l.action,
      entity: l.entity,
      entityId: l.entityId,
      summary: l.summary,
      actor: l.actor,
      createdAt: l.createdAt.toISOString(),
    })),
  }
}

async function buildUtilizationReport(rangeKey: RangeKey) {
  const range = computeRange(rangeKey)
  const devices = await db.device.findMany({
    select: {
      id: true,
      assetCode: true,
      name: true,
      brand: true,
      model: true,
      site: true,
      type: true,
      status: true,
      lastMeterBw: true,
      lastMeterColor: true,
    },
    orderBy: { assetCode: 'asc' },
  })
  const readings = await db.meterReading.findMany({
    where: readingDateWhere(range),
    select: { deviceId: true, pagesBw: true, pagesColor: true },
  })
  const usageMap = new Map<string, number>()
  for (const r of readings) {
    usageMap.set(r.deviceId, (usageMap.get(r.deviceId) ?? 0) + (r.pagesBw ?? 0) + (r.pagesColor ?? 0))
  }
  const rows = devices.map((d) => ({
    id: d.id,
    assetCode: d.assetCode,
    name: d.name,
    brand: d.brand,
    model: d.model,
    site: d.site,
    type: d.type,
    status: d.status,
    lastMeterReading: (d.lastMeterBw ?? 0) + (d.lastMeterColor ?? 0),
    sheets: usageMap.get(d.id) ?? 0,
  }))
  rows.sort((a, b) => b.sheets - a.sheets)
  const totalSheets = rows.reduce((s, r) => s + r.sheets, 0)
  const usedCount = rows.filter((r) => r.sheets > 0).length
  return {
    type: 'utilization',
    generatedAt: new Date().toISOString(),
    range,
    deviceCount: rows.length,
    usedDeviceCount: usedCount,
    totalSheets,
    devices: rows,
  }
}

export async function buildReport(
  type: ReportType,
  rangeKey: RangeKey,
): Promise<Record<string, unknown>> {
  switch (type) {
    case 'dashboard_summary':
      return (await buildDashboardSummary(rangeKey)) as unknown as Record<
        string,
        unknown
      >
    case 'cycle':
      return (await buildCycleReport(rangeKey)) as unknown as Record<
        string,
        unknown
      >
    case 'audit':
      return (await buildAuditReport(rangeKey)) as unknown as Record<
        string,
        unknown
      >
    case 'utilization':
      return (await buildUtilizationReport(rangeKey)) as unknown as Record<
        string,
        unknown
      >
    default:
      throw new Error(`Unknown report type: ${type}`)
  }
}

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  dashboard_summary: 'สรุป Dashboard',
  cycle: 'รอบจดมิเตอร์',
  audit: 'ประวัติการใช้งาน',
  utilization: 'การใช้งานอุปกรณ์',
}

