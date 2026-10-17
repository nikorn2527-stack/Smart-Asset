// ============================================================
// Devices Export Contract — Tests (pure, no DB)
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  EXPORT_SCENARIOS,
  EXPORT_BOUNDS,
  FULL_EXPORT_FIELDS,
  STANDARD_EXPORT_FIELDS,
  MOBILE_EXPORT_FIELDS,
  SENSITIVE_EXPORT_FIELDS,
  isValidFormat,
  isValidFieldLevel,
  getExportFields,
  clampExportLimit,
  buildExportSiteFilter,
  validateExportQuery,
  escapeExportCsvField,
  buildCsvHeader,
  buildCsvRow,
  buildExportCsv,
  buildExportJson,
  estimateExportSize,
  type ExportQueryInput,
} from '@/lib/devices-export-contract/scenarios'

// ─── isValidFormat + isValidFieldLevel ──────────────────────────────
describe('isValidFormat', () => {
  it('csv is valid', () => expect(isValidFormat('csv')).toBe(true))
  it('json is valid', () => expect(isValidFormat('json')).toBe(true))
  it('xml is invalid', () => expect(isValidFormat('xml')).toBe(false))
  it('empty is invalid', () => expect(isValidFormat('')).toBe(false))
})

describe('isValidFieldLevel', () => {
  it('full is valid', () => expect(isValidFieldLevel('full')).toBe(true))
  it('standard is valid', () => expect(isValidFieldLevel('standard')).toBe(true))
  it('mobile is valid', () => expect(isValidFieldLevel('mobile')).toBe(true))
  it('unknown is invalid', () => expect(isValidFieldLevel('unknown')).toBe(false))
})

// ─── getExportFields ───────────────────────────────────────────────
describe('getExportFields', () => {
  it('full + superadmin returns FULL_EXPORT_FIELDS', () => {
    const fields = getExportFields('full', true)
    expect(fields.length).toBe(FULL_EXPORT_FIELDS.length)
    expect(fields).toContain('serialNumber')
    expect(fields).toContain('ip')
  })

  it('full + non-superadmin downgrades to STANDARD', () => {
    const fields = getExportFields('full', false)
    expect(fields.length).toBe(STANDARD_EXPORT_FIELDS.length)
    expect(fields).not.toContain('serialNumber')
  })

  it('standard returns STANDARD_EXPORT_FIELDS', () => {
    const fields = getExportFields('standard', true)
    expect(fields.length).toBe(STANDARD_EXPORT_FIELDS.length)
    expect(fields).not.toContain('serialNumber')
  })

  it('mobile returns MOBILE_EXPORT_FIELDS', () => {
    const fields = getExportFields('mobile', true)
    expect(fields.length).toBe(MOBILE_EXPORT_FIELDS.length)
    expect(fields.length).toBeLessThanOrEqual(10)
  })

  it('sensitive fields excluded from standard', () => {
    const fields = getExportFields('standard', false)
    for (const sensitive of SENSITIVE_EXPORT_FIELDS) {
      expect(fields).not.toContain(sensitive)
    }
  })
})

// ─── clampExportLimit ──────────────────────────────────────────────
describe('clampExportLimit', () => {
  it('undefined → default', () => {
    expect(clampExportLimit(undefined)).toBe(EXPORT_BOUNDS.DEFAULT_LIMIT)
  })

  it('null → default', () => {
    expect(clampExportLimit(null as unknown as undefined)).toBe(EXPORT_BOUNDS.DEFAULT_LIMIT)
  })

  it('NaN → default', () => {
    expect(clampExportLimit(NaN)).toBe(EXPORT_BOUNDS.DEFAULT_LIMIT)
  })

  it('Infinity → default', () => {
    expect(clampExportLimit(Infinity)).toBe(EXPORT_BOUNDS.DEFAULT_LIMIT)
  })

  it('0 → MIN_LIMIT', () => {
    expect(clampExportLimit(0)).toBe(EXPORT_BOUNDS.MIN_LIMIT)
  })

  it('999999 → MAX_LIMIT', () => {
    expect(clampExportLimit(999999)).toBe(EXPORT_BOUNDS.MAX_LIMIT)
  })

  it('500 → 500', () => {
    expect(clampExportLimit(500)).toBe(500)
  })

  it('floors fractional', () => {
    expect(clampExportLimit(100.7)).toBe(100)
  })
})

