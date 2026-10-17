/**
 * node-auth.ts — Node credential system for Offline Sync.
 *
 * L-19 fix: Node authentication uses a separate short-lived token,
 * NOT the user's JWT session. This prevents:
 *   - Stolen user JWTs being used to register rogue nodes
 *   - Node credentials working on non-sync endpoints
 *   - Long-lived tokens that can't be revoked
 *
 * Flow:
 *   1. Admin registers a node via /api/sync/nodes/register (uses user JWT)
 *   2. Server creates a node token (signed, 24h expiry)
 *   3. Node uses node token for sync/push, sync/pull, sync/ack
 *   4. Admin can revoke a node (sets status=REVOKED, token invalid)
 *   5. Tokens rotate on each sync (server returns new token in response header)
 */

import { createHmac } from 'node:crypto'
import { db } from '@/lib/db'

const NODE_TOKEN_PREFIX = 'nt_'
const NODE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

function getSigningKey(): string {
  return process.env.JWT_SECRET || 'itam-node-token-dev-key-change-me'
}

/**
 * Create a signed node token.
 * Format: nt_<nodeId>.<expiry>.<signature>
 */
export function createNodeToken(nodeId: string): string {
  const expiry = Date.now() + NODE_TOKEN_TTL_MS
  const payload = `${nodeId}.${expiry}`
  const sig = createHmac('sha256', getSigningKey())
    .update(payload)
    .digest('hex')
    .slice(0, 32)
  return `${NODE_TOKEN_PREFIX}${nodeId}.${expiry}.${sig}`
}

/**
 * Verify a node token and return the node record if valid.
 * Returns null if token is invalid, expired, or node is revoked.
 */
export async function verifyNodeToken(token: string): Promise<{
  id: string
  organizationId: string
  siteCode: string | null
  nodeType: string
  status: string
} | null> {
  if (!token.startsWith(NODE_TOKEN_PREFIX)) return null

  const stripped = token.slice(NODE_TOKEN_PREFIX.length)
  const parts = stripped.split('.')
  if (parts.length !== 3) return null

  const [nodeId, expiryStr, sig] = parts
  const expiry = parseInt(expiryStr, 10)
  if (isNaN(expiry) || Date.now() > expiry) return null

  // Verify signature
  const expectedSig = createHmac('sha256', getSigningKey())
    .update(`${nodeId}.${expiry}`)
    .digest('hex')
    .slice(0, 32)
  if (sig !== expectedSig) return null

  // Check node exists and is active
  const node = await db.syncNode.findUnique({
    where: { id: nodeId },
    select: {
      id: true,
      organizationId: true,
      siteCode: true,
      nodeType: true,
      status: true,
    },
  })
  if (!node || node.status !== 'ACTIVE') return null

  return node
}

/**
 * Extract node token from request headers.
 * Checks: X-Node-Token header, then Authorization: Bearer nt_...
 */
export function extractNodeToken(req: Request): string | null {
  const headerToken = req.headers.get('x-node-token')
  if (headerToken?.startsWith(NODE_TOKEN_PREFIX)) return headerToken

  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ') && authHeader.slice(7).startsWith(NODE_TOKEN_PREFIX)) {
    return authHeader.slice(7)
  }

  return null
}
