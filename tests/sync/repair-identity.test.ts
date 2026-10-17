import { describe, expect, it } from 'vitest'
import { resolveRepairRequester } from '@/lib/repair-identity'

describe('resolveRepairRequester', () => {
  it('prefers the authenticated display name', () => {
    expect(
      resolveRepairRequester({
        name: '  Nikorn P.  ',
        email: 'nikorn.p@example.com',
      }),
    ).toBe('Nikorn P.')
  })

  it('falls back to the authenticated email when name is blank', () => {
    expect(
      resolveRepairRequester({
        name: '   ',
        email: 'staff@example.com',
      }),
    ).toBe('staff@example.com')
  })

  it('falls back to the authenticated email when name is absent', () => {
    expect(resolveRepairRequester({ email: 'viewer@example.com' })).toBe(
      'viewer@example.com',
    )
  })
})
