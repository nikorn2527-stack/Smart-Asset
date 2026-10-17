import pg from 'pg'
import { DatabaseSync } from 'node:sqlite'

const sqlite = new DatabaseSync('./db/custom.db')
const supa = new pg.Client({ 
  connectionString: process.env.SUPABASE_DATABASE_URL,
  connectionTimeoutMillis: 30000,
})

// Column type map for Organization
const ORG_COLS: Array<{ name: string; type: 'text' | 'boolean' | 'timestamp' }> = [
  { name: 'id', type: 'text' },
  { name: 'code', type: 'text' },
  { name: 'name', type: 'text' },
  { name: 'type', type: 'text' },
  { name: 'timezone', type: 'text' },
  { name: 'currency', type: 'text' },
  { name: 'active', type: 'boolean' },
  { name: 'address', type: 'text' },
  { name: 'phone', type: 'text' },
  { name: 'email', type: 'text' },
  { name: 'logoUrl', type: 'text' },
  { name: 'createdAt', type: 'timestamp' },
  { name: 'updatedAt', type: 'timestamp' },
]

const MASTER_COLS: Array<{ name: string; type: 'text' | 'boolean' | 'timestamp' | 'integer' }> = [
  { name: 'id', type: 'text' },
  { name: 'category', type: 'text' },
  { name: 'code', type: 'text' },
  { name: 'label', type: 'text' },
  { name: 'organizationId', type: 'text' },
  { name: 'brand', type: 'text' },
  { name: 'model', type: 'text' },
  { name: 'deviceType', type: 'text' },
  { name: 'parentRef', type: 'text' },
  { name: 'displayLabel', type: 'text' },
  { name: 'siteCode', type: 'text' },
  { name: 'active', type: 'boolean' },
  { name: 'createdAt', type: 'timestamp' },
  { name: 'updatedAt', type: 'timestamp' },
  { name: 'isDemo', type: 'boolean' },
]

function convertValue(v: any, type: string): any {
  if (v === undefined || v === null) return null
  switch (type) {
    case 'boolean':
      if (typeof v === 'number') return v === 1
      if (typeof v === 'string') return v === 'true' || v === '1'
      return Boolean(v)
    case 'timestamp':
      if (typeof v === 'number') return new Date(v).toISOString()
      if (typeof v === 'string') {
        const d = new Date(v)
        return isNaN(d.getTime()) ? null : d.toISOString()
      }
      return null
    case 'integer':
      return parseInt(v) || 0
    default: // text
      return String(v)
  }
}

async function main() {
  await supa.connect()
  
  // 1. Sync Organization
  console.log('=== 1. Sync Organization ===')
  const orgs = sqlite.prepare('SELECT * FROM Organization').all() as any[]
  for (const o of orgs) {
    const values = ORG_COLS.map(c => convertValue(o[c.name], c.type))
    const colList = ORG_COLS.map(c => '"' + c.name + '"').join(', ')
    const placeholders = ORG_COLS.map((_, i) => '$' + (i + 1)).join(', ')
    const sql = `INSERT INTO "Organization" (${colList}) VALUES (${placeholders}) ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, type=EXCLUDED.type, active=EXCLUDED.active`
    await supa.query(sql, values)
  }
  console.log(`✓ Synced ${orgs.length} Organizations`)
  
  // 2. Backfill organizationId
  console.log('=== 2. Backfill organizationId ===')
  const orgId = orgs[0]?.id
  if (!orgId) { console.log('No org found'); await supa.end(); sqlite.close(); return }
  
  const tables = ['Device', 'WorkOrder', 'StockItem', 'MasterItem', 'User', 'AssetNumberPattern', 'WoNumberPattern']
  for (const t of tables) {
    const r = await supa.query(`UPDATE "${t}" SET "organizationId" = $1 WHERE "organizationId" IS NULL`, [orgId])
    console.log(`  ✓ ${t}: backfilled ${r.rowCount} rows`)
  }
  
  // 3. Backfill legacy codes
  const devLegacy = await supa.query(`UPDATE "Device" SET "legacyAssetCode" = "assetCode", "legacySourceApp" = 'itam' WHERE "legacyAssetCode" IS NULL`)
  console.log(`  ✓ Device.legacyAssetCode: set ${devLegacy.rowCount} rows`)
  const stockLegacy = await supa.query(`UPDATE "StockItem" SET "legacyProductCode" = "productCode", "legacySourceApp" = 'stock' WHERE "legacyProductCode" IS NULL`)
  console.log(`  ✓ StockItem.legacyProductCode: set ${stockLegacy.rowCount} rows`)
  
  // 4. Sync new MasterItems
  console.log('=== 3. Sync new MasterItems ===')
  const newMasterItems = sqlite.prepare("SELECT * FROM MasterItem WHERE id LIKE 'seed-%'").all() as any[]
  let inserted = 0, errors = 0
  for (const r of newMasterItems) {
    try {
      const values = MASTER_COLS.map(c => convertValue(r[c.name], c.type))
      const colList = MASTER_COLS.map(c => '"' + c.name + '"').join(', ')
      const placeholders = MASTER_COLS.map((_, i) => '$' + (i + 1)).join(', ')
      const sql = `INSERT INTO "MasterItem" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
      const res = await supa.query(sql, values)
      inserted += res.rowCount || 0
    } catch (e: any) {
      errors++
      if (errors <= 3) console.error('  ✗', r.code, ':', e.message.slice(0, 80))
    }
  }
  console.log(`✓ Synced ${inserted}/${newMasterItems.length} new MasterItems (errors ${errors})`)
  
  // 5. Verify
  console.log('')
  console.log('=== Verify ===')
  const counts = await Promise.all([
    supa.query('SELECT count(*) FROM "Organization"'),
    supa.query('SELECT count(*) FROM "MasterItem"'),
    supa.query('SELECT count(*) FROM "Device" WHERE "organizationId" IS NOT NULL'),
    supa.query('SELECT count(*) FROM "User" WHERE "organizationId" IS NOT NULL'),
    supa.query('SELECT count(*) FROM "WorkOrder" WHERE "organizationId" IS NOT NULL'),
  ])
  console.log(`  Organization: ${counts[0].rows[0].count}`)
  console.log(`  MasterItem: ${counts[1].rows[0].count}`)
  console.log(`  Device with orgId: ${counts[2].rows[0].count}`)
  console.log(`  User with orgId: ${counts[3].rows[0].count}`)
  console.log(`  WorkOrder with orgId: ${counts[4].rows[0].count}`)
  
  await supa.end()
  sqlite.close()
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
