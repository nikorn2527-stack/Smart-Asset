// ============================================================
// DELETE /api/auth/logout (Task ID: RBAC-DASHBOARD)
// ============================================================
// Clears the `itam-session` cookie
// ============================================================

import { NextResponse } from 'next/server'
import { AUTH_COOKIE } from '@/lib/auth-session'

export async function DELETE() {
  try {
    const res = NextResponse.json({ ok: true })
    res.cookies.set(AUTH_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
    return res
  } catch (err) {
    console.error('DELETE /api/auth/logout', err)
    return NextResponse.json(
      { error: 'Logout failed' },
      { status: 500 },
    )
  }
}
