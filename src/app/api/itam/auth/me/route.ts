import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'

/** GET /api/itam/auth/me — returns the authenticated user's profile. */
export async function GET(req: Request) {
  const auth = await requireAuth(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  return NextResponse.json({ user: auth.user })
}
