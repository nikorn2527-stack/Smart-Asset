/**
 * Module manifest — the single source of truth for optional ITAM capabilities.
 *
 * It is deliberately framework-independent so it can be validated in CI and
 * reused by navigation, API adapters, and future server-side feature gates.
 *
 * ════════════════════════════════════════════════════════════════════════
 * Phase 4.7 — Plan: migrate MODULES config to DB-backed (FUTURE WORK)
 * ════════════════════════════════════════════════════════════════════════
 * Today the MODULES table is a frozen compile-time constant. This is fine
 * for the open-source default install but doesn't support per-tenant
 * enable/disable, feature flags driven by billing plan, or runtime
 * toggles by an admin without redeploying.
 *
 * Planned migration (NOT YET IMPLEMENTED — Phase 4.7 only scopes the design):
 *
 *   1. Add a new `ModuleFlag` Prisma model:
 *        model ModuleFlag {
 *          name        String   @id   // matches ModuleName union
 *          enabled     Boolean  @default(true)
 *          required    Boolean  @default(false)
 *          updatedBy   String?
 *          updatedAt   DateTime @updatedAt
 *        }
 *      with seed rows mirroring the current MODULES const.
 *
 *   2. Add `loadModulesFromDB()` in a server-only module (e.g.
 *      `src/lib/modules-loader.ts`) that reads ModuleFlag rows with a
 *      60-second in-memory cache (LRU) so we don't hit the DB on every
 *      request. Falls back to the bundled MODULES const when the DB is
 *      unreachable or the table doesn't exist yet (zero-downtime rollout).
 *
 *   3. Replace `isModuleEnabled(name)` callers to consult the cache:
 *        const modules = await loadModulesFromDB()
 *        return isModuleEnabled(name, modules)
 *      (signature already accepts `definitions` param — pure additive.)
 *
 *   4. Add a `/api/settings/modules` admin endpoint (SYSTEM_CONFIG auth)
 *      to toggle flags. Audit-log every change.
 *
 *   5. Add a Settings UI tab "โมดูล" with a switch per module + a "reset
 *      to defaults" button.
 *
 *   6. Required-module rows (`required: true`) are READ-ONLY in the UI —
 *      the assertValidModuleConfiguration() guard already throws if a
 *      required module is disabled, so this stays enforced.
 *
 *   7. Dependency validation stays as-is — `assertValidModuleConfiguration`
 *      is already parameterized to accept any definitions object, so the
 *      DB-loaded table slots in without code changes to the validator.
 *
 * Out-of-scope for Phase 4.7: implementing any of the above. This comment
 * is the design record so the next agent picking up the migration has a
 * clear plan.
 * ════════════════════════════════════════════════════════════════════════
 */
export const MODULE_NAMES = [
  'auth',
  'authorization',
  'devices',
  'meters',
  'work-orders',
  'stock',
  'dashboard',
  'reports',
  'paper-analytics',
  'pm', // Phase 4.4: PM (Preventive Maintenance) — was missing
  'import',
  'templates',
  'stickers',
  'settings',
  'notifications',
  'audit',
  'sync',
] as const

export type ModuleName = (typeof MODULE_NAMES)[number]

export interface ModuleDefinition {
  /** Required platform modules cannot be disabled. */
  required: boolean
  /** Feature availability. Dependencies are also required to be enabled. */
  enabled: boolean
  /** Other modules that must be enabled before this module can be used. */
  dependencies: readonly ModuleName[]
}

export const MODULES: Readonly<Record<ModuleName, ModuleDefinition>> = {
  auth: { required: true, enabled: true, dependencies: [] },
  authorization: { required: true, enabled: true, dependencies: ['auth', 'audit'] },
  devices: { required: true, enabled: true, dependencies: ['authorization', 'audit'] },
  meters: { required: false, enabled: true, dependencies: ['devices', 'authorization'] },
  'work-orders': { required: false, enabled: true, dependencies: ['devices', 'stock', 'authorization'] },
  stock: { required: false, enabled: true, dependencies: ['authorization'] },
  dashboard: { required: false, enabled: true, dependencies: ['devices', 'meters', 'stock', 'work-orders'] },
  reports: { required: false, enabled: true, dependencies: ['devices', 'meters', 'stock', 'work-orders'] },
  'paper-analytics': { required: false, enabled: true, dependencies: ['meters', 'devices'] },
  pm: { required: false, enabled: true, dependencies: ['devices', 'work-orders'] }, // Phase 4.4
  import: { required: false, enabled: true, dependencies: ['devices', 'stock', 'audit'] },
  templates: { required: false, enabled: true, dependencies: ['authorization'] },
  stickers: { required: false, enabled: true, dependencies: ['devices', 'templates'] },
  settings: { required: false, enabled: true, dependencies: ['authorization', 'audit'] },
  notifications: { required: false, enabled: true, dependencies: ['auth', 'work-orders'] },
  audit: { required: true, enabled: true, dependencies: [] },
  sync: { required: false, enabled: true, dependencies: ['devices', 'stock', 'work-orders', 'audit'] },
}

export class ModuleConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModuleConfigurationError'
  }
}

/** Throws when required modules are disabled, dependencies are unavailable, or the graph cycles. */
export function assertValidModuleConfiguration(
  definitions: Readonly<Record<ModuleName, ModuleDefinition>> = MODULES,
): void {
  for (const name of MODULE_NAMES) {
    const definition = definitions[name]
    if (definition.required && !definition.enabled) {
      throw new ModuleConfigurationError(`Required module "${name}" cannot be disabled.`)
    }
    if (definition.enabled) {
      for (const dependency of definition.dependencies) {
        if (!definitions[dependency]?.enabled) {
          throw new ModuleConfigurationError(
            `Enabled module "${name}" requires enabled dependency "${dependency}".`,
          )
        }
      }
    }
  }

  const visiting = new Set<ModuleName>()
  const visited = new Set<ModuleName>()
  const visit = (name: ModuleName): void => {
    if (visited.has(name)) return
    if (visiting.has(name)) {
      throw new ModuleConfigurationError(`Circular module dependency detected at "${name}".`)
    }
    visiting.add(name)
    for (const dependency of definitions[name].dependencies) visit(dependency)
    visiting.delete(name)
    visited.add(name)
  }
  for (const name of MODULE_NAMES) visit(name)
}

/** Returns true only when the module and all of its dependencies are enabled. */
export function isModuleEnabled(
  name: ModuleName,
  definitions: Readonly<Record<ModuleName, ModuleDefinition>> = MODULES,
): boolean {
  const seen = new Set<ModuleName>()
  const isEnabled = (current: ModuleName): boolean => {
    if (seen.has(current)) return true
    seen.add(current)
    const definition = definitions[current]
    return definition.enabled && definition.dependencies.every(isEnabled)
  }
  return isEnabled(name)
}

assertValidModuleConfiguration()
