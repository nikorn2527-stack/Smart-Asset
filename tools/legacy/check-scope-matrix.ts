/**
 * check-scope-matrix.ts — ตรวจ Field Scope ของทุกตาราง (Section 17 #3)
 *
 * ตรวจว่าทุก business table มี organizationId field หรือไม่
 * สร้าง Scope Matrix report
 */
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync('/home/z/my-project/db/custom.db')

// Tables ที่ควรมี organizationId (ตาม section 5)
const EXPECTED_TABLES = [
  'User', 'Device', 'WorkOrder', 'MeterReading', 'DeviceTransfer',
  'StockItem', 'StockTransaction', 'PurchaseOrder', 'MasterItem',
  'SiteAttribute', 'AssetCategory', 'AuditLog', 'SyncRun',
  'AssetNumberPattern', 'WoNumberPattern',
  // New multi-org models
  'Organization', 'LegacyReference', 'SetupRun', 'SetupStep',
  'CustomFieldDefinition', 'CustomFieldOption', 'CustomFieldValue',
]

async function main() {
  console.log('══════════════════════════════════════════')
  console.log('  Scope Matrix — Organization Scope Check')
  console.log('══════════════════════════════════════════\n')

  let hasScope = 0
  let missingScope = 0
  let notFound = 0

  console.log('Table                  | Has orgId | Row Count')
  console.log('─'.repeat(55))

  for (const table of EXPECTED_TABLES) {
    // Check if table exists
    let tableExists = true
    let rowCount = 0
    try {
      const r = db.prepare(`SELECT count(*) as c FROM "${table}"`).get() as { c: number } | undefined
      rowCount = r?.c ?? 0
    } catch {
      tableExists = false
    }

    if (!tableExists) {
      console.log(`  ${table.padEnd(22)} | NOT FOUND  | —`)
      notFound++
      continue
    }

    // Check if organizationId column exists
    let hasOrgId = false
    try {
      const cols = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]
      hasOrgId = cols.some(c => c.name === 'organizationId')
    } catch {
      // skip
    }

    const status = hasOrgId ? '✓ YES' : '✗ NO'
    console.log(`  ${table.padEnd(22)} | ${status}  | ${rowCount}`)

    if (hasOrgId) hasScope++
    else missingScope++
  }

  console.log('─'.repeat(55))
  console.log(`\nSummary:`)
  console.log(`  Tables with organizationId: ${hasScope}`)
  console.log(`  Tables WITHOUT organizationId: ${missingScope}`)
  console.log(`  Tables not found: ${notFound}`)
  console.log(`  Total expected: ${EXPECTED_TABLES.length}`)

  // Check which tables have orgId but rows with NULL orgId
  console.log('\n─ NULL organizationId Check ─')
  for (const table of EXPECTED_TABLES) {
    try {
      const cols = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]
      if (!cols.some(c => c.name === 'organizationId')) continue

      const r = db.prepare(`SELECT count(*) as c FROM "${table}" WHERE "organizationId" IS NULL`).get() as { c: number } | undefined
      const nullCount = r?.c ?? 0
      if (nullCount > 0) {
        console.log(`  ⚠ ${table}: ${nullCount} rows with NULL organizationId`)
      }
    } catch {
      // skip
    }
  }

  db.close()
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
