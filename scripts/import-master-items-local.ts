import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'

const SQLITE = './db/custom.db'
const CSV = './upload/IT_Asset_Management_Database - Master_Items.csv'

function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false } }
      else { field += c }
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
  console.log('Total rows:', rows.length - 1)
  
  const db = new DatabaseSync(SQLITE)
  db.exec('PRAGMA foreign_keys = OFF')
  
  // Check MasterItem columns
  const cols = db.prepare("SELECT name FROM pragma_table_info('MasterItem')").all()
  console.log('MasterItem cols:', cols.map(c => c.name).join(', '))
  
  // Map CSV → MasterItem
  const colMap: Record<string, string> = {
    'ItemID': 'code',
    'CategoryKey': 'category',
    'Value': 'label',
    'GroupName': 'parentRef',
    'DisplayLabel': 'displayLabel',
    'SiteCode': 'siteCode',
  }
  
  const ts = Date.now()
  let inserted = 0, errors = 0
  
  const insert = db.prepare(`INSERT OR IGNORE INTO MasterItem (id, code, category, label, parentRef, displayLabel, siteCode, active, "createdAt", "updatedAt", isDemo) VALUES (@id, @code, @category, @label, @parentRef, @displayLabel, @siteCode, @active, @ts, @ts, 0)`)
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const obj: any = {}
    headers.forEach((h, idx) => {
      const target = colMap[h]
      if (target) {
        let v = row[idx] || ''
        if (target === 'active') v = v === 'TRUE' ? 1 : 0
        obj[target] = v || null
      }
    })
    obj.id = 'csv-' + (obj.code || i)
    obj.ts = ts
    
    try {
      const info = insert.run(obj)
      inserted += info.changes
    } catch (e: any) {
      errors++
      if (errors <= 3) console.error('  ✗', obj.code, ':', e.message.slice(0, 80))
    }
  }
  
  db.close()
  console.log(`✓ MasterItem: ${inserted}/${rows.length - 1} imported (errors ${errors})`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
