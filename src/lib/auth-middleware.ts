/**
 * auth-middleware.ts — request-side helper used by every ITAM API route.
 *
 * Usage:
 *   import { requireAuth } from '@/lib/auth-middleware'
 *   export async function GET(req: Request) {
 *     const auth = await requireAuth(req, 'VIEW_DEVICES')
 *     if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
 *     const user = auth.user
 *     ...
 *   }
 *
 * The helper:
 *   1. Extracts the `Authorization: Bearer <jwt>` header.
 *   2. Verifies the JWT (signature + exp + blacklist).
 *   3. Loads the current user row from the DB (so role/allowedSites changes
 *      made by an admin are reflected without re-issuing the token).
 *   4. If `permission` is given, checks the user's MERGED permission list
 *      (role defaults + per-user custom grants stored in `User.permissions`).
 *   5. Returns `{ ok, user }` on success or `{ ok: false, status, error }`.
 */

import { db } from '@/lib/db'
import {
  verifyToken,
  toAuthUser,
  hasResolvedPermission,
  type AuthUser,
  type Permission,
  type UserPermissionRow,
} from '@/lib/auth'
import { isDemoUser } from '@/lib/demo-mode'

export type RequireAuthOk = { ok: true; user: AuthUser; row: UserPermissionRow; isDemo: boolean }
export type RequireAuthErr = { ok: false; status: number; error: string }
export type RequireAuthResult = RequireAuthOk | RequireAuthErr

function extractBearer(req: Request): string | null {
  // 1. Try Authorization header first
  const h = req.headers.get('authorization') || req.headers.get('Authorization')
  if (h) {
    const m = h.match(/^Bearer\s+(.+)$/i)
    if (m) return m[1].trim()
  }
  // 2. Fallback: try token from URL query param `t`
  //    This allows window.open() links (e.g. print buttons) to pass auth
  //    without needing to set custom headers on a GET request.
  try {
    const url = new URL(req.url)
    const t = url.searchParams.get('t')
    if (t && t.length > 10) return t
  } catch {
    // req.url might not be a full URL in some edge runtimes
  }
  return null
}

export async function requireAuth(
  req: Request,
  permission?: Permission,
): Promise<RequireAuthResult> {
  const token = extractBearer(req)
  if (!token) {
    return { ok: false, status: 401, error: 'กรุณาเข้าสู่ระบบ (missing token)' }
  }
  const payload = await verifyToken(token)
  if (!payload) {
    return { ok: false, status: 401, error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' }
  }
  // Reload user from DB so revocations/role changes take effect immediately
  const row = await db.user.findUnique({ where: { email: payload.email } })
  if (!row || !row.active) {
    return { ok: false, status: 401, error: 'บัญชีถูกปิดใช้งานหรือไม่พบในระบบ' }
  }
  const user = toAuthUser(row)
  // Permission check: against the user's MERGED permission list (role + custom)
  if (permission && !hasResolvedPermission(user.permissions, permission)) {
    return {
      ok: false,
      status: 403,
      error: `ไม่มีสิทธิ์ (${permission}) สำหรับบัญชีนี้`,
    }
  }
  return { ok: true, user, row, isDemo: isDemoUser(user) }
}
