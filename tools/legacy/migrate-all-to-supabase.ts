import pg from 'pg'
import { DatabaseSync } from 'node:sqlite'

const SQLITE = '/home/z/my-project/db/custom.db'
const SUPA = process.env.SUPABASE_DATABASE_URL

const TABLES = [
  'AppSetting', 'User', 'Device', 'StockItem', 'PurchaseOrder',
  'StockTransaction', 'WorkOrder', 'MeterReading', 'AuditLog',
  'Cycle', 'DocumentTemplate', 'DeviceTransfer',
]

const TIMESTAMP_COLS = new Set(['createdAt', 'updatedAt', 'lastLoginAt', 'assignedAt', 'workCompletedAt', 'closedAt', 'canceledAt', 'editUnlockAt', 'dateAdmin', 'deletedAt', 'txnDate', 'readingDate', 'approvedAt', 'completedAt', 'installDate', 'uninstallDate', 'warrantyEnd', 'purchaseDate', 'orderDate', 'effectiveFrom', 'effectiveTo', 'replacedAt'])

const BOOL_COLS = new Set(['isDemo', 'isSpecialFee', 'trackable', 'editUnlockActive', 'active', 'meterRequired'])

async function migrateTable(sqlite: any, supa: any, table: string) {
  // Get existing IDs in Supabase (skip them)
  const existing = await supa.query('SELECT id FROM "' + table + '"')
  const existingIds = new Set(existing.rows.map((r: any) => r.id))
  
  const allRows = sqlite.prepare('SELECT * FROM ' + table).all() as any[]
  const toMigrate = allRows.filter(r => !existingIds.has(r.id))
  
  if (toMigrate.length === 0) {
    console.log(`  ${table}: 0 new (all ${existingIds.size} already in Supabase)`)
    return 0
  }
  
  const cols = Object.keys(allRows[0])
  const colList = cols.map(c => '"' + c + '"').join(', ')
  const placeholders = cols.map((_, i) => '$' + (i + 1)).join(', ')
  const sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
  
  let inserted = 0, errors = 0
  const BATCH = 200
  
  for (let i = 0; i < toMigrate.length; i++) {
    const row = toMigrate[i]
    try {
      const values = cols.map(c => {
        const v = row[c]
        if (v === undefined || v === null) return null
        if (TIMESTAMP_COLS.has(c) && typeof v === 'number') {
          return new Date(v).toISOString().replace('T', ' ').replace('Z', '')
        }
        if (BOOL_COLS.has(c) && typeof v === 'number') return v === 1
        return v
      })
      const res = await supa.query(sql, values)
      inserted += res.rowCount || 0
    } catch (e: any) {
      errors++
      if (errors <= 1) console.error(`  ✗ ${table}: ${e.message.slice(0, 100)}`)
    }
    if ((i + 1) % 1000 === 0) console.log(`  ${table}: ${i + 1}/${toMigrate.length}...`)
  }
  console.log(`✓ ${table}: ${inserted}/${toMigrate.length} inserted (skipped ${existingIds.size} existing, errors ${errors})`)
  return inserted
}

async function main() {
  const sqlite = new DatabaseSync(SQLITE)
  const supa = new pg.Client({ connectionString: SUPA, connectionTimeoutMillis: 30000 })
  await supa.connect()
  await supa.query('SET session_replication_role = replica')
  
  let total = 0
  for (const table of TABLES) {
    try {
      total += await migrateTable(sqlite, supa, table)
    } catch (e: any) {
      console.error(`✗ ${table}: ${e.message.slice(0, 150)}`)
    }
  }
  
  await supa.query('SET session_replication_role = origin')
  await supa.end()
  sqlite.close()
  console.log(`\n═══ Migration complete — Total: ${total} new rows ═══`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
