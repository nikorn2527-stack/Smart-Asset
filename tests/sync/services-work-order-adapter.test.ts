import { describe, expect, it } from 'vitest'
import { adaptServicesWorkOrders } from '@/lib/services-work-order-adapter'

describe('adaptServicesWorkOrders()', () => {
  it('maps valid Services rows without inventing a system job number', () => {
    const result = adaptServicesWorkOrders([
      {
        id: 'services-row-1',
        request_id: 'REQ-1',
        legacy_job_no: 'LEGACY-1',
        subject: 'Printer repair',
        site: 'HQ',
      },
    ])

    expect(result.quarantine).toHaveLength(0)
    expect(result.ready).toHaveLength(1)
    expect(result.ready[0]).toMatchObject({
      rowNumber: 1,
      mapped: {
        requestId: 'REQ-1',
        legacyJobNo: 'LEGACY-1',
        siteCode: 'HQ',
      },
    })
    expect(result.ready[0].mapped).not.toHaveProperty('systemJobNo')
  })

  it('quarantines rows without source identity', () => {
    const result = adaptServicesWorkOrders([
      {
        legacy_job_no: 'LEGACY-2',
        subject: 'Missing source id',
      },
    ])

    expect(result.ready).toHaveLength(0)
    expect(result.quarantine).toHaveLength(1)
    expect(result.quarantine[0].quarantineReason).toBe('MISSING_SOURCE_IDENTITY')
  })

  it('quarantines rows without request id instead of making an apply candidate', () => {
    const result = adaptServicesWorkOrders([
      {
        source_record_id: 'services-row-3',
        legacy_job_no: 'LEGACY-3',
        subject: 'Missing request id',
      },
    ])

    expect(result.ready).toHaveLength(0)
    expect(result.quarantine[0].quarantineReason).toBe('MISSING_REQUEST_ID')
  })

  it('quarantines duplicate source keys deterministically', () => {
    const result = adaptServicesWorkOrders([
      { id: 'services-row-4', request_id: 'REQ-4', site: 'HQ' },
      { id: 'services-row-4', request_id: 'REQ-4', site: 'HQ' },
    ])

    expect(result.ready).toHaveLength(1)
    expect(result.quarantine).toHaveLength(1)
    expect(result.quarantine[0]).toMatchObject({
      rowNumber: 2,
      quarantineReason: 'DUPLICATE_SOURCE_KEY',
    })
  })

  it('returns sorted unmapped columns without exposing the raw source row', () => {
    const result = adaptServicesWorkOrders([
      {
        id: 'services-row-5',
        request_id: 'REQ-5',
        site: 'HQ',
        secret_token: 'must-not-be-carried',
        z_extra: 'unknown',
      },
    ])

    expect(result.unmappedColumns).toEqual(['secret_token', 'z_extra'])
    expect(result.ready[0]).not.toHaveProperty('secret_token')
    expect(result.ready[0]).not.toHaveProperty('raw')
  })
})
