/** Public DTOs and persistence port for the reports module. */
export interface ReportRecord {
  id: string
  type: string
  title: string
  rangeKey: string | null
  filters: string | null
  data: string
  format: string
  createdAt: Date
}

export interface CreateReportInput {
  type: string
  title: string
  rangeKey: string | null
  filters: string | null
  data: string
  format: string
}

export interface ReportRepository {
  listRecent(limit: number): Promise<Pick<ReportRecord, 'id' | 'type' | 'title' | 'rangeKey' | 'format' | 'createdAt'>[]>
  findById(id: string): Promise<ReportRecord | null>
  create(input: CreateReportInput): Promise<ReportRecord>
  delete(id: string): Promise<ReportRecord | null>
}

export interface ReportDetail extends Omit<ReportRecord, 'data' | 'filters'> {
  data: unknown
  filters: unknown
}

export type ReportAuditLogger = (
  action: 'GENERATE' | 'DELETE',
  report: ReportRecord,
) => Promise<unknown>
