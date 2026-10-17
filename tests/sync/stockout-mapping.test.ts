import { describe, expect, it } from 'vitest'
import { FIELD_MAPPINGS, mapCsvRow } from '@/lib/csv-field-mapping'

describe('StockOut legacy mapping boundary', () => {
  it('preserves material issue semantics as separate fields', () => {
    const { data, unmapped } = mapCsvRow(
      {
        IssueNo: 'ISS-001',
        ProductCode: 'TONER-001',
        Quantity: '2',
        Requester: 'ผู้เบิก',
        Department: 'IT',
        Purpose: 'เปลี่ยนหมึก',
        Approver: 'ผู้อนุมัติ',
        ApprovedAt: '2026-08-21T10:00:00Z',
        WorkOrderNo: 'LEG-123',
      },
      FIELD_MAPPINGS.stockOut,
    )

    expect(unmapped).toEqual([])
    expect(data).toMatchObject({
      txnNumber: 'ISS-001',
      stockItemId: 'TONER-001',
      quantity: '2',
      requester: 'ผู้เบิก',
      department: 'IT',
      purpose: 'เปลี่ยนหมึก',
      approver: 'ผู้อนุมัติ',
      approvedAt: '2026-08-21T10:00:00Z',
      workOrderNo: 'LEG-123',
    })
    expect(data.reason).toBeUndefined()
    expect(data.performedBy).toBeUndefined()
  })

  it('accepts legacy job aliases without changing the source contract', () => {
    const { data, unmapped } = mapCsvRow(
      {
        legacy_job_no: 'LEG-456',
        Requester: 'ผู้เบิก',
        Purpose: 'ซ่อมอุปกรณ์',
      },
      FIELD_MAPPINGS.stockOut,
    )

    expect(unmapped).toEqual([])
    expect(data.workOrderNo).toBe('LEG-456')
    expect(data.requester).toBe('ผู้เบิก')
    expect(data.purpose).toBe('ซ่อมอุปกรณ์')
  })
})
