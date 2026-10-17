// ============================================================
// Devices Export Contract — Validation + formatting (pure)
// ============================================================
// Module: Devices (ITAM-01 — Dev-3 / Devices)
// Work Package: C — parallel preparation
//
// Purpose: contract for exporting device data to CSV/JSON.
//   - Field selection (exclude sensitive for non-superadmin)
//   - Format selection (CSV vs JSON)
//   - Bounded row count (export limit)
//   - Filter application (site, status, type, search)
//   - CSV header + row escaping (RFC 4180)
//   - JSON shape consistency
//
// Pure functions only — no DB, no I/O.
//
// Governance:
//   - B4 frozen files: NOT touched
//   - SYNC_RUN permission: NOT added
//   - prisma db:push: NOT used
//   - Schema/migration: NOT changed
// ============================================================

/**
 * Export format.
 */
export type ExportFormat = 'csv' | 'json'

/**
 * Export field selection level.
 * - FULL: all fields (superadmin only)
 * - STANDARD: excludes sensitive fields
 * - MOBILE: minimal subset for mobile export
 */
export type ExportFieldLevel = 'full' | 'standard' | 'mobile'

/**
 * Export query input.
 */
export interface ExportQueryInput {
  format: ExportFormat
  fieldLevel: ExportFieldLevel
  filters?: {
    site?: string[]
    status?: string
    type?: string
    search?: string
  }
  limit?: number
  isSuperAdmin: boolean
  callerSiteScope: string[] // empty + !isSuperAdmin = fail-closed
}

/**
 * Bounded export params (after validation + clamping).
 */
export interface BoundedExportParams {
  format: ExportFormat
  fieldLevel: ExportFieldLevel
  filters: {
    site?: string[]
    status?: string
    type?: string
    search?: string
  }
  limit: number
  selectFields: string[]
}

/**
 * Export validation result.
 */
export interface ExportValidationResult {
  ok: boolean
  code?: 'INVALID_FORMAT' | 'INVALID_FIELD_LEVEL' | 'SITE_SCOPE_DENIED' | 'LIMIT_EXCEEDED'
  params?: BoundedExportParams
}

/**
 * Export bounds.
 */
export const EXPORT_BOUNDS = {
  MAX_LIMIT: 10000, // export allows more rows than list view (batch export)
  DEFAULT_LIMIT: 1000,
  MIN_LIMIT: 1,
  MAX_CSV_CELL_LENGTH: 32767, // Excel cell limit
} as const

/**
 * Full field list (all Device fields).
 */
export const FULL_EXPORT_FIELDS = [
  'id', 'assetCode', 'name', 'brand', 'model', 'type', 'serialNumber',
  'status', 'site', 'department', 'departmentCode', 'parentRef',
  'assetSiteCode', 'displayLabel', 'location', 'building', 'floor',
  'purchaseDate', 'purchasePrice', 'salvageValue', 'usefulLife',
  'warrantyMonths', 'warrantyEnd', 'vendor', 'contractNo',
  'uninstallDate', 'meterRequired', 'meterMode', 'lastMeterBw',
  'lastMeterColor', 'ip', 'mac', 'remoteId', 'currentAssignee',
  'remark', 'costCenter', 'deviceGroup', 'isDemo', 'createdAt',
  'updatedAt', 'updatedBy',
] as const

/**
 * Standard export fields (excludes sensitive).
 * Sensitive = serialNumber, ip, mac, remoteId, contractNo, vendor,
 * purchasePrice, costCenter, remark, currentAssignee.
 */
export const STANDARD_EXPORT_FIELDS = [
  'id', 'assetCode', 'name', 'brand', 'model', 'type',
  'status', 'site', 'department', 'departmentCode',
  'assetSiteCode', 'displayLabel', 'location', 'building', 'floor',
  'purchaseDate', 'warrantyMonths', 'warrantyEnd',
  'meterRequired', 'meterMode', 'lastMeterBw', 'lastMeterColor',
  'isDemo', 'createdAt', 'updatedAt', 'updatedBy',
] as const

/**
 * Mobile export fields (minimal subset).
 */
export const MOBILE_EXPORT_FIELDS = [
  'id', 'assetCode', 'name', 'type', 'status', 'site',
  'department', 'location', 'meterRequired', 'isDemo',
] as const

/**
 * Sensitive fields excluded from non-superadmin export.
 */
export const SENSITIVE_EXPORT_FIELDS = [
  'serialNumber', 'ip', 'mac', 'remoteId', 'contractNo', 'vendor',
  'purchasePrice', 'costCenter', 'remark', 'currentAssignee',
] as const

// ─── Pure helpers ────────────────────────────────────────────────────

/**
 * Validate export format (pure).
 */
export function isValidFormat(format: string): format is ExportFormat {
  return format === 'csv' || format === 'json'
}

/**
 * Validate field level (pure).
 */
export function isValidFieldLevel(level: string): level is ExportFieldLevel {
  return level === 'full' || level === 'standard' || level === 'mobile'
}

