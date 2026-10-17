/**
 * migrate-license-device-id.ts — Backfill LicenseRecord.deviceId from Asset_No.
 *
 * Task ID: PUBLIC-QR-2E-LICENSE-MIGRATION-IMPORTS
 *
 * Background:
 *   PUBLIC-QR-PHASE-1-SCHEMA added a real FK `deviceId` (→ Device.id) on
 *   LicenseRecord. Existing license rows have `Asset_No` (string) set but
 *   `deviceId` is NULL — they were created before the FK existed. This
 *   script backfills the FK so future queries can use the indexed
 *   deviceId column instead of the Asset_No string lookup (the legacy
 *   `where: { Asset_No: code }` pattern in /api/devices/[id]/licenses).
 *
 * Strategy:
 *   1. Find all licenses with deviceId=NULL AND Asset_No set (non-empty).
 *   2. Group by Asset_No to batch-query matching Devices (by assetCode).
 *   3. For each license with a matching Device: set deviceId.
 *      For each license without a match: log as orphan (no destructive action).
 *   4. Print summary: total, migrated, orphans, skipped (already has deviceId).
 *
 * Idempotent: only touches licenses where deviceId IS NULL — safe to re-run.
 * No DELETE, no UPDATE on Asset_No — purely additive backfill.
 *
 * Usage:
 *   bun run scripts/migrate-license-device-id.ts
 *
 * Exit codes:
 *   0 — migration completed cleanly (orphans are reported but not fatal)
 *   1 — fatal error during migration (DB connection, schema mismatch, etc.)
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  // ── 1. Find all licenses needing migration ──
  // (deviceId IS NULL) AND (Asset_No IS NOT NULL) AND (Asset_No != '')
  const licenses = await db.licenseRecord.findMany({
    where: {
      AND: [
        { deviceId: null },
        { NOT: { Asset_No: null } },
        { NOT: { Asset_No: '' } },
      ],
    },
    select: { id: true, Asset_No: true, Software: true },
  })

  const totalCount = await db.licenseRecord.count()
  const alreadyHasDeviceId = totalCount - licenses.length

  console.log('License deviceId backfill — PUBLIC-QR-PHASE-1-SCHEMA')
  console.log('─'.repeat(60))
  console.log(`Total license records:        ${totalCount}`)
  console.log(`Already have deviceId set:    ${alreadyHasDeviceId} (skipped)`)
  console.log(`Need migration (deviceId=NULL): ${licenses.length}`)
  console.log('─'.repeat(60))

  if (licenses.length === 0) {
    console.log('\n✅ Nothing to migrate — all license records already have deviceId set.')
    return
  }

  // ── 2. Group by Asset_No to batch-query devices ──
  // Distinct Asset_No values — we look each one up to find the matching Device.id.
  const assetNos = [...new Set(licenses.map((l) => l.Asset_No!))]
  console.log(`\nResolving ${assetNos.length} distinct Asset_No → Device.id...`)

  const devices = await db.device.findMany({
    where: { assetCode: { in: assetNos } },
    select: { id: true, assetCode: true },
  })
  const assetToDevice = new Map<string, string>()
  for (const d of devices) {
    assetToDevice.set(d.assetCode, d.id)
  }
  console.log(`  Found ${devices.length} matching devices.`)

  // ── 3. Update each license ──
  // Per-row update (not updateMany) because we want to count migrated vs orphan.
  let migrated = 0
  let orphans = 0
  const orphanList: { licenseId: string; asset_no: string; software: string }[] = []

  for (const lic of licenses) {
    const deviceId = assetToDevice.get(lic.Asset_No!)
    if (deviceId) {
      await db.licenseRecord.update({
        where: { id: lic.id },
        data: { deviceId },
      })
      migrated++
    } else {
      orphans++
      orphanList.push({
        licenseId: lic.id,
        asset_no: lic.Asset_No!,
        software: lic.Software,
      })
    }
  }

  // ── 4. Summary ──
  console.log('\n' + '═'.repeat(60))
  console.log('Migration complete:')
  console.log(`  ✓ Migrated:                  ${migrated}`)
  console.log(`  ⚠ Orphans (no matching device): ${orphans}`)
  console.log('═'.repeat(60))

  if (orphans > 0) {
    console.log('\nOrphan licenses (no Device with matching assetCode):')
    const shown = orphanList.slice(0, 20)
    for (const o of shown) {
      console.log(`  ${o.licenseId} — asset_no=${o.asset_no} — software=${o.software}`)
    }
    if (orphanList.length > 20) {
      console.log(`  ... and ${orphanList.length - 20} more.`)
    }
    console.log('\nOrphan licenses keep their Asset_No string and deviceId=NULL.')
    console.log('They remain queryable via the legacy Asset_No path until manually resolved.')
  }

  // ── 5. Verify final state ──
  const finalTotal = await db.licenseRecord.count()
  const finalWithDevice = await db.licenseRecord.count({
    where: { NOT: { deviceId: null } },
  })
  const finalOrphans = await db.licenseRecord.count({
    where: {
      AND: [{ deviceId: null }, { NOT: { Asset_No: null } }, { NOT: { Asset_No: '' } }],
    },
  })

  console.log('\n─'.repeat(60))
  console.log('Final state:')
  console.log(`  Total:           ${finalTotal}`)
  console.log(`  With deviceId:   ${finalWithDevice} (${((finalWithDevice / finalTotal) * 100).toFixed(1)}%)`)
  console.log(`  Still orphan:    ${finalOrphans}`)
  console.log('─'.repeat(60))
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((err) => {
    console.error('Migration failed:')
    console.error(err)
    process.exit(1)
  })
  .finally(() => {
    void db.$disconnect()
  })
