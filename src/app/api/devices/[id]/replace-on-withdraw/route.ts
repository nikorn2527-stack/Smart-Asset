import { NextRequest, NextResponse } from 'next/server'
import { db, getBaseClient } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { getNextAssetSiteCode } from '@/lib/asset-site-code'
import { logAudit } from '@/lib/audit'
import { publishRealtimeEvent } from '@/lib/realtime'
import { getLifecycleReadingType } from '@/lib/lifecycle-reading-type'
import { demoTag } from '@/lib/demo-mode'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * POST /api/devices/[id]/replace-on-withdraw
 *
 * Withdraw the source device (status: INACTIVE / IN_REPAIR / DISPOSED / RETURNED)
 * AND install a replacement device at the same location, in ONE atomic transaction.
 *
 * Why this exists:
 *   Without this, replacing a broken printer requires 2 separate operations:
 *     1. Withdraw the old device (set status = IN_REPAIR)
 *     2. Open Add Device, fill the form, save, then manually install at the same location
 *   This route collapses both steps into one. The user scans or types the
 *   replacement's asset code; if it exists in DB we change its status + move it
 *   to the source's location; if it doesn't exist we auto-create it with minimal
 *   defaults and the user can edit details later.
 *
 * Request body:
 *   {
 *     action: 'send_repair' | 'uninstall' | 'dispose' | 'return_device',
 *     toStatus: 'INACTIVE' | 'IN REPAIR' | 'DISPOSED' | 'RETURNED',
 *     reason?: string,
 *     actionDate?: 'YYYY-MM-DD',
 *
 *     // ── Replacement configuration ──
 *     replacement: {
 *       mode: 'existing' | 'new',
 *       // 'existing' = scan/find an already-registered device by assetCode/serialNumber
 *       // 'new'      = create a brand new device record with this assetCode
 *       assetCode: string,            // required for both modes
 *       serialNumber?: string,        // optional, for 'new' mode
 *       name?: string,                // optional, defaults to "อุปกรณ์ทดแทน {source.assetCode}"
 *       brand?: string,               // optional, defaults to source's brand
 *       model?: string,               // optional, defaults to source's model
 *       type?: string,                // optional, defaults to source's type
 *     }
 *   }
 *
 * Response:
 *   {
 *     sourceDevice: Device,            // updated (withdrawn)
 *     replacementDevice: Device,      // installed at source's location
 *     sourceTransfer: DeviceTransfer, // history row for the withdrawal
 *     replacementTransfer: DeviceTransfer, // history row for the install
 *     created: boolean,               // true if replacement was auto-created
 *   }
 */
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

    const body = (await req.json()) as Record<string, unknown>
    const action = String(body.action ?? '').trim().toLowerCase()
    const toStatus = String(body.toStatus ?? '').trim()
    if (!toStatus) {
      return NextResponse.json({ error: 'กรุณาระบุสถานะปลายทาง (toStatus)' }, { status: 400 })
    }

    const replacementBody = body.replacement as Record<string, unknown> | undefined
    if (!replacementBody) {
      return NextResponse.json({ error: 'กรุณาระบุข้อมูลเครื่องทดแทน (replacement)' }, { status: 400 })
    }
    const mode = String(replacementBody.mode ?? 'existing').trim().toLowerCase()
    if (mode !== 'existing' && mode !== 'new') {
      return NextResponse.json({ error: 'replacement.mode ต้องเป็น existing หรือ new' }, { status: 400 })
    }
    const replacementAssetCode = String(replacementBody.assetCode ?? '').trim()
    if (!replacementAssetCode) {
      return NextResponse.json({ error: 'กรุณาระบุรหัสเครื่องทดแทน (replacement.assetCode)' }, { status: 400 })
    }

    // ── Load source device ──
    const source = await db.device.findFirst({
      where: { OR: [{ id }, { assetCode: id }] },
    })
    if (!source) {
      return NextResponse.json({ error: 'ไม่พบอุปกรณ์ต้นทาง' }, { status: 404 })
    }
    if (!ctx.canAtSite(source.site, 'DEVICE_TRANSFER')) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์จัดการอุปกรณ์ในสาขานี้' }, { status: 403 })
    }

    // ── Disallow self-replacement ──
    if (replacementAssetCode === source.assetCode) {
      return NextResponse.json(
        { error: 'เครื่องทดแทนต้องไม่ใช่เครื่องเดียวกับเครื่องที่ถอน' },
        { status: 400 },
      )
    }

    // ── P0-2 FIX (LIFECYCLE-METER): closing meter gate for the SOURCE device ──
    // Previously this route never enforced meter capture on the source device
    // during withdraw + replace — leaving the source's meter history without
    // a FINAL/SEND_REPAIR/CHECKOUT anchor. Now we mirror the gate used by the
    // canonical lifecycle route: if source.meterRequired && no closing meter
    // provided && user did NOT acknowledge "meter is continuous", reject 400.
    const sourceMeterBw =
      body.sourceMeterBw != null ? Number(body.sourceMeterBw) : null
    const sourceMeterColor =
      body.sourceMeterColor != null ? Number(body.sourceMeterColor) : null
    const meterSkipAcknowledged = Boolean(body.meterSkipAcknowledged)
    const skipMeterReason = body.skipMeterReason
      ? String(body.skipMeterReason).trim()
      : null

    if (source.meterRequired && sourceMeterBw === null && !meterSkipAcknowledged) {
      return NextResponse.json(
        {
          error:
            'ต้องจดมิเตอร์ปิดของเครื่องเดิมก่อนถอน หรือยืนยันว่า "มิเตอร์นับต่อเนื่อง" (ใช้สำหรับเครื่องทดแทน)',
          code: 'METER_REQUIRED',
        },
        { status: 400 },
      )
    }

    // ── Check replacement existence (for 'existing' mode, must exist;
    //     for 'new' mode, must NOT exist) ──
    const existingReplacement = await db.device.findFirst({
      where: {
        OR: [
          { assetCode: replacementAssetCode },
          ...(replacementBody.serialNumber
            ? [{ serialNumber: String(replacementBody.serialNumber).trim() }]
            : []),
        ],
      },
    })

    if (mode === 'existing' && !existingReplacement) {
      return NextResponse.json(
        {
          error: `ไม่พบเครื่องทดแทนที่มีรหัส "${replacementAssetCode}" ในระบบ — หากต้องการสร้างใหม่ ให้เลือกโหมด "new"`,
          code: 'REPLACEMENT_NOT_FOUND',
        },
        { status: 404 },
      )
    }
    if (mode === 'new' && existingReplacement) {
      return NextResponse.json(
        {
          error: `รหัส "${replacementAssetCode}" มีอยู่ในระบบแล้ว — หากต้องการใช้เครื่องนี้ ให้เลือกโหมด "existing"`,
          code: 'REPLACEMENT_ALREADY_EXISTS',
          existingDeviceId: existingReplacement.id,
        },
        { status: 409 },
      )
    }

    // ── Snapshot source location (to install replacement at the same spot) ──
    const installLocation = {
      site: source.site,
      assetSiteCode: source.assetSiteCode,
      building: source.building,
      floor: source.floor,
      department: source.department,
      departmentCode: source.departmentCode,
      location: source.location,
    }

    const actionDate = String(body.actionDate ?? new Date().toISOString().slice(0, 10))
    const movedBy = user.username || user.email
    const reason = String(body.reason ?? '').trim() || null
    const replacementReason = `เครื่องทดแทนสำหรับ ${source.assetCode}`

    // P0-3 fix: compute assetSiteCode BEFORE the transaction (the function
    // uses `db` not `tx`, causing a separate round-trip that blows the
    // transaction timeout on Supabase pooler)
    const precomputedAssetSiteCode =
      (await getNextAssetSiteCode(installLocation.site, {
        assetNo: replacementAssetCode,
      })) ?? installLocation.assetSiteCode ?? null

    // ── Atomic transaction: withdraw source + find-or-create replacement + install replacement ──
    // P0-3 fix: increase transaction timeout to 30s (default 5s is too short
    // for Supabase pooler + multiple queries inside the transaction)
    const result = await getBaseClient().$transaction(async (tx) => {
      // 1) P0-2 FIX: Create the closing MeterReading for the SOURCE device
      //    (if a meter value was provided). The reading is stamped with the
      //    derived readingType (FINAL / SEND_REPAIR / CHECKOUT) so the meter
      //    history has a proper anchor at the moment of withdrawal. Previously
      //    this row was never created — the source device's meter chain lost
      //    its closing anchor when replaced.
      let sourceMeterReadingId: string | null = null
      if (sourceMeterBw !== null || sourceMeterColor !== null) {
        const bw = sourceMeterBw ?? 0
        const color = sourceMeterColor ?? 0
        const prevBw = source.lastMeterBw ?? 0
        const prevColor = source.lastMeterColor ?? 0
        const pagesBw = Math.max(0, bw - prevBw)
        const pagesColor = Math.max(0, color - prevColor)
        const derivedReadingType = getLifecycleReadingType(source.status, toStatus)

        const sourceReading = await tx.meterReading.create({
          data: {
            deviceId: source.id,
            assetCode: source.assetCode,
            readingDate: actionDate,
            readingMonth: actionDate.slice(0, 7),
            meterBw: bw,
            meterColor: color,
            pagesBw,
            pagesColor,
            prevMeterBw: prevBw,
            prevMeterColor: prevColor,
            meterMode: source.meterMode ?? null,
            prevMeterMode: source.meterMode ?? null,
            readingType: derivedReadingType,
            readBy: movedBy,
            remark: skipMeterReason || [action, 'REPLACE-WITHDRAWAL'].filter(Boolean).join(' — ') || null,
            siteAtReading: source.site ?? null,
            ...demoTag(user),
          },
        })
        sourceMeterReadingId = sourceReading.id

        // Sync the source device's lastMeter so the next reader sees the
        // updated value (consistent with transfer-with-meter route behavior).
        await tx.device.update({
          where: { id: source.id },
          data: { lastMeterBw: bw, lastMeterColor: color },
        })
      }

      // 2) Withdraw source device
      const updatedSource = await tx.device.update({
        where: { id: source.id },
        data: {
          status: toStatus,
          uninstallDate: ['INACTIVE', 'IN REPAIR', 'DISPOSED', 'RETURNED', 'RETIRED'].includes(
            toStatus.toUpperCase(),
          )
            ? actionDate
            : source.uninstallDate,
          updatedBy: movedBy,
        },
      })

      const sourceLogId = `RW-${actionDate.replace(/[^0-9]/g, '').slice(0, 8)}-${Math.floor(Math.random() * 90000) + 10000}`
      const sourceTransfer = await tx.deviceTransfer.create({
        data: {
          logId: sourceLogId,
          deviceId: source.id,
          assetCode: source.assetCode,
          moveDate: actionDate,
          transferDate: actionDate,
          action: 'STATUS_CHANGE',
          fromStatus: source.status,
          toStatus,
          fromSite: source.site,
          fromAssetSiteCode: source.assetSiteCode,
          fromBuilding: source.building,
          fromFloor: source.floor,
          fromDepartment: source.department,
          fromDepartmentCode: source.departmentCode,
          fromLocation: source.location,
          toSite: source.site,
          toAssetSiteCode: source.assetSiteCode,
          toBuilding: source.building,
          toFloor: source.floor,
          toDepartment: source.department,
          toDepartmentCode: source.departmentCode,
          toLocation: source.location,
          movedBy,
          remark: [action || null, reason, 'REPLACE-WITHDRAWAL'].filter(Boolean).join(' — '),
          reason,
          meterReadingId: sourceMeterReadingId,
        },
      })

      // Link meter reading back to the transfer (consistent with transfer-with-meter)
      if (sourceMeterReadingId) {
        await tx.meterReading.update({
          where: { id: sourceMeterReadingId },
          data: { eventType: 'REPLACE_WITHDRAW', eventId: sourceTransfer.id },
        })
      }

      // 2) Find-or-create replacement device
      let replacement = existingReplacement
      let created = false
      if (!replacement) {
        // P0-3 fix: use precomputed value (not calling getNextAssetSiteCode inside tx)
        const newAssetSiteCode = precomputedAssetSiteCode

        const replacementName = String(replacementBody.name ?? '').trim()
          || `อุปกรณ์ทดแทน ${source.assetCode}`

        replacement = await tx.device.create({
          data: {
            assetCode: replacementAssetCode,
            assetSiteCode: newAssetSiteCode,
            name: replacementName,
            type: String(replacementBody.type ?? source.type ?? 'OTHER'),
            brand: String(replacementBody.brand ?? source.brand ?? 'ไม่ระบุ'),
            model: String(replacementBody.model ?? source.model ?? 'ไม่ระบุ'),
            serialNumber: replacementBody.serialNumber
              ? String(replacementBody.serialNumber).trim()
              : null,
            status: 'ACTIVE',
            site: installLocation.site,
            building: installLocation.building,
            floor: installLocation.floor,
            department: installLocation.department,
            departmentCode: installLocation.departmentCode,
            location: installLocation.location,
            warrantyMonths: source.warrantyMonths ?? 12,
            meterRequired: source.meterRequired ?? false,
            meterMode: source.meterMode ?? 'TOTAL',
            deviceGroup: source.deviceGroup ?? 'COMPANY',
            purchaseDate: actionDate,
            updatedBy: movedBy,
            isDemo: source.isDemo ?? false,
          },
        })
        created = true
      }

      // 3) Install replacement at the source's location + set status = ACTIVE
      // P0-3 fix: use precomputed value (not calling getNextAssetSiteCode inside tx)
      const replacementAssetSiteCode =
        replacement.assetSiteCode ?? precomputedAssetSiteCode ?? installLocation.assetSiteCode

      const updatedReplacement = await tx.device.update({
        where: { id: replacement.id },
        data: {
          status: 'ACTIVE',
          site: installLocation.site,
          assetSiteCode: replacementAssetSiteCode,
          building: installLocation.building,
          floor: installLocation.floor,
          department: installLocation.department,
          departmentCode: installLocation.departmentCode,
          location: installLocation.location,
          updatedBy: movedBy,
        },
      })

      const replacementLogId = `RI-${actionDate.replace(/[^0-9]/g, '').slice(0, 8)}-${Math.floor(Math.random() * 90000) + 10000}`
      const replacementTransfer = await tx.deviceTransfer.create({
        data: {
          logId: replacementLogId,
          deviceId: replacement.id,
          assetCode: replacement.assetCode,
          moveDate: actionDate,
          transferDate: actionDate,
          action: 'TRANSFER_BY_LIFECYCLE',
          fromStatus: replacement.status,
          toStatus: 'ACTIVE',
          fromSite: replacement.site,
          fromAssetSiteCode: replacement.assetSiteCode,
          fromBuilding: replacement.building,
          fromFloor: replacement.floor,
          fromDepartment: replacement.department,
          fromDepartmentCode: replacement.departmentCode,
          fromLocation: replacement.location,
          toSite: installLocation.site,
          toAssetSiteCode: replacementAssetSiteCode,
          toBuilding: installLocation.building,
          toFloor: installLocation.floor,
          toDepartment: installLocation.department,
          toDepartmentCode: installLocation.departmentCode,
          toLocation: installLocation.location,
          movedBy,
          remark: [replacementReason, `แทนที่ ${source.assetCode}`].join(' — '),
          reason: replacementReason,
        },
      })

      return {
        sourceDevice: updatedSource,
        replacementDevice: updatedReplacement,
        sourceTransfer,
        replacementTransfer,
        created,
        sourceMeterReadingId,
      }
    }, { timeout: 30_000, maxWait: 35_000 })

    // ── Audit + realtime (after commit) ──
    try {
      await logAudit(
        'LIFECYCLE',
        'Device',
        source.id,
        `ถอนเครื่อง ${source.assetCode} → ${toStatus} พร้อมติดตั้งเครื่องทดแทน ${replacementAssetCode}`,
        {
          action,
          sourceAssetCode: source.assetCode,
          toStatus,
          replacementAssetCode,
          replacementMode: mode,
          created: result.created,
          sourceTransferId: result.sourceTransfer.id,
          replacementTransferId: result.replacementTransfer.id,
          sourceMeterReadingId: result.sourceMeterReadingId,
        },
      )
    } catch (err) { console.error('[route]', err) }

    publishRealtimeEvent({
      type: 'device-transferred',
      assetNo: source.assetCode,
      site: source.site,
      payload: {
        action: 'replace-on-withdraw',
        fromStatus: source.status,
        toStatus,
        replacementAssetCode,
        created: result.created,
      },
    })
    publishRealtimeEvent({
      type: 'device-transferred',
      assetNo: replacementAssetCode,
      site: installLocation.site,
      payload: {
        action: 'replacement-installed',
        toStatus: 'ACTIVE',
        replacesAssetCode: source.assetCode,
        created: result.created,
      },
    })

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    console.error('POST /api/devices/[id]/replace-on-withdraw', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Replace-on-withdraw failed') : 'Internal server error'
    return NextResponse.json({ error: message, code: 'REPLACE_WITHDRAW_FAILED' }, { status: 500 })
  }
}
