import { describe, expect, it } from 'vitest'
import {
  mapLegacyStockOutRecord,
  mapLegacyWorkOrderRecord,
} from '@/lib/repair-data-contract'

describe('mapLegacyWorkOrderRecord()', () => {
  it('keeps source identity separate from legacy and system job numbers', () => {
    const result = mapLegacyWorkOrderRecord({
      id: 'services-row-17',
      request_id: 'REQ-17',
      legacy_job_no: 'LEGACY-2026-0017',
      subject: 'Printer repair',
      status: '🟠รอดำเนินการ',
      site: 'HQ',
    })

    expect(result.quarantineReason).toBeUndefined()
    expect(result.identity).toEqual({
      sourceSystem: 'services',
      sourceEntity: 'work_order',
      sourceRecordId: 'services-row-17',
      sourceLineId: undefined,
      sourceKey: 'services:work_order:services-row-17',
    })
    expect(result.mapped).toMatchObject({
      requestId: 'REQ-17',
      legacyJobNo: 'LEGACY-2026-0017',
      status: 'PENDING',
      subject: 'Printer repair',
      siteCode: 'HQ',
    })
    expect(result.mapped).not.toHaveProperty('woNumber')
    expect(result.mapped).not.toHaveProperty('systemJobNo')
  })

  it('does not invent a legacy job number when source provides only an id', () => {
    const result = mapLegacyWorkOrderRecord({
      id: 'services-row-18',
      subject: 'No explicit job number',
      site: 'HQ',
    })

    expect(result.quarantineReason).toBeUndefined()
    expect(result.identity?.sourceRecordId).toBe('services-row-18')
    expect(result.mapped.legacyJobNo).toBeUndefined()
    expect(result.warnings).toContain(
      'No explicit legacy job number; source identity is retained without inventing one',
    )
  })
})

describe('mapLegacyStockOutRecord()', () => {
  it('keeps requester, department, purpose and approver as separate semantics', () => {
    const result = mapLegacyStockOutRecord({
      IssueNo: 'ISSUE-2026-0008',
      line_no: '2',
      Date: '2026-08-21',
      ProductCode: 'INK-BLK-01',
      ProductName: 'Black ink',
      Quantity: '3',
      Unit: 'ชิ้น',
      Requester: 'N. Porn',
      Department: 'IT Support',
      Purpose: 'Repair printer PPIT-01',
      Approver: 'Manager A',
      ApprovedAt: '2026-08-21T09:30:00+07:00',
      WorkOrderNo: 'LEGACY-2026-0017',
    })

    expect(result.quarantineReason).toBeUndefined()
    expect(result.identity?.sourceKey).toBe('stock:stock_out:ISSUE-2026-0008:2')
    expect(result.mapped).toMatchObject({
      issueNo: 'ISSUE-2026-0008',
      lineNo: '2',
      stockItemSourceCode: 'INK-BLK-01',
      quantity: 3,
      requester: 'N. Porn',
      department: 'IT Support',
      purpose: 'Repair printer PPIT-01',
      approver: 'Manager A',
      workOrderLegacyNo: 'LEGACY-2026-0017',
    })
    expect(result.mapped.requester).not.toBe(result.mapped.approver)
    expect(result.mapped.department).not.toBe(result.mapped.purpose)
  })

  it('quarantines a row with no product code instead of creating a partial issue', () => {
    const result = mapLegacyStockOutRecord({
      IssueNo: 'ISSUE-2026-0009',
      line_no: '1',
      Quantity: 1,
      Requester: 'N. Porn',
    })

    expect(result.quarantineReason).toBe('MISSING_PRODUCT_CODE')
    expect(result.identity?.sourceKey).toBe('stock:stock_out:ISSUE-2026-0009:1')
  })

  it('quarantines non-numeric quantity', () => {
    const result = mapLegacyStockOutRecord({
      IssueNo: 'ISSUE-2026-0010',
      line_no: '1',
      ProductCode: 'INK-BLK-01',
      Quantity: 'not-a-number',
    })

    expect(result.quarantineReason).toBe('INVALID_QUANTITY')
    expect(result.warnings).toContain('Quantity is not numeric')
  })
})
