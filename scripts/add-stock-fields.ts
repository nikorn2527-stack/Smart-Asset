import { db } from '../src/lib/db'
async function main() {
  const existing = await db.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'StockItem' AND column_name IN ('costType', 'yieldPerPage', 'depreciationMethod', 'usefulLifeMonths', 'usefulLifePages')`
  console.log('existing:', JSON.stringify(existing))
  const exists = (existing as any[]).map(r => r.column_name)
  
  const toAdd = [
    { name: 'costType', type: 'TEXT' },
    { name: 'yieldPerPage', type: 'INTEGER' },
    { name: 'depreciationMethod', type: 'TEXT' },
    { name: 'usefulLifeMonths', type: 'INTEGER' },
    { name: 'usefulLifePages', type: 'INTEGER' },
  ]
  
  for (const c of toAdd) {
    if (exists.includes(c.name)) {
      console.log(`SKIP ${c.name} (already exists)`)
      continue
    }
    console.log(`Adding ${c.name}...`)
    await db.$executeRawUnsafe(`ALTER TABLE "StockItem" ADD COLUMN "${c.name}" ${c.type} NULL`)
    console.log(`  ok ${c.name} added`)
  }
  
  const idxExists = await db.$queryRaw`SELECT indexname FROM pg_indexes WHERE tablename = 'StockItem' AND indexname = 'StockItem_costType_idx'`
  if ((idxExists as any[]).length === 0) {
    console.log('Creating index StockItem_costType_idx...')
    await db.$executeRawUnsafe(`CREATE INDEX "StockItem_costType_idx" ON "StockItem"("costType")`)
    console.log('  ok index created')
  } else {
    console.log('Index already exists')
  }
  
  console.log('DONE')
  await db.$disconnect()
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1) })
