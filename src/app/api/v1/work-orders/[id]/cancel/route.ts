/**
 * POST /api/v1/work-orders/[id]/cancel — cancel a work order.
 *
 * Auth: WO_CANCEL (checked at the WO's Site via loadAuthorizedWorkOrderV1).
 * Body: { cancelReason }
 *   - Set status = CANCELLED, canceledAt = now, cancelReason
 *   - Audit log: WO_CANCEL
 * Response: { data: WorkOrder, meta }
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import {
  ok,
  badRequest,
  conflict,
  serverError,
} from '@/lib/api/response'
import { loadAuthorizedWorkOrderV1 } from '../../_shared'
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
    // checks WO_CANCEL at the WO's Site, preventing cross-site privilege
    // escalation (a staff member at Site A can no longer cancel WOs at Site B).
    const result = await loadAuthorizedWorkOrderV1(req, id, 'WO_CANCEL')
    if (!result.ok) return result.response
    const { wo: existing, auth } = result
    const user = auth.user
    const userEmail = user.email

    if (existing.status === 'COMPLETED') {
      return conflict(
        `ใบแจ้งซ่อมนี้ปิดงานแล้ว ไม่สามารถยกเลิกได้`,
        { code: 'WO_COMPLETED', field: 'status' },
      )
    }
    if (existing.status === 'CANCELLED') {
      // Idempotent
      return ok(existing)
    }

    const body = await req.json().catch(() => ({}))
    const cancelReason = String(body.cancelReason ?? '').trim()
    if (!cancelReason) {
      return badRequest('cancelReason เป็นฟิลด์ที่ต้องการ', {
        field: 'cancelReason',
      })
    }

    const now = new Date()
    const updated = await db.workOrder.update({
      where: { id: existing.id },
      data: {
        status: 'CANCELLED',
        canceledAt: now,
        cancelReason,
      },
    })

    await logAudit(
      'WO_CANCEL',
      'WorkOrder',
      updated.id,
      `ยกเลิกใบแจ้งซ่อม ${updated.woNumber} โดย ${userEmail}: ${cancelReason}`,
      {
        woNumber: updated.woNumber,
        oldStatus: existing.status,
        newStatus: 'CANCELLED',
        cancelReason,
      },
      userEmail,
    )

    return ok(updated)
  } catch (err) {
    console.error('POST /api/v1/work-orders/[id]/cancel', err)
    return serverError()
  }
}
