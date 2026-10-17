// ============================================================
// Devices Importer ↔ Transfer Contract — Integration fixtures
// ============================================================
// Module: Devices (Dev-3 / Asset & Meter Team)
// Work Package: C — parallel preparation (per PARALLEL NOW order)
//
// Purpose: integration test fixtures for the contract between the
// device IMPORTER (creates devices with assetCode + site) and the
// TRANSFER route (moves devices between sites, requires assetCode
// to resolve and site scope to match).
//
// These fixtures are PURE — they describe inputs + expected outcomes
// for the integration scenarios. The actual integration tests mock
// the DB layer and verify the contract holds end-to-end.
//
// Contract under test:
//   - Importer produces Device rows with: assetCode (unique), site, status
//   - Transfer route accepts device id (assetCode) + toSite + optional meter
//   - Transfer enforces: from-site + to-site in caller scope
//   - Transfer enforces: meterRequired → meterReadingId or ack
//   - Transfer creates: LocationHistory + DeviceTransfer records
//
// Governance:
//   - B4 frozen files: NOT touched
//   - SYNC_RUN permission: NOT added
//   - prisma db:push: NOT used
//   - Schema/migration: NOT changed (no new Prisma changes)
//   - Does NOT touch PR #29/#35/#38/#41 scope directly
// ============================================================

/**
 * Initial state for an integration scenario.
 * Represents devices that exist in the DB before the scenario runs.
 */
export interface DeviceFixture {
  id: string // cuid
  assetCode: string // unique
  name: string
  brand: string
  model: string
  type: string
  status: string
  site: string
  meterRequired: boolean
  meterMode: string | null
  lastMeterBw: number
  lastMeterColor: number
  department: string | null
  location: string | null
}

/**
 * Caller's authorization scope for integration scenarios.
 */
export interface CallerScopeFixture {
  isSuperAdmin: boolean
  siteCodes: string[]
  actor: string
}

/**
 * Transfer request body shape (matches /api/itam/devices/[id]/transfer).
 */
export interface TransferRequestBody {
  toSite: string
  toBuilding?: string
  toFloor?: string
  toDepartment?: string
  toDepartmentCode?: string
  toLocation?: string
  toAssetSiteCode?: string
  toStatus?: string
  meterReadingId?: string
  meterSkipAcknowledged?: boolean
  skipMeterReason?: string
}

/**
 * Expected outcome of an integration scenario.
 */
export interface ExpectedOutcome {
  httpStatus: number
  errorCode?: string
  errorMessageContains?: string
  deviceSiteAfter?: string
  deviceStatusAfter?: string
  auditAction?: string
  createsLocationHistory?: boolean
  createsDeviceTransfer?: boolean
}

/**
 * One integration scenario.
 */
export interface IntegrationScenario {
  name: string
  description: string
  initialDevices: DeviceFixture[]
  caller: CallerScopeFixture
  targetAssetCode: string
  transferBody: TransferRequestBody
  expected: ExpectedOutcome
}

// ─── Scenario fixtures ────────────────────────────────────────────────

