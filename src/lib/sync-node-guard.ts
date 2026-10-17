/**
 * sync-node-guard.ts — Shared helper to verify node token in sync routes.
 *
 * P0-03 fix: sync routes (push, pull, ack) should verify the node token
 * instead of relying on the user JWT. This helper extracts the node token
 * from the request, verifies it, and returns the node + org scope.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyNodeToken, extractNodeToken } from '@/lib/node-auth'
import { requireAuth } from '@/lib/auth-middleware'
import { getOrgScope } from '@/lib/org-scope'

export interface NodeAuthResult {
  ok: true
  node: {
    id: string
    organizationId: string
    siteCode: string | null
    nodeType: string
    status: string
  }
  orgId: string
}

export interface NodeAuthError {
  ok: false
  error: string
  status: number
}

/**
 * Verify node authentication for sync routes.
 *
 * Tries node token first (X-Node-Token header or Bearer nt_...).
 * Falls back to user JWT (for admin access to sync APIs).
 *
 * Returns the node record if authenticated via node token,
 * or null if authenticated via user JWT (admin direct access).
 */
export async function verifyNodeOrUser(req: NextRequest): Promise<NodeAuthResult | NodeAuthError> {
  // 1. Try node token first
  const nodeToken = extractNodeToken(req)
  if (nodeToken) {
    const node = await verifyNodeToken(nodeToken)
    if (!node) {
      return { ok: false, error: 'Invalid or expired node token', status: 401 }
    }
    if (node.status !== 'ACTIVE') {
      return { ok: false, error: 'Node is revoked or paused', status: 403 }
    }
    return {
      ok: true,
      node,
      orgId: node.organizationId,
    }
  }

  // 2. Fall back to user JWT (admin access)
  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) {
    return { ok: false, error: auth.error, status: auth.status }
  }
  const orgScope = getOrgScope(auth.user)
  if (!orgScope.ok) {
    // `OrgScopeErr` nests the HTTP status under `.error.status` — reading
    // `orgScope.status` would yield `undefined`, which Next.js treats as 200
    // and silently turns an auth failure into a success response.
    return {
      ok: false,
      error: orgScope.error.message,
      status: orgScope.error.status,
    }
  }

  // For user JWT access, we need a nodeId from query param
  const url = new URL(req.url)
  const nodeId = url.searchParams.get('nodeId')
  if (!nodeId) {
    return { ok: false, error: 'nodeId is required (or provide X-Node-Token)', status: 422 }
  }

  // Verify the node belongs to the caller's org
  const { db } = await import('@/lib/db')
  const node = await db.syncNode.findFirst({
    where: { id: nodeId, organizationId: orgScope.organizationId },
    select: {
      id: true,
      organizationId: true,
      siteCode: true,
      nodeType: true,
      status: true,
    },
  })
  if (!node) {
    return { ok: false, error: 'Node not found in your organization', status: 404 }
  }

  return {
    ok: true,
    node,
    orgId: node.organizationId,
  }
}
