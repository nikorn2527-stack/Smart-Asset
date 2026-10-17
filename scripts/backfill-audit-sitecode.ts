/**
 * backfill-audit-sitecode.ts — Populate AuditLog.siteCode from entity resolution.
 *
 * Task ID: NF-2-BACKFILL
 *
 * For existing AuditLog entries where siteCode is NULL, resolves the
 * entity (StockItem, StockTransaction, WorkOrder, UserSiteGrant) to
 * its canonical Site and populates the siteCode column.
 *
 * Run AFTER migration 20260815000001_add_version_and_audit_sitecode.
 *
 * Usage: bun scripts/backfill-audit-sitecode.ts
 *
 * This script is idempotent — it only updates entries where siteCode IS NULL.
 */

import { db } from '../src/lib/db'

async function main() {
  console.log('Backfilling AuditLog.siteCode...\n')

  // B4 FIX (round 10): Use cursor-based pagination instead of skip+offset.
  // B4 FIX (round 11): Use batch updateMany instead of per-row update.
  const BATCH_SIZE = 500
  let lastId: string | null = null
  let updated = 0
  let unresolved = 0
  let total = 0

  while (true) {
    const where: Record<string, unknown> = { siteCode: null }
    if (lastId) {
      where.id = { gt: lastId }
    }

    const entries = await db.auditLog.findMany({
      where,
      take: BATCH_SIZE,
      orderBy: { id: 'asc' },
      select: { id: true, entity: true, entityId: true, action: true, summary: true },
    })

    if (entries.length === 0) break

    // Resolve each entry to its canonical Site
    const updatesBySite = new Map<string, string[]>() // siteCode → entry IDs
    const unresolvedIds: string[] = []

    for (const entry of entries) {
      let siteCode: string | null = null

      if (entry.entityId) {
        try {
          if (entry.entity === 'StockTransaction') {
            const txn = await db.stockTransaction.findFirst({
              where: { OR: [{ id: entry.entityId }, { txnNumber: entry.entityId }] },
              select: { stockItem: { select: { site: true } } },
            })
            siteCode = txn?.stockItem?.site ?? null
          } else if (entry.entity === 'StockItem') {
            const item = await db.stockItem.findUnique({
              where: { id: entry.entityId },
              select: { site: true },
            })
            siteCode = item?.site ?? null
          } else if (entry.entity === 'WorkOrder') {
            const wo = await db.workOrder.findFirst({
              where: { OR: [{ id: entry.entityId }, { woNumber: entry.entityId }] },
              select: { siteCode: true, device: { select: { site: true } } },
            })
            siteCode = wo?.siteCode ?? wo?.device?.site ?? null
          } else if (entry.entity === 'WorkOrderImage') {
            // WorkOrderImage audit entries: entityId is the image ID,
            // need to resolve image → workOrder → siteCode
            const img = await db.workOrderImage.findUnique({
              where: { id: entry.entityId },
              select: { workOrderId: true },
            })
            if (img) {
              const wo = await db.workOrder.findUnique({
                where: { id: img.workOrderId },
                select: { siteCode: true, device: { select: { site: true } } },
              })
              siteCode = wo?.siteCode ?? wo?.device?.site ?? null
            }
          } else if (entry.entity === 'UserSiteGrant') {
            const parts = entry.entityId.split('@')
            siteCode = parts.length >= 2 ? parts[1] : null
          } else if (entry.entity === 'Device') {
            const device = await db.device.findUnique({
              where: { id: entry.entityId },
              select: { site: true },
            })
            siteCode = device?.site ?? null
          }
        } catch {
          // Can't resolve — leave as null
        }
      }

      if (siteCode) {
        if (!updatesBySite.has(siteCode)) {
          updatesBySite.set(siteCode, [])
        }
        updatesBySite.get(siteCode)!.push(entry.id)
      } else {
        unresolvedIds.push(entry.id)
      }
    }

    // Batch update: one UPDATE per unique siteCode
    for (const [siteCode, ids] of updatesBySite) {
      await db.auditLog.updateMany({
        where: { id: { in: ids } },
        data: { siteCode },
      })
      updated += ids.length
    }
    unresolved += unresolvedIds.length

    // Use the last entry's ID as the cursor for the next batch
    lastId = entries[entries.length - 1].id
    total += entries.length
    console.log(`  Processed ${total} entries (updated: ${updated}, unresolved: ${unresolved})`)
  }

  console.log(`\n=== Backfill Summary ===`)
  console.log(`Total processed: ${total}`)
  console.log(`Updated: ${updated}`)
  console.log(`Unresolved (left as null): ${unresolved}`)
  console.log(`\nDone.`)
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
