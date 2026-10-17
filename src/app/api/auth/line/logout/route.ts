// ============================================================
// POST /api/auth/line/logout
// (Task ID: PUBLIC-QR-2B-LINE-LOGIN)
// ============================================================
// Clears the `line_session` cookie (the LINE identity for public reporters).
//
// NOTE: This is a SEPARATE cookie from `itam-session` (staff auth). Calling
// this route does NOT log out staff users — use /api/auth/logout for that.
//
// Returns 200 { ok: true } regardless of whether a session existed.
// ============================================================

import { NextResponse } from 'next/server'
import { clearLineSessionCookie } from '@/lib/line-session'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const res = NextResponse.json({ ok: true })
    clearLineSessionCookie(res)
    return res
  } catch (err) {
    console.error('POST /api/auth/line/logout', err)
    return NextResponse.json(
      { error: 'LINE logout ล้มเหลว — กรุณาลองอีกครั้ง' },
      { status: 500 },
    )
  }
}
