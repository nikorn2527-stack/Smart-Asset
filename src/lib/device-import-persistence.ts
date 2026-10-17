// ============================================================
// Device Import — Persistence boundary (DB-only layer)
// ============================================================
// Module: Devices (Dev-3 / Asset & Meter Team)
// Work Package: C — Device importer boundary
//
// Purpose: persist validated DeviceImportRow[] to the database.
//   - Takes ONLY already-validated rows (parser+validator did their job)
//   - Idempotent by assetCode (Prisma unique constraint)
//   - Honors import mode: upsert / create_only / update_only
//   - Bounded by MAX_IMPORT_ROWS (enforced upstream in parser)
//   - Batches DB writes (createMany for inserts, transaction for updates)
//   - One bounded DB lookup for existing assetCodes (Set-based)
//   - Audit summary does not leak secret values
//
// Built on top of the contract from `device-import-contract.ts`
// (committed by another team member). This file adds the persistence
// layer that was missing.
//
// Governance: B4 frozen files untouched. No `prisma db:push`. No
// SYNC_RUN permission added.
// ============================================================

import { db, getBaseClient } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { ciEquals, ciIn } from '@/lib/prisma-filters'
import type { DeviceImportRow } from '@/lib/device-import-contract'

/**
 * Canonical mapping from legacy CSV field name → Prisma field name.
 * The CSV uses `assetNo` (legacy) but Prisma's Device model uses
 * `assetCode` (canonical). This is the only place that translation
 * happens for persistence — keeping it centralized.
 */
const CSV_TO_PRISMA_FIELD: Record<string, string> = {
  assetNo: 'assetCode',
  deviceType: 'type', // schema column is `type` not `deviceType`
  serial: 'serialNumber',
  installDate: 'purchaseDate', // legacy "installDate" → schema purchaseDate
  // brand, model, status, site, building, floor, department,
  // departmentCode, location, deviceGroup, costCenter, contractNo,
  // vendor, ip, mac, remoteId, warrantyEnd, meterRequired,
  // meterMode, assetSiteCode, remark → same name in Prisma
}

/**
 * Convert a validated DeviceImportRow into the shape Prisma expects
 * for `db.device.create()` / `.update()`. Centralizes the mapping
 * so the route doesn't repeat it.
 */
function toPrismaData(row: DeviceImportRow, actor: string) {
  const v = row.values
  const data: Record<string, unknown> = {
    assetCode: v.assetNo,
    // CONSULTING-007: prefer explicit `name` field; fall back to deviceType
    // (legacy contract behavior) when CSV omits the name column.
    name: v.name ?? v.deviceType ?? 'Unknown',
    brand: v.brand ?? 'Unknown',
    model: v.model ?? 'Unknown',
    type: (v.deviceType ?? 'OTHER').toUpperCase(),
    serialNumber: v.serial,
    status: (v.status ?? 'Active').toLowerCase(),
    site: v.site ?? 'HQ',
    department: v.department,
    departmentCode: v.departmentCode,
    location: v.location,
    building: v.building,
    floor: v.floor,
    purchaseDate: v.installDate,
    warrantyEnd: v.warrantyEnd,
    // CONSULTING-007: warrantyMonths is now part of the contract; default
    // to 12 (matches Prisma schema default) when CSV omits the column.
    warrantyMonths: v.warrantyMonths ?? 12,
    vendor: v.vendor,
    contractNo: v.contractNo,
    costCenter: v.costCenter,
    deviceGroup: v.deviceGroup,
    ip: v.ip,
    mac: v.mac,
    remoteId: v.remoteId,
    meterRequired: v.meterRequired ?? false,
    meterMode: v.meterMode,
    assetSiteCode: v.assetSiteCode,
    remark: v.remark,
    updatedBy: actor,
  }
  // The builder assembles a `Record<string, unknown>` from CSV columns, so it is
  // not structurally a DeviceCreateManyInput. Assert the shape here (once, at
  // the builder) rather than at the createMany() call site.
  return data as unknown as Prisma.DeviceCreateManyInput
}

