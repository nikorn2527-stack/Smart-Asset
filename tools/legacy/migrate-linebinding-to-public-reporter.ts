/**
 * migrate-linebinding-to-public-reporter.ts
 *
 * Task ID: PHASE-3-LINEBINDING-MIGRATION
 *
 * Background:
 *   Phase 1 of LINE-WEBHOOK-FIX-PHASES-1-2-4 closed the webhook WO-creation
 *   bypass — the webhook now replies with Smart QR repair links instead of
 *   creating WorkOrders directly. As a result, the `LineBinding` table is now
 *   legacy: it's a passive record of "which LINE users added the OA as a
 *   friend" and is no longer the system of record for "person who reported
 *   via LINE". That role now belongs to `PublicReporter`, which has a richer
 *   schema (phone verification, anti-spam fields, defaultDeviceId, etc.) and
 *   is keyed by `(siteCode, lineUserId)` unique — so one LINE user can be a
 *   reporter at multiple sites.
 *
 *   This script migrates the legacy LineBinding rows into PublicReporter so
 *   all "person who reported via LINE" data lives in one place.
 *
 * Strategy:
 *   1. For each LineBinding:
 *      a. Find the most recent WorkOrder with `lineUserId === binding.lineUserId`
 *         (orderBy createdAt desc).
 *      b. Resolve the siteCode:
 *         - If WorkOrder.siteCode is set → use it.
 *         - Else if WorkOrder.deviceId is set → fetch Device, use Device.site.
 *         - Else → orphaned binding (no way to know the site), log + skip.
 *      c. Verify the siteCode exists in SiteAttribute (FK constraint on
 *         PublicReporter.siteCode → SiteAttribute.SiteCode, onDelete:
 *         Restrict). If not, log + skip.
 *      d. Upsert PublicReporter by (siteCode, lineUserId):
 *         - If exists → merge:
 *             * lineDisplayName: set if currently null and we have one
 *             * linePictureUrl: set if currently null (LineBinding has none,
 *               but kept for forward-compat)
 *             * reportCount = max(existing, binding.workOrderCount)
 *             * lastReportAt: bump if newer than existing (we use the WO's
 *               createdAt as proxy; LineBinding has no lastWoAt field)
 *         - If new → create with:
 *             * siteCode, lineUserId, lineDisplayName from binding
 *             * phoneVerified = false (LineBinding never verified phone)
 *             * reportCount = binding.workOrderCount
 *             * lastReportAt = binding's most recent WO createdAt (if any)
 *   2. Print summary: total, migrated (new), merged (updated), skipped
 *      (orphaned / invalid site), errors.
 *   3. DO NOT delete LineBinding records (leave them for safety; can drop
 *      in a later cleanup after confirming the migration succeeded).
 *
 * Idempotent:
 *   - Re-running on an already-migrated row will:
 *     * Find the existing PublicReporter by (siteCode, lineUserId).
 *     * Skip the merge update if lineDisplayName is already set AND
 *       reportCount >= binding.workOrderCount (no-op).
 *     * Else apply a conservative merge (max(reportCount), set displayName
 *       only if currently null).
 *   - Safe to run multiple times. No destructive operations.
 *
 * Usage:
 *   bun run scripts/migrate-linebinding-to-public-reporter.ts
 *
 * Exit codes:
 *   0 — migration completed cleanly (orphans/errors are reported but not fatal)
 *   1 — fatal error during migration (DB connection, schema mismatch, etc.)
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

interface OrphanRecord {
  lineUserId: string
  displayName: string | null
  reason: string
}

interface ErrorRecord {
  lineUserId: string
  error: string
}

async function main() {
  // ── 1. Load all LineBindings ──
  const bindings = await db.lineBinding.findMany({
    select: {
      id: true,
      lineUserId: true,
      lineDisplayName: true,
      reporterName: true,
      tel: true,
      employeeCode: true,
      workOrderCount: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  const totalReporters = await db.publicReporter.count()

  console.log('LineBinding → PublicReporter migration — PHASE-3-LINEBINDING-MIGRATION')
  console.log('─'.repeat(70))
  console.log(`Total LineBindings:           ${bindings.length}`)
  console.log(`Existing PublicReporters:     ${totalReporters}`)
  console.log('─'.repeat(70))

  if (bindings.length === 0) {
    console.log('\n✅ Nothing to migrate — LineBinding table is empty.')
    return
  }

  // ── 2. Cache all valid siteCodes (FK target) ──
  // PublicReporter.siteCode → SiteAttribute.SiteCode (onDelete: Restrict).
  // We must not create a PublicReporter with a siteCode that doesn't exist.
  const sites = await db.siteAttribute.findMany({
    select: { SiteCode: true },
  })
  const validSiteCodes = new Set(sites.map((s) => s.SiteCode))
  console.log(`Valid siteCodes (SiteAttribute): ${validSiteCodes.size}`)
  console.log('─'.repeat(70))

  // ── 3. For each binding, resolve siteCode via most-recent WorkOrder ──
  let migrated = 0 // created new PublicReporter
  let merged = 0 // updated existing PublicReporter
  let skippedOrphan = 0 // no WO found → can't resolve site
  let skippedInvalidSite = 0 // WO has siteCode but it's not in SiteAttribute
  let errors = 0
  const orphanList: OrphanRecord[] = []
  const errorList: ErrorRecord[] = []

  for (const binding of bindings) {
    try {
      // Find the most recent WorkOrder by this LINE user.
      // WorkOrder.siteCode is the direct site reference (Phase 0 transitional
      // field); fall back to Device.site via the deviceId FK if siteCode is
      // null.
      const latestWo = await db.workOrder.findFirst({
        where: { lineUserId: binding.lineUserId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          siteCode: true,
          deviceId: true,
          createdAt: true,
        },
      })

      if (!latestWo) {
        skippedOrphan++
        orphanList.push({
          lineUserId: binding.lineUserId,
          displayName: binding.lineDisplayName,
          reason: 'No WorkOrder with this lineUserId — cannot resolve siteCode',
        })
        continue
      }

      // Resolve siteCode: prefer WO.siteCode, else Device.site via deviceId.
      let siteCode: string | null = latestWo.siteCode ?? null
      if (!siteCode && latestWo.deviceId) {
        const device = await db.device.findUnique({
          where: { id: latestWo.deviceId },
          select: { site: true },
        })
        if (device?.site) {
          siteCode = device.site
        }
      }

      if (!siteCode) {
        skippedOrphan++
        orphanList.push({
          lineUserId: binding.lineUserId,
          displayName: binding.lineDisplayName,
          reason: 'Latest WorkOrder has no siteCode and no Device.site',
        })
        continue
      }

      if (!validSiteCodes.has(siteCode)) {
        skippedInvalidSite++
        orphanList.push({
          lineUserId: binding.lineUserId,
          displayName: binding.lineDisplayName,
          reason: `Resolved siteCode "${siteCode}" not in SiteAttribute (FK would fail)`,
        })
        continue
      }

      // ── 4. Upsert PublicReporter by (siteCode, lineUserId) ──
      const existing = await db.publicReporter.findUnique({
        where: {
          siteCode_lineUserId: {
            siteCode,
            lineUserId: binding.lineUserId,
          },
        },
        select: {
          id: true,
          lineDisplayName: true,
          linePictureUrl: true,
          reportCount: true,
          lastReportAt: true,
        },
      })

      if (existing) {
        // ── Merge: only update fields where the binding has more info ──
        // reportCount: take the max — binding.workOrderCount is the
        // legacy count from when the webhook created WOs directly; the
        // PublicReporter.reportCount is the new count from the public
        // repair form. Keep the higher one to avoid losing history.
        const newReportCount = Math.max(
          existing.reportCount,
          binding.workOrderCount,
        )

        // lastReportAt: bump if the latest WO createdAt is newer than the
        // existing lastReportAt (the binding has no lastWoAt field, so we
        // use the latest WO's createdAt as a proxy).
        const candidateLastReportAt = latestWo.createdAt
        const newLastReportAt =
          !existing.lastReportAt ||
          candidateLastReportAt > existing.lastReportAt
            ? candidateLastReportAt
            : undefined

        // lineDisplayName: set if currently null and we have one from binding.
        const newDisplayName =
          !existing.lineDisplayName && binding.lineDisplayName
            ? binding.lineDisplayName
            : undefined

        // Only write if there's something to update (idempotency check).
        const hasUpdate =
          newReportCount !== existing.reportCount ||
          newLastReportAt !== undefined ||
          newDisplayName !== undefined

        if (hasUpdate) {
          await db.publicReporter.update({
            where: { id: existing.id },
            data: {
              reportCount: newReportCount,
              lastReportAt: newLastReportAt,
              lineDisplayName: newDisplayName,
            },
          })
          merged++
        } else {
          // Already in sync — count as a no-op merge for visibility.
          merged++
        }
      } else {
        // ── Create new PublicReporter ──
        await db.publicReporter.create({
          data: {
            siteCode,
            lineUserId: binding.lineUserId,
            lineDisplayName: binding.lineDisplayName,
            // LineBinding never had pictureUrl; leave null (PublicReporter
            // will get it from LINE profile lookups going forward).
            linePictureUrl: null,
            // If the legacy binding had reporterName/tel, copy them across
            // (these were manual fields staff could fill in via the old
            // "register contact" flow — preserve them).
            name: binding.reporterName,
            phone: binding.tel,
            phoneVerified: false, // LineBinding never verified phone
            reportCount: binding.workOrderCount,
            lastReportAt: latestWo.createdAt,
          },
        })
        migrated++
      }
    } catch (err) {
      errors++
      const msg = err instanceof Error ? err.message : String(err)
      errorList.push({ lineUserId: binding.lineUserId, error: msg })
      console.error(
        `[migrate] error for lineUserId=${binding.lineUserId}:`,
        msg,
      )
    }
  }

  // ── 5. Summary ──
  console.log('\n' + '═'.repeat(70))
  console.log('Migration complete:')
  console.log(`  ✓ Migrated (new PublicReporter):    ${migrated}`)
  console.log(`  ↔ Merged (updated existing):       ${merged}`)
  console.log(`  ⚠ Skipped — orphan (no WO/site):    ${skippedOrphan}`)
  console.log(`  ⚠ Skipped — invalid siteCode:       ${skippedInvalidSite}`)
  console.log(`  ✗ Errors:                            ${errors}`)
  console.log('═'.repeat(70))

  if (orphanList.length > 0) {
    console.log('\nOrphan bindings (skipped — could not resolve siteCode):')
    const shown = orphanList.slice(0, 20)
    for (const o of shown) {
      const name = o.displayName ? ` (${o.displayName})` : ''
      console.log(`  ${o.lineUserId}${name}`)
      console.log(`    → ${o.reason}`)
    }
    if (orphanList.length > 20) {
      console.log(`  ... and ${orphanList.length - 20} more.`)
    }
    console.log(
      '\nOrphan LineBindings are left untouched. They can be re-checked',
    )
    console.log(
      'later (e.g. if WO history is backfilled) by re-running this script.',
    )
  }

  if (errorList.length > 0) {
    console.log('\nErrors encountered:')
    for (const e of errorList.slice(0, 20)) {
      console.log(`  ${e.lineUserId}: ${e.error}`)
    }
    if (errorList.length > 20) {
      console.log(`  ... and ${errorList.length - 20} more.`)
    }
  }

  // ── 6. Verify final state ──
  const finalReporters = await db.publicReporter.count()
  const reportersWithLineUserId = await db.publicReporter.count({
    where: { NOT: { lineUserId: null } },
  })

  console.log('\n' + '─'.repeat(70))
  console.log('Final state:')
  console.log(`  Total PublicReporters:                ${finalReporters}`)
  console.log(
    `  PublicReporters with lineUserId set:  ${reportersWithLineUserId}`,
  )
  console.log(
    `  LineBindings remaining (NOT deleted): ${bindings.length}`,
  )
  console.log('─'.repeat(70))
  console.log(
    '\nLineBinding table is intentionally left intact. After confirming the',
  )
  console.log(
    'migration in production (e.g. spot-check a few PublicReporter rows by',
  )
  console.log(
    'lineUserId), the LineBinding model + table can be dropped in a future',
  )
  console.log('cleanup task. See PHASE-3-LINEBINDING-MIGRATION worklog.')
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
