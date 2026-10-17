/**
 * wo-authz.ts — Reusable Work Order authorization helper.
 *
 * Loads a Work Order by ID (or woNumber, or requestId), builds the
 * AuthorizationContext, and checks that the caller has the required
 * permission at the WO's Site — all in one call. This avoids repeating
 * the same auth-load-check boilerplate in every WO route handler.
 *
 * Usage:
 *   const result = await loadAuthorizedWorkOrder(req, id, 'WO_VIEW_ALL')
 *   if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
 *   const { wo, ctx, auth, woSite } = result
 *
 * Task ID: WO-ROUTE-AUTH-FIXES
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, type RequireAuthResult } from '@/lib/auth-middleware'
import {
  buildAuthorizationContext,
  type AuthorizationContext,
} from '@/lib/authorization-context'
import { normalizeSiteCode } from '@/lib/site-scope'
import type { Permission } from '@/lib/auth-shared'

// ── Result types ──────────────────────────────────────
type AuthOk = Extract<RequireAuthResult, { ok: true }>

export interface LoadResultOk {
  ok: true
  /** The Work Order (with `device` relation included for Site derivation). */
  wo: NonNullable<Awaited<ReturnType<typeof db.workOrder.findFirst>>>
  /** Authorization context (use ctx.canAtSite for further per-Site checks). */
  ctx: AuthorizationContext
  /** The full requireAuth() success payload (user, row, isDemo). */
  auth: AuthOk
  /** The normalized Site code of the WO (or null if none could be derived). */
  woSite: string | null
}

export interface LoadResultErr {
  ok: false
  status: number
  error: string
}

export type LoadResult = LoadResultOk | LoadResultErr

/**
 * Load a Work Order and verify the caller has permission at its Site.
 *
 * @param req        The NextRequest (must carry `Authorization: Bearer …`)
 * @param id         The WorkOrder id, woNumber, or requestId
 * @param permission The required permission (e.g. 'WO_VIEW_ALL',
 *                   'WO_ASSIGN', 'WO_COMPLETE', 'WO_CANCEL',
 *                   'STOCK_APPROVE')
 * @param options    Optional: { allowOwn?: boolean } — if true AND the
 *                   caller has WO_VIEW_OWN, allow access to a WO they
 *                   submitted themselves even without the Site-scoped
 *                   permission. Only meaningful for view-type permissions.
 *
 * Returns 404 for both "not found" and "not authorized" — this avoids
 * leaking whether a Work Order exists to an unauthorized caller.
 */
export async function loadAuthorizedWorkOrder(
  req: NextRequest,
  id: string,
  permission: Permission,
  options?: { allowOwn?: boolean },
): Promise<LoadResult> {
  // 1. Authenticate
  const auth = await requireAuth(req)
  if (!auth.ok) {
    return { ok: false, status: auth.status, error: auth.error }
  }

  // 2. Build authorization context (load grants, compute site scope)
  const ctx = await buildAuthorizationContext(
    auth.user,
    auth.row.id,
    auth.row.allowedSites,
  )

  // 3. Load the Work Order with device relation for Site derivation
  //    Match by id (PPIT format), woNumber, or requestId.
  const wo = await db.workOrder.findFirst({
    where: {
      OR: [{ id }, { woNumber: id }, { requestId: id }],
    },
    include: {
      device: {
        select: { id: true, site: true, assetCode: true, name: true },
      },
    },
  })

  if (!wo) {
    // Return 404 — don't reveal whether the WO exists
    return { ok: false, status: 404, error: 'ไม่พบใบงานที่ระบุ' }
  }

  // 4. Derive the WO's Site — prefer WorkOrder.siteCode (Phase 0+ field),
  //    fall back to device.site for legacy rows that haven't been backfilled.
  const rawWoSite = wo.siteCode ?? wo.device?.site ?? null
  const woSite = rawWoSite ? normalizeSiteCode(rawWoSite) : null

  // 5. Superadmin bypasses Site checks (they have all permissions everywhere)
  if (ctx.isSuperAdmin || ctx.globalRole === 'admin') { // QA FIX: admin bypass
    return { ok: true, wo, ctx, auth, woSite }
  }

  // 6. allowOwn: WO_VIEW_OWN users can access their own WOs even without
  //    the Site-scoped permission. This is only honored when explicitly
  //    requested AND the caller actually has WO_VIEW_OWN AT THE WO'S SITE.
  //    B4 FIX: Previously used ctx.can('WO_VIEW_OWN') (union) which allowed
  //    a user with WO_VIEW_OWN from Site A to access their own WOs at Site B.
  //    Now uses ctx.canAtSite(woSite, 'WO_VIEW_OWN') for per-Site check.
  if (options?.allowOwn && woSite && ctx.canAtSite(woSite, 'WO_VIEW_OWN')) {
    const isOwn =
      (wo.reporterEmail != null &&
        wo.reporterEmail !== '' &&
        wo.reporterEmail === auth.user.email) ||
      (wo.reporterName != null &&
        wo.reporterName !== '' &&
        wo.reporterName === auth.user.name)
    if (isOwn) {
      return { ok: true, wo, ctx, auth, woSite }
    }
  }

  // 7. Site-scoped permission check
  if (!woSite) {
    // WO has no derivable Site — deny (never allow unscoped access for
    // non-superadmin callers; returning 404 hides existence)
    return { ok: false, status: 404, error: 'ไม่พบใบงานที่ระบุ' }
  }

  // For WO_VIEW_ALL we also accept WO_VIEW_SITE at the same Site, since
  // WO_VIEW_SITE means "see all WOs at my Site". WO_VIEW_OWN is already
  // handled above (with allowOwn) — but we also accept it here as a
  // weaker alternative when allowOwn wasn't passed but the WO is theirs.
  let hasPermission = ctx.canAtSite(woSite, permission)

  if (!hasPermission && permission === 'WO_VIEW_ALL') {
    if (ctx.canAtSite(woSite, 'WO_VIEW_SITE')) {
      hasPermission = true
    } else if (
      options?.allowOwn &&
      ctx.canAtSite(woSite, 'WO_VIEW_OWN') &&
      ((wo.reporterEmail != null &&
        wo.reporterEmail !== '' &&
        wo.reporterEmail === auth.user.email) ||
        (wo.reporterName != null &&
          wo.reporterName !== '' &&
          wo.reporterName === auth.user.name))
    ) {
      hasPermission = true
    }
  }

  if (!hasPermission) {
    // 404 — don't reveal the WO exists
    return { ok: false, status: 404, error: 'ไม่พบใบงานที่ระบุ' }
  }

  return { ok: true, wo, ctx, auth, woSite }
}
