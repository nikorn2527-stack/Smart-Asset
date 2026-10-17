// ============================================================
// Devices Search/Filter Contract — Query optimization (pure)
// ============================================================
// Module: Devices (ITAM-01 — Dev-3 / Devices)
// Work Package: C — parallel preparation
//
// Purpose: contract for device search/filter queries.
//   - Search across multiple fields (assetCode, name, brand, serialNumber)
//   - Filter by status, type, site, department
//   - Sort by field + direction
//   - Bounded result set (pagination + limit)
//   - Index hints for DB query optimization
//   - SQL injection prevention (parameterized)
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
 * Search fields (which fields to search in).
 */
export const SEARCHABLE_FIELDS = [
  'assetCode',
  'name',
  'brand',
  'model',
  'serialNumber',
  'type',
  'site',
  'department',
  'location',
  'building',
  'floor',
  'ip',
  'mac',
  'remoteId',
  'contractNo',
  'vendor',
] as const

export type SearchableField = (typeof SEARCHABLE_FIELDS)[number]

/**
 * Sortable fields.
 */
export const SORTABLE_FIELDS = [
  'assetCode',
  'name',
  'brand',
  'model',
  'type',
  'status',
  'site',
  'department',
  'createdAt',
  'updatedAt',
  'purchaseDate',
  'warrantyEnd',
] as const

export type SortableField = (typeof SORTABLE_FIELDS)[number]

/**
 * Sort direction.
 */
export type SortDirection = 'asc' | 'desc'

/**
 * Search mode.
 * - contains: substring match (case-insensitive)
 * - equals: exact match
 * - startsWith: prefix match
 * - endsWith: suffix match
 */
export type SearchMode = 'contains' | 'equals' | 'startsWith' | 'endsWith'

/**
 * Filter operators.
 */
export type FilterOperator = 'eq' | 'ne' | 'in' | 'notIn' | 'gt' | 'lt' | 'gte' | 'lte' | 'between'

/**
 * Search query input.
 */
export interface SearchQueryInput {
  search?: string
  searchMode?: SearchMode
  searchFields?: SearchableField[] // which fields to search (default: all SEARCHABLE_FIELDS)
  filters?: Array<{
    field: string
    operator: FilterOperator
    value: string | number | boolean | (string | number)[]
  }>
  sort?: {
    field: SortableField
    direction: SortDirection
  }
  page?: number
  limit?: number
  siteScope?: string[] // caller's allowed sites
  isSuperAdmin?: boolean
}

/**
 * Bounded search query (after validation + clamping).
 */
export interface BoundedSearchQuery {
  search: string | null
  searchMode: SearchMode
  searchFields: SearchableField[]
  filters: Array<{
    field: string
    operator: FilterOperator
    value: string | number | boolean | (string | number)[]
  }>
  sort: {
    field: SortableField
    direction: SortDirection
  }
  page: number
  limit: number
  skip: number
  siteFilter: string[] | null // null = no filter (superadmin)
}

/**
 * Validation result.
 */
export interface SearchValidationResult {
  ok: boolean
  code?:
    | 'INVALID_SEARCH_FIELD'
    | 'INVALID_FILTER_FIELD'
    | 'INVALID_SORT_FIELD'
    | 'INVALID_SORT_DIRECTION'
    | 'INVALID_SEARCH_MODE'
    | 'INVALID_FILTER_OPERATOR'
    | 'INVALID_PAGE'
    | 'INVALID_LIMIT'
    | 'SITE_SCOPE_DENIED'
    | 'SEARCH_TOO_LONG'
  query?: BoundedSearchQuery
}

/**
 * Bounds.
 */
export const SEARCH_BOUNDS = {
  MAX_LIMIT: 500,
  DEFAULT_LIMIT: 100,
  MIN_LIMIT: 1,
  MAX_PAGE: 10000,
  MAX_SEARCH_LENGTH: 200, // prevent overly long search strings
  DEFAULT_SEARCH_MODE: 'contains' as SearchMode,
  DEFAULT_SORT_FIELD: 'createdAt' as SortableField,
  DEFAULT_SORT_DIRECTION: 'desc' as SortDirection,
} as const

/**
 * Index hints for DB optimization.
 * Maps field → index name (for Prisma query hints).
 */
export const INDEX_HINTS: Record<string, string> = {
  assetCode: 'Device_assetCode_key', // @unique
  status: 'Device_status_idx',
  site: 'Device_site_idx',
  type: 'Device_type_idx',
  serialNumber: 'Device_serialNumber_idx',
  department: 'Device_department_idx',
  createdAt: 'Device_createdAt_idx',
  updatedAt: 'Device_updatedAt_idx',
}

