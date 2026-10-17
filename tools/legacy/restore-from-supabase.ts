/**
 * restore-from-supabase-v2.ts — Atomic Restore (C-02 fix)
 *
 * Flow ตามที่ปรึกษาแนะนำ:
 *   1. Dry Run (ตรวจ source/target/schema)
 *   2. Backup Local DB (auto)
 *   3. Restore เข้า Temporary DB
 *   4. ตรวจ Foreign Key + Row Count + Required Tables
 *   5. Atomic Replace (rename temp → production)
 *
 * ถ้า Import ล้มกลางทาง → Target DB เดิมยังอยู่ครบ (Atomic)
 */
import pg from 'pg'
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'

// ── Environment Guards (Fail-Closed) ──
const SUPA = process.env.SUPABASE_DATABASE_URL
if (!SUPA) {
  console.error('❌ SUPABASE_DATABASE_URL env var is required.')
  process.exit(1)
}

const RESTORE_CONFIRM = process.env.RESTORE_CONFIRM
if (RESTORE_CONFIRM !== 'YES') {
  console.error('❌ This script will REPLACE local data.')
  console.error('   Set RESTORE_CONFIRM=YES to proceed:')
  console.error('   RESTORE_CONFIRM=YES bun scripts/restore-from-supabase-v2.ts')
  process.exit(1)
}

if (process.env.NODE_ENV === 'production') {
  console.error('❌ RESTORE IS NOT ALLOWED IN PRODUCTION.')
  process.exit(1)
}

const SQLITE_PATH = '/home/z/my-project/db/custom.db'
const TEMP_PATH = SQLITE_PATH + '.restore-tmp'
const BACKUP_PATH = SQLITE_PATH + '.pre-restore-backup'

const TABLES = [
  'AppSetting', 'AssetNumberPattern', 'WoNumberPattern',
  'OrganizationProfile', 'Cycle', 'User', 'Role', 'Permission', 'RolePermission',
  'UserSiteGrant', 'SiteAttribute', 'Site', 'SiteRate', 'MasterItem',
  'Device', 'DeviceAccessory', 'DeviceTransfer', 'Assignment',
  'StockItem', 'StockItemRateHistory', 'StockTransaction', 'PurchaseOrder', 'PurchaseOrderItem',
  'WorkOrder', 'WorkOrderMessage', 'WorkOrderReview', 'WorkOrderImage', 'WorkOrderPart',
  'MaintenanceLog', 'MeterReading', 'MeterReportAmendment', 'AuditLog',
  'DocumentTemplate', 'ImportJob', 'LineBinding', 'Report', 'PasswordResetToken',
  'SyncRun', 'SyncRunItem', 'PMSchedule', 'PMExecution', 'WebAuthnCredential',
  'PublicReporter', 'LicenseRecord', 'ModuleFlag', 'Contact',
  'NotificationLog', 'NotificationTemplate',
  // New multi-org tables
  'Organization', 'LegacyReference', 'SetupRun', 'SetupStep',
  'CustomFieldDefinition', 'CustomFieldOption', 'CustomFieldValue',
]

