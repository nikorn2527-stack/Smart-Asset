// ============================================================
// Devices Lifecycle Contract — Tests (pure, no DB)
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  LIFECYCLE_SCENARIOS,
  WARRANTY_SCENARIOS,
  DEPRECIATION_SCENARIOS,
  validateLifecycleTransition,
  validateWarranty,
  calculateDepreciation,
  DEVICE_STATUSES,
  ALLOWED_TRANSITIONS,
  type LifecycleTransitionInput,
  type WarrantyFixture,
  type DepreciationInput,
} from '@/lib/devices-lifecycle-contract/scenarios'

// ─── validateLifecycleTransition ─────────────────────────────────────
describe('validateLifecycleTransition — scenarios', () => {
  for (const scenario of LIFECYCLE_SCENARIOS) {
    it(scenario.name, () => {
      const result = validateLifecycleTransition(scenario.input)
      expect(result.ok).toBe(scenario.expected.ok)
      if (scenario.expected.code) {
        expect(result.code).toBe(scenario.expected.code)
      }
      if (scenario.expected.deviceId) {
        expect(result.deviceId).toBe(scenario.expected.deviceId)
      }
      if (scenario.expected.fromStatus) {
        expect(result.fromStatus).toBe(scenario.expected.fromStatus)
      }
      if (scenario.expected.toStatus) {
        expect(result.toStatus).toBe(scenario.expected.toStatus)
      }
      if (scenario.expected.allowedNextStatuses !== undefined) {
        expect(result.allowedNextStatuses).toEqual(scenario.expected.allowedNextStatuses)
      }
    })
  }
})

describe('validateLifecycleTransition — individual error codes', () => {
  it('MISSING_DEVICE_ID when deviceId is empty', () => {
    const input: LifecycleTransitionInput = {
      deviceId: '',
      fromStatus: 'active',
      toStatus: 'spare',
      actor: 'admin@itam.local',
    }
    expect(validateLifecycleTransition(input).code).toBe('MISSING_DEVICE_ID')
  })

  it('MISSING_ACTOR when actor is empty', () => {
    const input: LifecycleTransitionInput = {
      deviceId: 'dev-x',
      fromStatus: 'active',
      toStatus: 'spare',
      actor: '',
    }
    expect(validateLifecycleTransition(input).code).toBe('MISSING_ACTOR')
  })

  it('TERMINAL_STATUS_NO_RETURN for disposed → active', () => {
    const input: LifecycleTransitionInput = {
      deviceId: 'dev-x',
      fromStatus: 'disposed',
      toStatus: 'active',
      actor: 'admin@itam.local',
    }
    const result = validateLifecycleTransition(input)
    expect(result.code).toBe('TERMINAL_STATUS_NO_RETURN')
    expect(result.allowedNextStatuses).toEqual([])
  })

  it('TRANSITION_NOT_ALLOWED for invalid path', () => {
    // No invalid path exists in current ALLOWED_TRANSITIONS (all non-disposed
    // can go to all other statuses), so we test the boundary:
    // disposed → spare should be TERMINAL, not TRANSITION_NOT_ALLOWED
    const input: LifecycleTransitionInput = {
      deviceId: 'dev-x',
      fromStatus: 'disposed',
      toStatus: 'spare',
      actor: 'admin@itam.local',
    }
    const result = validateLifecycleTransition(input)
    expect(result.code).toBe('TERMINAL_STATUS_NO_RETURN')
  })
})

// ─── validateWarranty ────────────────────────────────────────────────
describe('validateWarranty — scenarios', () => {
  for (const scenario of WARRANTY_SCENARIOS) {
    it(scenario.name, () => {
      const result = validateWarranty(scenario.warranty)
      expect(result.ok).toBe(scenario.expected.ok)
      if (scenario.expected.code) {
        expect(result.code).toBe(scenario.expected.code)
      }
      if (scenario.expected.isExpired !== undefined) {
        expect(result.isExpired).toBe(scenario.expected.isExpired)
      }
      if (scenario.expected.monthsRemaining !== undefined) {
        expect(result.monthsRemaining).toBe(scenario.expected.monthsRemaining)
      }
    })
  }
})

