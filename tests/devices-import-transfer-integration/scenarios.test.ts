// ============================================================
// Devices Importer ↔ Transfer — Integration tests (pure, no DB)
// ============================================================
// Module: Devices (Dev-3 / Asset & Meter Team)
// Work Package: C — parallel preparation
//
// Coverage:
//   - resolveDeviceByAssetCode: case-insensitive lookup, not-found
//   - decideTransferSiteScope: superadmin, both-in-scope, from-denied, to-denied, anonymous
//   - decideMeterRequired: not-required, with-reading, with-ack, missing-both
//   - predictTransferOutcome: full scenario prediction (8 scenarios)
//   - Scenario integrity: each scenario has consistent initial state
//
// Governance:
//   - B4 frozen files untouched
//   - No SYNC_RUN permission added
//   - No schema/migration changes
//   - No DB required (pure functions, mocked where needed)
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  INTEGRATION_SCENARIOS,
  resolveDeviceByAssetCode,
  decideTransferSiteScope,
  decideMeterRequired,
  predictTransferOutcome,
  type DeviceFixture,
  type CallerScopeFixture,
  type TransferRequestBody,
  type IntegrationScenario,
} from '@/lib/devices-import-transfer-integration/scenarios'

// ─── Helper: build a minimal device fixture ─────────────────────────
function makeDevice(overrides: Partial<DeviceFixture> = {}): DeviceFixture {
  return {
    id: 'dev-x',
    assetCode: 'A001',
    name: 'Test Device',
    brand: 'TestBrand',
    model: 'TestModel',
    type: 'PRINTER',
    status: 'active',
    site: 'UDH',
    meterRequired: false,
    meterMode: null,
    lastMeterBw: 0,
    lastMeterColor: 0,
    department: null,
    location: null,
    ...overrides,
  }
}

// ─── Helper: build a minimal caller scope ───────────────────────────
function makeCaller(overrides: Partial<CallerScopeFixture> = {}): CallerScopeFixture {
  return {
    isSuperAdmin: false,
    siteCodes: ['UDH'],
    actor: 'editor@itam.local',
    ...overrides,
  }
}

// ─── Helper: build a minimal transfer body ───────────────────────────
function makeTransferBody(overrides: Partial<TransferRequestBody> = {}): TransferRequestBody {
  return {
    toSite: 'UDH',
    ...overrides,
  }
}

// ─── resolveDeviceByAssetCode ────────────────────────────────────────
describe('resolveDeviceByAssetCode', () => {
  it('finds device by exact assetCode', () => {
    const devices = [makeDevice({ assetCode: 'A001' })]
    const result = resolveDeviceByAssetCode(devices, 'A001')
    expect(result).not.toBeNull()
    expect(result?.assetCode).toBe('A001')
  })

  it('finds device case-insensitively', () => {
    const devices = [makeDevice({ assetCode: 'A001' })]
    const result = resolveDeviceByAssetCode(devices, 'a001')
    expect(result).not.toBeNull()
    expect(result?.assetCode).toBe('A001')
  })

  it('finds device when DB has lowercase but query is uppercase', () => {
    const devices = [makeDevice({ assetCode: 'a001' })]
    const result = resolveDeviceByAssetCode(devices, 'A001')
    expect(result).not.toBeNull()
    expect(result?.assetCode).toBe('a001')
  })

  it('returns null when device not found', () => {
    const devices = [makeDevice({ assetCode: 'A001' })]
    const result = resolveDeviceByAssetCode(devices, 'A999')
    expect(result).toBeNull()
  })

  it('returns null when devices list is empty', () => {
    const result = resolveDeviceByAssetCode([], 'A001')
    expect(result).toBeNull()
  })

  it('returns the first match when duplicates exist (should not happen in practice due to unique constraint)', () => {
    const devices = [
      makeDevice({ id: 'dev-1', assetCode: 'A001' }),
      makeDevice({ id: 'dev-2', assetCode: 'A001' }),
    ]
    const result = resolveDeviceByAssetCode(devices, 'A001')
    expect(result?.id).toBe('dev-1')
  })
})

