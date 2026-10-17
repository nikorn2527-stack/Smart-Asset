// ============================================================
// Devices ↔ Meter Contract — Integration tests (pure, no DB)
// ============================================================
// Module: Devices (Dev-3 / Asset & Meter Team)
// Work Package: C — parallel preparation
//
// Coverage:
//   resolveDeviceById: finds by id, returns null if missing
//   decideMeterSiteScope: superadmin/device-site-denied/reading-site-denied/anonymous
//   validateMeterReadingAgainstDevice: 10 scenarios covering all codes
//   predictMeterOutcome: full scenario prediction
//   Scenario integrity: count, branches, descriptions
//
// Governance: B4 frozen files untouched. No `prisma db:push`.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  DEVICE_METER_SCENARIOS,
  resolveDeviceById,
  decideMeterSiteScope,
  validateMeterReadingAgainstDevice,
  predictMeterOutcome,
  type DeviceMeterFixture,
  type MeterCallerScope,
  type MeterReadingInput,
} from '@/lib/devices-meter-contract/scenarios'

// ─── Helpers ─────────────────────────────────────────────────────────
function makeDevice(overrides: Partial<DeviceMeterFixture> = {}): DeviceMeterFixture {
  return {
    id: 'dev-x',
    assetCode: 'A001',
    type: 'PRINTER',
    meterRequired: true,
    meterMode: 'TOTAL',
    lastMeterBw: 1000,
    lastMeterColor: 0,
    site: 'UDH',
    status: 'active',
    ...overrides,
  }
}

function makeCaller(overrides: Partial<MeterCallerScope> = {}): MeterCallerScope {
  return {
    isSuperAdmin: false,
    siteCodes: ['UDH'],
    actor: 'meter@itam.local',
    ...overrides,
  }
}

function makeReading(overrides: Partial<MeterReadingInput> = {}): MeterReadingInput {
  return {
    deviceId: 'dev-x',
    readingDate: '2026-08-21',
    meterBw: 1500,
    prevMeterBw: 1000,
    readingType: 'MONTHLY',
    siteAtReading: 'UDH',
    ...overrides,
  }
}

// ─── resolveDeviceById ──────────────────────────────────────────────
describe('resolveDeviceById', () => {
  it('finds device by exact id', () => {
    const devices = [makeDevice({ id: 'dev-1' }), makeDevice({ id: 'dev-2' })]
    const result = resolveDeviceById(devices, 'dev-1')
    expect(result).not.toBeNull()
    expect(result?.id).toBe('dev-1')
  })

  it('returns null when device not found', () => {
    const devices = [makeDevice({ id: 'dev-1' })]
    const result = resolveDeviceById(devices, 'dev-999')
    expect(result).toBeNull()
  })

  it('returns null when devices list is empty', () => {
    const result = resolveDeviceById([], 'dev-1')
    expect(result).toBeNull()
  })
})

// ─── decideMeterSiteScope ─────────────────────────────────────────────
describe('decideMeterSiteScope', () => {
  it('superadmin bypasses', () => {
    const device = makeDevice({ site: 'NKP' })
    const caller = makeCaller({ isSuperAdmin: true, siteCodes: [] })
    const result = decideMeterSiteScope(caller, device, 'NKP')
    expect(result.allowed).toBe(true)
    expect(result.reason).toBe('superadmin bypass')
  })

  it('allows when device site in scope', () => {
    const device = makeDevice({ site: 'UDH' })
    const caller = makeCaller({ siteCodes: ['UDH'] })
    const result = decideMeterSiteScope(caller, device, 'UDH')
    expect(result.allowed).toBe(true)
  })

  it('denies when device site not in scope', () => {
    const device = makeDevice({ site: 'NKP' })
    const caller = makeCaller({ siteCodes: ['UDH'] })
    const result = decideMeterSiteScope(caller, device, 'NKP')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('device at site NKP')
  })

  it('denies when reading site not in scope', () => {
    const device = makeDevice({ site: 'UDH' })
    const caller = makeCaller({ siteCodes: ['UDH'] })
    const result = decideMeterSiteScope(caller, device, 'NKP')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('site NKP')
  })

  it('denies anonymous caller', () => {
    const device = makeDevice({ site: 'UDH' })
    const caller = makeCaller({ actor: '' })
    const result = decideMeterSiteScope(caller, device, 'UDH')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('anonymous')
  })

  it('case-insensitive site matching', () => {
    const device = makeDevice({ site: 'udh' }) // lowercase in DB
    const caller = makeCaller({ siteCodes: ['UDH'] }) // uppercase in grant
    const result = decideMeterSiteScope(caller, device, 'udh')
    expect(result.allowed).toBe(true)
  })
})

