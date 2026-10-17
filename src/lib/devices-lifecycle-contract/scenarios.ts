// ============================================================
// Devices Lifecycle Contract — Validation scenarios (pure)
// ============================================================
// Module: Devices (Dev-3 / Asset & Meter Team)
// Work Package: C — parallel preparation
//
// Purpose: validation scenarios for device lifecycle transitions.
//   - Status transitions: active → spare → repair → disposed
//   - Warranty expiry detection
//   - Depreciation calculation (straight-line)
//   - Lifecycle audit fields (action, actor, timestamp)
//
// Contract under test:
//   - Device.status must be one of: active, spare, repair, disposed
//   - Transition must follow allowed paths (e.g. disposed cannot go back to active)
//   - Warranty end date must be after purchase date if both provided
//   - Depreciation = (purchasePrice - salvageValue) / usefulLife per year
//   - Lifecycle transition requires actor (authenticated session)
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
 * Canonical device status values (lowercase).
 */
export const DEVICE_STATUSES = {
  ACTIVE: 'active',
  SPARE: 'spare',
  REPAIR: 'repair',
  DISPOSED: 'disposed',
} as const

export type DeviceStatus = (typeof DEVICE_STATUSES)[keyof typeof DEVICE_STATUSES]

/**
 * Allowed status transitions.
 * Key = from status, Value = array of allowed to statuses.
 *
 * Rules:
 *   active → spare | repair | disposed
 *   spare → active | repair | disposed
 *   repair → active | spare | disposed
 *   disposed → (terminal — no transitions allowed)
 */
export const ALLOWED_TRANSITIONS: Record<DeviceStatus, DeviceStatus[]> = {
  active: ['spare', 'repair', 'disposed'],
  spare: ['active', 'repair', 'disposed'],
  repair: ['active', 'spare', 'disposed'],
  disposed: [], // terminal
}

/**
 * Lifecycle transition input.
 */
export interface LifecycleTransitionInput {
  deviceId: string
  fromStatus: string
  toStatus: string
  actor: string // authenticated user identity
  reason?: string | null
  timestamp?: string // ISO datetime
}

/**
 * Lifecycle validation result.
 */
export interface LifecycleValidationResult {
  ok: boolean
  code?:
    | 'MISSING_DEVICE_ID'
    | 'MISSING_ACTOR'
    | 'INVALID_FROM_STATUS'
    | 'INVALID_TO_STATUS'
    | 'TRANSITION_NOT_ALLOWED'
    | 'TERMINAL_STATUS_NO_RETURN'
  deviceId?: string
  fromStatus?: string
  toStatus?: string
  allowedNextStatuses?: DeviceStatus[]
}

/**
 * Warranty fixture for a device.
 */
export interface WarrantyFixture {
  purchaseDate: string | null // ISO date
  warrantyEnd: string | null // ISO date
  warrantyMonths: number
}

/**
 * Warranty validation result.
 */
export interface WarrantyValidationResult {
  ok: boolean
  code?: 'WARRANTY_END_BEFORE_PURCHASE' | 'INVALID_DATE'
  isExpired?: boolean
  monthsRemaining?: number
}

/**
 * Depreciation input.
 */
export interface DepreciationInput {
  purchasePrice: number | null
  salvageValue: number
  usefulLife: number | null // years
  yearsElapsed: number
}

/**
 * Depreciation result.
 */
export interface DepreciationResult {
  ok: boolean
  code?: 'MISSING_PURCHASE_PRICE' | 'MISSING_USEFUL_LIFE' | 'INVALID_USEFUL_LIFE' | 'NEGATIVE_PRICE'
  annualDepreciation?: number
  accumulatedDepreciation?: number
  bookValue?: number
}

// ─── Pure helpers ────────────────────────────────────────────────────

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function isValidStatus(status: string): status is DeviceStatus {
  return Object.values(DEVICE_STATUSES).includes(status as DeviceStatus)
}

/**
 * Validate a lifecycle transition (pure — no DB).
 */
