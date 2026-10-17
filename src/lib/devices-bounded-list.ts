// ============================================================
// Devices Module — Bounded list / Query helpers (pure functions)
// ============================================================
// Module: Devices (Dev-3 / Asset & Meter Team)
// Work Package: C — parallel preparation (per PARALLEL NOW order @ 19:00:47Z)
//
// Purpose: pure helpers for bounded device list queries.
//   - Explicit field selection (no IP/MAC/contract in list view)
//   - Hard upper bound on page + limit
//   - Page clamp (page ≥ 1, limit 1..maxLimit)
//   - Pagination metadata builder
//   - Mobile-friendly field subset
//   - Empty/error state helpers
//
// These helpers are PURE — no DB, no I/O, no side effects.
// The HTTP route uses them to build safe, bounded queries.
//
// Governance:
//   - B4 frozen files: NOT touched
//   - SYNC_RUN permission: NOT added
//   - prisma db:push: NOT used
//   - Schema/migration: NOT changed
//   - Does NOT touch PR #29/#35/#38 scope
// ============================================================

/**
 * Hard upper bounds for device list queries.
 * Prevents unbounded memory/CPU on large datasets.
 */
export const DEVICE_LIST_BOUNDS = {
  /** Maximum rows per page. Prevents huge single-page queries. */
  MAX_LIMIT: 500,
  /** Default rows per page when caller doesn't specify. */
  DEFAULT_LIMIT: 100,
  /** Minimum rows per page (must be ≥ 1). */
  MIN_LIMIT: 1,
  /** Default page number (1-based). */
  DEFAULT_PAGE: 1,
  /** Maximum page number. Prevents deep-pagination scans. */
  MAX_PAGE: 10000,
  /** Maximum total rows that can be enumerated via pagination. */
  MAX_TOTAL_ENUMERABLE: 5_000_000,
} as const

/**
 * Field selection for device LIST view.
 * Excludes sensitive fields that should only appear in DETAIL view:
 *   - ip, mac, remoteId (network info — detail only)
 *   - contractNo, vendor, costCenter (commercial — detail only)
 *   - serialNumber (PII — detail only, with permission)
 *
 * Rationale: list view is shown to users with VIEW_DEVICES permission,
 * which is broader than the permission needed to see network/commercial
 * details. Detail view enforces additional permission checks.
 */
export const DEVICE_LIST_FIELDS = {
  id: true,
  assetCode: true,
  name: true,
  brand: true,
  model: true,
  type: true,
  status: true,
  site: true,
  department: true,
  departmentCode: true,
  assetSiteCode: true,
  displayLabel: true,
  location: true,
  building: true,
  floor: true,
  purchaseDate: true,
  warrantyEnd: true,
  warrantyMonths: true,
  meterRequired: true,
  meterMode: true,
  lastMeterBw: true,
  lastMeterColor: true,
  currentAssignee: true, // needed for assignee filter
  isDemo: true,
  createdAt: true,
  updatedAt: true,
  updatedBy: true,
} as const

/**
 * Field subset for MOBILE list view.
 * Mobile screens are small — only show essential fields.
 * Caller passes `?mobile=1` to get this subset.
 */
export const DEVICE_MOBILE_LIST_FIELDS = {
  id: true,
  assetCode: true,
  name: true,
  type: true,
  status: true,
  site: true,
  department: true,
  location: true,
  meterRequired: true,
  // The list route derives lastMeterBw/lastMeterColor for EVERY response (it
  // prefers the latest MeterReading and falls back to these columns). The
  // mobile variant omitted them, so those two properties were `undefined` and
  // the fallback silently degraded to 0. Two non-sensitive integers — include
  // them so desktop and mobile behave identically.
  lastMeterBw: true,
  lastMeterColor: true,
  isDemo: true,
} as const

/**
 * Fields that are EXCLUDED from list view (sensitive / detail-only).
 * Used by tests to verify no leak.
 */
