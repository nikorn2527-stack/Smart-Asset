import { NextResponse } from 'next/server'
import { isModuleEnabled, type ModuleName } from '@/config/modules'
import { loadModulesFromDB } from '@/lib/modules-loader'

/**
 * Returns a 404 response when an optional module is disabled.
 *
 * Phase 4.7 update: now reads from DB via loadModulesFromDB() so that
 * admin-toggled module flags (via /api/settings/modules) take effect
 * immediately across all API routes — not just the sidebar menu.
 *
 * The function is async because loadModulesFromDB() may hit the DB (with
 * a 60-second in-memory cache). If the DB is unreachable, it falls back
 * to the bundled MODULES const (zero-downtime).
 *
 * Route adapters must call this before authentication and data access so a
 * disabled feature has no observable API surface.
 *
 * Usage:
 *   const unavailable = await moduleUnavailableResponse('devices')
 *   if (unavailable) return unavailable
 */
export async function moduleUnavailableResponse(
  module: ModuleName,
): Promise<NextResponse | null> {
  // Load current module flags from DB (cached for 60s)
  const modules = await loadModulesFromDB()

  if (isModuleEnabled(module, modules)) return null

  return NextResponse.json(
    {
      error: {
        code: 'MODULE_DISABLED',
        message: `Module "${module}" is disabled.`,
      },
    },
    { status: 404 },
  )
}

/**
 * Synchronous fallback for routes that can't use async (rare).
 * Uses the bundled MODULES const — does NOT reflect DB-toggled flags.
 * Prefer the async version above for all new code.
 */
export function moduleUnavailableResponseSync(module: ModuleName): NextResponse | null {
  if (isModuleEnabled(module)) return null

  return NextResponse.json(
    {
      error: {
        code: 'MODULE_DISABLED',
        message: `Module "${module}" is disabled.`,
      },
    },
    { status: 404 },
  )
}
