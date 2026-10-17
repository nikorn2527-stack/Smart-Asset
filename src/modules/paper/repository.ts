import { db } from '@/lib/db'
import type { PaperAnalyticsSummary, PaperAnalyticsRepository } from './contracts'

export const paperAnalyticsRepository: PaperAnalyticsRepository = {
  async getSummary(monthStart, monthEnd, site) {
    const readings = await db.meterReading.findMany({
      where: {
        readingMonth: { gte: monthStart, lte: monthEnd },
      },
      select: {
        readingMonth: true,
        meterBw: true,
        meterColor: true,
        pagesBw: true,
        pagesColor: true,
        siteAtReading: true,
      },
    })
    const totalBw = readings.reduce((s, r) => s + r.pagesBw, 0)
    const totalColor = readings.reduce((s, r) => s + r.pagesColor, 0)
    return { totalBw, totalColor, totalPages: totalBw + totalColor, byMonth: [], bySite: [] }
  },
}
