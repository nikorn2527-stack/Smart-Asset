import type { AuthUser } from './auth-shared'

export interface StockTransactionIdentity {
  requester: string
  performedBy: string
}

/**
 * Resolve audit identity from the authenticated account only.
 * Client-provided names must never be used for stock mutations.
 */
export function resolveStockTransactionIdentity(
  user: Pick<AuthUser, 'email' | 'name' | 'username'>,
): StockTransactionIdentity {
  const requester = user.name?.trim() || user.username?.trim() || user.email
  return {
    requester,
    performedBy: user.email,
  }
}
