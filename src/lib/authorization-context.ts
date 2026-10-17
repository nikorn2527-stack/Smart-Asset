/**
 * authorization-context.ts — Phase 1 authorization foundation.
 *
 * Builds the AuthorizationContext for every protected request, following
 * the mandatory sequence recommended in the ITAM Shared Platform doc §5.1:
 *
 *   authenticate → load active grants → check permission → resolve requested
 *   site → build scoped query → check target resource → transaction → audit
 *
 * This module is the **single source of truth** for computing effective
 * permissions and Site scope. API routes should call `buildAuthorizationContext`
 * after `requireAuth` and use the returned `ctx` to:
 *   1. Check functional permissions (`ctx.can(perm)`)
 *   2. Build Prisma where clauses (`ctx.siteWhere()`)
 *   3. Validate that a target resource's Site is in scope (`ctx.canAccessSite()`)
 *
 * Task ID: PHASE1-AUTH-FOUNDATION
 */

import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import {
  type Permission,
  type Role,
  ROLE_PERMISSIONS,
  normalizeRole,
  getRolePermissions,
  getUserPermissions,
} from '@/lib/auth-shared'
import {
  normalizeSiteCode,
  parseAllowedSites,
} from '@/lib/site-scope'
import type { AuthUser } from '@/lib/auth-shared'

// ── Types ─────────────────────────────────────────────
export interface SiteGrant {
  siteCode: string
  roleCode: string
  permissions: Permission[]
  validFrom: Date | null
  validUntil: Date | null
}

export type SiteScope =
  | { kind: 'all'; siteCodes: string[] }
  | { kind: 'sites'; siteCodes: string[] }
  | { kind: 'none'; siteCodes: string[] }

export interface AuthorizationContext {
  userId: string
  email: string
  globalRole: Role
  isSuperAdmin: boolean
  /** Active Site grants (from UserSiteGrant). Empty if falling back to legacy. */
  grants: SiteGrant[]
  /** Effective Site scope computed from grants + legacy allowedSites. */
  siteScope: SiteScope
  /** Effective permissions = global role permissions ∪ per-site permissions.
   *  WARNING: This is a UNION across all Sites. For action decisions on a
   *  specific Site, use canAtSite() instead. This field is kept for
   *  backward compatibility with routes that have not yet migrated. */
  effectivePermissions: Permission[]
  /** True if scope was derived from legacy `allowedSites` (dual-read fallback). */
  usedLegacyFallback: boolean

  /**
   * Check if the user has a GLOBAL permission (not tied to a specific Site).
   * This should only be used for truly global actions like USER_MANAGE
   * (managing users is not Site-scoped in the current model).
   * For Site-scoped actions (DEVICE_EDIT, WO_VIEW_ALL, etc.), use canAtSite().
   */
  can: (perm: Permission) => boolean

  /**
   * Check if the user has a permission AT A SPECIFIC SITE.
   *
   * This is the PRIMARY authorization method for Site-scoped actions.
   * It checks the role at the target Site only — NOT the union of all Sites.
   *
   * Example:
   *   User has UDH=admin, NKP=viewer
   *   ctx.canAtSite('UDH', 'DEVICE_EDIT') → true (admin has DEVICE_EDIT)
   *   ctx.canAtSite('NKP', 'DEVICE_EDIT') → false (viewer does NOT have DEVICE_EDIT)
   *   ctx.can('DEVICE_EDIT') → true (union — but DON'T use this for action decisions)
   *
   * For superadmin: always returns true.
   * For out-of-scope Sites: always returns false.
   */
  canAtSite: (siteCode: string | null | undefined, perm: Permission) => boolean

  /** Check if the user can access a specific Site code (has any grant there). */
  canAccessSite: (siteCode: string | null | undefined) => boolean
  /** Build a Prisma `where` fragment for a `site` field based on scope. */
  siteWhere: (field?: string) => Record<string, unknown>
  /** Get the user's role at a specific Site (or global role if superadmin). */
  roleAtSite: (siteCode: string | null | undefined) => Role | null
  /** Get the permissions available at a specific Site (from that Site's role only). */
  permissionsAtSite: (siteCode: string | null | undefined) => Permission[]
}

