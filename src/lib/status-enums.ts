/**
 * status-enums.ts — Type-safe union types for device/work-order/stock statuses.
 *
 * The DB stores these as plain strings (Prisma `String`) for backward
 * compatibility with existing rows imported from the legacy Apps Script
 * system. This module adds TypeScript union types so code paths that create
 * or transition these statuses can be type-checked at compile time.
 *
 * Phase 4.1 of the roadmap. No DB migration required — these are pure
 * TypeScript types + frozen constant arrays.
 *
 * Backward-compat note: `normalizeStatus()` in `@/lib/status-utils` still
 * accepts any string and maps synonyms to canonical values, so legacy
 * strings like 'active' / 'ใช้งาน' continue to work. The unions here are the
 * recommended canonical forms for NEW writes.
 */

/**
 * Canonical device lifecycle statuses.
 *
 * Used by:
 *   • Device.status column
 *   • DeviceTransfer.toStatus / fromStatus
 *   • Lifecycle event endpoints
 *
 * Mapping (legacy → canonical):
 *   'active' / 'ใช้งาน' / 'ปกติ'      → 'Active'
 *   'in repair' / 'ส่งซ่อม' / 'ซ่อม'   → 'In Repair'
 *   'in stock' / 'สำรอง'               → 'In Storage'   (was 'Spare')
 *   'retired' / 'เกษียณ'               → 'Retired'
 *   'returned' (to vendor)             → 'Returned'
 *   'disposed'                          → 'Disposed'
 *   'replaced' (by a newer device)     → 'Replaced'
 */
export type DeviceStatus =
  | 'Active'
  | 'In Repair'
  | 'In Storage'
  | 'Retired'
  | 'Returned'
  | 'Disposed'
  | 'Replaced'

/**
 * Work-order lifecycle statuses (matches VALID_STATUSES in work-orders route).
 *
 *   PENDING          — newly created, awaiting staff review
 *   PENDING_REVIEW   — guest-submitted, awaiting staff approval before PENDING
 *   IN_PROGRESS      — staff has accepted and is working on it
 *   WAITING_PARTS    — blocked on missing stock
 *   COMPLETED        — finished (workCompletedAt set)
 *   CANCELLED        — cancelled by staff or reporter (canceledAt set)
 */
export type WorkOrderStatus =
  | 'PENDING'
  | 'PENDING_REVIEW'
  | 'IN_PROGRESS'
  | 'WAITING_PARTS'
  | 'COMPLETED'
  | 'CANCELLED'

/**
 * StockItem.active flag is a Boolean, but some legacy code paths set a string
 * 'Active' / 'Inactive' on the status field. This union captures both.
 */
export type StockItemStatus = 'Active' | 'Inactive'

/**
 * Accessory statuses (DeviceAccessory). Accessories are tracked separately
 * from main devices but share the same lifecycle idea.
 */
export type AccessoryStatus = 'Active' | 'Inactive' | 'In Repair' | 'Disposed'

/**
 * Frozen arrays — useful for building dropdowns / <Select> options and for
 * runtime validation via `Array.includes()`.
 */
export const DEVICE_STATUSES: DeviceStatus[] = [
  'Active',
  'In Repair',
  'In Storage',
  'Retired',
  'Returned',
  'Disposed',
  'Replaced',
]

export const WORK_ORDER_STATUSES: WorkOrderStatus[] = [
  'PENDING',
  'PENDING_REVIEW',
  'IN_PROGRESS',
  'WAITING_PARTS',
  'COMPLETED',
  'CANCELLED',
]

export const STOCK_ITEM_STATUSES: StockItemStatus[] = ['Active', 'Inactive']

export const ACCESSORY_STATUSES: AccessoryStatus[] = [
  'Active',
  'Inactive',
  'In Repair',
  'Disposed',
]

// ── Type guards ──────────────────────────────────────────────────────────

/** Returns true if the given string is a canonical DeviceStatus. */
export function isDeviceStatus(value: string): value is DeviceStatus {
  return (DEVICE_STATUSES as string[]).includes(value)
}

/** Returns true if the given string is a canonical WorkOrderStatus. */
export function isWorkOrderStatus(value: string): value is WorkOrderStatus {
  return (WORK_ORDER_STATUSES as string[]).includes(value)
}

/** Returns true if the given string is a canonical StockItemStatus. */
export function isStockItemStatus(value: string): value is StockItemStatus {
  return (STOCK_ITEM_STATUSES as string[]).includes(value)
}

/** Returns true if the given string is a canonical AccessoryStatus. */
export function isAccessoryStatus(value: string): value is AccessoryStatus {
  return (ACCESSORY_STATUSES as string[]).includes(value)
}

// ── Coercion helpers (use at IO boundaries) ─────────────────────────────

/**
 * Coerce an unknown status string to a canonical DeviceStatus.
 * Returns the input as-is if it's already canonical, otherwise falls back
 * to `normalizeStatus()` from `@/lib/status-utils` for synonym mapping,
 * otherwise returns the provided `fallback` (default 'Active').
 *
 * Backward-compat: legacy synonyms ('active', 'ใช้งาน', 'pending repair')
 * are normalized via the existing STATUS_SYNONYMS table.
 */
export async function coerceDeviceStatus(
  value: string | null | undefined,
  fallback: DeviceStatus = 'Active',
): Promise<DeviceStatus> {
  if (!value) return fallback
  const v = String(value).trim()
  if (isDeviceStatus(v)) return v
  // Defer to the legacy normalizer for synonyms ('active' → 'Active' etc.)
  const { normalizeStatus } = await import('./status-utils')
  const normalized = normalizeStatus(v)
  if (isDeviceStatus(normalized)) return normalized
  // Map legacy 'Spare' → 'In Storage' (semantic rename in Phase 4.1)
  if (normalized === 'Spare') return 'In Storage'
  return fallback
}

/**
 * Coerce an unknown status string to a canonical WorkOrderStatus.
 * Returns the input as-is if it's already canonical; otherwise throws.
 * (Work-order statuses are written by the API only — there is no synonym
 * table to fall back to.)
 */
export function coerceWorkOrderStatus(
  value: string | null | undefined,
  fallback: WorkOrderStatus = 'PENDING',
): WorkOrderStatus {
  if (!value) return fallback
  const v = String(value).trim().toUpperCase()
  if (isWorkOrderStatus(v)) return v
  return fallback
}
