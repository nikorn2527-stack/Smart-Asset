import { NextRequest, NextResponse } from 'next/server'
import { db, getBaseClient } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { getOrgScope } from '@/lib/org-scope'
import { siteFilterForUser } from '@/lib/auth'
import { demoFilter } from '@/lib/demo-mode'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { notifyMeter } from '@/lib/notifications'
import { publishRealtimeEvent } from '@/lib/realtime'
import { demoTag } from '@/lib/demo-mode'
import { resolveReadingLocationSnapshot } from '@/lib/meter-logic'
import {
  findValidPrevReading,
  findSameMonthBaseline,
  findExistingMonthlyReading,
  calcPagesBw,
  calcPagesColor,
  detectModeSwitch,
  isMeterDecreased,
  normalizeReadingMonth,
  type ReadingType,
} from '@/lib/meter-logic'
import { assertMeterMonthWritable } from '@/lib/meter-snapshot'
import {
  isStaleMeterReading,
  validateMeterChannels,
} from '@/lib/meter-reading-contract'
import { classifyMeterWriteReplay, normalizeMeterReadingId } from '@/lib/meter-write-identity'

export async function GET(req: NextRequest) {
  // ── Phase 4.3: Module availability gate ──
  // Returns 404 MODULE_DISABLED when the 'meters' module is disabled.
  const moduleCheck = await moduleUnavailableResponse('meters')
  if (moduleCheck) return moduleCheck

  try {
    const auth = await requireAuth(req, 'VIEW_DEVICES')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row

    // ── Organization scope (Phase 1 multi-org) ──
    const orgScope = getOrgScope(auth.user)
    if (!orgScope.ok) return NextResponse.json({ error: orgScope.error.message }, { status: orgScope.error.status })

    const { searchParams } = new URL(req.url)
    const assetCode = (searchParams.get('assetCode')?.trim() || searchParams.get('assetNo')?.trim() || '')
    const month = searchParams.get('month')?.trim() ?? ''
    const siteParam = searchParams.get('site')?.trim() ?? ''
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))

    const where: Record<string, unknown> = { AND: [{ ...orgScope.where }] }
    if (assetCode) (where.AND as unknown[]).push({ assetCode })
    if (month) (where.AND as unknown[]).push({ readingMonth: month })

    // Site-level filter via the device relation
    const siteFilter = { ...siteFilterForUser(user), ...demoFilter(user) }
    if (Object.keys(siteFilter).length) {
      // non-superadmin: restrict to allowed sites
      (where.AND as unknown[]).push({ device: siteFilter })
    } else if (siteParam) {
      // superadmin (allowedSites='ALL'): optional ?site= filter
      (where.AND as unknown[]).push({ device: { site: siteParam } })
    }
    if (Array.isArray(where.AND) && where.AND.length === 0) delete where.AND

    const [readings, total] = await Promise.all([
      db.meterReading.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { readingDate: 'desc' },
        include: {
          device: { select: { assetCode: true, brand: true, model: true, site: true } },
        },
      }),
      db.meterReading.count({ where }),
    ])

    return NextResponse.json({
      readings,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('GET /api/itam/meter-readings', err)
    return NextResponse.json({ error: 'Failed to fetch meter readings' }, { status: 500 })
  }
}

/**
 * POST /api/itam/meter-readings — create/update meter reading (requires METER_WRITE)
 *
 * Implements the PROTECTED meter reading rules from Apps Script MeterService.gs:
 *   1. findValidPrevReading skips FINAL/SEND_REPAIR + same-month
 *   2. Same-month INITIAL/RESET fallback when no prev exists
 *   3. Mode-switch detection (TOTAL ↔ BW_COLOR)
 *   4. needConfirmReset 2-step flow (returns { needConfirmReset: true } first)
 *   5. Update existing MONTHLY in-place (upsert, not insert duplicate)
 *   6. Pages: INITIAL/RESET = 0; others = max(0, meter - prev)
 *
 * Body:
 *   assetCode, meterBw, meterColor?, readingDate?, readingMonth?,
 *   readingType?, remark?, confirmReset?, location fields?
 */
