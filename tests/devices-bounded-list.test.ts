// ============================================================
// Devices Module — Bounded List tests (pure functions, no DB)
// ============================================================
// Module: Devices (Dev-3 / Asset & Meter Team)
// Work Package: C — parallel preparation
//
// Coverage:
//   clampPageAndLimit:
//     - default values when missing
//     - page < 1 → 1
//     - page > maxPage → maxPage
//     - limit < 1 → 1
//     - limit > maxLimit → maxLimit
//     - NaN → defaults
//     - Infinity → maxLimit
//     - skip calculation correct
//
//   buildPaginationMeta:
//     - total=0 → totalPages=0, hasNextPage=false, hasPrevPage=false
//     - total=1, page=1, limit=100 → totalPages=1
//     - total=250, page=3, limit=100 → totalPages=3, hasNextPage=false, hasPrevPage=true
//     - truncated when total > MAX_TOTAL_ENUMERABLE
//
//   DEVICE_LIST_FIELDS:
//     - no excluded (sensitive) fields present
//     - all fields are `true` (Prisma select syntax)
//
//   DEVICE_MOBILE_LIST_FIELDS:
//     - subset of DEVICE_LIST_FIELDS
//     - no sensitive fields
//
//   emptyListResponse:
//     - correct shape with meta
//
// Governance: B4 frozen files untouched. No `prisma db:push`.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  clampPageAndLimit,
  buildPaginationMeta,
  emptyListResponse,
  isExcludedField,
  getDeviceListFields,
  DEVICE_LIST_FIELDS,
  DEVICE_MOBILE_LIST_FIELDS,
  DEVICE_LIST_EXCLUDED_FIELDS,
  DEVICE_LIST_BOUNDS,
} from '@/lib/devices-bounded-list'

describe('clampPageAndLimit', () => {
  it('returns defaults when no options provided', () => {
    const result = clampPageAndLimit({})
    expect(result.page).toBe(DEVICE_LIST_BOUNDS.DEFAULT_PAGE)
    expect(result.limit).toBe(DEVICE_LIST_BOUNDS.DEFAULT_LIMIT)
    expect(result.skip).toBe(0)
  })

  it('clamps page < 1 to 1', () => {
    const result = clampPageAndLimit({ page: 0, limit: 100 })
    expect(result.page).toBe(1)
    expect(result.skip).toBe(0)
  })

  it('clamps negative page to 1', () => {
    const result = clampPageAndLimit({ page: -5, limit: 100 })
    expect(result.page).toBe(1)
  })

  it('clamps page > maxPage to maxPage', () => {
    const result = clampPageAndLimit({ page: 999_999, limit: 100 })
    expect(result.page).toBe(DEVICE_LIST_BOUNDS.MAX_PAGE)
  })

  it('clamps limit < 1 to 1', () => {
    const result = clampPageAndLimit({ page: 1, limit: 0 })
    expect(result.limit).toBe(1)
  })

  it('clamps limit > maxLimit to maxLimit', () => {
    const result = clampPageAndLimit({ page: 1, limit: 999_999 })
    expect(result.limit).toBe(DEVICE_LIST_BOUNDS.MAX_LIMIT)
  })

  it('handles NaN by returning defaults', () => {
    const result = clampPageAndLimit({ page: NaN, limit: NaN })
    expect(result.page).toBe(DEVICE_LIST_BOUNDS.DEFAULT_PAGE)
    expect(result.limit).toBe(DEVICE_LIST_BOUNDS.DEFAULT_LIMIT)
  })

  it('handles Infinity by returning defaults (safer than max)', () => {
    const result = clampPageAndLimit({ page: Infinity, limit: Infinity })
    expect(result.page).toBe(DEVICE_LIST_BOUNDS.DEFAULT_PAGE)
    expect(result.limit).toBe(DEVICE_LIST_BOUNDS.DEFAULT_LIMIT)
  })

  it('calculates skip correctly', () => {
    expect(clampPageAndLimit({ page: 1, limit: 100 }).skip).toBe(0)
    expect(clampPageAndLimit({ page: 2, limit: 100 }).skip).toBe(100)
    expect(clampPageAndLimit({ page: 3, limit: 50 }).skip).toBe(100)
    expect(clampPageAndLimit({ page: 10, limit: 25 }).skip).toBe(225)
  })

  it('respects custom maxLimit', () => {
    const result = clampPageAndLimit({ page: 1, limit: 999_999, maxLimit: 50 })
    expect(result.limit).toBe(50)
  })

  it('respects custom maxPage', () => {
    const result = clampPageAndLimit({ page: 999_999, limit: 100, maxPage: 100 })
    expect(result.page).toBe(100)
  })

  it('floors fractional values', () => {
    const result = clampPageAndLimit({ page: 2.9, limit: 50.7 })
    expect(result.page).toBe(2)
    expect(result.limit).toBe(50)
  })
})

