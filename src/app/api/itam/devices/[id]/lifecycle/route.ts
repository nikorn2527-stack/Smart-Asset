import { NextRequest, NextResponse } from 'next/server'
import { db, getBaseClient } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { getNextAssetSiteCode, normalizeAssetSiteCodeForCompare } from '@/lib/asset-site-code'
import { logAudit } from '@/lib/audit'
import { notifyTransfer } from '@/lib/notifications'
import { publishRealtimeEvent } from '@/lib/realtime'
import { getLifecycleReadingType } from '@/lib/lifecycle-reading-type'
import { moduleUnavailableResponse } from '@/lib/module-gate'

const METERED_LIFECYCLE_ACTIONS = new Set([
  'send_repair',
  'receive_repair',
  'uninstall',
  'dispose',
  'reinstall',
  'return_device',
])

function asOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const normalized = String(value).trim()
  return normalized || null
}

function requiresLifecycleMeter(action: string, toStatus: string): boolean {
  if (METERED_LIFECYCLE_ACTIONS.has(action)) return true
  return ['IN REPAIR', 'INACTIVE', 'DISPOSED', 'RETIRED', 'RETURNED'].includes(
    toStatus.toUpperCase(),
  )
}

function lifecycleLocationChanged(
  device: {
    site: string
    building: string | null
    floor: string | null
    department: string | null
    departmentCode: string | null
    location: string | null
    assetSiteCode: string | null
  },
  next: {
    site: string
    building: string | null
    floor: string | null
    department: string | null
    departmentCode: string | null
    location: string | null
    assetSiteCode: string | null
  },
): boolean {
  return device.site !== next.site
    || device.building !== next.building
    || device.floor !== next.floor
    || device.department !== next.department
    || device.departmentCode !== next.departmentCode
    || device.location !== next.location
    || normalizeAssetSiteCodeForCompare(device.assetSiteCode) !== normalizeAssetSiteCodeForCompare(next.assetSiteCode)
}

