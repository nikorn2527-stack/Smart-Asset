import { db } from '@/lib/db'
import type { DashboardKpi, DashboardRepository } from './contracts'

export const dashboardRepository: DashboardRepository = {
  async getKpiSummary() {
    const devices = await db.device.findMany({
      select: { status: true, meterRequired: true, purchaseDate: true, warrantyMonths: true },
    })
    const total = devices.length
    const norm = (s: string) => (s ?? '').trim().toLowerCase()
    const active = devices.filter(d => norm(d.status) === 'active').length
    const spare = devices.filter(d => norm(d.status) === 'spare' || norm(d.status) === 'in stock').length
    const repair = devices.filter(d => norm(d.status) === 'in repair' || norm(d.status) === 'repair').length
    const inactive = devices.filter(d => ['inactive', 'retired', 'disposed', 'returned'].includes(norm(d.status))).length
    const meterRequired = devices.filter(d => d.meterRequired).length
    return { total, active, spare, repair, inactive, warrantyExpiring: 0, warrantyExpired: 0, meterRequired, paperThisMonth: 0 }
  },

  async getDeviceStatusCounts() {
    const devices = await db.device.findMany({ select: { status: true } })
    const counts: Record<string, number> = {}
    for (const d of devices) counts[d.status] = (counts[d.status] ?? 0) + 1
    return counts
  },

  async getDeviceTypeCounts() {
    const devices = await db.device.findMany({ select: { type: true } })
    const counts: Record<string, number> = {}
    for (const d of devices) counts[d.type] = (counts[d.type] ?? 0) + 1
    return Object.entries(counts).map(([type, count]) => ({ type, count }))
  },

  async getPaperTrend(months) {
    const now = new Date()
    const result: Array<{ month: string; bw: number; color: number }> = []
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const readings = await db.meterReading.findMany({
        where: { readingMonth: monthStr },
        select: { pagesBw: true, pagesColor: true },
      })
      result.push({
        month: monthStr,
        bw: readings.reduce((s, r) => s + r.pagesBw, 0),
        color: readings.reduce((s, r) => s + r.pagesColor, 0),
      })
    }
    return result
  },
}
