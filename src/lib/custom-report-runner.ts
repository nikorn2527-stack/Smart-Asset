/**
 * custom-report-runner.ts — Phase A3 — Advanced Custom Report Builder.
 *
 * Turns a saved CustomReport.config (JSON string) into:
 *   • a Prisma `findMany` query (filters + sort + pagination)
 *   • a Prisma `groupBy` query (when aggregations are requested)
 *
 * Security:
 *   • Every query is constrained by `demoFilter(auth.user)` so demo users
 *     only see demo data and real users only see real data.
 *   • Site scope is enforced via `buildAuthorizationContext.siteWhere()`
 *     for the `site` field on Device/StockItem (devices & stockitems
 *     data sources) and the `siteCode` field on WorkOrder. MeterReading
 *     is scoped via its `siteAtReading` field (falls back to no-scope
 *     when null — for legacy rows without site snapshots).
 *
 * Field whitelisting: each data source has a curated list of fields
 * the report builder is allowed to project / filter / sort / group by.
 * This prevents accidental disclosure of sensitive columns (e.g.
 * passwordHash on User) and prevents Prisma from rejecting unknown
 * field names in `select` clauses.
 *
 * Task ID: PHASE-A3-REPORTS
 */

import { db } from '@/lib/db'
import { demoFilter, type DemoAwareUser } from '@/lib/demo-mode'
import type { AuthorizationContext } from '@/lib/authorization-context'

// ── Types ───────────────────────────────────────────────────────────

export type DataSourceName = 'devices' | 'workorders' | 'meterreadings' | 'stockitems'

export type FilterOp = 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'in'

export interface ReportFilter {
  field: string
  op: FilterOp
  /** For `in` op this is an array (we accept string | number | string[] | number[]). */
  value: unknown
}

export type AggFn = 'count' | 'sum' | 'avg' | 'min' | 'max'

export interface ReportAggregation {
  field: string // underscore-prefixed name will be the output column key
  fn: AggFn
}

export interface ReportSort {
  field: string
  dir: 'asc' | 'desc'
}

export interface ReportConfig {
  dataSource: DataSourceName
  columns: string[]
  filters?: ReportFilter[]
  groupBy?: string
  aggregations?: ReportAggregation[]
  sortBy?: ReportSort[]
  limit?: number
}

export interface ReportRunResult {
  rows: Record<string, unknown>[]
  /** Column metadata: derived from `columns` or, when groupBy/aggregations are used, from the agg spec. */
  columns: { key: string; label: string }[]
  total: number
  truncated: boolean
  dataSource: DataSourceName
  generatedAt: string
}

// ── Field whitelists ─────────────────────────────────────────────────
//
// These are the user-visible field names. Each entry is mapped to its
// Prisma column name (which is identical for now, but the indirection
// lets us rename columns without breaking saved reports).

interface FieldDef {
  /** Prisma field name on the model. */
  prisma: string
  /** Human-readable label (English; the UI will translate to TH via i18n if needed). */
  label: string
  /** Type — used to coerce filter values & to pick default filter op. */
  type: 'string' | 'number' | 'boolean' | 'date' | 'datetime'
}