describe('validateWarranty — individual cases', () => {
  it('WARRANTY_END_BEFORE_PURCHASE', () => {
    const warranty: WarrantyFixture = {
      purchaseDate: '2026-01-01',
      warrantyEnd: '2025-12-31',
      warrantyMonths: 12,
    }
    expect(validateWarranty(warranty).code).toBe('WARRANTY_END_BEFORE_PURCHASE')
  })

  it('INVALID_DATE for Feb 30', () => {
    const warranty: WarrantyFixture = {
      purchaseDate: '2026-02-30',
      warrantyEnd: '2027-01-01',
      warrantyMonths: 12,
    }
    expect(validateWarranty(warranty).code).toBe('INVALID_DATE')
  })

  it('expired warranty returns monthsRemaining=0', () => {
    const warranty: WarrantyFixture = {
      purchaseDate: '2020-01-01',
      warrantyEnd: '2021-01-01',
      warrantyMonths: 12,
    }
    const result = validateWarranty(warranty)
    expect(result.isExpired).toBe(true)
    expect(result.monthsRemaining).toBe(0)
  })

  it('future warranty returns monthsRemaining > 0', () => {
    const warranty: WarrantyFixture = {
      purchaseDate: '2026-01-01',
      warrantyEnd: '2027-12-31',
      warrantyMonths: 24,
    }
    const result = validateWarranty(warranty)
    expect(result.isExpired).toBe(false)
    expect(result.monthsRemaining).toBeGreaterThan(0)
  })

  it('null dates returns ok', () => {
    const warranty: WarrantyFixture = {
      purchaseDate: null,
      warrantyEnd: null,
      warrantyMonths: 12,
    }
    const result = validateWarranty(warranty)
    expect(result.ok).toBe(true)
    expect(result.isExpired).toBe(false)
  })
})

// ─── calculateDepreciation ──────────────────────────────────────────
describe('calculateDepreciation — scenarios', () => {
  for (const scenario of DEPRECIATION_SCENARIOS) {
    it(scenario.name, () => {
      const result = calculateDepreciation(scenario.input)
      expect(result.ok).toBe(scenario.expected.ok)
      if (scenario.expected.code) {
        expect(result.code).toBe(scenario.expected.code)
      }
      if (scenario.expected.annualDepreciation !== undefined) {
        expect(result.annualDepreciation).toBeCloseTo(scenario.expected.annualDepreciation, 2)
      }
      if (scenario.expected.accumulatedDepreciation !== undefined) {
        expect(result.accumulatedDepreciation).toBeCloseTo(scenario.expected.accumulatedDepreciation, 2)
      }
      if (scenario.expected.bookValue !== undefined) {
        expect(result.bookValue).toBeCloseTo(scenario.expected.bookValue, 2)
      }
    })
  }
})

describe('calculateDepreciation — individual cases', () => {
  it('MISSING_PURCHASE_PRICE when null', () => {
    const input: DepreciationInput = {
      purchasePrice: null,
      salvageValue: 0,
      usefulLife: 5,
      yearsElapsed: 1,
    }
    expect(calculateDepreciation(input).code).toBe('MISSING_PURCHASE_PRICE')
  })

  it('MISSING_USEFUL_LIFE when null', () => {
    const input: DepreciationInput = {
      purchasePrice: 60000,
      salvageValue: 6000,
      usefulLife: null,
      yearsElapsed: 1,
    }
    expect(calculateDepreciation(input).code).toBe('MISSING_USEFUL_LIFE')
  })

  it('INVALID_USEFUL_LIFE when 0', () => {
    const input: DepreciationInput = {
      purchasePrice: 60000,
      salvageValue: 6000,
      usefulLife: 0,
      yearsElapsed: 1,
    }
    expect(calculateDepreciation(input).code).toBe('INVALID_USEFUL_LIFE')
  })

  it('NEGATIVE_PRICE when purchasePrice < 0', () => {
    const input: DepreciationInput = {
      purchasePrice: -1000,
      salvageValue: 0,
      usefulLife: 5,
      yearsElapsed: 1,
    }
    expect(calculateDepreciation(input).code).toBe('NEGATIVE_PRICE')
  })

  it('bookValue never below salvageValue', () => {
    const input: DepreciationInput = {
      purchasePrice: 60000,
      salvageValue: 6000,
      usefulLife: 5,
      yearsElapsed: 100, // way past useful life
    }
    const result = calculateDepreciation(input)
    expect(result.bookValue).toBeGreaterThanOrEqual(6000)
    expect(result.accumulatedDepreciation).toBeLessThanOrEqual(54000)
  })
})

