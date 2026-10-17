import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'

const SQLITE = '/home/z/my-project/db/custom.db'
const CSV = '/home/z/my-project/upload/IT_Asset_Management_Database - Master_Items.csv'

function parse(text: string): string[][] {
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
  return rows
}

const csv = fs.readFileSync(CSV, 'utf-8')
const rows = parse(csv)
console.log('Total CSV rows:', rows.length - 1)

const db = new DatabaseSync(SQLITE)
db.exec('PRAGMA foreign_keys = OFF')

// Clear existing csv-* rows first
const del = db.prepare("DELETE FROM MasterItem WHERE id LIKE 'csv-%'").run()
console.log('Cleared existing csv-* rows:', del.changes)

const ts = Date.now()
const stmt = db.prepare(`INSERT OR REPLACE INTO MasterItem (id, code, category, label, parentRef, displayLabel, siteCode, active, "createdAt", "updatedAt", isDemo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`)

let inserted = 0, errors = 0
for (let i = 1; i < rows.length; i++) {
  const row = rows[i]
  if (row.length < 7) { errors++; continue }
  try {
    const info = stmt.run(
      'csv-' + row[0],
      row[0],
      row[1],
      row[2],
      row[3] || null,
      row[5] || null,
      row[6] || null,
      row[7] === 'TRUE' ? 1 : 0,
      ts, ts
    )
    inserted += info.changes
  } catch (e: any) {
    errors++
    if (errors <= 3) console.error('  ✗', row[0], ':', e.message.slice(0, 80))
  }
}

const count = db.prepare('SELECT count(*) as c FROM MasterItem').get().c
console.log(`✓ Inserted: ${inserted} (errors ${errors})`)
console.log(`MasterItem total count: ${count}`)

// Show categories
const cats = db.prepare("SELECT category, count(*) as c FROM MasterItem GROUP BY category ORDER BY c DESC").all()
console.log('Categories:')
cats.forEach(c => console.log(`  ${c.category}: ${c.c}`))

db.close()
