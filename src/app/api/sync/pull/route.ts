import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { verifyNodeOrUser } from '@/lib/sync-node-guard'
import { pullChanges } from '@/lib/sync-pull-engine'

/**
 * GET /api/sync/pull?cursor=<updatedAt|id>&nodeId=<nodeId>
 *
 * P0-03: Now accepts node token (X-Node-Token) OR user JWT.
 * L-21: Uses (updatedAt, id) composite cursor — no data skipped.
 * L-22: Includes tombstones (soft-deleted records) as DELETE ops.
 */
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('sync')
  if (unavailable) return unavailable

  // P0-03: verify node token OR user JWT
  const authResult = await verifyNodeOrUser(req)
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  const node = authResult.node

  const url = new URL(req.url)
  const cursor = url.searchParams.get('cursor') // "updatedAt|id" composite

  // L-21 + L-22: pull changes using composite cursor + tombstones
  const result = await pullChanges(
    authResult.orgId,
    node.siteCode,
    cursor,
  )

  // Update lastSyncAt on the node
  await db.syncNode.update({
    where: { id: node.id },
    data: { lastSyncAt: new Date().toISOString() },
  })

  return NextResponse.json({
    nodeId: node.id,
    cursor,
    nextCursor: result.nextCursor,
    changes: result.changes,
    hasMore: result.hasMore,
  })
}
