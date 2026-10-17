// ============================================================
// GET /api/sync/runs/[id] — Run detail + items
// ============================================================
// I-04: AuthorizationContext + Site filter + before/after isolation
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { moduleUnavailableResponse } from '@/lib/module-gate'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('sync')
  if (unavailable) return unavailable


  // 1. Auth + AuthorizationContext
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const user = auth.user
  const ctx = await buildAuthorizationContext(user, auth.row.id, auth.row.allowedSites)
  const { id } = await params

  // 2. Load run
  const run = await db.syncRun.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { id: 'asc' },
      },
    },
  })

  if (!run) {
    return NextResponse.json({ error: 'SyncRun not found' }, { status: 404 })
  }

  // 3. Run ownership check (I-04)
  if (user.role !== 'superadmin' && run.triggeredBy !== user.email) {
    return NextResponse.json(
      { error: "Cannot view another user's sync run" },
      { status: 403 },
    )
  }

  // 4. Site scope check (I-04)
  if (user.role !== 'superadmin' && run.siteScope) {
    const runSites = run.siteScope.split(',').map((s) => s.trim()).filter(Boolean)
    const allowedSites = ctx.siteScope?.siteCodes || []

    const hasAccess = runSites.some((site) => allowedSites.includes(site))
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'No permission to view this sync run' },
        { status: 403 },
      )
    }
  }

  // 5. Filter items by Site authorization (I-04)
  // Non-superadmin: redact before/after for out-of-scope items
  let items = run.items

  if (user.role !== 'superadmin') {
    const allowedSites = ctx.siteScope?.siteCodes || []

    items = items.map((item) => {
      const afterData = item.after as Record<string, unknown> | null
      const itemSiteCode = (afterData?.siteCode as string) || (afterData?.site as string) || null

      // If item site is in scope, return as-is
      if (itemSiteCode && allowedSites.includes(itemSiteCode)) {
        return item
      }

      // Out of scope — redact before/after
      return {
        ...item,
        before: null,
        after: null,
        errorMessage: item.errorMessage
          ? `${item.errorMessage} [REDACTED: cross-site]`
          : '[REDACTED: cross-site data]',
      }
    })
  }

  return NextResponse.json({ run: { ...run, items } })
}