/**
 * Get field list for export level (pure).
 */
export function getExportFields(
  level: ExportFieldLevel,
  isSuperAdmin: boolean,
): string[] {
  if (level === 'full' && isSuperAdmin) {
    return [...FULL_EXPORT_FIELDS]
  }
  if (level === 'mobile') {
    return [...MOBILE_EXPORT_FIELDS]
  }
  // standard OR full without superadmin (downgrade to standard)
  return [...STANDARD_EXPORT_FIELDS]
}

/**
 * Clamp export limit (pure).
 */
export function clampExportLimit(limit: number | undefined): number {
  if (limit === undefined || limit === null) {
    return EXPORT_BOUNDS.DEFAULT_LIMIT
  }
  if (!Number.isFinite(limit)) {
    return EXPORT_BOUNDS.DEFAULT_LIMIT
  }
  return Math.max(
    EXPORT_BOUNDS.MIN_LIMIT,
    Math.min(EXPORT_BOUNDS.MAX_LIMIT, Math.floor(limit)),
  )
}

/**
 * Build site filter for export (pure).
 *   - superadmin → no filter (returns undefined)
 *   - non-superadmin with grants → filter IN grants
 *   - non-superadmin without grants → fail-closed (returns empty array)
 */
export function buildExportSiteFilter(
  isSuperAdmin: boolean,
  callerSiteScope: string[],
  requestedSite?: string[],
): string[] | undefined | null {
  if (isSuperAdmin) {
    return requestedSite // superadmin can filter by any site
  }
  if (callerSiteScope.length === 0) {
    return null // fail-closed signal
  }
  if (!requestedSite || requestedSite.length === 0) {
    return callerSiteScope // no explicit filter → use caller scope
  }
  // Intersect: only sites in BOTH caller scope AND requested
  return requestedSite.filter((s) => callerSiteScope.includes(s))
}

/**
 * Validate export query (pure — no DB).
 */
export function validateExportQuery(
  input: ExportQueryInput,
): ExportValidationResult {
  if (!isValidFormat(input.format)) {
    return { ok: false, code: 'INVALID_FORMAT' }
  }
  if (!isValidFieldLevel(input.fieldLevel)) {
    return { ok: false, code: 'INVALID_FIELD_LEVEL' }
  }
  // Site scope check
  if (!input.isSuperAdmin && input.callerSiteScope.length === 0) {
    return { ok: false, code: 'SITE_SCOPE_DENIED' }
  }
  // Limit check
  const limit = clampExportLimit(input.limit)
  if (input.limit !== undefined && input.limit > EXPORT_BOUNDS.MAX_LIMIT) {
    return { ok: false, code: 'LIMIT_EXCEEDED' }
  }

  const siteFilter = buildExportSiteFilter(
    input.isSuperAdmin,
    input.callerSiteScope,
    input.filters?.site,
  )
  if (siteFilter === null) {
    return { ok: false, code: 'SITE_SCOPE_DENIED' }
  }

  const selectFields = getExportFields(input.fieldLevel, input.isSuperAdmin)

  return {
    ok: true,
    params: {
      format: input.format,
      fieldLevel: input.fieldLevel,
      filters: {
        ...input.filters,
        site: siteFilter,
      },
      limit,
      selectFields,
    },
  }
}

/**
 * Escape CSV field (RFC 4180) (pure).
 */
