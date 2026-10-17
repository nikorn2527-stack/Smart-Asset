/**
 * modules-loader.ts — DB-backed module flag loader with in-memory cache.
 *
 * Phase 4.7 implementation per consultant blueprint.
 *
 * - Reads ModuleFlag rows from DB with a 60-second in-memory cache so we
 *   don't hit the DB on every API request.
 * - Falls back to the bundled MODULES const from `config/modules.ts` when
 *   the DB is unreachable or the table is empty (zero-downtime rollout —
 *   a fresh install with no ModuleFlag rows works immediately).
 * - Seeds missing modules on first load: any module in MODULES that doesn't
 *   have a ModuleFlag row yet gets inserted with its default enabled/required
 *   values. This means new modules added in code are auto-created in DB
 *   without overwriting admin-set values for existing modules.
 *
 * Usage (server-only — imports Prisma client):
 *   import { loadModulesFromDB } from '@/lib/modules-loader'
 *   const modules = await loadModulesFromDB()
 *   if (!isModuleEnabled('devices', modules)) { return moduleUnavailableResponse('devices') }
 */

import { db } from '@/lib/db'
import {
  MODULES,
  MODULE_NAMES,
  type ModuleDefinition,
  type ModuleName,
} from '@/config/modules'

// ── In-memory cache ──────────────────────────────────────────────────
// 60-second TTL. Reset on module toggle (call `invalidateModuleCache()`).
let cached: Readonly<Record<ModuleName, ModuleDefinition>> | null = null
let cacheExpiry = 0
const CACHE_TTL_MS = 60_000 // 60 seconds

/** Invalidate the in-memory cache. Call after toggling a module. */
export function invalidateModuleCache(): void {
  cached = null
  cacheExpiry = 0
}

/**
 * Load module definitions from DB, merging with the bundled MODULES const.
 *
 * - If DB is unreachable: returns bundled MODULES (zero-downtime fallback).
 * - If DB has ModuleFlag rows: uses DB values for enabled/required.
 * - If DB is missing some modules (e.g. new module added in code): seeds
 *   them from MODULES defaults.
 * - Dependencies always come from the MODULES const (not DB) — they're
 *   a compile-time contract, not an admin-configurable value.
 */
export async function loadModulesFromDB(): Promise<Readonly<Record<ModuleName, ModuleDefinition>>> {
  // Return cached if still fresh
  if (cached && Date.now() < cacheExpiry) {
    return cached
  }

  try {
    // Read all ModuleFlag rows
    const flags = await db.moduleFlag.findMany()

    // If table is empty (fresh install), seed all modules from MODULES const
    if (flags.length === 0) {
      await seedAllModules()
      cached = { ...MODULES }
      cacheExpiry = Date.now() + CACHE_TTL_MS
      return cached
    }

    // Build merged definitions: DB values override MODULES const for
    // enabled/required, but dependencies stay from the const.
    const merged = { ...MODULES } as Record<ModuleName, ModuleDefinition>

    for (const flag of flags) {
      // Only accept flags for known module names (ignore stale DB rows
      // for modules that were removed from code)
      if (flag.name in MODULES) {
        merged[flag.name as ModuleName] = {
          ...MODULES[flag.name as ModuleName],
          enabled: flag.enabled,
          required: flag.required,
        }
      }
    }

    // Check for new modules in code that don't have DB rows yet — seed them
    const dbNames = new Set(flags.map((f) => f.name))
    const missing = MODULE_NAMES.filter((n) => !dbNames.has(n))
    if (missing.length > 0) {
      await db.moduleFlag.createMany({
        data: missing.map((name) => ({
          name,
          enabled: MODULES[name].enabled,
          required: MODULES[name].required,
        })),
      })
    }

    cached = merged
    cacheExpiry = Date.now() + CACHE_TTL_MS
    return cached
  } catch (err) {
    // DB unreachable — fall back to bundled MODULES const (zero-downtime)
    console.error('[modules-loader] DB load failed, using bundled MODULES:', err)
    cached = { ...MODULES }
    cacheExpiry = Date.now() + CACHE_TTL_MS
    return cached
  }
}

/** Seed all modules from MODULES const into DB. Called on first load. */
async function seedAllModules(): Promise<void> {
  await db.moduleFlag.createMany({
    data: MODULE_NAMES.map((name) => ({
      name,
      enabled: MODULES[name].enabled,
      required: MODULES[name].required,
    })),
  })
  console.log('[modules-loader] Seeded', MODULE_NAMES.length, 'modules from MODULES const')
}

/**
 * Save a module flag to DB + invalidate cache.
 * Called by /api/settings/modules endpoint.
 */
export async function setModuleFlag(
  name: ModuleName,
  enabled: boolean,
  updatedBy: string,
): Promise<void> {
  // Don't allow toggling required modules
  const current = MODULES[name]
  if (current.required) {
    throw new Error(`Module "${name}" is required and cannot be toggled.`)
  }

  await db.moduleFlag.upsert({
    where: { name },
    create: {
      name,
      enabled,
      required: current.required,
      updatedBy,
    },
    update: {
      enabled,
      updatedBy,
    },
  })

  invalidateModuleCache()
}

/**
 * Reset all module flags to defaults from MODULES const.
 * Called by "Reset to defaults" button in Settings UI.
 */
export async function resetModuleFlags(updatedBy: string): Promise<void> {
  await db.moduleFlag.deleteMany({})
  await seedAllModules()
  invalidateModuleCache()
}
