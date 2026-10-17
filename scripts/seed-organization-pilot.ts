/**
 * seed-organization-pilot.ts — Create Organization 'PILOT' + backfill organizationId
 * on all existing business rows so they belong to the Pilot org.
 *
 * Strategy (additive — never deletes or modifies canonical data):
 *   1. Upsert Organization row with code='PILOT'
 *   2. For each scoped table, UPDATE rows SET organizationId='PILOT' WHERE organizationId IS NULL
 *   3. Audit log the backfill
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const PILOT_ORG = {
  code: 'PILOT',
  name: 'Pilot Organization — โรงพยาบาลศูนย์อุดรธานี',
  type: 'hospital',
  timezone: 'Asia/Bangkok',
  currency: 'THB',
  active: true,
}

async function main() {
  console.log('══════════════════════════════════════════')
  console.log('  Seed Organization "PILOT" + backfill')
  console.log('══════════════════════════════════════════')

  // 1. Upsert Organization by code (idempotent)
  const org = await db.organization.upsert({
    where: { code: PILOT_ORG.code },
    create: PILOT_ORG,
    update: { name: PILOT_ORG.name, type: PILOT_ORG.type, active: true },
  })
  console.log('✓ Organization:', org.code, '|', org.name, '| id:', org.id)

  const orgId = org.id
  console.log('  Using orgId =', orgId, 'for backfill')
  console.log('')

  // 2. Backfill organizationId on scoped tables
  // NOTE: organizationId is a String? — we use the Organization.id (cuid), not the code,
  // for FK-style referential integrity in queries.
  const backfillTargets: Array<{ table: string; label: string }> = [
    { table: 'Device', label: 'devices' },
    { table: 'WorkOrder', label: 'work orders' },
    { table: 'StockItem', label: 'stock items' },
    { table: 'MasterItem', label: 'master items' },
    { table: 'User', label: 'users' },
  ]

  let totalBackfilled = 0
  for (const { table, label } of backfillTargets) {
    try {
      // Use raw SQL because Prisma's typed updateMany doesn't support SET column = literal
      // for the same column being filtered on. SQLite accepts this fine.
      const result = await db.$executeRawUnsafe(
        `UPDATE "${table}" SET "organizationId" = ? WHERE "organizationId" IS NULL`,
        orgId,
      )
      console.log(`  ✓ ${label.padEnd(15)}: backfilled ${result} rows`)
      totalBackfilled += result
    } catch (e: any) {
      console.error(`  ✗ ${label}: ${e.message.slice(0, 120)}`)
    }
  }

  // 3. Backfill legacyAssetCode on Device (set = assetCode if null, so legacy code is preserved)
  try {
    const legacySet = await db.$executeRawUnsafe(
      `UPDATE "Device" SET "legacyAssetCode" = "assetCode", "legacySourceApp" = 'itam' WHERE "legacyAssetCode" IS NULL`,
    )
    console.log(`  ✓ Device.legacyAssetCode: set ${legacySet} rows (from assetCode)`)
    totalBackfilled += legacySet > 0 ? 0 : 0 // not counted as new rows, just enrichment
  } catch (e: any) {
    console.error(`  ✗ Device.legacyAssetCode: ${e.message.slice(0, 120)}`)
  }

  // 4. Backfill legacyProductCode on StockItem
  try {
    const legacySet = await db.$executeRawUnsafe(
      `UPDATE "StockItem" SET "legacyProductCode" = "productCode", "legacySourceApp" = 'stock' WHERE "legacyProductCode" IS NULL`,
    )
    console.log(`  ✓ StockItem.legacyProductCode: set ${legacySet} rows (from productCode)`)
  } catch (e: any) {
    console.error(`  ✗ StockItem.legacyProductCode: ${e.message.slice(0, 120)}`)
  }

  // 5. Backfill organizationId on AssetNumberPattern + WoNumberPattern
  for (const table of ['AssetNumberPattern', 'WoNumberPattern']) {
    try {
      const result = await db.$executeRawUnsafe(
        `UPDATE "${table}" SET "organizationId" = ? WHERE "organizationId" IS NULL`,
        orgId,
      )
      console.log(`  ✓ ${table}: backfilled ${result} rows`)
      totalBackfilled += result
    } catch (e: any) {
      console.error(`  ✗ ${table}: ${e.message.slice(0, 120)}`)
    }
  }

  // 6. Audit log the backfill event
  try {
    await db.auditLog.create({
      data: {
        action: 'MULTI_ORG_BACKFILL',
        entity: 'Organization',
        entityId: orgId,
        summary: `Backfilled ${totalBackfilled} legacy rows to organizationId=${orgId} (PILOT)`,
        actor: 'system',
        detail: JSON.stringify({
          organizationCode: 'PILOT',
          tables: backfillTargets.map(t => t.table),
          totalRows: totalBackfilled,
        }),
      },
    })
    console.log('  ✓ Audit log recorded')
  } catch (e: any) {
    console.error('  ✗ Audit log failed:', e.message.slice(0, 80))
  }

  // 7. Verify
  console.log('')
  console.log('═══ Verification ═══')
  const orgs = await db.organization.findMany()
  console.log('  Organizations:', orgs.length)
  orgs.forEach(o => console.log(`    - ${o.code} (${o.name}) active=${o.active}`))

  for (const { table, label } of backfillTargets) {
    const total = await (db as any)[table.charAt(0).toLowerCase() + table.slice(1)].count()
    const withOrg = await (db as any)[table.charAt(0).toLowerCase() + table.slice(1)].count({
      where: { organizationId: orgId },
    })
    const nullOrg = total - withOrg
    console.log(`  ${label.padEnd(15)}: ${withOrg}/${total} have orgId (null=${nullOrg})`)
  }

  console.log('')
  console.log(`✓ Done — ${totalBackfilled} rows backfilled to PILOT organization`)
}

main()
  .catch(e => { console.error('FATAL:', e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
