import { logAudit } from '@/lib/audit'
import { reportsRepository } from './repository'
import { createReportsService } from './service'

/** The reports module's supported cross-module import boundary. */
export { createReportsService } from './service'
export { buildReport, computeRange, REPORT_TYPE_LABELS } from './report-builder'
export { monthlyReportBuilder } from './monthly-report-builder'
export { buildDevicesReport, buildMetersReport, buildWorkOrdersReport, buildStockReport, buildMaintenanceReport, buildApprovalsReport, currentMonthStr, parseMonth, VALID_GROUPS } from './unified-report-builder'
export type { ReportGroup } from './unified-report-builder'
export type { RangeInfo, RangeKey, ReportType } from './report-builder'
export type { MonthlyReportResult, MonthRange, WorkOrderSummary, StockSummary, DeviceSummary } from './monthly-report-builder'

export const reportsService = createReportsService(reportsRepository, async (action, report) =>
  logAudit(action, 'Report', report.id, `${action === 'GENERATE' ? 'สร้าง' : 'ลบ'}รายงาน ${report.title}`, {
    type: report.type,
    rangeKey: report.rangeKey,
  }),
)

export type {
  CreateReportInput,
  ReportAuditLogger,
  ReportDetail,
  ReportRecord,
  ReportRepository,
} from './contracts'
