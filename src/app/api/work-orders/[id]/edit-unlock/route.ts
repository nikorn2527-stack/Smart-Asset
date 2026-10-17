import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadAuthorizedWorkOrder } from '@/lib/wo-authz'
import { hasResolvedPermission } from '@/lib/auth'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * POST /api/work-orders/[id]/edit-unlock
 *
 * Toggles the "edit unlock" flag on a terminal work order (COMPLETED/CANCELLED).
 * Aligned with Apps Script `setWorkOrderEditUnlock`.
 *
 * Body:
 *   { active: boolean, note?: string }
 *
 * Rules (Task ID: UX-GAPS-3-ITEMS — Authorization consistency):
 *   - Requires `isAdmin` (same as the v1 PUT route when setting
 *     `editUnlockActive=true`). The previous `WO_ASSIGN` check allowed any
 *     site-scoped assigner to unlock a terminal WO — a privilege-escalation
 *     risk that did not match the v1 PUT route's stricter `isAdmin` gate.
 *   - `loadAuthorizedWorkOrder(req, id, 'WO_VIEW_ALL')` is still used to
 *     load the WO and verify the caller can at least view it at the WO's
 *     Site; admins bypass Site checks per `wo-authz.ts`. After the load
 *     we additionally require `isAdmin` (role-based OR explicit ADMIN
 *     permission), matching the v1 PUT route's check.
 *   - Can only toggle on records with status COMPLETED or CANCELLED.
 *   - active=true  → set editUnlockActive=true, editUnlockBy=user,
 *                    editUnlockAt=now, editUnlockNote=note
 *   - active=false → set editUnlockActive=false (keep other fields for audit)
 *
 * Response: { workOrder: updated }
 */

async function logAudit(
  action: string,
  entityId: string | null,
  summary: string,
  detail: Record<string, unknown> | null,
  actor: string,
  siteCode?: string | null,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action,
        entity: 'WorkOrder',
        entityId,
        summary,
        detail: detail ? JSON.stringify(detail) : null,
        actor,
        siteCode: siteCode ?? null,
      },
    })
  } catch (err) {
    console.error('logAudit failed:', err)
  }
}

const TERMINAL_STATUSES = new Set(['COMPLETED', 'CANCELLED'])

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  try {
    const { id } = await params

    // Authenticate + load the WO. We use `WO_VIEW_ALL` (the weakest
    // WO-view permission) so that the Site-scope check still applies to
    // non-admin callers — admins bypass the Site check in `wo-authz.ts`.
    // allowOwn is NOT set — unlocking is an admin action.
    const result = await loadAuthorizedWorkOrder(req, id, 'WO_VIEW_ALL')
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      )
    }
    const { wo: before, auth } = result

    // Audit-log actor is the authenticated session identity.
    const user = auth.user
    const actor: string =
      user.email ?? user.username ?? user.name ?? 'system'

    // ── Authorization: require isAdmin (Task ID: UX-GAPS-3-ITEMS) ──
    // Matches the v1 PUT route's check at src/app/api/v1/work-orders/[id]/route.ts
    // (lines 107-110). Role-based admin OR explicit ADMIN permission grant.
    const isAdmin =
      user.role === 'admin' ||
      user.role === 'superadmin' ||
      hasResolvedPermission(user.permissions, 'ADMIN')
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'ต้องเป็น admin เท่านั้นที่ปลดล็อกการแก้ไขได้' },
        { status: 403 },
      )
    }

    let body: { active?: unknown; note?: unknown } = {}
    try {
      body = (await req.json()) as { active?: unknown; note?: unknown }
    } catch {
      body = {}
    }

    const active =
      body.active === true ||
      body.active === 'true' ||
      body.active === 1 ||
      body.active === 'TRUE' ||
      body.active === 'True'

    const note =
      typeof body.note === 'string' && body.note.trim()
        ? body.note.trim()
        : null

    // Rule: only allow toggle on COMPLETED or CANCELLED records.
    if (!TERMINAL_STATUSES.has(before.status)) {
      return NextResponse.json(
        {
          error:
            'สามารถปลดล็อกแก้ไขได้เฉพาะใบงานที่สถานะ COMPLETED หรือ CANCELLED เท่านั้น',
        },
        { status: 400 },
      )
    }

    const previous = {
      editUnlockActive: before.editUnlockActive,
      editUnlockBy: before.editUnlockBy,
      editUnlockAt: before.editUnlockAt,
      editUnlockNote: before.editUnlockNote,
    }

    if (active) {
      // Unlock for editing.
      const updated = await db.workOrder.update({
        where: { id: before.id },
        data: {
          editUnlockActive: true,
          editUnlockBy: actor,
          editUnlockAt: new Date(),
          editUnlockNote: note,
        },
      })

      await logAudit(
        'UPDATE',
        before.id,
        `ปลดล็อกแก้ไขใบแจ้งซ่อม ${updated.woNumber ?? before.id}`,
        {
          editUnlock: {
            active: true,
            by: actor,
            note,
            previous,
          },
        },
        actor,
        result.woSite,
      )

      return NextResponse.json({ workOrder: updated })
    }

    // Re-lock (keep other fields for audit per Apps Script setWorkOrderEditUnlock).
    const updated = await db.workOrder.update({
      where: { id: before.id },
      data: {
        editUnlockActive: false,
      },
    })

    await logAudit(
      'UPDATE',
      before.id,
      `ล็อกการแก้ไขใบแจ้งซ่อม ${updated.woNumber ?? before.id} อีกครั้ง`,
      {
        editUnlock: {
          active: false,
          by: actor,
          previous,
        },
      },
      actor,
      result.woSite,
    )

    return NextResponse.json({ workOrder: updated })
  } catch (err) {
    console.error('POST /api/work-orders/[id]/edit-unlock', err)
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to set edit unlock') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
