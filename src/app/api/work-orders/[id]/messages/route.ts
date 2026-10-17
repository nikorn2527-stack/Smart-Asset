import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { notifyWorkOrderMessage } from '@/lib/notifications'
import { loadAuthorizedWorkOrder } from '@/lib/wo-authz'
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

    // Authenticate + authorize — viewing messages requires WO_VIEW_ALL
    // (allowOwn so a reporter can see their own WO's chat)
    const result = await loadAuthorizedWorkOrder(req, id, 'WO_VIEW_ALL', {
      allowOwn: true,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const messages = await db.workOrderMessage.findMany({
      where: { workOrderId: result.wo.id },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ data: messages })
  } catch (err) {
    console.error('GET /api/work-orders/[id]/messages', err)
    return NextResponse.json(
      { error: 'Failed to fetch messages' },
      { status: 500 },
    )
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  // Auth: loadAuthorizedWorkOrder does the site-scoped WO_VIEW_ALL check.
  // Basic auth here — wo-authz layer enforces the correct permission.
  const auth = await requireAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const { id } = await params

    // Authenticate + authorize — posting a message requires the same
    // view permission (anyone who can view the WO can chat on it).
    const result = await loadAuthorizedWorkOrder(req, id, 'WO_VIEW_ALL', {
      allowOwn: true,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { wo, auth } = result

    const body = await req.json()
    const { message, authorRole } = body as {
      message?: string
      authorRole?: string | null
    }

    if (!message || !String(message).trim()) {
      return NextResponse.json(
        { error: 'ต้องระบุข้อความ' },
        { status: 400 },
      )
    }

    if (wo.status === 'CANCELLED' || wo.status === 'COMPLETED') {
      return NextResponse.json(
        { error: 'ใบงานนี้ปิด/ยกเลิกแล้ว ไม่สามารถส่งข้อความได้' },
        { status: 400 },
      )
    }

    // Author identity comes from the authenticated session — never trust
    // a body-supplied `author`/`actor` field.
    const authorName = auth.user.email
    const role =
      typeof authorRole === 'string' && authorRole.trim()
        ? authorRole.trim()
        : 'staff'

    const created = await db.workOrderMessage.create({
      data: {
        workOrderId: wo.id,
        message: String(message).trim(),
        author: authorName,
        authorRole: role,
      },
    })

    await logAudit(
      'WO_MESSAGE',
      wo.id,
      `เพิ่มข้อความใน ${wo.woNumber ?? wo.id}`,
      { message: String(message).trim(), author: authorName },
      authorName,
      result.woSite,
    )

    // ── Notification trigger (Task ID: NOTIFY-LINE) ──
    // Send 'wo_message' to the OTHER party (admin↔reporter).
    // If author is staff/admin → notify the reporter (LINE if lineUserId is known).
    // If author is reporter → notify staff (LINE admin group / Telegram).
    try {
      const woForNotify = await db.workOrder.findUnique({
        where: { id: wo.id },
        select: { lineUserId: true, reporterEmail: true },
      })
      const isFromReporter = role === 'reporter'
      await notifyWorkOrderMessage(
        {
          id: wo.id,
          woNumber: wo.woNumber,
          author: authorName,
          message: String(message).trim(),
        },
        {
          // When staff/admin replies → push to the reporter's LINE.
          // When reporter posts from the web → push to admin channels.
          channels: isFromReporter
            ? ['line-oa', 'telegram']
            : ['line-oa', 'telegram'],
          actor: authorName,
        },
      )
      // If a staff reply and we have a LINE user ID, also send the message
      // directly to the reporter's LINE chat (best-effort, logged if no token).
      if (
        !isFromReporter &&
        woForNotify?.lineUserId
      ) {
        const { sendLINE } = await import('@/lib/notifications')
        const lineMsg =
          `💬 ข้อความใหม่ในใบงาน ${wo.woNumber ?? ''}\n` +
          `จาก: ${authorName}\n` +
          `ข้อความ: ${String(message).trim()}`
        await sendLINE(lineMsg, woForNotify.lineUserId).catch(() => {})
      }
    } catch (e) {
      console.error('[notifications] wo_message trigger failed:', e)
    }

    return NextResponse.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/work-orders/[id]/messages', err)
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to post message') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
