/**
 * status-utils.ts — Canonical device status normalization.
 *
 * Bug DATA-06 from QA report: data set has Active, ACTIVE, active, Inactive,
 * INACTIVE, In Repair, ซ่อม, ปกติ, ใช้งาน — all meaning the same things.
 * This helper normalizes any variant to a canonical value.
 *
 * Phase 4.1: the canonical status unions now also live in `@/lib/status-enums`
 * as the type-safe `DeviceStatus` / `WorkOrderStatus` / etc. unions. This
 * file keeps the runtime synonym table + `normalizeStatus()` (which still
 * accepts any string) so existing callers — including CSV importers and
 * legacy `/api/meter` writes — don't break. New code SHOULD prefer the
 * unions from `@/lib/status-enums` when creating or transitioning statuses.
 */

import type {
  DeviceStatus,
  WorkOrderStatus,
  StockItemStatus,
  AccessoryStatus,
} from '@/lib/status-enums'

export type { DeviceStatus, WorkOrderStatus, StockItemStatus, AccessoryStatus }

export const CANONICAL_STATUS_VALUES = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  IN_REPAIR: 'In Repair',
  SPARE: 'Spare',
  RETIRED: 'Retired',
  LOST: 'Lost',
} as const

export type CanonicalStatus = typeof CANONICAL_STATUS_VALUES[keyof typeof CANONICAL_STATUS_VALUES]

const STATUS_SYNONYMS: Record<string, CanonicalStatus> = {
  // Active variants
  active: 'Active',
  'active ': 'Active',
  'ใช้งาน': 'Active',
  'ใช้งานอยู่': 'Active',
  'ปกติ': 'Active',
  ok: 'Active',
  ready: 'Active',
  in_use: 'Active',
  inuse: 'Active',
  // Inactive variants
  inactive: 'Inactive',
  'ไม่ใช้งาน': 'Inactive',
  'ไม่ได้ใช้': 'Inactive',
  disabled: 'Inactive',
  offline: 'Inactive',
  // In Repair variants
  'in repair': 'In Repair',
  inrepair: 'In Repair',
  repair: 'In Repair',
  'ส่งซ่อม': 'In Repair',
  'ซ่อม': 'In Repair',
  maintenance: 'In Repair',
  'under repair': 'In Repair',
  // Spare variants
  spare: 'Spare',
  'สำรอง': 'Spare',
  backup: 'Spare',
  // Retired variants
  retired: 'Retired',
  'เกษียณ': 'Retired',
  disposed: 'Retired',
  // Lost variants
  lost: 'Lost',
  'สูญหาย': 'Lost',
  missing: 'Lost',
}

/**
 * Normalize any status string to canonical form.
 * Returns the input as-is if no synonym matches (so we don't lose data).
 */
export function normalizeStatus(raw: string | null | undefined): string {
  if (!raw) return ''
  const key = String(raw).trim().toLowerCase()
  return STATUS_SYNONYMS[key] ?? String(raw).trim()
}

/**
 * Check whether a status represents an "active" device.
 * Case-insensitive, handles Thai + English variants.
 */
export function isActiveStatus(status: string | null | undefined): boolean {
  if (!status) return false
  return normalizeStatus(status) === 'Active'
}

/**
 * Get a list of all canonical active status values (for Prisma where clauses).
 * Use: `where: { status: { in: ACTIVE_STATUS_VARIANTS } }`
 */
export const ACTIVE_STATUS_VARIANTS = ['Active', 'ACTIVE', 'active', 'ใช้งาน', 'ใช้งานอยู่', 'ปกติ']

/**
 * Bucketize device status counts into canonical groups.
 * Used by dashboard + reports so KPIs match across modules (bug DATA-01, DATA-02).
 *
 * Input: list of { status: string|null, _count: { status: number } | number } or { status, count }
 * Output: { total, active, inactive, spare, repair, retired, lost, byStatus }
 */
export function bucketizeStatusGroups(
  rows: Array<{
    status: string | null
    _count?: { status: number } | number
    count?: number
  }>,
): {
  total: number
  active: number
  inactive: number
  spare: number
  repair: number
  retired: number
  lost: number
  byStatus: Array<{ name: string; value: number; raw: string }>
} {
  const buckets: Record<CanonicalStatus, number> = {
    Active: 0,
    Inactive: 0,
    'In Repair': 0,
    Spare: 0,
    Retired: 0,
    Lost: 0,
  }
  const rawCounts = new Map<string, number>()

  for (const r of rows) {
    // Handle both Prisma groupBy _count object + plain count
    let cnt: number
    if (typeof r._count === 'object' && r._count !== null) {
      cnt = Number((r._count as { status: number }).status ?? 0)
    } else if (typeof r._count === 'number') {
      cnt = Number(r._count)
    } else {
      cnt = Number(r.count ?? 0)
    }
    if (!Number.isFinite(cnt)) continue
    const canonical = normalizeStatus(r.status) as CanonicalStatus
    if (canonical in buckets) {
      buckets[canonical] += cnt
    } else {
      // Unknown status — group into Inactive as fallback
      buckets.Inactive += cnt
    }
    rawCounts.set(canonical, (rawCounts.get(canonical) ?? 0) + cnt)
  }

  const total = Object.values(buckets).reduce((s, v) => s + v, 0)
  const byStatus = Array.from(rawCounts.entries())
    .map(([name, value]) => ({ name, value, raw: name }))
    .sort((a, b) => b.value - a.value)

  return {
    total,
    active: buckets.Active,
    inactive: buckets.Inactive,
    spare: buckets.Spare,
    repair: buckets['In Repair'],
    retired: buckets.Retired,
    lost: buckets.Lost,
    byStatus,
  }
}