/**
 * Look up which assetCodes (assetNo values) already exist in the DB.
 * Returns a Set for O(1) membership checks.
 *
 * Used by the HTTP route to populate the validator's
 * `existingAssetCodes` option before calling `validateDeviceImportRows()`.
 *
 * Single bounded query — not per-row findUnique (avoids N+1).
 */
export async function findExistingAssetCodes(
  assetCodes: string[],
): Promise<Set<string>> {
  if (assetCodes.length === 0) return new Set<string>()
  // Use case-insensitive match to handle mixed-case DB values
  const existing = await db.device.findMany({
    where: {
      assetCode: ciIn(assetCodes),
    },
    select: { assetCode: true },
  })
  return new Set(existing.map((d) => d.assetCode.toLowerCase()))
}

/**
 * Persist validated rows to the database.
 *
 * Behavior per mode:
 *   - 'upsert'      → create new, update existing
 *   - 'create_only' → only insert new; existing are skipped
 *   - 'update_only' → only update existing; new are skipped
 *
 * Strategy: split rows into `toCreate` and `toUpdate` lists based
 * on `existingAssetCodes`, then use `createMany` for inserts and
 * a transaction-wrapped loop of `update` for updates.
 *
 * Errors are reported per row with field + message.
 *
 * Returns a summary that the route can audit + return to caller.
 */
export interface PersistOptions {
  mode: 'upsert' | 'create_only' | 'update_only'
  actor: string // authenticated user identity (email or username)
}

export interface PersistResult {
  inserted: number
  updated: number
  skipped: number
  errors: Array<{ rowNumber: number; field?: string; message: string }>
  duplicateInDb: string[]
  summary: {
    total: number
    valid: number
    inserted: number
    updated: number
    skipped: number
    errorCount: number
  }
}

export async function persistDevices(
  validatedRows: DeviceImportRow[],
  existingAssetCodes: Set<string>,
  opts: PersistOptions,
): Promise<PersistResult> {
  const errors: PersistResult['errors'] = []
  const duplicateInDb: string[] = []
  const { mode, actor } = opts

  const toCreate: DeviceImportRow[] = []
  const toUpdate: DeviceImportRow[] = []

  for (const row of validatedRows) {
    const key = row.values.assetNo.toLowerCase()
    const exists = existingAssetCodes.has(key)
    if (exists) {
      duplicateInDb.push(row.values.assetNo)
      if (mode === 'create_only') {
        // Already filtered by validator; should not reach here, but be safe
        continue
      }
      toUpdate.push(row)
    } else {
      if (mode === 'update_only') {
        continue
      }
      toCreate.push(row)
    }
  }

  let inserted = 0
  let updated = 0
  const skipped = validatedRows.length - toCreate.length - toUpdate.length

  // ── Batch insert (createMany — single query) ────────────────────
  if (toCreate.length > 0) {
    try {
      const result = await db.device.createMany({
        data: toCreate.map((r) => toPrismaData(r, actor)),
        // `skipDuplicates` omitted — unsupported (typed `never`) on the SQLite
        // datasource. The validator already de-duplicated assetCodes.
      })
      inserted = result.count
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push({
        rowNumber: 0,
        field: 'createMany',
        message: `DB insert failed: ${msg}`,
      })
    }
  }

  // ── Per-row update (transaction for atomicity) ──────────────────
  if (toUpdate.length > 0) {
    try {
      await getBaseClient().$transaction(
        toUpdate.map((row) =>
          db.device.updateMany({
            where: {
              assetCode: ciEquals(row.values.assetNo),
            },
            data: toPrismaData(row, actor),
          }),
        ),
      )
      updated = toUpdate.length
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push({
        rowNumber: 0,
        field: 'update',
        message: `DB update failed: ${msg}`,
      })
    }
  }

  const summary = {
    total: validatedRows.length,
    valid: validatedRows.length,
    inserted,
    updated,
    skipped,
    errorCount: errors.length,
  }

  return { inserted, updated, skipped, errors, duplicateInDb, summary }
}

// Re-export the field map for tests / consumers that need it
export { CSV_TO_PRISMA_FIELD }
