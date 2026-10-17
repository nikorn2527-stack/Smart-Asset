import { NextRequest, NextResponse } from 'next/server'
import { db, getBaseClient } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { logAudit } from '@/lib/audit'
import { publishRealtimeEvent } from '@/lib/realtime'
import { demoTag } from '@/lib/demo-mode'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * POST /api/devices/[id]/replace
 *
 * "เปลี่ยนเครื่องหลัก" — Replace this device with a NEW one (already in DB).
 * Migrate dependent rows (accessories, children, active assignments, active PM
 * schedules, optional licenses) to the new device, and mark this device as
 * "Replaced". Licenses, work orders, and meter history stay on the old device
 * (per the user's decision: "มีเครื่องสำรอง — เก็บ license ไว้กับเครื่องเดิม").
 *
 * Distinct from /replace-on-withdraw:
 *   - /replace-on-withdraw: WITHDRAW the source device AND install a
 *     replacement (existing or new) in ONE atomic action. Used when a printer
 *     breaks and you want to swap it for a spare at the same location. The
 *     replacement device's status is force-set to ACTIVE and moved to the
 *     source's location. Meter is captured as a closing reading on the source.
 *
 *   - /replace (this route): Mark the source device as "Replaced" (a
 *     terminal status) and migrate dependents to a NEW device that is ALREADY
 *     in the DB. The new device's location, status, meter etc. are NOT touched
 *     — only its accessories/children/assignments/PM schedules. Used when a
 *     printer is broken beyond repair and the org buys a brand-new printer
 *     (with its own assetCode and location) — the new printer inherits the
 *     old printer's accessories, child devices (set members), active
 *     assignments, and active PM schedules.
 *
 * Request body:
 *   {
 *     newDeviceId: string,             // cuid of the new device (must exist)
 *     moveAccessories?: boolean,       // default true
 *     moveChildren?: boolean,          // default true (Device Set children)
 *     moveAssignments?: boolean,       // default true (only active assignments)
 *     movePMSchedules?: boolean,       // default true (only active schedules)
 *     moveLicenses?: boolean,          // default false (licenses stay on old device)
 *     reason?: string                  // free-text reason for the replacement
 *   }
 *
 * Response:
 *   {
 *     data: {
 *       oldDeviceId: string,
 *       newDeviceId: string,
 *       movedCounts: {
 *         accessories: number,
 *         children: number,
 *         assignments: number,
 *         pmSchedules: number,
 *         licenses: number
 *       }
 *     }
 *   }
 *
 * Auth: requires DEVICE_TRANSFER permission (same as lifecycle/transfer
 * actions — replacing a device is a high-impact operation).
 *
 * Guards:
 *   - old and new must be different devices
 *   - both must have the same isDemo flag (no demo cross-contamination)
 *   - old device must not already be in "Replaced" status (no double-replace)
 *   - user must have site access to BOTH devices' sites
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'DEVICE_TRANSFER')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const user = auth.row
  // SPRINT-5-MUTATION-CTX-MIGRATION: use ctx.canAtSite for site-scoped perm checks.
  const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)
  const movedBy = user.username || user.email

  try {
    const { id: oldDeviceId } = await params
    const body = (await req.json()) as Record<string, unknown>
    const newDeviceId = String(body.newDeviceId ?? '').trim()
    if (!newDeviceId) {
      return NextResponse.json(
        { error: 'กรุณาระบุ newDeviceId', code: 'MISSING_NEW_DEVICE_ID' },
        { status: 400 },
      )
    }
    if (newDeviceId === oldDeviceId) {
      return NextResponse.json(
        { error: 'เครื่องใหม่ต้องไม่ใช่เครื่องเดียวกับเครื่องเดิม', code: 'SELF_REPLACE' },
        { status: 400 },
      )
    }

    const moveAccessories = body.moveAccessories !== false // default true
    const moveChildren = body.moveChildren !== false // default true
    const moveAssignments = body.moveAssignments !== false // default true
    const movePMSchedules = body.movePMSchedules !== false // default true
    // Per user's decision: licenses stay with old device (default false).
    // The user can opt-in to moving them by setting moveLicenses: true.
    const moveLicenses = body.moveLicenses === true
    const reason = body.reason ? String(body.reason).trim() : null

    // ── Load both devices ──
    const oldDevice = await db.device.findUnique({ where: { id: oldDeviceId } })
    if (!oldDevice) {
      return NextResponse.json(
        { error: 'ไม่พบอุปกรณ์เดิม', code: 'OLD_DEVICE_NOT_FOUND' },
        { status: 404 },
      )
    }
    const newDevice = await db.device.findUnique({ where: { id: newDeviceId } })
    if (!newDevice) {
      return NextResponse.json(
        { error: 'ไม่พบอุปกรณ์ใหม่ที่ระบุ', code: 'NEW_DEVICE_NOT_FOUND' },
        { status: 404 },
      )
    }

    // ── Site access check ──
    if (!ctx.canAtSite(oldDevice.site, 'DEVICE_TRANSFER')) {
      return NextResponse.json(
        { error: 'ไม่มีสิทธิ์จัดการอุปกรณ์เดิมในสาขานี้', code: 'NO_OLD_SITE_ACCESS' },
        { status: 403 },
      )
    }
    if (!ctx.canAtSite(newDevice.site, 'DEVICE_TRANSFER')) {
      return NextResponse.json(
        { error: 'ไม่มีสิทธิ์จัดการอุปกรณ์ใหม่ในสาขานี้', code: 'NO_NEW_SITE_ACCESS' },
        { status: 403 },
      )
    }

    // ── Demo cross-contamination guard ──
    // Demo and non-demo devices must never be linked via replacement. This
    // prevents a demo device from "owning" production assignments or vice
    // versa, which would make demo cleanup unsafe.
    if (oldDevice.isDemo !== newDevice.isDemo) {
      return NextResponse.json(
        {
          error:
            'อุปกรณ์เดิมและอุปกรณ์ใหม่มีสถานะ demo ต่างกัน — ไม่สามารถเปลี่ยนทดแทนกันได้',
          code: 'DEMO_MISMATCH',
        },
        { status: 400 },
      )
    }

    // ── Idempotency guard: don't replace an already-replaced device ──
    if (oldDevice.status === 'Replaced') {
      return NextResponse.json(
        {
          error: 'อุปกรณ์เดิมถูกเปลี่ยนทดแทนไปแล้ว — ไม่สามารถเปลี่ยนซ้ำได้',
          code: 'ALREADY_REPLACED',
        },
        { status: 409 },
      )
    }

    // ── Atomic transaction ──
    // Increase timeout to 30s (default 5s is too short for the multiple
    // updateMany calls inside the transaction; matches /replace-on-withdraw).
    const result = await getBaseClient().$transaction(
      async (tx) => {
        // ── 1) Update old device: status → "Replaced", replacedById → new, replacedAt → now ──
        // We use "Replaced" (capitalized) for consistency with other Device
        // statuses ("Active", "In Repair", "Disposed", etc.).
        const updatedOld = await tx.device.update({
          where: { id: oldDeviceId },
          data: {
            status: 'Replaced',
            replacedById: newDeviceId,
            replacedAt: new Date(),
            uninstallDate: oldDevice.uninstallDate ?? new Date().toISOString().slice(0, 10),
            updatedBy: movedBy,
          },
        })

        // ── 2) Move accessories ──
        // DeviceAccessory has a real FK (parentDeviceId) to Device with
        // onDelete: Cascade — so simply re-pointing parentDeviceId moves
        // them intact. They continue to live on the new device afterwards.
        let accessoriesMoved = 0
        if (moveAccessories) {
          const accResult = await tx.deviceAccessory.updateMany({
            where: { parentDeviceId: oldDeviceId },
            data: { parentDeviceId: newDeviceId },
          })
          accessoriesMoved = accResult.count
        }

        // ── 3) Move Device Set children ──
        // Children's parentDeviceId is a self-FK with onDelete: SetNull.
        // Re-pointing them to the new device preserves the "set" relationship.
        let childrenMoved = 0
        if (moveChildren) {
          const childResult = await tx.device.updateMany({
            where: { parentDeviceId: oldDeviceId },
            data: { parentDeviceId: newDeviceId },
          })
          childrenMoved = childResult.count
        }

        // ── 4) Move active assignments ──
        // Only ACTIVE assignments are moved; returned/expired ones stay on
        // the old device for history. Assignment.isDemo is preserved so demo
        // data cleanup stays consistent.
        let assignmentsMoved = 0
        if (moveAssignments) {
          const assignResult = await tx.assignment.updateMany({
            where: { deviceId: oldDeviceId, status: 'active' },
            data: { deviceId: newDeviceId, ...demoTag(user) },
          })
          assignmentsMoved = assignResult.count
        }

        // ── 5) Move active PM schedules ──
        // PMSchedule has `active: Boolean` (not `status`). Move only schedules
        // where active = true; inactive/deleted ones stay on the old device.
        let pmSchedulesMoved = 0
        if (movePMSchedules) {
          const pmResult = await tx.pMSchedule.updateMany({
            where: { deviceId: oldDeviceId, active: true },
            data: { deviceId: newDeviceId },
          })
          pmSchedulesMoved = pmResult.count
        }

        // ── 6) Licenses ──
        // Two policies based on `moveLicenses`:
        //   - true:  move all license records (deviceId) to the new device,
        //            keeping isActive=true.
        //   - false (default): keep licenses on the OLD device BUT mark them
        //            isActive=false so they don't show up in active inventory
        //            reports — the new device has no licenses until the user
        //            explicitly assigns new ones (per user's decision:
        //            "มีเครื่องสำรอง — ไม่ต้องย้าย license").
        let licensesMoved = 0
        if (moveLicenses) {
          const licResult = await tx.licenseRecord.updateMany({
            where: { deviceId: oldDeviceId },
            data: { deviceId: newDeviceId },
          })
          licensesMoved = licResult.count
        } else {
          // Deactivate licenses on the old device (keep history, hide from
          // active inventory). Don't touch the deviceId FK — preserves audit
          // trail of "this license was issued for this device".
          await tx.licenseRecord.updateMany({
            where: { deviceId: oldDeviceId, isActive: true },
            data: { isActive: false },
          })
        }

        return {
          oldDevice: updatedOld,
          movedCounts: {
            accessories: accessoriesMoved,
            children: childrenMoved,
            assignments: assignmentsMoved,
            pmSchedules: pmSchedulesMoved,
            licenses: licensesMoved,
          },
        }
      },
      { timeout: 30_000, maxWait: 35_000 },
    )

    // ── Audit log ──
    try {
      await logAudit(
        'REPLACE',
        'Device',
        oldDeviceId,
        `เปลี่ยนเครื่องหลัก: ${oldDevice.assetCode} → ${newDevice.assetCode}`,
        {
          action: 'device_replace',
          oldDeviceId,
          oldAssetCode: oldDevice.assetCode,
          newDeviceId,
          newAssetCode: newDevice.assetCode,
          moved: result.movedCounts,
          moveFlags: {
            moveAccessories,
            moveChildren,
            moveAssignments,
            movePMSchedules,
            moveLicenses,
          },
          reason,
        },
        movedBy,
        null,
      )
    } catch (err) {
      console.error('[replace/audit]', err)
    }

    // ── Realtime: notify subscribers that the old device is replaced ──
    publishRealtimeEvent({
      type: 'device-transferred',
      assetNo: oldDevice.assetCode,
      site: oldDevice.site,
      payload: {
        action: 'device_replaced',
        newDeviceId,
        newAssetCode: newDevice.assetCode,
        moved: result.movedCounts,
      },
    })
    publishRealtimeEvent({
      type: 'device-transferred',
      assetNo: newDevice.assetCode,
      site: newDevice.site,
      payload: {
        action: 'device_replacement_target',
        oldDeviceId,
        oldAssetCode: oldDevice.assetCode,
        moved: result.movedCounts,
      },
    })

    return NextResponse.json({
      data: {
        oldDeviceId,
        newDeviceId,
        movedCounts: result.movedCounts,
      },
    })
  } catch (err) {
    console.error('POST /api/devices/[id]/replace', err)
    const message =
      process.env.NODE_ENV === 'development'
        ? err instanceof Error
          ? err.message
          : 'Replace failed'
        : 'Internal server error'
    return NextResponse.json(
      { error: message, code: 'REPLACE_FAILED' },
      { status: 500 },
    )
  }
}
