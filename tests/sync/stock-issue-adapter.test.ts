import { describe, expect, it } from 'vitest'
import { adaptLegacyStockIssues } from '@/lib/stock-issue-adapter'

describe('adaptLegacyStockIssues()', () => {
  it('keeps stock issue semantics separate and ready for later FK resolution', () => {
    const result = adaptLegacyStockIssues([
      {
        IssueNo: 'ISSUE-1',
        line_no: '1',
        ProductCode: 'INK-01',
        ProductName: 'Black ink',
        Quantity: '2',
        Requester: 'User A',
        Department: 'IT',
        Purpose: 'Repair printer',
        Approver: 'Manager A',
        WorkOrderNo: 'LEGACY-1',
      },
    ])

    expect(result.quarantine).toHaveLength(0)
    expect(result.ready[0].mapped).toMatchObject({
      requester: 'User A',
      department: 'IT',
      purpose: 'Repair printer',
      approver: 'Manager A',
      workOrderLegacyNo: 'LEGACY-1',
      quantity: 2,
    })
    expect(result.ready[0].mapped.requester).not.toBe(result.ready[0].mapped.approver)
  })

  it('quarantines duplicate source keys instead of creating duplicate issue lines', () => {
    const row = {
      IssueNo: 'ISSUE-2',
      line_no: '1',
      ProductCode: 'INK-02',
      Quantity: 1,
    }
    const result = adaptLegacyStockIssues([row, row])

    expect(result.ready).toHaveLength(1)
    expect(result.quarantine).toHaveLength(1)
    expect(result.quarantine[0]).toMatchObject({
      rowNumber: 2,
      quarantineReason: 'DUPLICATE_SOURCE_KEY',
    })
  })

  it('preserves the existing non-positive quantity quarantine', () => {
    const result = adaptLegacyStockIssues([
      { IssueNo: 'ISSUE-3', line_no: '1', ProductCode: 'INK-03', Quantity: 0 },
    ])

    expect(result.ready).toHaveLength(0)
    expect(result.quarantine[0].quarantineReason).toBe('NON_POSITIVE_QUANTITY')
  })

  it('quarantines an approval timestamp without an approver', () => {
    const result = adaptLegacyStockIssues([
      {
        IssueNo: 'ISSUE-4',
        line_no: '1',
        ProductCode: 'INK-04',
        Quantity: 1,
        ApprovedAt: '2026-08-21T10:00:00+07:00',
      },
    ])

    expect(result.ready).toHaveLength(0)
    expect(result.quarantine[0].quarantineReason).toBe('APPROVAL_TIMESTAMP_WITHOUT_APPROVER')
  })

  it('reports unknown columns without carrying raw source values', () => {
    const result = adaptLegacyStockIssues([
      {
        IssueNo: 'ISSUE-5',
        line_no: '1',
        ProductCode: 'INK-05',
        Quantity: 1,
        secret_token: 'must-not-be-carried',
      },
    ])

    expect(result.unmappedColumns).toContain('secret_token')
    expect(result.ready[0]).not.toHaveProperty('secret_token')
    expect(result.ready[0]).not.toHaveProperty('raw')
  })
})
