// ============================================================
// GET /api/auth/me (Task ID: RBAC-DASHBOARD)
// ============================================================
// Returns: { user }  — reads HttpOnly cookie `itam-session`
// 401 if not authenticated
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, ensureSeedUsers } from '@/lib/auth-session'

export async function GET(req: NextRequest) {
  try {
    await ensureSeedUsers()
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json(
        { error: 'Not authenticated', user: null },
        { status: 401 },
      )
    }
    return NextResponse.json({ user })
  } catch (err) {
    console.error('GET /api/auth/me', err)
    return NextResponse.json(
      { error: 'Failed to fetch session', user: null },
      { status: 500 },
    )
  }
}