// ─── decideTransferSiteScope ──────────────────────────────────────────
describe('decideTransferSiteScope', () => {
  it('superadmin bypasses scope check', () => {
    const device = makeDevice({ site: 'UDH' })
    const caller = makeCaller({ isSuperAdmin: true, siteCodes: [] })
    const result = decideTransferSiteScope(caller, device, 'NKP')
    expect(result.allowed).toBe(true)
    expect(result.reason).toBe('superadmin bypass')
  })

  it('allows when both from-site and to-site in caller scope', () => {
    const device = makeDevice({ site: 'UDH' })
    const caller = makeCaller({ siteCodes: ['UDH', 'NKP'] })
    const result = decideTransferSiteScope(caller, device, 'NKP')
    expect(result.allowed).toBe(true)
    expect(result.reason).toBe('both sites in caller scope')
  })

  it('denies when from-site not in caller scope', () => {
    const device = makeDevice({ site: 'NKP' })
    const caller = makeCaller({ siteCodes: ['UDH'] })
    const result = decideTransferSiteScope(caller, device, 'UDH')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('source site NKP')
  })

  it('denies when to-site not in caller scope', () => {
    const device = makeDevice({ site: 'UDH' })
    const caller = makeCaller({ siteCodes: ['UDH'] })
    const result = decideTransferSiteScope(caller, device, 'NKP')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('target site NKP')
  })

  it('denies anonymous caller (empty actor)', () => {
    const device = makeDevice({ site: 'UDH' })
    const caller = makeCaller({ actor: '' })
    const result = decideTransferSiteScope(caller, device, 'UDH')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('anonymous')
  })

  it('case-insensitive site matching', () => {
    const device = makeDevice({ site: 'udh' }) // lowercase in DB
    const caller = makeCaller({ siteCodes: ['UDH'] }) // uppercase in grant
    const result = decideTransferSiteScope(caller, device, 'nkp')
    expect(result.allowed).toBe(false) // nkp not in scope
    const result2 = decideTransferSiteScope(caller, device, 'udh')
    expect(result2.allowed).toBe(true) // same site, case-insensitive
  })

  it('allows transfer within same site', () => {
    const device = makeDevice({ site: 'UDH' })
    const caller = makeCaller({ siteCodes: ['UDH'] })
    const result = decideTransferSiteScope(caller, device, 'UDH')
    expect(result.allowed).toBe(true)
  })
})

// ─── decideMeterRequired ─────────────────────────────────────────────
describe('decideMeterRequired', () => {
  it('not required when device.meterRequired is false', () => {
    const device = makeDevice({ meterRequired: false })
    const body = makeTransferBody()
    const result = decideMeterRequired(device, body)
    expect(result.required).toBe(false)
    expect(result.satisfied).toBe(true)
  })

  it('required + satisfied when meterReadingId provided', () => {
    const device = makeDevice({ meterRequired: true })
    const body = makeTransferBody({ meterReadingId: 'reading-001' })
    const result = decideMeterRequired(device, body)
    expect(result.required).toBe(true)
    expect(result.satisfied).toBe(true)
    expect(result.reason).toContain('reading provided')
  })

  it('required + satisfied when meterSkipAcknowledged is true', () => {
    const device = makeDevice({ meterRequired: true })
    const body = makeTransferBody({ meterSkipAcknowledged: true })
    const result = decideMeterRequired(device, body)
    expect(result.required).toBe(true)
    expect(result.satisfied).toBe(true)
    expect(result.reason).toContain('acknowledged')
  })

  it('required + NOT satisfied when neither reading nor ack', () => {
    const device = makeDevice({ meterRequired: true })
    const body = makeTransferBody() // no meterReadingId, no ack
    const result = decideMeterRequired(device, body)
    expect(result.required).toBe(true)
    expect(result.satisfied).toBe(false)
    expect(result.reason).toContain('no reading or ack')
  })

  it('skipMeterReason alone does NOT satisfy meter requirement', () => {
    const device = makeDevice({ meterRequired: true })
    const body = makeTransferBody({ skipMeterReason: 'meter continues' })
    const result = decideMeterRequired(device, body)
    expect(result.required).toBe(true)
    expect(result.satisfied).toBe(false)
  })
})

