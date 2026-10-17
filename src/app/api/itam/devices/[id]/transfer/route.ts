import { NextRequest, NextResponse } from 'next/server'
import { db, getBaseClient } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { getNextAssetSiteCode, normalizeAssetSiteCodeForCompare } from '@/lib/asset-site-code'
import { notifyTransfer } from '@/lib/notifications'
import { publishRealtimeEvent } from '@/lib/realtime'
import { getLifecycleReadingType } from '@/lib/lifecycle-reading-type'
import { buildTransferInReading, buildEstimatedClosingReading, normalizeReadingMonth } from '@/lib/meter-logic'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * POST /api/itam/devices/[id]/transfer
 *
 * Body (aligned with Apps Script commit 6e57904 — transfer acknowledge flow):
 *   {
 *     toSite, toBuilding?, toFloor?, toDepartment?, toDepartmentCode?,
 *     toLocation?, toAssetSiteCode?,
 *     toStatus?,                          // optional status change during transfer
 *     meterReadingId?,                    // id of a freshly-created MeterReading
 *     meterSkipAcknowledged?,             // boolean — user ack "มิเตอร์นับต่อเนื่อง"
 *     skipMeterReason?                    // optional free-text note (was required, now optional)
 *   }
 *
 * Permission: DEVICE_TRANSFER
 *
 * Logic:
 *   1. Capture current device state as "from".
 *   2. If device.meterRequired and no meterReadingId and no meterSkipAcknowledged → 400.
 *   3. Derive readingType server-side using getLifecycleReadingType(fromStatus, toStatus).
 *   4. Auto-generate toAssetSiteCode if not provided.
 *   5. Update device + create DeviceTransfer + link the meter event in one transaction.
 *   6. Audit and realtime notifications happen only after the transaction commits.
 *   7. Audit log: TRANSFER.
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
    // FIX-027: build authorization context for site-scoped permission checks.
    const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)

    const { id } = await params
    const body = await req.json()

    const device = await db.device.findFirst({
      where: { OR: [{ id }, { assetCode: id }] },
    })
    if (!device) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 })
    }

    // Site access — must be allowed to act on the source site AND the target site.
    // Use canAtSite so a viewer at this site (no DEVICE_TRANSFER) is denied.
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

    // ── Meter-required enforcement (Apps Script commit 6e57904) ────────────
    // NEW: meterSkipAcknowledged (boolean checkbox) replaces skipMeterReason
    //      as the required field. skipMeterReason is now an OPTIONAL note.
    // The user must EITHER provide a meterReadingId OR check the acknowledge
    // checkbox (confirming "มิเตอร์นับต่อเนื่อง" — meter continues).
    const meterReadingId = body.meterReadingId ? String(body.meterReadingId) : null
    meterReadingIdForRecovery = meterReadingId
    const meterSkipAcknowledged = Boolean(body.meterSkipAcknowledged)
    const skipMeterReason = body.skipMeterReason ? String(body.skipMeterReason).trim() : null
    if (device.meterRequired && !meterReadingId && !meterSkipAcknowledged) {
      return NextResponse.json(
        {
          error: 'ต้องจดมิเตอร์ก่อนย้าย หรือยืนยันว่า "มิเตอร์นับต่อเนื่อง" (ติ๊ก checkbox)',
          code: 'METER_REQUIRED',
        },
        { status: 400 },
      )
    }
    // Q4: acknowledging "meter continues" WITHOUT a real number must still close
    // the month. Previously nothing was written at all, so the device stayed
    // "pending" in that month's list forever. We now carry forward the last
    // known value (or an operator-supplied average) and record the reason.
    //
    // `estimatedMeterBw` is optional: omitting it means "use the last known
    // number". A reason is mandatory in this branch — an unjustified estimate
    // would silently distort the paper bill.
    const estimatedMeterBwRaw = body.estimatedMeterBw
    const estimatedMeterColorRaw = body.estimatedMeterColor
    const estimatedReading =
      device.meterRequired && !meterReadingId && meterSkipAcknowledged
        ? {
            bw:
              estimatedMeterBwRaw === undefined || estimatedMeterBwRaw === null || estimatedMeterBwRaw === ''
                ? (device.lastMeterBw ?? 0)
                : Number(estimatedMeterBwRaw),
            color:
              estimatedMeterColorRaw === undefined || estimatedMeterColorRaw === null || estimatedMeterColorRaw === ''
                ? (device.lastMeterColor ?? 0)
                : Number(estimatedMeterColorRaw),
          }
        : null
    if (estimatedReading && !skipMeterReason) {
      return NextResponse.json(
        {
          error: 'กรณีปิดงวดด้วยค่าประมาณ ต้องระบุเหตุผลที่ไม่ได้อ่านเครื่อง',
          code: 'METER_ESTIMATE_REASON_REQUIRED',
        },
        { status: 400 },
      )
    }

    // ── Optional status change during transfer ─────────────────────────────
    // If toStatus is provided, derive the readingType server-side (defense
    // against client tampering — Apps Script commit 6e57904).
    const toStatus = body.toStatus ? String(body.toStatus).trim() : device.status
    const derivedReadingType = getLifecycleReadingType(device.status, toStatus)

    // If a meterReadingId was passed, verify it belongs to this device.
    //
    // Hoisted out of the guard because the TRANSFER_IN opening row reuses this
    // reading's meter values as its own starting point (see the transaction).
    let closingReading: {
      id: string
      meterBw: number
      meterColor: number
      readingMonth: string | null
    } | null = null
    if (meterReadingId) {
      const reading = await db.meterReading.findUnique({ where: { id: meterReadingId } })
      if (!reading || reading.deviceId !== device.id || reading.assetCode !== device.assetCode) {
        return NextResponse.json(
          { error: 'meterReadingId ไม่ตรงกับอุปกรณ์นี้' },
          { status: 400 },
        )
      }
      closingReading = {
        id: reading.id,
        meterBw: reading.meterBw,
        meterColor: reading.meterColor,
        readingMonth: reading.readingMonth,
      }
    }

    // Resolve the target AssetSiteCode.
    //   • Explicit body value wins.
    //   • Cross-site move with no explicit value → auto-generate (with reuse
    //     from history if the device has lived at this site before).
    //   • Same-site move with no explicit value → KEEP the existing code
    //     (the device didn't actually leave this site, so its per-site
    //     registry number shouldn't change — matches Apps Script behavior).
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

    // Capture "from" state BEFORE the update.
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
    const requestedMoveDate = body.transferDate ?? body.actionDate ?? body.moveDate
    const moveDate = requestedMoveDate != null && String(requestedMoveDate).trim()
      ? String(requestedMoveDate).trim()
      : nowIso
    const movedBy = user.username || user.email

    // ── GAP-H04: Same-location check (legacy: TransferService.gs lines 25-28) ──
    // If target location is identical to current location, reject the transfer
    // to prevent unnecessary history records.
    const targetBuilding = body.toBuilding != null ? String(body.toBuilding).trim() || null : device.building
    const targetFloor = body.toFloor != null ? String(body.toFloor).trim() || null : device.floor
    const targetDept = body.toDepartment != null ? String(body.toDepartment).trim() || null : device.department
    const targetLocation = body.toLocation != null ? String(body.toLocation).trim() || null : device.location
    if (
      !isCrossSite &&
      targetBuilding === device.building &&
      targetFloor === device.floor &&
      targetDept === device.department &&
      targetLocation === device.location &&
      toStatus === device.status
    ) {
      return NextResponse.json(
        { error: 'ตำแหน่งปลายทางตรงกับตำแหน่งปัจจุบัน — ไม่จำเป็นต้องย้าย', code: 'SAME_LOCATION' },
        { status: 400 },
      )
    }

    // Action label mirrors Apps Script:
    //   - TRANSFER (same site, location changed)
    //   - TRANSFER_SITE (cross-site)
    const action = isCrossSite ? 'TRANSFER_SITE' : 'TRANSFER'

    // Build the DeviceTransfer row and wire the meterReading event inside the
    // same transaction so a partial lifecycle update cannot leave an orphaned
    // meter reading or an unlinked transfer history row.
    const logId = `MV-${nowIso.replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.floor(Math.random() * 90000) + 10000}`

    // Single interactive transaction: update device, create history, and link
    // the meter event atomically. The status update happens first, matching the
    // Apps Script lifecycle ordering while guaranteeing all three writes commit
    // or roll back together.
    const [updatedDevice, historyRow] = await getBaseClient().$transaction(async (tx) => {
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
          status: toStatus, // may equal existing status (pure location move)
          updatedBy: movedBy,
          // Keep the cached meter counters in step with the closing reading.
          // The meter screen pre-fills the next reading from these fields, so
          // leaving them at the pre-move value made the operator's next entry
          // compute pages against a stale baseline. Use the number actually
          // recorded for the boundary when there is one, otherwise the value
          // carried in on the request.
          ...(closingReading
            ? { lastMeterBw: closingReading.meterBw, lastMeterColor: closingReading.meterColor }
            : estimatedReading
              ? {
                  lastMeterBw: Math.max(0, Math.floor(estimatedReading.bw)),
                  lastMeterColor: Math.max(0, Math.floor(estimatedReading.color)),
                }
              : {}),
        },
      })

      const historyRow = await tx.deviceTransfer.create({
        data: {
          logId,
          deviceId: device.id,
          assetCode: device.assetCode,
          moveDate,
          transferDate: moveDate,
          action,
          fromStatus: fromSnapshot.status,
          toStatus, // may differ from fromStatus if lifecycle transfer
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

      // Uses the SERVER-DERIVED readingType (not a client-supplied value) so
      // RETURN / SEND_REPAIR / FINAL flows receive the canonical lifecycle type.
      if (meterReadingId) {
        await tx.meterReading.update({
          where: { id: meterReadingId },
          data: {
            eventType: action,
            eventId: historyRow.id,
            readingType: derivedReadingType,
          },
        })
      }

      // ── Estimated closing reading (Q4) ────────────────────────────────
      // The operator acknowledged "meter continues" but could not read the
      // device. Write a carry-forward / estimated closing row at the OLD
      // location so the month is actually closed, then fall through to the
      // same TRANSFER_IN opening logic used for real readings.
      if (estimatedReading && skipMeterReason) {
        const estimatedRow = await tx.meterReading.create({
          data: {
            deviceId: device.id,
            assetCode: device.assetCode,
            ...buildEstimatedClosingReading({
              estimatedBw: estimatedReading.bw,
              estimatedColor: estimatedReading.color,
              lastMeterBw: device.lastMeterBw ?? 0,
              lastMeterColor: device.lastMeterColor ?? 0,
              readingMonth: normalizeReadingMonth(moveDate),
              readingDate: moveDate,
              readingType: derivedReadingType,
              meterMode: device.meterMode ?? null,
              site: device.site ?? null,
              building: device.building ?? null,
              floor: device.floor ?? null,
              department: device.department ?? null,
              departmentCode: device.departmentCode ?? null,
              location: device.location ?? null,
              eventId: historyRow.id,
              eventType: action,
              readBy: movedBy,
              reason: skipMeterReason,
            }),
          } as never,
        })
        // Link the closing row back onto the transfer history. The real-reading
        // path does this implicitly (it already owns the id it passes in); the
        // estimated path creates the row here, so without this the history row
        // kept meterReadingId = null and the audit trail lost the link.
        await tx.deviceTransfer.update({
          where: { id: historyRow.id },
          data: { meterReadingId: estimatedRow.id },
        })
        // Feed the opening row the same numbers.
        closingReading = {
          id: estimatedRow.id,
          meterBw: Math.max(0, Math.floor(estimatedReading.bw)),
          meterColor: Math.max(0, Math.floor(estimatedReading.color)),
          readingMonth: normalizeReadingMonth(moveDate),
        }
      }

      // ── Transfer boundary pair (METER-TRANSFER-BOUNDARY) ──────────────
      // An Active→Active move closes the meter at the OLD site and opens it
      // at the NEW one. Both branches must show the device in their own
      // report, so we write a second row at the destination carrying the SAME
      // meter number with pages forced to 0 (readingType = TRANSFER_IN).
      //
      // Without this row the destination branch has no opening baseline: its
      // next reading would chain off the OLD site's row and silently absorb
      // pages that were consumed at the previous branch.
      //
      // Written AFTER the closing row so findValidPrevReading's
      // `readingDate desc, id desc` ordering selects it as the next prev.
      if (derivedReadingType === 'TRANSFER' && closingReading) {
        await tx.meterReading.create({
          data: {
            deviceId: device.id,
            assetCode: device.assetCode,
            ...buildTransferInReading({
              meterBw: closingReading.meterBw,
              meterColor: closingReading.meterColor,
              meterMode: device.meterMode ?? null,
              readingMonth: closingReading.readingMonth ?? null,
              readingDate: moveDate,
              site: toSite,
              building: toBuilding,
              floor: toFloor,
              department: toDepartment,
              departmentCode: toDepartmentCode,
              location: toLocation,
              eventId: historyRow.id,
              eventType: action,
              readBy: movedBy,
            }),
          } as never,
        })
      }

      return [updatedDevice, historyRow] as const
    })

    // Audit log
    try {
      await db.auditLog.create({
        data: {
          action: 'TRANSFER',
          entity: 'DeviceTransfer',
          entityId: historyRow.id,
          summary: `ย้ายอุปกรณ์ ${device.assetCode} ไป ${toSite}`,
          detail: JSON.stringify({
            assetCode: device.assetCode,
            from: fromSnapshot,
            to: {
              site: toSite,
              assetSiteCode: toAssetSiteCode || null,
              building: toBuilding,
              floor: toFloor,
              department: toDepartment,
              location: toLocation,
              status: toStatus,
            },
            crossSite: isCrossSite,
            meterReadingId,
            meterSkipAcknowledged,
            skipMeterReason: skipMeterReason ? true : false,
            derivedReadingType,
            historyId: historyRow.id,
          }),
          actor: user.email,
          siteCode: toSite,
        },
      })
    } catch (err) { console.error('[route]', err) }

    // Best-effort notification
    void notifyTransfer({
      assetCode: device.assetCode,
      fromSite: fromSnapshot.site,
      toSite,
      by: movedBy,
    })

    // Push SSE event — both source-site and destination-site subscribers see it
    publishRealtimeEvent({
      type: 'device-transferred',
      assetNo: device.assetCode,
      site: toSite,
      payload: {
        fromSite: fromSnapshot.site,
        toSite,
        crossSite: isCrossSite,
      },
    })

    return NextResponse.json({
      device: updatedDevice,
      // The estimated-reading path links meterReadingId onto the history row
      // after it was created, so `historyRow` (the pre-update object) would
      // report null in the response even though the link is in the database.
      // Merge the post-update value back in rather than re-querying.
      locationHistory: estimatedReading
        ? { ...historyRow, meterReadingId: closingReading?.id ?? historyRow.meterReadingId }
        : historyRow,
      reusedAssetSiteCode:
        !!fromSnapshot.assetSiteCode &&
        normalizeAssetSiteCodeForCompare(fromSnapshot.assetSiteCode) ===
          normalizeAssetSiteCodeForCompare(toAssetSiteCode) &&
        isCrossSite === false,
    })
  } catch (err) {
    if (meterReadingIdForRecovery) {
      try {
        await db.meterReading.update({
          where: { id: meterReadingIdForRecovery },
          data: { eventType: 'LIFECYCLE_METER_INCOMPLETE', eventId: null },
        })
      } catch (err) { console.error('[route]', err) }
    }
    console.error('POST /api/itam/devices/[id]/transfer', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Transfer failed') : 'Internal server error'
    return NextResponse.json({ error: message, code: 'TRANSFER_UPDATE_FAILED' }, { status: 500 })
  }
}
