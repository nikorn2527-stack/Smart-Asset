// ============================================================
// Meter location snapshot — transfer boundary contract
// ============================================================
// WHY THIS FILE EXISTS
//   A meter reading taken while a device is being moved plays TWO roles:
//     • closing reading for the OLD location (usage up to the move)
//     • opening baseline for the NEW location (usage from the move onward)
//
//   It is ONE row on purpose — two rows would double-count the delta. The row
//   belongs to wherever the device sat when it was read, and the UI reads
//   BEFORE it moves, so the device still holds the old location at write time.
//
//   This locks in the part that used to be broken: only `site` fell back to
//   the device, while building/floor/department/location were written as NULL.
//   Any report grouped by those dimensions silently lost the transfer boundary.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  resolveReadingLocationSnapshot,
  buildTransferInReading,
  buildEstimatedClosingReading,
  calcPagesBw,
  isBaselineReadingType,
  BASELINE_READING_TYPES,
  normalizeReadingMonth,
} from '@/lib/meter-logic'

const DEVICE_AT_OLD_SITE = {
  site: 'UDH',
  building: 'อาคาร 1',
  floor: 'ชั้น 2',
  department: 'การเงิน',
  departmentCode: 'FIN-01',
  location: 'ห้อง 201',
}

describe('resolveReadingLocationSnapshot', () => {
  it('freezes EVERY location dimension from the device when the caller sends none', () => {
    // This is the transfer path: the UI posts the meter reading with no
    // location fields, before the device is moved.
    expect(resolveReadingLocationSnapshot({}, DEVICE_AT_OLD_SITE)).toEqual({
      site: 'UDH',
      building: 'อาคาร 1',
      floor: 'ชั้น 2',
      department: 'การเงิน',
      departmentCode: 'FIN-01',
      location: 'ห้อง 201',
    })
  })

  it('treats blank / whitespace values as absent and falls back to the device', () => {
    const snap = resolveReadingLocationSnapshot(
      { siteAtReading: '', buildingAtReading: '   ', floorAtReading: null },
      DEVICE_AT_OLD_SITE,
    )
    expect(snap.site).toBe('UDH')
    expect(snap.building).toBe('อาคาร 1')
    expect(snap.floor).toBe('ชั้น 2')
  })

  it('lets an explicit caller value win (imports / v1 historical replay)', () => {
    const snap = resolveReadingLocationSnapshot(
      { siteAtReading: 'NKP', buildingAtReading: 'อาคาร 9' },
      DEVICE_AT_OLD_SITE,
    )
    expect(snap.site).toBe('NKP')
    expect(snap.building).toBe('อาคาร 9')
    // Dimensions the caller did not mention still come from the device.
    expect(snap.department).toBe('การเงิน')
  })

  it('returns nulls (not undefined/empty strings) when neither side has a value', () => {
    const snap = resolveReadingLocationSnapshot(null, {})
    expect(snap).toEqual({
      site: null,
      building: null,
      floor: null,
      department: null,
      departmentCode: null,
      location: null,
    })
  })

  it('keeps the boundary row attributable to the OLD location after a move', () => {
    // Regression guard: the reading written just before the move must carry the
    // old building, otherwise the old building's report loses its closing pages
    // and the new building never gets an opening baseline.
    const atMoveTime = resolveReadingLocationSnapshot({}, DEVICE_AT_OLD_SITE)
    const afterMove = { ...DEVICE_AT_OLD_SITE, site: 'NKP', building: 'อาคาร 9' }

    expect(atMoveTime.site).toBe('UDH')
    expect(atMoveTime.building).toBe('อาคาร 1')
    // The device has since moved, but the frozen snapshot must not follow it.
    expect(afterMove.building).toBe('อาคาร 9')
    expect(atMoveTime.building).not.toBe(afterMove.building)
  })
})
// ============================================================
// Transfer boundary pair — closing (TRANSFER) + opening (TRANSFER_IN)
// ============================================================
// Scenario: printer sits at branch A for Aug 1–15, moves to branch B on Aug 15
// at meter 1,250. Previous MONTHLY at A was 1,100.
//
//   A ใช้จริง 150 · B ใช้จริง 250 (เดือนถัดไป) · รวม 400 · นับครั้งเดียว
//
// The requirement: BOTH branches must show the device in their own report,
// anchored to where the device actually was during that period.
describe('transfer boundary pair (TRANSFER → TRANSFER_IN)', () => {
  const CLOSING_METER = 1250
  const PREV_METER = 1100

  const opening = buildTransferInReading({
    meterBw: CLOSING_METER,
    meterColor: 0,
    meterMode: 'TOTAL',
    readingMonth: '2026-08',
    readingDate: '2026-08-15T10:00:00.000Z',
    site: 'NKP',
    building: 'อาคาร 9',
    floor: 'ชั้น 1',
    department: 'บัญชี',
    departmentCode: 'ACC-01',
    location: 'ห้อง 901',
    eventId: 'transfer-1',
    eventType: 'TRANSFER_SITE',
    readBy: 'admin',
  })

  it('opens at the destination with the SAME meter number as the closing row', () => {
    expect(opening.meterBw).toBe(CLOSING_METER)
    expect(opening.prevMeterBw).toBe(CLOSING_METER)
  })

  it('is a baseline, so it contributes 0 pages and cannot double-count', () => {
    expect(opening.readingType).toBe('TRANSFER_IN')
    expect(BASELINE_READING_TYPES).toContain('TRANSFER_IN')
    expect(isBaselineReadingType('TRANSFER_IN')).toBe(true)
    // calcPagesBw is the real consumer — a baseline always yields 0.
    expect(calcPagesBw(opening.meterBw as number, opening.prevMeterBw as number, 'TRANSFER_IN')).toBe(0)
  })

  it('snapshots the DESTINATION location on every dimension', () => {
    expect(opening.siteAtReading).toBe('NKP')
    expect(opening.buildingAtReading).toBe('อาคาร 9')
    expect(opening.floorAtReading).toBe('ชั้น 1')
    expect(opening.departmentAtReading).toBe('บัญชี')
    expect(opening.departmentCodeAtReading).toBe('ACC-01')
    expect(opening.locationAtReading).toBe('ห้อง 901')
  })

  it('lands in the same month as the closing reading', () => {
    expect(opening.readingMonth).toBe('2026-08')
    // Falls back to the transfer date when the closing reading has no month.
    expect(
      buildTransferInReading({
        meterBw: 1, meterColor: 0, readingMonth: null,
        readingDate: '2026-09-03T00:00:00.000Z', site: 'UDH',
        eventId: 't2', eventType: 'TRANSFER', readBy: 'a',
      }).readingMonth,
    ).toBe('2026-09')
    expect(normalizeReadingMonth('2026-08-15')).toBe('2026-08')
  })

  it('links back to the DeviceTransfer row for audit', () => {
    expect(opening.eventId).toBe('transfer-1')
    expect(opening.eventType).toBe('TRANSFER_SITE')
  })
})

