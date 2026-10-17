// ============================================================
// Devices Import Error Report Contract — Tests (pure, no DB)
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  ERROR_REPORT_SCENARIOS,
  SENSITIVE_ERROR_FIELDS,
  classifyError,
  redactSensitiveValue,
  classifyErrorBatch,
  buildErrorReportSummary,
  errorToCsvRow,
  errorsToCsvRows,
  escapeCsvField,
  buildErrorCsv,
  filterErrorsByCategory,
  filterErrorsBySeverity,
  type RawImportError,
  type ErrorCategory,
} from '@/lib/devices-import-error-report/scenarios'

// ─── classifyError ──────────────────────────────────────────────────
describe('classifyError', () => {
  it('classifies duplicate (English)', () => {
    const raw: RawImportError = {
      rowNumber: 2,
      field: 'assetCode',
      message: 'duplicate assetCode in file: A001',
    }
    const result = classifyError(raw)
    expect(result.category).toBe('DUPLICATE')
    expect(result.severity).toBe('ERROR')
  })

  it('classifies duplicate (Thai ซ้ำ)', () => {
    const raw: RawImportError = {
      rowNumber: 2,
      field: 'assetCode',
      message: 'รหัสอุปกรณ์ซ้ำในไฟล์: A001',
    }
    const result = classifyError(raw)
    expect(result.category).toBe('DUPLICATE')
  })

  it('classifies missing (English)', () => {
    const raw: RawImportError = {
      rowNumber: 3,
      field: 'name',
      message: 'missing required field: name',
    }
    const result = classifyError(raw)
    expect(result.category).toBe('MISSING')
  })

  it('classifies missing (Thai ไม่มี)', () => {
    const raw: RawImportError = {
      rowNumber: 3,
      field: 'assetCode',
      message: 'ไม่มีรหัสอุปกรณ์',
    }
    const result = classifyError(raw)
    expect(result.category).toBe('MISSING')
  })

  it('classifies validation (English)', () => {
    const raw: RawImportError = {
      rowNumber: 4,
      field: 'status',
      message: 'invalid status: BROKEN',
    }
    const result = classifyError(raw)
    expect(result.category).toBe('VALIDATION')
  })

  it('classifies validation (Thai ไม่ถูกต้อง)', () => {
    const raw: RawImportError = {
      rowNumber: 4,
      field: 'status',
      message: 'สถานะไม่ถูกต้อง: BROKEN',
    }
    const result = classifyError(raw)
    expect(result.category).toBe('VALIDATION')
  })

  it('classifies AUTH (ไม่มีสิทธิ์)', () => {
    const raw: RawImportError = {
      rowNumber: 5,
      field: 'site',
      message: 'ไม่มีสิทธิ์สาขา NKP (site scope denied)',
    }
    const result = classifyError(raw)
    expect(result.category).toBe('AUTH')
  })

  it('classifies AUTH (English scope)', () => {
    const raw: RawImportError = {
      rowNumber: 5,
      field: 'site',
      message: 'site scope denied for NKP',
    }
    const result = classifyError(raw)
    expect(result.category).toBe('AUTH')
  })

  it('classifies DB (English)', () => {
    const raw: RawImportError = {
      rowNumber: 6,
      field: 'assetCode',
      message: 'DB insert failed: connection refused',
    }
    const result = classifyError(raw)
    expect(result.category).toBe('DB')
  })

  it('classifies DB (database keyword)', () => {
    const raw: RawImportError = {
      rowNumber: 6,
      field: 'assetCode',
      message: 'database transaction failed',
    }
    const result = classifyError(raw)
    expect(result.category).toBe('DB')
  })

  it('classifies UNKNOWN for unrecognized message', () => {
    const raw: RawImportError = {
      rowNumber: 7,
      field: 'unknown',
      message: 'something weird happened',
    }
    const result = classifyError(raw)
    expect(result.category).toBe('UNKNOWN')
  })

  it('defaults field to "unknown" when not provided', () => {
    const raw: RawImportError = {
      rowNumber: 1,
      message: 'unknown error',
    }
    const result = classifyError(raw)
    expect(result.field).toBe('unknown')
  })
})

