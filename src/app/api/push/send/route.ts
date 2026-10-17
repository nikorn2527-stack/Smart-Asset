/**
 * POST /api/push/send
 * Body: { userId?: string, broadcast?: boolean, title, body, url? }
 * Sends a push notification to a specific user or broadcast.
 * Requires ADMIN permission (to prevent abuse).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { sendPushNotification, broadcastPushNotification } from '@/lib/push-notifications'

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await req.json()
    const { userId, broadcast, title, body: messageBody, url } = body

    if (!title || !messageBody) {
      return NextResponse.json({ error: 'title and body are required' }, { status: 400 })
    }

    const payload = { title, body: messageBody, url }

    if (broadcast) {
      const result = await broadcastPushNotification(payload)
      return NextResponse.json(result)
    } else if (userId) {
      const result = await sendPushNotification(userId, payload)
      return NextResponse.json(result)
    } else {
      return NextResponse.json(
        { error: 'Either userId or broadcast=true is required' },
        { status: 400 },
      )
    }
  } catch (err) {
    console.error('POST /api/push/send', err)
    return NextResponse.json({ error: 'Failed to send push' }, { status: 500 })
  }
}
