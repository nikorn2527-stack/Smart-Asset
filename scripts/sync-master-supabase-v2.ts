import pg from 'pg'
import { DatabaseSync } from 'node:sqlite'

const sqlite = new DatabaseSync('./db/custom.db')
const supa = new pg.Client({ 
  connectionString: process.env.SUPABASE_DATABASE_URL,
  connectionTimeoutMillis: 30000,
})

async function main() {
  await supa.connect()
  const rows = sqlite.prepare("SELECT * FROM MasterItem WHERE id LIKE 'seed-%'").all() as any[]
  console.log('New seed MasterItems to sync:', rows.length)
  
  let inserted = 0, errors = 0
  for (const r of rows) {
    try {
      const cols = Object.keys(r)
      const values = cols.map(c => {
        const v = r[c]
        if (v === undefined || v === null) return null
        if (typeof v === 'number') return v === 1 ? true : false  // isDemo boolean
        if (c === 'createdAt' || c === 'updatedAt') return new Date(v).toISOString()
        return v
      })
      const colList = cols.map(c => '"' + c + '"').join(', ')
      const placeholders = cols.map((_, i) => '$' + (i + 1)).join(', ')
      const sql = `INSERT INTO "MasterItem" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
      await supa.query(sql, values)
      inserted++
    } catch (e: any) {
      errors++
      if (errors <= 3) console.error('✗', r.code, ':', e.message.slice(0, 80))
    }
  }
  console.log(`✓ Synced ${inserted}/${rows.length} to Supabase (errors ${errors})`)
  await supa.end()
  sqlite.close()
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