export const INTEGRATION_SCENARIOS: IntegrationScenario[] = [
  // ── Scenario 1: successful transfer within scope ──────────────
  {
    name: 'successful transfer — caller has both from-site and to-site',
    description:
      'Import a device at UDH, then transfer to NKP. Caller has UDH + NKP grants. Should succeed.',
    initialDevices: [
      {
        id: 'dev-001',
        assetCode: 'A001',
        name: 'Printer',
        brand: 'HP',
        model: 'LaserJet',
        type: 'PRINTER',
        status: 'active',
        site: 'UDH',
        meterRequired: false,
        meterMode: null,
        lastMeterBw: 0,
        lastMeterColor: 0,
        department: 'IT',
        location: 'Floor 1',
      },
    ],
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH', 'NKP'],
      actor: 'editor@itam.local',
    },
    targetAssetCode: 'A001',
    transferBody: {
      toSite: 'NKP',
      toBuilding: 'HQ',
      toFloor: '2',
      toDepartment: 'IT',
    },
    expected: {
      httpStatus: 200,
      deviceSiteAfter: 'NKP',
      auditAction: 'TRANSFER',
      createsLocationHistory: true,
      createsDeviceTransfer: true,
    },
  },

  // ── Scenario 2: transfer to unauthorized site ──────────────────
  {
    name: 'transfer to unauthorized site → 403',
    description:
      'Import a device at UDH, caller has UDH only, attempts to transfer to NKP. Should be denied (403).',
    initialDevices: [
      {
        id: 'dev-002',
        assetCode: 'A002',
        name: 'Scanner',
        brand: 'Canon',
        model: 'Lide',
        type: 'SCANNER',
        status: 'active',
        site: 'UDH',
        meterRequired: false,
        meterMode: null,
        lastMeterBw: 0,
        lastMeterColor: 0,
        department: null,
        location: null,
      },
    ],
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH'],
      actor: 'editor@itam.local',
    },
    targetAssetCode: 'A002',
    transferBody: {
      toSite: 'NKP',
    },
    expected: {
      httpStatus: 403,
      errorCode: 'SITE_SCOPE_DENIED',
      errorMessageContains: 'ไม่มีสิทธิ์ย้ายอุปกรณ์ไปสาขา',
      deviceSiteAfter: 'UDH', // unchanged
      createsLocationHistory: false,
      createsDeviceTransfer: false,
    },
  },

  // ── Scenario 3: transfer from unauthorized site ─────────────────
  {
    name: 'transfer from unauthorized site → 403',
    description:
      'Import a device at NKP, caller has UDH only, attempts to transfer to UDH. Should be denied (403) because caller cannot act on NKP.',
    initialDevices: [
      {
        id: 'dev-003',
        assetCode: 'A003',
        name: 'Router',
        brand: 'Cisco',
        model: 'ISR',
        type: 'NETWORK',
        status: 'active',
        site: 'NKP',
        meterRequired: false,
        meterMode: null,
        lastMeterBw: 0,
        lastMeterColor: 0,
        department: null,
        location: null,
      },
    ],
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH'],
      actor: 'editor@itam.local',
    },
    targetAssetCode: 'A003',
    transferBody: {
      toSite: 'UDH',
    },
    expected: {
      httpStatus: 403,
      errorCode: 'SITE_SCOPE_DENIED',
      errorMessageContains: 'ไม่มีสิทธิ์ย้ายอุปกรณ์ในสาขานี้',
      deviceSiteAfter: 'NKP', // unchanged
      createsLocationHistory: false,
      createsDeviceTransfer: false,
    },
  },

  // ── Scenario 4: meter-required without reading or ack ──────────
  {
    name: 'meter-required device — no reading, no ack → 400',
    description:
      'Import a device with meterRequired=true, attempt transfer without meterReadingId or meterSkipAcknowledged. Should be denied (400) with METER_REQUIRED code.',
    initialDevices: [
      {
        id: 'dev-004',
        assetCode: 'A004',
        name: 'Printer',
        brand: 'HP',
        model: 'LaserJet Pro',
        type: 'PRINTER',
        status: 'active',
        site: 'UDH',
        meterRequired: true,
        meterMode: 'TOTAL',
        lastMeterBw: 1000,
        lastMeterColor: 500,
        department: 'IT',
        location: 'Floor 1',
      },
    ],
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH', 'NKP'],
      actor: 'editor@itam.local',
    },
    targetAssetCode: 'A004',
    transferBody: {
      toSite: 'NKP',
      // no meterReadingId, no meterSkipAcknowledged
    },
    expected: {
      httpStatus: 400,
      errorCode: 'METER_REQUIRED',
      errorMessageContains: 'ต้องจดมิเตอร์ก่อนย้าย',
      deviceSiteAfter: 'UDH', // unchanged
      createsLocationHistory: false,
      createsDeviceTransfer: false,
    },
  },

  // ── Scenario 5: meter-required with ack ─────────────────────────
  {
    name: 'meter-required device — with meterSkipAcknowledged → 200',
    description:
      'Import a device with meterRequired=true, transfer with meterSkipAcknowledged=true. Should succeed (200).',
    initialDevices: [
      {
        id: 'dev-005',
        assetCode: 'A005',
        name: 'Printer',
        brand: 'HP',
        model: 'LaserJet Pro',
        type: 'PRINTER',
        status: 'active',
        site: 'UDH',
        meterRequired: true,
        meterMode: 'TOTAL',
        lastMeterBw: 1000,
        lastMeterColor: 500,
        department: 'IT',
        location: 'Floor 1',
      },
    ],
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH', 'NKP'],
      actor: 'editor@itam.local',
    },
    targetAssetCode: 'A005',
    transferBody: {
      toSite: 'NKP',
      meterSkipAcknowledged: true,
      skipMeterReason: 'meter continues counting',
    },
    expected: {
      httpStatus: 200,
      deviceSiteAfter: 'NKP',
      auditAction: 'TRANSFER',
      createsLocationHistory: true,
      createsDeviceTransfer: true,
    },
  },

  // ── Scenario 6: transfer non-existent device ────────────────────
  {
    name: 'transfer non-existent assetCode → 404',
    description:
      'Caller attempts to transfer assetCode that does not exist in DB. Should be denied (404).',
    initialDevices: [
      {
        id: 'dev-006',
        assetCode: 'A006',
        name: 'Existing Device',
        brand: 'Dell',
        model: 'Optiplex',
        type: 'COMPUTER',
        status: 'active',
        site: 'UDH',
        meterRequired: false,
        meterMode: null,
        lastMeterBw: 0,
        lastMeterColor: 0,
        department: null,
        location: null,
      },
    ],
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH'],
      actor: 'editor@itam.local',
    },
    targetAssetCode: 'A999', // does not exist
    transferBody: {
      toSite: 'UDH', // same site (would be no-op anyway)
    },
    expected: {
      httpStatus: 404,
      errorCode: 'DEVICE_NOT_FOUND',
      errorMessageContains: 'Device not found',
      createsLocationHistory: false,
      createsDeviceTransfer: false,
    },
  },

  // ── Scenario 7: superadmin bypass ───────────────────────────────
  {
    name: 'superadmin can transfer between any sites',
    description:
      'Superadmin imports device at UDH, transfers to NKP without explicit grants. Should succeed (200).',
    initialDevices: [
      {
        id: 'dev-007',
        assetCode: 'A007',
        name: 'Printer',
        brand: 'HP',
        model: 'LaserJet',
        type: 'PRINTER',
        status: 'active',
        site: 'UDH',
        meterRequired: false,
        meterMode: null,
        lastMeterBw: 0,
        lastMeterColor: 0,
        department: null,
        location: null,
      },
    ],
    caller: {
      isSuperAdmin: true,
      siteCodes: [], // no explicit grants, but superadmin bypasses
      actor: 'admin@itam.local',
    },
    targetAssetCode: 'A007',
    transferBody: {
      toSite: 'NKP',
    },
    expected: {
      httpStatus: 200,
      deviceSiteAfter: 'NKP',
      auditAction: 'TRANSFER',
      createsLocationHistory: true,
      createsDeviceTransfer: true,
    },
  },

  // ── Scenario 8: case-insensitive assetCode lookup ───────────────
  {
    name: 'case-insensitive assetCode lookup in transfer',
    description:
      'Import a device with assetCode "A001". Caller requests transfer of "a001" (lowercase). Should find the device and succeed (assuming scope OK).',
    initialDevices: [
      {
        id: 'dev-008',
        assetCode: 'A001',
        name: 'Printer',
        brand: 'HP',
        model: 'LaserJet',
        type: 'PRINTER',
        status: 'active',
        site: 'UDH',
        meterRequired: false,
        meterMode: null,
        lastMeterBw: 0,
        lastMeterColor: 0,
        department: null,
        location: null,
      },
    ],
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH', 'NKP'],
      actor: 'editor@itam.local',
    },
    targetAssetCode: 'a001', // lowercase
    transferBody: {
      toSite: 'NKP',
    },
    expected: {
      httpStatus: 200,
      deviceSiteAfter: 'NKP',
      auditAction: 'TRANSFER',
      createsLocationHistory: true,
      createsDeviceTransfer: true,
    },
  },
]

