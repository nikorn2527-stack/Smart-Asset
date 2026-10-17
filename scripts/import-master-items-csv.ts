import pg from 'pg'
import fs from 'fs'

const SUPA = process.env.SUPABASE_DATABASE_URL
const CSV = './upload/IT_Asset_Management_Database - Master_Items.csv'

// Parse CSV (RFC 4180)
function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else { field += c }
      continue
    }
    if (c === '"') { inQuotes = true; continue }
    if (c === ',') { cur.push(field); field = ''; continue }
    if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; continue }
    if (c === '\r') continue
    field += c
  }
  if (field || cur.length) { cur.push(field); rows.push(cur) }
  return rows.filter(r => r.length > 1 || r[0] !== '')
}

async function main() {
  const csv = fs.readFileSync(CSV, 'utf-8')
  const rows = parseCsv(csv)
  const headers = rows[0]
  console.log('CSV headers:', headers.join(', '))
  console.log('Total rows:', rows.length - 1)
  
  const supa = new pg.Client({ connectionString: SUPA })
  await supa.connect()
  await supa.query('SET session_replication_role = replica')
  
  // Get MasterItem columns from Supabase
  const colRes = await supa.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='MasterItem'")
  const supaCols = colRes.rows.map((r: any) => r.column_name)
  console.log('Supabase MasterItem cols:', supaCols.join(', '))
  
  // Map CSV columns → MasterItem columns:
  // ItemID → code
  // CategoryKey → category
  // Value → label
  // GroupName → parentRef
  // DisplayLabel → displayLabel
  // SiteCode → siteCode
  // AllowedSites → (skip, no column)
  // Active → active (TRUE/FALSE → boolean)
  // DepartmentCode → (skip, no direct column)
  
  const colMap: Record<string, string> = {
    'ItemID': 'code',
    'CategoryKey': 'category',
    'Value': 'label',
    'GroupName': 'parentRef',
    'DisplayLabel': 'displayLabel',
    'SiteCode': 'siteCode',
  }
  
  let inserted = 0, errors = 0
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '')
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const obj: any = {}
    headers.forEach((h, idx) => {
      const target = colMap[h]
      if (target) {
        let v = row[idx] || ''
        if (target === 'active') v = v === 'TRUE'
        obj[target] = v || null
      }
    })
    obj.id = 'csv-' + (obj.code || i)
    obj.createdAt = ts
    obj.updatedAt = ts
    obj.isDemo = false
    
    try {
      const cols = Object.keys(obj)
      const values = cols.map(c => obj[c])
      const colList = cols.map(c => '"' + c + '"').join(', ')
      const placeholders = cols.map((_, idx) => '$' + (idx + 1)).join(', ')
      const sql = `INSERT INTO "MasterItem" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
      const res = await supa.query(sql, values)
      inserted += res.rowCount || 0
    } catch (e: any) {
      errors++
      if (errors <= 3) console.error(`  ✗ row ${i} ${obj.code}: ${e.message.slice(0, 100)}`)
    }
  }
  
  await supa.query('SET session_replication_role = origin')
  await supa.end()
  console.log(`✓ MasterItem: ${inserted}/${rows.length - 1} imported (errors ${errors})`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
