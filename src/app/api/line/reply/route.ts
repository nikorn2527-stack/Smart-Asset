import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendLINE } from '@/lib/notifications'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * POST /api/line/reply
 *
 * Send a reply message to a LINE user from inside the staff/admin app
 * (e.g. when a technician types a message in the WO detail view).
 *
 * Requires authentication (VIEW_WORK_ORDERS or higher permission).
 *
 * This uses the LINE Push API (since we don't have a replyToken here),
 * so it requires the LINE user to have added the bot as a friend.
 *
 * Body:
 *   {
 *     lineUserId: string,         // LINE user ID to push to
 *     message:    string,         // message text
 *     woNumber?:  string,         // optional WO number (for context + audit)
 *     author?:    string,         // display name (defaults to authenticated user)
 *   }
 *
 * Side effects:
 *   1. Sends a LINE Push message to {lineUserId}.
 *   2. Saves the message as a WorkOrderMessage (linked via WO number).
 *   3. Audit log entry (NOTIFY_LINE_REPLY) with the authenticated actor.
 */

async function logAuditLineReply(
  entityId: string | null,
  summary: string,
  detail: Record<string, unknown>,
  actor: string,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action: 'NOTIFY_LINE_REPLY',
        entity: 'WorkOrder',
        entityId,
        summary,
        detail: JSON.stringify(detail),
        actor,
      },
    })
  } catch (err) {
    console.error('[line/reply] audit log failed:', err)
  }
}

export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('notifications')
  if (unavailable) return unavailable


  try {
    // ── Auth: reject unauthenticated callers ──
    const auth = await requireAuth(req, 'WO_VIEW_OWN')
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    const actorName = auth.user.username || auth.user.email || 'staff'

    const body = await req.json()
    const {
      lineUserId,
      message,
      woNumber,
      author,
    } = body as Record<string, unknown>

    if (typeof lineUserId !== 'string' || !lineUserId.trim()) {
      return NextResponse.json(
        { error: 'ต้องระบุ lineUserId' },
        { status: 400 },
      )
    }
    if (typeof message !== 'string' || !message.trim()) {
      return NextResponse.json(
        { error: 'ต้องระบุ message' },
        { status: 400 },
      )
    }

    const authorName =
      typeof author === 'string' && author.trim() ? author.trim() : actorName
    const woNum =
      typeof woNumber === 'string' ? woNumber.trim() : null

    // Build the LINE message — include the WO number header if available
    const lineMessage = woNum
      ? `💬 ข้อความใหม่ในใบงาน ${woNum}\nจาก: ${authorName}\nข้อความ: ${message.trim()}`
      : `💬 ข้อความจากเจ้าหน้าที่\n${message.trim()}`

    // 1. Push to LINE (best-effort — logs if no token configured)
    await sendLINE(lineMessage, lineUserId)

    // 2. Save the message on the WO (if we can find it)
    let savedMsg: { id: string } | null = null
    if (woNum) {
      const wo = await db.workOrder.findUnique({
        where: { woNumber: woNum },
        select: { id: true, status: true },
      })
      if (wo) {
        if (wo.status === 'CANCELLED' || wo.status === 'COMPLETED') {
          return NextResponse.json(
            { error: 'ใบงานนี้ปิด/ยกเลิกแล้ว ไม่สามารถส่งข้อความได้' },
            { status: 400 },
          )
        }
        savedMsg = await db.workOrderMessage.create({
          data: {
            workOrderId: wo.id,
            message: message.trim(),
            author: authorName,
            authorRole: 'staff',
          },
          select: { id: true },
        })
      }
    }

    // 3. Audit log (with the actor who triggered the reply)
    await logAuditLineReply(
      savedMsg?.id ?? null,
      `ส่งข้อความ LINE ไปยัง ${lineUserId}${woNum ? ` (ใบงาน ${woNum})` : ''}`,
      {
        lineUserId,
        message: message.trim(),
        woNumber: woNum,
        messageId: savedMsg?.id ?? null,
        author: authorName,
      },
      actorName,
    )

    return NextResponse.json({
      ok: true,
      messageId: savedMsg?.id ?? null,
    })
  } catch (err) {
    console.error('POST /api/line/reply', err)
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to send LINE reply') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

