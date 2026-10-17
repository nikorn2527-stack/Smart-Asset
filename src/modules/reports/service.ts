import type { CreateReportInput, ReportAuditLogger, ReportDetail, ReportRecord, ReportRepository } from './contracts'

function parseJson(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function createReportsService(
  repository: ReportRepository,
  audit: ReportAuditLogger = async () => undefined,
) {
  return {
    listRecent(limit: number) {
      return repository.listRecent(limit)
    },
    async getDetail(id: string): Promise<ReportDetail | null> {
      const report = await repository.findById(id)
      if (!report) return null
      return { ...report, data: parseJson(report.data), filters: parseJson(report.filters) }
    },
    async createRecord(input: CreateReportInput): Promise<ReportRecord> {
      const report = await repository.create(input)
      await audit('GENERATE', report)
      return report
    },
    async deleteRecord(id: string): Promise<ReportRecord | null> {
      const report = await repository.delete(id)
      if (!report) return null
      await audit('DELETE', report)
      return report
    },
  }
}