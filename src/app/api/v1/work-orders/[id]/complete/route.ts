/**
 * POST /api/v1/work-orders/[id]/complete — mark a work order as completed.
 *
 * Auth: WO_COMPLETE (checked at the WO's Site via loadAuthorizedWorkOrderV1).
 * Body: { detailsAdmin?, picAfter? }
 *   - Set status = COMPLETED, workCompletedAt = now, closedAt = now
 *   - Audit log: WO_COMPLETE
 * Response: { data: WorkOrder, meta }
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import {
  ok,
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
    // checks WO_COMPLETE at the WO's Site, preventing cross-site privilege
    // escalation (a staff member at Site A can no longer complete WOs at Site B).
    const result = await loadAuthorizedWorkOrderV1(req, id, 'WO_COMPLETE')
    if (!result.ok) return result.response
    const { wo: existing, auth } = result
    const user = auth.user
    const userEmail = user.email

    // Can't complete an already-cancelled order.
    if (existing.status === 'CANCELLED') {
      return conflict(
        `ใบแจ้งซ่อมนี้ถูกยกเลิกแล้ว ไม่สามารถปิดงานได้`,
        { code: 'WO_CANCELLED', field: 'status' },
      )
    }
    if (existing.status === 'COMPLETED') {
      // Idempotent: return the existing record unchanged.
      return ok(existing)
    }

    const body = await req.json().catch(() => ({}))
    const now = new Date()

    const data: Record<string, unknown> = {
      status: 'COMPLETED',
      workCompletedAt: now,
      closedAt: now,
    }

    if (body.detailsAdmin !== undefined && body.detailsAdmin !== null) {
      data.detailsAdmin = String(body.detailsAdmin)
      data.dateAdmin = now.toISOString().slice(0, 10)
    }
    if (body.picAfter !== undefined && body.picAfter !== null) {
      data.picAfter = String(body.picAfter)
    }

    // Optional: also stamp picOnsite if provided (for technicians completing
    // on-site work in one step).
    if (body.picOnsite !== undefined && body.picOnsite !== null) {
      data.picOnsite = String(body.picOnsite)
    }

    const updated = await db.workOrder.update({
      where: { id: existing.id },
      data,
    })

    await logAudit(
      'WO_COMPLETE',
      'WorkOrder',
      updated.id,
      `ปิดงานใบแจ้งซ่อม ${updated.woNumber} โดย ${userEmail}`,
      {
        woNumber: updated.woNumber,
        oldStatus: existing.status,
        newStatus: 'COMPLETED',
      },
      userEmail,
    )

    return ok(updated)
  } catch (err) {
    console.error('POST /api/v1/work-orders/[id]/complete', err)
    return serverError()
  }
}