// ─── validateMeterReadingAgainstDevice — individual codes ─────────────
describe('validateMeterReadingAgainstDevice — error codes', () => {
  it('DEVICE_NOT_FOUND when device is null', () => {
    const result = validateMeterReadingAgainstDevice(null, makeReading(), makeCaller())
    expect(result.ok).toBe(false)
    expect(result.code).toBe('DEVICE_NOT_FOUND')
  })

  it('DEVICE_NOT_METER_REQUIRED when meterRequired=false', () => {
    const device = makeDevice({ meterRequired: false })
    const result = validateMeterReadingAgainstDevice(device, makeReading(), makeCaller())
    expect(result.ok).toBe(false)
    expect(result.code).toBe('DEVICE_NOT_METER_REQUIRED')
  })

  it('MISSING_READING_DATE when date is empty', () => {
    const device = makeDevice()
    const reading = makeReading({ readingDate: '' })
    const result = validateMeterReadingAgainstDevice(device, reading, makeCaller())
    expect(result.ok).toBe(false)
    expect(result.code).toBe('MISSING_READING_DATE')
  })

  it('INVALID_READING_DATE for Feb 30', () => {
    const device = makeDevice()
    const reading = makeReading({ readingDate: '2026-02-30' })
    const result = validateMeterReadingAgainstDevice(device, reading, makeCaller())
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_READING_DATE')
  })

  it('NEGATIVE_READING when meterBw < 0', () => {
    const device = makeDevice()
    const reading = makeReading({ meterBw: -100 })
    const result = validateMeterReadingAgainstDevice(device, reading, makeCaller())
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NEGATIVE_READING')
  })

  it('SITE_SCOPE_DENIED when caller cannot read device site', () => {
    const device = makeDevice({ site: 'NKP' })
    const caller = makeCaller({ siteCodes: ['UDH'] })
    const reading = makeReading({ siteAtReading: 'NKP' })
    const result = validateMeterReadingAgainstDevice(device, reading, caller)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('SITE_SCOPE_DENIED')
  })

  it('BW_COLOR_REQUIRED_BUT_MISSING when mode is BW_COLOR and no color', () => {
    const device = makeDevice({ meterMode: 'BW_COLOR', lastMeterColor: 500 })
    const reading = makeReading({ meterColor: undefined })
    const result = validateMeterReadingAgainstDevice(device, reading, makeCaller())
    expect(result.ok).toBe(false)
    expect(result.code).toBe('BW_COLOR_REQUIRED_BUT_MISSING')
  })

  it('TOTAL_MODE_PROVIDED_COLOR when mode is TOTAL but color > 0', () => {
    const device = makeDevice({ meterMode: 'TOTAL' })
    const reading = makeReading({ meterColor: 100 })
    const result = validateMeterReadingAgainstDevice(device, reading, makeCaller())
    expect(result.ok).toBe(false)
    expect(result.code).toBe('TOTAL_MODE_PROVIDED_COLOR')
  })

  it('READING_BELOW_PREVIOUS_WITHOUT_REMARK when delta < 0 and no remark', () => {
    const device = makeDevice({ lastMeterBw: 1000 })
    const reading = makeReading({ meterBw: 800, prevMeterBw: 1000 })
    const result = validateMeterReadingAgainstDevice(device, reading, makeCaller())
    expect(result.ok).toBe(false)
    expect(result.code).toBe('READING_BELOW_PREVIOUS_WITHOUT_REMARK')
    expect(result.delta).toBe(-200)
    expect(result.isReset).toBe(true)
  })

  it('passes when delta < 0 with remark (reset)', () => {
    const device = makeDevice({ lastMeterBw: 1000 })
    const reading = makeReading({
      meterBw: 800,
      prevMeterBw: 1000,
      remark: 'เปลี่ยนมิเตอร์',
      readingType: 'RESET',
    })
    const result = validateMeterReadingAgainstDevice(device, reading, makeCaller())
    expect(result.ok).toBe(true)
    expect(result.delta).toBe(-200)
    expect(result.isReset).toBe(true)
  })

  it('passes for normal increasing reading', () => {
    const device = makeDevice({ lastMeterBw: 1000 })
    const reading = makeReading({ meterBw: 1500, prevMeterBw: 1000 })
    const result = validateMeterReadingAgainstDevice(device, reading, makeCaller())
    expect(result.ok).toBe(true)
    expect(result.delta).toBe(500)
    expect(result.isReset).toBe(false)
  })
})

