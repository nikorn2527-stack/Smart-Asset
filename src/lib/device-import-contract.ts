import { parseCsv } from '@/lib/csv'

export const DEVICE_IMPORT_FIELDS = [
  'name', // CONSULTING-007: added so contract is a true superset of /api/import importDevices columns
  'deviceType',
  'brand',
  'model',
  'serial',
  'status',
  'site',
  'building',
  'floor',
  'department',
  'departmentCode',
  'location',
  'deviceGroup',
  'costCenter',
  'contractNo',
  'vendor',
  'ip',
  'mac',
  'remoteId',
  'installDate',
  'warrantyEnd',
  'warrantyMonths', // CONSULTING-007: added so contract is a true superset of /api/import importDevices columns
  'meterRequired',
  'meterMode',
  'assetSiteCode',
  'remark',
] as const

export type DeviceImportField = typeof DEVICE_IMPORT_FIELDS[number]

export interface DeviceImportValues {
  assetNo: string
  name: string | null // CONSULTING-007: explicit name field (was derived from deviceType before)
  deviceType: string | null
  brand: string | null
  model: string | null
  serial: string | null
  status: string | null
  site: string | null
  building: string | null
  floor: string | null
  department: string | null
  departmentCode: string | null
  location: string | null
  deviceGroup: string | null
  costCenter: string | null
  contractNo: string | null
  vendor: string | null
  ip: string | null
  mac: string | null
  remoteId: string | null
  installDate: string | null
  warrantyEnd: string | null
  warrantyMonths: number | null // CONSULTING-007: added (Int, not string) to match /api/import
  meterRequired: boolean | null
  meterMode: string | null
  assetSiteCode: string | null
  remark: string | null
}

export interface DeviceImportRow {
  rowNumber: number
  values: DeviceImportValues
}

export interface DeviceImportError {
  rowNumber: number
  field?: string
  message: string
}

export interface DeviceImportParseResult {
  rows: DeviceImportRow[]
  errors: DeviceImportError[]
  headers: string[]
}

export interface DeviceImportValidationResult {
  validRows: DeviceImportRow[]
  errors: DeviceImportError[]
}

const HEADER_ALIASES: Record<string, string[]> = {
  assetNo: ['assetno', 'asset_no', 'รหัสสินทรัพย์', 'รหัส', 'assetcode'],
  // CONSULTING-007: name alias added so contract is a true superset of /api/import.
  // Legacy /api/import required `name`; contract previously derived it from
  // deviceType as a fallback. We now accept it explicitly.
  name: ['name', 'ชื่อ', 'ชื่ออุปกรณ์'],
  deviceType: ['devicetype', 'device_type', 'ประเภท', 'type'],
  brand: ['brand', 'แบรนด์'],
  model: ['model', 'รุ่น'],
  serial: ['serial', 'serialnumber', 'sn', 'serial_no'],
  status: ['status', 'สถานะ'],
  site: ['site', 'สาขา'],
  building: ['building', 'อาคาร'],
  floor: ['floor', 'ชั้น'],
  department: ['department', 'แผนก'],
  departmentCode: ['departmentcode', 'department_code', 'รหัสแผนก'],
  location: ['location', 'ที่ตั้ง'],
  deviceGroup: ['devicegroup', 'device_group', 'กลุ่ม', 'กลุ่มอุปกรณ์'],
  costCenter: ['costcenter', 'cost_center'],
  contractNo: ['contractno', 'contract_no', 'เลขสัญญา'],
  vendor: ['vendor', 'ผู้ขาย'],
  ip: ['ip', 'ipaddress'],
  mac: ['mac', 'macaddress'],
  remoteId: ['remoteid', 'remote_id'],
  installDate: ['installdate', 'install_date', 'วันติดตั้ง'],
  warrantyEnd: ['warrantyend', 'warranty_end', 'วันหมดประกัน'],
  // CONSULTING-007: warrantyMonths alias added (legacy /api/import field).
  warrantyMonths: ['warrantymonths', 'warranty_months', 'รับประกัน(เดือน)', 'รับประกันเดือน'],
  meterRequired: ['meterrequired', 'meter_required', 'ต้องจดมิเตอร์'],
  meterMode: ['metermode', 'meter_mode', 'โหมดมิเตอร์'],
  assetSiteCode: ['assetsitecode', 'asset_site_code'],
  remark: ['remark', 'หมายเหตุ'],
}

/**
 * Alias-aware header lookup. Given a list of CSV header strings,
 * returns a map of canonicalField → column index, matching each
 * header (case-insensitive, trimmed) against HEADER_ALIASES.
 *
 * Used by /api/import/route.ts `importDevices` so manual uploads
 * can use the same legacy aliases as Apps Script mode (e.g.
 * "asset_no", "รหัสสินทรัพย์", "assetcode" all → assetNo).
 */
export function resolveHeaderIndexes(
  headers: string[],
): Record<string, number> {
  const out: Record<string, number> = {}
  headers.forEach((raw, i) => {
    const normalized = raw.replace(/^\uFEFF/, '').trim().toLowerCase()
    if (!normalized) return
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (out[field] !== undefined) continue
      if (aliases.includes(normalized)) {
        out[field] = i
        return
      }
    }
  })
  return out
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase()
}

