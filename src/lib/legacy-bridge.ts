// ============================================================
// Legacy Bridge — canonical intake normalization for coexistence
// ============================================================
// The legacy Apps Script applications remain operational during cutover.
// This module converts their records into ITAM-DB canonical payloads without
// writing business tables. The output is intentionally preview/apply-safe:
// malformed rows are quarantined, identities remain traceable, and repeated
// pulls produce the same external key.
// ============================================================

import { STATUS_MAPPINGS } from '@/lib/csv-field-mapping'

export type LegacyBridgeModule =
  | 'device'
  | 'work-order'
  | 'meter-reading'
  | 'stock-item'
  | 'stock-transaction'

export interface LegacySourceRecord {
  [key: string]: unknown
}

export interface BridgeEnvelope {
  module: LegacyBridgeModule
  source: string
  externalKey: string
  payload: Record<string, unknown>
  sourceRecord: LegacySourceRecord
  unmappedColumns: string[]
}

export interface BridgeQuarantine {
  module: LegacyBridgeModule
  source: string
  externalKey: string
  reasons: string[]
  sourceRecord: LegacySourceRecord
  unmappedColumns: string[]
}

export interface LegacyBridgeResult {
  ready: BridgeEnvelope[]
  quarantine: BridgeQuarantine[]
  unmappedColumns: string[]
  duplicateKeys: string[]
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_\-./()[\]{}:]+/g, '')
}

function indexRecord(record: LegacySourceRecord): Map<string, unknown> {
  const indexed = new Map<string, unknown>()
  for (const [key, value] of Object.entries(record)) {
    indexed.set(normalizeKey(key), value)
  }
  return indexed
}

function firstValue(indexed: Map<string, unknown>, aliases: string[]): unknown {
  for (const alias of aliases) {
    const value = indexed.get(normalizeKey(alias))
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

function asString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

function asInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value)
  if (typeof value !== 'string') return fallback
  const parsed = Number(value.replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback
}

function asNullableInt(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return null
  const parsed = asInt(value, Number.NaN)
  return Number.isFinite(parsed) ? parsed : null
}

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  const text = asString(value)?.toLowerCase()
  if (!text) return fallback
  return ['true', '1', 'yes', 'y', 'ใช่', 'มี'].includes(text)
}

function putIfPresent(
  payload: Record<string, unknown>,
  target: string,
  indexed: Map<string, unknown>,
  aliases: string[],
  transform: (value: unknown) => unknown = asString,
): void {
  const value = firstValue(indexed, aliases)
  if (value !== undefined && value !== null && String(value).trim() !== '') {
    payload[target] = transform(value)
  }
}

function sourceKeyFrom(
  module: LegacyBridgeModule,
  indexed: Map<string, unknown>,
  payload: Record<string, unknown>,
): string {
  const explicit = asString(firstValue(indexed, [
    'sourceKey', 'source_key', 'rowId', 'row_id', 'recordId', 'record_id',
    'id', 'eventId', 'event_id', 'readingId', 'reading_id', 'txnNumber',
    'txn_number', 'Txn_ID', 'Item_ID',
  ]))
  if (explicit) return explicit

  switch (module) {
    case 'device':
      return `device:${String(payload.assetCode || '')}`
    case 'work-order':
      return String(payload.requestId || payload.legacyJobNo || '')
    case 'meter-reading':
      return [
        'meter', payload.assetCode, payload.readingDate, payload.readingType,
        payload.meterBw, payload.meterColor,
      ].map((part) => String(part ?? '')).join(':')
    case 'stock-item':
      return `stock-item:${String(payload.productCode || '')}`
    case 'stock-transaction':
      return [
        'stock-txn', payload.productCode, payload.txnDate, payload.type,
        payload.quantity, payload.workOrderNo, payload.requester,
      ].map((part) => String(part ?? '')).join(':')
  }
}

