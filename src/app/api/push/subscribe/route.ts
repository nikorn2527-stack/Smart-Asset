/**
 * POST /api/push/subscribe
 * Body: { subscription: PushSubscription }
 * Stores the subscription for the authenticated user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { subscribeUser } from '@/lib/push-notifications'

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await req.json()
    const subscription = body.subscription

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json(
        { error: 'Invalid subscription object' },
        { status: 400 },
      )
    }

    await subscribeUser(auth.row.id, subscription)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('POST /api/push/subscribe', err)
    return NextResponse.json(
      { error: 'Failed to subscribe' },
      { status: 500 },
    )
  }
}
