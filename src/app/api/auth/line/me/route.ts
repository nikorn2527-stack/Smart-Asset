// ============================================================
// GET /api/auth/line/me
// (Task ID: PUBLIC-QR-2B-LINE-LOGIN)
// ============================================================
// Returns the current LINE public-reporter session (or 401 if no session).
//
// The `line_session` cookie is HTTP-only so client-side JS can't read it
// directly — public UI components (e.g. the QR repair form) call this
// endpoint to:
//   • Detect whether the visitor is already logged in via LINE.
//   • Show the user's LINE display name + avatar.
//   • Decide which repair tier to show (Tier 1 = LINE+phone, Tier 2 = LINE
//     only, Tier 3 = anonymous — must prompt for name+phone).
//
// Response 200:
//   { data: { userId, displayName, pictureUrl, scopePhone, expiresAt } }
//
// Response 401:
//   { error: 'Not authenticated', data: null }
//
// NOTE: This is a SEPARATE cookie from staff auth (/api/auth/me). This
// endpoint only inspects the `line_session` cookie — it does NOT touch the
// staff `itam-session` cookie, so you can be logged in as both a staff user
// (NextAuth-style) AND a public reporter (LINE) at the same time.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getLineSession } from '@/lib/line-session'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const session = await getLineSession(req)
    if (!session) {
      return NextResponse.json(
        { error: 'Not authenticated', data: null },
        { status: 401 },
      )
    }
    return NextResponse.json({
      data: {
        userId: session.userId,
        displayName: session.displayName,
        pictureUrl: session.pictureUrl ?? null,
        scopePhone: session.scopePhone ?? null,
        expiresAt: session.expiresAt,
      },
    })
  } catch (err) {
    console.error('GET /api/auth/line/me', err)
    return NextResponse.json(
      { error: 'Failed to read LINE session', data: null },
      { status: 500 },
    )
  }
}