function unknownColumns(
  indexed: Map<string, unknown>,
  consumed: Set<string>,
): string[] {
  const result: string[] = []
  for (const key of indexed.keys()) {
    if (!consumed.has(key)) result.push(key)
  }
  return result
}

function consume(consumed: Set<string>, aliases: string[]): void {
  for (const alias of aliases) consumed.add(normalizeKey(alias))
}

function adaptDevice(record: LegacySourceRecord): { payload: Record<string, unknown>; required: string[]; consumed: Set<string> } {
  const indexed = indexRecord(record)
  const consumed = new Set<string>()
  const payload: Record<string, unknown> = {}
  const textFields: Array<[string, string[]]> = [
    ['assetCode', ['assetCode', 'assetNo', 'asset_no', 'Asset_No', 'รหัสทรัพย์สิน']],
    ['serialNumber', ['serialNumber', 'serial', 'serial_no', 'Serial_Number', 'Serial']],
    ['name', ['name', 'deviceName', 'device_name', 'ชื่ออุปกรณ์']],
    ['brand', ['brand', 'ยี่ห้อ']],
    ['model', ['model', 'รุ่น']],
    ['type', ['type', 'deviceType', 'device_type', 'ประเภท']],
    ['status', ['status', 'สถานะ']],
    ['site', ['site', 'siteCode', 'site_code', 'สาขา']],
    ['department', ['department', 'departmentName', 'หน่วยงาน']],
    ['departmentCode', ['departmentCode', 'department_code']],
    ['location', ['location', 'สถานที่']],
    ['building', ['building', 'อาคาร']],
    ['floor', ['floor', 'ชั้น']],
    ['room', ['room', 'ห้อง']],
    ['purchaseDate', ['purchaseDate', 'purchase_date', 'วันที่ซื้อ']],
    ['warrantyEnd', ['warrantyEnd', 'warranty_end']],
    ['remark', ['remark', 'หมายเหตุ']],
  ]
  for (const [target, aliases] of textFields) {
    putIfPresent(payload, target, indexed, aliases)
    consume(consumed, aliases)
  }
  putIfPresent(payload, 'warrantyMonths', indexed, ['warrantyMonths', 'warranty_months'], (v) => asInt(v, 12))
  consume(consumed, ['warrantyMonths', 'warranty_months'])
  putIfPresent(payload, 'meterRequired', indexed, ['meterRequired', 'meter_required'], (v) => asBool(v))
  consume(consumed, ['meterRequired', 'meter_required'])
  putIfPresent(payload, 'meterMode', indexed, ['meterMode', 'meter_mode'])
  consume(consumed, ['meterMode', 'meter_mode'])

  return {
    payload,
    required: ['assetCode', 'serialNumber', 'name', 'brand', 'model', 'type', 'site'],
    consumed,
  }
}

function adaptWorkOrder(record: LegacySourceRecord): { payload: Record<string, unknown>; required: string[]; consumed: Set<string> } {
  const indexed = indexRecord(record)
  const consumed = new Set<string>()
  const payload: Record<string, unknown> = {}
  const textFields: Array<[string, string[]]> = [
    ['requestId', ['requestId', 'request_id', 'Request_ID', 'ticketId', 'ticket_id']],
    ['legacyJobNo', ['legacyJobNo', 'legacy_job_no', 'jobNo', 'job_no', 'Job_No', 'เลขที่งาน']],
    ['subject', ['subject', 'issue', 'problem', 'ประเภทปัญหา', 'หัวข้อ']],
    ['siteCode', ['siteCode', 'site_code', 'site', 'สาขา']],
    ['building', ['building', 'อาคาร']],
    ['location', ['location', 'สถานที่']],
    ['details', ['details', 'description', 'รายละเอียด']],
    ['priority', ['priority', 'ความเร่งด่วน']],
    ['reporterName', ['reporterName', 'reporter_name', 'requester', 'ชื่อผู้แจ้ง']],
    ['reporterEmail', ['reporterEmail', 'reporter_email', 'email']],
    ['tel', ['tel', 'telephone', 'phone', 'เบอร์โทร']],
    ['status', ['status', 'สถานะ']],
    ['deviceId', ['deviceId', 'device_id', 'assetCode', 'asset_no']],
  ]
  for (const [target, aliases] of textFields) {
    putIfPresent(payload, target, indexed, aliases)
    consume(consumed, aliases)
  }
  if (!payload.requestId && payload.legacyJobNo) payload.requestId = payload.legacyJobNo
  if (!payload.status) payload.status = 'PENDING'
  // Apply legacy status mapping (Thai text with emoji → enum)
  if (typeof payload.status === 'string' && STATUS_MAPPINGS.workOrder[payload.status]) {
    payload.status = STATUS_MAPPINGS.workOrder[payload.status]
  }
  if (!payload.priority) payload.priority = 'ปกติ'

  return { payload, required: ['requestId', 'subject', 'siteCode'], consumed }
}