// ─── buildExportSiteFilter ──────────────────────────────────────────
describe('buildExportSiteFilter', () => {
  it('superadmin returns requestedSite (no restriction)', () => {
    const result = buildExportSiteFilter(true, [], ['UDH', 'NKP'])
    expect(result).toEqual(['UDH', 'NKP'])
  })

  it('superadmin with no requested → undefined (no filter)', () => {
    const result = buildExportSiteFilter(true, [], undefined)
    expect(result).toBeUndefined()
  })

  it('non-superadmin with no grants → null (fail-closed)', () => {
    const result = buildExportSiteFilter(false, [], ['UDH'])
    expect(result).toBeNull()
  })

  it('non-superadmin with grants, no requested → caller scope', () => {
    const result = buildExportSiteFilter(false, ['UDH', 'NKP'], undefined)
    expect(result).toEqual(['UDH', 'NKP'])
  })

  it('non-superadmin with grants + requested → intersect', () => {
    const result = buildExportSiteFilter(false, ['UDH', 'NKP'], ['UDH'])
    expect(result).toEqual(['UDH'])
  })

  it('non-superadmin requesting out-of-scope site → empty', () => {
    const result = buildExportSiteFilter(false, ['UDH'], ['NKP'])
    expect(result).toEqual([])
  })
})

// ─── validateExportQuery ───────────────────────────────────────────
describe('validateExportQuery', () => {
  it('INVALID_FORMAT for xml', () => {
    const input: ExportQueryInput = {
      format: 'xml' as unknown as 'csv',
      fieldLevel: 'standard',
      isSuperAdmin: true,
      callerSiteScope: [],
    }
    const result = validateExportQuery(input)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_FORMAT')
  })

  it('SITE_SCOPE_DENIED for non-superadmin with no grants', () => {
    const input: ExportQueryInput = {
      format: 'csv',
      fieldLevel: 'standard',
      isSuperAdmin: false,
      callerSiteScope: [],
    }
    const result = validateExportQuery(input)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('SITE_SCOPE_DENIED')
  })

  it('LIMIT_EXCEEDED for limit > MAX_LIMIT', () => {
    const input: ExportQueryInput = {
      format: 'csv',
      fieldLevel: 'standard',
      isSuperAdmin: true,
      callerSiteScope: [],
      limit: 999999,
    }
    const result = validateExportQuery(input)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('LIMIT_EXCEEDED')
  })

  it('ok for superadmin CSV full', () => {
    const input: ExportQueryInput = {
      format: 'csv',
      fieldLevel: 'full',
      isSuperAdmin: true,
      callerSiteScope: [],
      limit: 100,
    }
    const result = validateExportQuery(input)
    expect(result.ok).toBe(true)
    expect(result.params?.selectFields.length).toBe(FULL_EXPORT_FIELDS.length)
  })

  it('ok for non-superadmin JSON standard', () => {
    const input: ExportQueryInput = {
      format: 'json',
      fieldLevel: 'standard',
      isSuperAdmin: false,
      callerSiteScope: ['UDH'],
      limit: 50,
    }
    const result = validateExportQuery(input)
    expect(result.ok).toBe(true)
    expect(result.params?.selectFields.length).toBe(STANDARD_EXPORT_FIELDS.length)
  })
})

// ─── escapeExportCsvField ───────────────────────────────────────────
describe('escapeExportCsvField', () => {
  it('null → empty string', () => {
    expect(escapeExportCsvField(null)).toBe('')
  })

  it('undefined → empty string', () => {
    expect(escapeExportCsvField(undefined)).toBe('')
  })

  it('number → string', () => {
    expect(escapeExportCsvField(123)).toBe('123')
  })

  it('boolean → string', () => {
    expect(escapeExportCsvField(true)).toBe('true')
  })

  it('plain string → no escaping', () => {
    expect(escapeExportCsvField('hello')).toBe('hello')
  })

  it('comma → quoted', () => {
    expect(escapeExportCsvField('hello,world')).toBe('"hello,world"')
  })

  it('quote → doubled + quoted', () => {
    expect(escapeExportCsvField('say "hi"')).toBe('"say ""hi"""')
  })

  it('newline → quoted', () => {
    expect(escapeExportCsvField('line1\nline2')).toBe('"line1\nline2"')
  })

  it('truncates oversized cell', () => {
    const longString = 'a'.repeat(EXPORT_BOUNDS.MAX_CSV_CELL_LENGTH + 100)
    const result = escapeExportCsvField(longString)
    expect(result.length).toBeLessThan(longString.length)
    expect(result).toContain('...')
  })
})

