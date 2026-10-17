// ============================================================
// Devices ↔ Meter Contract — Integration scenarios (pure)
// ============================================================
// Module: Devices (Dev-3 / Asset & Meter Team)
// Work Package: C — parallel preparation
//
// Purpose: integration scenarios for the contract between Devices
// module (owns device master + meterRequired flag + lastMeterBw/
// lastMeterColor) and Meter module (owns MeterReading records +
// validation).
//
// Contract under test:
//   - Device.meterRequired → Meter must create reading before transfer
//   - Device.meterMode (TOTAL | BW_COLOR) → Meter must provide correct fields
//   - Device.lastMeterBw + lastMeterColor → Meter uses as previousReading
//   - Device.id → Meter.deviceId FK (canonical identity)
//   - Device.site + Meter.siteAtReading → must match (site scope)
//
// These scenarios are PURE — no DB, no I/O. They describe inputs +
// expected outcomes for the cross-module contract.
//
// Governance:
//   - B4 frozen files: NOT touched
//   - SYNC_RUN permission: NOT added
//   - prisma db:push: NOT used
//   - Schema/migration: NOT changed
//   - Does NOT touch PR #29/#35/#38/#41/#45 scope
// ============================================================

/**
 * Device fixture (minimal fields needed for Meter contract).
 */
export interface DeviceMeterFixture {
  id: string
  assetCode: string
  type: string // PRINTER | SCANNER | COMPUTER | NETWORK | OTHER
  meterRequired: boolean
  meterMode: string | null // TOTAL | BW_COLOR | null
  lastMeterBw: number
  lastMeterColor: number
  site: string
  status: string
}

/**
 * Meter reading input (matches MeterReading schema shape).
 */
export interface MeterReadingInput {
  deviceId: string
  assetCode?: string
  readingDate: string // ISO date
  meterBw?: number
  meterColor?: number
  prevMeterBw?: number
  prevMeterColor?: number
  readingType?: string // MONTHLY | INITIAL | FINAL | RESET | CHECKOUT | SEND_REPAIR | RETURN | TRANSFER | TRANSFER_IN
  readBy?: string
  remark?: string | null
  siteAtReading?: string
}

/**
 * Caller scope for meter reading authorization.
 */
export interface MeterCallerScope {
  isSuperAdmin: boolean
  siteCodes: string[]
  actor: string
}

/**
 * Validation result for meter reading against device contract.
 */
export interface MeterValidationResult {
  ok: boolean
  code?:
    | 'DEVICE_NOT_FOUND'
    | 'DEVICE_NOT_METER_REQUIRED'
    | 'MISSING_READING_DATE'
    | 'INVALID_READING_DATE'
    | 'NEGATIVE_READING'
    | 'READING_BELOW_PREVIOUS_WITHOUT_REMARK'
    | 'SITE_SCOPE_DENIED'
    | 'BW_COLOR_REQUIRED_BUT_MISSING'
    | 'TOTAL_MODE_PROVIDED_COLOR'
  deviceId?: string
  delta?: number
  isReset?: boolean
}

/**
 * Integration scenario for Devices ↔ Meter contract.
 */
export interface DeviceMeterScenario {
  name: string
  description: string
  device: DeviceMeterFixture
  caller: MeterCallerScope
  reading: MeterReadingInput
  expected: MeterValidationResult
}

// ─── Pure helpers (no DB) ───────────────────────────────────────────

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

/**
 * Resolve a device by id (pure — no DB).
 */
export function resolveDeviceById(
  devices: DeviceMeterFixture[],
  deviceId: string,
): DeviceMeterFixture | null {
  return devices.find((d) => d.id === deviceId) ?? null
}

/**
 * Decide site scope for meter reading (pure — no DB).
 */
export function decideMeterSiteScope(
  caller: MeterCallerScope,
  device: DeviceMeterFixture,
  readingSite?: string,
): { allowed: boolean; reason: string } {
  if (caller.isSuperAdmin) {
    return { allowed: true, reason: 'superadmin bypass' }
  }
  if (!caller.actor) {
    return { allowed: false, reason: 'anonymous caller denied' }
  }
  const allowedSites = caller.siteCodes.map((s) => s.toUpperCase())
  const deviceSiteOk = allowedSites.includes(device.site.toUpperCase())
  if (!deviceSiteOk) {
    return {
      allowed: false,
      reason: `caller cannot read device at site ${device.site}`,
    }
  }
  if (readingSite) {
    const readingSiteOk = allowedSites.includes(readingSite.toUpperCase())
    if (!readingSiteOk) {
      return {
        allowed: false,
        reason: `caller cannot read at site ${readingSite}`,
      }
    }
  }
  return { allowed: true, reason: 'site scope ok' }
}

