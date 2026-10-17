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
  
  const existing = await supa.query('SELECT id FROM "AuditLog"')
  const existingIds = new Set(existing.rows.map((r: any) => r.id))
  
  const allRows = sqlite.prepare('SELECT * FROM AuditLog').all() as any[]
  const toMigrate = allRows.filter(r => !existingIds.has(r.id))
  console.log(`AuditLog: ${existingIds.size} already in Supabase, ${toMigrate.length} remaining`)
  
  const cols = Object.keys(allRows[0])
  console.log('AuditLog cols:', cols.join(', '))
  
  // Sample row with createdAt
  const sample = toMigrate[0]
  if (sample) {
    console.log('Sample createdAt:', sample.createdAt, typeof sample.createdAt)
    if (typeof sample.createdAt === 'number') {
      console.log('  → ISO:', new Date(sample.createdAt).toISOString())
    } else if (typeof sample.createdAt === 'string') {
      console.log('  → string value:', sample.createdAt.slice(0, 50))
    }
  }
  
  const colList = cols.map(c => '"' + c + '"').join(', ')
  const placeholders = cols.map((_, i) => '$' + (i + 1)).join(', ')
  const sql = `INSERT INTO "AuditLog" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
  
  let inserted = 0, errors = 0
  for (const row of toMigrate) {
    try {
      const values = cols.map(c => {
        const v = row[c]
        if (v === undefined || v === null) return null
        // createdAt: convert number → ISO; pass string as-is
        if ((c === 'createdAt' || c === 'updatedAt') && typeof v === 'number') return new Date(v).toISOString().replace('T', ' ').replace('Z', '')
        return v
      })
      const res = await supa.query(sql, values)
      inserted += res.rowCount || 0
    } catch (e: any) {
      errors++
      if (errors <= 3) console.error(`  ✗ ${e.message.slice(0, 150)} | createdAt=${row.createdAt}`)
    }
  }
  
  await supa.query('SET session_replication_role = origin')
  await supa.end()
  sqlite.close()
  console.log(`✓ AuditLog: ${inserted}/${toMigrate.length} inserted (errors ${errors})`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