// ─── CSV builders ────────────────────────────────────────────────────
describe('buildCsvHeader', () => {
  it('joins fields with comma', () => {
    expect(buildCsvHeader(['id', 'name', 'status'])).toBe('id,name,status')
  })

  it('escapes fields with comma', () => {
    expect(buildCsvHeader(['id', 'name,with,comma'])).toBe('id,"name,with,comma"')
  })
})

describe('buildCsvRow', () => {
  it('builds row from device + fields', () => {
    const device = { id: 'dev-1', name: 'Printer', status: 'active' }
    const fields = ['id', 'name', 'status']
    expect(buildCsvRow(device, fields)).toBe('dev-1,Printer,active')
  })

  it('handles missing fields', () => {
    const device = { id: 'dev-1', name: 'Printer' }
    const fields = ['id', 'name', 'status']
    expect(buildCsvRow(device, fields)).toBe('dev-1,Printer,')
  })

  it('escapes values with comma', () => {
    const device = { id: 'dev-1', name: 'Printer, HP' }
    const fields = ['id', 'name']
    expect(buildCsvRow(device, fields)).toBe('dev-1,"Printer, HP"')
  })
})

describe('buildExportCsv', () => {
  it('builds full CSV with header + rows', () => {
    const devices = [
      { id: 'dev-1', name: 'Printer' },
      { id: 'dev-2', name: 'Scanner' },
    ]
    const fields = ['id', 'name']
    const csv = buildExportCsv(devices, fields)
    expect(csv).toBe('id,name\ndev-1,Printer\ndev-2,Scanner')
  })

  it('empty devices → only header', () => {
    const csv = buildExportCsv([], ['id', 'name'])
    expect(csv).toBe('id,name')
  })
})

// ─── buildExportJson ────────────────────────────────────────────────
describe('buildExportJson', () => {
  it('filters fields from devices', () => {
    const devices = [
      { id: 'dev-1', name: 'Printer', secret: 'hidden' },
    ]
    const fields = ['id', 'name']
    const result = buildExportJson(devices, fields)
    expect(result).toEqual([{ id: 'dev-1', name: 'Printer' }])
  })

  it('excludes sensitive fields', () => {
    const devices = [
      { id: 'dev-1', serialNumber: 'SN001', ip: '10.0.0.1', name: 'Printer' },
    ]
    const fields = ['id', 'name'] // standard fields only
    const result = buildExportJson(devices, fields)
    expect(result[0]).not.toHaveProperty('serialNumber')
    expect(result[0]).not.toHaveProperty('ip')
  })

  it('handles empty devices', () => {
    const result = buildExportJson([], ['id'])
    expect(result).toEqual([])
  })
})

// ─── estimateExportSize ────────────────────────────────────────────
describe('estimateExportSize', () => {
  it('small export — no warning', () => {
    const result = estimateExportSize(100, 10, 'csv')
    expect(result.bytes).toBe(100 * 10 * 50)
    expect(result.warning).toBeNull()
  })

  it('large export — warning', () => {
    const result = estimateExportSize(100_000, 40, 'csv')
    expect(result.warning).toContain('MB')
  })

  it('CSV with > 1M rows — Excel warning', () => {
    const result = estimateExportSize(1_500_000, 10, 'csv')
    expect(result.warning).toContain('Excel')
  })

  it('JSON with > 1M rows — no Excel warning', () => {
    const result = estimateExportSize(1_500_000, 10, 'json')
    expect(result.warning).not.toContain('Excel')
  })
})

// ─── Scenario integration ──────────────────────────────────────────
describe('EXPORT_SCENARIOS — integration', () => {
  for (const scenario of EXPORT_SCENARIOS) {
    it(scenario.name, () => {
      const result = validateExportQuery(scenario.input)
      expect(result.ok).toBe(scenario.expected.ok)
      if (scenario.expected.code) {
        expect(result.code).toBe(scenario.expected.code)
      }
      if (scenario.expected.fieldCount && result.params) {
        expect(result.params.selectFields.length).toBe(scenario.expected.fieldCount)
      }
      if (scenario.expected.hasSensitive !== undefined && result.params) {
        const hasSensitive = result.params.selectFields.some((f) =>
          (SENSITIVE_EXPORT_FIELDS as readonly string[]).includes(f),
        )
        expect(hasSensitive).toBe(scenario.expected.hasSensitive)
      }
    })
  }
})

