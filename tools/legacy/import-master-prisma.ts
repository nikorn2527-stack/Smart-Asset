import fs from 'fs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
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

async function main() {
  const csv = fs.readFileSync(CSV, 'utf-8')
  const rows = parse(csv)
  console.log('Total:', rows.length - 1)
  
  const data = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (row.length < 7) continue
    data.push({
      id: 'csv-' + row[0],
      code: row[0],
      category: row[1],
      label: row[2],
      parentRef: row[3] || null,
      displayLabel: row[5] || null,
      siteCode: row[6] || null,
      active: row[7] === 'TRUE',
      isDemo: false,
    })
  }
  console.log('Data to insert:', data.length)
  
  // First clear existing csv-* rows (in case partial)
  await prisma.masterItem.deleteMany({ where: { id: { startsWith: 'csv-' } } })
  
  const result = await prisma.masterItem.createMany({ data, skipDuplicates: true })
  console.log('✓ inserted:', result.count)
  console.log('MasterItem count now:', await prisma.masterItem.count())
  
  // Show categories
  const cats = await prisma.masterItem.groupBy({ by: ['category'], _count: true, orderBy: { _count: { category: 'desc' } } })
  console.log('Categories:')
  cats.forEach(c => console.log('  ', c.category, ':', c._count.category))
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
