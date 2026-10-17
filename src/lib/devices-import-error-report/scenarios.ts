// ============================================================
// Devices Import Error Report Contract (pure functions)
// ============================================================
// Module: Devices (Dev-3 / Devices Team — ITAM-01)
// Work Package: C — parallel preparation
//
// Purpose: classify + format import errors for:
//   - API response (structured JSON)
//   - CSV export (downloadable error report)
//   - Audit summary (redacted)
//
// Contract under test:
//   - Errors have: rowNumber, field, message, severity, category
//   - Categories: VALIDATION, DUPLICATE, MISSING, DB, AUTH, UNKNOWN
//   - Severities: ERROR (blocking), WARNING (non-blocking)
//   - CSV export uses standard format: row,field,category,severity,message
//   - Audit summary redacts sensitive values
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
 * Error category — classifies the type of import error.
 */
export type ErrorCategory =
  | 'VALIDATION' // field validation failed (missing, invalid format)
  | 'DUPLICATE' // duplicate assetCode in file or DB
  | 'MISSING' // required field missing
  | 'DB' // database error (insert/update failed)
  | 'AUTH' // authorization failure (site scope, permission)
  | 'UNKNOWN' // uncategorized

/**
 * Error severity.
 */
export type ErrorSeverity = 'ERROR' | 'WARNING'

/**
 * Classified import error.
 */
export interface ClassifiedImportError {
  rowNumber: number
  field: string
  message: string
  category: ErrorCategory
  severity: ErrorSeverity
  value?: string | null // redacted if sensitive
}

/**
 * Raw error from import pipeline (parser/validator/persistence).
 */
export interface RawImportError {
  rowNumber: number
  field?: string
  message: string
  value?: string | null
}

/**
 * CSV row for error report export.
 */
export interface CsvErrorRow {
  row: number
  field: string
  category: string
  severity: string
  message: string
}

/**
 * Error report summary (for audit log).
 */
export interface ErrorReportSummary {
  total: number
  byCategory: Record<ErrorCategory, number>
  bySeverity: Record<ErrorSeverity, number>
  topFields: Array<{ field: string; count: number }>
  firstErrorRow: number | null
  lastErrorRow: number | null
}

/**
 * Sensitive fields that must be redacted in error reports.
 */
export const SENSITIVE_ERROR_FIELDS = [
  'serialNumber',
  'ip',
  'mac',
  'remoteId',
  'contractNo',
  'vendor',
  'purchasePrice',
  'costCenter',
  'remark',
  'password',
  'token',
  'secret',
] as const

/**
 * Classify a raw error into category + severity (pure — no DB).
 *
 * Rules:
 *   - message contains "duplicate" → DUPLICATE / ERROR
 *   - message contains "missing" or "required" → MISSING / ERROR
 *   - message contains "invalid" or "ไม่ถูกต้อง" → VALIDATION / ERROR
 *   - message contains "ไม่มีสิทธิ์" or "scope" → AUTH / ERROR
 *   - message contains "DB" or "database" or "connection" → DB / ERROR
 *   - field is "assetCode" + duplicate → DUPLICATE / ERROR
 *   - default → UNKNOWN / ERROR
 */
export function classifyError(
  raw: RawImportError,
): ClassifiedImportError {
  const message = raw.message.toLowerCase()
  const field = raw.field ?? 'unknown'

  let category: ErrorCategory = 'UNKNOWN'
  let severity: ErrorSeverity = 'ERROR'

  // Check for AUTH first (before MISSING, since AUTH messages often contain "ไม่มีสิทธิ์" which has "ไม่มี")
  if (
    message.includes('ไม่มีสิทธิ์') ||
    message.includes('scope') ||
    message.includes('unauthorized') ||
    message.includes('forbidden')
  ) {
    category = 'AUTH'
  } else if (
    message.includes('duplicate') ||
    message.includes('ซ้ำ') ||
    message.includes('existing')
  ) {
    category = 'DUPLICATE'
  } else if (
    message.includes('missing') ||
    message.includes('required') ||
    message.includes('ไม่มี') ||
    message.includes('ต้องมี')
  ) {
    category = 'MISSING'
  } else if (
    message.includes('invalid') ||
    message.includes('ไม่ถูกต้อง') ||
    message.includes('format')
  ) {
    category = 'VALIDATION'
  } else if (
    message.includes('db') ||
    message.includes('database') ||
    message.includes('connection') ||
    message.includes('transaction')
  ) {
    category = 'DB'
  }

  return {
    rowNumber: raw.rowNumber,
    field,
    message: raw.message,
    category,
    severity,
    value: raw.value,
  }
}

