export interface DashboardKpi {
  total: number
  active: number
  spare: number
  repair: number
  inactive: number
  warrantyExpiring: number
  warrantyExpired: number
  meterRequired: number
  paperThisMonth: number
}

export interface DashboardRepository {
  getKpiSummary(): Promise<DashboardKpi>
  getDeviceStatusCounts(): Promise<Record<string, number>>
  getDeviceTypeCounts(): Promise<Array<{ type: string; count: number }>>
  getPaperTrend(months: number): Promise<Array<{ month: string; bw: number; color: number }>>
}
