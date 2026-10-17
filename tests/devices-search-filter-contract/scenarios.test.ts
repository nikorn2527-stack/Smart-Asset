// ============================================================
// Devices Search/Filter Contract — Tests (pure, no DB)
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  SEARCH_SCENARIOS,
  SEARCH_BOUNDS,
  SEARCHABLE_FIELDS,
  SORTABLE_FIELDS,
  INDEX_HINTS,
  isValidSearchField,
  isSortableField,
  isValidSearchMode,
  isValidFilterOperator,
  isValidSortDirection,
  sanitizeSearchString,
  clampSearchPagination,
  buildWhereClause,
  applySearchMode,
  buildSortClause,
  validateSearchQuery,
  getIndexHint,
  analyzeQueryPlan,
  type SearchQueryInput,
} from '@/lib/devices-search-filter-contract/scenarios'

// ─── Validators ─────────────────────────────────────────────────────
describe('isValidSearchField', () => {
  it('assetCode is valid', () => expect(isValidSearchField('assetCode')).toBe(true))
  it('name is valid', () => expect(isValidSearchField('name')).toBe(true))
  it('password is invalid', () => expect(isValidSearchField('password')).toBe(false))
})

describe('isSortableField', () => {
  it('createdAt is sortable', () => expect(isSortableField('createdAt')).toBe(true))
  it('assetCode is sortable', () => expect(isSortableField('assetCode')).toBe(true))
  it('ip is NOT sortable', () => expect(isSortableField('ip')).toBe(false))
})

describe('isValidSearchMode', () => {
  it('contains is valid', () => expect(isValidSearchMode('contains')).toBe(true))
  it('equals is valid', () => expect(isValidSearchMode('equals')).toBe(true))
  it('regex is invalid', () => expect(isValidSearchMode('regex')).toBe(false))
})

describe('isValidFilterOperator', () => {
  it('eq is valid', () => expect(isValidFilterOperator('eq')).toBe(true))
  it('in is valid', () => expect(isValidFilterOperator('in')).toBe(true))
  it('like is invalid', () => expect(isValidFilterOperator('like')).toBe(false))
})

describe('isValidSortDirection', () => {
  it('asc is valid', () => expect(isValidSortDirection('asc')).toBe(true))
  it('desc is valid', () => expect(isValidSortDirection('desc')).toBe(true))
  it('random is invalid', () => expect(isValidSortDirection('random')).toBe(false))
})

// ─── sanitizeSearchString ──────────────────────────────────────────
describe('sanitizeSearchString', () => {
  it('trims whitespace', () => {
    expect(sanitizeSearchString('  hello  ')).toBe('hello')
  })

  it('removes null bytes', () => {
    expect(sanitizeSearchString('hello\0world')).toBe('helloworld')
  })

  it('truncates to MAX_SEARCH_LENGTH', () => {
    const longString = 'a'.repeat(SEARCH_BOUNDS.MAX_SEARCH_LENGTH + 100)
    const result = sanitizeSearchString(longString)
    expect(result.length).toBe(SEARCH_BOUNDS.MAX_SEARCH_LENGTH)
  })

  it('preserves unicode (Thai)', () => {
    expect(sanitizeSearchString('เครื่องพิมพ์')).toBe('เครื่องพิมพ์')
  })

  it('handles empty string', () => {
    expect(sanitizeSearchString('')).toBe('')
  })

  it('handles only whitespace', () => {
    expect(sanitizeSearchString('   ')).toBe('')
  })
})

