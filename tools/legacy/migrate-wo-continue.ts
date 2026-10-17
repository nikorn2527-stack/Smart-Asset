import pg from 'pg'
import { DatabaseSync } from 'node:sqlite'

async function main() {
  const sqlite = new DatabaseSync('/home/z/my-project/db/custom.db')
  const supa = new pg.Client({ 
    connectionString: process.env.SUPABASE_DATABASE_URL,
    connectionTimeoutMillis: 30000,
  })
  await supa.connect()
  await supa.query('SET session_replication_role = replica')
  
  const timestampCols = new Set(['createdAt', 'updatedAt', 'assignedAt', 'workCompletedAt', 'closedAt', 'canceledAt', 'editUnlockAt', 'dateAdmin', 'deletedAt'])
  
  // Get all WorkOrder IDs that are already in Supabase (skip them)
  const existing = await supa.query('SELECT id FROM "WorkOrder"')
  const existingIds = new Set(existing.rows.map((r: any) => r.id))
  console.log('Already in Supabase:', existingIds.size)
  
  // Get all WorkOrders from SQLite
  const allRows = sqlite.prepare('SELECT * FROM WorkOrder').all() as any[]
  const rowsToMigrate = allRows.filter(r => !existingIds.has(r.id))
  console.log('To migrate:', rowsToMigrate.length)
  
  let inserted = 0, errors = 0
  const cols = Object.keys(allRows[0])
  const colList = cols.map(c => '"' + c + '"').join(', ')
  const placeholders = cols.map((_, i) => '$' + (i + 1)).join(', ')
  const sql = `INSERT INTO "WorkOrder" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
  
  for (let i = 0; i < rowsToMigrate.length; i++) {
    const row = rowsToMigrate[i]
    try {
      const values = cols.map(c => {
        const v = row[c]
        if (v === undefined || v === null) return null
        if (timestampCols.has(c) && typeof v === 'number') return new Date(v).toISOString()
        if (typeof v === 'number' && (v === 0 || v === 1) && (c.startsWith('is') || c === 'trackable' || c === 'editUnlockActive')) return v === 1
        return v
      })
      const res = await supa.query(sql, values)
      inserted += res.rowCount || 0
      if ((i + 1) % 500 === 0) console.log(`  ${i + 1}/${rowsToMigrate.length} processed...`)
    } catch (e: any) {
      errors++
      if (errors <= 2) console.error(`  ✗ row ${i}: ${e.message.slice(0, 100)}`)
    }
  }
  
  await supa.query('SET session_replication_role = origin')
  await supa.end()
  sqlite.close()
  console.log(`✓ WorkOrder: ${inserted}/${rowsToMigrate.length} inserted (errors ${errors})`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
