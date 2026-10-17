import { describe, expect, it } from 'vitest'
import { resolveStockTransactionIdentity } from '@/lib/stock-transaction-identity'

const baseUser = {
  email: 'staff@example.com',
  role: 'editor' as const,
  allowedSites: 'ALL' as const,
  permissions: ['STOCK_OUT'] as const,
  isDemo: false,
}

describe('resolveStockTransactionIdentity', () => {
  it('prefers the authenticated display name for OUT requester', () => {
    expect(
      resolveStockTransactionIdentity({
        ...baseUser,
        name: '  Staff Member  ',
        username: 'staff',
      }),
    ).toEqual({
      requester: 'Staff Member',
      performedBy: 'staff@example.com',
    })
  })

  it('falls back to username and then email', () => {
    expect(
      resolveStockTransactionIdentity({
        ...baseUser,
        name: ' ',
        username: '  staff  ',
      }),
    ).toEqual({ requester: 'staff', performedBy: 'staff@example.com' })

    expect(
      resolveStockTransactionIdentity({
        ...baseUser,
        name: null,
        username: null,
      }),
    ).toEqual({ requester: 'staff@example.com', performedBy: 'staff@example.com' })
  })

  it('does not accept a client-supplied identity as part of the resolver input', () => {
    const identity = resolveStockTransactionIdentity({
      ...baseUser,
      name: 'Authenticated Staff',
      username: 'staff',
    })
    expect(identity.requester).not.toBe('spoofed-client-user')
    expect(identity.performedBy).not.toBe('spoofed-client-user@example.com')
  })
})
