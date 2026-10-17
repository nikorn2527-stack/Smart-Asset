// ============================================================
// Auth session helpers — now using SIGNED JWT (HMAC-SHA256)
// ============================================================
// SECURITY (P0-2 fix):
//   Previously this module used plain Base64 encoding for session tokens,
//   which allowed attackers to forge a valid session if they knew (or
//   guessed) a user's id. Now we use signed JWTs (HS256) via `jose`,
//   signed with the same `JWT_SECRET` env var used by src/lib/auth.ts.
//
// Migration strategy (backward-compatible):
//   - `decodeSession` accepts BOTH formats:
//     • New format: signed JWT (eyJ... three base64 segments separated by dots)
//     • Legacy format: plain Base64 JSON (no dots, or only 1 segment after split)
//   - Legacy tokens are still accepted (so existing sessions don't break),
//     but they are logged with a deprecation warning to track migration.
//   - All new sessions created via `encodeSession` are signed JWTs.
//   - Once all legacy sessions have expired (7-day TTL), legacy support
//     can be removed.
// ============================================================

import type { NextRequest } from 'next/server'
import { SignJWT, jwtVerify } from 'jose'
import { db } from '@/lib/db'
import { toAuthUser, type AuthUser } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

export const AUTH_COOKIE = 'itam-session'
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

interface SessionPayload {
  userId: string
  email: string
  exp: number
}

// ─── JWT secret (shared with src/lib/auth.ts) ────────────────────────
// Falls back to dev-only secret in development. Production must set
// JWT_SECRET (the requireAuth helper already enforces this).
function getJwtSecret(): Uint8Array {
  const raw =
    process.env.JWT_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    ''
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'JWT_SECRET is required for signed sessions in production.',
      )
    }
    console.warn(
      'WARNING: Using fallback dev JWT secret for session signing. Set JWT_SECRET in production.',
    )
    return new TextEncoder().encode(
      'itam-dev-secret-change-me-in-production-please-32bytes',
    )
  }
  return new TextEncoder().encode(raw)
}

// ─── Encode (sign) — produces a signed JWT ───────────────────────────
export async function encodeSession(
  payload: SessionPayload,
): Promise<string> {
  const secret = getJwtSecret()
  // jose's SignJWT uses `exp` claim in seconds (not ms).
  // We embed userId + email as custom claims.
  return new SignJWT({
    userId: payload.userId,
    email: payload.email,
    sid: 'legacy-session', // identifies this as a session token (vs API JWT)
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Date.now() / 1000)
    .setExpirationTime(payload.exp / 1000)
    .sign(secret)
}

// ─── Decode (verify) — accepts signed JWT or legacy Base64 ─────────
export async function decodeSession(
  token: string,
): Promise<SessionPayload | null> {
  if (!token || typeof token !== 'string') return null

  // Heuristic: a JWT has exactly 2 dots (header.payload.signature).
  // Legacy Base64 has no dots (or fewer than 2).
  const dotCount = (token.match(/\./g) || []).length
  if (dotCount === 2) {
    // ── New format: signed JWT ──
    try {
      const secret = getJwtSecret()
      const { payload } = await jwtVerify(token, secret, {
        algorithms: ['HS256'],
      })
      if (
        typeof payload.userId !== 'string' ||
        typeof payload.email !== 'string'
      ) {
        return null
      }
      // jwtVerify already checks exp — convert seconds to ms for our interface.
      const expMs =
        typeof payload.exp === 'number' ? payload.exp * 1000 : 0
      if (expMs < Date.now()) return null
      return {
        userId: payload.userId,
        email: payload.email,
        exp: expMs,
      }
    } catch {
      return null
    }
  }

  // ── Legacy format: plain Base64 JSON (deprecated) ──
  // SECURITY: In production, we NO LONGER accept legacy Base64 sessions
  // — they are forgeable. Users with old cookies will be logged out and
  // must log in again to get a fresh signed JWT.
  //
  // In development (non-production), we still accept legacy tokens so
  // existing dev sessions don't break during testing.
  if (process.env.NODE_ENV === 'production') {
    // Reject legacy Base64 tokens in production — forces re-login.
    return null
  }

  try {
    const json = Buffer.from(token, 'base64').toString('utf8')
    const parsed = JSON.parse(json) as SessionPayload
    if (
      typeof parsed.userId !== 'string' ||
      typeof parsed.email !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return null
    }
    if (parsed.exp < Date.now()) return null
    console.warn(
      '[auth-session] DEPRECATED: accepting legacy Base64 session for user',
      parsed.email,
      '— should be migrated to signed JWT',
    )
    return parsed
  } catch {
    return null
  }
}

export function parseCookie(header: string, name: string): string | null {
  const parts = header.split(';')
  for (const p of parts) {
    const [k, ...rest] = p.trim().split('=')
    if (k === name) {
      return decodeURIComponent(rest.join('='))
    }
  }
  return null
}

/** อ่าน user จาก token ใน cookie — คืน null ถ้าไม่มี/หมดอายุ/ไม่ active */
export async function getCurrentUser(
  req: NextRequest,
): Promise<AuthUser | null> {
  const cookieHeader = req.headers.get('cookie') ?? ''
  const token = parseCookie(cookieHeader, AUTH_COOKIE)
  if (!token) return null
  const session = await decodeSession(token)
  if (!session) return null
  const user = await db.user.findUnique({ where: { id: session.userId } })
  if (!user || !user.active) return null
  return toAuthUser(user)
}

/** Lazily seed a default admin if no users exist (idempotent). */
export async function ensureSeedUsers() {
  const count = await db.user.count()
  if (count > 0) return
  await db.user.createMany({
    data: [
      {
        email: 'admin@example.com',
        name: 'ผู้ดูแลระบบ',
        role: 'admin',
        active: true,
        allowedSites: 'ALL',
        permissions: JSON.stringify(['*']),
      },
      {
        email: 'manager@example.com',
        name: 'ผู้จัดการ',
        role: 'manager',
        active: true,
        allowedSites: 'ALL',
      },
      {
        email: 'staff@example.com',
        name: 'ช่างเทคนิค',
        role: 'staff',
        active: true,
        allowedSites: 'ALL',
      },
      {
        email: 'coordinator@example.com',
        name: 'ผู้ประสานงาน',
        role: 'coordinator',
        active: true,
        allowedSites: 'ALL',
      },
      {
        email: 'viewer@example.com',
        name: 'ผู้ดู',
        role: 'viewer',
        active: true,
        allowedSites: 'ALL',
      },
    ],
  })
  await logAudit(
    'SEED',
    'User',
    null,
    'เพิ่มผู้ใช้ตัวอย่าง 5 รายการ (admin/manager/staff/coordinator/viewer)',
    { count: 5 },
  )
}

export type { SessionPayload }