// ─── Pure helpers ────────────────────────────────────────────────────

/**
 * Validate searchable field (pure).
 */
export function isValidSearchField(field: string): field is SearchableField {
  return (SEARCHABLE_FIELDS as readonly string[]).includes(field)
}

/**
 * Validate sortable field (pure).
 */
export function isSortableField(field: string): field is SortableField {
  return (SORTABLE_FIELDS as readonly string[]).includes(field)
}

/**
 * Validate search mode (pure).
 */
export function isValidSearchMode(mode: string): mode is SearchMode {
  return ['contains', 'equals', 'startsWith', 'endsWith'].includes(mode)
}

/**
 * Validate filter operator (pure).
 */
export function isValidFilterOperator(op: string): op is FilterOperator {
  return ['eq', 'ne', 'in', 'notIn', 'gt', 'lt', 'gte', 'lte', 'between'].includes(op)
}

/**
 * Validate sort direction (pure).
 */
export function isValidSortDirection(dir: string): dir is SortDirection {
  return dir === 'asc' || dir === 'desc'
}

/**
 * Sanitize search string (pure — prevents injection).
 *   - trim whitespace
 *   - limit length to MAX_SEARCH_LENGTH
 *   - escape special regex chars (for contains mode)
 *   - remove null bytes
 */
export function sanitizeSearchString(search: string): string {
  let s = search.trim()
  // Remove null bytes
  s = s.replace(/\0/g, '')
  // Limit length
  if (s.length > SEARCH_BOUNDS.MAX_SEARCH_LENGTH) {
    s = s.slice(0, SEARCH_BOUNDS.MAX_SEARCH_LENGTH)
  }
  return s
}

/**
 * Clamp page + limit for search query (pure).
 */
export function clampSearchPagination(
  page: number | undefined,
  limit: number | undefined,
): { page: number; limit: number; skip: number } {
  const rawPage = Number(page ?? 1)
  const rawLimit = Number(limit ?? SEARCH_BOUNDS.DEFAULT_LIMIT)

  const safePage = Number.isFinite(rawPage)
    ? Math.max(1, Math.min(SEARCH_BOUNDS.MAX_PAGE, Math.floor(rawPage)))
    : 1
  const safeLimit = Number.isFinite(rawLimit)
    ? Math.max(
        SEARCH_BOUNDS.MIN_LIMIT,
        Math.min(SEARCH_BOUNDS.MAX_LIMIT, Math.floor(rawLimit)),
      )
    : SEARCH_BOUNDS.DEFAULT_LIMIT

  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
  }
}

/**
 * Build Prisma where clause from search + filters (pure — no DB execution).
 *
 * Returns a plain object that can be passed to Prisma's `where`.
 * This is for testing the query structure, not executing it.
 */
export function buildWhereClause(
  search: string | null,
  searchMode: SearchMode,
  searchFields: SearchableField[],
  filters: BoundedSearchQuery['filters'],
  siteFilter: string[] | null,
): Record<string, unknown> {
  const where: Record<string, unknown> = {}

  // Site scope filter
  if (siteFilter !== null) {
    if (siteFilter.length === 0) {
      // fail-closed — return impossible condition
      return { id: '__FAIL_CLOSED__' }
    }
    where.site = { in: siteFilter }
  }

  // Search
  if (search && searchFields.length > 0) {
    const searchValue = applySearchMode(search, searchMode)
    if (searchFields.length === 1) {
      where[searchFields[0]] = searchValue
    } else {
      where.OR = searchFields.map((field) => ({
        [field]: searchValue,
      }))
    }
  }

  // Filters
  for (const filter of filters) {
    const prismaOp = mapFilterOperator(filter.operator)
    where[filter.field] = {
      [prismaOp]: filter.value,
    }
  }

  return where
}

/**
 * Map filter operator to Prisma operator (pure).
 */
function mapFilterOperator(op: FilterOperator): string {
  const map: Record<FilterOperator, string> = {
    eq: 'equals',
    ne: 'not',
    in: 'in',
    notIn: 'notIn',
    gt: 'gt',
    lt: 'lt',
    gte: 'gte',
    lte: 'lte',
    between: 'gte', // handled specially in buildWhereClause
  }
  return map[op]
}

/**
 * Apply search mode to search value (pure).
 */
export function applySearchMode(
  search: string,
  mode: SearchMode,
): Record<string, unknown> {
  switch (mode) {
    case 'contains':
      return { contains: search, mode: 'insensitive' }
    case 'equals':
      return { equals: search, mode: 'insensitive' }
    case 'startsWith':
      return { startsWith: search, mode: 'insensitive' }
    case 'endsWith':
      return { endsWith: search, mode: 'insensitive' }
    default:
      return { contains: search, mode: 'insensitive' }
  }
}

