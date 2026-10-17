import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { notifyWorkOrderCancelled } from '@/lib/notifications'
import { loadAuthorizedWorkOrder } from '@/lib/wo-authz'
import { releaseStockReservation } from '@/lib/stock-calculation'
import { moduleUnavailableResponse } from '@/lib/module-gate'

async function logAudit(
  action: string,
  entityId: string | null,
  summary: string,
  detail: Record<string, unknown> | null,
  actor: string,
  siteCode?: string | null,
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
        siteCode: siteCode ?? null,
      },
    })
  } catch (err) {
    console.error('logAudit failed:', err)
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  // Auth: loadAuthorizedWorkOrder does the site-scoped WO_CANCEL check.
  // Basic auth here — wo-authz layer enforces the correct permission.
  const auth = await requireAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const { id } = await params

    // Authenticate + authorize — cancelling a WO requires WO_CANCEL at its Site
    const result = await loadAuthorizedWorkOrder(req, id, 'WO_CANCEL')
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { wo, auth } = result

    const body = await req.json()
    const { reason } = body as {
      reason?: string
    }

    if (!reason || !String(reason).trim()) {
      return NextResponse.json(
        { error: 'ต้องระบุเหตุผลในการยกเลิก' },
        { status: 400 },
      )
    }

    if (wo.status === 'COMPLETED') {
      return NextResponse.json(
        { error: 'ใบงานนี้ปิดไปแล้ว ไม่สามารถยกเลิกได้' },
        { status: 400 },
      )
    }
    if (wo.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'ใบงานนี้ถูกยกเลิกไปแล้ว' },
        { status: 400 },
      )
    }

    // Use the authenticated user's email as the actor — never trust
    // a body-supplied `actor` field, which could be spoofed.
    const actorName = auth.user.email
    const reasonStr = String(reason).trim()
    const now = new Date()

    const updated = await db.workOrder.update({
      where: { id: wo.id },
      data: {
        status: 'CANCELLED',
        canceledAt: now,
        cancelReason: reasonStr,
      },
    })

    await db.workOrderMessage.create({
      data: {
        workOrderId: wo.id,
        message: `ยกเลิกใบงาน — ${reasonStr}`,
        author: actorName,
        authorRole: 'admin',
      },
    })

    await logAudit(
      'WO_CANCEL',
      wo.id,
      `ยกเลิก ${updated.woNumber ?? wo.id}`,
      { reason: reasonStr },
      actorName,
      result.woSite,
    )

    // ── GAP-H06: Cascade cancel to pending stock requests (single source of truth) ──
    try {
      const { released } = await releaseStockReservation({
        workOrderId: wo.id,
        reason: `ใบงาน ${updated.woNumber ?? wo.id} ถูกยกเลิก: ${reasonStr}`,
      })
      if (released > 0) {
        console.log(`[wo-cancel] Released ${released} stock reservations for WO ${wo.id}`)
      }
    } catch (e) {
      console.error('[wo-cancel] Stock cascade cancel failed:', e)
    }

    // ── Notification trigger (Task ID: NOTIFY-LINE) ──
    // Send 'wo_cancelled' to reporter (LINE if lineUserId is known).
    try {
      await notifyWorkOrderCancelled(
        {
          id: updated.id,
          woNumber: updated.woNumber,
          cancelReason: updated.cancelReason,
          lineUserId: updated.lineUserId,
        },
        { channels: ['line-oa', 'telegram'], actor: actorName },
      )
    } catch (e) {
      console.error('[notifications] wo_cancelled trigger failed:', e)
    }

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('POST /api/work-orders/[id]/cancel', err)
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to cancel work order') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