// ── Permission catalog cache (in-process, refreshed on demand) ──
// In Phase 1, we cache the Role/Permission catalog in memory to avoid
// a DB hit on every request. The cache is invalidated when the catalog
// is modified through the admin API. For multi-instance deployments,
// a future phase should use a shared cache (Redis) or read on every
// request with a short TTL.
interface CatalogCache {
  rolePermissions: Map<string, Set<Permission>> // roleCode → set of permission codes
  permissions: Map<string, { resource: string; action: string }> // permissionCode → meta
  cachedAt: number
}
const CATALOG_TTL_MS = 5 * 60 * 1000 // 5 minutes
let _catalogCache: CatalogCache | null = null

async function loadCatalog(): Promise<CatalogCache> {
  if (_catalogCache && Date.now() - _catalogCache.cachedAt < CATALOG_TTL_MS) {
    return _catalogCache
  }
  const [rolePerms, perms] = await Promise.all([
    db.rolePermission.findMany({
      select: { roleCode: true, permissionCode: true },
    }),
    db.permission.findMany({
      select: { code: true, resource: true, action: true, active: true },
    }),
  ])
  const rolePermissionsMap = new Map<string, Set<Permission>>()
  for (const rp of rolePerms) {
    if (!rolePermissionsMap.has(rp.roleCode)) {
      rolePermissionsMap.set(rp.roleCode, new Set())
    }
    rolePermissionsMap.get(rp.roleCode)!.add(rp.permissionCode as Permission)
  }
  const permissionsMap = new Map<string, { resource: string; action: string }>()
  for (const p of perms) {
    if (p.active) {
      permissionsMap.set(p.code, { resource: p.resource, action: p.action })
    }
  }
  _catalogCache = {
    rolePermissions: rolePermissionsMap,
    permissions: permissionsMap,
    cachedAt: Date.now(),
  }
  return _catalogCache
}

/** Invalidate the catalog cache — call after Role/Permission changes. */
export function invalidateCatalogCache(): void {
  _catalogCache = null
}

// ── Migration mode ────────────────────────────────────
// AUTHZ_MIGRATION_MODE controls how the system handles the transition
// from legacy allowedSites to UserSiteGrant:
//
//   - 'dual_read' (default): Read UserSiteGrant first; if no grants,
//     fall back to legacy allowedSites WITH an audit warning. Every
//     request with a target Site still checks canAccessSite(). This
//     is the ONLY mode that allows fallback.
//
//   - 'strict': No fallback. Users without UserSiteGrant rows get
//     no Site access (fail-closed). Use this after backfill is complete.
//
// 'fail_open' is NOT supported — it would bypass Site authorization
// globally, which is explicitly prohibited by the security policy.
//
// In production, startup should reject if any non-superadmin user has
// allowedSites='ALL' without an explicit migration exception (see
// validateProductionAuthzConfig below).
export type AuthzMigrationMode = 'dual_read' | 'strict'

export function getAuthzMigrationMode(): AuthzMigrationMode {
  const raw = (process.env.AUTHZ_MIGRATION_MODE ?? 'dual_read').trim()
  if (raw === 'strict') return 'strict'
  return 'dual_read' // default + only other valid value
}

/**
 * Validate that the production authorization configuration is safe.
 * Call this at startup (e.g. in a server module or health check).
 *
 * Returns a list of warnings/errors. In production, the caller should
 * reject startup if any errors are present.
 */
export interface AuthzConfigIssue {
  level: 'error' | 'warn'
  message: string
}

export async function validateProductionAuthzConfig(): Promise<AuthzConfigIssue[]> {
  const issues: AuthzConfigIssue[] = []
  const isProd = process.env.NODE_ENV === 'production'

  if (isProd) {
    // Check for non-superadmin users with allowedSites='ALL'
    // These are security risks — they should have explicit grants instead.
    const riskyUsers = await db.user.findMany({
      where: {
        active: true,
        role: { not: { equals: 'superadmin' } },
        allowedSites: { equals: 'ALL' },
      },
      select: { id: true, email: true, username: true, role: true },
    })
    for (const u of riskyUsers) {
      issues.push({
        level: 'error',
        message: `User ${u.email} (${u.role}) has allowedSites='ALL' — convert to explicit UserSiteGrant or set AUTHZ_MIGRATION_EXCEPTIONS`,
      })
    }
  }

  return issues
}

// ── Main builder ──────────────────────────────────────
/**
 * Build the AuthorizationContext for the authenticated user.
 *
 * @param user The AuthUser from requireAuth()
 * @param userId The Prisma User.id
 * @param legacyAllowedSites The User.allowedSites string (for fallback)
 *
 * Sequence:
 *   1. superadmin → all sites, all permissions
 *   2. Load UserSiteGrant rows (active, within validFrom/validUntil)
 *   3. If no grants → fall back to legacy allowedSites (with audit warning)
 *   4. Compute effective permissions = global role ∪ per-site permissions
 *   5. Compute site scope
 */