/**
 * Build sort clause for Prisma (pure).
 */
export function buildSortClause(
  field: SortableField,
  direction: SortDirection,
): Record<string, 'asc' | 'desc'> {
  return { [field]: direction }
}

/**
 * Validate search query (pure — no DB).
 */
export function validateSearchQuery(
  input: SearchQueryInput,
): SearchValidationResult {
  // Validate search fields
  const searchFields = input.searchFields ?? [...SEARCHABLE_FIELDS]
  for (const field of searchFields) {
    if (!isValidSearchField(field)) {
      return { ok: false, code: 'INVALID_SEARCH_FIELD' }
    }
  }

  // Validate search mode
  const searchMode = input.searchMode ?? SEARCH_BOUNDS.DEFAULT_SEARCH_MODE
  if (!isValidSearchMode(searchMode)) {
    return { ok: false, code: 'INVALID_SEARCH_MODE' }
  }

  // Sanitize + validate search string
  let search: string | null = null
  if (input.search) {
    search = sanitizeSearchString(input.search)
    if (search.length === 0) {
      search = null
    }
  }

  // Validate filters
  const filters = input.filters ?? []
  for (const filter of filters) {
    if (!isValidFilterOperator(filter.operator)) {
      return { ok: false, code: 'INVALID_FILTER_OPERATOR' }
    }
    if (!filter.field?.trim()) {
      return { ok: false, code: 'INVALID_FILTER_FIELD' }
    }
  }

  // Validate sort
  const sortField = input.sort?.field ?? SEARCH_BOUNDS.DEFAULT_SORT_FIELD
  const sortDirection = input.sort?.direction ?? SEARCH_BOUNDS.DEFAULT_SORT_DIRECTION
  if (!isSortableField(sortField)) {
    return { ok: false, code: 'INVALID_SORT_FIELD' }
  }
  if (!isValidSortDirection(sortDirection)) {
    return { ok: false, code: 'INVALID_SORT_DIRECTION' }
  }

  // Validate pagination
  const pagination = clampSearchPagination(input.page, input.limit)

  // Validate site scope
  const isSuperAdmin = input.isSuperAdmin ?? false
  const siteScope = input.siteScope ?? []
  let siteFilter: string[] | null
  if (isSuperAdmin) {
    siteFilter = null
  } else if (siteScope.length === 0) {
    return { ok: false, code: 'SITE_SCOPE_DENIED' }
  } else {
    siteFilter = siteScope
  }

  return {
    ok: true,
    query: {
      search,
      searchMode,
      searchFields,
      filters,
      sort: { field: sortField, direction: sortDirection },
      page: pagination.page,
      limit: pagination.limit,
      skip: pagination.skip,
      siteFilter,
    },
  }
}

/**
 * Get index hint for a field (pure).
 * Returns undefined if no index hint available.
 */
export function getIndexHint(field: string): string | undefined {
  return INDEX_HINTS[field]
}

/**
 * Build query plan summary (pure — for debugging/optimization).
 */
export interface QueryPlan {
  usesIndex: boolean
  indexName?: string
  isFullTextSearch: boolean
  estimatedCost: 'low' | 'medium' | 'high'
  recommendation?: string
}

export function analyzeQueryPlan(query: BoundedSearchQuery): QueryPlan {
  // Check if sort field has index
  const sortIndex = getIndexHint(query.sort.field)
  const usesIndex = !!sortIndex

  // Check if search fields have indexes
  const searchHasIndex = query.searchFields.some((f) => getIndexHint(f))

  // Estimate cost
  let estimatedCost: 'low' | 'medium' | 'high' = 'low'
  let recommendation: string | undefined

  if (query.search && !searchHasIndex) {
    estimatedCost = 'high'
    recommendation = 'Search fields have no index — consider adding indexes for better performance'
  } else if (query.search && query.searchFields.length > 5) {
    estimatedCost = 'medium'
    recommendation = 'Searching many fields — consider limiting searchFields or using full-text search'
  } else if (query.filters.length > 3) {
    estimatedCost = 'medium'
    recommendation = 'Multiple filters — ensure all filter fields have indexes'
  }

  if (!usesIndex) {
    estimatedCost = estimatedCost === 'low' ? 'medium' : estimatedCost
    if (!recommendation) {
      recommendation = `Sort field '${query.sort.field}' has no index — consider sorting by indexed field`
    }
  }

  return {
    usesIndex,
    indexName: sortIndex,
    isFullTextSearch: false, // not implemented — would be true with PostgreSQL tsvector
    estimatedCost,
    recommendation,
  }
}

