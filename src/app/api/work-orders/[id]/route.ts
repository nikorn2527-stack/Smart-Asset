import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { loadAuthorizedWorkOrder } from '@/lib/wo-authz'
import { normalizeSiteCode } from '@/lib/site-scope'
import { withSerializableRetry } from '@/lib/retry-transaction'
import { moduleUnavailableResponse } from '@/lib/module-gate'

const VALID_STATUSES = new Set([
  'PENDING',
  'IN_PROGRESS',
  'WAITING_PARTS',
  'COMPLETED',
  'CANCELLED',
])

const VALID_PRIORITIES = new Set(['ปกติ', 'ปานกลาง', 'สูง', 'ด่วน'])

async function logAudit(
  action: string,
  entityId: string | null,
  summary: string,
  detail: Record<string, unknown> | null,
  actor: string,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action,
        entity: 'WorkOrder',
        entityId,
        summary,
        detail: detail ? JSON.stringify(detail) : null,
        actor,
      },
    })
  } catch (err) {
    console.error('logAudit failed:', err)
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'WO_VIEW_ALL')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const { id } = await params

    // Authenticate + authorize (allowOwn so reporters can view their own WOs)
    const result = await loadAuthorizedWorkOrder(req, id, 'WO_VIEW_ALL', {
      allowOwn: true,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    // Re-fetch with the full include set required by the detail payload.
    // (loadAuthorizedWorkOrder already verified access; this preserves the
    // existing response shape with messages + reviews + extended device.)
    const wo = await db.workOrder.findUnique({
      where: { id: result.wo.id },
      include: {
        device: {
          select: {
            id: true,
            assetCode: true,
            name: true,
            brand: true,
            model: true,
            site: true,
          },
        },
        messages: { orderBy: { createdAt: 'asc' } },
        reviews: true,
      },
    })
    if (!wo) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ data: wo })
  } catch (err) {
    console.error('GET /api/work-orders/[id]', err)
    return NextResponse.json(
      { error: 'Failed to fetch work order' },
      { status: 500 },
    )
  }
}