// ─── redactSensitiveValue ──────────────────────────────────────────
describe('redactSensitiveValue', () => {
  it('redacts serialNumber', () => {
    const error = {
      rowNumber: 2,
      field: 'serialNumber',
      message: 'duplicate',
      category: 'DUPLICATE' as const,
      severity: 'ERROR' as const,
      value: 'SN001',
    }
    const result = redactSensitiveValue(error)
    expect(result.value).toBe('[REDACTED]')
  })

  it('redacts ip', () => {
    const error = {
      rowNumber: 2,
      field: 'ip',
      message: 'invalid ip',
      category: 'VALIDATION' as const,
      severity: 'ERROR' as const,
      value: '999.999.999.999',
    }
    const result = redactSensitiveValue(error)
    expect(result.value).toBe('[REDACTED]')
  })

  it('redacts mac', () => {
    const error = {
      rowNumber: 2,
      field: 'mac',
      message: 'invalid mac',
      category: 'VALIDATION' as const,
      severity: 'ERROR' as const,
      value: 'XX:XX:XX',
    }
    const result = redactSensitiveValue(error)
    expect(result.value).toBe('[REDACTED]')
  })

  it('does NOT redact non-sensitive field', () => {
    const error = {
      rowNumber: 2,
      field: 'name',
      message: 'invalid',
      category: 'VALIDATION' as const,
      severity: 'ERROR' as const,
      value: 'Test Device',
    }
    const result = redactSensitiveValue(error)
    expect(result.value).toBe('Test Device')
  })

  it('handles null value', () => {
    const error = {
      rowNumber: 2,
      field: 'name',
      message: 'invalid',
      category: 'VALIDATION' as const,
      severity: 'ERROR' as const,
      value: null,
    }
    const result = redactSensitiveValue(error)
    expect(result.value).toBeNull()
  })
})

// ─── classifyErrorBatch ───────────────────────────────────────────
describe('classifyErrorBatch', () => {
  it('classifies + redacts multiple errors', () => {
    const raws: RawImportError[] = [
      { rowNumber: 2, field: 'assetCode', message: 'duplicate assetCode', value: 'A001' },
      { rowNumber: 3, field: 'serialNumber', message: 'duplicate serialNumber', value: 'SN001' },
    ]
    const results = classifyErrorBatch(raws)
    expect(results.length).toBe(2)
    expect(results[0].category).toBe('DUPLICATE')
    expect(results[0].value).toBe('A001') // assetCode not sensitive
    expect(results[1].value).toBe('[REDACTED]') // serialNumber redacted
  })
})

// ─── buildErrorReportSummary ──────────────────────────────────────
describe('buildErrorReportSummary', () => {
  it('empty errors returns zero summary', () => {
    const summary = buildErrorReportSummary([])
    expect(summary.total).toBe(0)
    expect(summary.firstErrorRow).toBeNull()
    expect(summary.lastErrorRow).toBeNull()
    expect(summary.topFields).toEqual([])
  })

  it('counts by category + severity', () => {
    const errors = [
      { rowNumber: 2, field: 'assetCode', message: 'dup', category: 'DUPLICATE' as ErrorCategory, severity: 'ERROR' as const },
      { rowNumber: 3, field: 'name', message: 'missing', category: 'MISSING' as ErrorCategory, severity: 'ERROR' as const },
      { rowNumber: 4, field: 'assetCode', message: 'dup', category: 'DUPLICATE' as ErrorCategory, severity: 'ERROR' as const },
    ]
    const summary = buildErrorReportSummary(errors)
    expect(summary.total).toBe(3)
    expect(summary.byCategory.DUPLICATE).toBe(2)
    expect(summary.byCategory.MISSING).toBe(1)
    expect(summary.bySeverity.ERROR).toBe(3)
  })

  it('tracks first + last error row', () => {
    const errors = [
      { rowNumber: 5, field: 'a', message: 'm', category: 'VALIDATION' as ErrorCategory, severity: 'ERROR' as const },
      { rowNumber: 2, field: 'b', message: 'm', category: 'VALIDATION' as ErrorCategory, severity: 'ERROR' as const },
      { rowNumber: 8, field: 'c', message: 'm', category: 'VALIDATION' as ErrorCategory, severity: 'ERROR' as const },
    ]
    const summary = buildErrorReportSummary(errors)
    expect(summary.firstErrorRow).toBe(2)
    expect(summary.lastErrorRow).toBe(8)
  })

  it('topFields sorted by count desc', () => {
    const errors = [
      { rowNumber: 1, field: 'assetCode', message: 'm', category: 'DUPLICATE' as ErrorCategory, severity: 'ERROR' as const },
      { rowNumber: 2, field: 'assetCode', message: 'm', category: 'DUPLICATE' as ErrorCategory, severity: 'ERROR' as const },
      { rowNumber: 3, field: 'name', message: 'm', category: 'MISSING' as ErrorCategory, severity: 'ERROR' as const },
    ]
    const summary = buildErrorReportSummary(errors)
    expect(summary.topFields[0]).toEqual({ field: 'assetCode', count: 2 })
    expect(summary.topFields[1]).toEqual({ field: 'name', count: 1 })
  })
})

