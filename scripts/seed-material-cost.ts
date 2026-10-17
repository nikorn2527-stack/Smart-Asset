/**
 * Seed material cost data — populate StockItems with costType fields
 * and a few sample OUT transactions for the current month.
 *
 * Run: bun ./scripts/seed-material-cost.ts
 *
 * Idempotent: skips items that already have productCode matching.
 */
import { db } from '../src/lib/db'

async function main() {
  const now = new Date()
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const today = now.toISOString().slice(0, 10)

  // ── 1. Define sample costed stock items (if not exist) ──
  const items = [
    {
      productCode: 'STK-INK-BK-001',
      productName: 'หมึกพิมพ์ดำ EPSON T544 (ขวด)',
      category: 'PCAT-001',
      brand: 'EPSON',
      model: 'T544',
      unit: 'ขวด',
      quantity: 10,
      minQuantity: 2,
      maxQuantity: 50,
      unitCost: 800,
      costType: 'consumable',
      yieldPerPage: 1500,
    },
    {
      productCode: 'STK-INK-CL-001',
      productName: 'หมึกพิมพ์สี Canon GI-469 (ขวด)',
      category: 'PCAT-001',
      brand: 'Canon',
      model: 'GI-469',
      unit: 'ขวด',
      quantity: 6,
      minQuantity: 2,
      maxQuantity: 30,
      unitCost: 1200,
      costType: 'consumable',
      yieldPerPage: 2000,
    },
    {
      productCode: 'STK-DRUM-001',
      productName: 'Drum Unit HP CF219A (ชิ้น)',
      category: 'PCAT-002',
      brand: 'HP',
      model: 'CF219A',
      unit: 'ชิ้น',
      quantity: 3,
      minQuantity: 1,
      maxQuantity: 10,
      unitCost: 3000,
      costType: 'spare_part',
      depreciationMethod: 'straight_line',
      usefulLifeMonths: 24,
    },
    {
      productCode: 'STK-FUSER-001',
      productName: 'Fuser Unit Canon C-EXV63 (ชิ้น)',
      category: 'PCAT-002',
      brand: 'Canon',
      model: 'C-EXV63',
      unit: 'ชิ้น',
      quantity: 2,
      minQuantity: 1,
      maxQuantity: 5,
      unitCost: 5000,
      costType: 'spare_part',
      depreciationMethod: 'usage_based',
      usefulLifePages: 100000,
    },
    {
      productCode: 'STK-SVC-001',
      productName: 'ค่าซ่อมนอก (เหมาจ่าย)',
      category: 'PCAT-011',
      brand: null,
      model: null,
      unit: 'ครั้ง',
      quantity: 0,
      minQuantity: 0,
      maxQuantity: 0,
      unitCost: 500,
      costType: 'service',
    },
  ]

  let createdCount = 0
  let skippedCount = 0
  for (const it of items) {
    const existing = await db.stockItem.findUnique({
      where: { productCode: it.productCode },
      select: { id: true },
    })
    if (existing) {
      skippedCount++
      continue
    }
    await db.stockItem.create({ data: it as never })
    createdCount++
  }
  console.log(`StockItems: ${createdCount} created, ${skippedCount} skipped (already exist)`)

  // ── 2. Fetch the created items + their ids ──
  const stockItems = await db.stockItem.findMany({
    where: { productCode: { in: items.map((i) => i.productCode) } },
    select: { id: true, productCode: true, unitCost: true, costType: true, yieldPerPage: true },
  })

  // ── 3. Create sample OUT transactions for the current month ──
  // Check if any already exist (idempotent by txnDate+stockItemId+sourceKey)
  const sourceKey = `seed-material-${monthStr}`
  const existingTxns = await db.stockTransaction.findMany({
    where: { sourceKey },
    select: { id: true },
  })
  if (existingTxns.length > 0) {
    console.log(`Transactions: ${existingTxns.length} already exist (sourceKey=${sourceKey}), skipping`)
  } else {
    const txns = [
      { stockItemId: stockItems.find((i) => i.productCode === 'STK-INK-BK-001')!.id, qty: 3 },
      { stockItemId: stockItems.find((i) => i.productCode === 'STK-INK-CL-001')!.id, qty: 2 },
      { stockItemId: stockItems.find((i) => i.productCode === 'STK-INK-BK-001')!.id, qty: 1 },
      { stockItemId: stockItems.find((i) => i.productCode === 'STK-DRUM-001')!.id, qty: 1 },
      { stockItemId: stockItems.find((i) => i.productCode === 'STK-FUSER-001')!.id, qty: 1 },
      { stockItemId: stockItems.find((i) => i.productCode === 'STK-SVC-001')!.id, qty: 2 },
    ]
    let txnCreated = 0
    for (const t of txns) {
      const item = stockItems.find((i) => i.id === t.stockItemId)!
      // Prisma Decimal fields accept plain numbers; multiplying a Prisma
      // Decimal by a number yields a Decimal instance that fails JSON
      // serialization ("Invalid value for argument `constructor`").
      // Convert to plain numbers explicitly.
      const unitCostNum = item.unitCost == null ? null : Number(item.unitCost)
      await db.stockTransaction.create({
        data: {
          stockItemId: t.stockItemId,
          productCode: item.productCode,
          productName: items.find((i) => i.productCode === item.productCode)!.productName,
          type: 'OUT',
          quantity: t.qty,
          unit: 'ขวด',
          balanceAfter: 0,
          unitCost: unitCostNum,
          cost: (unitCostNum ?? 0) * t.qty,
          reason: 'เบิกเพื่อใช้งาน (seed)',
          txnDate: today,
          sourceKey,
          isDemo: true,
        },
      })
      txnCreated++
    }
    console.log(`Transactions: ${txnCreated} created`)
  }

  console.log('DONE')
  await db.$disconnect()
}

main().catch((e) => {
  console.error('FAIL:', e)
  process.exit(1)
})