// ─── Pure helpers (testable without DB) ────────────────────────────────

/**
 * Resolve a device from initial state by assetCode (case-insensitive).
 * Pure — no DB.
 *
 * This mirrors what the transfer route should do when looking up a device
 * by assetCode. Returns null if not found.
 */
export function resolveDeviceByAssetCode(
  devices: DeviceFixture[],
  assetCode: string,
): DeviceFixture | null {
  const lower = assetCode.toLowerCase()
  return (
    devices.find((d) => d.assetCode.toLowerCase() === lower) ?? null
  )
}

/**
 * Decide if a transfer is allowed by site scope (pure, no DB).
 *
 * Mirrors the route's canAccessSite(user, device.site) +
 * canAccessSite(user, toSite) checks.
 */
export function decideTransferSiteScope(
  caller: CallerScopeFixture,
  device: DeviceFixture,
  toSite: string,
): { allowed: boolean; reason: string } {
  if (caller.isSuperAdmin) {
    return { allowed: true, reason: 'superadmin bypass' }
  }
  if (!caller.actor) {
    return { allowed: false, reason: 'anonymous caller denied' }
  }
  const allowedSites = caller.siteCodes.map((s) => s.toUpperCase())
  const fromSiteOk = allowedSites.includes(device.site.toUpperCase())
  const toSiteOk = allowedSites.includes(toSite.toUpperCase())
  if (!fromSiteOk) {
    return {
      allowed: false,
      reason: `caller cannot act on source site ${device.site}`,
    }
  }
  if (!toSiteOk) {
    return {
      allowed: false,
      reason: `caller cannot transfer to target site ${toSite}`,
    }
  }
  return { allowed: true, reason: 'both sites in caller scope' }
}