// ─── CSV helpers ────────────────────────────────────────────────────
describe('escapeCsvField', () => {
  it('returns plain value when no special chars', () => {
    expect(escapeCsvField('hello')).toBe('hello')
  })

  it('escapes comma by quoting', () => {
    expect(escapeCsvField('hello,world')).toBe('"hello,world"')
  })

  it('escapes quote by doubling + quoting', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
  })

  it('escapes newline by quoting', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"')
  })

  it('escapes comma + quote together', () => {
    expect(escapeCsvField('"test, name"')).toBe('"""test, name"""')
  })
})

describe('errorToCsvRow + errorsToCsvRows', () => {
  it('converts classified error to CSV row', () => {
    const error = {
      rowNumber: 2,
      field: 'assetCode',
      message: 'duplicate',
      category: 'DUPLICATE' as ErrorCategory,
      severity: 'ERROR' as const,
    }
    const row = errorToCsvRow(error)
    expect(row).toEqual({
      row: 2,
      field: 'assetCode',
      category: 'DUPLICATE',
      severity: 'ERROR',
      message: 'duplicate',
    })
  })

  it('converts batch', () => {
    const errors = [
      { rowNumber: 2, field: 'a', message: 'm1', category: 'VALIDATION' as ErrorCategory, severity: 'ERROR' as const },
      { rowNumber: 3, field: 'b', message: 'm2', category: 'MISSING' as ErrorCategory, severity: 'ERROR' as const },
    ]
    const rows = errorsToCsvRows(errors)
    expect(rows.length).toBe(2)
  })
})

describe('buildErrorCsv', () => {
  it('builds CSV with header + rows', () => {
    const errors = [
      { rowNumber: 2, field: 'assetCode', message: 'duplicate', category: 'DUPLICATE' as ErrorCategory, severity: 'ERROR' as const },
    ]
    const csv = buildErrorCsv(errors)
    expect(csv).toContain('row,field,category,severity,message')
    expect(csv).toContain('2,assetCode,DUPLICATE,ERROR,duplicate')
  })

  it('empty errors returns only header', () => {
    const csv = buildErrorCsv([])
    expect(csv).toBe('row,field,category,severity,message')
  })

  it('escapes special chars in CSV', () => {
    const errors = [
      { rowNumber: 2, field: 'name', message: 'invalid: "test, name"', category: 'VALIDATION' as ErrorCategory, severity: 'ERROR' as const },
    ]
    const csv = buildErrorCsv(errors)
    expect(csv).toContain('"invalid: ""test, name"""')
  })
})