const DEVICE_FIELDS: FieldDef[] = [
  { prisma: 'id', label: 'ID', type: 'string' },
  { prisma: 'assetCode', label: 'Asset Code', type: 'string' },
  { prisma: 'name', label: 'Name', type: 'string' },
  { prisma: 'brand', label: 'Brand', type: 'string' },
  { prisma: 'model', label: 'Model', type: 'string' },
  { prisma: 'type', label: 'Type', type: 'string' },
  { prisma: 'serialNumber', label: 'Serial Number', type: 'string' },
  { prisma: 'status', label: 'Status', type: 'string' },
  { prisma: 'site', label: 'Site', type: 'string' },
  { prisma: 'department', label: 'Department', type: 'string' },
  { prisma: 'departmentCode', label: 'Department Code', type: 'string' },
  { prisma: 'assetSiteCode', label: 'Asset Site Code', type: 'string' },
  { prisma: 'displayLabel', label: 'Display Label', type: 'string' },
  { prisma: 'location', label: 'Location', type: 'string' },
  { prisma: 'building', label: 'Building', type: 'string' },
  { prisma: 'floor', label: 'Floor', type: 'string' },
  { prisma: 'room', label: 'Room', type: 'string' },
  { prisma: 'purchaseDate', label: 'Purchase Date', type: 'date' },
  { prisma: 'purchasePrice', label: 'Purchase Price', type: 'number' },
  { prisma: 'salvageValue', label: 'Salvage Value', type: 'number' },
  { prisma: 'usefulLife', label: 'Useful Life', type: 'number' },
  { prisma: 'warrantyMonths', label: 'Warranty Months', type: 'number' },
  { prisma: 'warrantyEnd', label: 'Warranty End', type: 'date' },
  { prisma: 'vendor', label: 'Vendor', type: 'string' },
  { prisma: 'contractNo', label: 'Contract No', type: 'string' },
  { prisma: 'installDate', label: 'Install Date', type: 'date' },
  { prisma: 'uninstallDate', label: 'Uninstall Date', type: 'date' },
  { prisma: 'meterRequired', label: 'Meter Required', type: 'boolean' },
  { prisma: 'meterMode', label: 'Meter Mode', type: 'string' },
  { prisma: 'lastMeterBw', label: 'Last Meter BW', type: 'number' },
  { prisma: 'lastMeterColor', label: 'Last Meter Color', type: 'number' },
  { prisma: 'ip', label: 'IP Address', type: 'string' },
  { prisma: 'mac', label: 'MAC Address', type: 'string' },
  { prisma: 'currentAssignee', label: 'Current Assignee', type: 'string' },
  { prisma: 'remark', label: 'Remark', type: 'string' },
  { prisma: 'costCenter', label: 'Cost Center', type: 'string' },
  { prisma: 'deviceGroup', label: 'Device Group', type: 'string' },
  { prisma: 'createdAt', label: 'Created At', type: 'datetime' },
  { prisma: 'updatedAt', label: 'Updated At', type: 'datetime' },
  { prisma: 'updatedBy', label: 'Updated By', type: 'string' },
]

const WORKORDER_FIELDS: FieldDef[] = [
  { prisma: 'id', label: 'ID', type: 'string' },
  { prisma: 'woNumber', label: 'WO Number', type: 'string' },
  { prisma: 'legacyJobNo', label: 'Legacy Job No', type: 'string' },
  { prisma: 'systemJobNo', label: 'System Job No', type: 'string' },
  { prisma: 'requestId', label: 'Request ID', type: 'string' },
  { prisma: 'subject', label: 'Subject', type: 'string' },
  { prisma: 'building', label: 'Building', type: 'string' },
  { prisma: 'location', label: 'Location', type: 'string' },
  { prisma: 'details', label: 'Details', type: 'string' },
  { prisma: 'priority', label: 'Priority', type: 'string' },
  { prisma: 'reporterName', label: 'Reporter Name', type: 'string' },
  { prisma: 'reporterEmail', label: 'Reporter Email', type: 'string' },
  { prisma: 'tel', label: 'Phone', type: 'string' },
  { prisma: 'employeeCode', label: 'Employee Code', type: 'string' },
  { prisma: 'submissionSource', label: 'Submission Source', type: 'string' },
  { prisma: 'trackable', label: 'Trackable', type: 'boolean' },
  { prisma: 'status', label: 'Status', type: 'string' },
  { prisma: 'acceptStatus', label: 'Accept Status', type: 'string' },
  { prisma: 'assignedTo', label: 'Assigned To', type: 'string' },
  { prisma: 'assignedBy', label: 'Assigned By', type: 'string' },
  { prisma: 'assignmentNote', label: 'Assignment Note', type: 'string' },
  { prisma: 'resolution', label: 'Resolution', type: 'string' },
  { prisma: 'resolutionGroup', label: 'Resolution Group', type: 'string' },
  { prisma: 'deviceId', label: 'Device ID', type: 'string' },
  { prisma: 'siteCode', label: 'Site Code', type: 'string' },
  { prisma: 'isSpecialFee', label: 'Special Fee', type: 'boolean' },
  { prisma: 'createdAt', label: 'Created At', type: 'datetime' },
  { prisma: 'updatedAt', label: 'Updated At', type: 'datetime' },
  { prisma: 'assignedAt', label: 'Assigned At', type: 'datetime' },
  { prisma: 'workCompletedAt', label: 'Work Completed At', type: 'datetime' },
  { prisma: 'closedAt', label: 'Closed At', type: 'datetime' },
  { prisma: 'canceledAt', label: 'Canceled At', type: 'datetime' },
]

