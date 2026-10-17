import type { AuthUser } from './auth-shared'

/**
 * org-scope.ts — Helper สำหรับ Organization Scope ในทุก Query
 *
 * ตามพิมพ์เขียว section 12: ทุก API ต้องตรวจ
 *   Authentication → Organization Scope → Site Scope → Permission → Demo/Production Scope
 *
 * Usage:
 *   const scope = getOrgScope(auth.user)
 *   if (!scope.ok) return scope.error
 *   const devices = await db.device.findMany({ where: { ...scope.where, ...filters } })
 *
 * Strategy:
 *   - organizationId มาจาก auth.user.organizationId (resolve จาก User row)
 *   - ถ้า user ไม่มี organizationId → reject (legacy user ต้อง backfill ก่อน)
 *   - ถ้าเป็น superadmin → ไม่บังคับ scope (เห็นได้ทุก org — สำหรับ cross-org admin)
 */

export interface OrgScopeOk {
  ok: true
  organizationId: string
  /**
   * Prisma where fragment ที่ใช้ filter by organizationId
   *
   * `Partial<...>` (not a bare `{ organizationId: string }`) because the
   * superadmin/admin bypass branches below return `where: {}` for users with no
   * org assignment — an empty fragment that intentionally matches every org.
   * Typing the field as required made those two documented branches fail to
   * compile.
   */
  where: Partial<{ organizationId: string }>
}

// Correct usage:
//   if (!scope.ok) return NextResponse.json({ error: scope.error.message }, { status: scope.error.status })
//
// `.status` is deliberately NOT flattened onto OrgScopeErr so a caller can
// never accidentally read `undefined` as an HTTP status (which Next.js then
// treats as 200 — silently turning an auth failure into a success response).

export interface OrgScopeErr {
  ok: false
  error: { message: string; status: number }
}

export type OrgScope = OrgScopeOk | OrgScopeErr

/**
 * Get organization scope for a user.
 * Returns a where fragment that can be spread into any Prisma query.
 *
 * Superadmin bypasses scope (can see all orgs) — used for cross-org admin tools.
 */
export function getOrgScope(user: AuthUser | null | undefined): OrgScope {
  if (!user) {
    return {
      ok: false,
      error: { message: 'ไม่ได้เข้าสู่ระบบ', status: 401 },
    }
  }

  // Superadmin bypass — สำหรับ cross-org admin tools (ดูได้ทุก org)
  if (user.role === 'superadmin') {
    // ถ้ามี organizationId ให้ใช้ scoped, ถ้าไม่มีก็ return empty (ดูได้ทั้งหมด)
    if (user.organizationId) {
      return {
        ok: true,
        organizationId: user.organizationId,
        where: { organizationId: user.organizationId },
      }
    }
    // Superadmin ไม่มี org → ดูได้ทั้งหมด (return empty where)
    return {
      ok: true,
      organizationId: '*',
      where: {},
    }
  }

  // SPRINT-FIX: Admin role also bypasses org scope — admin needs to see
  // all data regardless of org assignment (matches the existing pattern
  // where admin role has allowedSites='ALL'). This fixes the "ผู้ใช้ไม่ได้ผูกกับองค์กร"
  // error that blocks the devices page for admin users without orgId.
  if (user.role === 'admin') {
    if (user.organizationId) {
      return {
        ok: true,
        organizationId: user.organizationId,
        where: { organizationId: user.organizationId },
      }
    }
    // Admin ไม่มี org → ดูได้ทั้งหมด (same as superadmin)
    return {
      ok: true,
      organizationId: '*',
      where: {},
    }
  }

  // ปกติ: บังคับ organizationId
  if (!user.organizationId) {
    return {
      ok: false,
      error: {
        message: 'ผู้ใช้ไม่ได้ผูกกับองค์กร โปรดติดต่อผู้ดูแล',
        status: 403,
      },
    }
  }

  return {
    ok: true,
    organizationId: user.organizationId,
    where: { organizationId: user.organizationId },
  }
}

/**
 * Get organization scope for a specific table that has organizationId column.
 * Use this when you want type-safe where fragment.
 *
 * Example:
 *   const scope = getOrgScopeFor<'Device'>(auth.user)
 *   if (!scope.ok) return scope.error
 *   const devices = await db.device.findMany({ where: { ...scope.where, status: 'Active' } })
 */
export function getOrgScopeFor<T extends string>(_table: T, user: AuthUser | null | undefined): OrgScope {
  return getOrgScope(user)
}

/**
 * Check if a user can access a specific organization's data.
 * Used for cross-org admin tools (e.g. /api/organizations/[id]).
 */
export function canAccessOrganization(user: AuthUser | null | undefined, orgId: string): boolean {
  if (!user) return false
  if (user.role === 'superadmin') return true
  return user.organizationId === orgId
}