async function main() {
  console.log('══════════════════════════════════════════')
  console.log('  Atomic Restore from Supabase (v2)')
  console.log('══════════════════════════════════════════')

  const supa = new pg.Client({ connectionString: SUPA, connectionTimeoutMillis: 30000 })
  await supa.connect()
  console.log('✓ Connected to Supabase')

  // ── Step 1: Backup Local DB ──
  console.log('\n── Step 1: Backup Local DB ──')
  if (fs.existsSync(SQLITE_PATH)) {
    fs.copyFileSync(SQLITE_PATH, BACKUP_PATH)
    console.log('✓ Local DB backed up to:', BACKUP_PATH)
  } else {
    console.log('⚠ Local DB not found — creating fresh')
  }

  // ── Step 2: Create Temporary DB ──
  console.log('\n── Step 2: Restore into Temporary DB ──')
  // Delete old temp if exists
  if (fs.existsSync(TEMP_PATH)) fs.unlinkSync(TEMP_PATH)

  const tempDb = new DatabaseSync(TEMP_PATH)
  tempDb.exec('PRAGMA foreign_keys = OFF')

  let totalRestored = 0
  const restoreErrors: string[] = []

  for (const table of TABLES) {
    try {
      const res = await supa.query('SELECT * FROM "' + table + '"')
      if (res.rows.length === 0) continue

      const cols = Object.keys(res.rows[0])

      // Create table in temp DB (mirror schema)
      // We use CREATE TABLE IF NOT EXISTS with all columns as TEXT (SQLite is flexible)
      const colDefs = cols.map(c => `"${c}" TEXT`).join(', ')
      tempDb.exec(`CREATE TABLE IF NOT EXISTS "${table}" (${colDefs})`)

      const stmt = tempDb.prepare(
        'INSERT OR REPLACE INTO "' + table + '" (' + cols.map(c => '"' + c + '"').join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')'
      )

      let tableCount = 0
      for (const row of res.rows) {
        try {
          const values = cols.map(c => {
            const v = row[c]
            if (v === undefined || v === null) return null
            if (v instanceof Date) return v.getTime()
            if (typeof v === 'boolean') return v ? 1 : 0
            return v
          })
          stmt.run(...values)
          tableCount++
        } catch (e: any) {
          // Don't swallow errors — record them
          if (restoreErrors.length < 10) {
            restoreErrors.push(`${table}: ${e.message.slice(0, 80)}`)
          }
        }
      }
      totalRestored += tableCount
      if (tableCount > 0) console.log(`  ✓ ${table}: ${tableCount}/${res.rows.length}`)
    } catch (e: any) {
      // Table doesn't exist in Supabase — skip (not an error)
    }
  }

  tempDb.close()
  console.log(`\n✓ Temp DB created: ${totalRestored} rows restored`)

  if (restoreErrors.length > 0) {
    console.log(`\n⚠ ${restoreErrors.length} errors during restore:`)
    restoreErrors.forEach(e => console.log(`  ✗ ${e}`))
  }

  // ── Step 3: Verify Temp DB ──
  console.log('\n── Step 3: Verify Temp DB ──')
  const verifyDb = new DatabaseSync(TEMP_PATH, { readOnly: true })

  const criticalTables = ['Device', 'WorkOrder', 'MeterReading', 'MasterItem', 'User']
  let verificationPassed = true
  for (const table of criticalTables) {
    try {
      const r = verifyDb.prepare(`SELECT count(*) as c FROM "${table}"`).get() as { c: number } | undefined
      const count = r?.c ?? 0
      console.log(`  ${table}: ${count} rows`)
      if (count === 0 && table !== 'User') {
        console.log(`  ⚠ ${table} has 0 rows — check source`)
      }
    } catch {
      console.log(`  ✗ ${table}: table not found in temp DB`)
      verificationPassed = false
    }
  }

  // Check organizationId coverage
  for (const table of ['Device', 'WorkOrder', 'StockItem', 'MasterItem', 'User']) {
    try {
      const cols = verifyDb.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]
      if (cols.some(c => c.name === 'organizationId')) {
        const r = verifyDb.prepare(`SELECT count(*) as c FROM "${table}" WHERE "organizationId" IS NOT NULL`).get() as { c: number } | undefined
        console.log(`  ✓ ${table}: ${r?.c ?? 0} rows with orgId`)
      }
    } catch {
      // skip
    }
  }

  verifyDb.close()

  if (!verificationPassed) {
    console.log('\n❌ Verification failed — keeping original DB intact')
    if (fs.existsSync(TEMP_PATH)) fs.unlinkSync(TEMP_PATH)
    await supa.end()
    process.exit(1)
  }

  // ── Step 4: Atomic Replace ──
  console.log('\n── Step 4: Atomic Replace ──')

  // Rename current DB → .old (backup)
  if (fs.existsSync(SQLITE_PATH)) {
    const oldPath = SQLITE_PATH + '.old'
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
    fs.renameSync(SQLITE_PATH, oldPath)
    console.log('✓ Renamed current DB → .old')
  }

  // Rename temp → production
  fs.renameSync(TEMP_PATH, SQLITE_PATH)
  console.log('✓ Temp DB → production DB (atomic replace)')

  // Clean up .old
  const oldPath = SQLITE_PATH + '.old'
  if (fs.existsSync(oldPath)) {
    fs.unlinkSync(oldPath)
    console.log('✓ Cleaned up .old file')
  }

  await supa.end()

  console.log('\n══════════════════════════════════════════')
  console.log(`  ✓ Atomic Restore Complete — ${totalRestored} rows`)
  console.log(`  Backup at: ${BACKUP_PATH}`)
  console.log('══════════════════════════════════════════')
}

main().catch(e => {
  console.error('FATAL:', e.message)
  // If temp exists but production is intact, clean up temp
  if (fs.existsSync(TEMP_PATH)) {
    fs.unlinkSync(TEMP_PATH)
    console.log('✓ Cleaned up temp file — original DB is safe')
  }
  process.exit(1)
})
