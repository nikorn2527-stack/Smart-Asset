// Migrate WorkOrder + AuditLog in small batches (500 rows each invocation)
// Usage: npx tsx scripts/migrate-batch.ts <batchSize>
import pg from 'pg'
import { DatabaseSync } from 'node:sqlite'

const BATCH_SIZE = parseInt(process.argv[2] || '500')

async function migrateTable(table: string, timestampCols: Set<string>, boolCols: Set<string>) {
  const sqlite = new DatabaseSync('/home/z/my-project/db/custom.db')
  const supa = new pg.Client({ 
    connectionString: process.env.SUPABASE_DATABASE_URL,
    connectionTimeoutMillis: 30000,
  })
  await supa.connect()
  await supa.query('SET session_replication_role = replica')
  
  // Get IDs already in Supabase
  const existing = await supa.query('SELECT id FROM "' + table + '"')
  const existingIds = new Set(existing.rows.map((r: any) => r.id))
  
  const allRows = sqlite.prepare('SELECT * FROM ' + table).all() as any[]
  const toMigrate = allRows.filter(r => !existingIds.has(r.id))
  console.log(`${table}: ${existingIds.size} already in Supabase, ${toMigrate.length} remaining`)
  
  if (toMigrate.length === 0) {
    await supa.end(); sqlite.close(); return 0
  }
  
  const batch = toMigrate.slice(0, BATCH_SIZE)
  const cols = Object.keys(allRows[0])
  const colList = cols.map(c => '"' + c + '"').join(', ')
  const placeholders = cols.map((_, i) => '$' + (i + 1)).join(', ')
  const sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
  
  let inserted = 0, errors = 0
  for (const row of batch) {
    try {
      const values = cols.map(c => {
        const v = row[c]
        if (v === undefined || v === null) return null
        if (timestampCols.has(c) && typeof v === 'number') return new Date(v).toISOString()
        if (boolCols.has(c) && typeof v === 'number') return v === 1
        return v
      })
      const res = await supa.query(sql, values)
      inserted += res.rowCount || 0
    } catch (e: any) {
      errors++
      if (errors <= 1) console.error(`  ✗ ${e.message.slice(0, 120)}`)
    }
  }
  
  await supa.query('SET session_replication_role = origin')
  await supa.end()
  sqlite.close()
  console.log(`✓ ${table}: ${inserted}/${batch.length} inserted (errors ${errors}), ${toMigrate.length - batch.length} remaining`)
  return toMigrate.length - batch.length
}

async function main() {
  const tsCols = new Set(['createdAt', 'updatedAt', 'assignedAt', 'workCompletedAt', 'closedAt', 'canceledAt', 'editUnlockAt', 'dateAdmin', 'deletedAt'])
  const boolCols = new Set(['isDemo', 'isSpecialFee', 'trackable', 'editUnlockActive'])
  
  let remaining = await migrateTable('WorkOrder', tsCols, boolCols)
  
  // If WorkOrder done, do AuditLog
  if (remaining === 0) {
    const tsCols2 = new Set(['createdAt'])
    await migrateTable('AuditLog', tsCols2, new Set())
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
