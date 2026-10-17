// ============================================================
// Repair Data Contract — typed, preview-only legacy mapping
// ============================================================
// This module maps legacy source rows into explicit domain semantics.
// It does not resolve database foreign keys and does not write data.
// Apps Script/source headers remain unchanged; adaptation lives here.
// ============================================================

import { FIELD_MAPPINGS, STATUS_MAPPINGS, normalizeKey } from '@/lib/csv-field-mapping'
import { mapSourceRecord, type SyncSourceRecord } from '@/lib/sync-adapter'

export type RepairSourceSystem = 'services' | 'it-asset-management' | 'stock'

export interface SourceIdentity {
  sourceSystem: RepairSourceSystem
  sourceEntity: string
  sourceRecordId: string
  sourceLineId?: string
  sourceKey: string
}

export interface MappingResult<T> {
  identity: SourceIdentity | null
  mapped: T
  warnings: string[]
  unmapped: string[]
  quarantineReason?: string
}

export interface CanonicalWorkOrderMapping {
  requestId?: string
  legacyJobNo?: string
  subject?: string
  status?: string
  building?: string
  location?: string
  details?: string
  priority?: string
  reporterName?: string
  reporterEmail?: string
  tel?: string
  employeeCode?: string
  submissionSource?: string
  externalMeta?: string
  siteCode?: string
}

export interface CanonicalMaterialIssueMapping {
  issueNo?: string
  lineNo?: string
  txnDate?: string
  stockItemSourceCode?: string
  productName?: string
  quantity?: number
  unit?: string
  requester?: string
  department?: string
  purpose?: string
  approver?: string
  approvedAt?: string
  processedFlag?: string
  rejectionReason?: string
  workOrderLegacyNo?: string
  sourceKey?: string
}

const WORK_ORDER_IDENTITY_KEYS = new Set([
  'id',
  'requestid',
  'sourcerecordid',
  'sourcerecord',
  'sourceid',
  'sourcekey',
  'legacyjobno',
  'legacyjobnumber',
  'jobno',
  'jobnumber',
  'เลขที่งาน',
  'เลขงาน',
  'หมายเลขงาน',
  'site',
  'sitecode',
])

const STOCK_OUT_KNOWN_KEYS = new Set([
  ...Object.keys(FIELD_MAPPINGS.stockOut).map(normalizeKey),
  'sourcekey',
  'sourcerecordid',
  'sourcelineid',
  'legacyjobno',
  'legacyjobnumber',
  'jobno',
  'jobnumber',
  'เลขที่งาน',
  'เลขงาน',
  'หมายเลขงาน',
])

function valueAt(record: SyncSourceRecord, aliases: string[]): unknown {
  const entries = Object.entries(record)
  for (const alias of aliases) {
    const exact = record[alias]
    if (exact !== undefined && exact !== null && String(exact).trim() !== '') return exact

    const normalizedAlias = normalizeKey(alias)
    const match = entries.find(([key, value]) => (
      normalizeKey(key) === normalizedAlias && value !== undefined && value !== null && String(value).trim() !== ''
    ))
    if (match) return match[1]
  }
  return undefined
}

function textAt(record: SyncSourceRecord, aliases: string[]): string | undefined {
  const value = valueAt(record, aliases)
  if (value === undefined) return undefined
  const text = String(value).trim()
  return text || undefined
}

function numberAt(record: SyncSourceRecord, aliases: string[]): number | undefined {
  const value = valueAt(record, aliases)
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : undefined
}

function unknownKeys(record: SyncSourceRecord, knownKeys: Set<string>): string[] {
  return Object.keys(record).filter((key) => !knownKeys.has(normalizeKey(key)))
}

function identityFor(
  record: SyncSourceRecord,
  sourceSystem: RepairSourceSystem,
  sourceEntity: string,
  recordAliases: string[],
  lineAliases: string[] = [],
): SourceIdentity | null {
  const sourceRecordId = textAt(record, recordAliases)
  if (!sourceRecordId) return null

  const sourceLineId = textAt(record, lineAliases)
  const sourceKeyFromRow = textAt(record, ['source_key', 'sourceKey', 'source_record_key'])
  const sourceKey = sourceKeyFromRow
    ? `${sourceSystem}:${sourceEntity}:${sourceKeyFromRow}`
    : `${sourceSystem}:${sourceEntity}:${sourceRecordId}${sourceLineId ? `:${sourceLineId}` : ''}`

  return { sourceSystem, sourceEntity, sourceRecordId, sourceLineId, sourceKey }
}

/**
 * Maps one legacy Services WorkOrder row without assigning a system job number.
 * `id`/`request_id` are source identity and dedup values, not legacy job numbers.
 */
