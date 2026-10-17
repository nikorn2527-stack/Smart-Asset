// ============================================================
// Device Import — Persistence layer tests
// ============================================================
// Module: Devices (Dev-3 / Asset & Meter Team)
// Work Package: C — Device importer boundary
//
// These tests cover the persistence layer (`device-import-persistence.ts`).
// They use a mocked Prisma client to avoid DB dependencies — the goal
// is to verify the mode-aware split (create vs update vs skip) and
// the bounded findExistingAssetCodes query, not Prisma's behavior.
//
// Coverage:
//   findExistingAssetCodes:
//     - empty input → empty Set
//     - returns lowercase Set for case-insensitive comparison
//
//   persistDevices:
//     - mode='upsert' + all new → all createMany, no updates
//     - mode='upsert' + mix new/existing → createMany for new, transaction for updates
//     - mode='create_only' + existing in DB → skipped (not inserted, not updated)
//     - mode='update_only' + new in CSV → skipped (not inserted, not updated)
//     - createMany failure → error reported
//     - update failure → error reported
//     - actor field is set on every row
//
// Governance: B4 frozen files untouched. No `prisma db:push`.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma client before importing the persistence module
vi.mock('@/lib/db', () => {
  const mockDevice = {
    findMany: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  }
  const mock$Transaction = vi.fn()
  const mockClient = {
    device: mockDevice,
    $transaction: mock$Transaction,
  }
  return {
    db: mockClient,
    // device-import-persistence.ts drives the UPDATE path through
    // `getBaseClient().$transaction(...)` (not `db.$transaction`), so the mock
    // has to expose the same client through both entry points — otherwise the
    // update path throws "No getBaseClient export is defined on the mock".
    getBaseClient: () => mockClient,
  }
})

// Import after mock is set up
import { db } from '@/lib/db'
import {
  findExistingAssetCodes,
  persistDevices,
} from '@/lib/device-import-persistence'
import type { DeviceImportRow } from '@/lib/device-import-contract'

// Helper: build a DeviceImportRow with sensible defaults
function makeRow(assetNo: string, rowNumber = 1): DeviceImportRow {
  return {
    rowNumber,
    values: {
      assetNo,
      deviceType: 'PRINTER',
      brand: 'HP',
      model: 'LaserJet',
      serial: 'SN001',
      status: 'active',
      site: 'HQ',
      building: null,
      floor: null,
      department: null,
      departmentCode: null,
      location: null,
      deviceGroup: null,
      costCenter: null,
      contractNo: null,
      vendor: null,
      ip: null,
      mac: null,
      remoteId: null,
      installDate: null,
      warrantyEnd: null,
      meterRequired: false,
      meterMode: null,
      assetSiteCode: null,
      remark: null,
    },
  }
}

describe('findExistingAssetCodes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty Set for empty input', async () => {
    const result = await findExistingAssetCodes([])
    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
    expect(db.device.findMany).not.toHaveBeenCalled()
  })

  it('returns lowercase Set for case-insensitive comparison', async () => {
    vi.mocked(db.device.findMany).mockResolvedValue([
      { assetCode: 'a001' },
      { assetCode: 'a002' },
    ])
    const result = await findExistingAssetCodes(['A001', 'A002', 'A003'])
    expect(db.device.findMany).toHaveBeenCalledWith({
      where: { assetCode: { in: ["A001", "A002", "A003"], mode: "insensitive" } },
      select: { assetCode: true },
    })
    expect(result.size).toBe(2)
    expect(result.has('a001')).toBe(true)
    expect(result.has('A001'.toLowerCase())).toBe(true)
    expect(result.has('a003')).toBe(false)
  })
})


  it('handles mixed-case DB values (A001 in DB, a001 in CSV)', async () => {
    vi.mocked(db.device.findMany).mockResolvedValue([
      { assetCode: 'A001' },
    ])
    const result = await findExistingAssetCodes(['a001'])
    expect(result.size).toBe(1)
    expect(result.has('a001')).toBe(true)
  })

  it('handles mixed-case DB values (a001 in DB, A001 in CSV)', async () => {
    vi.mocked(db.device.findMany).mockResolvedValue([
      { assetCode: 'a001' },
    ])
    const result = await findExistingAssetCodes(['A001'])
    expect(result.size).toBe(1)
    expect(result.has('a001')).toBe(true)
  })