function adaptMeterReading(record: LegacySourceRecord): { payload: Record<string, unknown>; required: string[]; consumed: Set<string> } {
  const indexed = indexRecord(record)
  const consumed = new Set<string>()
  const payload: Record<string, unknown> = {}
  const textFields: Array<[string, string[]]> = [
    ['readingId', ['readingId', 'reading_id', 'meterReadingId', 'eventId', 'event_id']],
    ['assetCode', ['assetCode', 'assetNo', 'asset_no', 'Asset_No', 'deviceAssetCode']],
    ['readingDate', ['readingDate', 'reading_date', 'date', 'วันที่จด']],
    ['readingMonth', ['readingMonth', 'reading_month', 'month', 'เดือน']],
    ['readingType', ['readingType', 'reading_type', 'type']],
    ['readBy', ['readBy', 'read_by', 'reader', 'ผู้จด']],
    ['remark', ['remark', 'หมายเหตุ']],
    ['eventType', ['eventType', 'event_type']],
    ['eventId', ['eventId', 'event_id']],
    ['siteAtReading', ['siteAtReading', 'site_at_reading', 'siteCode', 'site_code', 'site', 'สาขา']],
  ]
  for (const [target, aliases] of textFields) {
    putIfPresent(payload, target, indexed, aliases)
    consume(consumed, aliases)
  }
  putIfPresent(payload, 'meterBw', indexed, ['meterBw', 'meter_bw', 'reading', 'meterReading', 'blackWhite'], (v) => asInt(v))
  consume(consumed, ['meterBw', 'meter_bw', 'reading', 'meterReading', 'blackWhite'])
  putIfPresent(payload, 'meterColor', indexed, ['meterColor', 'meter_color', 'colorReading'], (v) => asInt(v))
  consume(consumed, ['meterColor', 'meter_color', 'colorReading'])
  putIfPresent(payload, 'prevMeterBw', indexed, ['prevMeterBw', 'prev_meter_bw', 'prevReading'], (v) => asInt(v))
  consume(consumed, ['prevMeterBw', 'prev_meter_bw', 'prevReading'])
  putIfPresent(payload, 'prevMeterColor', indexed, ['prevMeterColor', 'prev_meter_color'], (v) => asInt(v))
  consume(consumed, ['prevMeterColor', 'prev_meter_color'])
  payload.pagesBw = Math.max(0, asInt(payload.meterBw) - asInt(payload.prevMeterBw))
  payload.pagesColor = Math.max(0, asInt(payload.meterColor) - asInt(payload.prevMeterColor))

  return { payload, required: ['assetCode', 'readingDate'], consumed }
}