// ─── clampSearchPagination ─────────────────────────────────────────
describe('clampSearchPagination', () => {
  it('defaults when undefined', () => {
    const result = clampSearchPagination(undefined, undefined)
    expect(result.page).toBe(1)
    expect(result.limit).toBe(SEARCH_BOUNDS.DEFAULT_LIMIT)
    expect(result.skip).toBe(0)
  })

  it('clamps page < 1 to 1', () => {
    expect(clampSearchPagination(0, 100).page).toBe(1)
    expect(clampSearchPagination(-5, 100).page).toBe(1)
  })

  it('clamps page > MAX_PAGE', () => {
    expect(clampSearchPagination(99999, 100).page).toBe(SEARCH_BOUNDS.MAX_PAGE)
  })

  it('clamps limit > MAX_LIMIT', () => {
    expect(clampSearchPagination(1, 99999).limit).toBe(SEARCH_BOUNDS.MAX_LIMIT)
  })

  it('clamps limit < 1 to 1', () => {
    expect(clampSearchPagination(1, 0).limit).toBe(1)
  })

  it('handles NaN', () => {
    const result = clampSearchPagination(NaN, NaN)
    expect(result.page).toBe(1)
    expect(result.limit).toBe(SEARCH_BOUNDS.DEFAULT_LIMIT)
  })

  it('calculates skip', () => {
    expect(clampSearchPagination(2, 100).skip).toBe(100)
    expect(clampSearchPagination(3, 50).skip).toBe(100)
  })
})

// ─── applySearchMode ───────────────────────────────────────────────
describe('applySearchMode', () => {
  it('contains mode', () => {
    const result = applySearchMode('test', 'contains')
    expect(result).toEqual({ contains: 'test', mode: 'insensitive' })
  })

  it('equals mode', () => {
    const result = applySearchMode('test', 'equals')
    expect(result).toEqual({ equals: 'test', mode: 'insensitive' })
  })

  it('startsWith mode', () => {
    const result = applySearchMode('test', 'startsWith')
    expect(result).toEqual({ startsWith: 'test', mode: 'insensitive' })
  })

  it('endsWith mode', () => {
    const result = applySearchMode('test', 'endsWith')
    expect(result).toEqual({ endsWith: 'test', mode: 'insensitive' })
  })
})

// ─── buildSortClause ──────────────────────────────────────────────
describe('buildSortClause', () => {
  it('builds asc clause', () => {
    expect(buildSortClause('createdAt', 'asc')).toEqual({ createdAt: 'asc' })
  })

  it('builds desc clause', () => {
    expect(buildSortClause('name', 'desc')).toEqual({ name: 'desc' })
  })
})

// ─── buildWhereClause ──────────────────────────────────────────────
describe('buildWhereClause', () => {
  it('empty search + no filters + no site filter = empty where', () => {
    const where = buildWhereClause(null, 'contains', [], [], null)
    expect(where).toEqual({})
  })

  it('site filter applied for non-superadmin', () => {
    const where = buildWhereClause(null, 'contains', [], [], ['UDH', 'NKP'])
    expect(where.site).toEqual({ in: ['UDH', 'NKP'] })
  })

  it('fail-closed for empty site filter', () => {
    const where = buildWhereClause(null, 'contains', [], [], [])
    expect(where.id).toBe('__FAIL_CLOSED__')
  })

  it('single search field', () => {
    const where = buildWhereClause('A001', 'contains', ['assetCode'], [], null)
    expect(where.assetCode).toEqual({ contains: 'A001', mode: 'insensitive' })
  })

  it('multiple search fields → OR clause', () => {
    const where = buildWhereClause('printer', 'contains', ['name', 'brand', 'model'], [], null)
    expect(where.OR).toHaveLength(3)
    expect(where.OR[0]).toEqual({ name: { contains: 'printer', mode: 'insensitive' } })
  })

  it('filters applied', () => {
    const filters = [
      { field: 'status', operator: 'eq' as const, value: 'active' },
      { field: 'type', operator: 'in' as const, value: ['PRINTER', 'SCANNER'] },
    ]
    const where = buildWhereClause(null, 'contains', [], filters, null)
    expect(where.status).toEqual({ equals: 'active' })
    expect(where.type).toEqual({ in: ['PRINTER', 'SCANNER'] })
  })
})