// ─── predictTransferOutcome (full scenario prediction) ───────────────
describe('predictTransferOutcome — integration scenarios', () => {
  for (const scenario of INTEGRATION_SCENARIOS) {
    it(scenario.name, () => {
      const predicted = predictTransferOutcome(scenario)
      expect(predicted.httpStatus).toBe(scenario.expected.httpStatus)
      if (scenario.expected.errorCode) {
        expect(predicted.errorCode).toBe(scenario.expected.errorCode)
      }
      if (scenario.expected.errorMessageContains) {
        expect(predicted.errorMessageContains).toBe(
          scenario.expected.errorMessageContains,
        )
      }
      if (scenario.expected.deviceSiteAfter) {
        expect(predicted.deviceSiteAfter).toBe(scenario.expected.deviceSiteAfter)
      }
      if (scenario.expected.auditAction) {
        expect(predicted.auditAction).toBe(scenario.expected.auditAction)
      }
      expect(predicted.createsLocationHistory).toBe(
        scenario.expected.createsLocationHistory,
      )
      expect(predicted.createsDeviceTransfer).toBe(
        scenario.expected.createsDeviceTransfer,
      )
    })
  }
})

// ─── Scenario integrity ───────────────────────────────────────────────
describe('Scenario integrity', () => {
  it('each scenario has a name + description', () => {
    for (const s of INTEGRATION_SCENARIOS) {
      expect(s.name).toBeTruthy()
      expect(s.description).toBeTruthy()
    }
  })

  it('each scenario has at least one initial device', () => {
    for (const s of INTEGRATION_SCENARIOS) {
      expect(s.initialDevices.length).toBeGreaterThan(0)
    }
  })

  it('each scenario has a non-empty targetAssetCode', () => {
    for (const s of INTEGRATION_SCENARIOS) {
      expect(s.targetAssetCode).toBeTruthy()
    }
  })

  it('each scenario has a non-empty transferBody.toSite', () => {
    for (const s of INTEGRATION_SCENARIOS) {
      expect(s.transferBody.toSite).toBeTruthy()
    }
  })

  it('each scenario has a caller with actor (except superadmin scenarios where actor may be any)', () => {
    for (const s of INTEGRATION_SCENARIOS) {
      // superadmin can have empty actor in fixtures, but non-superadmin must have actor
      if (!s.caller.isSuperAdmin) {
        expect(s.caller.actor).toBeTruthy()
      }
    }
  })

  it('all assetCodes in initialDevices are unique per scenario', () => {
    for (const s of INTEGRATION_SCENARIOS) {
      const codes = s.initialDevices.map((d) => d.assetCode)
      const unique = new Set(codes)
      expect(unique.size).toBe(codes.length)
    }
  })

  it('scenario count is 8 (covers all decision branches)', () => {
    expect(INTEGRATION_SCENARIOS.length).toBe(8)
  })

  it('scenarios cover 200 / 400 / 403 / 404 outcomes', () => {
    const statuses = new Set(
      INTEGRATION_SCENARIOS.map((s) => s.expected.httpStatus),
    )
    expect(statuses.has(200)).toBe(true)
    expect(statuses.has(400)).toBe(true)
    expect(statuses.has(403)).toBe(true)
    expect(statuses.has(404)).toBe(true)
  })

  it('scenarios cover superadmin + non-superadmin callers', () => {
    const hasSuperadmin = INTEGRATION_SCENARIOS.some(
      (s) => s.caller.isSuperAdmin,
    )
    const hasNonSuperadmin = INTEGRATION_SCENARIOS.some(
      (s) => !s.caller.isSuperAdmin,
    )
    expect(hasSuperadmin).toBe(true)
    expect(hasNonSuperadmin).toBe(true)
  })

  it('scenarios cover meter-required + not-required devices', () => {
    const hasMeterRequired = INTEGRATION_SCENARIOS.some(
      (s) => s.initialDevices[0].meterRequired,
    )
    const hasNotRequired = INTEGRATION_SCENARIOS.some(
      (s) => !s.initialDevices[0].meterRequired,
    )
    expect(hasMeterRequired).toBe(true)
    expect(hasNotRequired).toBe(true)
  })
})
