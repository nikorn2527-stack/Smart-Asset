/**
 * Shared constants + helpers for the Work Orders v1 API routes.
 *
 * Kept in a non-route file so it can be imported by both the collection
 * route (`/api/v1/work-orders/route.ts`) and the per-resource sub-routes
 * (`[id]`, `[id]/assign`, `[id]/complete`, …) without Next.js treating
 * the imports as route handlers.
 */

import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import {
  buildAuthorizationContext,
} from '@/lib/authorization-context'
import { normalizeSiteCode } from '@/lib/site-scope'
import type { Permission } from '@/lib/auth-shared'

// ── Enums (mirror Prisma schema defaults) ───────────────────────────────
export const VALID_STATUSES = new Set([
  'PENDING',
  'IN_PROGRESS',
  'WAITING_PARTS',
  'COMPLETED',
  'CANCELLED',
])

export const VALID_PRIORITIES = new Set(['ปกติ', 'ปานกลาง', 'สูง', 'ด่วน'])

/** Terminal statuses — once set, the work order is locked unless unlocked. */
export const TERMINAL_STATUSES = new Set(['COMPLETED', 'CANCELLED'])

/** Roles used for WorkOrderMessage.authorRole. */
export type AuthorRole = 'admin' | 'staff' | 'reporter' | 'system'

/**
 * Map an ITAM RBAC role → work-order message authorRole.
 * admin/superadmin → 'admin', editor → 'staff', meter → 'staff',
 * viewer (read-only) → 'staff' too (they shouldn't be writing, but if
 * they have an explicit permission like DEVICE_EDIT we still record them).
 */
export function roleToAuthorRole(role: string | null | undefined): AuthorRole {
  const r = String(role ?? '').trim().toLowerCase()
  if (r === 'admin' || r === 'superadmin') return 'admin'
  return 'staff'
}

/**
 * Generate the next woNumber for today: WO-YYYYMMDD-NNN
 * Sequential per day, padded to 3 digits.
 */
export async function generateWoNumber(): Promise<string> {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const ymd = `${y}${m}${d}`
  const prefix = `WO-${ymd}-`

  // Find max sequence for today
  const todays = await db.workOrder.findMany({
    where: { woNumber: { startsWith: prefix } },
    select: { woNumber: true },
  })
  let maxSeq = 0
  for (const t of todays) {
    if (!t.woNumber) continue
    const seqStr = t.woNumber.slice(prefix.length)
    const seq = parseInt(seqStr, 10)
    if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq
  }
  const nextSeq = maxSeq + 1
  return `${prefix}${String(nextSeq).padStart(3, '0')}`
}

/**
 * Resolve a work-order by ID or woNumber.
 * Returns the row or null.
 */
export async function findWorkOrder(idOrWoNumber: string) {
  return db.workOrder.findFirst({
    where: {
      OR: [{ id: idOrWoNumber }, { woNumber: idOrWoNumber }],
    },
  })
}

/**
 * P0 Security Fix: Load a work-order AND verify the caller has the
 * required permission at the WO's Site.
 *
 * This is the v1 equivalent of loadAuthorizedWorkOrder() from
 * src/lib/wo-authz.ts. The v1 routes were missing this check entirely,
 * allowing cross-site privilege escalation (e.g. a staff member at
 * Site A could assign/complete/cancel WOs at Site B).
 *
 * @returns { ok: true, wo, auth } on success, or a NextResponse on failure.
 */
export async function loadAuthorizedWorkOrderV1(
  req: NextRequest,
  id: string,
  permission: Permission,
): Promise<
  | { ok: true; wo: NonNullable<Awaited<ReturnType<typeof findWorkOrder>>>; auth: Extract<Awaited<ReturnType<typeof requireAuth>>, { ok: true }> }
  | { ok: false; response: NextResponse }
> {
  // 1. Authenticate
  const auth = await requireAuth(req)
  if (!auth.ok) {
    return { ok: false, response: NextResponse.json({ error: auth.error }, { status: auth.status }) }
  }

  // 2. Build authorization context (load grants, compute site scope)
  const ctx = await buildAuthorizationContext(
    auth.user,
    auth.row.id,
    auth.row.allowedSites,
  )

  // 3. Load the Work Order with device relation for Site derivation
  const wo = await findWorkOrder(id)
  if (!wo) {
    // Return 404 for both "not found" and "not authorized" to avoid leaking existence
    return { ok: false, response: NextResponse.json({ error: 'Work order not found' }, { status: 404 }) }
  }

  // 4. Derive the WO's Site code
  let woSite: string | null = wo.siteCode ?? null
  if (!woSite && wo.deviceId) {
    const device = await db.device.findUnique({
      where: { id: wo.deviceId },
      select: { site: true },
    })
    woSite = device?.site ?? null
  }
  woSite = woSite ? normalizeSiteCode(woSite) : null

  // 5. Check permission at the WO's Site.
  // NOTE: canAtSite's signature is (siteCode, perm) — these two arguments were
  // previously swapped, so it looked up grantsBySite with the *permission* name
  // ('WO_ASSIGN'), never matched a site, and returned false for every
  // site-scoped request (a 403 on all v1 work-order reads/writes).
  if (woSite && !ctx.canAtSite(woSite, permission)) {
    return { ok: false, response: NextResponse.json({ error: `ไม่มีสิทธิ์ (${permission}) ที่สาขานี้` }, { status: 403 }) }
  }

  return { ok: true, wo, auth }
}