// ─── validateSearchQuery ───────────────────────────────────────────
describe('validateSearchQuery', () => {
  it('INVALID_SEARCH_FIELD for non-searchable field', () => {
    const input: SearchQueryInput = {
      search: 'test',
      searchFields: ['password' as unknown as 'assetCode'],
      isSuperAdmin: true,
    }
    const result = validateSearchQuery(input)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_SEARCH_FIELD')
  })

  it('INVALID_SORT_FIELD for non-sortable field', () => {
    const input: SearchQueryInput = {
      sort: { field: 'ip' as unknown as 'createdAt', direction: 'asc' },
      isSuperAdmin: true,
    }
    const result = validateSearchQuery(input)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_SORT_FIELD')
  })

  it('SITE_SCOPE_DENIED for non-superadmin with no grants', () => {
    const input: SearchQueryInput = {
      isSuperAdmin: false,
      siteScope: [],
    }
    const result = validateSearchQuery(input)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('SITE_SCOPE_DENIED')
  })

  it('ok for valid query', () => {
    const input: SearchQueryInput = {
      search: 'printer',
      searchFields: ['name'],
      filters: [{ field: 'status', operator: 'eq', value: 'active' }],
      sort: { field: 'createdAt', direction: 'desc' },
      isSuperAdmin: true,
      page: 1,
      limit: 50,
    }
    const result = validateSearchQuery(input)
    expect(result.ok).toBe(true)
    expect(result.query?.search).toBe('printer')
    expect(result.query?.filters.length).toBe(1)
    expect(result.query?.sort.field).toBe('createdAt')
  })

  it('sanitizes search string', () => {
    const input: SearchQueryInput = {
      search: '  \0test\0  ',
      searchFields: ['name'],
      isSuperAdmin: true,
    }
    const result = validateSearchQuery(input)
    expect(result.ok).toBe(true)
    expect(result.query?.search).toBe('test')
  })

  it('empty search after trim becomes null', () => {
    const input: SearchQueryInput = {
      search: '   ',
      searchFields: ['name'],
      isSuperAdmin: true,
    }
    const result = validateSearchQuery(input)
    expect(result.ok).toBe(true)
    expect(result.query?.search).toBeNull()
  })
})

// ─── getIndexHint ─────────────────────────────────────────────────
describe('getIndexHint', () => {
  it('returns index for assetCode', () => {
    expect(getIndexHint('assetCode')).toBe('Device_assetCode_key')
  })

  it('returns index for status', () => {
    expect(getIndexHint('status')).toBe('Device_status_idx')
  })

  it('returns undefined for non-indexed field', () => {
    expect(getIndexHint('remark')).toBeUndefined()
  })
})

// ─── analyzeQueryPlan ──────────────────────────────────────────────
describe('analyzeQueryPlan', () => {
  it('low cost for indexed sort + no search', () => {
    const query = {
      search: null,
      searchMode: 'contains' as const,
      searchFields: ['assetCode' as const],
      filters: [],
      sort: { field: 'createdAt' as const, direction: 'desc' as const },
      page: 1,
      limit: 100,
      skip: 0,
      siteFilter: null,
    }
    const plan = analyzeQueryPlan(query)
    expect(plan.usesIndex).toBe(true)
    expect(plan.estimatedCost).toBe('low')
  })

  it('high cost for search on non-indexed field', () => {
    const query = {
      search: 'test',
      searchMode: 'contains' as const,
      searchFields: ['name' as const],
      filters: [],
      sort: { field: 'createdAt' as const, direction: 'desc' as const },
      page: 1,
      limit: 100,
      skip: 0,
      siteFilter: null,
    }
    const plan = analyzeQueryPlan(query)
    expect(plan.estimatedCost).toBe('high')
    expect(plan.recommendation).toContain('index')
  })

  it('medium cost for many search fields', () => {
    const query = {
      search: 'test',
      searchMode: 'contains' as const,
      searchFields: ['name', 'brand', 'model', 'site', 'department', 'location'] as const[],
      filters: [],
      sort: { field: 'createdAt' as const, direction: 'desc' as const },
      page: 1,
      limit: 100,
      skip: 0,
      siteFilter: null,
    }
    const plan = analyzeQueryPlan(query)
    expect(plan.estimatedCost).toBe('medium')
  })

  it('medium cost for non-indexed sort', () => {
    const query = {
      search: null,
      searchMode: 'contains' as const,
      searchFields: ['assetCode' as const],
      filters: [],
      sort: { field: 'name' as const, direction: 'asc' as const },
      page: 1,
      limit: 100,
      skip: 0,
      siteFilter: null,
    }
    const plan = analyzeQueryPlan(query)
    expect(plan.usesIndex).toBe(false)
  })
})

