import { describe, expect, it } from 'vitest'
import {
  classifyMeterWriteReplay,
  normalizeMeterReadingId,
} from '@/lib/meter-write-identity'
import {
  hasDuplicateMeterPeriod,
  validateMeterReading,
} from '@/lib/meter-reading-contract'

describe('meter write idempotency', () => {
  const request = {
    readingId: 'mobile:device-1:2026-08:attempt-1',
    assetCode: 'AST-001',
    readingMonth: '2026-08',
    meterBw: 120,
    meterColor: 12,
  }

  it('normalizes blank and oversized retry identities deterministically', () => {
    expect(normalizeMeterReadingId('   ')).toBeNull()
    expect(normalizeMeterReadingId(request.readingId)).toBe(request.readingId)
    expect(normalizeMeterReadingId('x'.repeat(200))).toHaveLength(160)
  })

  it('classifies an exact retry as replay without mutation', () => {
    expect(classifyMeterWriteReplay(request, request)).toEqual({
      status: 'replay',
      readingId: request.readingId,
    })
  })

  it('fails closed when a retry key is reused for a different payload', () => {
    expect(classifyMeterWriteReplay(
      { ...request, meterBw: 121 },
      request,
    )).toEqual({
      status: 'conflict',
      readingId: request.readingId,
    })
  })
})

describe('meter failure isolation contracts', () => {
  it('requires a remark for a decreasing reading reset', () => {
    expect(validateMeterReading({
      deviceId: 'device-1',
      reading: 90,
      previousReading: 100,
      date: '2026-08-22',
    })).toMatchObject({ ok: false, code: 'RESET_REQUIRES_REMARK', isReset: true })

    expect(validateMeterReading({
      deviceId: 'device-1',
      reading: 90,
      previousReading: 100,
      date: '2026-08-22',
      remark: 'เปลี่ยนชุดมิเตอร์',
    })).toMatchObject({ ok: true, isReset: true })
  })

  it('detects duplicate periods by device and month', () => {
    expect(hasDuplicateMeterPeriod(
      { deviceId: 'device-1', date: '2026-08-22' },
      [{ deviceId: 'device-1', date: '2026-08-01' }],
    )).toBe(true)
    expect(hasDuplicateMeterPeriod(
      { deviceId: 'device-2', date: '2026-08-22' },
      [{ deviceId: 'device-1', date: '2026-08-01' }],
    )).toBe(false)
  })
})
