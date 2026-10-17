import { describe, expect, it } from 'vitest'
import { resolveMaterialIssueWorkOrder } from '@/lib/repair-link-resolution'

describe('resolveMaterialIssueWorkOrder', () => {
  const candidates = [
    { id: 'wo-1', systemJobNo: 'WO-20260821-001', legacyJobNo: 'SR-001' },
    { id: 'wo-2', systemJobNo: 'WO-20260821-002', legacyJobNo: 'SR-002' },
  ]

  it('matches by immutable legacy job number', () => {
    const result = resolveMaterialIssueWorkOrder(
      { workOrderLegacyNo: ' sr-001 ' },
      candidates,
    )

    expect(result.link).toEqual({
      workOrderId: 'wo-1',
      matchedBy: 'legacy_job_no',
      matchedReference: 'sr-001',
    })
    expect(result.quarantineReason).toBeUndefined()
  })

  it('matches by system job number for new-system rows', () => {
    const result = resolveMaterialIssueWorkOrder(
      { workOrderLegacyNo: 'WO-20260821-002' },
      candidates,
    )

    expect(result.link?.workOrderId).toBe('wo-2')
    expect(result.link?.matchedBy).toBe('system_job_no')
  })

  it('quarantines an explicit reference that is not found', () => {
    const result = resolveMaterialIssueWorkOrder(
      { workOrderLegacyNo: 'SR-MISSING' },
      candidates,
    )

    expect(result.link).toBeNull()
    expect(result.quarantineReason).toBe('WORK_ORDER_NOT_FOUND')
  })

  it('quarantines an ambiguous duplicate reference', () => {
    const result = resolveMaterialIssueWorkOrder(
      { workOrderLegacyNo: 'DUP-001' },
      [
        { id: 'wo-a', legacyJobNo: 'DUP-001' },
        { id: 'wo-b', legacyJobNo: 'DUP-001' },
      ],
    )

    expect(result.link).toBeNull()
    expect(result.quarantineReason).toBe('MULTIPLE_WORK_ORDERS_MATCH')
  })

  it('keeps a row unlinked and quarantined when the source omits a reference', () => {
    const result = resolveMaterialIssueWorkOrder({}, candidates)

    expect(result.link).toBeNull()
    expect(result.quarantineReason).toBe('MISSING_WORK_ORDER_REFERENCE')
  })
})
