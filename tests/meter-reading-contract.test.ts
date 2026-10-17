import { describe, expect, it } from 'vitest'
import {
  hasDuplicateMeterPeriod,
  meterPeriodKey,
  parseMeterQuery,
  isStaleMeterReading,
  validateMeterChannels,
  validateMeterReading,
} from '@/lib/meter-reading-contract'

describe('validateMeterReading()', () => {
  it('accepts a normal increasing reading and calculates delta', () => {
    expect(validateMeterReading({
      deviceId: 'device-1',
      reading: 1250,
      previousReading: 1000,
      date: '2026-08-21',
    })).toMatchObject({
      ok: true,
      reading: 1250,
      previousReading: 1000,
      delta: 250,
      isReset: false,
    })
  })

  it('requires a remark when a reading resets below the previous value', () => {
    expect(validateMeterReading({
      deviceId: 'device-1',
      reading: 100,
      previousReading: 1000,
      date: '2026-08-21',
    })).toMatchObject({ ok: false, code: 'RESET_REQUIRES_REMARK' })

    expect(validateMeterReading({
      deviceId: 'device-1',
      reading: 100,
      previousReading: 1000,
      date: '2026-08-21',
      remark: 'เปลี่ยนชุดมิเตอร์',
    })).toMatchObject({ ok: true, delta: -900, isReset: true })
  })

  it('validates both channels and reports the failing channel', () => {
    expect(validateMeterChannels({
      deviceId: 'device-1',
      date: '2026-08-21',
      meterBw: 1250,
      previousMeterBw: 1000,
      meterColor: 320,
      previousMeterColor: 300,
    })).toEqual({ ok: true })

    const invalid = validateMeterChannels({
      deviceId: 'device-1',
      date: '2026-08-21',
      meterBw: 1250,
      previousMeterBw: 1000,
      meterColor: -1,
      previousMeterColor: 300,
    })
    expect(invalid).toMatchObject({
      ok: false,
      channel: 'color',
      validation: { code: 'NEGATIVE_READING' },
    })
  })

  it('requires a remark for a reset on either meter channel', () => {
    const invalid = validateMeterChannels({
      deviceId: 'device-1',
      date: '2026-08-21',
      meterBw: 1250,
      previousMeterBw: 1000,
      meterColor: 250,
      previousMeterColor: 300,
    })
    expect(invalid).toMatchObject({
      ok: false,
      channel: 'color',
      validation: { code: 'RESET_REQUIRES_REMARK' },
    })

    expect(validateMeterChannels({
      deviceId: 'device-1',
      date: '2026-08-21',
      remark: 'เปลี่ยนชุดมิเตอร์',
      meterBw: 1250,
      previousMeterBw: 1000,
      meterColor: 250,
      previousMeterColor: 300,
    })).toEqual({ ok: true })
  })

  it('rejects invalid dates, negative readings and non-finite values', () => {
    expect(validateMeterReading({ deviceId: 'd', reading: 1, date: '2026-02-30' })).toMatchObject({
      ok: false,
      code: 'INVALID_DATE',
    })
    expect(validateMeterReading({ deviceId: 'd', reading: -1, date: '2026-08-21' })).toMatchObject({
      ok: false,
      code: 'NEGATIVE_READING',
    })
    expect(validateMeterReading({ deviceId: 'd', reading: Number.NaN, date: '2026-08-21' })).toMatchObject({
      ok: false,
      code: 'INVALID_READING',
    })
  })
})

describe('meterPeriodKey() and hasDuplicateMeterPeriod()', () => {
  it('uses explicit cycle identity when provided and otherwise one reading per month', () => {
    expect(meterPeriodKey({ deviceId: 'd', date: '2026-08-01' })).toBe('d:month:2026-08')
    expect(meterPeriodKey({ deviceId: 'd', date: '2026-08-21', cycleId: 'cycle-1' })).toBe('d:cycle:cycle-1')
    expect(hasDuplicateMeterPeriod(
      { deviceId: 'd', date: '2026-08-21' },
      [{ deviceId: 'd', date: '2026-08-01' }],
    )).toBe(true)
  })
})

describe('isStaleMeterReading()', () => {
  it('rejects a candidate older than the existing monthly reading', () => {
    expect(isStaleMeterReading(
      { readingDate: '2026-08-20' },
      { readingDate: '2026-08-21' },
    )).toBe(true)
  })

  it('allows a newer or same-day candidate and an empty existing reference', () => {
    expect(isStaleMeterReading(
      { readingDate: '2026-08-22' },
      { readingDate: '2026-08-21' },
    )).toBe(false)
    expect(isStaleMeterReading(
      { readingDate: '2026-08-21' },
      { readingDate: '2026-08-21' },
    )).toBe(false)
    expect(isStaleMeterReading({ readingDate: '2026-08-21' }, null)).toBe(false)
  })
})

describe('parseMeterQuery()', () => {
  it('clamps limit to the resource bound and preserves filters', () => {
    const result = parseMeterQuery(new URLSearchParams({
      deviceId: 'd',
      aggregate: 'monthly',
      limit: '9999',
      offset: '20',
    }))

    expect(result).toEqual({
      ok: true,
      query: {
        deviceId: 'd',
        cycleId: undefined,
        aggregate: 'monthly',
        limit: 500,
        offset: 20,
      },
    })
  })

  it('rejects invalid aggregate and pagination parameters', () => {
    expect(parseMeterQuery(new URLSearchParams({ aggregate: 'unknown' }))).toMatchObject({ ok: false })
    expect(parseMeterQuery(new URLSearchParams({ limit: '0' }))).toMatchObject({ ok: false })
    expect(parseMeterQuery(new URLSearchParams({ offset: '-1' }))).toMatchObject({ ok: false })
  })
})
