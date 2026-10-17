/**
 * POST /api/push/unsubscribe
 * Body: { endpoint: string }
 * Removes the subscription.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { unsubscribeUser } from '@/lib/push-notifications'

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await req.json()
    const endpoint = body.endpoint

    if (!endpoint || typeof endpoint !== 'string') {
      return NextResponse.json({ error: 'endpoint is required' }, { status: 400 })
    }

    await unsubscribeUser(endpoint)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('POST /api/push/unsubscribe', err)
    return NextResponse.json({ error: 'Failed to unsubscribe' }, { status: 500 })
  }
}
