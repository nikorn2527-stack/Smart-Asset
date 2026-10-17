import { describe, expect, it } from 'vitest'
import { computeLegacyBridgePreviewItems } from '@/lib/legacy-bridge-preview'
import type { BridgeEnvelope } from '@/lib/legacy-bridge'
import type { LegacyBridgeDb } from '@/lib/legacy-bridge-preview'

function makeDb(existing: Partial<Record<keyof LegacyBridgeDb, Record<string, unknown> | null>> = {}): LegacyBridgeDb {
  return {
    device: { findUnique: async () => existing.device ?? null },
    workOrder: { findUnique: async () => existing.workOrder ?? null },
    meterReading: { findUnique: async () => existing.meterReading ?? null },
    stockItem: { findUnique: async () => existing.stockItem ?? null },
    stockTransaction: { findFirst: async () => existing.stockTransaction ?? null },
  }
}

function envelope(module: BridgeEnvelope['module'], payload: Record<string, unknown>): BridgeEnvelope {
  return {
    module,
    source: 'apps-script-stock',
    externalKey: String(payload.sourceKey ?? payload.productCode ?? payload.readingId ?? 'external-1'),
    payload,
    sourceRecord: payload,
    unmappedColumns: [],
  }
}

describe('legacy bridge preview', () => {
  it('keeps stock-item version as the optimistic-concurrency baseline', async () => {
    const [item] = await computeLegacyBridgePreviewItems(
      [envelope('stock-item', { productCode: 'INK-001', productName: 'Black ink', quantity: 12 })],
      [],
      makeDb({ stockItem: { id: 'stock-1', productCode: 'INK-001', productName: 'Black ink', quantity: 10, version: 7 } }),
    )

    expect(item.action).toBe('update')
    expect(item.expectedVersion).toBe(7)
    expect(item.expectedExists).toBe(true)
  })

  it('skips an unchanged append-only stock transaction by sourceKey', async () => {
    const payload = {
      sourceKey: 'txn-001',
      productCode: 'INK-001',
      productName: 'Black ink',
      type: 'OUT',
      quantity: 2,
      txnDate: '2026-08-22',
      workOrderNo: 'JOB-001',
      requester: 'Staff',
      approvalStatus: 'APPROVED',
    }
    const [item] = await computeLegacyBridgePreviewItems(
      [envelope('stock-transaction', payload)],
      [],
      makeDb({ stockTransaction: { id: 'txn-db-1', ...payload } }),
    )

    expect(item.action).toBe('skip')
    expect(item.errorMessage).toBeUndefined()
  })

  it('quarantines a changed append-only stock transaction instead of skipping it', async () => {
    const payload = {
      sourceKey: 'txn-002',
      productCode: 'INK-001',
      productName: 'Black ink',
      type: 'OUT',
      quantity: 5,
      txnDate: '2026-08-22',
    }
    const [item] = await computeLegacyBridgePreviewItems(
      [envelope('stock-transaction', payload)],
      [],
      makeDb({ stockTransaction: { id: 'txn-db-2', ...payload, quantity: 2 } }),
    )

    expect(item.action).toBe('error')
    expect(item.errorMessage).toContain('append-only stock transaction changed')
  })

  it('uses siteAtReading for meter authorization scope', async () => {
    const [item] = await computeLegacyBridgePreviewItems(
      [envelope('meter-reading', {
        readingId: 'meter-001',
        deviceId: 'DEV-001',
        readingDate: '2026-08-22',
        meterBw: 1200,
        siteAtReading: 'SITE-A',
      })],
      [],
      makeDb(),
      ['SITE-A'],
    )

    expect(item.action).toBe('create')
    expect(item.siteCode).toBe('SITE-A')
  })
})

export {}