describe('buildPaginationMeta', () => {
  it('total=0 → totalPages=0, no next/prev', () => {
    const meta = buildPaginationMeta(0, 1, 100)
    expect(meta.total).toBe(0)
    expect(meta.totalPages).toBe(0)
    expect(meta.hasNextPage).toBe(false)
    expect(meta.hasPrevPage).toBe(false)
    expect(meta.truncated).toBe(false)
  })

  it('total=1, page=1, limit=100 → totalPages=1', () => {
    const meta = buildPaginationMeta(1, 1, 100)
    expect(meta.totalPages).toBe(1)
    expect(meta.hasNextPage).toBe(false)
    expect(meta.hasPrevPage).toBe(false)
  })

  it('total=250, page=2, limit=100 → totalPages=3, has both next/prev', () => {
    const meta = buildPaginationMeta(250, 2, 100)
    expect(meta.totalPages).toBe(3)
    expect(meta.hasNextPage).toBe(true)
    expect(meta.hasPrevPage).toBe(true)
  })

  it('total=250, page=3, limit=100 → totalPages=3, no next, has prev', () => {
    const meta = buildPaginationMeta(250, 3, 100)
    expect(meta.totalPages).toBe(3)
    expect(meta.hasNextPage).toBe(false)
    expect(meta.hasPrevPage).toBe(true)
  })

  it('total=100, page=1, limit=100 → totalPages=1, no next/prev', () => {
    const meta = buildPaginationMeta(100, 1, 100)
    expect(meta.totalPages).toBe(1)
    expect(meta.hasNextPage).toBe(false)
    expect(meta.hasPrevPage).toBe(false)
  })

  it('total=101, page=1, limit=100 → totalPages=2, has next', () => {
    const meta = buildPaginationMeta(101, 1, 100)
    expect(meta.totalPages).toBe(2)
    expect(meta.hasNextPage).toBe(true)
    expect(meta.hasPrevPage).toBe(false)
  })

  it('truncated=true when total exceeds MAX_TOTAL_ENUMERABLE', () => {
    const meta = buildPaginationMeta(
      DEVICE_LIST_BOUNDS.MAX_TOTAL_ENUMERABLE + 1,
      1,
      100,
    )
    expect(meta.truncated).toBe(true)
  })

  it('truncated=false when total equals MAX_TOTAL_ENUMERABLE', () => {
    const meta = buildPaginationMeta(
      DEVICE_LIST_BOUNDS.MAX_TOTAL_ENUMERABLE,
      1,
      100,
    )
    expect(meta.truncated).toBe(false)
  })
})

describe('DEVICE_LIST_FIELDS', () => {
  it('does not include excluded (sensitive) fields', () => {
    for (const excluded of DEVICE_LIST_EXCLUDED_FIELDS) {
      expect(DEVICE_LIST_FIELDS).not.toHaveProperty(excluded)
    }
  })

  it('all field values are true (Prisma select syntax)', () => {
    for (const [key, value] of Object.entries(DEVICE_LIST_FIELDS)) {
      expect(value).toBe(true)
      expect(key).toBeTruthy()
    }
  })

  it('includes essential fields for list view', () => {
    const essential = ['id', 'assetCode', 'name', 'type', 'status', 'site']
    for (const field of essential) {
      expect(DEVICE_LIST_FIELDS).toHaveProperty(field)
    }
  })
})

