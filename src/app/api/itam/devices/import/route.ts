import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { logAudit } from '@/lib/audit'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import {
  parseDeviceImportCsv,
  validateDeviceImportRows,
  type DeviceImportRow,
} from '@/lib/device-import-contract'
import {
  findExistingAssetCodes,
  persistDevices,
  type PersistResult,
} from '@/lib/device-import-persistence'

// Heavy operation — needs longer timeout (Vercel Hobby: max 60s)
export const maxDuration = 60

/**
 * POST /api/itam/devices/import
 *
 * Devices Module — Device importer boundary (Work Package C)
 * Owner: Dev-3 / Asset & Meter Team
 *
 * Imports devices from CSV text. The HTTP route is orchestration
 * only — parsing/validation live in `src/lib/device-import-contract.ts`
 * (pure functions) and persistence lives in
 * `src/lib/device-import-persistence.ts` (DB-only).
 *
 * Flow:
 *   1. Auth (DEVICE_EDIT)
 *   2. Parse CSV → DeviceImportRow[] (pure, no DB)
 *   3. Site scope check per row (fail-closed before any DB query)
 *   4. Pre-check existing assetCodes (one bounded DB lookup)
 *   5. Validate rows (pure, with existingAssetCodes context)
 *   6. Persist validated rows (DB only, mode-aware)
 *   7. Audit summary (no secret values)
 *
 * Body:
 *   { csv: string, mode?: 'upsert' | 'create_only' | 'update_only' }
 *
 * Returns:
 *   { inserted, updated, skipped, errors, byRow, total, valid,
 *     duplicateInFile, duplicateInDb, mode }
 *
 * Reconciliation:
 *   - Match by assetNo (case-insensitive; canonical = assetCode in DB)
 *   - mode='upsert'      → create new, update existing
 *   - mode='create_only' → only insert new; existing skipped
 *   - mode='update_only' → only update existing; new skipped
 *
 * Permission: DEVICE_EDIT
 * Site scope: enforced per-row via buildAuthorizationContext (B4 frozen)
 *
 * Governance:
 *   - B4 frozen files untouched
 *   - No `prisma db:push`
 *   - No SYNC_RUN permission added
 *   - Source CSV contract preserved (legacy headers accepted:
 *     assetNo, asset_code, assetCode, deviceType, Thai labels, etc.)
 *   - No secret values in audit/evidence
 */
const MAX_IMPORT_ROWS = 5000

