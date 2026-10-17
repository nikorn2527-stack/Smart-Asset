import { describe, expect, it } from 'vitest'
import {
  assertValidModuleConfiguration,
  isModuleEnabled,
  MODULES,
  type ModuleDefinition,
  type ModuleName,
} from '@/config/modules'

function withModule(
  name: ModuleName,
  patch: Partial<ModuleDefinition>,
): Record<ModuleName, ModuleDefinition> {
  return {
    ...MODULES,
    [name]: { ...MODULES[name], ...patch },
  }
}

describe('module manifest', () => {
  it('validates the production manifest', () => {
    expect(() => assertValidModuleConfiguration()).not.toThrow()
  })

  it('disables a module when one of its dependencies is disabled', () => {
    const definitions = withModule('meters', { enabled: false })
    expect(isModuleEnabled('paper-analytics', definitions)).toBe(false)
  })

  it('rejects a disabled required platform module', () => {
    const definitions = withModule('auth', { enabled: false })
    expect(() => assertValidModuleConfiguration(definitions)).toThrow(
      'Required module "auth" cannot be disabled.',
    )
  })

  it('rejects enabled modules with disabled dependencies', () => {
    const definitions = withModule('stock', { enabled: false })
    expect(() => assertValidModuleConfiguration(definitions)).toThrow(
      'Enabled module "work-orders" requires enabled dependency "stock".',
    )
  })
})