const METERREADING_FIELDS: FieldDef[] = [
  { prisma: 'id', label: 'ID', type: 'string' },
  { prisma: 'readingId', label: 'Reading ID', type: 'string' },
  { prisma: 'deviceId', label: 'Device ID', type: 'string' },
  { prisma: 'assetCode', label: 'Asset Code', type: 'string' },
  { prisma: 'readingDate', label: 'Reading Date', type: 'date' },
  { prisma: 'readingMonth', label: 'Reading Month', type: 'string' },
  { prisma: 'meterBw', label: 'Meter BW', type: 'number' },
  { prisma: 'meterColor', label: 'Meter Color', type: 'number' },
  { prisma: 'pagesBw', label: 'Pages BW', type: 'number' },
  { prisma: 'pagesColor', label: 'Pages Color', type: 'number' },
  { prisma: 'prevMeterBw', label: 'Prev Meter BW', type: 'number' },
  { prisma: 'prevMeterColor', label: 'Prev Meter Color', type: 'number' },
  { prisma: 'meterMode', label: 'Meter Mode', type: 'string' },
  { prisma: 'readingType', label: 'Reading Type', type: 'string' },
  { prisma: 'readBy', label: 'Read By', type: 'string' },
  { prisma: 'remark', label: 'Remark', type: 'string' },
  { prisma: 'locationAtReading', label: 'Location', type: 'string' },
  { prisma: 'siteAtReading', label: 'Site', type: 'string' },
  { prisma: 'buildingAtReading', label: 'Building', type: 'string' },
  { prisma: 'floorAtReading', label: 'Floor', type: 'string' },
  { prisma: 'departmentAtReading', label: 'Department', type: 'string' },
  { prisma: 'departmentCodeAtReading', label: 'Department Code', type: 'string' },
  { prisma: 'eventType', label: 'Event Type', type: 'string' },
  { prisma: 'createdAt', label: 'Created At', type: 'datetime' },
]

const STOCKITEM_FIELDS: FieldDef[] = [
  { prisma: 'id', label: 'ID', type: 'string' },
  { prisma: 'productCode', label: 'Product Code', type: 'string' },
  { prisma: 'productName', label: 'Product Name', type: 'string' },
  { prisma: 'category', label: 'Category', type: 'string' },
  { prisma: 'brand', label: 'Brand', type: 'string' },
  { prisma: 'model', label: 'Model', type: 'string' },
  { prisma: 'unit', label: 'Unit', type: 'string' },
  { prisma: 'quantity', label: 'Quantity', type: 'number' },
  { prisma: 'minQuantity', label: 'Min Quantity', type: 'number' },
  { prisma: 'maxQuantity', label: 'Max Quantity', type: 'number' },
  { prisma: 'unitCost', label: 'Unit Cost', type: 'number' },
  { prisma: 'totalValue', label: 'Total Value', type: 'number' },
  { prisma: 'location', label: 'Location', type: 'string' },
  { prisma: 'site', label: 'Site', type: 'string' },
  { prisma: 'compatibleDevices', label: 'Compatible Devices', type: 'string' },
  { prisma: 'remark', label: 'Remark', type: 'string' },
  { prisma: 'active', label: 'Active', type: 'boolean' },
  { prisma: 'lastUpdated', label: 'Last Updated', type: 'string' },
  { prisma: 'costType', label: 'Cost Type', type: 'string' },
  { prisma: 'costModel', label: 'Cost Model', type: 'string' },
  { prisma: 'yieldPerPage', label: 'Yield/Page', type: 'number' },
  { prisma: 'createdAt', label: 'Created At', type: 'datetime' },
  { prisma: 'updatedAt', label: 'Updated At', type: 'datetime' },
]

const FIELDS_BY_DATASOURCE: Record<DataSourceName, FieldDef[]> = {
  devices: DEVICE_FIELDS,
  workorders: WORKORDER_FIELDS,
  meterreadings: METERREADING_FIELDS,
  stockitems: STOCKITEM_FIELDS,
}