const EDITABLE_FIELDS = [
  'subject',
  'building',
  'location',
  'details',
  'priority',
  'reporterName',
  'reporterEmail',
  'tel',
  'employeeCode',
  'status',
  'assignedTo',
  'assignmentNote',
  'detailsAdmin',
  'dateAdmin',
  'picBefore',
  'picOnsite',
  'picAfter',
  'deviceId',
  'isSpecialFee',
] as const

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'WO_COMPLETE')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const { id } = await params

    // Authenticate + authorize — editing a WO requires WO_ASSIGN at its Site
    const result = await loadAuthorizedWorkOrder(req, id, 'WO_ASSIGN')
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { wo: before, auth } = result

    const body = await req.json()
    const data: Record<string, unknown> = {}
    if (body.subject !== undefined)
      data.subject = String(body.subject).trim()
    if (body.building !== undefined)
      data.building = body.building ? String(body.building).trim() : null
    if (body.location !== undefined)
      data.location = body.location ? String(body.location).trim() : null
    if (body.details !== undefined)
      data.details = body.details ? String(body.details).trim() : null
    if (body.priority !== undefined) {
      const p = String(body.priority).trim()
      if (VALID_PRIORITIES.has(p)) data.priority = p
    }
    if (body.reporterName !== undefined)
      data.reporterName = body.reporterName
        ? String(body.reporterName).trim()
        : null
    if (body.reporterEmail !== undefined)
      data.reporterEmail = body.reporterEmail
        ? String(body.reporterEmail).trim()
        : null
    if (body.tel !== undefined)
      data.tel = body.tel ? String(body.tel).trim() : null
    if (body.employeeCode !== undefined)
      data.employeeCode = body.employeeCode
        ? String(body.employeeCode).trim()
        : null
    // SPRINT-2 #6 (AUDIT-API-001 #059): body.status bypass — callers
    // could PUT {status: 'COMPLETED'} to mark a WO done without going
    // through /api/work-orders/[id]/complete (which enforces the
    // assignedTo check + parts approval flow). Status transitions are
    // now ONLY available through the dedicated endpoints:
    //   - /complete  (WO_COMPLETE at site)
    //   - /cancel    (WO_COMPLETE at site)
    //   - /assign    (WO_ASSIGN at site)
    // The PUT route rejects body.status with 400 so callers know to
    // use the right endpoint.
    if (body.status !== undefined) {
      return NextResponse.json(
        {
          error: 'ไม่สามารถเปลี่ยนสถานะผ่าน PUT ได้ — ใช้ /complete, /cancel หรือ /assign endpoint แทน',
          code: 'STATUS_VIA_DEDICATED_ENDPOINT',
        },
        { status: 400 },
      )
    }
    if (body.assignedTo !== undefined)
      data.assignedTo = body.assignedTo ? String(body.assignedTo).trim() : null
    if (body.assignmentNote !== undefined)
      data.assignmentNote = body.assignmentNote
        ? String(body.assignmentNote).trim()
        : null
    if (body.detailsAdmin !== undefined)
      data.detailsAdmin = body.detailsAdmin
        ? String(body.detailsAdmin).trim()
        : null
    if (body.dateAdmin !== undefined)
      data.dateAdmin = body.dateAdmin ? String(body.dateAdmin).trim() : null
    if (body.picBefore !== undefined)
      data.picBefore = body.picBefore ? String(body.picBefore) : null
    if (body.picOnsite !== undefined)
      data.picOnsite = body.picOnsite ? String(body.picOnsite) : null
    if (body.picAfter !== undefined)
      data.picAfter = body.picAfter ? String(body.picAfter) : null
    if (body.deviceId !== undefined) {
      const newDeviceId =
        typeof body.deviceId === 'string' && body.deviceId.trim()
          ? body.deviceId.trim()
          : null

      // Task ID: RESIDUAL-BLOCKERS-ROUND-4 — prevent cross-Site device
      // reassignment. The WO's Site is derived from siteCode (or
      // device.site for legacy rows). If the caller is changing the
      // deviceId, the new device's Site must match the WO's Site — OR
      // the caller must have WO_ASSIGN at BOTH Sites (old + new), since
      // moving a WO across Sites effectively transfers responsibility.
      // Superadmin bypasses this check (ctx.isSuperAdmin).
      if (newDeviceId && newDeviceId !== before.deviceId) {
        const newDevice = await db.device.findUnique({
          where: { id: newDeviceId },
          select: { site: true },
        })
        if (!newDevice) {
          return NextResponse.json(
            { error: 'ไม่พบอุปกรณ์ที่ระบุ (deviceId ไม่ถูกต้อง)' },
            { status: 400 },
          )
        }
        const newDeviceSite = newDevice.site
          ? normalizeSiteCode(newDevice.site)
          : null
        const oldWoSite = result.woSite // normalized WO Site from loadAuthorizedWorkOrder

        // B4 FIX (round 6): Handle null-site WOs (legacy WOs that haven't
        // been backfilled with siteCode). When oldWoSite is null:
        // - The WO has no canonical Site, so we can't check "cross-Site"
        // - But we MUST still validate that the caller has WO_ASSIGN at
        //   the NEW device's Site (otherwise anyone could assign a device
        //   from any Site to a null-site WO)
        // - We also populate siteCode from the new device to fix the
        //   null-site invariant atomically in the same update.
        if (newDeviceSite) {
          if (!result.ctx.isSuperAdmin) {
            // Always require WO_ASSIGN at the new device's Site
            if (!result.ctx.canAtSite(newDeviceSite, 'WO_ASSIGN')) {
              return NextResponse.json(
                {
                  error:
                    `ไม่มีสิทธิ์ WO_ASSIGN ที่สาขา ${newDeviceSite} ` +
                    `(สาขาของอุปกรณ์ใหม่)`,
                },
                { status: 403 },
              )
            }
            // If oldWoSite exists and differs, also require WO_ASSIGN there
            if (oldWoSite && newDeviceSite !== oldWoSite) {
              if (!result.ctx.canAtSite(oldWoSite, 'WO_ASSIGN')) {
                return NextResponse.json(
                  {
                    error:
                      `ไม่สามารถเปลี่ยนอุปกรณ์เป็นอุปกรณ์จากสาขาอื่นได้ — ` +
                      `ต้องมีสิทธิ์ WO_ASSIGN ทั้งที่สาขาเดิม (${oldWoSite}) และสาขาใหม่ (${newDeviceSite})`,
                  },
                  { status: 403 },
                )
              }
            }
          }
          // Always update siteCode to match the device's Site.
          // This fixes the null-site invariant: after this update, the WO
          // will have a canonical siteCode derived from its device.
          data.siteCode = newDeviceSite
        } else {
          // New device has no Site — data integrity issue
          return NextResponse.json(
            { error: 'อุปกรณ์ที่ระบุไม่มีสาขา (site) — ไม่สามารถผูกกับใบงานได้' },
            { status: 400 },
          )
        }
        data.deviceId = newDeviceId
      }
    }
    if (body.isSpecialFee !== undefined) {
      data.isSpecialFee = body.isSpecialFee === true
    }

    // B4 FIX (round 9): Authorization snapshot INSIDE serializable transaction.
    // The authorization check from loadAuthorizedWorkOrder happens BEFORE the
    // transaction (for 404/403 response), but we re-check the WO's Site
    // inside the transaction to close the TOCTOU race: between the pre-check
    // and the transaction, another request could have changed the WO's
    // deviceId/siteCode, moving it to a Site the caller can't access.
    //
    // The audit log is also written inside the transaction (tx.auditLog.create)
    // so it's atomic with the update — no partial state if the transaction
    // rolls back.
    const expectedVersion = typeof body.expectedVersion === 'number' ? body.expectedVersion : null

    // Capture the authorization context from the pre-check
    const authCtx = result.ctx
    const authUser = auth

    const { updated, changes, auditSiteCode } = await withSerializableRetry(async (tx) => {
      // Re-read the WO inside the transaction with FOR UPDATE semantics
      // (Serializable isolation provides this in PostgreSQL).
      const currentWo = await tx.workOrder.findUnique({
        where: { id: before.id },
        select: {
          id: true,
          version: true,
          siteCode: true,
          deviceId: true,
          woNumber: true,
          // Include all EDITABLE_FIELDS for change tracking
          subject: true, building: true, location: true, details: true,
          priority: true, reporterName: true, reporterEmail: true, tel: true,
          employeeCode: true, status: true, assignedTo: true, assignmentNote: true,
          detailsAdmin: true, dateAdmin: true, picBefore: true, picOnsite: true,
          picAfter: true, isSpecialFee: true,
          // Include device relation for Site fallback (B4: current Site
          // must come from the transaction snapshot, not the pre-check)
          device: { select: { site: true } },
        },
      })
      if (!currentWo) {
        throw new Error('NOT_FOUND')
      }

      // B4 FIX: Re-check authorization with the CURRENT siteCode from
      // inside the transaction. If the WO was moved to a different Site
      // between the pre-check and now, this catches it.
      // B4 FIX (round 10): null Site → fail-closed (deny, not allow)
      const currentWoSite = currentWo.siteCode ?? currentWo.device?.site ?? null
      if (!authCtx.isSuperAdmin) {
        if (!currentWoSite) {
          // WO has no derivable Site — deny (fail-closed)
          throw new Error('WO_NO_SITE')
        }
        if (!authCtx.canAtSite(currentWoSite, 'WO_ASSIGN')) {
          throw new Error('AUTHZ_SITE_CHANGED')
        }
      }

      // Optimistic concurrency check
      if (expectedVersion !== null && currentWo.version !== expectedVersion) {
        throw new Error('VERSION_CONFLICT')
      }

      // B4 FIX: Invariant check — if deviceId is being changed, verify
      // that the new device's siteCode matches data.siteCode.
      if (data.deviceId && data.deviceId !== currentWo.deviceId) {
        const newDevice = await tx.device.findUnique({
          where: { id: data.deviceId as string },
          select: { site: true },
        })
        if (!newDevice || !newDevice.site) {
          throw new Error('DEVICE_NO_SITE')
        }
        const normalizedNewSite = newDevice.site.toUpperCase()
        const expectedSite = data.siteCode ? String(data.siteCode).toUpperCase() : null
        if (expectedSite && expectedSite !== normalizedNewSite) {
          throw new Error('SITE_INVARIANT_VIOLATION')
        }
        data.siteCode = normalizedNewSite

        // B4 FIX: Re-check authorization at the NEW device's Site too
        if (!authCtx.isSuperAdmin && !authCtx.canAtSite(normalizedNewSite, 'WO_ASSIGN')) {
          throw new Error('AUTHZ_NEW_SITE_DENIED')
        }
      }

      // B4 FIX (round 10): Conditional update using id + version.
      // This prevents lost updates: if another request updated the WO
      // between our read and update, the WHERE clause won't match
      // and we get a "not found" result (detected below).
      const updateResult = await tx.workOrder.updateMany({
        where: { id: before.id, version: currentWo.version },
        data: { ...data, version: { increment: 1 } },
      })
      if (updateResult.count === 0) {
        // Version changed between read and update — concurrent modification
        throw new Error('VERSION_CONFLICT')
      }

      // Re-read the updated WO to get the full record
      const updatedWo = await tx.workOrder.findUnique({
        where: { id: before.id },
      })
      if (!updatedWo) {
        throw new Error('NOT_FOUND')
      }

      // Track changes
      const changeLog: Record<string, { from: unknown; to: unknown }> = {}
      for (const k of EDITABLE_FIELDS) {
        if (body[k] !== undefined) {
          const from = currentWo[k as keyof typeof currentWo]
          const to = updatedWo[k as keyof typeof updatedWo]
          if (String(from ?? '') !== String(to ?? '')) {
            changeLog[k] = { from, to }
          }
        }
      }
      if (
        data.siteCode !== undefined &&
        String(currentWo.siteCode ?? '') !== String(updatedWo.siteCode ?? '')
      ) {
        changeLog.siteCode = {
          from: currentWo.siteCode ?? null,
          to: updatedWo.siteCode ?? null,
        }
      }

      // B4 FIX (round 10): Write audit log INSIDE the transaction.
      // If audit fails, the transaction rolls back (no partial state).
      // Previously errors were swallowed which could hide data integrity issues.
      const siteForAudit = updatedWo.siteCode ?? currentWo.siteCode ?? null
      await tx.auditLog.create({
        data: {
          action: 'UPDATE',
          entity: 'WorkOrder',
          entityId: before.id,
          summary: `แก้ไขใบแจ้งซ่อม ${updatedWo.woNumber ?? before.id}`,
          detail: JSON.stringify({ changes: changeLog, version: updatedWo.version }),
          actor: authUser.user.email,
          siteCode: siteForAudit,
        },
      })

      return { updated: updatedWo, changes: changeLog, auditSiteCode: siteForAudit }
    }) // withSerializableRetry handles isolationLevel + retry

    return NextResponse.json({ data: updated })
  } catch (err) {
    // Handle transaction errors
    if (err instanceof Error) {
      if (err.message === 'NOT_FOUND') {
        return NextResponse.json({ error: 'ไม่พบใบงาน' }, { status: 404 })
      }
      if (err.message === 'VERSION_CONFLICT') {
        return NextResponse.json(
          { error: 'ข้อมูลถูกแก้ไขโดยผู้ใช้อื่น — กรุณารีเฟรชแล้วลองอีกครั้ง', code: 'VERSION_CONFLICT' },
          { status: 409 },
        )
      }
      if (err.message === 'AUTHZ_SITE_CHANGED') {
        // WO was moved to a different Site between pre-check and transaction
        return NextResponse.json(
          { error: 'ใบงานถูกย้ายไปสาขาอื่น — กรุณารีเฟรชแล้วลองอีกครั้ง', code: 'AUTHZ_SITE_CHANGED' },
          { status: 409 },
        )
      }
      if (err.message === 'WO_NO_SITE') {
        // WO has no derivable Site — fail-closed
        return NextResponse.json(
          { error: 'ใบงานไม่มีสาขา (siteCode) — ไม่สามารถแก้ไขได้', code: 'WO_NO_SITE' },
          { status: 403 },
        )
      }
      if (err.message === 'AUTHZ_NEW_SITE_DENIED') {
        return NextResponse.json(
          { error: 'ไม่มีสิทธิ์ WO_ASSIGN ที่สาขาของอุปกรณ์ใหม่', code: 'AUTHZ_NEW_SITE_DENIED' },
          { status: 403 },
        )
      }
      if (err.message === 'DEVICE_NO_SITE') {
        return NextResponse.json(
          { error: 'อุปกรณ์ที่ระบุไม่มีสาขา (site) — ไม่สามารถผูกกับใบงานได้' },
          { status: 400 },
        )
      }
      if (err.message === 'SITE_INVARIANT_VIOLATION') {
        return NextResponse.json(
          { error: 'Site invariant violation — ติดต่อผู้ดูแล' },
          { status: 500 },
        )
      }
      // Prisma serialization conflict (P2034)
      if (err.message.includes('P2034') || err.message.includes('Transaction') || err.message.includes('could not serialize')) {
        return NextResponse.json(
          { error: 'เกิดการขัดแย้งของข้อมูล — กรุณาลองอีกครั้ง', code: 'SERIALIZATION_CONFLICT' },
          { status: 409 },
        )
      }
    }
    console.error('PUT /api/work-orders/[id]', err)
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to update work order') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ── PATCH /api/work-orders/[id] — alias for PUT (QA BUG-INT-001 fix)
// Some clients (e.g., fetch with method: 'PATCH') expect PATCH to work.
// We delegate to the same handler as PUT.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  return PUT(req, { params })
}
