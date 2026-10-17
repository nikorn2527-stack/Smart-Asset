import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { verifyNodeOrUser } from '@/lib/sync-node-guard'

/**
 * POST /api/sync/ack
 *   Acknowledge that a node has received and applied a set of changes.
 *
 * P0-03 fix: now uses verifyNodeOrUser() (accepts node token OR user JWT).
 * Previously only accepted user JWT — anyone with VIEW_DEVICES + nodeId
 * could ACK on behalf of a node.
 *
 * Body: { nodeId, idempotencyKeys: string[] }
 * Returns: { acked: number }
 */
export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('sync')
  if (unavailable) return unavailable

  // P0-03: verify node token OR user JWT
  const authResult = await verifyNodeOrUser(req)
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  const node = authResult.node

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const { nodeId, idempotencyKeys } = body as {
    nodeId?: string
    idempotencyKeys?: string[]
  }

  if (!nodeId) {
    return NextResponse.json({ error: 'nodeId is required' }, { status: 422 })
  }
  if (!Array.isArray(idempotencyKeys)) {
    return NextResponse.json({ error: 'idempotencyKeys must be an array' }, { status: 422 })
  }

  // P0-03: verify nodeId matches the authenticated node
  if (nodeId !== node.id) {
    return NextResponse.json(
      { error: 'nodeId in body does not match authenticated node' },
      { status: 403 },
    )
  }

  // Mark each outbox entry as ACKED
  let acked = 0
  for (const key of idempotencyKeys) {
    const updated = await db.syncOutbox.updateMany({
      where: { idempotencyKey: key, nodeId: node.id },
      data: { status: 'ACKED', ackedAt: new Date().toISOString() },
    })
    acked += updated.count
  }

  return NextResponse.json({ acked })
}
