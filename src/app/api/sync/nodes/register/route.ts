import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { getOrgScope } from '@/lib/org-scope'
import { logAudit } from '@/lib/audit'
import { createNodeToken } from '@/lib/node-auth'
import { randomUUID } from 'node:crypto'

/**
 * POST /api/sync/nodes/register
 *
 * P0-03 fix: now returns a node token (short-lived, signed) that the
 * node uses for sync/push, sync/pull, sync/ack — NOT the user JWT.
 *
 * P1-04 fix: idempotent — if clientNodeKey is provided and a node with
 * that key already exists for this org, return the existing node (with
 * a fresh token) instead of creating a duplicate.
 *
 * Body: { nodeType: 'LAN' | 'OFFLINE', siteCode?, clientNodeKey? }
 * Returns: { nodeId, nodeToken, status: 'ACTIVE', registeredAt }
 */
export async function POST(req: NextRequest) {
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

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const { nodeType, siteCode, clientNodeKey } = body as {
    nodeType?: string
    siteCode?: string
    clientNodeKey?: string
  }

  if (!nodeType || !['LAN', 'OFFLINE'].includes(nodeType)) {
    return NextResponse.json(
      { error: 'nodeType must be LAN or OFFLINE', code: 'INVALID_NODE_TYPE' },
      { status: 422 },
    )
  }

  // P1-04: idempotent registration — if clientNodeKey provided, check existing
  if (clientNodeKey) {
    const existing = await db.syncNode.findFirst({
      where: {
        id: clientNodeKey,
        organizationId: orgScope.organizationId,
      },
    })
    if (existing) {
      // Return existing node with fresh token
      const token = createNodeToken(existing.id)
      await logAudit(
        'SYNC_NODE_REREGISTER',
        'SyncNode',
        existing.id,
        `Re-registered ${nodeType} node (idempotent)`,
        { nodeType, siteCode },
        auth.row.username ?? auth.user.email,
      )
      return NextResponse.json({
        nodeId: existing.id,
        nodeToken: token,
        status: existing.status,
        registeredAt: existing.createdAt,
      })
    }
  }

  // Generate node id (use clientNodeKey if provided for idempotency)
  const nodeId = clientNodeKey || `node-${randomUUID().slice(0, 12)}`

  const node = await db.syncNode.create({
    data: {
      id: nodeId,
      organizationId: orgScope.organizationId!,
      siteCode: siteCode ?? null,
      nodeType,
      status: 'ACTIVE',
    },
  })

  // P0-03: issue node token (separate from user JWT)
  const nodeToken = createNodeToken(node.id)

  await logAudit(
    'SYNC_NODE_REGISTER',
    'SyncNode',
    node.id,
    `Registered ${nodeType} node for org ${orgScope.organizationId}`,
    { nodeType, siteCode },
    auth.row.username ?? auth.user.email,
  )

  return NextResponse.json(
    { nodeId: node.id, nodeToken: nodeToken, status: node.status, registeredAt: node.createdAt },
    { status: 201 },
  )
}
