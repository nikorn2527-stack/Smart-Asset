import { describe, expect, it } from 'vitest'
import {
  normalizeStockSourceKey,
  resolveWorkOrderReference,
  type WorkOrderRecord,
} from '@/lib/stock-work-order-resolution'

const workOrderA: WorkOrderRecord = {
  id: 'wo-a',
  woNumber: 'WO-2026-001',
  legacyJobNo: 'LEGACY-001',
  systemJobNo: 'SYS-0001',
  requestId: 'REQ-001',
}

function lookupFor(records: WorkOrderRecord[]) {
  const find = (value: string, field: keyof WorkOrderRecord) =>
    Promise.resolve(records.find((record) => record[field] === value) ?? null)
  return {
    byId: (value: string) => find(value, 'id'),
    byWoNumber: (value: string) => find(value, 'woNumber'),
    byLegacyJobNo: (value: string) => find(value, 'legacyJobNo'),
    bySystemJobNo: (value: string) => find(value, 'systemJobNo'),
    byRequestId: (value: string) => find(value, 'requestId'),
  }
}

describe('resolveWorkOrderReference', () => {
  it('resolves legacy and system identifiers to one canonical work order', async () => {
    await expect(
      resolveWorkOrderReference(
        { legacyJobNo: 'LEGACY-001', systemJobNo: 'SYS-0001' },
        lookupFor([workOrderA]),
      ),
    ).resolves.toMatchObject({
      status: 'resolved',
      canonicalWorkOrderNo: 'SYS-0001',
      workOrder: { id: 'wo-a' },
    })
  })

  it('quarantines a missing reference instead of silently linking another identifier', async () => {
    await expect(
      resolveWorkOrderReference(
        { workOrderId: 'wo-a', workOrderNo: 'WO-NOT-FOUND' },
        lookupFor([workOrderA]),
      ),
    ).resolves.toMatchObject({ status: 'quarantined', reason: 'NOT_FOUND' })
  })

  it('quarantines references that resolve to different work orders', async () => {
    const workOrderB = { ...workOrderA, id: 'wo-b', systemJobNo: 'SYS-0002' }
    await expect(
      resolveWorkOrderReference(
        { workOrderId: 'wo-a', systemJobNo: 'SYS-0002' },
        lookupFor([workOrderA, workOrderB]),
      ),
    ).resolves.toMatchObject({ status: 'quarantined', reason: 'CONFLICTING_REFERENCES' })
  })

  it('keeps a row explicitly unlinked when no reference was supplied', async () => {
    await expect(resolveWorkOrderReference({}, lookupFor([workOrderA]))).resolves.toEqual({
      status: 'unlinked',
      supplied: [],
      reason: 'NO_REFERENCE',
    })
  })
})

describe('normalizeStockSourceKey', () => {
  it('trims blank values and caps untrusted retry keys', () => {
    expect(normalizeStockSourceKey('  legacy:stock-out:42  ')).toBe('legacy:stock-out:42')
    expect(normalizeStockSourceKey('   ')).toBeNull()
    expect(normalizeStockSourceKey('x'.repeat(500))).toHaveLength(200)
  })
})