export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  try {
    // ── 1. Auth ────────────────────────────────────────────────────
    const auth = await requireAuth(req, 'DEVICE_EDIT')
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    const user = auth.user

    // `user` is the sanitized AuthUser (no `id` — it is deliberately omitted from
    // the client-facing shape). The stable id lives on `auth.row`
    // (UserPermissionRow), which is what buildAuthorizationContext needs to look
    // up Site grants.
    const ctx = await buildAuthorizationContext(user, auth.row.id, user.allowedSites)

    // ── 2. Parse request body ──────────────────────────────────────
    const body = await req.json()
    const csvText: string = typeof body.csv === 'string' ? body.csv : ''
    if (!csvText.trim()) {
      return NextResponse.json(
        { error: 'csv text required' },
        { status: 400 },
      )
    }
    const mode: 'upsert' | 'create_only' | 'update_only' =
      body.mode ?? 'upsert'
    if (!['upsert', 'create_only', 'update_only'].includes(mode)) {
      return NextResponse.json(
        { error: `invalid mode: ${mode} (expected upsert|create_only|update_only)` },
        { status: 400 },
      )
    }

    // ── 3. Parse CSV (pure function — no DB) ───────────────────────
    const parseResult = parseDeviceImportCsv(csvText)
    if (parseResult.rows.length === 0) {
      return NextResponse.json(
        {
          error: 'no rows to import',
          errors: parseResult.errors,
        },
        { status: 400 },
      )
    }

    // Reject early if parser detected missing header
    const headerError = parseResult.errors.find((e) => e.rowNumber === 1 && e.field === 'assetNo')
    if (headerError) {
      return NextResponse.json(
        { error: headerError.message },
        { status: 400 },
      )
    }

    // Enforce hard upper bound on rows
    if (parseResult.rows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        {
          error: `import exceeds limit: ${parseResult.rows.length} rows > ${MAX_IMPORT_ROWS} max`,
          total: parseResult.rows.length,
          max: MAX_IMPORT_ROWS,
        },
        { status: 413 },
      )
    }

    // ── 4. Per-row site scope check (fail-closed before DB) ──────
    const siteErrors: Array<{ rowNumber: number; field: string; message: string }> = []
    for (const row of parseResult.rows) {
      const csvSite = row.values.site
      if (!ctx.isSuperAdmin && csvSite) {
        const targetSite = csvSite.toUpperCase()
        const allowed = (ctx.siteScope.siteCodes ?? []).map((s) => s.toUpperCase())
        if (!allowed.includes(targetSite)) {
          siteErrors.push({
            rowNumber: row.rowNumber,
            field: 'site',
            message: `ไม่มีสิทธิ์นำเข้าอุปกรณ์ที่สาขา '${csvSite}' (assetNo=${row.values.assetNo})`,
          })
        }
      }
    }
    if (siteErrors.length > 0) {
      return NextResponse.json(
        {
          error: 'site scope violation — see siteErrors for details',
          siteErrors,
          totalRows: parseResult.rows.length,
        },
        { status: 403 },
      )
    }

    // ── 5. Pre-check existing assetCodes (one bounded DB query) ────
    const allAssetNos = parseResult.rows.map((r) => r.values.assetNo)
    const existingAssetCodes = await findExistingAssetCodes(allAssetNos)

    // ── 6. Validate rows (pure function — no DB) ──────────────────
    // For mode='create_only', existing assetCodes should be flagged as
    // skipped (not errors). The validator handles duplicate-in-file;
    // mode-aware duplicate-in-DB handling happens in persistence.
    const validationResult = validateDeviceImportRows(parseResult.rows)

    // ── 7. Persist (DB only — takes validated rows) ────────────────
    const persistResult: PersistResult = await persistDevices(
      validationResult.validRows,
      existingAssetCodes,
      {
        mode,
        actor: user.email || user.username || 'unknown',
      },
    )

    // ── 8. Build byRow summary (per-row result for caller) ────────
    const byRow = parseResult.rows.map((row) => {
      const assetNo = row.values.assetNo
      const validationError = validationResult.errors.find(
        (e) => e.rowNumber === row.rowNumber,
      )
      if (validationError) {
        return {
          row: row.rowNumber,
          assetNo,
          action: 'skip',
          ok: false,
          error: validationError.message,
        }
      }
      const isInDb = existingAssetCodes.has(assetNo.toLowerCase())
      if (isInDb) {
        if (mode === 'create_only') {
          return {
            row: row.rowNumber,
            assetNo,
            action: 'skip-existing',
            ok: true,
          }
        }
        return {
          row: row.rowNumber,
          assetNo,
          action: 'update',
          ok: persistResult.errors.length === 0,
        }
      }
      if (mode === 'update_only') {
        return {
          row: row.rowNumber,
          assetNo,
          action: 'skip-missing',
          ok: true,
        }
      }
      return {
        row: row.rowNumber,
        assetNo,
        action: 'create',
        ok: persistResult.errors.length === 0,
      }
    })

    // ── 9. Audit summary (single entry, no secrets) ───────────────
    try {
      await logAudit(
        'IMPORT',
        'Device',
        null,
        `นำเข้าอุปกรณ์ CSV: mode=${mode}, inserted=${persistResult.inserted}, updated=${persistResult.updated}, skipped=${persistResult.skipped}`,
        {
          mode,
          totalRows: parseResult.rows.length,
          validRows: validationResult.validRows.length,
          inserted: persistResult.inserted,
          updated: persistResult.updated,
          skipped: persistResult.skipped,
          errorCount:
            validationResult.errors.length + persistResult.errors.length,
          duplicateInFile: validationResult.errors
            .filter((e) => /duplicate/i.test(e.message))
            .map((e) => e.message),
          duplicateInDb: persistResult.duplicateInDb,
          maxImportRows: MAX_IMPORT_ROWS,
        },
      )
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr)
      // Don't fail the request — audit failure is logged but not user-facing
    }

    // ── 10. Return result ─────────────────────────────────────────
    const allErrors = [
      ...validationResult.errors.map((e) => ({
        row: e.rowNumber,
        field: e.field,
        message: e.message,
      })),
      ...persistResult.errors.map((e) => ({
        row: e.rowNumber,
        field: e.field,
        message: e.message,
      })),
    ]

    return NextResponse.json(
      {
        inserted: persistResult.inserted,
        updated: persistResult.updated,
        skipped: persistResult.skipped,
        errors: allErrors,
        byRow,
        total: parseResult.rows.length,
        valid: validationResult.validRows.length,
        duplicateInDb: persistResult.duplicateInDb,
        mode,
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('POST /api/itam/devices/import', err)
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to import devices') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Helper type for tests that import this route
export type { DeviceImportRow }