export const DEVICE_LIST_EXCLUDED_FIELDS = [
  'ip',
  'mac',
  'remoteId',
  'contractNo',
  'vendor',
  'serialNumber',
  'costCenter',
  'purchasePrice',
  'salvageValue',
  'usefulLife',
  'remark',
  'parentRef',
  'uninstallDate',
] as const

/**
 * Options for clamping page + limit.
 */
export interface BoundedListOptions {
  page?: number
  limit?: number
  maxLimit?: number
  maxPage?: number
}

/**
 * Result of clamping page + limit.
 */
export interface BoundedListParams {
  page: number
  limit: number
  skip: number
}

/**
 * Clamp page + limit to safe bounds.
 *
 * Pure: no DB, no I/O.
 *
 * Behavior:
 *   - page < 1 → 1
 *   - page > maxPage → maxPage
 *   - limit < 1 → 1
 *   - limit > maxLimit → maxLimit
 *   - NaN → defaults
 *   - Infinity → maxLimit
 */
export function clampPageAndLimit(
  opts: BoundedListOptions = {},
): BoundedListParams {
  const maxLimit = opts.maxLimit ?? DEVICE_LIST_BOUNDS.MAX_LIMIT
  const maxPage = opts.maxPage ?? DEVICE_LIST_BOUNDS.MAX_PAGE

  const rawPage = Number(opts.page ?? DEVICE_LIST_BOUNDS.DEFAULT_PAGE)
  const rawLimit = Number(opts.limit ?? DEVICE_LIST_BOUNDS.DEFAULT_LIMIT)

  // NaN → default; Infinity → max
  const safePage = Number.isFinite(rawPage) ? rawPage : DEVICE_LIST_BOUNDS.DEFAULT_PAGE
  const safeLimit = Number.isFinite(rawLimit) ? rawLimit : DEVICE_LIST_BOUNDS.DEFAULT_LIMIT

  // Clamp
  const page = Math.max(
    DEVICE_LIST_BOUNDS.DEFAULT_PAGE,
    Math.min(maxPage, Math.floor(safePage)),
  )
  const limit = Math.max(
    DEVICE_LIST_BOUNDS.MIN_LIMIT,
    Math.min(maxLimit, Math.floor(safeLimit)),
  )

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  }
}

/**
 * Pagination metadata returned to caller.
 */
export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
  /** True if total exceeds MAX_TOTAL_ENUMERABLE — caller cannot enumerate all rows. */
  truncated: boolean
}

/**
 * Build pagination metadata from total count + page + limit.
 *
 * Pure: no DB, no I/O.
 */
export function buildPaginationMeta(
  total: number,
  page: number,
  limit: number,
): PaginationMeta {
  const totalPages = total > 0 ? Math.ceil(total / limit) : 0
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    truncated: total > DEVICE_LIST_BOUNDS.MAX_TOTAL_ENUMERABLE,
  }
}

/**
 * Standard empty response shape.
 * Used when site scope yields no devices, or when filters return nothing.
 */
export function emptyListResponse(page: number, limit: number) {
  return {
    devices: [],
    total: 0,
    page,
    limit,
    totalPages: 0,
    meta: buildPaginationMeta(0, page, limit),
  }
}

/**
 * Standard error response shape for list endpoint.
 * Used when DB query fails, auth fails, etc.
 */
export function errorListResponse(message: string, status: number) {
  return {
    error: message,
    status,
    meta: null,
  }
}

/**
 * Check if a field name is in the excluded (sensitive) list.
 * Used by tests to verify no leak.
 */
export function isExcludedField(fieldName: string): boolean {
  return (DEVICE_LIST_EXCLUDED_FIELDS as readonly string[]).includes(fieldName)
}

/**
 * Get the appropriate field selection based on `mobile` query param.
 *
 * Pure: no DB.
 */
export function getDeviceListFields(mobile: boolean = false) {
  return mobile ? DEVICE_MOBILE_LIST_FIELDS : DEVICE_LIST_FIELDS
}