export function mapLegacyWorkOrderRecord(record: SyncSourceRecord): MappingResult<CanonicalWorkOrderMapping> {
  const { mapped: legacyMapped, unmapped: legacyUnmapped } = mapSourceRecord(record)
  const identity = identityFor(record, 'services', 'work_order', [
    'source_record_id',
    'sourceRecordId',
    'id',
    'request_id',
  ])
  const legacyJobNo = textAt(record, [
    'legacy_job_no',
    'legacyJobNo',
    'legacy_job_number',
    'job_no',
    'jobNo',
    'job_number',
    'jobNumber',
    'เลขที่งาน',
    'เลขงาน',
    'หมายเลขงาน',
  ])
  const requestId = textAt(record, ['request_id', 'requestId', 'id'])
  const warnings: string[] = []

  if (!identity) warnings.push('Missing source record identity')
  if (!legacyJobNo) warnings.push('No explicit legacy job number; source identity is retained without inventing one')
  if (!requestId) warnings.push('Missing requestId; apply must not create a WorkOrder')

  const mapped: CanonicalWorkOrderMapping = {
    requestId,
    legacyJobNo,
    subject: typeof legacyMapped.subject === 'string' ? legacyMapped.subject : textAt(record, ['subject']),
    status: typeof legacyMapped.status === 'string'
      ? (STATUS_MAPPINGS.workOrder[legacyMapped.status] || legacyMapped.status)
      : undefined,
    building: textAt(record, ['building']),
    location: textAt(record, ['location']),
    details: textAt(record, ['details']),
    priority: textAt(record, ['priority']),
    reporterName: textAt(record, ['reporter_name', 'reporterName']),
    reporterEmail: textAt(record, ['reporter_email', 'reporterEmail']),
    tel: textAt(record, ['tel', 'phone']),
    employeeCode: textAt(record, ['employee_code', 'employeeCode']),
    submissionSource: textAt(record, ['submission_source', 'submissionSource']),
    externalMeta: textAt(record, ['external_meta', 'externalMeta']),
    siteCode: textAt(record, ['siteCode', 'site']),
  }

  const quarantineReason = !identity
    ? 'MISSING_SOURCE_IDENTITY'
    : !requestId
      ? 'MISSING_REQUEST_ID'
      : undefined

  return {
    identity,
    mapped,
    warnings,
    unmapped: legacyUnmapped.filter((key) => !WORK_ORDER_IDENTITY_KEYS.has(normalizeKey(key))),
    quarantineReason,
  }
}

/**
 * Maps one StockOut row into a material issue line.
 * Requester, department, purpose and approver intentionally remain separate.
 * Foreign-key resolution to StockItem/WorkOrder happens in a later phase.
 */
export function mapLegacyStockOutRecord(record: SyncSourceRecord): MappingResult<CanonicalMaterialIssueMapping> {
  const issueNo = textAt(record, ['IssueNo', 'issue_no', 'issueNo'])
  const lineNo = textAt(record, ['line_no', 'lineNo'])
  const identity = identityFor(record, 'stock', 'stock_out', [
    'source_record_id',
    'sourceRecordId',
    'source_key',
    'sourceKey',
    'IssueNo',
    'issue_no',
    'issueNo',
  ], ['line_no', 'lineNo', 'source_line_id', 'sourceLineId'])
  const quantityRaw = valueAt(record, ['Quantity', 'quantity'])
  const quantity = numberAt(record, ['Quantity', 'quantity'])
  const warnings: string[] = []

  if (!identity) warnings.push('Missing source issue identity')
  if (quantityRaw !== undefined && quantity === undefined) warnings.push('Quantity is not numeric')
  if (quantity !== undefined && quantity <= 0) warnings.push('Quantity must be greater than zero for an issue line')

  const mapped: CanonicalMaterialIssueMapping = {
    issueNo,
    lineNo,
    txnDate: textAt(record, ['Date', 'date', 'txn_date', 'txnDate']),
    stockItemSourceCode: textAt(record, ['ProductCode', 'product_code', 'productCode']),
    productName: textAt(record, ['ProductName', 'product_name', 'productName']),
    quantity,
    unit: textAt(record, ['Unit', 'unit']),
    requester: textAt(record, ['Requester', 'requester']),
    department: textAt(record, ['Department', 'department']),
    purpose: textAt(record, ['Purpose', 'purpose']),
    approver: textAt(record, ['Approver', 'approver']),
    approvedAt: textAt(record, ['ApprovedAt', 'approved_at', 'approvedAt']),
    processedFlag: textAt(record, ['processed_flag', 'processedFlag']),
    rejectionReason: textAt(record, ['reason_reject', 'reasonReject', 'rejectionReason']),
    workOrderLegacyNo: textAt(record, [
      'WorkOrderNo',
      'work_order_no',
      'workOrderNo',
      'legacy_job_no',
      'legacyJobNo',
      'job_no',
      'jobNo',
      'เลขที่งาน',
      'เลขงาน',
      'หมายเลขงาน',
    ]),
    sourceKey: identity?.sourceKey,
  }

  const quarantineReason = !identity
    ? 'MISSING_SOURCE_IDENTITY'
    : quantity === undefined
      ? 'INVALID_QUANTITY'
      : quantity <= 0
        ? 'NON_POSITIVE_QUANTITY'
        : !mapped.stockItemSourceCode
          ? 'MISSING_PRODUCT_CODE'
          : undefined

  return {
    identity,
    mapped,
    warnings,
    unmapped: unknownKeys(record, STOCK_OUT_KNOWN_KEYS),
    quarantineReason,
  }
}
