/**
 * scripts/rebuild-master-item-schema.ts
 *
 * Rebuild MasterItem table to match Excel schema (16 fields):
 *   - Drop old MasterItem table
 *   - Drop RepairTaxonomy table (moving data into MasterItem)
 *   - Recreate MasterItem with 16 fields matching Excel columns
 *   - Re-import 275 rows from Excel
 *   - Migrate 56 RepairTaxonomy rows into MasterItem (RepairGroup/RepairProblem/RepairResolution categories)
 *
 * Usage:
 *   ITAM_DB_URL="postgresql://..." bunx tsx scripts/rebuild-master-item-schema.ts
 */

import { PrismaClient } from '@prisma/client'
import { execSync } from 'node:child_process'

function buildPoolUrl(raw: string): string {
  let u = raw
  if (/\.pooler\.supabase\.com:5432(\/|\?|$)/.test(u)) {
    u = u.replace('.pooler.supabase.com:5432', '.pooler.supabase.com:6543')
  }
  const extras: string[] = []
  if (!u.includes('connection_limit=')) extras.push('connection_limit=3')
  if (!u.includes('pool_timeout=')) extras.push('pool_timeout=30')
  if (/\.pooler\.supabase\.com/.test(u) && !u.includes('pgbouncer=')) extras.push('pgbouncer=true')
  if (!extras.length) return u
  return u + (u.includes('?') ? '&' : '?') + extras.join('&')
}

const rawUrl = process.env.ITAM_DB_URL ?? ''
if (!rawUrl.startsWith('postgres')) {
  console.error('❌ Missing ITAM_DB_URL')
  process.exit(1)
}
const poolUrl = buildPoolUrl(rawUrl)
console.log(`🔌 Connecting to: ${poolUrl.replace(/:[^:@]+@/, ':****@')}`)

const db = new PrismaClient({
  datasources: { db: { url: poolUrl } },
  log: ['error', 'warn'],
})

