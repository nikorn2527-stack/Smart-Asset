import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import {
  verifyPassword,
  createToken,
  createRefreshToken,
  toAuthUser,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginRateLimit,
  RATE_LIMIT_MAX_ATTEMPTS,
} from '@/lib/auth'

interface LoginBody {
  username?: string
  email?: string
  password?: string
}

function clientKey(req: NextRequest, login: string): string {
  // Combine login + IP so a single IP can't lock out every account, and a
  // single account can't be attacked from many IPs without each IP hitting
  // its own bucket.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  return `${login}@${ip}`
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as LoginBody
    const loginRaw = (body.username || body.email || '').trim().toLowerCase()
    const password = body.password || ''

    if (!loginRaw || !password) {
      return NextResponse.json(
        { error: 'กรุณาระบุชื่อผู้ใช้และรหัสผ่าน' },
        { status: 400 },
      )
    }

    // ── Rate limit check ───────────────────────────────────────────
    const key = clientKey(req, loginRaw)
    const rl = checkLoginRateLimit(key)
    if (!rl.allowed) {
      const minutes = Math.ceil(rl.retryAfterMs / 60_000)
      return NextResponse.json(
        {
          error: `พยายามเข้าระบบผิดเกิน ${RATE_LIMIT_MAX_ATTEMPTS} ครั้ง กรุณารอ ${minutes} นาทีแล้วลองใหม่`,
          locked: true,
          retryAfterMs: rl.retryAfterMs,
        },
        { status: 429 },
      )
    }

    // ── Find user by username OR email ─────────────────────────────
    const row = await db.user.findFirst({
      where: {
        OR: [{ username: loginRaw }, { email: loginRaw }],
      },
    })
    if (!row || !row.active || !row.passwordHash || !row.passwordSalt) {
      recordLoginFailure(key)
      return NextResponse.json(
        { error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" },
        { status: 401 },
      )
    }

    // ── Verify password (PBKDF2-like SHA-256, GAS-compatible) ─────
    const ok = verifyPassword(password, row.passwordHash, row.passwordSalt)
    if (!ok) {
      const r = recordLoginFailure(key)
      if (r.locked) {
        return NextResponse.json(
          {
            error: `พยายามเข้าระบบผิดเกิน ${RATE_LIMIT_MAX_ATTEMPTS} ครั้ง กรุณารอ 5 นาทีแล้วลองใหม่`,
            locked: true,
            retryAfterMs: r.retryAfterMs,
          },
          { status: 429 },
        )
      }
      return NextResponse.json(
        { error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" },
        { status: 401 },
      )
    }

    // ── Success: clear rate-limit, update LastLoginAt, issue JWT ──
    clearLoginRateLimit(key)
    try {
      await db.user.update({
        where: { id: row.id },
        data: { lastLoginAt: new Date().toISOString() },
      })
    } catch (e) {
      // Non-fatal — don't block login if lastLoginAt update fails
      console.error('login: failed to update lastLoginAt', e)
    }

    const token = await createToken({
      email: row.email,
      role: row.role,
      name: row.name,
      username: row.username,
      allowedSites: row.allowedSites,
    })
    // SPRINT-2 #2: also issue a refresh token so the client can get a new
    // access token without re-entering password (POST /api/auth/refresh).
    const refreshToken = await createRefreshToken({
      email: row.email,
      role: row.role,
      name: row.name,
      username: row.username,
      allowedSites: row.allowedSites,
    })
    const user = toAuthUser(row)

    // Audit log (best-effort) — wrapped in try/catch so login doesn't
    // fail if AuditLog table has schema issues.
    try {
      await logAudit(
        'LOGIN',
        'User',
        row.id,
        `เข้าสู่ระบบ — ${row.email}`,
        { method: 'password', username: row.username },
        row.email,
      )
    } catch (e) {
      console.error('login: audit log failed (non-fatal)', e)
    }

    return NextResponse.json({ token, refreshToken, user })
  } catch (err) {
    console.error('POST /api/itam/auth/login', err)
    const isDev = process.env.NODE_ENV !== 'production'
    const errMsg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      {
        error: 'Internal server error',
        detail: isDev ? errMsg : 'Internal server error',
        // Include stack in dev for easier debugging
        ...(isDev && err instanceof Error ? { stack: err.stack?.split('\n').slice(0, 5).join('\n') } : {}),
      },
      { status: 500 },
    )
  }
}
