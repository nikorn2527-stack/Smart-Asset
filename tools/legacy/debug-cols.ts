import pg from 'pg'
import { DatabaseSync } from 'node:sqlite'

async function main() {
  const sqlite = new DatabaseSync('/home/z/my-project/db/custom.db')
  const sqliteCols = Object.keys(sqlite.prepare('SELECT * FROM Device LIMIT 1').get() as object)
  console.log('SQLite Device cols (' + sqliteCols.length + '):', sqliteCols.slice(0, 8).join(', '), '...')

  const c = new pg.Client({ connectionString: process.env.SUPABASE_DATABASE_URL })
  await c.connect()
  const colRes = await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='Device'")
  const supaCols = colRes.rows.map((r: any) => r.column_name)
  console.log('Supabase Device cols (' + supaCols.length + '):', supaCols.slice(0, 8).join(', '), '...')
  console.log('')
  const common = sqliteCols.filter(col => supaCols.includes(col))
  console.log('Common cols:', common.length)
  console.log('SQLite-only:', sqliteCols.filter(col => !supaCols.includes(col)).slice(0, 5))
  console.log('Supabase-only:', supaCols.filter((col: string) => !sqliteCols.includes(col)).slice(0, 5))
  await c.end()
  sqlite.close()
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
