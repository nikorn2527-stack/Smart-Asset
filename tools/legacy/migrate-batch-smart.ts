import pg from 'pg'
import { DatabaseSync } from 'node:sqlite'

const SQLITE = '/home/z/my-project/db/custom.db'
const SUPA = process.env.SUPABASE_DATABASE_URL

const TS = new Set(['createdAt', 'updatedAt', 'lastLoginAt', 'assignedAt', 'workCompletedAt', 'closedAt', 'canceledAt', 'editUnlockAt', 'dateAdmin', 'deletedAt', 'txnDate', 'readingDate', 'approvedAt', 'completedAt', 'installDate', 'uninstallDate', 'warrantyEnd', 'purchaseDate', 'orderDate', 'effectiveFrom', 'effectiveTo', 'replacedAt'])
const BOOL = new Set(['isDemo', 'isSpecialFee', 'trackable', 'editUnlockActive', 'active', 'meterRequired'])

async function main() {
  const table = process.argv[2]
  const BATCH = parseInt(process.argv[3] || '500')
  
  if (!table) { console.error('Usage: migrate-batch-smart.ts <table> [batchSize]'); process.exit(1) }
  
  const sqlite = new DatabaseSync(SQLITE)
  const supa = new pg.Client({ connectionString: SUPA, connectionTimeoutMillis: 30000 })
  await supa.connect()
  await supa.query('SET session_replication_role = replica')
  
  const existing = await supa.query('SELECT id FROM "' + table + '"')
  const existingIds = new Set(existing.rows.map((r: any) => r.id))
  
  const allRows = sqlite.prepare('SELECT * FROM ' + table).all() as any[]
  const toMigrate = allRows.filter(r => !existingIds.has(r.id))
  
  console.log(`${table}: ${existingIds.size} in Supabase, ${toMigrate.length} to migrate (batch ${BATCH})`)
  
  if (toMigrate.length === 0) { await supa.end(); sqlite.close(); return }
  
  const cols = Object.keys(allRows[0])
  const colList = cols.map(c => '"' + c + '"').join(', ')
  const placeholders = cols.map((_, i) => '$' + (i + 1)).join(', ')
  const sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
  
  const batch = toMigrate.slice(0, BATCH)
  let inserted = 0, errors = 0
  for (const row of batch) {
    try {
      const values = cols.map(c => {
        const v = row[c]
        if (v === undefined || v === null) return null
        if (TS.has(c) && typeof v === 'number') return new Date(v).toISOString().replace('T', ' ').replace('Z', '')
        if (BOOL.has(c) && typeof v === 'number') return v === 1
        return v
      })
      const res = await supa.query(sql, values)
      inserted += res.rowCount || 0
    } catch (e: any) { errors++ }
  }
  
  await supa.query('SET session_replication_role = origin')
  await supa.end()
  sqlite.close()
  console.log(`✓ ${table}: ${inserted}/${batch.length} inserted, ${toMigrate.length - batch.length} remaining`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