export async function buildAuthorizationContext(
  user: AuthUser,
  userId: string,
  legacyAllowedSites?: string | null,
): Promise<AuthorizationContext> {
  const globalRole = normalizeRole(user.role)
  const isSuperAdmin = globalRole === 'superadmin'
  const isGlobalAdmin = globalRole === 'admin'
  // Demo users bypass site grants — they're for testing only.
  // They can read all data and write (tagged isDemo:true) at any site.
  const isDemoUser = user.isDemo === true

  // superadmin, admin, AND demo users bypass Site grants
  if (isSuperAdmin || isGlobalAdmin || isDemoUser) {
    const globalPerms = getRolePermissions(globalRole)
    return {
      userId,
      email: user.email,
      globalRole,
      isSuperAdmin,
      grants: [],
      siteScope: { kind: 'all', siteCodes: [] },
      effectivePermissions: globalPerms,
      usedLegacyFallback: false,
      can: (perm) => globalPerms.includes(perm),
      canAtSite: () => true, // demo/admin has all permissions at every Site
      canAccessSite: () => true,
      siteWhere: () => ({}),
      roleAtSite: () => globalRole,
      permissionsAtSite: () => globalPerms,
    }
  }

  // Load catalog (cached) for permission lookup
  const catalog = await loadCatalog()

  // 1) Load active UserSiteGrant rows
  const now = new Date()
  const grantRows = await db.userSiteGrant.findMany({
    where: {
      userId,
      active: true,
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
      ],
    },
    select: {
      siteCode: true,
      roleCode: true,
      validFrom: true,
      validUntil: true,
    },
  })

  let grants: SiteGrant[]
  let usedLegacyFallback = false

  if (grantRows.length > 0) {
    // Use explicit grants
    grants = grantRows.map((g) => {
      const normalizedSite = normalizeSiteCode(g.siteCode)!
      const roleCode = g.roleCode as Role
      // Get permissions from catalog (DB) or fall back to ROLE_PERMISSIONS
      const catalogPerms = catalog.rolePermissions.get(g.roleCode)
      let perms: Permission[]
      if (catalogPerms && catalogPerms.size > 0) {
        perms = Array.from(catalogPerms)
      } else {
        // Fall back to in-code ROLE_PERMISSIONS if catalog isn't seeded yet
        perms = getRolePermissions(roleCode)
      }
      return {
        siteCode: normalizedSite,
        roleCode: g.roleCode,
        permissions: perms,
        validFrom: g.validFrom,
        validUntil: g.validUntil,
      }
    })
  } else {
    // 2) Fall back to legacy allowedSites — ONLY in dual_read mode
    // In 'strict' mode, no grants = no access (fail-closed).
    const migrationMode = getAuthzMigrationMode()
    if (migrationMode === 'strict') {
      // No fallback — return no-access context
      return {
        userId,
        email: user.email,
        globalRole,
        isSuperAdmin: false,
        grants: [],
        siteScope: { kind: 'none', siteCodes: [] },
        effectivePermissions: [],
        usedLegacyFallback: false,
        can: () => false,
        canAtSite: () => false,
        canAccessSite: () => false,
        siteWhere: (field = 'site') => ({ [field]: { in: [] } }),
        roleAtSite: () => null,
        permissionsAtSite: () => [],
      }
    }

    // dual_read mode — fall back with audit warning
    usedLegacyFallback = true
    const parsed = parseAllowedSites(legacyAllowedSites)

    // Audit the fallback so we can track migration progress
    await logAudit(
      'AUTH_FALLBACK',
      'User',
      userId,
      `User ${userId} has no UserSiteGrant rows; fell back to allowedSites='${legacyAllowedSites ?? ''}' (dual_read mode). ` +
        `Add explicit grants to retire this fallback.`,
      { userId, allowedSites: legacyAllowedSites ?? '', migrationMode },
    ).catch(() => {
      // best-effort; don't fail the request
    })

    if (parsed.isAll) {
      // Task ID: RESIDUAL-BLOCKERS-ROUND-4 — Legacy allowedSites='ALL'
      // for non-superadmin is FAIL-CLOSED in dual_read mode.
      //
      // Previously this branch returned a fail-open context (treat 'ALL'
      // as "all sites" with the global role's permissions applied
      // everywhere). That let a non-superadmin user with stale legacy
      // 'ALL' data bypass Site authorization — including the audit
      // team's UDH=admin/NKP=viewer escalation: a user with UDH=admin
      // + allowedSites='ALL' could call any Site-scoped mutation
      // endpoint because canAtSite('NKP', perm) returned true via the
      // global-perms fallback.
      //
      // Now: ALL without explicit UserSiteGrant rows = no access. The
      // caller must add explicit grants (via the site-grants admin API
      // or by editing allowedSites to a comma-separated list of Sites).
      // The audit warning above (AUTH_FALLBACK) already records that
      // the user needs migration; this fail-closed behaviour makes the
      // risk non-exploitable while migration is in progress.
      //
      // To opt INTO legacy fail-open behaviour (NOT recommended outside
      // of an emergency break-glass), set AUTHZ_LEGACY_ALL_FAIL_OPEN=1.
      // Production deployments should set AUTHZ_MIGRATION_MODE=strict
      // AND convert all 'ALL' users to explicit grants.
      const allowFailOpen =
        process.env.AUTHZ_LEGACY_ALL_FAIL_OPEN === '1'
      if (allowFailOpen) {
        // Break-glass path — kept for emergency rollback only.
        const globalPerms = getUserPermissions(
          globalRole,
          user.permissions as unknown as string,
        )
        return {
          userId,
          email: user.email,
          globalRole,
          isSuperAdmin: false,
          grants: [],
          siteScope: { kind: 'all', siteCodes: [] },
          effectivePermissions: globalPerms,
          usedLegacyFallback: true,
          can: (perm) => globalPerms.includes(perm),
          canAtSite: (_siteCode, perm) => globalPerms.includes(perm),
          canAccessSite: () => true,
          siteWhere: () => ({}),
          roleAtSite: () => globalRole,
          permissionsAtSite: () => globalPerms,
        }
      }

      // Default path — fail-closed. Treat legacy 'ALL' as "no explicit
      // grants" → no access. The user can still log in, but every
      // Site-scoped check (canAccessSite, canAtSite, siteWhere) denies.
      return {
        userId,
        email: user.email,
        globalRole,
        isSuperAdmin: false,
        grants: [],
        siteScope: { kind: 'none', siteCodes: [] },
        effectivePermissions: [],
        usedLegacyFallback: true,
        can: () => false,
        canAtSite: () => false,
        canAccessSite: () => false,
        siteWhere: (field = 'site') => ({ [field]: { in: [] } }),
        roleAtSite: () => null,
        permissionsAtSite: () => [],
      }
    }

    // Convert legacy site list to grant-like entries using the global role
    grants = parsed.codes.map((siteCode) => ({
      siteCode,
      roleCode: globalRole,
      permissions: getUserPermissions(
        globalRole,
        user.permissions as unknown as string,
      ),
      validFrom: null,
      validUntil: null,
    }))
  }

  // Compute site scope from grants
  const siteCodes = grants.map((g) => g.siteCode)
  const siteScope: SiteScope =
    siteCodes.length === 0
      ? { kind: 'none', siteCodes: [] }
      : { kind: 'sites', siteCodes }

  // Compute effective permissions = global role perms ∪ all per-site perms
  const globalPerms = getUserPermissions(
    globalRole,
    user.permissions as unknown as string,
  )
  const permSet = new Set<Permission>(globalPerms)
  for (const g of grants) {
    for (const p of g.permissions) {
      permSet.add(p)
    }
  }
  const effectivePermissions = Array.from(permSet)

  // Build grant lookup by siteCode
  const grantsBySite = new Map<string, SiteGrant>()
  for (const g of grants) {
    grantsBySite.set(g.siteCode, g)
  }

  return {
    userId,
    email: user.email,
    globalRole,
    isSuperAdmin: false,
    grants,
    siteScope,
    effectivePermissions,
    usedLegacyFallback,
    can: (perm) => effectivePermissions.includes(perm),
    // B1 FIX: canAtSite checks ONLY the role at the target Site,
    // NOT the union of all Sites. This prevents privilege escalation
    // where admin at Site A uses DEVICE_EDIT at Site B (viewer).
    canAtSite: (siteCode, perm) => {
      if (!siteCode) return false
      const normalized = normalizeSiteCode(siteCode)
      if (!normalized) return false
      const grant = grantsBySite.get(normalized)
      if (!grant) return false // no grant at this Site → deny
      return grant.permissions.includes(perm)
    },
    canAccessSite: (siteCode) => {
      if (!siteCode) return false
      const normalized = normalizeSiteCode(siteCode)
      if (!normalized) return false
      return grantsBySite.has(normalized)
    },
    siteWhere: (field = 'site') => {
      // At this point, siteScope can only be 'none' or 'sites' (never 'all')
      // because the 'all' case is handled by an early return above.
      if (siteScope.kind === 'none') return { [field]: { in: [] } }
      return { [field]: { in: siteCodes } }
    },
    roleAtSite: (siteCode) => {
      if (!siteCode) return null
      const normalized = normalizeSiteCode(siteCode)
      if (!normalized) return null
      return (grantsBySite.get(normalized)?.roleCode ?? null) as Role | null
    },
    // B1 FIX: permissionsAtSite returns ONLY the permissions from the
    // role at the target Site, not the global union.
    permissionsAtSite: (siteCode) => {
      if (!siteCode) return []
      const normalized = normalizeSiteCode(siteCode)
      if (!normalized) return []
      return grantsBySite.get(normalized)?.permissions ?? []
    },
  }
}