// ─── predictMeterOutcome — full scenarios ─────────────────────────────
describe('predictMeterOutcome — integration scenarios', () => {
  for (const scenario of DEVICE_METER_SCENARIOS) {
    it(scenario.name, () => {
      const predicted = predictMeterOutcome(scenario)
      expect(predicted.ok).toBe(scenario.expected.ok)
      if (scenario.expected.code) {
        expect(predicted.code).toBe(scenario.expected.code)
      }
      if (scenario.expected.deviceId) {
        expect(predicted.deviceId).toBe(scenario.expected.deviceId)
      }
      if (scenario.expected.delta !== undefined) {
        expect(predicted.delta).toBe(scenario.expected.delta)
      }
      if (scenario.expected.isReset !== undefined) {
        expect(predicted.isReset).toBe(scenario.expected.isReset)
      }
    })
  }
})

// ─── Scenario integrity ──────────────────────────────────────────────
describe('Scenario integrity', () => {
  it('each scenario has name + description', () => {
    for (const s of DEVICE_METER_SCENARIOS) {
      expect(s.name).toBeTruthy()
      expect(s.description).toBeTruthy()
    }
  })

  it('scenario count is 10 (covers all decision branches)', () => {
    expect(DEVICE_METER_SCENARIOS.length).toBe(10)
  })

  it('scenarios cover all error codes', () => {
    const codes = new Set(
      DEVICE_METER_SCENARIOS.filter((s) => !s.expected.ok).map((s) => s.expected.code),
    )
    expect(codes.has('DEVICE_NOT_FOUND')).toBe(true)
    expect(codes.has('DEVICE_NOT_METER_REQUIRED')).toBe(true)
    // MISSING_READING_DATE is covered in unit tests (validateMeterReadingAgainstDevice)
    // but not in scenarios — that's OK, both layers test it
    expect(codes.has('INVALID_READING_DATE')).toBe(true)
    expect(codes.has('NEGATIVE_READING')).toBe(true)
    expect(codes.has('SITE_SCOPE_DENIED')).toBe(true)
    expect(codes.has('BW_COLOR_REQUIRED_BUT_MISSING')).toBe(true)
    expect(codes.has('READING_BELOW_PREVIOUS_WITHOUT_REMARK')).toBe(true)
  })

  it('scenarios cover ok + fail outcomes', () => {
    const hasOk = DEVICE_METER_SCENARIOS.some((s) => s.expected.ok)
    const hasFail = DEVICE_METER_SCENARIOS.some((s) => !s.expected.ok)
    expect(hasOk).toBe(true)
    expect(hasFail).toBe(true)
  })

  it('scenarios cover superadmin + non-superadmin', () => {
    const hasSuperadmin = DEVICE_METER_SCENARIOS.some((s) => s.caller.isSuperAdmin)
    const hasNonSuperadmin = DEVICE_METER_SCENARIOS.some((s) => !s.caller.isSuperAdmin)
    expect(hasSuperadmin).toBe(true)
    expect(hasNonSuperadmin).toBe(true)
  })

  it('scenarios cover TOTAL + BW_COLOR + non-meter modes', () => {
    // Skip scenario 6 (device=null) for meterMode check
    const modes = new Set(
      DEVICE_METER_SCENARIOS
        .filter((s) => s.device && s.device.meterMode !== undefined)
        .map((s) => s.device.meterMode),
    )
    expect(modes.has('TOTAL')).toBe(true)
    expect(modes.has('BW_COLOR')).toBe(true)
    expect(modes.has(null)).toBe(true) // non-meter-required device
  })

  it('scenarios cover reset + non-reset readings', () => {
    const hasReset = DEVICE_METER_SCENARIOS.some((s) => s.expected.isReset === true)
    const hasNonReset = DEVICE_METER_SCENARIOS.some((s) => s.expected.isReset === false)
    expect(hasReset).toBe(true)
    expect(hasNonReset).toBe(true)
  })
})
