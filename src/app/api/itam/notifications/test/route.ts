import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { getNotifyChannels, sendNotification } from '@/lib/notifications'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * POST /api/itam/notifications/test
 *
 * Sends a test notification through all currently-enabled channels,
 * regardless of event config. Returns which channels were attempted.
 *
 * Body: { message?: string }
 *
 * Permission: SYSTEM_CONFIG
 */
export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('notifications')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req, 'SYSTEM_CONFIG')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row

    const body = await req.json().catch(() => ({}))
    const message = typeof body.message === 'string' && body.message.trim()
      ? body.message.trim()
      : 'ทดสอบการแจ้งเตือนจากระบบ ITAM — หากคุณได้รับข้อความนี้แสดงว่าช่องทางการแจ้งเตือนทำงานปกติ'

    const configured = await getNotifyChannels()
    const channels = [
      ...(configured.email ? (['email'] as const) : []),
      ...(configured.telegram ? (['telegram'] as const) : []),
      ...(configured.lineOA ? (['line-oa'] as const) : []),
    ]

    await sendNotification({
      template: 'custom',
      channels,
      data: {
        title: '🔔 ทดสอบการแจ้งเตือน',
        message: `${message}\n\nส่งโดย: ${user.email}`,
        test: true,
        by: user.email,
        sentAt: new Date().toISOString(),
      },
      actor: user.email,
      entity: 'NotificationTest',
    })

    return NextResponse.json({ ok: true, sentAt: new Date().toISOString(), by: user.email })
  } catch (err) {
    console.error('POST /api/itam/notifications/test', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