function resolveField(header: string): 'assetNo' | DeviceImportField | null {
  const normalized = normalizeHeader(header)
  if (normalized === 'assetno') return 'assetNo'

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalized)) return field as DeviceImportField
  }

  return null
}

function textCell(value: string | undefined): string | null {
  const normalized = (value ?? '').trim()
  return normalized === '' ? null : normalized
}

function booleanCell(value: string | undefined): boolean | null {
  const normalized = textCell(value)?.toLowerCase()
  if (!normalized) return null
  if (['true', 'yes', '1', 'y', 'ใช่', 'x'].includes(normalized)) return true
  if (['false', 'no', '0', 'n', 'ไม่'].includes(normalized)) return false
  return null
}

function intCell(value: string | undefined): number | null {
  if (!value) return null
  const n = Number(value.trim())
  return Number.isFinite(n) ? Math.floor(n) : null
}

function rowValues(row: string[], fieldIndexes: Record<string, number>, assetNoIndex: number): DeviceImportValues {
  const cell = (field: string): string | null => {
    const index = fieldIndexes[field]
    return index === undefined || index < 0 ? null : textCell(row[index])
  }

  return {
    assetNo: textCell(row[assetNoIndex]) ?? '',
    name: cell('name'),
    deviceType: cell('deviceType'),
    brand: cell('brand'),
    model: cell('model'),
    serial: cell('serial'),
    status: cell('status'),
    site: cell('site'),
    building: cell('building'),
    floor: cell('floor'),
    department: cell('department'),
    departmentCode: cell('departmentCode'),
    location: cell('location'),
    deviceGroup: cell('deviceGroup'),
    costCenter: cell('costCenter'),
    contractNo: cell('contractNo'),
    vendor: cell('vendor'),
    ip: cell('ip'),
    mac: cell('mac'),
    remoteId: cell('remoteId'),
    installDate: cell('installDate'),
    warrantyEnd: cell('warrantyEnd'),
    warrantyMonths: intCell(
      fieldIndexes.warrantyMonths === undefined ? undefined : row[fieldIndexes.warrantyMonths],
    ),
    meterRequired: booleanCell(
      fieldIndexes.meterRequired === undefined ? undefined : row[fieldIndexes.meterRequired],
    ),
    meterMode: cell('meterMode'),
    assetSiteCode: cell('assetSiteCode'),
    remark: cell('remark'),
  }
}

/** Parse CSV and normalize legacy/Thai headers without touching the database. */
export function parseDeviceImportCsv(csvText: string): DeviceImportParseResult {
  const rows = parseCsv(csvText)
  if (rows.length === 0) {
    return { rows: [], errors: [{ rowNumber: 0, message: 'empty CSV' }], headers: [] }
  }

  const headers = rows[0].map((header) => header.trim())
  const assetNoIndex = headers.findIndex((header) => resolveField(header) === 'assetNo')
  const errors: DeviceImportError[] = []

  if (assetNoIndex < 0) {
    return {
      rows: [],
      errors: [{ rowNumber: 1, field: 'assetNo', message: 'CSV header must contain an assetNo column (รหัสสินทรัพย์)' }],
      headers,
    }
  }

  const fieldIndexes: Record<string, number> = {}
  headers.forEach((header, index) => {
    const field = resolveField(header)
    if (!field) return
    if (fieldIndexes[field] !== undefined) {
      errors.push({ rowNumber: 1, field, message: `duplicate CSV header for ${field}` })
      return
    }
    fieldIndexes[field] = index
  })

  const parsedRows: DeviceImportRow[] = []
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row || row.every((cell) => !cell.trim())) continue

    const values = rowValues(row, fieldIndexes, assetNoIndex)
    if (!values.assetNo) {
      errors.push({ rowNumber: index + 1, field: 'assetNo', message: 'assetNo is required' })
      continue
    }

    const meterRaw = fieldIndexes.meterRequired === undefined
      ? null
      : textCell(row[fieldIndexes.meterRequired])
    if (meterRaw && booleanCell(meterRaw) === null) {
      errors.push({ rowNumber: index + 1, field: 'meterRequired', message: 'meterRequired must be a boolean value' })
      continue
    }

    parsedRows.push({ rowNumber: index + 1, values })
  }

  return { rows: parsedRows, errors, headers }
}

/** Validate pure row-level invariants before site/auth/DB checks. */
export function validateDeviceImportRows(rows: DeviceImportRow[]): DeviceImportValidationResult {
  const validRows: DeviceImportRow[] = []
  const errors: DeviceImportError[] = []
  const seenAssetNos = new Set<string>()

  rows.forEach((row) => {
    const key = row.values.assetNo.toLowerCase()
    if (seenAssetNos.has(key)) {
      errors.push({
        rowNumber: row.rowNumber,
        field: 'assetNo',
        message: `duplicate assetNo in CSV: ${row.values.assetNo}`,
      })
      return
    }
    seenAssetNos.add(key)
    validRows.push(row)
  })

  return { validRows, errors }
}
