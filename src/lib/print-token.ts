/**
 * print-token.ts — Short-lived print token system.
 *
 * L-34 fix: Print/Report pages should NOT use the user's JWT session
 * token in the URL query string (security risk — leaks in browser
 * history, logs, referrer headers).
 *
 * Instead, generate a short-lived, read-only, single-resource print token:
 *   1. Client requests a print token via POST /api/print-token
 *   2. Server creates a signed token (5 min expiry, 1 resource, read-only)
 *   3. Client opens print window with ?pt=<printToken> (NOT ?t=<jwt>)
 *   4. Print route verifies the print token (not the JWT)
 *
 * Format: pt_<resourceType>.<resourceId>.<expiry>.<signature>
 */

import { createHmac } from 'node:crypto'

const PRINT_TOKEN_PREFIX = 'pt_'
const PRINT_TOKEN_TTL_MS = 5 * 60 * 1000 // 5 minutes

function getSigningKey(): string {
  return process.env.JWT_SECRET || 'itam-print-token-dev-key-change-me'
}

export type PrintResourceType =
  | 'work-order'
  | 'device'
  | 'stock-item'
  | 'purchase-order'
  | 'report'

/**
 * Create a short-lived print token for a specific resource.
 */
export function createPrintToken(
  resourceType: PrintResourceType,
  resourceId: string,
  userId: string,
): string {
  const expiry = Date.now() + PRINT_TOKEN_TTL_MS
  const payload = `${resourceType}.${resourceId}.${userId}.${expiry}`
  const sig = createHmac('sha256', getSigningKey())
    .update(payload)
    .digest('hex')
    .slice(0, 32)
  return `${PRINT_TOKEN_PREFIX}${resourceType}.${resourceId}.${userId}.${expiry}.${sig}`
}

export interface PrintTokenPayload {
  resourceType: PrintResourceType
  resourceId: string
  userId: string
  expiry: number
}

/**
 * Verify a print token and return its payload if valid.
 * Returns null if: invalid format, expired, or bad signature.
 */
export function verifyPrintToken(token: string): PrintTokenPayload | null {
  if (!token.startsWith(PRINT_TOKEN_PREFIX)) return null

  const stripped = token.slice(PRINT_TOKEN_PREFIX.length)
  const parts = stripped.split('.')
  if (parts.length !== 5) return null

  const [resourceType, resourceId, userId, expiryStr, sig] = parts
  const expiry = parseInt(expiryStr, 10)
  if (isNaN(expiry) || Date.now() > expiry) return null

  // Verify signature
  const expectedSig = createHmac('sha256', getSigningKey())
    .update(`${resourceType}.${resourceId}.${userId}.${expiry}`)
    .digest('hex')
    .slice(0, 32)
  if (sig !== expectedSig) return null

  return {
    resourceType: resourceType as PrintResourceType,
    resourceId,
    userId,
    expiry,
  }
}

/**
 * Extract print token from URL query parameter `pt`.
 */
export function extractPrintToken(url: URL): string | null {
  const pt = url.searchParams.get('pt')
  if (pt?.startsWith(PRINT_TOKEN_PREFIX)) return pt
  return null
}
