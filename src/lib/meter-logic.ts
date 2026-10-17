/**
 * meter-logic.ts — Meter reading business logic (aligned with Apps Script MeterService.gs)
 *
 * This module implements the PROTECTED meter reading rules from the original
 * Apps Script MeterService.gs. These rules MUST NOT be changed without
 * consulting the METER_RULES.md documentation.
 *
 * Key protected functions:
 *   1. findValidPrevReading — skips FINAL/SEND_REPAIR + same-month
 *   2. getLifecycleReadingType — RETURN only when wasInactive
 *   3. Per-device lastBW/lastColor (not global)
 *   4. Same-month INITIAL/RESET fallback
 *   5. Mode-switch detection (TOTAL ↔ BW_COLOR)
 *   6. needConfirmReset 2-step flow
 */

import { db } from '@/lib/db'

export type ReadingType =
  | 'MONTHLY'
  | 'INITIAL'
  | 'FINAL'
  | 'RESET'
  | 'CHECKOUT'
  | 'SEND_REPAIR'
  | 'RETURN'
  | 'TRANSFER' // Cross-site or in-site move while staying ACTIVE (NEW — distinct from MONTHLY)
  // Opening baseline written at the DESTINATION of an Active→Active move.
  // See resolveTransferBoundaryReadings() for the closing/opening pair.
  | 'TRANSFER_IN'

// USAGE_READING_TYPES now includes 'TRANSFER' so transfer readings contribute
// to usage totals. Previously transfer readings were stamped 'MONTHLY', which
// caused the canonical writer to upsert-overwrite them at end of month — double
// counting earlier transfer deltas. 'TRANSFER' is excluded from upsert lookup
// (see findExistingMonthlyReading) so end-of-month MONTHLY save always INSERTs
// a new row chaining off the most recent in-month reading (transfer or monthly).
export const USAGE_READING_TYPES: ReadingType[] = ['MONTHLY', 'CHECKOUT', 'RETURN', 'TRANSFER']
// TRANSFER_IN is a BASELINE, not a usage event: it carries the SAME meter value
// as the TRANSFER closing row, so pages are forced to 0. That is what lets both
// branches show the device in their own report without the pages being counted
// twice. It must NOT be added to SKIP_AS_PREV_TYPES — the next month's reading
// has to chain from it, otherwise it would jump back to an older row and
// double-count everything since the move.
export const BASELINE_READING_TYPES: ReadingType[] = ['INITIAL', 'RESET', 'TRANSFER_IN']
/** Reading types that should be SKIPPED when looking for a previous reading */
export const SKIP_AS_PREV_TYPES: ReadingType[] = ['FINAL', 'SEND_REPAIR']

export function isUsageReadingType(type: string | null | undefined): boolean {
  if (!type) return false
  return (USAGE_READING_TYPES as string[]).includes(type.toUpperCase())
}

export function isBaselineReadingType(type: string | null | undefined): boolean {
  if (!type) return false
  return (BASELINE_READING_TYPES as string[]).includes(type.toUpperCase())
}

function shouldSkipAsPrev(type: string | null | undefined): boolean {
  if (!type) return false
  return (SKIP_AS_PREV_TYPES as string[]).includes(type.toUpperCase())
}

/**
 * Normalize a reading month string to YYYY-MM format.
 * Accepts: "2026-01", "2026-01-15", "2026/01", etc.
 */