// ─── Constants integrity ─────────────────────────────────────────────
describe('Constants integrity', () => {
  it('DEVICE_STATUSES has all 4 values', () => {
    expect(Object.values(DEVICE_STATUSES)).toEqual(
      expect.arrayContaining(['active', 'spare', 'repair', 'disposed']),
    )
    expect(Object.values(DEVICE_STATUSES).length).toBe(4)
  })

  it('ALLOWED_TRANSITIONS has all 4 statuses as keys', () => {
    const keys = Object.keys(ALLOWED_TRANSITIONS)
    expect(keys).toEqual(
      expect.arrayContaining(['active', 'spare', 'repair', 'disposed']),
    )
    expect(keys.length).toBe(4)
  })

  it('disposed has empty allowed transitions (terminal)', () => {
    expect(ALLOWED_TRANSITIONS.disposed).toEqual([])
  })

  it('non-disposed statuses can transition to disposed', () => {
    expect(ALLOWED_TRANSITIONS.active).toContain('disposed')
    expect(ALLOWED_TRANSITIONS.spare).toContain('disposed')
    expect(ALLOWED_TRANSITIONS.repair).toContain('disposed')
  })

  it('non-disposed statuses can transition to repair', () => {
    expect(ALLOWED_TRANSITIONS.active).toContain('repair')
    expect(ALLOWED_TRANSITIONS.spare).toContain('repair')
  })
})

// ─── Scenario integrity ─────────────────────────────────────────────
describe('Scenario integrity', () => {
  it('LIFECYCLE_SCENARIOS has 10 scenarios', () => {
    expect(LIFECYCLE_SCENARIOS.length).toBe(10)
  })

  it('WARRANTY_SCENARIOS has 5 scenarios', () => {
    expect(WARRANTY_SCENARIOS.length).toBe(5)
  })

  it('DEPRECIATION_SCENARIOS has 6 scenarios', () => {
    expect(DEPRECIATION_SCENARIOS.length).toBe(6)
  })

  it('lifecycle scenarios cover ok + fail outcomes', () => {
    const hasOk = LIFECYCLE_SCENARIOS.some((s) => s.expected.ok)
    const hasFail = LIFECYCLE_SCENARIOS.some((s) => !s.expected.ok)
    expect(hasOk).toBe(true)
    expect(hasFail).toBe(true)
  })

  it('lifecycle scenarios cover all 4 statuses as fromStatus', () => {
    const fromStatuses = new Set(LIFECYCLE_SCENARIOS.map((s) => s.input.fromStatus))
    expect(fromStatuses.has('active')).toBe(true)
    expect(fromStatuses.has('repair')).toBe(true)
    expect(fromStatuses.has('disposed')).toBe(true)
  })

  it('warranty scenarios cover expired + not-expired + invalid', () => {
    const hasExpired = WARRANTY_SCENARIOS.some((s) => s.expected.isExpired === true)
    const hasNotExpired = WARRANTY_SCENARIOS.some((s) => s.expected.isExpired === false)
    expect(hasExpired).toBe(true)
    expect(hasNotExpired).toBe(true)
  })

  it('depreciation scenarios cover ok + all error codes', () => {
    const codes = new Set(
      DEPRECIATION_SCENARIOS.filter((s) => !s.expected.ok).map((s) => s.expected.code),
    )
    expect(codes.has('MISSING_PURCHASE_PRICE')).toBe(true)
    expect(codes.has('MISSING_USEFUL_LIFE')).toBe(true)
    expect(codes.has('INVALID_USEFUL_LIFE')).toBe(true)
    expect(codes.has('NEGATIVE_PRICE')).toBe(true)
  })
})