// ─── Filter helpers ────────────────────────────────────────────────
describe('filterErrorsByCategory + filterErrorsBySeverity', () => {
  const errors = [
    { rowNumber: 1, field: 'a', message: 'm', category: 'DUPLICATE' as ErrorCategory, severity: 'ERROR' as const },
    { rowNumber: 2, field: 'b', message: 'm', category: 'MISSING' as ErrorCategory, severity: 'ERROR' as const },
    { rowNumber: 3, field: 'c', message: 'm', category: 'DUPLICATE' as ErrorCategory, severity: 'WARNING' as const },
  ]

  it('filterErrorsByCategory returns matching category', () => {
    expect(filterErrorsByCategory(errors, 'DUPLICATE').length).toBe(2)
    expect(filterErrorsByCategory(errors, 'MISSING').length).toBe(1)
  })

  it('filterErrorsBySeverity returns matching severity', () => {
    expect(filterErrorsBySeverity(errors, 'ERROR').length).toBe(2)
    expect(filterErrorsBySeverity(errors, 'WARNING').length).toBe(1)
  })
})

// ─── Scenario integration ──────────────────────────────────────────
describe('ERROR_REPORT_SCENARIOS — integration', () => {
  for (const scenario of ERROR_REPORT_SCENARIOS) {
    it(scenario.name, () => {
      const classified = classifyErrorBatch(scenario.rawErrors)
      expect(classified.length).toBe(scenario.expected.classifiedCount)

      if (scenario.expected.categories.length > 0) {
        const categories = classified.map((e) => e.category)
        expect(categories).toEqual(scenario.expected.categories)
      }

      // Check redaction
      if (scenario.expected.redactedFields.length > 0) {
        for (const field of scenario.expected.redactedFields) {
          const matching = classified.filter((e) => e.field === field)
          for (const e of matching) {
            expect(e.value).toBe('[REDACTED]')
          }
        }
      }

      // Check CSV
      const csvRows = errorsToCsvRows(classified)
      expect(csvRows.length).toBe(scenario.expected.csvRowCount)

      // Check summary
      const summary = buildErrorReportSummary(classified)
      expect(summary.total).toBe(scenario.expected.summaryTotal)
    })
  }
})

// ─── Constants integrity ────────────────────────────────────────────
describe('Constants integrity', () => {
  it('SENSITIVE_ERROR_FIELDS includes all expected fields', () => {
    expect(SENSITIVE_ERROR_FIELDS).toContain('serialNumber')
    expect(SENSITIVE_ERROR_FIELDS).toContain('ip')
    expect(SENSITIVE_ERROR_FIELDS).toContain('mac')
    expect(SENSITIVE_ERROR_FIELDS).toContain('contractNo')
    expect(SENSITIVE_ERROR_FIELDS).toContain('vendor')
    expect(SENSITIVE_ERROR_FIELDS).toContain('purchasePrice')
    expect(SENSITIVE_ERROR_FIELDS).toContain('password')
    expect(SENSITIVE_ERROR_FIELDS).toContain('token')
    expect(SENSITIVE_ERROR_FIELDS).toContain('secret')
  })

  it('SENSITIVE_ERROR_FIELDS has at least 11 fields', () => {
    expect(SENSITIVE_ERROR_FIELDS.length).toBeGreaterThanOrEqual(11)
  })
})

// ─── Scenario integrity ─────────────────────────────────────────────
describe('Scenario integrity', () => {
  it('ERROR_REPORT_SCENARIOS has 5 scenarios', () => {
    expect(ERROR_REPORT_SCENARIOS.length).toBe(5)
  })

  it('scenarios cover all error categories', () => {
    const allCategories = new Set<ErrorCategory>()
    for (const s of ERROR_REPORT_SCENARIOS) {
      const classified = classifyErrorBatch(s.rawErrors)
      for (const e of classified) {
        allCategories.add(e.category)
      }
    }
    expect(allCategories.has('DUPLICATE')).toBe(true)
    expect(allCategories.has('MISSING')).toBe(true)
    expect(allCategories.has('VALIDATION')).toBe(true)
    expect(allCategories.has('AUTH')).toBe(true)
    expect(allCategories.has('DB')).toBe(true)
    expect(allCategories.has('UNKNOWN')).toBe(true)
  })
})
