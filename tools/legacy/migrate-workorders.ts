import pg from 'pg'
import { DatabaseSync } from 'node:sqlite'

async function main() {
  const sqlite = new DatabaseSync('/home/z/my-project/db/custom.db')
  const supa = new pg.Client({ 
    connectionString: process.env.SUPABASE_DATABASE_URL,
    connectionTimeoutMillis: 30000,
    query_timeout: 60000
  })
  await supa.connect()
  await supa.query('SET session_replication_role = replica')
  
  const timestampCols = new Set(['createdAt', 'updatedAt', 'lastLoginAt', 'assignedAt', 'workCompletedAt', 'closedAt', 'canceledAt', 'editUnlockAt', 'dateAdmin', 'deletedAt', 'txnDate', 'readingDate', 'approvedAt', 'completedAt'])
  
  // WorkOrder: 4942 rows
  const tables = ['WorkOrder', 'AuditLog']
  let total = 0
  
  for (const table of tables) {
    const rows = sqlite.prepare('SELECT * FROM ' + table).all() as any[]
    console.log(`Migrating ${table}: ${rows.length} rows`)
    
    let inserted = 0, errors = 0
    const cols = Object.keys(rows[0])
    const colList = cols.map(c => '"' + c + '"').join(', ')
    const placeholders = cols.map((_, i) => '$' + (i + 1)).join(', ')
    const sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      try {
        const values = cols.map(c => {
          const v = row[c]
          if (v === undefined || v === null) return null
          if (timestampCols.has(c) && typeof v === 'number') return new Date(v).toISOString()
          if (typeof v === 'number' && (v === 0 || v === 1) && (c.startsWith('is') || c === 'trackable' || c === 'editUnlockActive' || c === 'active')) return v === 1
          return v
        })
        const res = await supa.query(sql, values)
        inserted += res.rowCount || 0
        if ((i + 1) % 500 === 0) console.log(`  ${table}: ${i + 1}/${rows.length} processed...`)
      } catch (e: any) {
        errors++
        if (errors <= 2) console.error(`  ✗ ${table} row ${i}: ${e.message.slice(0, 100)}`)
      }
    }
    total += inserted
    console.log(`✓ ${table}: ${inserted}/${rows.length} inserted (errors ${errors})`)
  }
  
  await supa.query('SET session_replication_role = origin')
  await supa.end()
  sqlite.close()
  console.log(`\n═══ Done — Total: ${total} rows ═══`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
