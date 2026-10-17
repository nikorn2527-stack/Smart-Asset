/**
 * GET /api/push/vapid-key
 * Returns the public VAPID key for the browser to subscribe.
 */

import { NextResponse } from 'next/server'
import { getPublicKey } from '@/lib/push-notifications'

export async function GET() {
  try {
    const publicKey = getPublicKey()
    return NextResponse.json({ publicKey })
  } catch (err) {
    console.error('GET /api/push/vapid-key', err)
    return NextResponse.json({ error: 'VAPID not configured' }, { status: 500 })
  }
}