// ── Helper: check permission + site scope in one call ──
/**
 * Convenience wrapper for API routes that need to check both a functional
 * permission AND Site scope in one shot.
 *
 * Usage:
 *   const guard = await requirePermissionAndScope(req, 'DEVICE_EDIT', 'UDH')
 *   if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
 *   const ctx = guard.ctx
 */
export async function requirePermissionAndScope(
  user: AuthUser,
  userId: string,
  permission: Permission,
  targetSiteCode?: string | null,
  legacyAllowedSites?: string | null,
): Promise<
  | { ok: true; ctx: AuthorizationContext }
  | { ok: false; status: number; error: string }
> {
  const ctx = await buildAuthorizationContext(user, userId, legacyAllowedSites)

  // B4 FIX: Use canAtSite instead of can (union) when a target Site is specified.
  // This prevents privilege escalation where admin at Site A uses a permission
  // at Site B (viewer) because the union includes the permission from Site A.
  // N2 FIX (round 7): Treat empty string/whitespace targetSiteCode as "no target Site".
  // For Site-scoped permissions (DEVICE_EDIT, WO_*, STOCK_*, METER_WRITE, etc.),
  // missing targetSiteCode = fail-closed (403), NOT global fallback.
  // Only truly global permissions (USER_MANAGE, SYSTEM_CONFIG, VIEW_AUDIT,
  // ADMIN) use ctx.can() when no targetSiteCode is provided.
  const SITE_SCOPED_PERMISSIONS = new Set<Permission>([
    'DEVICE_EDIT', 'DEVICE_DELETE', 'DEVICE_TRANSFER', 'LIFECYCLE_EDIT',
    'METER_WRITE', 'WO_CREATE', 'WO_VIEW_ALL', 'WO_VIEW_SITE', 'WO_VIEW_OWN',
    'WO_ASSIGN', 'WO_COMPLETE', 'WO_CANCEL',
    'STOCK_VIEW', 'STOCK_IN', 'STOCK_OUT', 'STOCK_APPROVE',
  ])
  const effectiveTargetSite = targetSiteCode ? targetSiteCode.trim() : null
  if (effectiveTargetSite) {
    if (!ctx.canAtSite(effectiveTargetSite, permission)) {
      // Return 404 (not 403) to avoid revealing the existence of out-of-scope records
      return {
        ok: false,
        status: 404,
        error: 'ไม่พบรายการที่ระบุ หรือคุณไม่มีสิทธิ์เข้าถึง',
      }
    }
  } else {
    // No target Site (null, undefined, or empty string)
    // For Site-scoped permissions: fail-closed (missing targetSite = no proof of Site access)
    // For global permissions: use ctx.can()
    if (SITE_SCOPED_PERMISSIONS.has(permission)) {
      if (!ctx.isSuperAdmin) {
        return {
          ok: false,
          status: 403,
          error: `ต้องระบุ targetSiteCode สำหรับ Site-scoped permission (${permission})`,
        }
      }
    }
    if (!ctx.can(permission)) {
      return {
        ok: false,
        status: 403,
        error: `ไม่มีสิทธิ์ (${permission}) สำหรับบัญชีนี้`,
      }
    }
  }

  return { ok: true, ctx }
}
