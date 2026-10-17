/**
 * scripts/import-master-item-v3.ts
 *
 * Replace MasterItem with 461 rows from the new Excel:
 *   master_item_repair_stock_products_categorized_sitecode_preview.xlsx
 *
 * 10 columns: category, code, label, brand, model, deviceType, parentRef, displayLabel, siteCode, active
 * 17 categories: Department, Product, Affiliation, DeviceClassification, Building,
 *   RepairRequest, RepairResolution, RepairGroup, Floor, ProductCategory, Purpose,
 *   Status, Site, Supplier, DeviceGroup, StockSource, ContractNo
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

const XLSX_PATH = '/home/z/my-project/upload/master_item_repair_stock_products_categorized_sitecode_preview.xlsx'

function cleanVal(v: string | null | undefined): string | null {
  if (!v) return null
  const s = String(v).trim()
  if (s === '' || s === '—' || s === '-' || s === 'undefined' || s === 'null') return null
  return s
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Import MasterItem v3 (461 rows from new Excel)')
  console.log('═══════════════════════════════════════════════════════════════')

  // Read Excel
  console.log('\n📖 Reading Excel...')
  const excelData = JSON.parse(
    execSync(
      `python3 -c "
import json
from openpyxl import load_workbook
wb = load_workbook('${XLSX_PATH}', data_only=True)
ws = wb['MasterItem']
rows = []
for row in ws.iter_rows(min_row=2, values_only=True):
    if row[0] and row[1]:
        rows.append({
            'category': str(row[0]).strip(),
            'code': str(row[1]).strip(),
            'label': str(row[2]).strip() if row[2] else str(row[1]).strip(),
            'brand': str(row[3]).strip() if row[3] and str(row[3]).strip() not in ('—','-','') else None,
            'model': str(row[4]).strip() if row[4] and str(row[4]).strip() not in ('—','-','') else None,
            'deviceType': str(row[5]).strip() if row[5] and str(row[5]).strip() not in ('—','-','') else None,
            'parentRef': str(row[6]).strip() if row[6] and str(row[6]).strip() not in ('—','-','') else None,
            'displayLabel': str(row[7]).strip() if row[7] and str(row[7]).strip() not in ('—','-','') else None,
            'siteCode': str(row[8]).strip() if row[8] else 'ALL',
            'active': str(row[9]).strip().lower() == 'true' if row[9] else True,
        })
print(json.dumps(rows, ensure_ascii=False))
"`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
    ),
  )
  console.log(`   Read ${excelData.length} rows from Excel`)

  // Show category distribution
  const catCount: Record<string, number> = {}
  for (const r of excelData) {
    catCount[r.category] = (catCount[r.category] || 0) + 1
  }
  console.log('   Categories:')
  for (const [cat, n] of Object.entries(catCount).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${cat}: ${n}`)
  }

  // Step 1: DROP + RECREATE MasterItem table (schema changed)
  console.log('\n🗑️  Step 1: DROP + RECREATE MasterItem table...')
  await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "MasterItem" CASCADE`)
  await db.$executeRawUnsafe(`
    CREATE TABLE "MasterItem" (
      "id" TEXT NOT NULL,
      "category" TEXT NOT NULL,
      "code" TEXT NOT NULL,
      "label" TEXT NOT NULL,
      "brand" TEXT,
      "model" TEXT,
      "deviceType" TEXT,
      "parentRef" TEXT,
      "displayLabel" TEXT,
      "siteCode" TEXT,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "MasterItem_pkey" PRIMARY KEY ("id")
    )
  `)
  await db.$executeRawUnsafe(`CREATE INDEX "MasterItem_category_idx" ON "MasterItem"("category")`)
  await db.$executeRawUnsafe(`CREATE INDEX "MasterItem_code_idx" ON "MasterItem"("code")`)
  console.log('   ✅ Table recreated with 10 columns')

  // Step 2: Insert new rows
  console.log('\n📝 Step 2: Insert new rows (461)...')
  const CHUNK = 50
  for (let i = 0; i < excelData.length; i += CHUNK) {
    const chunk = excelData.slice(i, i + CHUNK)
    await db.masterItem.createMany({
      data: chunk.map((r: any) => ({
        category: r.category,
        code: r.code,
        label: r.label,
        brand: r.brand,
        model: r.model,
        deviceType: r.deviceType,
        parentRef: r.parentRef,
        displayLabel: r.displayLabel,
        siteCode: r.siteCode,
        active: r.active,
      })) as any,
    })
    process.stdout.write(`\r   progress: ${Math.min(i + CHUNK, excelData.length)}/${excelData.length}`)
  }
  process.stdout.write('\n')

  // Step 3: Verify
  console.log('\n✅ Step 3: Verify...')
  const total = await db.masterItem.count()
  console.log(`   Total MasterItem: ${total}`)

  const byCat = await db.masterItem.findMany({ select: { category: true } })
  const finalCats: Record<string, number> = {}
  for (const c of byCat) {
    finalCats[c.category] = (finalCats[c.category] || 0) + 1
  }
  console.log('   By category:')
  for (const [cat, n] of Object.entries(finalCats).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${cat}: ${n}`)
  }

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  ✅ COMPLETE')
  console.log('═══════════════════════════════════════════════════════════════')
}

main()
  .catch((e) => {
    console.error('❌ FATAL:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
