export interface PaperAnalyticsSummary {
  totalBw: number
  totalColor: number
  totalPages: number
  byMonth: Array<{ month: string; bw: number; color: number }>
  bySite: Array<{ site: string; bw: number; color: number }>
}

export interface PaperAnalyticsRepository {
  getSummary(monthStart: string, monthEnd: string, site?: string | null): Promise<PaperAnalyticsSummary>
}