/** Returns the field-def for a (dataSource, fieldName) pair, or null if unknown. */
export function getFieldDef(dataSource: DataSourceName, fieldName: string): FieldDef | null {
  const fields = FIELDS_BY_DATASOURCE[dataSource]
  if (!fields) return null
  return fields.find((f) => f.prisma === fieldName) ?? null
}

/** Returns all whitelisted fields for a data source (used by the wizard UI). */
export function listFields(dataSource: DataSourceName): FieldDef[] {
  return FIELDS_BY_DATASOURCE[dataSource] ?? []
}

// ── Filter coercion ──────────────────────────────────────────────────

function coerceValue(field: FieldDef, raw: unknown): unknown {
  switch (field.type) {
    case 'number':
      if (Array.isArray(raw)) return raw.map((v) => Number(v)).filter((n) => !Number.isNaN(n))
      const n = Number(raw)
      return Number.isNaN(n) ? undefined : n
    case 'boolean':
      if (typeof raw === 'string') return raw === 'true' || raw === '1'
      return Boolean(raw)
    case 'date':
    case 'datetime':
      // Strings as-is (Prisma supports ISO date strings for DateTime fields).
      return typeof raw === 'string' ? raw : String(raw ?? '')
    case 'string':
    default:
      if (Array.isArray(raw)) return raw.map((v) => String(v))
      return String(raw ?? '')
  }
}

function buildFilterClause(field: FieldDef, op: FilterOp, rawValue: unknown): Record<string, unknown> | null {
  const value = coerceValue(field, rawValue)
  if (value === undefined) return null
  switch (op) {
    case 'eq':
      return { [field.prisma]: value }
    case 'neq':
      return { NOT: { [field.prisma]: value } }
    case 'gt':
      return { [field.prisma]: { gt: value } }
    case 'lt':
      return { [field.prisma]: { lt: value } }
    case 'contains':
      return { [field.prisma]: { contains: String(value) } }
    case 'in':
      if (!Array.isArray(value)) return null
      return { [field.prisma]: { in: value } }
    default:
      return null
  }
}

// ── Query builders ───────────────────────────────────────────────────

interface BuildWhereArgs {
  dataSource: DataSourceName
  filters?: ReportFilter[]
  user: DemoAwareUser
  ctx: AuthorizationContext
}

function buildWhereClause({ dataSource, filters, user, ctx }: BuildWhereArgs): Record<string, unknown> {
  const where: Record<string, unknown> = {}

  // 1. Demo filter — every data source has an isDemo column.
  Object.assign(where, demoFilter(user))

  // 2. Site scope filter. Each data source uses a different column for Site.
  //    For MeterReading we use `siteAtReading` (string snapshot column).
  //    For WorkOrder we use `siteCode`.
  //    For Device and StockItem we use `site`.
  switch (dataSource) {
    case 'devices':
      Object.assign(where, ctx.siteWhere('site'))
      break
    case 'stockitems':
      Object.assign(where, ctx.siteWhere('site'))
      break
    case 'workorders':
      Object.assign(where, ctx.siteWhere('siteCode'))
      break
    case 'meterreadings':
      Object.assign(where, ctx.siteWhere('siteAtReading'))
      break
  }

  // 3. User-supplied filters (validated against the whitelist).
  if (Array.isArray(filters) && filters.length > 0) {
    for (const f of filters) {
      const field = getFieldDef(dataSource, f.field)
      if (!field) continue // ignore unknown fields
      const clause = buildFilterClause(field, f.op, f.value)
      if (clause) {
        // Merge top-level clauses; nested clauses (NOT, gt/lt/contains/in) nest under the field key.
        for (const [k, v] of Object.entries(clause)) {
          if (k === 'NOT') {
            const existing = (where.NOT as Record<string, unknown>[]) ?? []
            existing.push(v as Record<string, unknown>)
            where.NOT = existing
          } else if (typeof v === 'object' && v !== null && !Array.isArray(v) && field.prisma in where) {
            // Already have a constraint on this field — merge with AND.
            const existing = where[field.prisma] as Record<string, unknown>
            const merged = { ...existing, ...(v as Record<string, unknown>) }
            where[field.prisma] = merged
          } else {
            where[field.prisma] = v
          }
        }
      }
    }
  }
  return where
}