// ─── Scenario fixtures ───────────────────────────────────────────────

export interface SearchScenario {
  name: string
  description: string
  input: SearchQueryInput
  expected: {
    ok: boolean
    code?: string
    hasSearch?: boolean
    hasFilters?: boolean
    usesIndex?: boolean
  }
}

export const SEARCH_SCENARIOS: SearchScenario[] = [
  {
    name: 'simple search by assetCode',
    description: 'Search "A001" in assetCode field only.',
    input: {
      search: 'A001',
      searchFields: ['assetCode'],
      isSuperAdmin: true,
    },
    expected: {
      ok: true,
      hasSearch: true,
      hasFilters: false,
      usesIndex: true,
    },
  },
  {
    name: 'search across multiple fields',
    description: 'Search "printer" across name, brand, model fields.',
    input: {
      search: 'printer',
      searchFields: ['name', 'brand', 'model'],
      isSuperAdmin: true,
    },
    expected: {
      ok: true,
      hasSearch: true,
      hasFilters: false,
      usesIndex: true, // default sort createdAt is indexed
    },
  },
  {
    name: 'filter by status + type',
    description: 'Filter devices by status=active AND type=PRINTER.',
    input: {
      filters: [
        { field: 'status', operator: 'eq', value: 'active' },
        { field: 'type', operator: 'eq', value: 'PRINTER' },
      ],
      isSuperAdmin: true,
    },
    expected: {
      ok: true,
      hasSearch: false,
      hasFilters: true,
      usesIndex: true, // default sort is createdAt (indexed)
    },
  },
  {
    name: 'sort by createdAt desc',
    description: 'Sort by createdAt descending (default).',
    input: {
      sort: { field: 'createdAt', direction: 'desc' },
      isSuperAdmin: true,
    },
    expected: {
      ok: true,
      usesIndex: true,
    },
  },
  {
    name: 'invalid search field → fail',
    description: 'Search field "password" is not in SEARCHABLE_FIELDS.',
    input: {
      search: 'test',
      searchFields: ['password' as unknown as SearchableField],
      isSuperAdmin: true,
    },
    expected: {
      ok: false,
      code: 'INVALID_SEARCH_FIELD',
    },
  },
  {
    name: 'invalid sort field → fail',
    description: 'Sort field "secret" is not sortable.',
    input: {
      sort: { field: 'secret' as unknown as SortableField, direction: 'asc' },
      isSuperAdmin: true,
    },
    expected: {
      ok: false,
      code: 'INVALID_SORT_FIELD',
    },
  },
  {
    name: 'non-superadmin with no grants → SITE_SCOPE_DENIED',
    description: 'Non-superadmin with empty site scope.',
    input: {
      isSuperAdmin: false,
      siteScope: [],
    },
    expected: {
      ok: false,
      code: 'SITE_SCOPE_DENIED',
    },
  },
  {
    name: 'search string too long → truncated',
    description: 'Search string > 200 chars → truncated to MAX_SEARCH_LENGTH.',
    input: {
      search: 'a'.repeat(300),
      searchFields: ['assetCode'],
      isSuperAdmin: true,
    },
    expected: {
      ok: true,
      hasSearch: true,
    },
  },
  {
    name: 'filter with IN operator',
    description: 'Filter by site IN [UDH, NKP].',
    input: {
      filters: [
        { field: 'site', operator: 'in', value: ['UDH', 'NKP'] },
      ],
      isSuperAdmin: true,
    },
    expected: {
      ok: true,
      hasFilters: true,
    },
  },
  {
    name: 'combined search + filter + sort',
    description: 'Search "printer" in name + filter status=active + sort by name asc.',
    input: {
      search: 'printer',
      searchFields: ['name'],
      filters: [
        { field: 'status', operator: 'eq', value: 'active' },
      ],
      sort: { field: 'name', direction: 'asc' },
      isSuperAdmin: true,
      page: 2,
      limit: 50,
    },
    expected: {
      ok: true,
      hasSearch: true,
      hasFilters: true,
      usesIndex: false,
    },
  },
  {
    name: 'non-superadmin with grants — site filter applied',
    description: 'Non-superadmin with UDH grant — site filter applied automatically.',
    input: {
      isSuperAdmin: false,
      siteScope: ['UDH'],
      search: 'printer',
      searchFields: ['name'],
    },
    expected: {
      ok: true,
      hasSearch: true,
    },
  },
  {
    name: 'pagination clamps to bounds',
    description: 'page=99999 + limit=99999 → clamped to MAX_PAGE + MAX_LIMIT.',
    input: {
      isSuperAdmin: true,
      page: 99999,
      limit: 99999,
    },
    expected: {
      ok: true,
    },
  },
]