/**
 * Validate a meter reading against device contract (pure — no DB).
 *
 * This is the cross-module validation: Meter module's reading must
 * be consistent with Devices module's device state.
 */
export function validateMeterReadingAgainstDevice(
  device: DeviceMeterFixture | null,
  reading: MeterReadingInput,
  caller: MeterCallerScope,
): MeterValidationResult {
  // Device must exist
  if (!device) {
    return { ok: false, code: 'DEVICE_NOT_FOUND' }
  }

  // Device must require meter
  if (!device.meterRequired) {
    return {
      ok: false,
      code: 'DEVICE_NOT_METER_REQUIRED',
      deviceId: device.id,
    }
  }

  // Reading date required + valid
  if (!reading.readingDate?.trim()) {
    return {
      ok: false,
      code: 'MISSING_READING_DATE',
      deviceId: device.id,
    }
  }
  if (!isValidIsoDate(reading.readingDate)) {
    return {
      ok: false,
      code: 'INVALID_READING_DATE',
      deviceId: device.id,
    }
  }

  // Site scope check
  const scope = decideMeterSiteScope(caller, device, reading.siteAtReading)
  if (!scope.allowed) {
    return {
      ok: false,
      code: 'SITE_SCOPE_DENIED',
      deviceId: device.id,
    }
  }

  // Reading values must be non-negative
  const bw = reading.meterBw ?? 0
  const color = reading.meterColor ?? 0
  if (bw < 0 || color < 0) {
    return {
      ok: false,
      code: 'NEGATIVE_READING',
      deviceId: device.id,
    }
  }

  // Mode-specific validation
  // TOTAL mode: only meterBw matters, meterColor should be 0/null
  // BW_COLOR mode: both meterBw and meterColor required
  if (device.meterMode === 'BW_COLOR') {
    if (reading.meterColor === undefined || reading.meterColor === 0) {
      return {
        ok: false,
        code: 'BW_COLOR_REQUIRED_BUT_MISSING',
        deviceId: device.id,
      }
    }
  }
  if (device.meterMode === 'TOTAL' && reading.meterColor && reading.meterColor > 0) {
    return {
      ok: false,
      code: 'TOTAL_MODE_PROVIDED_COLOR',
      deviceId: device.id,
    }
  }

  // Delta check — if reading below previous, must have remark (reset)
  const prevBw = reading.prevMeterBw ?? device.lastMeterBw
  const prevColor = reading.prevMeterColor ?? device.lastMeterColor
  const deltaBw = bw - prevBw
  const deltaColor = color - prevColor
  const isReset = deltaBw < 0 || deltaColor < 0

  if (isReset && !reading.remark?.trim()) {
    return {
      ok: false,
      code: 'READING_BELOW_PREVIOUS_WITHOUT_REMARK',
      deviceId: device.id,
      delta: deltaBw,
      isReset: true,
    }
  }

  return {
    ok: true,
    deviceId: device.id,
    delta: deltaBw,
    isReset,
  }
}

// ─── Scenario fixtures ───────────────────────────────────────────────

