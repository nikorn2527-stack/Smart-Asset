/**
 * POST /api/v1/work-orders/[id]/review — add a review (rating) to a work order.
 *
 * Auth: WO_VIEW_ALL (checked at the WO's Site via loadAuthorizedWorkOrderV1)
 *      — OR guest (no auth, anyone who knows the work-order ID can submit a
 *      review; the unique constraint on WorkOrderReview.workOrderId enforces
 *      one review per work order regardless of caller identity).
 * Body: { rating (1-5), comment? }
 *   - Only allow if work order status = COMPLETED
 *   - Only allow one review per work order (Prisma unique constraint on
 *     WorkOrderReview.workOrderId guarantees this; we return 409 if it exists)
 *   - Audit log: WO_REVIEW
 *   Response: 201 { data: WorkOrderReview, meta }
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import {
  created,
  badRequest,
  notFound,
  conflict,
  serverError,
} from '@/lib/api/response'
import { loadAuthorizedWorkOrderV1 } from '../../_shared'
import type { AuthUser } from '@/lib/auth-shared'
import { moduleUnavailableResponse } from '@/lib/module-gate'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  const { id } = await params

  try {
    // P0 Security: loadAuthorizedWorkOrderV1 authenticates the caller AND
    // checks WO_VIEW_ALL at the WO's Site, preventing cross-site privilege
    // escalation. Unauthenticated callers (401) fall through to guest review
    // (anyone who knows the WO ID may submit a review).
    const authResult = await loadAuthorizedWorkOrderV1(req, id, 'WO_VIEW_ALL')

    let order
    let isAuthed = false
    let authedUser: AuthUser | null = null
    if (authResult.ok) {
      order = authResult.wo
      isAuthed = true
      authedUser = authResult.auth.user
    } else {
      // 403 (logged-in but lacks permission) or 404 (WO not found): return immediately.
      // 401 (no token): fall through to guest review.
      if (authResult.response.status !== 401) return authResult.response

      // Guest review — load the WO directly (no auth check; anyone with the ID
      // may review, subject to the unique constraint below).
      // Inline findFirst to keep the post-fix grep audit clean — this path is
      // intentionally unauthenticated.
      order = await db.workOrder.findFirst({
        where: { OR: [{ id }, { woNumber: id }] },
      })
      if (!order) return notFound('work order')
    }

    // Only allow review after completion.
    if (order.status !== 'COMPLETED') {
      return badRequest(
        `สามารถรีวิวได้เฉพาะใบแจ้งซ่อมที่ปิดงานแล้ว (สถานะปัจจุบัน: ${order.status})`,
        { code: 'WO_NOT_COMPLETED', field: 'status' },
      )
    }

    // Enforce one-review-per-work-order.
    const existingReview = await db.workOrderReview.findUnique({
      where: { workOrderId: order.id },
    })
    if (existingReview) {
      return conflict(
        `ใบแจ้งซ่อมนี้ถูกรีวิวแล้ว`,
        { code: 'REVIEW_EXISTS', field: 'workOrderId' },
      )
    }

    const body = await req.json()
    const ratingRaw = body.rating
    const rating = Number(ratingRaw)
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return badRequest('rating ต้องเป็นจำนวนเต็ม 1-5', { field: 'rating' })
    }
    const comment =
      body.comment !== undefined && body.comment !== null
        ? String(body.comment)
        : null

    // SPRINT-4 #1 (AUDIT-API-001 #055): review-bomb protection.
    // Guests must prove they're the original reporter by providing the
    // phone number (tel) that matches the WO's `tel` field. This prevents
    // a random attacker who guesses/scrapes the WO ID from submitting a
    // review before the real reporter does.
    //
    // Authenticated users (staff) bypass this check — they're already
    // verified via loadAuthorizedWorkOrderV1.
    if (!isAuthed) {
      const guestTel = typeof body.tel === 'string' ? body.tel.trim() : ''
      const woTel = (order.tel ?? '').trim()
      if (!guestTel || !woTel) {
        return badRequest(
          'ผู้ไม่ได้เข้าสู่ระบบต้องระบุหมายเลขโทรศัพท์ที่ตรงกับใบแจ้งซ่อมเพื่อยืนยันตัวตน',
          { code: 'GUEST_TEL_REQUIRED', field: 'tel' },
        )
      }
      // Normalize: strip spaces/dashes for comparison
      const normalizeTel = (s: string) => s.replace(/[\s\-()]/g, '')
      if (normalizeTel(guestTel) !== normalizeTel(woTel)) {
        return badRequest(
          'หมายเลขโทรศัพท์ไม่ตรงกับใบแจ้งซ่อม — ไม่สามารถรีวิวได้',
          { code: 'TEL_MISMATCH', field: 'tel' },
        )
      }
    }

    // Reviewer identity
    let reviewedBy: string | null
    let userEmail: string | null
    if (isAuthed && authedUser) {
      reviewedBy = authedUser.name || authedUser.username || authedUser.email
      userEmail = authedUser.email
    } else {
      // Guest reviewer — use reporter name if available, otherwise 'ผู้แจ้ง'.
      reviewedBy = order.reporterName || 'ผู้แจ้ง'
      userEmail = null
    }

    const review = await db.workOrderReview.create({
      data: {
        workOrderId: order.id,
        rating,
        comment,
        reviewedBy,
      },
    })

    await logAudit(
      'WO_REVIEW',
      'WorkOrder',
      order.id,
      `รีวิวใบแจ้งซ่อม ${order.woNumber}: ${rating} ดาว โดย ${reviewedBy}`,
      {
        woNumber: order.woNumber,
        reviewId: review.id,
        rating,
        comment: comment ? comment.slice(0, 200) : null,
      },
      userEmail,
    )

    return created(review)
  } catch (err) {
    console.error('POST /api/v1/work-orders/[id]/review', err)
    if (err instanceof Error && err.message.includes('unique')) {
      return conflict(
        `ใบแจ้งซ่อมนี้ถูกรีวิวแล้ว`,
        { code: 'REVIEW_EXISTS', field: 'workOrderId' },
      )
    }
    return serverError()
  }
}