// ─── Scenario integration ──────────────────────────────────────────
describe('SEARCH_SCENARIOS — integration', () => {
  for (const scenario of SEARCH_SCENARIOS) {
    it(scenario.name, () => {
      const result = validateSearchQuery(scenario.input)
      expect(result.ok).toBe(scenario.expected.ok)
      if (scenario.expected.code) {
        expect(result.code).toBe(scenario.expected.code)
      }
      if (scenario.expected.hasSearch !== undefined && result.query) {
        expect(result.query.search !== null).toBe(scenario.expected.hasSearch)
      }
      if (scenario.expected.hasFilters !== undefined && result.query) {
        expect(result.query.filters.length > 0).toBe(scenario.expected.hasFilters)
      }
      if (scenario.expected.usesIndex !== undefined && result.query) {
        const plan = analyzeQueryPlan(result.query)
        expect(plan.usesIndex).toBe(scenario.expected.usesIndex)
      }
    })
  }
})

// ─── Constants integrity ────────────────────────────────────────────
describe('Constants integrity', () => {
  it('SEARCH_BOUNDS has correct values', () => {
    expect(SEARCH_BOUNDS.MAX_LIMIT).toBe(500)
    expect(SEARCH_BOUNDS.DEFAULT_LIMIT).toBe(100)
    expect(SEARCH_BOUNDS.MIN_LIMIT).toBe(1)
    expect(SEARCH_BOUNDS.MAX_PAGE).toBe(10000)
    expect(SEARCH_BOUNDS.MAX_SEARCH_LENGTH).toBe(200)
  })

  it('SEARCHABLE_FIELDS has 16 fields', () => {
    expect(SEARCHABLE_FIELDS.length).toBe(16)
    expect(SEARCHABLE_FIELDS).toContain('assetCode')
    expect(SEARCHABLE_FIELDS).toContain('name')
    expect(SEARCHABLE_FIELDS).toContain('serialNumber')
  })

  it('SORTABLE_FIELDS has 12 fields', () => {
    expect(SORTABLE_FIELDS.length).toBe(12)
    expect(SORTABLE_FIELDS).toContain('createdAt')
    expect(SORTABLE_FIELDS).toContain('assetCode')
  })

  it('SEARCHABLE_FIELDS does not include password', () => {
    expect(SEARCHABLE_FIELDS).not.toContain('password')
    expect(SEARCHABLE_FIELDS).not.toContain('passwordHash')
    expect(SEARCHABLE_FIELDS).not.toContain('secret')
  })

  it('INDEX_HINTS covers main indexed fields', () => {
    expect(INDEX_HINTS.assetCode).toBeDefined()
    expect(INDEX_HINTS.status).toBeDefined()
    expect(INDEX_HINTS.site).toBeDefined()
    expect(INDEX_HINTS.createdAt).toBeDefined()
  })
})

// ─── Scenario integrity ─────────────────────────────────────────────
describe('Scenario integrity', () => {
  it('SEARCH_SCENARIOS has 12 scenarios', () => {
    expect(SEARCH_SCENARIOS.length).toBe(12)
  })

  it('scenarios cover ok + fail outcomes', () => {
    const hasOk = SEARCH_SCENARIOS.some((s) => s.expected.ok)
    const hasFail = SEARCH_SCENARIOS.some((s) => !s.expected.ok)
    expect(hasOk).toBe(true)
    expect(hasFail).toBe(true)
  })

  it('scenarios cover all error codes', () => {
    const codes = new Set(
      SEARCH_SCENARIOS.filter((s) => !s.expected.ok).map((s) => s.expected.code),
    )
    expect(codes.has('INVALID_SEARCH_FIELD')).toBe(true)
    expect(codes.has('INVALID_SORT_FIELD')).toBe(true)
    expect(codes.has('SITE_SCOPE_DENIED')).toBe(true)
  })
})
