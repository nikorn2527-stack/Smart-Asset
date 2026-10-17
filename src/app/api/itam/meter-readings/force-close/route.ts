// Heavy operation — needs longer timeout (Vercel Hobby: max 60s)
export const maxDuration = 60
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { normalizeReadingMonth } from '@/lib/meter-logic'
import { assertMeterMonthWritable } from '@/lib/meter-snapshot'
import { demoTag } from '@/lib/demo-mode'
import { logAudit } from '@/lib/audit'
import { publishRealtimeEvent } from '@/lib/realtime'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * POST /api/itam/meter-readings/force-close
 *
 * Force-close the meter for a specific device + month using the LAST KNOWN
 * meter value, when the operator cannot physically read the meter before the
 * cycle closes (e.g. device is broken, unreachable, in repair, or already
 * disposed without a closing reading).
 *
 * Behavior:
 *   • Looks up the device's most-recent MeterReading (any type except FINAL
 *     and SEND_REPAIR) and reuses its meterBw / meterColor as the "closing"
 *     value for the target month.
 *   • Creates a new MONTHLY reading with `pagesBw=0, pagesColor=0` (since
 *     the meter value is identical to the last reading, no usage delta).
 *   • Stamps `readingType='MONTHLY'` so it counts as a regular end-of-month
 *     reading (closes the unread gap).
 *   • Sets `remark='ปิดเดือนด้วยค่ามิเตอร์เดิม (ยังไม่ได้จด)'` so audit trail
 *     distinguishes force-close from a real reading.
 *   • Respects cycle-lock: refuses to force-close a month that overlaps
 *     a CLOSED cycle (same as the canonical writer).
 *
 * Body:
 *   { assetCode: string, month?: string (YYYY-MM, defaults to current), reason?: string }
 *
 * Permission: METER_WRITE
 */
export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('meters')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req, 'METER_WRITE')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row
    const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)

    const body = await req.json()
    const identifier = String(body.assetCode || body.assetNo || '').trim()
    if (!identifier) {
      return NextResponse.json({ error: 'assetCode required' }, { status: 400 })
    }

    // Dual-lookup: try assetCode first, then serialNumber fallback.
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
    if (!device) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 })
    }

    if (!ctx.canAtSite(device.site, 'METER_WRITE')) {
      return NextResponse.json(
        { error: 'ไม่มีสิทธิ์จดมิเตอร์สำหรับอุปกรณ์ในสาขานี้' },
        { status: 403 },
      )
    }

    const targetMonth =
      normalizeReadingMonth(body.month) || new Date().toISOString().slice(0, 7)
    const reason = typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim()
      : 'ปิดเดือนด้วยค่ามิเตอร์เดิม (ยังไม่ได้จด)'

    // Cycle-lock: refuse to force-close a CLOSED-cycle month.
    try {
      await assertMeterMonthWritable(targetMonth, 'force-close meter')
    } catch (lockErr) {
      return NextResponse.json(
        {
          error: lockErr instanceof Error ? lockErr.message : 'รอบจดมิเตอร์ถูกปิดแล้ว',
          code: 'CYCLE_CLOSED',
        },
        { status: 409 },
      )
    }

    // Look up the most recent reading for this device (any type except FINAL/SEND_REPAIR).
    const lastReading = await db.meterReading.findFirst({
      where: {
        assetCode: device.assetCode,
        readingType: { notIn: ['FINAL', 'SEND_REPAIR'] },
      },
      orderBy: [{ readingDate: 'desc' }, { id: 'desc' }],
      select: { meterBw: true, meterColor: true, readingDate: true, readingType: true },
    })
    if (!lastReading) {
      return NextResponse.json(
        {
          error:
            'ไม่พบค่ามิเตอร์ล่าสุดของเครื่องนี้ — ไม่สามารถใช้เลขเดิมปิดเดือนได้ กรุณาจดมิเตอร์จริงก่อน',
          code: 'NO_PREVIOUS_READING',
        },
        { status: 409 },
      )
    }

    // Refuse to force-close if a real MONTHLY reading already exists for this month.
    const existingMonthly = await db.meterReading.findFirst({
      where: {
        assetCode: device.assetCode,
        readingMonth: targetMonth,
        readingType: 'MONTHLY',
      },
      orderBy: { id: 'desc' },
      select: { id: true, meterBw: true, readingDate: true },
    })
    if (existingMonthly) {
      return NextResponse.json(
        {
          error: 'เดือนนี้มีการจดมิเตอร์แล้ว — ไม่จำเป็นต้อง force-close',
          code: 'ALREADY_READ',
          existing: existingMonthly,
        },
        { status: 409 },
      )
    }

    const todayIso = new Date().toISOString().slice(0, 10)
    const readingDate = body.readingDate
      ? String(body.readingDate).slice(0, 10)
      : todayIso

    // Create the force-close reading. pagesBw/pagesColor = 0 because we're
    // reusing the last known meter value (no new usage recorded).
    const created = await db.meterReading.create({
      data: {
        deviceId: device.id,
        assetCode: device.assetCode,
        readingDate,
        readingMonth: targetMonth,
        meterBw: lastReading.meterBw,
        meterColor: lastReading.meterColor,
        pagesBw: 0,
        pagesColor: 0,
        prevMeterBw: lastReading.meterBw,
        prevMeterColor: lastReading.meterColor,
        meterMode: device.meterMode ?? null,
        prevMeterMode: device.meterMode ?? null,
        readingType: 'MONTHLY',
        readBy: user.username || user.email,
        remark: reason,
        siteAtReading: device.site ?? null,
        ...demoTag(user),
      },
    })

    // Sync device.lastMeter (unchanged value but keeps the cached timestamp fresh).
    await db.device.update({
      where: { id: device.id },
      data: {
        lastMeterBw: lastReading.meterBw,
        lastMeterColor: lastReading.meterColor,
        updatedBy: user.username || user.email,
      },
    })

    // Audit log — flags force-close explicitly.
    try {
      await logAudit(
        'METER_FORCE_CLOSE',
        'MeterReading',
        created.id,
        `ปิดเดือนด้วยค่ามิเตอร์เดิม ${device.assetCode}: BW=${lastReading.meterBw} (${targetMonth})`,
        {
          assetCode: device.assetCode,
          matchedBy,
          targetMonth,
          lastReadingDate: lastReading.readingDate,
          lastReadingType: lastReading.readingType,
          reusedMeterBw: lastReading.meterBw,
          reusedMeterColor: lastReading.meterColor,
          reason,
        },
        user.email,
      )
    } catch (err) { console.error('[force-close]', err) }

    publishRealtimeEvent({
      type: 'meter-written',
      assetNo: device.assetCode,
      site: device.site ?? null,
      payload: {
        pagesBw: 0,
        pagesColor: 0,
        reset: false,
        readingType: 'MONTHLY',
        forceClose: true,
      },
    })

    return NextResponse.json(
      {
        reading: created,
        forceClose: true,
        reusedFrom: {
          readingDate: lastReading.readingDate,
          readingType: lastReading.readingType,
          meterBw: lastReading.meterBw,
          meterColor: lastReading.meterColor,
        },
        matchedBy,
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('POST /api/itam/meter-readings/force-close', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Force-close failed') : 'Internal server error' },
      { status: 500 },
    )
  }
}