function adaptStockItem(record: LegacySourceRecord): { payload: Record<string, unknown>; required: string[]; consumed: Set<string> } {
  const indexed = indexRecord(record)
  const consumed = new Set<string>()
  const payload: Record<string, unknown> = {}
  const textFields: Array<[string, string[]]> = [
    ['productCode', ['productCode', 'product_code', 'itemId', 'item_id', 'Item_ID', 'รหัสสินค้า']],
    ['productName', ['productName', 'product_name', 'name', 'รายการ', 'ชื่อสินค้า']],
    ['category', ['category', 'หมวดหมู่']],
    ['brand', ['brand', 'ยี่ห้อ']],
    ['model', ['model', 'รุ่น']],
    ['unit', ['unit', 'หน่วย']],
    ['location', ['location', 'สถานที่เก็บ']],
    ['site', ['site', 'siteCode', 'site_code', 'สาขา']],
    ['compatibleDevices', ['compatibleDevices', 'compatible_devices']],
    ['remark', ['remark', 'หมายเหตุ']],
    ['lastUpdated', ['lastUpdated', 'last_updated']],
  ]
  for (const [target, aliases] of textFields) {
    putIfPresent(payload, target, indexed, aliases)
    consume(consumed, aliases)
  }
  const intFields: Array<[string, string[]]> = [
    ['quantity', ['quantity', 'qty', 'จำนวน']],
    ['minQuantity', ['minQuantity', 'min_quantity', 'minimum']],
    ['maxQuantity', ['maxQuantity', 'max_quantity', 'maximum']],
  ]
  for (const [target, aliases] of intFields) {
    putIfPresent(payload, target, indexed, aliases, (v) => asInt(v))
    consume(consumed, aliases)
  }
  putIfPresent(payload, 'unitCost', indexed, ['unitCost', 'unit_cost', 'ราคา'], asNullableInt)
  consume(consumed, ['unitCost', 'unit_cost', 'ราคา'])
  putIfPresent(payload, 'active', indexed, ['active', 'isActive', 'สถานะใช้งาน'], (v) => asBool(v, true))
  consume(consumed, ['active', 'isActive', 'สถานะใช้งาน'])

  return { payload, required: ['productCode', 'productName'], consumed }
}

function adaptStockTransaction(record: LegacySourceRecord): { payload: Record<string, unknown>; required: string[]; consumed: Set<string> } {
  const indexed = indexRecord(record)
  const consumed = new Set<string>()
  const payload: Record<string, unknown> = {}
  const textFields: Array<[string, string[]]> = [
    ['sourceKey', ['sourceKey', 'source_key', 'rowId', 'row_id', 'Txn_ID', 'txnNumber', 'txn_number']],
    ['productCode', ['productCode', 'product_code', 'itemId', 'item_id', 'Item_ID', 'รหัสสินค้า']],
    ['productName', ['productName', 'product_name', 'name', 'รายการ', 'ชื่อสินค้า']],
    ['type', ['type', 'transactionType', 'transaction_type', 'ประเภท']],
    ['unit', ['unit', 'หน่วย']],
    ['reason', ['reason', 'เหตุผล']],
    ['requester', ['requester', 'ผู้เบิก']],
    ['department', ['department', 'หน่วยงาน']],
    ['purpose', ['purpose', 'วัตถุประสงค์']],
    ['approver', ['approver', 'ผู้อนุมัติ']],
    ['approvedAt', ['approvedAt', 'approved_at', 'วันที่อนุมัติ']],
    ['workOrderNo', ['workOrderNo', 'work_order_no', 'legacyJobNo', 'legacy_job_no', 'jobNo']],
    ['deviceId', ['deviceId', 'device_id', 'assetCode', 'asset_no']],
    ['txnDate', ['txnDate', 'txn_date', 'date', 'วันที่']],
    ['performedBy', ['performedBy', 'performed_by', 'ผู้ทำรายการ']],
    ['remark', ['remark', 'หมายเหตุ']],
    ['approvalStatus', ['approvalStatus', 'approval_status']],
    ['processedFlag', ['processedFlag', 'processed_flag']],
  ]
  for (const [target, aliases] of textFields) {
    putIfPresent(payload, target, indexed, aliases)
    consume(consumed, aliases)
  }
  putIfPresent(payload, 'quantity', indexed, ['quantity', 'qty', 'จำนวน'], (v) => asInt(v))
  consume(consumed, ['quantity', 'qty', 'จำนวน'])
  putIfPresent(payload, 'unitCost', indexed, ['unitCost', 'unit_cost', 'ราคา/หน่วย'], asNullableInt)
  consume(consumed, ['unitCost', 'unit_cost', 'ราคา/หน่วย'])
  putIfPresent(payload, 'cost', indexed, ['cost', 'totalCost', 'total_cost', 'มูลค่า'], asNullableInt)
  consume(consumed, ['cost', 'totalCost', 'total_cost', 'มูลค่า'])

  const rawType = String(payload.type || '').toUpperCase()
  if (['รับเข้า', 'รับ', 'IN'].includes(rawType)) payload.type = 'IN'
  else if (['เบิกออก', 'เบิก', 'จ่าย', 'OUT'].includes(rawType)) payload.type = 'OUT'
  else if (['ปรับปรุง', 'ปรับยอด', 'ADJUST'].includes(rawType)) payload.type = 'ADJUST'

  return { payload, required: ['productCode', 'type', 'quantity', 'txnDate'], consumed }
}

