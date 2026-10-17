/**
 * site-scope.ts — Site-based access scope helpers (Phase 0 transitional).
 *
 * Implements the dual-read pattern recommended in the Site-Based Access
 * Control Guidance for ITAM-NextJS.md §7 step 5:
 *   1. Read active UserSiteGrant rows for the user.
 *   2. If none exist, fall back to User.allowedSites (comma-separated string
 *      or 'ALL') and emit an audit warning so the migration is measurable.
 *
 * The returned scope is used to build Prisma `where` clauses:
 *
 *   const scope = await getSiteScope(auth.row.id)
 *   const where = scope.kind === 'all'
 *     ? { ...filters }
 *     : { ...filters, site: { in: scope.siteCodes } }
 *
 * Task ID: SITE-RBAC-PHASE-0
 */

import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'

export type SiteScope =
  | { kind: 'all'; siteCodes: string[] }
  | { kind: 'sites'; siteCodes: string[] }
  | { kind: 'none'; siteCodes: string[] }

/**
 * Normalize a raw site code: trim + uppercase.
 * Returns null for blank/invalid input.
 */
export function normalizeSiteCode(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = String(raw).trim().toUpperCase()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Parse the legacy `User.allowedSites` field into a normalized array.
 * - 'ALL' (case-insensitive) → null (means "all sites")
 * - 'UDH, NKP' → ['UDH', 'NKP']
 * - '' / null → [] (no sites)
 */
export function parseAllowedSites(raw: string | null | undefined): {
  isAll: boolean
  codes: string[]
} {
  if (!raw) return { isAll: false, codes: [] }
  const trimmed = String(raw).trim()
  if (trimmed.toUpperCase() === 'ALL') {
    return { isAll: true, codes: [] }
  }
  const codes = trimmed
    .split(',')
    .map((s) => normalizeSiteCode(s))
    .filter((s): s is string => s !== null)
  return { isAll: false, codes }
}

/**
 * Compute the effective site scope for a user.
 *
 * Reads UserSiteGrant first; falls back to User.allowedSites if no grants
 * exist (with an audit warning so the team can track migration progress).
 *
 * @param userId        The Prisma User.id
 * @param userRole      The user's global role (superadmin → all sites)
 * @param allowedSites  The legacy `User.allowedSites` string (for fallback)
 */
export async function getSiteScope(
  userId: string,
  userRole?: string | null,
  allowedSites?: string | null,
): Promise<SiteScope> {
  // superadmin always has access to all sites
  if (userRole && userRole.toLowerCase() === 'superadmin') {
    return { kind: 'all', siteCodes: [] }
  }

  // 1) Try UserSiteGrant (target design)
  const grants = await db.userSiteGrant.findMany({
    where: { userId, active: true },
    select: { siteCode: true },
  })
  if (grants.length > 0) {
    const codes = grants
      .map((g) => normalizeSiteCode(g.siteCode))
      .filter((c): c is string => c !== null)
    if (codes.length === 0) {
      return { kind: 'none', siteCodes: [] }
    }
    return { kind: 'sites', siteCodes: codes }
  }

  // 2) Fall back to legacy allowedSites
  const parsed = parseAllowedSites(allowedSites)
  if (parsed.isAll) {
    // Audit the fallback usage so we can track migration progress
    await logAudit(
      'AUTH_FALLBACK',
      'User',
      userId,
      `User ${userId} has no UserSiteGrant rows; fell back to allowedSites='ALL'. ` +
        `Add explicit grants to retire this fallback.`,
      { userId, allowedSites },
    ).catch(() => {
      // best-effort; don't fail the request
    })
    return { kind: 'all', siteCodes: [] }
  }
  if (parsed.codes.length > 0) {
    await logAudit(
      'AUTH_FALLBACK',
      'User',
      userId,
      `User ${userId} has no UserSiteGrant rows; fell back to allowedSites='${allowedSites}'. ` +
        `Add explicit grants to retire this fallback.`,
      { userId, allowedSites, codes: parsed.codes },
    ).catch(() => {
      // best-effort
    })
    return { kind: 'sites', siteCodes: parsed.codes }
  }

  // No grants and no allowedSites → no access
  return { kind: 'none', siteCodes: [] }
}

/**
 * Validate that a site code is in the user's scope.
 * Returns true if the user can access the site.
 */
export function canAccessSite(
  scope: SiteScope,
  siteCode: string | null | undefined,
): boolean {
  if (!siteCode) return false
  const normalized = normalizeSiteCode(siteCode)
  if (!normalized) return false
  if (scope.kind === 'all') return true
  return scope.siteCodes.includes(normalized)
}

/**
 * Build a Prisma `where` fragment for a `site` field based on the scope.
 * Returns `{}` for all-sites scope, or `{ site: { in: [...] } }` for scoped.
 */
export function siteWhereClause(
  scope: SiteScope,
  field: string = 'site',
): Record<string, unknown> {
  if (scope.kind === 'all') return {}
  if (scope.kind === 'none') return { [field]: { in: [] } } // matches nothing
  return { [field]: { in: scope.siteCodes } }
}

/**
 * Validate and normalize allowedSites input from the user-management API.
 * - Trims and uppercases each code
 * - Returns the canonical string form (comma-separated) or 'ALL'
 * - Does NOT validate against the Site master here; that's done by the caller
 */
export function normalizeAllowedSitesInput(raw: string | null | undefined): string {
  if (!raw) return ''
  const trimmed = String(raw).trim()
  if (trimmed.toUpperCase() === 'ALL') return 'ALL'
  const codes = trimmed
    .split(',')
    .map((s) => normalizeSiteCode(s))
    .filter((s): s is string => s !== null)
  return codes.join(',')
}