export function validateLifecycleTransition(
  input: LifecycleTransitionInput,
): LifecycleValidationResult {
  if (!input.deviceId?.trim()) {
    return { ok: false, code: 'MISSING_DEVICE_ID' }
  }
  if (!input.actor?.trim()) {
    return { ok: false, code: 'MISSING_ACTOR', deviceId: input.deviceId }
  }
  if (!isValidStatus(input.fromStatus)) {
    return {
      ok: false,
      code: 'INVALID_FROM_STATUS',
      deviceId: input.deviceId,
      fromStatus: input.fromStatus,
    }
  }
  if (!isValidStatus(input.toStatus)) {
    return {
      ok: false,
      code: 'INVALID_TO_STATUS',
      deviceId: input.deviceId,
      toStatus: input.toStatus,
    }
  }
  // Same status = no-op, allowed
  if (input.fromStatus === input.toStatus) {
    return {
      ok: true,
      deviceId: input.deviceId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
    }
  }
  const allowed = ALLOWED_TRANSITIONS[input.fromStatus]
  if (!allowed.includes(input.toStatus)) {
    return {
      ok: false,
      code: input.fromStatus === 'disposed'
        ? 'TERMINAL_STATUS_NO_RETURN'
        : 'TRANSITION_NOT_ALLOWED',
      deviceId: input.deviceId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      allowedNextStatuses: allowed,
    }
  }
  return {
    ok: true,
    deviceId: input.deviceId,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
  }
}

/**
 * Validate warranty dates (pure — no DB).
 */
export function validateWarranty(warranty: WarrantyFixture): WarrantyValidationResult {
  const { purchaseDate, warrantyEnd } = warranty
  if (purchaseDate && !isValidIsoDate(purchaseDate)) {
    return { ok: false, code: 'INVALID_DATE' }
  }
  if (warrantyEnd && !isValidIsoDate(warrantyEnd)) {
    return { ok: false, code: 'INVALID_DATE' }
  }
  if (purchaseDate && warrantyEnd) {
    if (new Date(warrantyEnd) < new Date(purchaseDate)) {
      return { ok: false, code: 'WARRANTY_END_BEFORE_PURCHASE' }
    }
  }
  // Check expiry if warrantyEnd provided
  let isExpired = false
  let monthsRemaining: number | undefined
  if (warrantyEnd) {
    const now = new Date()
    const end = new Date(warrantyEnd)
    isExpired = end < now
    if (!isExpired) {
      const diffMs = end.getTime() - now.getTime()
      monthsRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 30))
    } else {
      monthsRemaining = 0
    }
  }
  return { ok: true, isExpired, monthsRemaining }
}

/**
 * Calculate depreciation (straight-line method, pure — no DB).
 *
 * Formula:
 *   annualDepreciation = (purchasePrice - salvageValue) / usefulLife
 *   accumulatedDepreciation = annualDepreciation * yearsElapsed
 *   bookValue = purchasePrice - accumulatedDepreciation
 *
 * Edge cases:
 *   - Missing purchasePrice → MISSING_PURCHASE_PRICE
 *   - Missing usefulLife → MISSING_USEFUL_LIFE
 *   - usefulLife ≤ 0 → INVALID_USEFUL_LIFE
 *   - purchasePrice < 0 → NEGATIVE_PRICE
 */
export function calculateDepreciation(
  input: DepreciationInput,
): DepreciationResult {
  if (input.purchasePrice === null || input.purchasePrice === undefined) {
    return { ok: false, code: 'MISSING_PURCHASE_PRICE' }
  }
  if (input.purchasePrice < 0) {
    return { ok: false, code: 'NEGATIVE_PRICE' }
  }
  if (input.usefulLife === null || input.usefulLife === undefined) {
    return { ok: false, code: 'MISSING_USEFUL_LIFE' }
  }
  if (input.usefulLife <= 0) {
    return { ok: false, code: 'INVALID_USEFUL_LIFE' }
  }
  const annualDepreciation =
    (input.purchasePrice - input.salvageValue) / input.usefulLife
  const accumulatedDepreciation = Math.min(
    annualDepreciation * input.yearsElapsed,
    input.purchasePrice - input.salvageValue,
  )
  const bookValue = input.purchasePrice - accumulatedDepreciation
  return {
    ok: true,
    annualDepreciation,
    accumulatedDepreciation,
    bookValue: Math.max(bookValue, input.salvageValue),
  }
}