describe('DEVICE_MOBILE_LIST_FIELDS', () => {
  it('is a subset of DEVICE_LIST_FIELDS (no new fields)', () => {
    for (const key of Object.keys(DEVICE_MOBILE_LIST_FIELDS)) {
      expect(DEVICE_LIST_FIELDS).toHaveProperty(key)
    }
  })

  it('does not include excluded (sensitive) fields', () => {
    for (const excluded of DEVICE_LIST_EXCLUDED_FIELDS) {
      expect(DEVICE_MOBILE_LIST_FIELDS).not.toHaveProperty(excluded)
    }
  })

  it('includes only essential mobile fields (≤ 12 fields)', () => {
    const fieldCount = Object.keys(DEVICE_MOBILE_LIST_FIELDS).length
    expect(fieldCount).toBeLessThanOrEqual(12)
  })

  it('includes id + assetCode + name + status (minimum for mobile card)', () => {
    expect(DEVICE_MOBILE_LIST_FIELDS).toHaveProperty('id')
    expect(DEVICE_MOBILE_LIST_FIELDS).toHaveProperty('assetCode')
    expect(DEVICE_MOBILE_LIST_FIELDS).toHaveProperty('name')
    expect(DEVICE_MOBILE_LIST_FIELDS).toHaveProperty('status')
  })
})

describe('isExcludedField', () => {
  it('returns true for excluded fields', () => {
    expect(isExcludedField('serialNumber')).toBe(true)
    expect(isExcludedField('ip')).toBe(true)
    expect(isExcludedField('mac')).toBe(true)
    expect(isExcludedField('contractNo')).toBe(true)
    expect(isExcludedField('vendor')).toBe(true)
    expect(isExcludedField('purchasePrice')).toBe(true)
  })

  it('returns false for non-excluded fields', () => {
    expect(isExcludedField('id')).toBe(false)
    expect(isExcludedField('assetCode')).toBe(false)
    expect(isExcludedField('name')).toBe(false)
    expect(isExcludedField('site')).toBe(false)
  })
})

describe('getDeviceListFields', () => {
  it('returns full list fields when mobile=false', () => {
    const fields = getDeviceListFields(false)
    expect(fields).toBe(DEVICE_LIST_FIELDS)
  })

  it('returns mobile subset when mobile=true', () => {
    const fields = getDeviceListFields(true)
    expect(fields).toBe(DEVICE_MOBILE_LIST_FIELDS)
  })

  it('defaults to full list when no argument', () => {
    const fields = getDeviceListFields()
    expect(fields).toBe(DEVICE_LIST_FIELDS)
  })
})

describe('emptyListResponse', () => {
  it('returns correct shape with meta', () => {
    const resp = emptyListResponse(1, 100)
    expect(resp.devices).toEqual([])
    expect(resp.total).toBe(0)
    expect(resp.page).toBe(1)
    expect(resp.limit).toBe(100)
    expect(resp.totalPages).toBe(0)
    expect(resp.meta).toMatchObject({
      page: 1,
      limit: 100,
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
      truncated: false,
    })
  })

  it('works with different page/limit', () => {
    const resp = emptyListResponse(5, 50)
    expect(resp.page).toBe(5)
    expect(resp.limit).toBe(50)
  })
})

describe('Bounds constants', () => {
  it('MAX_LIMIT is 500 (matches existing route limit)', () => {
    expect(DEVICE_LIST_BOUNDS.MAX_LIMIT).toBe(500)
  })

  it('DEFAULT_LIMIT is 100', () => {
    expect(DEVICE_LIST_BOUNDS.DEFAULT_LIMIT).toBe(100)
  })

  it('MAX_PAGE is finite (prevents deep pagination)', () => {
    expect(DEVICE_LIST_BOUNDS.MAX_PAGE).toBeLessThan(Number.MAX_SAFE_INTEGER)
    expect(DEVICE_LIST_BOUNDS.MAX_PAGE).toBeGreaterThan(0)
  })

  it('MAX_TOTAL_ENUMERABLE is finite', () => {
    expect(DEVICE_LIST_BOUNDS.MAX_TOTAL_ENUMERABLE).toBeLessThan(Number.MAX_SAFE_INTEGER)
    expect(DEVICE_LIST_BOUNDS.MAX_TOTAL_ENUMERABLE).toBeGreaterThan(0)
  })
})