// ============================================================
// Estimated closing reading (Q4) — cannot read the device
// ============================================================
// Rule: when the operator cannot reach the machine they may carry the last
// known number forward, or type an average — but they MUST give a reason.
// Previously the acknowledgement wrote NO reading at all, leaving the device
// permanently "pending" in that month.
describe('estimated closing reading (carry-forward / average)', () => {
  const LAST_BW = 1250
  const LAST_COLOR = 40

  const base = {
    lastMeterBw: LAST_BW,
    lastMeterColor: LAST_COLOR,
    readingMonth: '2026-08',
    readingDate: '2026-08-15T10:00:00.000Z',
    readingType: 'TRANSFER' as const,
    meterMode: 'BW_COLOR',
    site: 'UDH',
    building: 'อาคาร 1',
    floor: 'ชั้น 2',
    department: 'การเงิน',
    departmentCode: 'FIN-01',
    location: 'ห้อง 201',
    eventId: 'transfer-9',
    eventType: 'TRANSFER_SITE',
    readBy: 'admin',
    reason: 'เครื่องอยู่ที่ชั้น 3 ปิดประตูซ่อม',
  }

  it('carrying forward the last number closes the month with 0 pages', () => {
    const row = buildEstimatedClosingReading({ ...base, estimatedBw: LAST_BW, estimatedColor: LAST_COLOR })
    expect(row.meterBw).toBe(LAST_BW)
    expect(row.pagesBw).toBe(0)
    expect(row.pagesColor).toBe(0)
    // The row exists → the device leaves the pending list for the month.
    expect(row.readingMonth).toBe('2026-08')
    expect(row.readingType).toBe('TRANSFER')
  })

  it('an operator-supplied average produces the real difference', () => {
    // Operator estimates the device was used up to ~1400 since the last read.
    const row = buildEstimatedClosingReading({ ...base, estimatedBw: 1400, estimatedColor: 40 })
    expect(row.meterBw).toBe(1400)
    expect(row.pagesBw).toBe(150)
    expect(row.prevMeterBw).toBe(LAST_BW)
  })

  it('never records negative pages when the estimate is below the last value', () => {
    const row = buildEstimatedClosingReading({ ...base, estimatedBw: 1000, estimatedColor: 10 })
    expect(row.pagesBw).toBe(0)
    expect(row.pagesColor).toBe(0)
  })

  it('always records that the value is estimated, and why', () => {
    const row = buildEstimatedClosingReading({ ...base, estimatedBw: LAST_BW, estimatedColor: LAST_COLOR })
    const remark = String(row.remark)
    expect(remark).toContain('ค่าประมาณ')
    expect(remark).toContain(base.reason)
  })

  it('closes at the OLD location, so the old branch keeps the attributed usage', () => {
    const row = buildEstimatedClosingReading({ ...base, estimatedBw: 1400, estimatedColor: 40 })
    expect(row.siteAtReading).toBe('UDH')
    expect(row.buildingAtReading).toBe('อาคาร 1')
    expect(row.departmentAtReading).toBe('การเงิน')
  })

  it('still opens TRANSFER_IN at the destination so the new branch is not blind', () => {
    const estimated = buildEstimatedClosingReading({ ...base, estimatedBw: 1400, estimatedColor: 40 })
    const opening = buildTransferInReading({
      meterBw: estimated.meterBw as number,
      meterColor: estimated.meterColor as number,
      meterMode: 'BW_COLOR',
      readingMonth: '2026-08',
      readingDate: base.readingDate,
      site: 'NKP',
      eventId: 'transfer-9',
      eventType: 'TRANSFER_SITE',
      readBy: 'admin',
    })
    expect(opening.readingType).toBe('TRANSFER_IN')
    expect(opening.siteAtReading).toBe('NKP')
    expect(opening.pagesBw).toBe(0)
    // Branch A books the estimated 150; branch B starts from 1400.
    expect(estimated.pagesBw).toBe(150)
    expect(calcPagesBw(1500, opening.meterBw as number, 'MONTHLY')).toBe(100)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Q3 (transfer boundary) — continued: the chain arithmetic
// ────────────────────────────────────────────────────────────────────────────
describe('transfer boundary totals', () => {
  const CLOSING_METER = 1250
  const PREV_METER = 1100
  const opening = buildTransferInReading({
    meterBw: CLOSING_METER,
    meterColor: 0,
    meterMode: 'TOTAL',
    readingMonth: '2026-08',
    readingDate: '2026-08-15T10:00:00.000Z',
    site: 'NKP',
    eventId: 'transfer-1',
    eventType: 'TRANSFER_SITE',
    readBy: 'admin',
  })

  it('totals correctly: old branch keeps its pages, new branch gets its own', () => {
    // Closing row at A — a TRANSFER is a USAGE row, so real pages are kept.
    const closingPages = calcPagesBw(CLOSING_METER, PREV_METER, 'TRANSFER')
    expect(closingPages).toBe(150)

    // Opening row at B — baseline, zero pages.
    const openingPages = calcPagesBw(
      opening.meterBw as number,
      opening.prevMeterBw as number,
      'TRANSFER_IN',
    )
    expect(openingPages).toBe(0)

    // Next month at B: 1,500 chains off the opening baseline → 250 pages for B.
    const nextMonthAtB = calcPagesBw(1500, CLOSING_METER, 'MONTHLY')
    expect(nextMonthAtB).toBe(250)

    // The device consumed 1,500 − 1,100 = 400 pages in total, counted ONCE.
    expect(closingPages + openingPages + nextMonthAtB).toBe(400)
    expect(1500 - PREV_METER).toBe(400)
  })

  it('gives each branch its own attributable row', () => {
    // Branch A's report sees the closing row (stamped A by the pre-move read).
    const closingSnapshot = resolveReadingLocationSnapshot({}, DEVICE_AT_OLD_SITE)
    expect(closingSnapshot.site).toBe('UDH')

    // Branch B's report sees the opening row.
    expect(opening.siteAtReading).toBe('NKP')

    // …and they are different rows for the same device in the same month.
    expect(closingSnapshot.site).not.toBe(opening.siteAtReading)
    expect(opening.readingMonth).toBe('2026-08')
  })
})