// ─── Scenario fixtures ───────────────────────────────────────────────

export interface LifecycleScenario {
  name: string
  description: string
  input: LifecycleTransitionInput
  expected: LifecycleValidationResult
}

export const LIFECYCLE_SCENARIOS: LifecycleScenario[] = [
  {
    name: 'active → spare (allowed)',
    description: 'Device moves from active to spare status.',
    input: {
      deviceId: 'dev-001',
      fromStatus: 'active',
      toStatus: 'spare',
      actor: 'admin@itam.local',
      reason: 'Device not in use',
    },
    expected: { ok: true, deviceId: 'dev-001', fromStatus: 'active', toStatus: 'spare' },
  },
  {
    name: 'active → repair (allowed)',
    description: 'Device sent for repair.',
    input: {
      deviceId: 'dev-002',
      fromStatus: 'active',
      toStatus: 'repair',
      actor: 'admin@itam.local',
      reason: 'Needs repair',
    },
    expected: { ok: true, deviceId: 'dev-002', fromStatus: 'active', toStatus: 'repair' },
  },
  {
    name: 'repair → active (allowed — back from repair)',
    description: 'Device repaired, returns to active.',
    input: {
      deviceId: 'dev-003',
      fromStatus: 'repair',
      toStatus: 'active',
      actor: 'admin@itam.local',
      reason: 'Repair complete',
    },
    expected: { ok: true, deviceId: 'dev-003', fromStatus: 'repair', toStatus: 'active' },
  },
  {
    name: 'disposed → active (NOT allowed — terminal)',
    description: 'Disposed device cannot return to active.',
    input: {
      deviceId: 'dev-004',
      fromStatus: 'disposed',
      toStatus: 'active',
      actor: 'admin@itam.local',
      reason: 'Try to reactivate',
    },
    expected: {
      ok: false,
      code: 'TERMINAL_STATUS_NO_RETURN',
      deviceId: 'dev-004',
      fromStatus: 'disposed',
      toStatus: 'active',
      allowedNextStatuses: [],
    },
  },
  {
    name: 'active → disposed (allowed)',
    description: 'Device disposed of.',
    input: {
      deviceId: 'dev-005',
      fromStatus: 'active',
      toStatus: 'disposed',
      actor: 'admin@itam.local',
      reason: 'End of life',
    },
    expected: { ok: true, deviceId: 'dev-005', fromStatus: 'active', toStatus: 'disposed' },
  },
  {
    name: 'missing actor → fail',
    description: 'No actor provided — anonymous transition denied.',
    input: {
      deviceId: 'dev-006',
      fromStatus: 'active',
      toStatus: 'spare',
      actor: '',
    },
    expected: { ok: false, code: 'MISSING_ACTOR', deviceId: 'dev-006' },
  },
  {
    name: 'missing deviceId → fail',
    description: 'No deviceId provided.',
    input: {
      deviceId: '',
      fromStatus: 'active',
      toStatus: 'spare',
      actor: 'admin@itam.local',
    },
    expected: { ok: false, code: 'MISSING_DEVICE_ID' },
  },
  {
    name: 'invalid from status → fail',
    description: 'Unknown from status.',
    input: {
      deviceId: 'dev-008',
      fromStatus: 'BROKEN',
      toStatus: 'active',
      actor: 'admin@itam.local',
    },
    expected: {
      ok: false,
      code: 'INVALID_FROM_STATUS',
      deviceId: 'dev-008',
      fromStatus: 'BROKEN',
    },
  },
  {
    name: 'invalid to status → fail',
    description: 'Unknown to status.',
    input: {
      deviceId: 'dev-009',
      fromStatus: 'active',
      toStatus: 'RETIRED',
      actor: 'admin@itam.local',
    },
    expected: {
      ok: false,
      code: 'INVALID_TO_STATUS',
      deviceId: 'dev-009',
      toStatus: 'RETIRED',
    },
  },
  {
    name: 'same status (no-op) → allowed',
    description: 'active → active is a no-op but allowed.',
    input: {
      deviceId: 'dev-010',
      fromStatus: 'active',
      toStatus: 'active',
      actor: 'admin@itam.local',
    },
    expected: {
      ok: true,
      deviceId: 'dev-010',
      fromStatus: 'active',
      toStatus: 'active',
    },
  },
]