/**
 * Redact sensitive values from a classified error (pure — no DB).
 */
export function redactSensitiveValue(
  error: ClassifiedImportError,
): ClassifiedImportError {
  const isSensitive = (SENSITIVE_ERROR_FIELDS as readonly string[]).includes(
    error.field,
  )
  if (isSensitive || error.value === null || error.value === undefined) {
    return { ...error, value: isSensitive ? '[REDACTED]' : error.value }
  }
  return error
}

/**
 * Classify + redact a batch of raw errors (pure — no DB).
 */
export function classifyErrorBatch(
  raws: RawImportError[],
): ClassifiedImportError[] {
  return raws.map((r) => redactSensitiveValue(classifyError(r)))
}

/**
 * Build error report summary (pure — no DB).
 */
export function buildErrorReportSummary(
  errors: ClassifiedImportError[],
): ErrorReportSummary {
  const byCategory: Record<ErrorCategory, number> = {
    VALIDATION: 0,
    DUPLICATE: 0,
    MISSING: 0,
    DB: 0,
    AUTH: 0,
    UNKNOWN: 0,
  }
  const bySeverity: Record<ErrorSeverity, number> = {
    ERROR: 0,
    WARNING: 0,
  }
  const fieldCounts = new Map<string, number>()

  let firstErrorRow: number | null = null
  let lastErrorRow: number | null = null

  for (const error of errors) {
    byCategory[error.category] += 1
    bySeverity[error.severity] += 1

    const fieldCount = fieldCounts.get(error.field) ?? 0
    fieldCounts.set(error.field, fieldCount + 1)

    if (firstErrorRow === null || error.rowNumber < firstErrorRow) {
      firstErrorRow = error.rowNumber
    }
    if (lastErrorRow === null || error.rowNumber > lastErrorRow) {
      lastErrorRow = error.rowNumber
    }
  }

  const topFields = Array.from(fieldCounts.entries())
    .map(([field, count]) => ({ field, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  return {
    total: errors.length,
    byCategory,
    bySeverity,
    topFields,
    firstErrorRow,
    lastErrorRow,
  }
}

/**
 * Convert classified error to CSV row (pure — no DB).
 *
 * Escapes commas + quotes per CSV standard (RFC 4180).
 */
export function errorToCsvRow(error: ClassifiedImportError): CsvErrorRow {
  return {
    row: error.rowNumber,
    field: error.field,
    category: error.category,
    severity: error.severity,
    message: error.message,
  }
}

/**
 * Convert batch of errors to CSV rows (pure — no DB).
 */
export function errorsToCsvRows(
  errors: ClassifiedImportError[],
): CsvErrorRow[] {
  return errors.map(errorToCsvRow)
}

/**
 * Escape a CSV field value (RFC 4180) (pure — no DB).
 */
export function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Build CSV string from errors (pure — no DB).
 *
 * Format: row,field,category,severity,message
 */
export function buildErrorCsv(errors: ClassifiedImportError[]): string {
  const rows = errorsToCsvRows(errors)
  const header = 'row,field,category,severity,message'
  const lines = rows.map((r) =>
    [
      r.row,
      escapeCsvField(r.field),
      escapeCsvField(r.category),
      escapeCsvField(r.severity),
      escapeCsvField(r.message),
    ].join(','),
  )
  return [header, ...lines].join('\n')
}

/**
 * Filter errors by category (pure — no DB).
 */
export function filterErrorsByCategory(
  errors: ClassifiedImportError[],
  category: ErrorCategory,
): ClassifiedImportError[] {
  return errors.filter((e) => e.category === category)
}

/**
 * Filter errors by severity (pure — no DB).
 */
export function filterErrorsBySeverity(
  errors: ClassifiedImportError[],
  severity: ErrorSeverity,
): ClassifiedImportError[] {
  return errors.filter((e) => e.severity === severity)
}

// ─── Scenario fixtures ───────────────────────────────────────────────

export interface ErrorReportScenario {
  name: string
  description: string
  rawErrors: RawImportError[]
  expected: {
    classifiedCount: number
    categories: ErrorCategory[]
    redactedFields: string[]
    csvRowCount: number
    summaryTotal: number
  }
}

export const ERROR_REPORT_SCENARIOS: ErrorReportScenario[] = [
  {
    name: 'mixed errors — all categories',
    description:
      'Errors covering VALIDATION, DUPLICATE, MISSING, DB, AUTH categories.',
    rawErrors: [
      { rowNumber: 2, field: 'assetCode', message: 'duplicate assetCode in file: A001' },
      { rowNumber: 3, field: 'name', message: 'missing required field: name' },
      { rowNumber: 4, field: 'status', message: 'invalid status: BROKEN' },
      { rowNumber: 5, field: 'site', message: 'ไม่มีสิทธิ์สาขา NKP (site scope denied)' },
      { rowNumber: 6, field: 'assetCode', message: 'DB insert failed: connection refused' },
      { rowNumber: 7, field: 'unknown', message: 'unknown error occurred' },
    ],
    expected: {
      classifiedCount: 6,
      categories: ['DUPLICATE', 'MISSING', 'VALIDATION', 'AUTH', 'DB', 'UNKNOWN'],
      redactedFields: [],
      csvRowCount: 6,
      summaryTotal: 6,
    },
  },
  {
    name: 'sensitive fields redacted',
    description:
      'Errors with serialNumber, ip, mac fields — values must be redacted.',
    rawErrors: [
      { rowNumber: 2, field: 'serialNumber', message: 'duplicate serialNumber: SN001', value: 'SN001' },
      { rowNumber: 3, field: 'ip', message: 'invalid ip format: 999.999.999.999', value: '999.999.999.999' },
      { rowNumber: 4, field: 'mac', message: 'invalid mac: XX:XX:XX', value: 'XX:XX:XX' },
    ],
    expected: {
      classifiedCount: 3,
      categories: ['DUPLICATE', 'VALIDATION', 'VALIDATION'],
      redactedFields: ['serialNumber', 'ip', 'mac'],
      csvRowCount: 3,
      summaryTotal: 3,
    },
  },
  {
    name: 'no errors — empty report',
    description: 'No errors — summary should be all zeros.',
    rawErrors: [],
    expected: {
      classifiedCount: 0,
      categories: [],
      redactedFields: [],
      csvRowCount: 0,
      summaryTotal: 0,
    },
  },
  {
    name: 'multiple duplicate assetCode errors',
    description: 'Multiple rows with same assetCode — all flagged as DUPLICATE.',
    rawErrors: [
      { rowNumber: 2, field: 'assetCode', message: 'duplicate assetCode in file: A001' },
      { rowNumber: 3, field: 'assetCode', message: 'duplicate assetCode in file: A001' },
      { rowNumber: 4, field: 'assetCode', message: 'duplicate assetCode in file: A002' },
    ],
    expected: {
      classifiedCount: 3,
      categories: ['DUPLICATE', 'DUPLICATE', 'DUPLICATE'],
      redactedFields: [],
      csvRowCount: 3,
      summaryTotal: 3,
    },
  },
  {
    name: 'CSV escaping — message with comma + quote',
    description: 'Error message contains comma and quote — must be escaped per RFC 4180.',
    rawErrors: [
      { rowNumber: 2, field: 'name', message: 'invalid name: "test, name"' },
    ],
    expected: {
      classifiedCount: 1,
      categories: ['VALIDATION'],
      redactedFields: [],
      csvRowCount: 1,
      summaryTotal: 1,
    },
  },
]