// ── Aggregations ─────────────────────────────────────────────────────

interface GroupByResult {
  rows: Record<string, unknown>[]
  columns: { key: string; label: string }[]
}

async function runGroupedQuery(
  dataSource: DataSourceName,
  where: Record<string, unknown>,
  groupBy: string,
  aggregations: ReportAggregation[],
  sortBy: ReportSort[] | undefined,
  limit: number,
): Promise<GroupByResult> {
  const groupFieldDef = getFieldDef(dataSource, groupBy)
  if (!groupFieldDef) {
    throw new Error(`Invalid groupBy field: ${groupBy}`)
  }

  // Prisma `groupBy` requires every aggregation's field to be a real column.
  // We map aggregation specs onto Prisma's _count/_sum/_avg/_min/_max shape.
  type PrismaAggKey = '_count' | '_sum' | '_avg' | '_min' | '_max'
  const aggregationsMap: Partial<Record<PrismaAggKey, Record<string, true>>> = {}
  const aggOutputColumns: { key: string; label: string }[] = []
  for (const agg of aggregations) {
    if (agg.fn === 'count') {
      aggregationsMap._count = aggregationsMap._count ?? {}
      // For count, allow `*` (whole row count) — Prisma uses `_count: true`.
      if (agg.field === '*' || agg.field === '') {
        continue // _count: true is set at top level
      }
      const field = getFieldDef(dataSource, agg.field)
      if (!field) continue
      aggregationsMap._count[field.prisma] = true
      aggOutputColumns.push({
        key: `_count_${field.prisma}`,
        label: `Count of ${field.label}`,
      })
    } else {
      const field = getFieldDef(dataSource, agg.field)
      if (!field) continue
      const key = `_${agg.fn}` as PrismaAggKey
      aggregationsMap[key] = aggregationsMap[key] ?? {}
      aggregationsMap[key][field.prisma] = true
      aggOutputColumns.push({
        key: `_${agg.fn}_${field.prisma}`,
        label: `${agg.fn.toUpperCase()} of ${field.label}`,
      })
    }
  }

  const orderBy = (sortBy ?? []).map((s) => ({
    [s.field]: s.dir,
  }))

  const groupByArgs = {
    where,
    by: [groupFieldDef.prisma],
    ...(Object.keys(aggregationsMap).length > 0 ? aggregationsMap : { _count: true }),
    take: limit,
    orderBy: orderBy.length > 0 ? orderBy : undefined,
  }

  // NOTE on typing: Prisma declares `groupBy` with one overload per
  // (by, orderBy, _count, _sum, _avg, …) combination, so
  // `Parameters<typeof db.device.groupBy>[0]` collapses to ONE narrow overload
  // that the dynamically-built `groupByArgs` object can never satisfy. The
  // runtime contract is identical for all four models, so we accept a loosely
  // typed bag of args and forward it to Prisma; the results are immediately
  // flattened into `Record<string, unknown>` rows anyway.
  type GroupByArgs = Record<string, unknown>
  type GroupByFn = (args: GroupByArgs) => Promise<Record<string, unknown>[]>
  let groupByFn: GroupByFn
  switch (dataSource) {
    case 'devices':
      groupByFn = (a) => db.device.groupBy(a as never) as Promise<Record<string, unknown>[]>
      break
    case 'workorders':
      groupByFn = (a) => db.workOrder.groupBy(a as never) as Promise<Record<string, unknown>[]>
      break
    case 'meterreadings':
      groupByFn = (a) => db.meterReading.groupBy(a as never) as Promise<Record<string, unknown>[]>
      break
    case 'stockitems':
      groupByFn = (a) => db.stockItem.groupBy(a as never) as Promise<Record<string, unknown>[]>
      break
  }

  const rows = await groupByFn(groupByArgs)

  // Flatten the `{_count: {field: n}, _sum: {field: x}}` structure so the
  // output rows have a single-level key per column (CSV/PDF friendlier).
  const flatRows = rows.map((row) => {
    const flat: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        for (const [innerK, innerV] of Object.entries(v as Record<string, unknown>)) {
          flat[`${k}_${innerK}`] = innerV
        }
      } else {
        flat[k] = v
      }
    }
    return flat
  })

  const columns = [
    { key: groupFieldDef.prisma, label: groupFieldDef.label },
    ...aggOutputColumns,
  ]

  return { rows: flatRows, columns }
}

