/**
 * /api/settings/modules — admin endpoint for module enable/disable.
 *
 * GET  → returns all module flags + metadata (enabled, required, deps)
 * POST → toggles a single module's enabled flag (with dependency validation)
 * DELETE → resets all modules to defaults from MODULES const
 *
 * Requires SYSTEM_CONFIG permission (admin only).
 * All mutations are audit-logged.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import {
  MODULES,
  MODULE_NAMES,
  assertValidModuleConfiguration,
  type ModuleName,
} from '@/config/modules'
import {
  loadModulesFromDB,
  setModuleFlag,
  resetModuleFlags,
} from '@/lib/modules-loader'
import { requireAuth } from '@/lib/auth-middleware'

// ── GET: list all modules ────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const modules = await loadModulesFromDB()
    const result = MODULE_NAMES.map((name) => ({
      name,
      enabled: modules[name].enabled,
      required: modules[name].required,
      dependencies: [...modules[name].dependencies],
    }))
    return NextResponse.json({ modules: result })
  } catch (err) {
    console.error('[/api/settings/modules] GET error:', err)
    return NextResponse.json({ error: 'Failed to load modules' }, { status: 500 })
  }
}

// ── POST: toggle a single module ──────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await req.json()
    const { name, enabled } = body as { name: string; enabled: boolean }

    // Validate module name exists
    if (!MODULE_NAMES.includes(name as ModuleName)) {
      return NextResponse.json({ error: `Unknown module: ${name}` }, { status: 400 })
    }

    const moduleName = name as ModuleName

    // Don't allow toggling required modules
    if (MODULES[moduleName].required) {
      return NextResponse.json(
        { error: `Module "${moduleName}" is required and cannot be disabled.` },
        { status: 400 },
      )
    }

    // Build the hypothetical new configuration to validate dependencies
    const currentModules = await loadModulesFromDB()
    const hypothetical = { ...currentModules } as Record<ModuleName, { required: boolean; enabled: boolean; dependencies: readonly ModuleName[] }>
    ;(hypothetical as Record<ModuleName, { required: boolean; enabled: boolean; dependencies: readonly ModuleName[] }>)[moduleName] = {
      ...MODULES[moduleName],
      enabled,
    }

    // Validate: if disabling, check that no enabled module depends on this one
    try {
      assertValidModuleConfiguration(hypothetical)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Validation failed'
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    // Save to DB
    const updatedBy = auth.user?.email || auth.row?.email || "unknown" || 'unknown'
    await setModuleFlag(moduleName, enabled, updatedBy)

    // Audit log
    await logAudit(
      'UPDATE',
      'ModuleFlag',
      moduleName,
      `Module "${moduleName}" ${enabled ? 'enabled' : 'disabled'} by ${updatedBy}`,
      { module: moduleName, enabled },
    )

    return NextResponse.json({ ok: true, module: moduleName, enabled })
  } catch (err) {
    console.error('[/api/settings/modules] POST error:', err)
    return NextResponse.json({ error: 'Failed to update module' }, { status: 500 })
  }
}

// ── DELETE: reset all modules to defaults ────────────────────────────
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const updatedBy = auth.user?.email || auth.row?.email || "unknown" || 'unknown'
    await resetModuleFlags(updatedBy)

    // Audit log
    await logAudit(
      'RESET',
      'ModuleFlag',
      null,
      `All modules reset to defaults by ${updatedBy}`,
      {},
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[/api/settings/modules] DELETE error:', err)
    return NextResponse.json({ error: 'Failed to reset modules' }, { status: 500 })
  }
}