export function escapeExportCsvField(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (s.length > EXPORT_BOUNDS.MAX_CSV_CELL_LENGTH) {
    return `"${s.slice(0, EXPORT_BOUNDS.MAX_CSV_CELL_LENGTH - 3)}..."`
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/**
 * Build CSV header from field list (pure).
 */
export function buildCsvHeader(fields: string[]): string {
  return fields.map(escapeExportCsvField).join(',')
}

/**
 * Build CSV row from device object (pure).
 */
export function buildCsvRow(
  device: Record<string, unknown>,
  fields: string[],
): string {
  return fields
    .map((field) => escapeExportCsvField(device[field]))
    .join(',')
}

/**
 * Build full CSV string from devices (pure).
 */
export function buildExportCsv(
  devices: Record<string, unknown>[],
  fields: string[],
): string {
  const header = buildCsvHeader(fields)
  const rows = devices.map((d) => buildCsvRow(d, fields))
  return [header, ...rows].join('\n')
}

/**
 * Build JSON export (pure).
 * Returns devices with only the selected fields.
 */
export function buildExportJson(
  devices: Record<string, unknown>[],
  fields: string[],
): Record<string, unknown>[] {
  return devices.map((device) => {
    const filtered: Record<string, unknown> = {}
    for (const field of fields) {
      if (field in device) {
        filtered[field] = device[field]
      }
    }
    return filtered
  })
}

/**
 * Estimate export size (for warning before download) (pure).
 */
export function estimateExportSize(
  rowCount: number,
  fieldCount: number,
  format: ExportFormat,
): { bytes: number; warning: string | null } {
  // Rough estimate: 50 bytes per cell average
  const bytesPerCell = 50
  const bytes = rowCount * fieldCount * bytesPerCell
  let warning: string | null = null
  if (bytes > 10_000_000) {
    warning = `Export size ~${Math.round(bytes / 1_000_000)}MB — may take a while to download`
  }
  if (format === 'csv' && rowCount > 1_000_000) {
    warning = `CSV export with ${rowCount} rows — Excel has 1,048,576 row limit`
  }
  return { bytes, warning }
}

// ─── Scenario fixtures ───────────────────────────────────────────────

export interface ExportScenario {
  name: string
  description: string
  input: ExportQueryInput
  devices: Record<string, unknown>[]
  expected: {
    ok: boolean
    code?: string
    fieldCount?: number
    rowCount?: number
    hasSensitive?: boolean
  }
}

export const EXPORT_SCENARIOS: ExportScenario[] = [
  {
    name: 'superadmin CSV full export',
    description: 'Superadmin exports all fields as CSV.',
    input: {
      format: 'csv',
      fieldLevel: 'full',
      isSuperAdmin: true,
      callerSiteScope: [],
      limit: 100,
    },
    devices: [
      { id: 'dev-1', assetCode: 'A001', name: 'Printer', serialNumber: 'SN001', ip: '10.0.0.1' },
    ],
    expected: {
      ok: true,
      fieldCount: FULL_EXPORT_FIELDS.length,
      rowCount: 1,
      hasSensitive: true,
    },
  },
  {
    name: 'non-superadmin CSV standard export (sensitive excluded)',
    description: 'Non-superadmin exports standard fields — serialNumber/ip/mac excluded.',
    input: {
      format: 'csv',
      fieldLevel: 'standard',
      isSuperAdmin: false,
      callerSiteScope: ['UDH'],
      limit: 100,
    },
    devices: [
      { id: 'dev-1', assetCode: 'A001', name: 'Printer', serialNumber: 'SN001', ip: '10.0.0.1' },
    ],
    expected: {
      ok: true,
      fieldCount: STANDARD_EXPORT_FIELDS.length,
      rowCount: 1,
      hasSensitive: false,
    },
  },
  {
    name: 'non-superadmin mobile export (minimal subset)',
    description: 'Non-superadmin exports mobile subset — 10 fields only.',
    input: {
      format: 'json',
      fieldLevel: 'mobile',
      isSuperAdmin: false,
      callerSiteScope: ['UDH'],
      limit: 50,
    },
    devices: [
      { id: 'dev-1', assetCode: 'A001', name: 'Printer', type: 'PRINTER', status: 'active' },
    ],
    expected: {
      ok: true,
      fieldCount: MOBILE_EXPORT_FIELDS.length,
      rowCount: 1,
    },
  },
  {
    name: 'non-superadmin with no grants → SITE_SCOPE_DENIED',
    description: 'Non-superadmin with empty site scope — export denied.',
    input: {
      format: 'csv',
      fieldLevel: 'standard',
      isSuperAdmin: false,
      callerSiteScope: [],
      limit: 100,
    },
    devices: [],
    expected: {
      ok: false,
      code: 'SITE_SCOPE_DENIED',
    },
  },
  {
    name: 'invalid format → INVALID_FORMAT',
    description: 'Format "xml" not supported.',
    input: {
      format: 'xml' as ExportFormat,
      fieldLevel: 'standard',
      isSuperAdmin: true,
      callerSiteScope: [],
      limit: 100,
    },
    devices: [],
    expected: {
      ok: false,
      code: 'INVALID_FORMAT',
    },
  },
  {
    name: 'limit exceeded → LIMIT_EXCEEDED',
    description: 'Limit 999999 exceeds MAX_LIMIT 10000.',
    input: {
      format: 'csv',
      fieldLevel: 'standard',
      isSuperAdmin: true,
      callerSiteScope: [],
      limit: 999999,
    },
    devices: [],
    expected: {
      ok: false,
      code: 'LIMIT_EXCEEDED',
    },
  },
  {
    name: 'site filter intersected with caller scope',
    description: 'Non-superadmin with UDH+NKP grants, requests UDH only — filter = UDH.',
    input: {
      format: 'csv',
      fieldLevel: 'standard',
      isSuperAdmin: false,
      callerSiteScope: ['UDH', 'NKP'],
      filters: { site: ['UDH'] },
      limit: 100,
    },
    devices: [],
    expected: {
      ok: true,
    },
  },
  {
    name: 'site filter outside caller scope → empty result',
    description: 'Non-superadmin with UDH only, requests NKP — intersect = empty.',
    input: {
      format: 'csv',
      fieldLevel: 'standard',
      isSuperAdmin: false,
      callerSiteScope: ['UDH'],
      filters: { site: ['NKP'] },
      limit: 100,
    },
    devices: [],
    expected: {
      ok: true, // valid query, just empty result
    },
  },
]
