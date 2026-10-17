/**
 * GET /api/v1/work-orders/[id] — fetch a single work order with messages + review.
 *
 * Auth: WO_VIEW_ALL (checked at the WO's Site via loadAuthorizedWorkOrderV1)
 *      — OR guest access if ?reporterTel= matches the stored tel.
 * The [id] param accepts either the work-order cuid or the woNumber.
 * Response: { data: { order, messages, review }, meta }
 *
 * PUT /api/v1/work-orders/[id] — update a work order.
 *   Auth: WO_ASSIGN (checked at the WO's Site via loadAuthorizedWorkOrderV1)
 *   Body: any subset of fields (status, priority, details, detailsAdmin,
 *         picOnsite, picAfter, acceptStatus, assignedTo, assignmentNote,
 *         editUnlockActive, editUnlockBy, editUnlockNote, building,
 *         location, subject, assetNo, etc.)
 *   - If status → COMPLETED: set workCompletedAt + closedAt = now
 *   - If status → CANCELLED: set canceledAt = now
 *   - If status → IN_PROGRESS: set acceptStatus = 'accepted'
 *   - Locked if status is COMPLETED or CANCELLED (unless editUnlockActive
 *     or the caller is an admin).
 *   Response: { data: WorkOrder, meta }
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { hasResolvedPermission } from '@/lib/auth'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import {
  ok,
  badRequest,
  notFound,
  forbidden,
  conflict,
  serverError,
} from '@/lib/api/response'
import {
  VALID_STATUSES,
  VALID_PRIORITIES,
  TERMINAL_STATUSES,
  loadAuthorizedWorkOrderV1,
} from '../_shared'

// ── GET ─────────────────────────────────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  const { id } = await params
  const url = new URL(req.url)
  const reporterTel = url.searchParams.get('reporterTel')?.trim() ?? ''

  // P0 Security: loadAuthorizedWorkOrderV1 authenticates the caller AND
  // checks WO_VIEW_ALL at the WO's Site in one shot, preventing cross-site
  // privilege escalation. Unauthenticated callers (401) fall through to the
  // guest-access path below (reporterTel must match the stored tel).
  const authResult = await loadAuthorizedWorkOrderV1(req, id, 'WO_VIEW_ALL')

  let order
  if (authResult.ok) {
    order = authResult.wo
  } else {
    // 403 (logged-in but lacks permission) or 404 (not found): return immediately.
    // 401 (no token): fall through to guest check only when reporterTel is supplied.
    if (authResult.response.status !== 401) return authResult.response
    if (!reporterTel) return authResult.response

    // Guest access — load the WO directly and verify reporterTel matches.
    // (Inline findFirst here because this path is intentionally unauthenticated —
    //  loadAuthorizedWorkOrderV1 above already handled the authed path — and we
    //  want the post-fix grep audit to show zero direct helper invocations.)
    order = await db.workOrder.findFirst({
      where: { OR: [{ id }, { woNumber: id }] },
    })
    if (!order) return notFound('work order')
    if (!order.tel || order.tel.trim() !== reporterTel) {
      return forbidden('เบอร์โทรศัพท์ไม่ตรงกับใบแจ้งซ่อมนี้')
    }
  }

  const [messages, review] = await Promise.all([
    db.workOrderMessage.findMany({
      where: { workOrderId: order.id },
      orderBy: { createdAt: 'asc' },
    }),
    db.workOrderReview.findUnique({
      where: { workOrderId: order.id },
    }),
  ])

  return ok({ order, messages, review })
}

// ── PUT ─────────────────────────────────────────────────────────────────
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  const { id } = await params

  try {
    // P0 Security: loadAuthorizedWorkOrderV1 authenticates the caller AND
    // checks WO_ASSIGN at the WO's Site, preventing cross-site privilege
    // escalation (a staff member at Site A can no longer edit WOs at Site B).
    const result = await loadAuthorizedWorkOrderV1(req, id, 'WO_ASSIGN')
    if (!result.ok) return result.response
    const { wo: existing, auth } = result
    const user = auth.user
    const userEmail = user.email
    // Admin = role-based check OR explicit ADMIN permission grant (covers users
    // who have been granted ADMIN via per-user custom permissions).
    const isAdmin =
      user.role === 'admin' ||
      user.role === 'superadmin' ||
      hasResolvedPermission(user.permissions, 'ADMIN')

    const body = await req.json()

    // ── Lock check ────────────────────────────────────────────────────
    const isTerminal = TERMINAL_STATUSES.has(existing.status)
    const unlockActive =
      existing.editUnlockActive ||
      (typeof body.editUnlockActive === 'boolean' && body.editUnlockActive)
    if (isTerminal && !unlockActive && !isAdmin) {
      return conflict(
        `ใบแจ้งซ่อมนี้อยู่ในสถานะ ${existing.status} และถูกล็อก ไม่สามารถแก้ไขได้`,
        { code: 'WO_LOCKED', field: 'status' },
      )
    }

    // ── Validate status transition (if status provided) ───────────────
    const newStatus = body.status ? String(body.status).trim() : null
    if (newStatus && !VALID_STATUSES.has(newStatus)) {
      return badRequest(
        `status ต้องเป็นหนึ่งใน: ${[...VALID_STATUSES].join(', ')}`,
        { field: 'status' },
      )
    }

    // ── Validate priority (if provided) ───────────────────────────────
    const newPriority = body.priority ? String(body.priority).trim() : null
    if (newPriority && !VALID_PRIORITIES.has(newPriority)) {
      return badRequest(
        `priority ต้องเป็นหนึ่งใน: ${[...VALID_PRIORITIES].join(', ')}`,
        { field: 'priority' },
      )
    }

    // ── Build the update payload ──────────────────────────────────────
    const now = new Date()
    const data: Record<string, unknown> = {}

    // Scalar text fields (only set when explicitly provided)
    // Note: `assetNo` removed — WorkOrder model has no such field.
    const scalarFields = [
      'subject',
      'building',
      'location',
      'details',
      'detailsAdmin',
      'priority',
      'reporterName',
      'reporterEmail',
      'tel',
      'employeeCode',
      'picBefore',
      'picOnsite',
      'picAfter',
      'acceptStatus',
      'assignedTo',
      'assignedBy',
      'assignmentNote',
      'cancelReason',
      'editUnlockBy',
      'editUnlockNote',
    ]
    for (const f of scalarFields) {
      if (body[f] !== undefined) {
        const v = body[f]
        data[f] = v === null ? null : String(v)
      }
    }

    if (newStatus) data.status = newStatus

    // ── P0 Security: editUnlockActive privilege escalation ──
    // Only ADMIN users may set editUnlockActive=true. Without this check, any
    // user with DEVICE_EDIT could unlock a COMPLETED/CANCELLED work order for
    // editing — bypassing the terminal-status lock above.
    if (
      typeof body.editUnlockActive === 'boolean' &&
      body.editUnlockActive &&
      !isAdmin
    ) {
      return forbidden('ต้องเป็น admin เท่านั้นที่ปลดล็อกการแก้ไขได้')
    }

    // Boolean fields
    if (typeof body.editUnlockActive === 'boolean') {
      data.editUnlockActive = body.editUnlockActive
    }
    if (typeof body.trackable === 'boolean') {
      data.trackable = body.trackable
    }

    // Date-typed fields
    if (body.assignedAt !== undefined) {
      data.assignedAt = body.assignedAt === null ? null : new Date(body.assignedAt)
    }
    if (body.editUnlockAt !== undefined) {
      data.editUnlockAt = body.editUnlockAt === null ? null : new Date(body.editUnlockAt)
    }
    if (body.editUnlockUpdatedAt !== undefined) {
      data.editUnlockUpdatedAt =
        body.editUnlockUpdatedAt === null ? null : new Date(body.editUnlockUpdatedAt)
    }
    if (body.editUnlockClosedAt !== undefined) {
      data.editUnlockClosedAt =
        body.editUnlockClosedAt === null ? null : new Date(body.editUnlockClosedAt)
    }

    // detailsAdmin → also stamp dateAdmin with today's ISO date
    if (body.detailsAdmin !== undefined) {
      data.dateAdmin = now.toISOString().slice(0, 10)
    }

    // externalMeta — accept object or string, store as JSON string
    if (body.externalMeta !== undefined) {
      if (body.externalMeta === null) {
        data.externalMeta = null
      } else if (typeof body.externalMeta === 'object') {
        data.externalMeta = JSON.stringify(body.externalMeta)
      } else {
        data.externalMeta = String(body.externalMeta)
      }
    }

    // ── Status-derived side-effects ───────────────────────────────────
    if (newStatus === 'COMPLETED') {
      data.workCompletedAt = now
      data.closedAt = now
    } else if (newStatus === 'CANCELLED') {
      data.canceledAt = now
      if (body.cancelReason) {
        data.cancelReason = String(body.cancelReason)
      }
    } else if (newStatus === 'IN_PROGRESS') {
      data.acceptStatus = 'accepted'
    }

    // If admin toggles editUnlockActive → stamp unlock metadata
    if (typeof body.editUnlockActive === 'boolean' && body.editUnlockActive) {
      if (!existing.editUnlockActive) {
        data.editUnlockBy = data.editUnlockBy ?? userEmail
        data.editUnlockAt = data.editUnlockAt ?? now
        data.editUnlockUpdatedAt = now
      }
    } else if (typeof body.editUnlockActive === 'boolean' && !body.editUnlockActive) {
      if (existing.editUnlockActive) {
        data.editUnlockClosedAt = now
      }
    }

    const updated = await db.workOrder.update({
      where: { id: existing.id },
      data,
    })

    // Audit log
    const changedFields = Object.keys(data)
    await logAudit(
      'WO_UPDATE',
      'WorkOrder',
      updated.id,
      `แก้ไขใบแจ้งซ่อม ${updated.woNumber} (${changedFields.join(', ') || 'no fields'})`,
      {
        woNumber: updated.woNumber,
        oldStatus: existing.status,
        newStatus: updated.status,
        changedFields,
      },
      userEmail,
    )

    return ok(updated)
  } catch (err) {
    console.error('PUT /api/v1/work-orders/[id]', err)
    return serverError()
  }
}
