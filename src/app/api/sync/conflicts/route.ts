import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { getOrgScope } from '@/lib/org-scope'

/**
 * GET /api/sync/conflicts
 *   List open sync conflicts for the caller's organization.
 *
 * Phase 1 → Phase 2 contract stub.
 */
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('sync')
  if (unavailable) return unavailable

  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const orgScope = getOrgScope(auth.user)
  if (!orgScope.ok) {
    return NextResponse.json(
      { error: orgScope.error.message },
      { status: orgScope.error.status },
    )
  }

  const url = new URL(req.url)
  const status = url.searchParams.get('status') ?? 'OPEN'

  const conflicts = await db.syncConflict.findMany({
    where: {
      organizationId: orgScope.organizationId,
      status,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return NextResponse.json({ conflicts, count: conflicts.length })
}