/**
 * POST /api/itam/devices/[id]/lifecycle
 *
 * Source-only canonical status/lifecycle path. The caller may pre-write a meter
 * reading through the compatibility meter API; this endpoint then atomically
 * updates the device, creates DeviceTransfer history, and links that reading.
 * The pre-write itself is intentionally documented as a separate boundary until
 * meter preparation and persistence are extracted into one shared transaction.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  let meterReadingIdForRecovery: string | null = null
  try {
    const auth = await requireAuth(req, 'DEVICE_TRANSFER')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row
    // SPRINT-5-MUTATION-CTX-MIGRATION: use ctx.canAtSite for site-scoped perm checks.
    const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)
    const { id } = await params
    const body = await req.json() as Record<string, unknown>

    const device = await db.device.findFirst({
      where: { OR: [{ id }, { assetCode: id }] },
    })
    if (!device) return NextResponse.json({ error: 'Device not found' }, { status: 404 })
    if (!ctx.canAtSite(device.site, 'DEVICE_TRANSFER')) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์เปลี่ยนสถานะอุปกรณ์ในสาขานี้' }, { status: 403 })
    }

    const action = String(body.action ?? '').trim().toLowerCase()
    const toStatus = asOptionalString(body.toStatus ?? body.status)
    if (!toStatus) {
      return NextResponse.json({ error: 'กรุณาระบุสถานะปลายทาง (toStatus)' }, { status: 400 })
    }

    const toSite = asOptionalString(body.toSite) ?? device.site
    if (!ctx.canAtSite(toSite, 'DEVICE_TRANSFER')) {
      return NextResponse.json({ error: `ไม่มีสิทธิ์เปลี่ยนสถานะไปยังสาขา: ${toSite}` }, { status: 403 })
    }

    const meterReadingId = asOptionalString(body.meterReadingId)
    meterReadingIdForRecovery = meterReadingId
    const meterSkipAcknowledged = body.meterSkipAcknowledged === true
    const skipMeterReason = asOptionalString(body.skipMeterReason)
    const meterRequired = device.meterRequired && requiresLifecycleMeter(action, toStatus)
    if (meterRequired && !meterReadingId && !meterSkipAcknowledged) {
      return NextResponse.json(
        {
          error: 'ต้องจดมิเตอร์ก่อนเปลี่ยนสถานะ หรือยืนยันว่า "มิเตอร์นับต่อเนื่อง"',
          code: 'METER_REQUIRED',
        },
        { status: 400 },
      )
    }

    if (meterReadingId) {
      const reading = await db.meterReading.findUnique({
        where: { id: meterReadingId },
        select: { id: true, deviceId: true, assetCode: true },
      })
      if (!reading || reading.deviceId !== device.id || reading.assetCode !== device.assetCode) {
        return NextResponse.json(
          { error: 'meterReadingId ไม่ตรงกับอุปกรณ์นี้', code: 'METER_DEVICE_MISMATCH' },
          { status: 400 },
        )
      }
    }

    const toBuilding = body.toBuilding !== undefined ? asOptionalString(body.toBuilding) : device.building
    const toFloor = body.toFloor !== undefined ? asOptionalString(body.toFloor) : device.floor
    const toDepartment = body.toDepartment !== undefined
      ? asOptionalString(body.toDepartment)
      : body.toDept !== undefined
        ? asOptionalString(body.toDept)
        : device.department
    const toDepartmentCode = body.toDepartmentCode !== undefined
      ? asOptionalString(body.toDepartmentCode)
      : body.toDeptCode !== undefined
        ? asOptionalString(body.toDeptCode)
        : device.departmentCode
    const toLocation = body.toLocation !== undefined ? asOptionalString(body.toLocation) : device.location

    const isCrossSite = device.site !== toSite
    let toAssetSiteCode = asOptionalString(body.toAssetSiteCode)
    if (!toAssetSiteCode) {
      if (isCrossSite) {
        toAssetSiteCode = await getNextAssetSiteCode(toSite, { assetNo: device.assetCode })
          ?? device.assetSiteCode
          ?? null
      } else {
        toAssetSiteCode = device.assetSiteCode
      }
    }

    const actionDate = asOptionalString(body.actionDate ?? body.transferDate ?? body.moveDate)
      ?? new Date().toISOString().slice(0, 10)
    const movedBy = user.username || user.email
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
    const nextLocation = {
      site: toSite,
      assetSiteCode: toAssetSiteCode,
      building: toBuilding,
      floor: toFloor,
      department: toDepartment,
      departmentCode: toDepartmentCode,
      location: toLocation,
    }
    const locationChanged = lifecycleLocationChanged(device, nextLocation)
    const historyAction = locationChanged ? 'STATUS_AND_TRANSFER' : 'STATUS_CHANGE'
    const logId = `LC-${actionDate.replace(/[^0-9]/g, '').slice(0, 8)}-${Math.floor(Math.random() * 90000) + 10000}`
    const derivedReadingType = getLifecycleReadingType(device.status, toStatus)
    const reason = asOptionalString(body.reason ?? body.remark)

    const [updatedDevice, historyRow] = await getBaseClient().$transaction(async (tx) => {
      const updatedDevice = await tx.device.update({
        where: { id: device.id },
        data: {
          status: toStatus,
          site: toSite,
          assetSiteCode: toAssetSiteCode,
          building: toBuilding,
          floor: toFloor,
          department: toDepartment,
          departmentCode: toDepartmentCode,
          location: toLocation,
          uninstallDate: ['RETIRED', 'RETURNED', 'INACTIVE', 'DISPOSED'].includes(toStatus.toUpperCase())
            ? actionDate
            : device.uninstallDate,
          updatedBy: movedBy,
        },
      })

      const historyRow = await tx.deviceTransfer.create({
        data: {
          logId,
          deviceId: device.id,
          assetCode: device.assetCode,
          moveDate: actionDate,
          transferDate: actionDate,
          action: historyAction,
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
          toAssetSiteCode,
          toBuilding,
          toFloor,
          toDepartment,
          toDepartmentCode,
          toLocation,
          meterReadingId,
          movedBy,
          remark: [action || null, reason, skipMeterReason].filter(Boolean).join(' — ') || null,
          reason,
        },
      })

      if (meterReadingId) {
        // ── BUG-METER-003 FIX (Task 12) ──
        // When a lifecycle action links a MeterReading, also sync
        // Device.lastMeterBw/lastMeterColor from that reading. Without
        // this, the column stays stale (or 0) → next transfer-with-meter
        // computes pages = full reading → cumulative doubling.
        const linkedReading = await tx.meterReading.findUnique({
          where: { id: meterReadingId },
          select: { meterBw: true, meterColor: true },
        })
        if (linkedReading) {
          await tx.meterReading.update({
            where: { id: meterReadingId },
            data: {
              eventType: historyAction,
              eventId: historyRow.id,
              readingType: derivedReadingType,
            },
          })
          await tx.device.update({
            where: { id: device.id },
            data: {
              lastMeterBw: linkedReading.meterBw,
              lastMeterColor: linkedReading.meterColor,
              updatedBy: movedBy,
            },
          })
        }
      }

      return [updatedDevice, historyRow] as const
    })

    try {
      await logAudit(
        'LIFECYCLE',
        'DeviceTransfer',
        historyRow.id,
        `เปลี่ยนสถานะอุปกรณ์ ${device.assetCode}: ${device.status} → ${toStatus}`,
        {
          assetCode: device.assetCode,
          action,
          from: fromSnapshot,
          to: nextLocation,
          toStatus,
          meterReadingId,
          meterSkipAcknowledged,
          derivedReadingType,
          historyId: historyRow.id,
        },
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
      payload: {
        action,
        fromStatus: fromSnapshot.status,
        toStatus,
        historyId: historyRow.id,
        meterReadingId,
      },
    })

    return NextResponse.json(
      {
        device: updatedDevice,
        locationHistory: historyRow,
        lifecycle: historyRow,
        transfer: historyRow,
        readingType: derivedReadingType,
        meterReadingId,
        reusedAssetSiteCode:
          !!fromSnapshot.assetSiteCode
          && normalizeAssetSiteCodeForCompare(fromSnapshot.assetSiteCode) === normalizeAssetSiteCodeForCompare(toAssetSiteCode)
          && !isCrossSite,
      },
      { status: 201 },
    )
  } catch (err) {
    if (meterReadingIdForRecovery) {
      try {
        await db.meterReading.update({
          where: { id: meterReadingIdForRecovery },
          data: {
            eventType: 'LIFECYCLE_METER_INCOMPLETE',
            eventId: null,
          },
        })
      } catch (err) { console.error('[route]', err) }
    }
    console.error('POST /api/itam/devices/[id]/lifecycle', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Lifecycle update failed') : 'Internal server error'
    return NextResponse.json({ error: message, code: 'LIFECYCLE_UPDATE_FAILED' }, { status: 500 })
  }
}