const XLSX_PATH = './upload/master_item_user_based_departmentcode_moved_v2_preview.xlsx'

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Rebuild MasterItem schema (16 fields) + migrate RepairTaxonomy')
  console.log('═══════════════════════════════════════════════════════════════')

  // Step 1: Read RepairTaxonomy data BEFORE dropping it (so we can migrate into MasterItem)
  console.log('\n📖 Step 1: Read RepairTaxonomy data (to migrate into MasterItem)...')
  let repairGroups: any[] = []
  let repairProblems: any[] = []
  let repairResolutions: any[] = []
  try {
    repairGroups = await db.$queryRawUnsafe(`
      SELECT code, label, status, "sortOrder" FROM "RepairTaxonomy" WHERE type = 'group' ORDER BY "sortOrder" ASC
    `) as any[]
    repairProblems = await db.$queryRawUnsafe(`
      SELECT code, label, "groupCode", "groupLabel", "sortOrder" FROM "RepairTaxonomy" WHERE type = 'problem' ORDER BY "sortOrder" ASC
    `) as any[]
    repairResolutions = await db.$queryRawUnsafe(`
      SELECT code, label, "groupCode", "groupLabel", "sortOrder" FROM "RepairTaxonomy" WHERE type = 'resolution' ORDER BY "sortOrder" ASC
    `) as any[]
    console.log(`   ✅ Read ${repairGroups.length} groups + ${repairProblems.length} problems + ${repairResolutions.length} resolutions`)
  } catch {
    console.log('   ⚠️  RepairTaxonomy table not found — skipping migration')
  }

  // Step 2: Read Excel data
  console.log('\n📖 Step 2: Read Excel data...')
  const excelData = JSON.parse(
    execSync(
      `python3 -c "
import json
from openpyxl import load_workbook
wb = load_workbook('${XLSX_PATH}', data_only=True)
ws = wb['MasterItem ใหม่']
rows = []
for row in ws.iter_rows(min_row=2, values_only=True):
    if row[0]:
        rows.append({
            'itemId': row[0],
            'categoryKey': row[1] or '',
            'value': row[2] or None,
            'groupName': row[3] or None,
            'departmentCode': row[4] or None,
            'brand': row[5] or None,
            'model': row[6] or None,
            'deviceType': row[7] or None,
            'parentRef': row[8] or None,
            'displayLabel': row[9] or None,
            'siteCode': row[10] or None,
            'allowedSites': row[11] or 'ALL',
            'active': str(row[12] or 'TRUE').upper() == 'TRUE',
        })
print(json.dumps(rows, ensure_ascii=False))
"`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
    ),
  )
  console.log(`   ✅ Read ${excelData.length} rows from Excel`)

  // Step 3: DROP tables (MasterItem + RepairTaxonomy) — clean slate
  console.log('\n🗑️  Step 3: DROP MasterItem + RepairTaxonomy tables...')
  await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "MasterItem" CASCADE`)
  console.log('   ✅ Dropped MasterItem')
  await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "RepairTaxonomy" CASCADE`)
  console.log('   ✅ Dropped RepairTaxonomy')

  // Step 4: CREATE MasterItem with 16 fields matching Excel
  console.log('\n📊 Step 4: CREATE MasterItem table (16 fields)...')
  await db.$executeRawUnsafe(`
    CREATE TABLE "MasterItem" (
      "id" TEXT NOT NULL,
      "itemId" TEXT,
      "categoryKey" TEXT NOT NULL,
      "value" TEXT,
      "groupName" TEXT,
      "departmentCode" TEXT,
      "brand" TEXT,
      "model" TEXT,
      "deviceType" TEXT,
      "parentRef" TEXT,
      "displayLabel" TEXT,
      "siteCode" TEXT,
      "allowedSites" TEXT,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "MasterItem_pkey" PRIMARY KEY ("id")
    )
  `)
  await db.$executeRawUnsafe(`CREATE INDEX "MasterItem_categoryKey_idx" ON "MasterItem"("categoryKey")`)
  await db.$executeRawUnsafe(`CREATE INDEX "MasterItem_itemId_idx" ON "MasterItem"("itemId")`)
  await db.$executeRawUnsafe(`CREATE INDEX "MasterItem_departmentCode_idx" ON "MasterItem"("departmentCode")`)
  console.log('   ✅ Table created with 16 fields + 3 indexes')

  // Step 5: INSERT Excel rows (275 rows) — use Prisma createMany in chunks
  console.log('\n📝 Step 5: INSERT Excel rows (275)...')
  const CHUNK = 50
  for (let i = 0; i < excelData.length; i += CHUNK) {
    const chunk = excelData.slice(i, i + CHUNK)
    await db.masterItem.createMany({
      data: chunk.map((r: any) => ({
        itemId: r.itemId,
        categoryKey: r.categoryKey,
        value: r.value,
        groupName: r.groupName,
        departmentCode: r.departmentCode,
        brand: r.brand,
        model: r.model,
        deviceType: r.deviceType,
        parentRef: r.parentRef,
        displayLabel: r.displayLabel,
        siteCode: r.siteCode,
        allowedSites: r.allowedSites,
        active: r.active,
      })) as any,
    })
    process.stdout.write(`\r   progress: ${Math.min(i + CHUNK, excelData.length)}/${excelData.length}`)
  }
  process.stdout.write('\n')

  // Step 6: INSERT RepairTaxonomy data into MasterItem (3 new categories)
  console.log('\n📝 Step 6: INSERT RepairTaxonomy data into MasterItem...')

  // RepairGroup — 14 rows
  for (const g of repairGroups) {
    await db.$executeRawUnsafe(`
      INSERT INTO "MasterItem" ("id", "categoryKey", "value", "displayLabel", "parentRef", "active", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, 'RepairGroup', $1, $1, $2, true, NOW(), NOW())
    `, g.label, g.code)
  }
  console.log(`   ✅ Inserted ${repairGroups.length} RepairGroup rows`)

  // RepairProblem — 24 rows
  for (const p of repairProblems) {
    await db.$executeRawUnsafe(`
      INSERT INTO "MasterItem" ("id", "categoryKey", "value", "displayLabel", "parentRef", "groupName", "active", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, 'RepairProblem', $1, $1, $2, $3, true, NOW(), NOW())
    `, p.label, p.groupCode, p.groupLabel)
  }
  console.log(`   ✅ Inserted ${repairProblems.length} RepairProblem rows`)

  // RepairResolution — 18 rows
  for (const r of repairResolutions) {
    await db.$executeRawUnsafe(`
      INSERT INTO "MasterItem" ("id", "categoryKey", "value", "displayLabel", "parentRef", "groupName", "active", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, 'RepairResolution', $1, $1, $2, $3, true, NOW(), NOW())
    `, r.label, r.groupCode, r.groupLabel)
  }
  console.log(`   ✅ Inserted ${repairResolutions.length} RepairResolution rows`)

  // Step 7: Verify
  console.log('\n✅ Step 7: Verify...')
  const total = await db.masterItem.count()
  console.log(`   Total MasterItem rows: ${total}`)

  const byCat = await db.masterItem.findMany({ select: { categoryKey: true } })
  const catCount: Record<string, number> = {}
  for (const c of byCat) {
    catCount[c.categoryKey] = (catCount[c.categoryKey] || 0) + 1
  }
  console.log('   By category:')
  for (const [cat, n] of Object.entries(catCount).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${cat}: ${n}`)
  }

  // Sample DeviceClassification row
  const dcSample = await db.masterItem.findFirst({
    where: { categoryKey: 'DeviceClassification' },
    select: { itemId: true, value: true, brand: true, model: true, deviceType: true, parentRef: true }
  })
  console.log('   Sample DeviceClassification:', JSON.stringify(dcSample))

  // Sample Department row
  const deptSample = await db.masterItem.findFirst({
    where: { categoryKey: 'Department' },
    select: { itemId: true, value: true, groupName: true, departmentCode: true }
  })
  console.log('   Sample Department:', JSON.stringify(deptSample))

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  ✅ COMPLETE — MasterItem schema rebuilt (16 fields)')
  console.log('═══════════════════════════════════════════════════════════════')
}

main()
  .catch((e) => {
    console.error('❌ FATAL:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