function adaptRecord(module: LegacyBridgeModule, record: LegacySourceRecord): { payload: Record<string, unknown>; required: string[]; consumed: Set<string> } {
  switch (module) {
    case 'device': return adaptDevice(record)
    case 'work-order': return adaptWorkOrder(record)
    case 'meter-reading': return adaptMeterReading(record)
    case 'stock-item': return adaptStockItem(record)
    case 'stock-transaction': return adaptStockTransaction(record)
  }
}

export function adaptLegacyRecords(
  source: string,
  module: LegacyBridgeModule,
  records: LegacySourceRecord[],
): LegacyBridgeResult {
  const ready: BridgeEnvelope[] = []
  const quarantine: BridgeQuarantine[] = []
  const seen = new Set<string>()
  const duplicateKeys = new Set<string>()
  const allUnmapped = new Set<string>()

  for (const record of records) {
    const { payload, required, consumed } = adaptRecord(module, record)
    const externalKey = sourceKeyFrom(module, indexRecord(record), payload)
    const unmapped = unknownColumns(indexRecord(record), consumed)
    for (const column of unmapped) allUnmapped.add(column)
    const reasons: string[] = []

    for (const field of required) {
      const value = payload[field]
      if (value === undefined || value === null || String(value).trim() === '') {
        reasons.push(`MISSING_${field.toUpperCase()}`)
      }
    }
    if (module === 'device') {
      const asset = payload.assetCode
      const serial = payload.serialNumber
      if ((asset && !serial) || (!asset && serial)) reasons.push('ASSET_SERIAL_MUST_BE_PAIRED')
    }
    if (module === 'stock-transaction') {
      const type = String(payload.type || '')
      if (!['IN', 'OUT', 'ADJUST'].includes(type)) reasons.push('INVALID_TRANSACTION_TYPE')
      if (typeof payload.quantity !== 'number' || (payload.quantity as number) <= 0) reasons.push('QUANTITY_MUST_BE_POSITIVE')
    }
    if (!externalKey || externalKey.endsWith(':')) reasons.push('MISSING_STABLE_EXTERNAL_KEY')
    if (seen.has(externalKey)) {
      duplicateKeys.add(externalKey)
      reasons.push('DUPLICATE_SOURCE_KEY')
    }
    seen.add(externalKey)

    if (reasons.length > 0) {
      quarantine.push({ module, source, externalKey: externalKey || '(unknown)', reasons, sourceRecord: record, unmappedColumns: unmapped })
    } else {
      ready.push({ module, source, externalKey, payload, sourceRecord: record, unmappedColumns: unmapped })
    }
  }

  return { ready, quarantine, unmappedColumns: [...allUnmapped].sort(), duplicateKeys: [...duplicateKeys].sort() }
}

export function isLegacyBridgeModule(value: unknown): value is LegacyBridgeModule {
  return value === 'device' || value === 'work-order' || value === 'meter-reading' || value === 'stock-item' || value === 'stock-transaction'
}