export const DEVICE_METER_SCENARIOS: DeviceMeterScenario[] = [
  // ── Scenario 1: successful monthly reading on TOTAL-mode printer ──
  {
    name: 'successful monthly reading — TOTAL mode printer',
    description:
      'Device with meterRequired=true, meterMode=TOTAL. Caller provides meterBw=1500 (prev=1000). Should pass.',
    device: {
      id: 'dev-001',
      assetCode: 'A001',
      type: 'PRINTER',
      meterRequired: true,
      meterMode: 'TOTAL',
      lastMeterBw: 1000,
      lastMeterColor: 0,
      site: 'UDH',
      status: 'active',
    },
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH'],
      actor: 'meter@itam.local',
    },
    reading: {
      deviceId: 'dev-001',
      readingDate: '2026-08-21',
      meterBw: 1500,
      prevMeterBw: 1000,
      readingType: 'MONTHLY',
      readBy: 'meter@itam.local',
      siteAtReading: 'UDH',
    },
    expected: {
      ok: true,
      deviceId: 'dev-001',
      delta: 500,
      isReset: false,
    },
  },

  // ── Scenario 2: BW_COLOR mode requires color reading ──────────────
  {
    name: 'BW_COLOR mode requires color reading',
    description:
      'Device with meterMode=BW_COLOR. Caller provides only meterBw, no meterColor. Should fail with BW_COLOR_REQUIRED_BUT_MISSING.',
    device: {
      id: 'dev-002',
      assetCode: 'A002',
      type: 'PRINTER',
      meterRequired: true,
      meterMode: 'BW_COLOR',
      lastMeterBw: 1000,
      lastMeterColor: 500,
      site: 'UDH',
      status: 'active',
    },
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH'],
      actor: 'meter@itam.local',
    },
    reading: {
      deviceId: 'dev-002',
      readingDate: '2026-08-21',
      meterBw: 1500,
      prevMeterBw: 1000,
      // no meterColor
      readingType: 'MONTHLY',
      siteAtReading: 'UDH',
    },
    expected: {
      ok: false,
      code: 'BW_COLOR_REQUIRED_BUT_MISSING',
      deviceId: 'dev-002',
    },
  },

  // ── Scenario 3: reset requires remark ─────────────────────────────
  {
    name: 'reading below previous without remark → fail',
    description:
      'Reading meterBw=800 when prev=1000 (delta=-200). No remark provided. Should fail with READING_BELOW_PREVIOUS_WITHOUT_REMARK.',
    device: {
      id: 'dev-003',
      assetCode: 'A003',
      type: 'PRINTER',
      meterRequired: true,
      meterMode: 'TOTAL',
      lastMeterBw: 1000,
      lastMeterColor: 0,
      site: 'UDH',
      status: 'active',
    },
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH'],
      actor: 'meter@itam.local',
    },
    reading: {
      deviceId: 'dev-003',
      readingDate: '2026-08-21',
      meterBw: 800,
      prevMeterBw: 1000,
      readingType: 'RESET',
      siteAtReading: 'UDH',
      // no remark
    },
    expected: {
      ok: false,
      code: 'READING_BELOW_PREVIOUS_WITHOUT_REMARK',
      deviceId: 'dev-003',
      delta: -200,
      isReset: true,
    },
  },

  // ── Scenario 4: reset with remark passes ───────────────────────────
  {
    name: 'reading below previous with remark → pass',
    description:
      'Same as scenario 3 but with remark "เปลี่ยนมิเตอร์". Should pass.',
    device: {
      id: 'dev-004',
      assetCode: 'A004',
      type: 'PRINTER',
      meterRequired: true,
      meterMode: 'TOTAL',
      lastMeterBw: 1000,
      lastMeterColor: 0,
      site: 'UDH',
      status: 'active',
    },
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH'],
      actor: 'meter@itam.local',
    },
    reading: {
      deviceId: 'dev-004',
      readingDate: '2026-08-21',
      meterBw: 800,
      prevMeterBw: 1000,
      readingType: 'RESET',
      remark: 'เปลี่ยนมิเตอร์',
      siteAtReading: 'UDH',
    },
    expected: {
      ok: true,
      deviceId: 'dev-004',
      delta: -200,
      isReset: true,
    },
  },

  // ── Scenario 5: device not meter-required ──────────────────────────
  {
    name: 'reading on non-meter-required device → fail',
    description:
      'Device with meterRequired=false (e.g. COMPUTER). Should fail with DEVICE_NOT_METER_REQUIRED.',
    device: {
      id: 'dev-005',
      assetCode: 'A005',
      type: 'COMPUTER',
      meterRequired: false,
      meterMode: null,
      lastMeterBw: 0,
      lastMeterColor: 0,
      site: 'UDH',
      status: 'active',
    },
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH'],
      actor: 'meter@itam.local',
    },
    reading: {
      deviceId: 'dev-005',
      readingDate: '2026-08-21',
      meterBw: 100,
      siteAtReading: 'UDH',
    },
    expected: {
      ok: false,
      code: 'DEVICE_NOT_METER_REQUIRED',
      deviceId: 'dev-005',
    },
  },

  // ── Scenario 6: device not found ──────────────────────────────────
  {
    name: 'reading for non-existent device → fail',
    description:
      'Caller provides deviceId that does not exist. Should fail with DEVICE_NOT_FOUND.',
    device: null as unknown as DeviceMeterFixture, // will be passed as null
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH'],
      actor: 'meter@itam.local',
    },
    reading: {
      deviceId: 'dev-999',
      readingDate: '2026-08-21',
      meterBw: 100,
      siteAtReading: 'UDH',
    },
    expected: {
      ok: false,
      code: 'DEVICE_NOT_FOUND',
    },
  },

  // ── Scenario 7: site scope denied ──────────────────────────────────
  {
    name: 'reading at out-of-scope site → fail',
    description:
      'Caller has UDH only, device at NKP. Should fail with SITE_SCOPE_DENIED.',
    device: {
      id: 'dev-007',
      assetCode: 'A007',
      type: 'PRINTER',
      meterRequired: true,
      meterMode: 'TOTAL',
      lastMeterBw: 1000,
      lastMeterColor: 0,
      site: 'NKP', // device is at NKP
      status: 'active',
    },
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH'], // caller has UDH only
      actor: 'meter@itam.local',
    },
    reading: {
      deviceId: 'dev-007',
      readingDate: '2026-08-21',
      meterBw: 1500,
      prevMeterBw: 1000,
      siteAtReading: 'NKP',
    },
    expected: {
      ok: false,
      code: 'SITE_SCOPE_DENIED',
      deviceId: 'dev-007',
    },
  },

  // ── Scenario 8: superadmin bypass ─────────────────────────────────
  {
    name: 'superadmin can read any device at any site',
    description:
      'Superadmin has no explicit grants but bypasses site scope. Should pass.',
    device: {
      id: 'dev-008',
      assetCode: 'A008',
      type: 'PRINTER',
      meterRequired: true,
      meterMode: 'TOTAL',
      lastMeterBw: 1000,
      lastMeterColor: 0,
      site: 'NKP',
      status: 'active',
    },
    caller: {
      isSuperAdmin: true,
      siteCodes: [],
      actor: 'admin@itam.local',
    },
    reading: {
      deviceId: 'dev-008',
      readingDate: '2026-08-21',
      meterBw: 1500,
      prevMeterBw: 1000,
      readingType: 'MONTHLY',
      siteAtReading: 'NKP',
    },
    expected: {
      ok: true,
      deviceId: 'dev-008',
      delta: 500,
      isReset: false,
    },
  },

  // ── Scenario 9: negative reading ──────────────────────────────────
  {
    name: 'negative reading value → fail',
    description:
      'Caller provides meterBw=-100. Should fail with NEGATIVE_READING.',
    device: {
      id: 'dev-009',
      assetCode: 'A009',
      type: 'PRINTER',
      meterRequired: true,
      meterMode: 'TOTAL',
      lastMeterBw: 1000,
      lastMeterColor: 0,
      site: 'UDH',
      status: 'active',
    },
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH'],
      actor: 'meter@itam.local',
    },
    reading: {
      deviceId: 'dev-009',
      readingDate: '2026-08-21',
      meterBw: -100,
      siteAtReading: 'UDH',
    },
    expected: {
      ok: false,
      code: 'NEGATIVE_READING',
      deviceId: 'dev-009',
    },
  },

  // ── Scenario 10: invalid date ─────────────────────────────────────
  {
    name: 'invalid reading date → fail',
    description:
      'Caller provides readingDate=2026-02-30 (Feb 30 does not exist). Should fail with INVALID_READING_DATE.',
    device: {
      id: 'dev-010',
      assetCode: 'A010',
      type: 'PRINTER',
      meterRequired: true,
      meterMode: 'TOTAL',
      lastMeterBw: 1000,
      lastMeterColor: 0,
      site: 'UDH',
      status: 'active',
    },
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH'],
      actor: 'meter@itam.local',
    },
    reading: {
      deviceId: 'dev-010',
      readingDate: '2026-02-30',
      meterBw: 1500,
      siteAtReading: 'UDH',
    },
    expected: {
      ok: false,
      code: 'INVALID_READING_DATE',
      deviceId: 'dev-010',
    },
  },
]

/**
 * Predict the outcome of a scenario (pure — no DB).
 *
 * Used by tests to verify the contract holds end-to-end.
 */
export function predictMeterOutcome(
  scenario: DeviceMeterScenario,
): MeterValidationResult {
  // Handle scenario 6 (device not found) — device is null
  const device = scenario.device
    ? scenario.device
    : null

  return validateMeterReadingAgainstDevice(
    device,
    scenario.reading,
    scenario.caller,
  )
}
