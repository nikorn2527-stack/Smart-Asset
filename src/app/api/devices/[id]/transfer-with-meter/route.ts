/**
 * src/app/api/devices/[id]/transfer-with-meter/route.ts
 *
 * GAP-P0-1 FIX: Atomic meter reading + device transfer in a single transaction.
 *
 * Legacy flow (non-atomic):
 *   1. UI calls POST /api/meter → creates MeterReading
 *   2. UI calls POST /api/itam/devices/[id]/transfer → updates device + history
 *   If step 2 fails, MeterReading is orphaned (LIFECYCLE_METER_INCOMPLETE marker)
 *
 * New flow (atomic):
 *   1. UI calls POST /api/devices/[id]/transfer-with-meter
 *      → Creates MeterReading + updates device + creates history in ONE $transaction
 *   → All commit or rollback together — no orphaned data
 *
 * Permission: DEVICE_TRANSFER
 */

import { NextRequest, NextResponse } from 'next/server'
import { db, getBaseClient } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { getNextAssetSiteCode, normalizeAssetSiteCodeForCompare } from '@/lib/asset-site-code'
import { getLifecycleReadingType } from '@/lib/lifecycle-reading-type'
import { notifyTransfer } from '@/lib/notifications'
import { publishRealtimeEvent } from '@/lib/realtime'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req, 'DEVICE_TRANSFER')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row
    // SPRINT-5-MUTATION-CTX-MIGRATION: use ctx.canAtSite for site-scoped perm checks.
    const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)

    const { id } = await params
    const body = await req.json()

    const device = await db.device.findFirst({
      where: { OR: [{ id }, { assetCode: id }] },
    })
    if (!device) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 })
    }

    if (!ctx.canAtSite(device.site, 'DEVICE_TRANSFER')) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์ย้ายอุปกรณ์ในสาขานี้' }, { status: 403 })
    }
    const toSite = String(body.toSite ?? '').trim()
    if (!toSite) {
      return NextResponse.json({ error: 'กรุณาระบุสาขาปลายทาง' }, { status: 400 })
    }
    if (!ctx.canAtSite(toSite, 'DEVICE_TRANSFER')) {
      return NextResponse.json({ error: `ไม่มีสิทธิ์ย้ายอุปกรณ์ไปสาขา: ${toSite}` }, { status: 403 })
    }

    const meterBw = body.meterBw != null ? Number(body.meterBw) : null
    const meterColor = body.meterColor != null ? Number(body.meterColor) : null
    const meterSkipAcknowledged = Boolean(body.meterSkipAcknowledged)
    const skipMeterReason = body.skipMeterReason ? String(body.skipMeterReason).trim() : null

    if (device.meterRequired && meterBw === null && !meterSkipAcknowledged) {
      return NextResponse.json(
        { error: 'ต้องจดมิเตอร์ก่อนย้าย หรือยืนยันว่า "มิเตอร์นับต่อเนื่อง"', code: 'METER_REQUIRED' },
        { status: 400 },
      )
    }

    const toStatus = body.toStatus ? String(body.toStatus).trim() : device.status
    const derivedReadingType = getLifecycleReadingType(device.status, toStatus)

    const isCrossSite = !device.site || device.site !== toSite
    let toAssetSiteCode = String(body.toAssetSiteCode ?? '').trim()
    if (!toAssetSiteCode) {
      if (isCrossSite) {
        const generated = await getNextAssetSiteCode(toSite, { assetNo: device.assetCode })
        toAssetSiteCode = generated ?? device.assetSiteCode ?? ''
      } else {
        toAssetSiteCode = device.assetSiteCode ?? ''
      }
    }

    const toBuilding = body.toBuilding != null ? String(body.toBuilding).trim() || null : device.building
    const toFloor = body.toFloor != null ? String(body.toFloor).trim() || null : device.floor
    const toDepartment = body.toDepartment != null ? String(body.toDepartment).trim() || null : device.department
    const toDepartmentCode = body.toDepartmentCode != null ? String(body.toDepartmentCode).trim() || null : device.departmentCode
    const toLocation = body.toLocation != null ? String(body.toLocation).trim() || null : device.location

    if (
      !isCrossSite &&
      toBuilding === device.building &&
      toFloor === device.floor &&
      toDepartment === device.department &&
      toLocation === device.location &&
      toStatus === device.status
    ) {
      return NextResponse.json(
        { error: 'ตำแหน่งปลายทางตรงกับตำแหน่งปัจจุบัน — ไม่จำเป็นต้องย้าย', code: 'SAME_LOCATION' },
        { status: 400 },
      )
    }

    const fromSnapshot = {
      site: device.site,
      assetSiteCode: device.assetSiteCode,
      building: device.building,
      floor: device.floor,
      department: device.department,
      departmentCode: device.departmentCode,
      location: device.location,
      status: device.status,
    }

    const nowIso = new Date().toISOString()
    const moveDate = body.transferDate ? String(body.transferDate).trim() : nowIso
    const movedBy = user.username || user.email
    const action = isCrossSite ? 'TRANSFER_SITE' : 'TRANSFER'
    const logId = `MV-${nowIso.replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.floor(Math.random() * 90000) + 10000}`

    // ── ATOMIC TRANSACTION ──
    const result = await getBaseClient().$transaction(async (tx) => {
      let meterReadingId: string | null = null

      // 1. Create MeterReading (if meter values provided)
      // METER-REDESIGN: transfer readings are stamped `readingType='TRANSFER'`
      // (not 'MONTHLY') so they are excluded from findExistingMonthlyReading's
      // upsert lookup at end-of-month. This ensures the end-of-month MONTHLY
      // save INSERTs a new row chaining off the latest transfer, instead of
      // overwriting the transfer's row (which would double-count earlier
      // transfer deltas in monthly aggregates).
      if (meterBw !== null || meterColor !== null) {
        const bw = meterBw ?? 0
        const color = meterColor ?? 0
        const prevBw = device.lastMeterBw ?? 0
        const prevColor = device.lastMeterColor ?? 0
        const pagesBw = Math.max(0, bw - prevBw)
        const pagesColor = Math.max(0, color - prevColor)

        const reading = await tx.meterReading.create({
          data: {
            deviceId: device.id,
            assetCode: device.assetCode,
            readingDate: body.readingDate || nowIso.slice(0, 10),
            readingMonth: body.readingMonth || nowIso.slice(0, 7),
            meterBw: bw,
            meterColor: color,
            pagesBw,
            pagesColor,
            prevMeterBw: prevBw,
            prevMeterColor: prevColor,
            // Snapshot the meter mode at the time of transfer so future reads
            // can detect mode switches even when device.meterMode has changed.
            meterMode: device.meterMode ?? null,
            prevMeterMode: device.meterMode ?? null,
            readingType: derivedReadingType,
            readBy: movedBy,
            remark: skipMeterReason || null,
          },
        })
        meterReadingId = reading.id

        await tx.device.update({
          where: { id: device.id },
          data: { lastMeterBw: bw, lastMeterColor: color },
        })
      }

      // 2. Update device
      const updatedDevice = await tx.device.update({
        where: { id: device.id },
        data: {
          site: toSite,
          building: toBuilding,
          floor: toFloor,
          department: toDepartment,
          departmentCode: toDepartmentCode,
          location: toLocation,
          assetSiteCode: toAssetSiteCode || null,
          status: toStatus,
          updatedBy: movedBy,
        },
      })

      // 3. Create history
      const historyRow = await tx.deviceTransfer.create({
        data: {
          logId,
          deviceId: device.id,
          assetCode: device.assetCode,
          moveDate,
          transferDate: moveDate,
          action,
          fromStatus: fromSnapshot.status,
          toStatus,
          fromSite: fromSnapshot.site,
          fromAssetSiteCode: fromSnapshot.assetSiteCode,
          fromBuilding: fromSnapshot.building,
          fromFloor: fromSnapshot.floor,
          fromDepartment: fromSnapshot.department,
          fromDepartmentCode: fromSnapshot.departmentCode,
          fromLocation: fromSnapshot.location,
          toSite,
          toAssetSiteCode: toAssetSiteCode || null,
          toBuilding,
          toFloor,
          toDepartment,
          toDepartmentCode,
          toLocation,
          meterReadingId,
          movedBy,
          remark: skipMeterReason || null,
        },
      })

      // 4. Link meter to transfer
      if (meterReadingId) {
        await tx.meterReading.update({
          where: { id: meterReadingId },
          data: { eventType: action, eventId: historyRow.id },
        })
      }

      return { updatedDevice, historyRow, meterReadingId }
    })

    // Post-transaction (best-effort)
    try {
      await logAudit(
        'TRANSFER',
        'DeviceTransfer',
        result.historyRow.id,
        `ย้ายอุปกรณ์ ${device.assetCode} ไป ${toSite}`,
        {
          assetCode: device.assetCode,
          from: fromSnapshot,
          to: { site: toSite, building: toBuilding, floor: toFloor, department: toDepartment, location: toLocation, status: toStatus },
          crossSite: isCrossSite,
          meterReadingId: result.meterReadingId,
          derivedReadingType,
        },
        user.email,
        toSite,
      )
    } catch (err) { console.error('[route]', err) }

    void notifyTransfer({
      assetCode: device.assetCode,
      fromSite: fromSnapshot.site,
      toSite,
      by: movedBy,
    })

    publishRealtimeEvent({
      type: 'device-transferred',
      assetNo: device.assetCode,
      site: toSite,
      payload: { fromSite: fromSnapshot.site, toSite, crossSite: isCrossSite },
    })

    return NextResponse.json({
      device: result.updatedDevice,
      locationHistory: result.historyRow,
      meterReadingId: result.meterReadingId,
      reusedAssetSiteCode:
        !!fromSnapshot.assetSiteCode &&
        normalizeAssetSiteCodeForCompare(fromSnapshot.assetSiteCode) ===
          normalizeAssetSiteCodeForCompare(toAssetSiteCode) &&
        isCrossSite === false,
    })
  } catch (err) {
    console.error('POST /api/devices/[id]/transfer-with-meter', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Transfer with meter failed') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
