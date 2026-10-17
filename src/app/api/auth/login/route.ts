// ============================================================
// POST /api/auth/login (legacy compat endpoint)
// ============================================================
// Body: { email, password }
// Returns: { user, token }
// - Verifies password against stored hash using verifyPassword()
// - sets HttpOnly cookie `itam-session`
// - This is the legacy endpoint; new code should use /api/itam/auth/login
//   (which uses JWT and supports username OR email).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toAuthUser } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'
import { verifyPassword, checkLoginRateLimit, recordLoginFailure, clearLoginRateLimit, RATE_LIMIT_MAX_ATTEMPTS, RATE_LIMIT_LOCKOUT_MS } from '@/lib/auth'
import {
  AUTH_COOKIE,
  SESSION_TTL_MS,
  encodeSession,
  ensureSeedUsers,
} from '@/lib/auth-session'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  try {
    await ensureSeedUsers()
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    const email =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: 'รูปแบบอีเมลไม่ถูกต้อง' },
        { status: 400 },
      )
    }
    const password = typeof body.password === 'string' ? body.password : ''
    if (!password) {
      return NextResponse.json(
        { error: 'กรุณาระบุรหัสผ่าน' },
        { status: 400 },
      )
    }

    // SPRINT-2 #3: rate limit on legacy /api/auth/login (the main
    // /api/itam/auth/login already had this; this endpoint was unprotected).
    // Use the email as the rate-limit key (combined with IP below for
    // defense in depth — see AuditSecurity note).
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
    const rlKey = `login:${email}:${ip}`
    const rl = checkLoginRateLimit(rlKey)
    if (!rl.allowed) {
      const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000)
      return NextResponse.json(
        {
          error: `คุณพยายามเข้าสู่ระบบผิดพลาดเกิน ${RATE_LIMIT_MAX_ATTEMPTS} ครั้ง กรุณารอ ${retryAfterSec} วินาทีแล้วลองใหม่`,
          retryAfter: retryAfterSec,
        },
        { status: 429 },
      )
    }

    const user = await db.user.findUnique({ where: { email } })
    if (!user) {
      recordLoginFailure(rlKey)
      return NextResponse.json(
        { error: 'ไม่พบผู้ใช้งานนี้ในระบบ' },
        { status: 404 },
      )
    }
    if (!user.active) {
      return NextResponse.json(
        { error: 'บัญชีนี้ถูกปิดใช้งาน' },
        { status: 403 },
      )
    }

    // Verify password against stored hash
    const ok = verifyPassword(password, user.passwordHash, user.passwordSalt)
    if (!ok) {
      const r = recordLoginFailure(rlKey)
      if (r.locked) {
        const retryAfterSec = Math.ceil(r.retryAfterMs / 1000)
        return NextResponse.json(
          {
            error: `รหัสผ่านไม่ถูกต้อง — บัญชีถูกล็อก ${retryAfterSec} วินาที เนื่องจากพยายามเกิน ${RATE_LIMIT_MAX_ATTEMPTS} ครั้ง`,
            retryAfter: retryAfterSec,
          },
          { status: 429 },
        )
      }
      return NextResponse.json(
        { error: 'รหัสผ่านไม่ถูกต้อง' },
        { status: 401 },
      )
    }
    clearLoginRateLimit(rlKey)

    const now = Date.now()
    const token = await encodeSession({
      userId: user.id,
      email: user.email,
      exp: now + SESSION_TTL_MS,
    })

    // update lastLoginAt
    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date().toISOString() },
    })

    const authUser = toAuthUser(user)
    await logAudit(
      'LOGIN',
      'User',
      user.id,
      `เข้าสู่ระบบ: ${user.email}`,
      { email: user.email, role: user.role },
    )

    const res = NextResponse.json({ user: authUser, token })
    res.cookies.set(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
      // Secure cookies only over HTTPS (production). In dev (http://localhost)
      // browsers reject Secure cookies, so we set it conditionally.
      secure: process.env.NODE_ENV === 'production',
    })
    return res
  } catch (err) {
    console.error('POST /api/auth/login', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Login failed') : 'Internal server error' },
      { status: 500 },
    )
  }
}