// ── Main runner ──────────────────────────────────────────────────────

export interface RunReportArgs {
  config: ReportConfig
  user: DemoAwareUser
  ctx: AuthorizationContext
  /** Override the limit (e.g. for preview). When omitted, uses config.limit (default 1000). */
  limitOverride?: number
}

const DEFAULT_LIMIT = 1000
const HARD_MAX_LIMIT = 5000

export async function runCustomReport({
  config,
  user,
  ctx,
  limitOverride,
}: RunReportArgs): Promise<ReportRunResult> {
  const fields = FIELDS_BY_DATASOURCE[config.dataSource]
  if (!fields) {
    throw new Error(`Unknown data source: ${config.dataSource}`)
  }

  // Validate columns against the whitelist.
  const safeColumns = (config.columns ?? []).filter(
    (col) => !!getFieldDef(config.dataSource, col),
  )
  if (safeColumns.length === 0 && !config.groupBy) {
    throw new Error('No valid columns selected')
  }

  // Compute limit (override for preview < config.limit < HARD_MAX_LIMIT).
  const limit = Math.min(
    Math.max(1, limitOverride ?? config.limit ?? DEFAULT_LIMIT),
    HARD_MAX_LIMIT,
  )

  // Build the where clause (demo + site + user filters).
  const where = buildWhereClause({
    dataSource: config.dataSource,
    filters: config.filters,
    user,
    ctx,
  })

  // Group-by + aggregations branch.
  const hasAggregations = Array.isArray(config.aggregations) && config.aggregations.length > 0
  if (config.groupBy && hasAggregations) {
    const grouped = await runGroupedQuery(
      config.dataSource,
      where,
      config.groupBy,
      config.aggregations!,
      config.sortBy,
      limit,
    )

    let total = grouped.rows.length
    // Try to get an accurate count for the total groups when not truncated.
    if (grouped.rows.length < limit) {
      total = grouped.rows.length
    }

    return {
      rows: grouped.rows,
      columns: grouped.columns,
      total,
      truncated: grouped.rows.length >= limit,
      dataSource: config.dataSource,
      generatedAt: new Date().toISOString(),
    }
  }

  // Default: flat findMany.
  const select: Record<string, boolean> = {}
  for (const col of safeColumns) select[col] = true

  // Order by
  const orderBy = (config.sortBy ?? [])
    .filter((s) => !!getFieldDef(config.dataSource, s.field))
    .map((s) => ({ [s.field]: s.dir }))

  type FindManyFn = (args: Record<string, unknown>) => Promise<Record<string, unknown>[]>
  type CountFn = (args: Record<string, unknown>) => Promise<number>

  let findMany: FindManyFn
  let countFn: CountFn

  switch (config.dataSource) {
    case 'devices':
      findMany = (a) => db.device.findMany(a as Parameters<typeof db.device.findMany>[0]) as Promise<Record<string, unknown>[]>
      countFn = (a) => db.device.count(a as Parameters<typeof db.device.count>[0])
      break
    case 'workorders':
      findMany = (a) => db.workOrder.findMany(a as Parameters<typeof db.workOrder.findMany>[0]) as Promise<Record<string, unknown>[]>
      countFn = (a) => db.workOrder.count(a as Parameters<typeof db.workOrder.count>[0])
      break
    case 'meterreadings':
      findMany = (a) => db.meterReading.findMany(a as Parameters<typeof db.meterReading.findMany>[0]) as Promise<Record<string, unknown>[]>
      countFn = (a) => db.meterReading.count(a as Parameters<typeof db.meterReading.count>[0])
      break
    case 'stockitems':
      findMany = (a) => db.stockItem.findMany(a as Parameters<typeof db.stockItem.findMany>[0]) as Promise<Record<string, unknown>[]>
      countFn = (a) => db.stockItem.count(a as Parameters<typeof db.stockItem.count>[0])
      break
  }

  const [rows, total] = await Promise.all([
    findMany({
      where,
      select: Object.keys(select).length > 0 ? select : undefined,
      orderBy: orderBy.length > 0 ? orderBy : undefined,
      take: limit,
    }),
    countFn({ where }),
  ])

  // Convert Decimal/Date values to plain JSON-friendly values for the response.
  const safeRows = rows.map((row) => serializeRow(row, fields))

  const columnsOut = safeColumns.map((col) => {
    const def = getFieldDef(config.dataSource, col)!
    return { key: def.prisma, label: def.label }
  })

  return {
    rows: safeRows,
    columns: columnsOut,
    total,
    truncated: rows.length >= limit && total > rows.length,
    dataSource: config.dataSource,
    generatedAt: new Date().toISOString(),
  }
}

