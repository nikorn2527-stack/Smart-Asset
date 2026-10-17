/**
 * POST /api/auth/refresh
 *
 * SPRINT-2 #2: Exchange a refresh token for a new access token.
 *
 * Body: { refreshToken: string }
 * Returns: { token: string, expiresIn: number } on success
 *          401 if refresh token is missing/invalid/expired/blacklisted
 *
 * Security:
 *   - Refresh tokens have typ='refresh' and are rejected by verifyToken()
 *     (the normal API auth path), so they can't be used directly for API
 *     calls — only exchanged here.
 *   - The new access token is a regular typ='access' (default) token.
 *   - Refresh tokens ARE blacklisted on logout (same blacklist as access
 *     tokens), so logging out invalidates both.
 *   - We do NOT issue a new refresh token here (no rotation) — that would
 *     extend the session indefinitely. The original refresh token keeps
 *     its 7-day TTL; once it expires the user must log in again.
 *
 * Rate limiting: this endpoint is NOT rate-limited here (Sprint 2 #3
 * adds rate limiting on /api/auth/login; refresh is lower-risk because
 * it requires a valid refresh token). In production, add rate limiting
 * per-IP to prevent brute-force on stolen refresh tokens.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyRefreshToken, createToken } from '@/lib/auth'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as { refreshToken?: string } | null
    const refreshToken = body?.refreshToken
    if (!refreshToken || typeof refreshToken !== 'string') {
      return NextResponse.json(
        { error: 'กรุณาระบุ refreshToken' },
        { status: 400 },
      )
    }

    // Verify the refresh token (checks signature + expiry + blacklist + typ)
    const payload = await verifyRefreshToken(refreshToken)
    if (!payload) {
      return NextResponse.json(
        { error: 'Refresh token ไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่' },
        { status: 401 },
      )
    }

    // Re-load the user row so role/allowedSites changes made by an admin
    // are reflected in the new access token (matches requireAuth behavior).
    const userRow = await db.user.findFirst({
      where: { email: payload.email },
      select: {
        email: true,
        role: true,
        name: true,
        username: true,
        allowedSites: true,
        active: true,
      },
    })
    if (!userRow || !userRow.active) {
      return NextResponse.json(
        { error: 'บัญชีถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ' },
        { status: 403 },
      )
    }

    // Issue a new access token (typ='access' by default — no typ field set)
    const newAccessToken = await createToken({
      email: userRow.email,
      role: userRow.role,
      name: userRow.name,
      username: userRow.username,
      allowedSites: userRow.allowedSites,
    })

    return NextResponse.json({
      token: newAccessToken,
      expiresIn: 6 * 60 * 60, // 6 hours (matches TOKEN_TTL_SECONDS)
    })
  } catch (err) {
    console.error('POST /api/auth/refresh', err)
    return NextResponse.json(
      { error: 'Failed to refresh token' },
      { status: 500 },
    )
  }
}