export function normalizeReadingMonth(value: string | null | undefined): string | null {
  if (!value) return null
  const s = String(value).trim()
  // YYYY-MM-DD → YYYY-MM
  const m = s.match(/^(\d{4})[-/](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`
  return null
}

/**
 * Location snapshot written onto every MeterReading row.
 *
 * These columns are FROZEN at read time on purpose: a device can be moved
 * later, and reports must keep attributing historical usage to where the
 * device actually was when the meter was read.
 */
export interface MeterLocationSnapshot {
  location: string | null
  site: string | null
  building: string | null
  floor: string | null
  department: string | null
  departmentCode: string | null
}

/** The subset of `Device` the snapshot needs. */
interface DeviceLocationFields {
  location?: string | null
  site?: string | null
  building?: string | null
  floor?: string | null
  department?: string | null
  departmentCode?: string | null
}

function pickString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

/**
 * ⚠️ Transfer boundary rule (see also `getLifecycleReadingType`).
 *
 * A meter reading recorded during a move plays TWO roles at once:
 *   • the CLOSING reading for the OLD location (usage up to the move belongs
 *     to where the device was), and
 *   • the OPENING baseline for the NEW location (usage from the move onward
 *     chains off this same row — we deliberately do NOT create a second row,
 *     which would double-count the delta).
 *
 * That only works if the reading is written BEFORE the device is moved,
 * because the snapshot is taken from the device's current location. Callers
 * (device-detail-sheet.tsx) therefore POST the meter reading first and the
 * lifecycle/transfer second. Do not reorder those two calls.
 *
 * Every dimension falls back to the device, not just `site`. Previously only
 * `site` fell back and the other five were written as NULL, so any report
 * grouped by building / floor / department / location silently lost the
 * transfer-boundary reading: the old building never got its closing pages and
 * the new building never got its opening baseline.
 *
 * An explicit value in `body` still wins — that is how imports and the v1 API
 * restore historical snapshots.
 */
export function resolveReadingLocationSnapshot(
  body: Record<string, unknown> | null | undefined,
  device: DeviceLocationFields,
): MeterLocationSnapshot {
  const b = body ?? {}
  return {
    location: pickString(b.locationAtReading) ?? pickString(device.location),
    site: pickString(b.siteAtReading) ?? pickString(device.site),
    building: pickString(b.buildingAtReading) ?? pickString(device.building),
    floor: pickString(b.floorAtReading) ?? pickString(device.floor),
    department: pickString(b.departmentAtReading) ?? pickString(device.department),
    departmentCode:
      pickString(b.departmentCodeAtReading) ?? pickString(device.departmentCode),
  }
}

/**
 * Build the OPENING meter reading for the destination of an Active→Active move.
 *
 * The business rule (see resolveReadingLocationSnapshot for the full context):
 * a mid-month move produces a PAIR of rows for the same meter value —
 *
 *   1. TRANSFER   at the OLD location — carries the REAL pages used there
 *   2. TRANSFER_IN at the NEW location — same number, pages forced to 0
 *
 *   …150 (A) + 0 (B) + 250 (next month at B) = 400 total, counted once.
 *
 * The opening row must therefore reuse the closing row's meter values and set
 * `prevMeter*` equal to them, and it must be written AFTER the closing row so
 * `findValidPrevReading`'s `readingDate desc, id desc` ordering picks it as the
 * predecessor for the next reading.
 *
 * Returns null when the move is NOT a plain Active→Active relocation (e.g. a
 * status change to CHECKOUT / SEND_REPAIR / FINAL): in those cases the device
 * is not sitting at the destination, so there is nothing to open.
 */
export function buildTransferInReading(params: {
  /** Meter value carried over from the closing reading. */
  meterBw: number
  meterColor: number
  /** Meter mode at the time of the move. */
  meterMode?: string | null
  /** 'YYYY-MM' the move happens in. */
  readingMonth: string | null
  /** Transfer timestamp, as stored on DeviceTransfer.moveDate. */
  readingDate: string
  /** Destination location snapshot (from the transfer body). */
  site: string | null
  building?: string | null
  floor?: string | null
  department?: string | null
  departmentCode?: string | null
  location?: string | null
  /** DeviceTransfer.id, linked so reports can join the move to the reading. */
  eventId: string
  eventType: string
  readBy: string
}): Record<string, unknown> {
  const month = params.readingMonth ?? normalizeReadingMonth(params.readingDate)
  return {
    meterBw: params.meterBw,
    meterColor: params.meterColor,
    // Same value as the reading above → the baseline type forces pages to 0.
    prevMeterBw: params.meterBw,
    prevMeterColor: params.meterColor,
    pagesBw: 0,
    pagesColor: 0,
    readingMonth: month,
    readingDate: params.readingDate,
    readingType: 'TRANSFER_IN' as const,
    meterMode: params.meterMode ?? null,
    prevMeterMode: params.meterMode ?? null,
    siteAtReading: params.site,
    buildingAtReading: params.building ?? null,
    floorAtReading: params.floor ?? null,
    departmentAtReading: params.department ?? null,
    departmentCodeAtReading: params.departmentCode ?? null,
    locationAtReading: params.location ?? null,
    readBy: params.readBy,
    remark: 'เปิดงวดมิเตอร์ที่สาขาปลายทาง (ย้ายจากสาขาเดิม)',
    eventType: params.eventType,
    eventId: params.eventId,
  }
}

/**
 * Build the CLOSING reading for a move whose real meter value could not be read.
 *
 * Business rule (Q4): when the operator cannot reach the device, they may either
 *   • carry forward the last known number, or
 *   • type an average for that machine —
 * but they MUST give a reason. So instead of writing NO reading (which left the
 * month permanently "pending"), we write a carry-forward reading whose
 * `remark` records that the value is estimated and why.
 *
 * `pagesBw` is derived from the estimate, so a carry-forward (estimate equals
 * the last known value) naturally lands on 0 pages — the device is counted as
 * closed for the month without inventing usage.
 */
export function buildEstimatedClosingReading(params: {
  estimatedBw: number
  estimatedColor: number
  /** Last known values, used as the chain predecessor. */
  lastMeterBw: number
  lastMeterColor: number
  readingMonth: string | null
  readingDate: string
  readingType: ReadingType
  meterMode?: string | null
  /** Location being closed (the OLD side). */
  site: string | null
  building?: string | null
  floor?: string | null
  department?: string | null
  departmentCode?: string | null
  location?: string | null
  eventId: string
  eventType: string
  readBy: string
  /** Mandatory justification supplied by the operator. */
  reason: string
}): Record<string, unknown> {
  const month = params.readingMonth ?? normalizeReadingMonth(params.readingDate)
  const estBw = Math.max(0, Math.floor(params.estimatedBw))
  const estColor = Math.max(0, Math.floor(params.estimatedColor))
  return {
    meterBw: estBw,
    meterColor: estColor,
    prevMeterBw: params.lastMeterBw,
    prevMeterColor: params.lastMeterColor,
    // A carry-forward estimate (est === last) yields 0 pages here; an operator
    // supplied average yields the difference. Never negative.
    pagesBw: Math.max(0, estBw - params.lastMeterBw),
    pagesColor: Math.max(0, estColor - params.lastMeterColor),
    readingMonth: month,
    readingDate: params.readingDate,
    readingType: params.readingType,
    meterMode: params.meterMode ?? null,
    prevMeterMode: params.meterMode ?? null,
    siteAtReading: params.site,
    buildingAtReading: params.building ?? null,
    floorAtReading: params.floor ?? null,
    departmentAtReading: params.department ?? null,
    departmentCodeAtReading: params.departmentCode ?? null,
    locationAtReading: params.location ?? null,
    readBy: params.readBy,
    // Flagged in the text so a reviewer can tell a real read from an estimate
    // without needing a new readingType.
    remark: `ปิดงวดด้วยค่าประมาณ (ยังไม่ได้อ่านเครื่อง): ${params.reason}`,
    eventType: params.eventType,
    eventId: params.eventId,
  }
}

/**
 * ⚠️ PROTECTED #1-3: Find the valid previous reading for a device.
 *
 * Rules (from Apps Script MeterService.gs findValidPrevReading):
 *   1. Skip readings where readingMonth >= targetMonth (same month + future)
 *   2. Skip FINAL and SEND_REPAIR readings (disposed/repaired devices)
 *   3. RETURN is allowed (it's a new baseline after reactivation)
 *   4. Sort by month desc, then by row id desc (latest first)
 *
 * @param assetCode - device assetCode (was assetNo in old schema)
 * @param readingMonth - target month in YYYY-MM format
 * @param exclusiveCurrentMonth - if true (default), skip same-month readings
 * @returns the previous reading row, or null if none found
 */
export async function findValidPrevReading(
  assetCode: string,
  readingMonth: string,
  optionsOrExclusive: boolean | { chainWithinMonth?: boolean } = { chainWithinMonth: true },
): Promise<{
  id: string
  meterBw: number
  meterColor: number
  readingMonth: string | null
  readingDate: string
  readingType: string | null
  meterMode: string | null
  prevMeterMode: string | null
} | null> {
  // Accept both the legacy boolean and the new options shape.
  const opts =
    typeof optionsOrExclusive === 'boolean'
      ? { chainWithinMonth: !optionsOrExclusive } // legacy: exclusive=true → chain=false
      : optionsOrExclusive
  const chainWithinMonth = opts.chainWithinMonth ?? true

  const targetMonth = normalizeReadingMonth(readingMonth)
  if (!targetMonth) return null

  // Fetch all readings for this device (ordered by date desc, then id desc)
  const readings = await db.meterReading.findMany({
    where: {
      assetCode,
      readingMonth: { not: null },
    },
    select: {
      id: true,
      meterBw: true,
      meterColor: true,
      readingMonth: true,
      readingDate: true,
      readingType: true,
      meterMode: true,
      prevMeterMode: true,
    },
    orderBy: [{ readingDate: 'desc' }, { id: 'desc' }],
  })

  const candidates: Array<{
    id: string
    meterBw: number
    meterColor: number
    readingMonth: string | null
    readingDate: string
    readingType: string | null
    meterMode: string | null
    prevMeterMode: string | null
  }> = []
  for (const row of readings) {
    const rowMonth = normalizeReadingMonth(row.readingMonth || row.readingDate)
    if (!rowMonth) continue
    if (chainWithinMonth) {
      // New behavior: skip FUTURE months only (allow same month).
      if (rowMonth > targetMonth) continue
    } else {
      // Legacy behavior: skip same month + future.
      if (rowMonth >= targetMonth) continue
    }
    // Rule: skip FINAL/SEND_REPAIR
    if (shouldSkipAsPrev(row.readingType)) continue
    candidates.push(row)
  }

  if (candidates.length === 0) return null
  // Already sorted by date desc, then id desc from the query
  return candidates[0]
}

/**
 * Find a same-month INITIAL or RESET reading for fallback.
 * Used when no prev reading exists before the target month, but there's
 * a baseline reading in the same month (Apps Script lines 619-633).
 */
export async function findSameMonthBaseline(
  assetCode: string,
  readingMonth: string,
): Promise<{
  id: string
  meterBw: number
  meterColor: number
  readingType: string | null
} | null> {
  const targetMonth = normalizeReadingMonth(readingMonth)
  if (!targetMonth) return null

  const baseline = await db.meterReading.findFirst({
    where: {
      assetCode,
      readingMonth: targetMonth,
      readingType: { in: ['INITIAL', 'RESET'] },
    },
    select: { id: true, meterBw: true, meterColor: true, readingType: true },
    orderBy: { id: 'desc' },
  })

  return baseline
}

/**
 * ⚠️ PROTECTED #6: Determine readingType for a lifecycle status change.
 *
 * Rules (revised — METER-REDESIGN):
 *   • DISPOSED/RETIRED/RETURNED → FINAL
 *   • IN REPAIR → SEND_REPAIR
 *   • INACTIVE/IN STOCK → CHECKOUT
 *   • ACTIVE → RETURN only if wasInactive (fromStatus was repair/inactive/stock/etc.)
 *   • ACTIVE → TRANSFER if fromStatus was ACTIVE (i.e. cross-site or in-site move)
 *              — was previously returning MONTHLY, which caused the canonical
 *              writer to upsert-overwrite the transfer reading at end of month.
 *              Returning TRANSFER ensures transfer readings are NEVER picked up
 *              by findExistingMonthlyReading (which only matches MONTHLY), so
 *              end-of-month saves always INSERT a new MONTHLY row chaining off
 *              the latest transfer reading.
 */
export function getLifecycleReadingType(
  toStatus: string | null | undefined,
  fromStatus: string | null | undefined,
): ReadingType {
  const s = (toStatus ?? '').trim().toUpperCase()
  const f = (fromStatus ?? '').trim().toUpperCase()

  if (s === 'DISPOSED' || s === 'RETIRED' || s === 'RETURNED') return 'FINAL'
  if (s === 'IN REPAIR') return 'SEND_REPAIR'
  if (s === 'INACTIVE' || s === 'IN STOCK') return 'CHECKOUT'

  if (s === 'ACTIVE') {
    const wasInactive =
      f.includes('REPAIR') ||
      f === 'INACTIVE' ||
      f === 'IN STOCK' ||
      f === 'PENDING REPAIR' ||
      f === 'TEMPORARY' ||
      f === 'DISPOSED' ||
      f === 'RETIRED' ||
      f === 'RETURNED'
    if (wasInactive) return 'RETURN'
    // Active→Active move (cross-site or in-site transfer while staying active):
    // use 'TRANSFER' so this reading is distinct from end-of-month MONTHLY and
    // will not be picked up for upsert at month end.
    if (f === 'ACTIVE' || f === '') return 'TRANSFER'
    return 'TRANSFER'
  }

  return 'CHECKOUT'
}

/**
 * Page-delta calculation aligned with Apps Script MeterService.gs.
 *
 * Rules:
 *   • INITIAL (brand-new): pages = 0 (baseline)
 *   • INITIAL (transfer):  pages = 0 (prev = meter, delta = 0)
 *   • RESET:                pages = 0 (new baseline)
 *   • MONTHLY/CHECKOUT/FINAL/RETURN/SEND_REPAIR: pages = max(0, current - prev)
 */
export function calcPagesBw(
  meterBw: number,
  prevMeterBw: number,
  readingType: string | null | undefined,
): number {
  if (isBaselineReadingType(readingType)) return 0
  return Math.max(0, meterBw - prevMeterBw)
}

export function calcPagesColor(
  meterColor: number,
  prevMeterColor: number,
  readingType: string | null | undefined,
): number {
  if (isBaselineReadingType(readingType)) return 0
  return Math.max(0, meterColor - prevMeterColor)
}

/**
 * Detect mode-switch (TOTAL ↔ BW_COLOR).
 *
 * When a device switches meter mode, the prev reading might not have color
 * data. In that case, we set prevColor = current meterColor so that pages=0
 * for color (baseline), and flag modeSwitched = true.
 *
 * @returns { prevMeterColor, modeSwitched }
 */
export type MeterModeTransition =
  | 'NONE'
  | 'TOTAL_TO_BW_COLOR'
  | 'BW_COLOR_TO_TOTAL'

/**
 * ⚠️ PROTECTED #5 (revised — METER-REDESIGN): Detect mode-switch (TOTAL ↔ BW_COLOR).
 *
 * Two transitions:
 *   1. `TOTAL → BW_COLOR`: device previously had only `meterBw` (TOTAL mode),
 *      now reports `meterColor > 0`. The color channel is a NEW baseline — set
 *      `prevMeterColor = currentMeterColor` so `pagesColor = 0` for this reading.
 *      BW channel continues chaining normally.
 *   2. `BW_COLOR → TOTAL`: device previously had separate BW+Color, now reports
 *      only `meterBw` (TOTAL mode, color folded into BW). The color channel
 *      stops accumulating — `pagesColor = 0`. BW channel continues chaining.
 *
 * The snapshots `meterMode` / `prevMeterMode` are persisted on each MeterReading
 * row so future reads can reconstruct the chain even when device.meterMode has
 * since changed.
 *
 * @returns { prevMeterColor, modeSwitched, transition }
 */
export function detectModeSwitch(
  currentMeterMode: string | null | undefined,
  prevHasColor: boolean,
  currentHasColor: boolean,
  prevMeterColor: number,
  currentMeterColor: number,
): {
  prevMeterColor: number
  modeSwitched: boolean
  transition: MeterModeTransition
} {
  const mode = (currentMeterMode ?? '').toUpperCase()
  // If prev had no color but current does → mode switched to BW_COLOR
  if (!prevHasColor && currentHasColor && mode === 'BW_COLOR') {
    return {
      prevMeterColor: currentMeterColor, // baseline — pagesColor = 0
      modeSwitched: true,
      transition: 'TOTAL_TO_BW_COLOR',
    }
  }
  // If prev had color but current doesn't → mode switched to TOTAL
  if (prevHasColor && !currentHasColor && mode === 'TOTAL') {
    return {
      prevMeterColor: 0, // no color channel to compare — pagesColor = 0
      modeSwitched: true,
      transition: 'BW_COLOR_TO_TOTAL',
    }
  }
  return { prevMeterColor, modeSwitched: false, transition: 'NONE' }
}

/**
 * Check if a device requires meter readings based on its type.
 * Falls back to type-based detection if meterRequired flag is null.
 *
 * Types that require meters: PRINTER, COPIER, MFP
 * Types that don't: THERMAL, LABEL, BARCODE, SLIP, POS
 */
export function isMeterRequiredDevice(device: {
  meterRequired: boolean | null
  type: string
}): boolean {
  if (device.meterRequired !== null) return device.meterRequired
  const type = (device.type || '').toUpperCase()
  if (type.includes('PRINTER') || type.includes('COPIER') || type.includes('MFP')) return true
  if (
    type.includes('THERMAL') ||
    type.includes('LABEL') ||
    type.includes('BARCODE') ||
    type.includes('SLIP') ||
    type.includes('POS')
  ) {
    return false
  }
  return false
}

/**
 * Check if a meter reading represents a decrease (RESET condition).
 * Used to trigger the needConfirmReset 2-step flow.
 */
export function isMeterDecreased(
  meterBw: number,
  prevMeterBw: number,
  meterColor: number,
  prevMeterColor: number,
  isInitial: boolean,
): boolean {
  if (isInitial) return false
  return meterBw < prevMeterBw || meterColor < prevMeterColor
}

/**
 * Check if a device already has a MONTHLY reading for the target month.
 * Used to decide whether to update in-place or insert new.
 *
 * NOTE (METER-REDESIGN): only `readingType='MONTHLY'` is matched here.
 * Transfer readings (created by transfer-with-meter route) are stamped
 * `'TRANSFER'` and will NOT be picked up — so the end-of-month MONTHLY
 * save always INSERTs a new row, even when transfer readings exist in
 * the same month. The new row chains off the most recent in-month
 * reading via `findValidPrevReading({ chainWithinMonth: true })`.
 */
export async function findExistingMonthlyReading(
  assetCode: string,
  readingMonth: string,
): Promise<{ id: string; readingDate: string; readingId: string | null } | null> {
  const targetMonth = normalizeReadingMonth(readingMonth)
  if (!targetMonth) return null

  return db.meterReading.findFirst({
    where: {
      assetCode,
      readingMonth: targetMonth,
      readingType: 'MONTHLY',
    },
    select: { id: true, readingDate: true, readingId: true },
    orderBy: { id: 'desc' },
  })
}