export interface WarrantyScenario {
  name: string
  description: string
  warranty: WarrantyFixture
  expected: WarrantyValidationResult
}

export const WARRANTY_SCENARIOS: WarrantyScenario[] = [
  {
    name: 'valid warranty — not expired',
    description: 'Purchase 2026-01-01, warranty ends 2027-01-01. monthsRemaining calculated from current date.',
    warranty: {
      purchaseDate: '2026-01-01',
      warrantyEnd: '2027-01-01',
      warrantyMonths: 12,
    },
    expected: { ok: true, isExpired: false }, // monthsRemaining varies by current date
  },
  {
    name: 'warranty expired',
    description: 'Warranty ended in the past.',
    warranty: {
      purchaseDate: '2020-01-01',
      warrantyEnd: '2021-01-01',
      warrantyMonths: 12,
    },
    expected: { ok: true, isExpired: true, monthsRemaining: 0 },
  },
  {
    name: 'warranty end before purchase → fail',
    description: 'Warranty ends before purchase date — invalid.',
    warranty: {
      purchaseDate: '2026-01-01',
      warrantyEnd: '2025-01-01',
      warrantyMonths: 12,
    },
    expected: { ok: false, code: 'WARRANTY_END_BEFORE_PURCHASE' },
  },
  {
    name: 'invalid date format → fail',
    description: 'Invalid date (Feb 30).',
    warranty: {
      purchaseDate: '2026-02-30',
      warrantyEnd: '2027-01-01',
      warrantyMonths: 12,
    },
    expected: { ok: false, code: 'INVALID_DATE' },
  },
  {
    name: 'no dates provided → ok (no validation needed)',
    description: 'Both dates null — skip validation.',
    warranty: {
      purchaseDate: null,
      warrantyEnd: null,
      warrantyMonths: 12,
    },
    expected: { ok: true },
  },
]

export interface DepreciationScenario {
  name: string
  description: string
  input: DepreciationInput
  expected: DepreciationResult
}

export const DEPRECIATION_SCENARIOS: DepreciationScenario[] = [
  {
    name: 'normal depreciation',
    description: 'Price 60000, salvage 6000, life 5 years, 2 years elapsed.',
    input: {
      purchasePrice: 60000,
      salvageValue: 6000,
      usefulLife: 5,
      yearsElapsed: 2,
    },
    expected: {
      ok: true,
      annualDepreciation: 10800,
      accumulatedDepreciation: 21600,
      bookValue: 38400,
    },
  },
  {
    name: 'fully depreciated',
    description: 'Years elapsed >= usefulLife — bookValue = salvageValue.',
    input: {
      purchasePrice: 60000,
      salvageValue: 6000,
      usefulLife: 5,
      yearsElapsed: 10,
    },
    expected: {
      ok: true,
      annualDepreciation: 10800,
      accumulatedDepreciation: 54000,
      bookValue: 6000,
    },
  },
  {
    name: 'missing purchase price → fail',
    description: 'No purchasePrice.',
    input: {
      purchasePrice: null,
      salvageValue: 0,
      usefulLife: 5,
      yearsElapsed: 1,
    },
    expected: { ok: false, code: 'MISSING_PURCHASE_PRICE' },
  },
  {
    name: 'missing useful life → fail',
    description: 'No usefulLife.',
    input: {
      purchasePrice: 60000,
      salvageValue: 6000,
      usefulLife: null,
      yearsElapsed: 1,
    },
    expected: { ok: false, code: 'MISSING_USEFUL_LIFE' },
  },
  {
    name: 'useful life <= 0 → fail',
    description: 'usefulLife = 0.',
    input: {
      purchasePrice: 60000,
      salvageValue: 6000,
      usefulLife: 0,
      yearsElapsed: 1,
    },
    expected: { ok: false, code: 'INVALID_USEFUL_LIFE' },
  },
  {
    name: 'negative purchase price → fail',
    description: 'purchasePrice < 0.',
    input: {
      purchasePrice: -1000,
      salvageValue: 0,
      usefulLife: 5,
      yearsElapsed: 1,
    },
    expected: { ok: false, code: 'NEGATIVE_PRICE' },
  },
]