describe('persistDevices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mode=upsert + all new rows → createMany only, no updates', async () => {
    vi.mocked(db.device.findMany).mockResolvedValue([])
    vi.mocked(db.device.createMany).mockResolvedValue({ count: 3 })

    const rows = [makeRow('A001', 1), makeRow('A002', 2), makeRow('A003', 3)]
    const existing = new Set<string>()
    const result = await persistDevices(rows, existing, {
      mode: 'upsert',
      actor: 'test@itam.local',
    })

    expect(db.device.createMany).toHaveBeenCalledTimes(1)
    expect(db.device.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ assetCode: 'A001', updatedBy: 'test@itam.local' }),
        expect.objectContaining({ assetCode: 'A002' }),
        expect.objectContaining({ assetCode: 'A003' }),
      ]),
      // NOTE: `skipDuplicates` is intentionally absent. The datasource is
      // SQLite, whose generated DeviceCreateManyArgs types that option as
      // `never` (Prisma does not support it there), so passing it would be a
      // type error — and on Postgres its default is `false` anyway, which is
      // the behaviour this test asserts. The validator already de-duplicates
      // assetCodes before this call.
    })
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(result.inserted).toBe(3)
    expect(result.updated).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors).toEqual([])
    expect(result.duplicateInDb).toEqual([])
  })

  it('mode=upsert + mix new/existing → createMany for new, transaction for updates', async () => {
    vi.mocked(db.device.createMany).mockResolvedValue({ count: 1 })
    vi.mocked(db.$transaction).mockResolvedValue([{}, {}])

    const rows = [
      makeRow('A001', 1), // existing
      makeRow('A002', 2), // new
      makeRow('A003', 3), // existing
    ]
    const existing = new Set(['a001', 'a003'])
    const result = await persistDevices(rows, existing, {
      mode: 'upsert',
      actor: 'admin@itam.local',
    })

    expect(db.device.createMany).toHaveBeenCalledTimes(1)
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(result.inserted).toBe(1)
    expect(result.updated).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.duplicateInDb).toEqual(['A001', 'A003'])
  })

  it('mode=create_only + existing in DB → skipped, not updated', async () => {
    vi.mocked(db.device.createMany).mockResolvedValue({ count: 1 })
    vi.mocked(db.$transaction).mockResolvedValue([])

    const rows = [
      makeRow('A001', 1), // existing → skipped
      makeRow('A002', 2), // new → created
    ]
    const existing = new Set(['a001'])
    const result = await persistDevices(rows, existing, {
      mode: 'create_only',
      actor: 'admin@itam.local',
    })

    expect(db.device.createMany).toHaveBeenCalledTimes(1)
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(result.inserted).toBe(1)
    expect(result.updated).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.duplicateInDb).toEqual(['A001'])
  })

  it('mode=update_only + new in CSV → skipped, not inserted', async () => {
    vi.mocked(db.device.createMany).mockResolvedValue({ count: 0 })
    vi.mocked(db.$transaction).mockResolvedValue([{}])

    const rows = [
      makeRow('A001', 1), // existing → updated
      makeRow('A002', 2), // new → skipped
    ]
    const existing = new Set(['a001'])
    const result = await persistDevices(rows, existing, {
      mode: 'update_only',
      actor: 'admin@itam.local',
    })

    expect(db.device.createMany).not.toHaveBeenCalled()
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(result.inserted).toBe(0)
    expect(result.updated).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('createMany failure → error reported, inserted=0', async () => {
    vi.mocked(db.device.createMany).mockRejectedValue(new Error('connection refused'))

    const rows = [makeRow('A001', 1)]
    const existing = new Set<string>()
    const result = await persistDevices(rows, existing, {
      mode: 'upsert',
      actor: 'admin@itam.local',
    })

    expect(result.inserted).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].field).toBe('createMany')
    expect(result.errors[0].message).toMatch(/connection refused/)
  })

  it('update failure → error reported, updated=0', async () => {
    vi.mocked(db.$transaction).mockRejectedValue(new Error('row not found'))

    const rows = [makeRow('A001', 1)]
    const existing = new Set(['a001'])
    const result = await persistDevices(rows, existing, {
      mode: 'upsert',
      actor: 'admin@itam.local',
    })

    expect(result.updated).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].field).toBe('update')
    expect(result.errors[0].message).toMatch(/row not found/)
  })

  it('actor field is propagated to Prisma data', async () => {
    vi.mocked(db.device.createMany).mockResolvedValue({ count: 1 })
    const rows = [makeRow('A001', 1)]
    const existing = new Set<string>()
    await persistDevices(rows, existing, {
      mode: 'upsert',
      actor: 'supabot@itam.local',
    })

    const callArgs = vi.mocked(db.device.createMany).mock.calls[0][0] as {
      data: Array<{ updatedBy: string }>
    }
    expect(callArgs.data[0].updatedBy).toBe('supabot@itam.local')
  })

  it('summary object has correct shape and totals', async () => {
    vi.mocked(db.device.createMany).mockResolvedValue({ count: 2 })
    vi.mocked(db.$transaction).mockResolvedValue([{}, {}])

    const rows = [
      makeRow('A001', 1), // new
      makeRow('A002', 2), // new
      makeRow('A003', 3), // existing
      makeRow('A004', 4), // existing
    ]
    const existing = new Set(['a003', 'a004'])
    const result = await persistDevices(rows, existing, {
      mode: 'upsert',
      actor: 'admin@itam.local',
    })

    expect(result.summary).toEqual({
      total: 4,
      valid: 4,
      inserted: 2,
      updated: 2,
      skipped: 0,
      errorCount: 0,
    })
  })
})