// ── Serialization helpers ────────────────────────────────────────────

/**
 * Convert Prisma-specific types (Decimal, DateTime) into plain JSON values.
 * Without this, NextResponse.json throws when serializing Decimal objects.
 */
function serializeRow(
  row: Record<string, unknown>,
  fields: FieldDef[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const fieldByPrisma = new Map(fields.map((f) => [f.prisma, f]))
  for (const [key, value] of Object.entries(row)) {
    const def = fieldByPrisma.get(key)
    if (value === null || value === undefined) {
      out[key] = value
      continue
    }
    // Prisma Decimal objects expose .toString() and duck-type as { d, e, s }.
    if (def?.type === 'number' && typeof value === 'object' && 'toString' in (value as object)) {
      out[key] = Number((value as { toString(): string }).toString())
      continue
    }
    if (value instanceof Date) {
      out[key] = value.toISOString()
      continue
    }
    if (typeof value === 'object' && 'toString' in (value as object)) {
      // BigInt (count results) and similar — coerce to string.
      const s = String((value as { toString(): string }).toString())
      // Re-parse numbers when expected.
      out[key] = def?.type === 'number' ? Number(s) : s
      continue
    }
    out[key] = value
  }
  return out
}

// ── Validation ───────────────────────────────────────────────────────

/**
 * Parse + validate a config JSON string. Throws on malformed JSON or unknown
 * data source. Strips unknown fields from `columns` / `filters` / `sortBy`
 * so a malicious payload cannot crash Prisma's `select` clause.
 */
export function parseConfig(raw: string): ReportConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Config is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Config must be a JSON object')
  }
  const obj = parsed as Record<string, unknown>
  const dataSource = String(obj.dataSource ?? '') as DataSourceName
  if (!FIELDS_BY_DATASOURCE[dataSource]) {
    throw new Error(`Unknown data source: ${dataSource}`)
  }
  const columns = Array.isArray(obj.columns)
    ? (obj.columns as unknown[]).filter((c): c is string => typeof c === 'string')
    : []
  const filters = Array.isArray(obj.filters)
    ? (obj.filters as unknown[])
        .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
        .map((f) => ({
          field: String(f.field ?? ''),
          op: (String(f.op ?? 'eq') as FilterOp),
          value: f.value,
        }))
        .filter((f) => !!getFieldDef(dataSource, f.field))
    : []
  const aggregations = Array.isArray(obj.aggregations)
    ? (obj.aggregations as unknown[])
        .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
        .map((a) => ({
          field: String(a.field ?? ''),
          fn: (String(a.fn ?? 'count') as AggFn),
        }))
    : []
  const sortBy = Array.isArray(obj.sortBy)
    ? (obj.sortBy as unknown[])
        .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
        .map((s) => ({
          field: String(s.field ?? ''),
          dir: (String(s.dir ?? 'asc') === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc',
        }))
    : []
  const groupBy = typeof obj.groupBy === 'string' ? obj.groupBy : undefined
  const limit =
    typeof obj.limit === 'number' && Number.isFinite(obj.limit) && obj.limit > 0
      ? Math.min(Math.floor(obj.limit), HARD_MAX_LIMIT)
      : undefined

  return {
    dataSource,
    columns: columns.filter((c) => !!getFieldDef(dataSource, c)),
    filters,
    groupBy: groupBy && getFieldDef(dataSource, groupBy) ? groupBy : undefined,
    aggregations,
    sortBy: sortBy.filter((s) => !!getFieldDef(dataSource, s.field)),
    limit,
  }
}