export async function POST(req: NextRequest) {
  // ── Phase 4.3: Module availability gate ──
  const moduleCheck = await moduleUnavailableResponse('meters')
  if (moduleCheck) return moduleCheck

  try {
    const auth = await requireAuth(req, 'METER_WRITE')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row
    // FIX-027: build authorization context for site-scoped permission checks.
    const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)

    const body = await req.json()
    // Support both assetCode (new) and assetNo (legacy client compat).
    // SERIAL-FIRST (METER-LOOKUP-P0): if the identifier doesn't match an
    // assetCode, fall back to serialNumber. This lets field operators scan
    // a manufacturer QR sticker (which encodes the serial) and still write
    // the meter reading without first having to look up the assetCode.
    const identifier = String(body.assetCode || body.assetNo || '').trim()
    if (!identifier || body.meterBw === undefined) {
      return NextResponse.json({ error: 'assetCode and meterBw required' }, { status: 400 })
    }

    let device = await db.device.findUnique({ where: { assetCode: identifier } })
    let matchedBy: 'assetCode' | 'serialNumber' = 'assetCode'
    if (!device) {
      const bySerial = await db.device.findMany({
        where: { serialNumber: identifier },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      })
      if (bySerial.length > 0) {
        device = bySerial[0]
        matchedBy = 'serialNumber'
      }
    }
    if (!device) return NextResponse.json({ error: 'Device not found' }, { status: 404 })
    const assetCode = device.assetCode
    // FIX-027: use canAtSite so a viewer at this site (no METER_WRITE) is denied.
    if (!ctx.canAtSite(device.site, 'METER_WRITE')) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์จดมิเตอร์สำหรับอุปกรณ์ในสาขานี้' }, { status: 403 })
    }

    const meterBw = Math.floor(Number(body.meterBw))
    const meterColor = Math.floor(Number(body.meterColor || 0))
    const finalReadingMonth = normalizeReadingMonth(body.readingMonth) ||
      new Date().toISOString().slice(0, 7)
    const readingDate = typeof body.readingDate === 'string' && body.readingDate.trim()
      ? body.readingDate.trim()
      : new Date().toISOString().slice(0, 10)

    // ── Bug DATA-03 fix: reject future dates (server timezone authoritative) ──
    // Server uses UTC today's date; client may have wrong timezone/clock skew.
    // Allow today + up to 1 day tolerance for timezone edge cases.
    const todayUtc = new Date()
    const todayStr = todayUtc.toISOString().slice(0, 10)
    const tomorrowStr = new Date(todayUtc.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    if (readingDate > tomorrowStr) {
      return NextResponse.json({
        error: `วันที่จดมิเตอร์ (${readingDate}) เป็นวันในอนาคต — กรุณาตรวจสอบวันที่ (วันนี้ ${todayStr})`,
      }, { status: 400 })
    }
    if (finalReadingMonth > todayStr.slice(0, 7)) {
      return NextResponse.json({
        error: `เดือนมิเตอร์ (${finalReadingMonth}) เป็นเดือนในอนาคต — ไม่สามารถจดล่วงหน้าได้`,
      }, { status: 400 })
    }

    const readingId = normalizeMeterReadingId(body.readingId)
    const remark = typeof body.remark === 'string' ? body.remark.trim() || null : null
    const cycleId = typeof body.cycleId === 'string' ? body.cycleId.trim() || null : null

    // A retry identity is checked before any previous-reading lookup or write
    // lock. Exact retries return the original row; conflicting reuse fails
    // closed and cannot mutate meter state.
    if (readingId) {
      const existingByIdentity = await db.meterReading.findUnique({
        where: { readingId },
        select: {
          id: true,
          readingId: true,
          assetCode: true,
          readingMonth: true,
          meterBw: true,
          meterColor: true,
          pagesBw: true,
          pagesColor: true,
          readingType: true,
        },
      })
      const replay = classifyMeterWriteReplay(
        {
          readingId,
          assetCode,
          readingMonth: finalReadingMonth,
          meterBw: Math.floor(Number(body.meterBw)),
          meterColor: Math.floor(Number(body.meterColor || 0)),
        },
        existingByIdentity,
      )
      if (replay.status === 'conflict') {
        return NextResponse.json(
          { error: 'readingId ถูกใช้กับข้อมูลมิเตอร์ชุดอื่นแล้ว', code: 'IDEMPOTENCY_CONFLICT' },
          { status: 409 },
        )
      }
      if (replay.status === 'replay' && existingByIdentity) {
        return NextResponse.json(
          {
            reading: existingByIdentity,
            reset: existingByIdentity.readingType === 'RESET',
            pagesBw: existingByIdentity.pagesBw,
            pagesColor: existingByIdentity.pagesColor,
            readingType: existingByIdentity.readingType,
            modeSwitched: false,
            isInitial: existingByIdentity.readingType === 'INITIAL',
            updated: true,
            idempotent: true,
          },
          { status: 200 },
        )
      }
    }

    // ── Write-lock: reject writes to CLOSED-cycle months ──
    try {
      await assertMeterMonthWritable(finalReadingMonth, 'บันทึกมิเตอร์')
    } catch (lockErr) {
      return NextResponse.json(
        {
          error: lockErr instanceof Error ? lockErr.message : 'รอบจดมิเตอร์ถูกปิดแล้ว',
          code: 'CYCLE_CLOSED',
        },
        { status: 409 },
      )
    }

    // ── Step 1: Find valid previous reading ──
    // METER-REDESIGN: chain within month so the end-of-month MONTHLY save
    // correctly chains off the latest in-month reading (transfer or monthly).
    // `prev` becomes the most-recent reading in this month — so `pagesBw`
    // = max(0, currentMeter - latestInMonthMeter), which is the delta since
    // the last event, not since the prior month. Combined with the upsert
    // fix (transfer readings are 'TRANSFER' type, not 'MONTHLY', so
    // findExistingMonthlyReading skips them), this fixes the over-count bug.
    let prev = await findValidPrevReading(assetCode, finalReadingMonth, { chainWithinMonth: true })

    // ── Step 2: Same-month INITIAL/RESET fallback (Apps Script lines 619-633) ──
    let isInitial = false
    if (!prev) {
      const baseline = await findSameMonthBaseline(assetCode, finalReadingMonth)
      if (baseline) {
        prev = {
          id: baseline.id,
          meterBw: baseline.meterBw,
          meterColor: baseline.meterColor,
          readingMonth: finalReadingMonth,
          readingDate,
          readingType: baseline.readingType,
          meterMode: device.meterMode ?? null,
          prevMeterMode: device.meterMode ?? null,
        }
        isInitial = true
      } else {
        // Brand-new device, no readings at all
        isInitial = true
      }
    }

    const prevMeterBw = prev?.meterBw ?? 0
    const prevMeterColor = prev?.meterColor ?? 0

    // ── Step 3: Mode-switch detection (TOTAL ↔ BW_COLOR) ──
    const prevHasColor = prev ? prev.meterColor > 0 : false
    const currentHasColor = meterColor > 0
    const { prevMeterColor: adjustedPrevColor, modeSwitched, transition } = detectModeSwitch(
      device.meterMode,
      prevHasColor,
      currentHasColor,
      prevMeterColor,
      meterColor,
    )

    // ── Step 4: Determine readingType ──
    const explicitType = body.readingType as ReadingType | null
    const meterDecreased = isMeterDecreased(meterBw, prevMeterBw, meterColor, adjustedPrevColor, isInitial)

    let readingType: ReadingType
    if (explicitType) {
      readingType = explicitType
    } else if (isInitial) {
      readingType = 'INITIAL'
    } else if (meterDecreased) {
      readingType = 'RESET'
    } else {
      readingType = 'MONTHLY'
    }

    // ── Step 5: needConfirmReset 2-step flow ──
    if (readingType === 'RESET' && !body.confirmReset) {
      return NextResponse.json(
        {
          needConfirmReset: true,
          message: 'มิเตอร์ลดลง — ต้องยืนยันการ reset และกรอกหมายเหตุ',
          assetCode,
          prevMeterBw,
          prevMeterColor: adjustedPrevColor,
          newMeterBw: meterBw,
          newMeterColor: meterColor,
        },
        { status: 409 },
      )
    }

    const channelValidation = validateMeterChannels({
      deviceId: device.id,
      date: readingDate,
      remark,
      cycleId,
      meterBw,
      previousMeterBw: prevMeterBw,
      meterColor,
      previousMeterColor: adjustedPrevColor,
    })
    if (!channelValidation.ok) {
      return NextResponse.json(
        {
          error: 'ค่ามิเตอร์ไม่ถูกต้อง',
          code: channelValidation.validation?.code,
          channel: channelValidation.channel,
        },
        { status: 400 },
      )
    }

    // ── Step 6: Calculate pages ──
    const pagesBw = calcPagesBw(meterBw, prevMeterBw, readingType)
    const pagesColor = calcPagesColor(meterColor, adjustedPrevColor, readingType)

    // ── Step 7: Check for existing MONTHLY reading in same month (upsert) ──
    const existing = await findExistingMonthlyReading(assetCode, finalReadingMonth)
    if (
      existing
      && readingType === 'MONTHLY'
      && isStaleMeterReading({ readingDate }, existing)
    ) {
      return NextResponse.json(
        {
          error: 'วันที่จดมิเตอร์เก่ากว่ารายการล่าสุดของรอบนี้',
          code: 'STALE_READING',
          existingReadingDate: existing.readingDate,
          readingDate,
        },
        { status: 409 },
      )
    }
    const persistedReadingId = readingId ?? existing?.readingId ?? null

    // Freeze WHERE the device was when the meter was read. Explicit values from
    // the caller win (imports / v1 replay); otherwise snapshot the device's
    // current location. Must be computed BEFORE any lifecycle/transfer update.
    const locationSnapshot = resolveReadingLocationSnapshot(body, device)

    const data = {
      readingId: persistedReadingId,
      deviceId: device.id,
      assetCode,
      readingDate,
      readingMonth: finalReadingMonth,
      meterBw,
      meterColor,
      pagesBw,
      pagesColor,
      prevMeterBw,
      prevMeterColor: adjustedPrevColor,
      // METER-REDESIGN: snapshot the meter mode at the time of reading so
      // future reads can reconstruct the chain even when device.meterMode
      // has since changed. `prevMeterMode` records what mode the previous
      // reading was in, so mode transitions are explicit and queryable.
      meterMode: device.meterMode ?? null,
      prevMeterMode: prev?.meterMode ?? device.meterMode ?? null,
      readBy: user.username || user.email,
      remark,
      readingType,
      // ⚠️ FREEZE THE FULL LOCATION, not just the site.
      //
      // A reading taken during a transfer is simultaneously the closing reading
      // for the OLD location and the opening baseline for the NEW one. The UI
      // posts the reading BEFORE the lifecycle call, so `device` still holds the
      // old location here — that is what we want, and the reason the two calls
      // must not be reordered. See resolveReadingLocationSnapshot() for details.
      locationAtReading: locationSnapshot.location,
      siteAtReading: locationSnapshot.site,
      buildingAtReading: locationSnapshot.building,
      floorAtReading: locationSnapshot.floor,
      departmentAtReading: locationSnapshot.department,
      departmentCodeAtReading: locationSnapshot.departmentCode,
      ...demoTag(user),
    }

    // ── BUG-METER-003 FIX (Task 12) ──
    // Save MeterReading + sync Device.lastMeterBw/lastMeterColor atomically.
    // Previously only MeterReading was saved — Device.lastMeterBw stayed
    // stale (or 0), so:
    //   • transfer-with-meter route read stale prev → pages = full reading
    //     → cumulative doubling (1000, 1500, 2000 → pages 1000+1500+2000=4500
    //       instead of correct 1000+500+500=2000)
    //   • UI showed prev = 0 always
    //   • RESET detection (delta < prev) never fired
    // The new value is the meterBw/meterColor we just persisted. For RESET
    // readings this matches the existing transfer-with-meter behavior
    // (which sets lastMeter = new reading regardless of prev).
    let saved
    await getBaseClient().$transaction(async (tx) => {
      if (existing && readingType === 'MONTHLY') {
        // Update existing MONTHLY in-place (Apps Script behavior)
        saved = await tx.meterReading.update({
          where: { id: existing.id },
          data,
        })
      } else {
        saved = await tx.meterReading.create({ data })
      }

      // Sync Device.lastMeterBw / lastMeterColor / updatedBy so the next
      // reading (and any path reading device.lastMeterBw directly) sees
      // the correct previous value.
      await tx.device.update({
        where: { id: device.id },
        data: {
          lastMeterBw: meterBw,
          lastMeterColor: meterColor,
          updatedBy: user.username || user.email,
        },
      })
    })

    // Audit log
    try {
      await db.auditLog.create({
        data: {
          action: 'METER_WRITE',
          entity: 'MeterReading',
          entityId: saved.id,
          summary: `จดมิเตอร์ ${assetCode}: BW=${meterBw} สี=${meterColor} (${readingType})`,
          detail: JSON.stringify({
            assetCode,
            meterBw,
            meterColor,
            pagesBw,
            pagesColor,
            readingType,
            reset: readingType === 'RESET',
            modeSwitched,
            modeTransition: transition,
            isInitial,
            meterMode: device.meterMode ?? null,
          }),
          actor: user.email,
        },
      })
    } catch (err) { console.error('[route]', err) }

    // Best-effort notification
    void notifyMeter({
      assetCode,
      pagesBw,
      pagesColor,
      by: user.username || user.email,
    })

    // Push SSE event
    publishRealtimeEvent({
      type: 'meter-written',
      assetNo: assetCode,
      site: device.site ?? null,
      payload: { pagesBw, pagesColor, reset: readingType === 'RESET', readingType },
    })

    return NextResponse.json(
      {
        reading: saved,
        reset: readingType === 'RESET',
        pagesBw,
        pagesColor,
        readingType,
        modeSwitched,
        modeTransition: transition,
        isInitial,
        updated: !!existing,
        idempotent: false,
      },
      { status: existing ? 200 : 201 },
    )
  } catch (err) {
    console.error('POST /api/itam/meter-readings', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to save meter reading') : 'Internal server error' },
      { status: 500 },
    )
  }
}