/**
 * Decide if meter is required and missing (pure, no DB).
 *
 * Mirrors the route's meter-required enforcement:
 *   if device.meterRequired && !meterReadingId && !meterSkipAcknowledged → 400
 */
export function decideMeterRequired(
  device: DeviceFixture,
  body: TransferRequestBody,
): { required: boolean; satisfied: boolean; reason: string } {
  if (!device.meterRequired) {
    return { required: false, satisfied: true, reason: 'meter not required' }
  }
  if (body.meterReadingId) {
    return { required: true, satisfied: true, reason: 'meter reading provided' }
  }
  if (body.meterSkipAcknowledged) {
    return {
      required: true,
      satisfied: true,
      reason: 'meter skip acknowledged by user',
    }
  }
  return {
    required: true,
    satisfied: false,
    reason: 'meter required but no reading or ack provided',
  }
}

/**
 * Predict the outcome of a transfer scenario (pure, no DB).
 *
 * Used by tests to verify the contract holds end-to-end without
 * touching the database.
 */
export function predictTransferOutcome(
  scenario: IntegrationScenario,
): ExpectedOutcome {
  const device = resolveDeviceByAssetCode(
    scenario.initialDevices,
    scenario.targetAssetCode,
  )
  if (!device) {
    return {
      httpStatus: 404,
      errorCode: 'DEVICE_NOT_FOUND',
      errorMessageContains: 'Device not found',
      createsLocationHistory: false,
      createsDeviceTransfer: false,
    }
  }

  const scope = decideTransferSiteScope(
    scenario.caller,
    device,
    scenario.transferBody.toSite,
  )
  if (!scope.allowed) {
    // Distinguish from-site vs to-site denial for error message
    const allowedSites = scenario.caller.siteCodes.map((s) => s.toUpperCase())
    const fromOk = allowedSites.includes(device.site.toUpperCase())
    return {
      httpStatus: 403,
      errorCode: 'SITE_SCOPE_DENIED',
      errorMessageContains: fromOk
        ? 'ไม่มีสิทธิ์ย้ายอุปกรณ์ไปสาขา'
        : 'ไม่มีสิทธิ์ย้ายอุปกรณ์ในสาขานี้',
      deviceSiteAfter: device.site,
      createsLocationHistory: false,
      createsDeviceTransfer: false,
    }
  }

  const meter = decideMeterRequired(device, scenario.transferBody)
  if (meter.required && !meter.satisfied) {
    return {
      httpStatus: 400,
      errorCode: 'METER_REQUIRED',
      errorMessageContains: 'ต้องจดมิเตอร์ก่อนย้าย',
      deviceSiteAfter: device.site,
      createsLocationHistory: false,
      createsDeviceTransfer: false,
    }
  }

  return {
    httpStatus: 200,
    deviceSiteAfter: scenario.transferBody.toSite,
    auditAction: 'TRANSFER',
    createsLocationHistory: true,
    createsDeviceTransfer: true,
  }
}
