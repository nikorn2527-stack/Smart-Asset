/**
 * Auth middleware for /api/v1/* routes.
 *
 * Wraps the existing requireAuth helper but returns v1-standard error responses
 * and extracts the authenticated user + permission check in one call.
 */

import type { NextRequest } from 'next/server'
import { requireAuth as requireAuthLegacy } from '@/lib/auth-middleware'
// `requireApiAuth` returns requireAuthLegacy's `result.row`, which is the
// internal UserPermissionRow (stable `id` + raw DB columns), NOT the sanitized
// client-facing AuthUser. Type it as such so callers can rely on `id`.
import type { UserPermissionRow } from '@/lib/auth'
import { unauthorized, forbidden } from './response'

export type Permission =
  | 'VIEW_DASHBOARD'
  | 'VIEW_DEVICES'
  | 'VIEW_ANALYTICS'
  | 'METER_WRITE'
  | 'DEVICE_EDIT'
  | 'DEVICE_DELETE'
  | 'DEVICE_TRANSFER'
  | 'LIFECYCLE_EDIT'
  | 'MASTER_DATA_EDIT'
  | 'EXPORT_PRINT'
  | 'PRINT'
  | 'ADMIN'
  | 'USER_MANAGE'
  | 'SYSTEM_CONFIG'

export interface AuthContext {
  /** Internal UserPermissionRow (requireAuthLegacy's `result.row`). */
  user: UserPermissionRow
  /** The user's allowed sites ('ALL' or comma-separated site names) */
  allowedSites: string[] | 'ALL'
}

/**
 * Require authentication + (optional) permission for a v1 route.
 * Returns { ok: true, ctx } on success, or { ok: false, response } on failure.
 *
 * Usage:
 *   const auth = await requireApiAuth(req, 'DEVICE_EDIT')
 *   if (!auth.ok) return auth.response
 *   const user = auth.ctx.user
 */
export async function requireApiAuth(
  req: NextRequest,
  permission?: Permission,
): Promise<
  | { ok: true; ctx: AuthContext }
  | { ok: false; response: import('next/server').NextResponse }
> {
  const result = await requireAuthLegacy(req, permission)
  if (!result.ok) {
    // 401 vs 403: requireAuth returns 401 for missing token, 403 for insufficient perm
    if (result.status === 401) {
      return { ok: false, response: unauthorized(result.error) }
    }
    return { ok: false, response: forbidden(result.error) }
  }
  const user = result.row
  const allowedSites = user.allowedSites === 'ALL' || !user.allowedSites
    ? 'ALL'
    : user.allowedSites.split(',').map((s) => s.trim()).filter(Boolean)
  return { ok: true, ctx: { user, allowedSites } }
}