// ─── Constants integrity ────────────────────────────────────────────
describe('Constants integrity', () => {
  it('EXPORT_BOUNDS has correct values', () => {
    expect(EXPORT_BOUNDS.MAX_LIMIT).toBe(10000)
    expect(EXPORT_BOUNDS.DEFAULT_LIMIT).toBe(1000)
    expect(EXPORT_BOUNDS.MIN_LIMIT).toBe(1)
    expect(EXPORT_BOUNDS.MAX_CSV_CELL_LENGTH).toBe(32767)
  })

  it('FULL_EXPORT_FIELDS has all fields including sensitive', () => {
    expect(FULL_EXPORT_FIELDS).toContain('serialNumber')
    expect(FULL_EXPORT_FIELDS).toContain('ip')
    expect(FULL_EXPORT_FIELDS).toContain('mac')
    expect(FULL_EXPORT_FIELDS.length).toBeGreaterThan(30)
  })

  it('STANDARD_EXPORT_FIELDS excludes all sensitive', () => {
    for (const sensitive of SENSITIVE_EXPORT_FIELDS) {
      expect(STANDARD_EXPORT_FIELDS).not.toContain(sensitive)
    }
  })

  it('MOBILE_EXPORT_FIELDS is smallest subset', () => {
    expect(MOBILE_EXPORT_FIELDS.length).toBeLessThan(STANDARD_EXPORT_FIELDS.length)
    expect(MOBILE_EXPORT_FIELDS.length).toBeLessThan(FULL_EXPORT_FIELDS.length)
  })

  it('SENSITIVE_EXPORT_FIELDS includes all 10 sensitive fields', () => {
    expect(SENSITIVE_EXPORT_FIELDS.length).toBe(10)
    expect(SENSITIVE_EXPORT_FIELDS).toContain('serialNumber')
    expect(SENSITIVE_EXPORT_FIELDS).toContain('ip')
    expect(SENSITIVE_EXPORT_FIELDS).toContain('mac')
    expect(SENSITIVE_EXPORT_FIELDS).toContain('contractNo')
    expect(SENSITIVE_EXPORT_FIELDS).toContain('vendor')
    expect(SENSITIVE_EXPORT_FIELDS).toContain('purchasePrice')
    expect(SENSITIVE_EXPORT_FIELDS).toContain('costCenter')
    expect(SENSITIVE_EXPORT_FIELDS).toContain('remark')
    expect(SENSITIVE_EXPORT_FIELDS).toContain('currentAssignee')
    expect(SENSITIVE_EXPORT_FIELDS).toContain('remoteId')
  })
})

// ─── Scenario integrity ─────────────────────────────────────────────
describe('Scenario integrity', () => {
  it('EXPORT_SCENARIOS has 8 scenarios', () => {
    expect(EXPORT_SCENARIOS.length).toBe(8)
  })

  it('scenarios cover ok + fail outcomes', () => {
    const hasOk = EXPORT_SCENARIOS.some((s) => s.expected.ok)
    const hasFail = EXPORT_SCENARIOS.some((s) => !s.expected.ok)
    expect(hasOk).toBe(true)
    expect(hasFail).toBe(true)
  })

  it('scenarios cover all error codes', () => {
    const codes = new Set(
      EXPORT_SCENARIOS.filter((s) => !s.expected.ok).map((s) => s.expected.code),
    )
    expect(codes.has('INVALID_FORMAT')).toBe(true)
    expect(codes.has('SITE_SCOPE_DENIED')).toBe(true)
    expect(codes.has('LIMIT_EXCEEDED')).toBe(true)
  })

  it('scenarios cover all field levels', () => {
    const levels = new Set(EXPORT_SCENARIOS.map((s) => s.input.fieldLevel))
    expect(levels.has('full')).toBe(true)
    expect(levels.has('standard')).toBe(true)
    expect(levels.has('mobile')).toBe(true)
  })

  it('scenarios cover CSV + JSON formats', () => {
    const formats = new Set(EXPORT_SCENARIOS.map((s) => s.input.format))
    expect(formats.has('csv')).toBe(true)
    expect(formats.has('json')).toBe(true)
  })
})
