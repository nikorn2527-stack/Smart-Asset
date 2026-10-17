import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _setSiteAllowlistForTesting } from '@/lib/sync-adapter'
import { computeServicesWorkOrderPreview } from '@/lib/services-work-order-preview'

describe('computeServicesWorkOrderPreview', () => {
  beforeEach(() => {
    _setSiteAllowlistForTesting(new Set(['HQ']))
  })

  afterEach(() => {
    _setSiteAllowlistForTesting(null)
  })

  it('compares ready rows while quarantining duplicates and missing request IDs', async () => {
    const findUnique = vi.fn().mockResolvedValue(null)
    const tx = { workOrder: { findUnique } }

    const result = await computeServicesWorkOrderPreview([
      {
        id: 'svc-1',
        request_id: 'REQ-1',
        legacy_job_no: 'LEG-1',
        subject: 'Printer repair',
        status: '🟠รอดำเนินการ',
        site: 'HQ',
        reporter_name: 'Alice',
        secret_token: 'must-not-enter-preview',
      },
      {
        id: 'svc-1',
        request_id: 'REQ-1-DUP',
        legacy_job_no: 'LEG-1-DUP',
        subject: 'Duplicate source row',
        site: 'HQ',
      },
      {
        source_record_id: 'svc-2',
        subject: 'Missing request identity',
        site: 'HQ',
      },
    ], tx)

    expect(result.readyRows).toBe(1)
    expect(result.quarantinedRows).toBe(2)
    expect(result.items).toHaveLength(3)
    expect(result.items[0]).toMatchObject({
      externalKey: 'REQ-1',
      action: 'create',
      siteCode: 'HQ',
    })
    expect(result.items[0].after).toMatchObject({
      requestId: 'REQ-1',
      legacyJobNo: 'LEG-1',
      subject: 'Printer repair',
      siteCode: 'HQ',
    })
    expect(result.items[0].after).not.toHaveProperty('secret_token')

    expect(result.items[1]).toMatchObject({
      action: 'error',
      errorMessage: 'QUARANTINED:DUPLICATE_SOURCE_KEY',
    })
    expect(result.items[2]).toMatchObject({
      action: 'error',
      externalKey: 'services:work_order:svc-2',
      errorMessage: 'QUARANTINED:MISSING_REQUEST_ID',
    })
    expect(result.unmappedColumns).toContain('secret_token')
    expect(findUnique).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the source site is outside the allowlist', async () => {
    const findUnique = vi.fn().mockResolvedValue(null)
    const tx = { workOrder: { findUnique } }

    const result = await computeServicesWorkOrderPreview([
      {
        id: 'svc-3',
        request_id: 'REQ-3',
        legacy_job_no: 'LEG-3',
        subject: 'Out of allowlist',
        site: 'UNKNOWN',
      },
    ], tx)

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      action: 'error',
      externalKey: 'REQ-3',
      siteCode: null,
      errorMessage: 'UNKNOWN_SITE: site not in allowlist',
    })
    expect(findUnique).not.toHaveBeenCalled()
  })
})
