import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { requireAuth } from '@/lib/auth-middleware'
import { getOrgScope } from '@/lib/org-scope'

/**
 * GET /api/sync/status
 *   Returns sync status: last sync, pending outbox count, open conflicts.
 *
 * Phase 1 → Phase 2 contract stub.
 */
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('sync')
  if (unavailable) return unavailable

  const auth = await requireAuth(req, 'VIEW_DEVICES')
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
  const nodeId = url.searchParams.get('nodeId')

  // Get all nodes for this org
  const nodes = await db.syncNode.findMany({
    where: { organizationId: orgScope.organizationId },
    select: {
      id: true,
      nodeType: true,
      status: true,
      lastSyncAt: true,
      _count: {
        select: {
          outbox: { where: { status: { in: ['PENDING', 'SENT'] } } },
          conflicts: { where: { status: 'OPEN' } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const pendingOutbox = await db.syncOutbox.count({
    where: {
      organizationId: orgScope.organizationId,
      status: { in: ['PENDING', 'SENT'] },
      ...(nodeId ? { nodeId } : {}),
    },
  })

  const openConflicts = await db.syncConflict.count({
    where: {
      organizationId: orgScope.organizationId,
      status: 'OPEN',
    },
  })

  return NextResponse.json({
    nodes,
    pendingOutbox,
    openConflicts,
  })
}
