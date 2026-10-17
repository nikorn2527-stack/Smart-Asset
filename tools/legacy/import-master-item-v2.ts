/**
 * scripts/import-master-item-v2.ts
 *
 * Replace MasterItem with the new structure from
 * master_item_user_based_departmentcode_moved_v2_preview.xlsx
 *
 * Old structure (306 rows):
 *   - Department, Model, Building, DeviceType, Brand, Floor, Status, Site, DeviceGroup, ContractNo
 *
 * New structure (275 rows):
 *   - Department (172) — with GroupName (สังกัด) + DepartmentCode
 *   - DeviceClassification (40) — NEW! replaces Brand+Model+DeviceType, uses ParentRef="Brand|DeviceType"
 *   - Building (32), Floor (12), Status (8), Site (6), DeviceGroup (4), ContractNo (1)
 *
 * Strategy:
 *   1. DELETE all MasterItem rows (clean slate)
 *   2. INSERT 275 rows from Excel "MasterItem ใหม่" sheet
 *   3. Use createMany with skipDuplicates for idempotency
 *
 * Usage:
 *   ITAM_DB_URL="postgresql://..." bunx tsx scripts/import-master-item-v2.ts
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

const rawUrl = process.env.ITAM_DB_URL ?? process.env.DATABASE_URL ?? ''
if (!rawUrl || !rawUrl.startsWith('postgres')) {
  console.error('❌ Missing ITAM_DB_URL')
  process.exit(1)
}
const poolUrl = buildPoolUrl(rawUrl)
console.log(`🔌 Connecting to: ${poolUrl.replace(/:[^:@]+@/, ':****@')}`)

const db = new PrismaClient({
  datasources: { db: { url: poolUrl } },
  log: ['error', 'warn'],
})

const XLSX_PATH = '/home/z/my-project/upload/master_item_user_based_departmentcode_moved_v2_preview.xlsx'

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Import MasterItem v2 (275 rows from Excel)')
  console.log('═══════════════════════════════════════════════════════════════')

  // Read Excel using Python via execSync (xlsx-populate may not be installed)
  console.log('\n📖 Reading Excel file...')
  const excelData = JSON.parse(
    execSync(
      `python3 -c "
import json
from openpyxl import load_workbook
wb = load_workbook('${XLSX_PATH}', data_only=True)
ws = wb['MasterItem ใหม่']
rows = []
for row in ws.iter_rows(min_row=2, values_only=True):
    if row[0]:  # has ItemID
        rows.append({
            'itemId': row[0],
            'category': row[1] or '',
            'value': row[2] or '',
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

  console.log(`   Read ${excelData.length} rows from Excel`)

  // Map Excel rows to MasterItem rows
  // MasterItem schema fields: category, code, label (required), parentRef, displayLabel, siteCode, active
  // Excel has extra fields (groupName, departmentCode, brand, model, deviceType) — pack into existing fields
  const masterItems = excelData.map((r: any) => {
    let label = r.value
    let code = r.itemId
    let displayLabel = r.displayLabel
    let parentRef = r.parentRef

    if (r.category === 'Department') {
      // Department: code = DepartmentCode (e.g., ACC-001), label = Value
      // Pack GroupName into displayLabel so we don't lose the affiliation info
      code = r.departmentCode || r.itemId
      label = r.value
      displayLabel = r.groupName ? `${r.value} [สังกัด: ${r.groupName}]` : r.value
      parentRef = r.groupName || null  // GroupName = สังกัด, stored as parentRef text
    } else if (r.category === 'DeviceClassification') {
      // DeviceClassification: combines Brand+Model+DeviceType
      // label = Model (most specific), code = ItemID, parentRef = "Brand|DeviceType"
      label = r.model || `${r.brand} ${r.deviceType}`
      code = r.itemId
      displayLabel = `${r.brand || ''} ${r.model || ''} (${r.deviceType || ''})`.trim()
      parentRef = r.parentRef || `${r.brand}|${r.deviceType}`
    } else {
      // Building, Floor, Status, Site, DeviceGroup, ContractNo
      label = r.value
      code = r.itemId
      displayLabel = r.displayLabel || r.value
      parentRef = r.parentRef
    }

    return {
      category: r.category,
      code: code || r.itemId,
      label: label || r.value || r.itemId,
      displayLabel: displayLabel || label,
      parentRef: parentRef,
      siteCode: r.siteCode || 'ALL',
      active: r.active !== false,
    }
  })

  console.log(`   Mapped ${masterItems.length} MasterItem rows`)
  console.log('   Sample categories:')
  const catCount: Record<string, number> = {}
  for (const m of masterItems) {
    catCount[m.category] = (catCount[m.category] || 0) + 1
  }
  for (const [cat, n] of Object.entries(catCount).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${cat}: ${n}`)
  }

  // Step 1: Delete all existing MasterItem rows
  console.log('\n🗑️  Step 1: Delete all existing MasterItem rows...')
  const deletedCount = await db.masterItem.deleteMany({})
  console.log(`   ✅ Deleted ${deletedCount.count} rows`)

  // Step 2: Insert new MasterItem rows in chunks
  console.log('\n📝 Step 2: Insert new MasterItem rows (275 rows in chunks of 50)...')
  const CHUNK = 50
  let inserted = 0
  for (let i = 0; i < masterItems.length; i += CHUNK) {
    const chunk = masterItems.slice(i, i + CHUNK)
    await db.masterItem.createMany({
      data: chunk as any,
      skipDuplicates: true,
    })
    inserted += chunk.length
    process.stdout.write(`\r   progress: ${inserted}/${masterItems.length}`)
  }
  process.stdout.write('\n')

  // Step 3: Verify
  console.log('\n✅ Step 3: Verify...')
  const finalCount = await db.masterItem.count()
  console.log(`   Final MasterItem count: ${finalCount}`)

  const byCat = await db.masterItem.findMany({
    select: { category: true },
  })
  console.log('   By category:')
  const finalCatCount: Record<string, number> = {}
  for (const c of byCat) {
    finalCatCount[c.category] = (finalCatCount[c.category] || 0) + 1
  }
  for (const [cat, n] of Object.entries(finalCatCount).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${cat}: ${n}`)
  }

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  ✅ COMPLETE — MasterItem v2 imported')
  console.log('═══════════════════════════════════════════════════════════════')
}

main()
  .catch((e) => {
    console.error('❌ FATAL:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
