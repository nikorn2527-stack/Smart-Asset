import pg from 'pg'
import { DatabaseSync } from 'node:sqlite'

const sqlite = new DatabaseSync('./db/custom.db')
const supa = new pg.Client({ 
  connectionString: process.env.SUPABASE_DATABASE_URL,
  connectionTimeoutMillis: 30000,
})

async function main() {
  await supa.connect()
  console.log('=== Sync MasterItem codes to Supabase ===')
  
  // Get all MasterItems from local with new codes
  const items = sqlite.prepare("SELECT id, code FROM MasterItem").all() as any[]
  console.log(`Total MasterItems: ${items.length}`)
  
  let updated = 0, errors = 0
  for (const item of items) {
    try {
      await supa.query('UPDATE "MasterItem" SET code = $1 WHERE id = $2', [item.code, item.id])
      updated++
    } catch (e: any) {
      errors++
    }
  }
  console.log(`✓ Updated ${updated} codes (errors ${errors})`)
  
  // Sync LegacyReference
  console.log('=== Sync LegacyReference ===')
  const refs = sqlite.prepare("SELECT * FROM LegacyReference").all() as any[]
  console.log(`Total LegacyReferences: ${refs.length}`)
  
  const REF_COLS = ['id', 'organizationId', 'sourceApp', 'sourceSheet', 'sourceEntity', 'sourceRecordId', 'legacyCode', 'legacyLabel', 'targetEntity', 'targetId', 'targetCode', 'mappingStatus', 'mappingNote', 'createdAt', 'updatedAt']
  
  let refInserted = 0
  for (const r of refs) {
    try {
      const values = REF_COLS.map(c => {
        const v = r[c]
        if (v === undefined || v === null) return null
        if (c === 'createdAt' || c === 'updatedAt') return new Date(v).toISOString()
        return v
      })
      const colList = REF_COLS.map(c => '"' + c + '"').join(', ')
      const placeholders = REF_COLS.map((_, i) => '$' + (i + 1)).join(', ')
      const sql = `INSERT INTO "LegacyReference" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
      await supa.query(sql, values)
      refInserted++
    } catch (e: any) {
      // skip duplicates
    }
  }
  console.log(`✓ Synced ${refInserted} LegacyReferences`)
  
  await supa.end()
  sqlite.close()
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
