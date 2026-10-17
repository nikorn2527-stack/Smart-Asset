/**
 * Seed a Work Order with approved parts transactions for cost-summary testing.
 * Links existing costed StockItems to a real WO with APPROVED OUT transactions.
 *
 * Run: bun /home/z/my-project/scripts/seed-wo-parts-cost.ts
 *
 * Idempotent: skips if transactions with sourceKey already exist.
 */
import { db } from '../src/lib/db'

async function main() {
  // 1. Find a WO (any status — we just need it linked)
  const wo = await db.workOrder.findFirst({
    where: { status: { in: ['COMPLETED', 'IN_PROGRESS', 'WAITING_PARTS'] } },
    select: { id: true, woNumber: true, systemJobNo: true, legacyJobNo: true, subject: true },
  })
  if (!wo) {
    console.log('No WO found — skipping')
    return
  }
  console.log('Target WO:', wo.woNumber, '(', wo.id, ')')

  // 2. Find costed stock items
  const items = await db.stockItem.findMany({
    where: {
      productCode: { in: ['STK-INK-BK-001', 'STK-INK-CL-001', 'STK-DRUM-001', 'STK-FUSER-001', 'STK-SVC-001'] },
    },
    select: { id: true, productCode: true, productName: true, unit: true, unitCost: true, quantity: true, costType: true, yieldPerPage: true },
  })
  console.log('Costed items found:', items.length)

  // 3. Check idempotency
  const sourceKey = `seed-wo-parts-${wo.id}`
  const existing = await db.stockTransaction.findMany({
    where: { sourceKey },
    select: { id: true },
  })
  if (existing.length > 0) {
    console.log(`Already seeded ${existing.length} parts for this WO — skipping`)
    await db.$disconnect()
    return
  }

  // 4. Create APPROVED OUT transactions linked to this WO
  const today = new Date().toISOString().slice(0, 10)
  const txnData = [
    { item: items.find((i) => i.productCode === 'STK-INK-BK-001')!, qty: 2 },
    { item: items.find((i) => i.productCode === 'STK-INK-CL-001')!, qty: 1 },
    { item: items.find((i) => i.productCode === 'STK-DRUM-001')!, qty: 1 },
    { item: items.find((i) => i.productCode === 'STK-SVC-001')!, qty: 1 },
  ].filter((t) => t.item)

  let created = 0
  for (const t of txnData) {
    await db.stockTransaction.create({
      data: {
        stockItemId: t.item.id,
        productCode: t.item.productCode,
        productName: t.item.productName,
        type: 'OUT',
        quantity: t.qty,
        unit: t.item.unit,
        balanceAfter: t.item.quantity,
        reason: `เบิกอะไหล่ใบงาน ${wo.woNumber ?? ''} (seed)`,
        requester: 'seed-script',
        purpose: wo.subject,
        workOrderId: wo.id,
        workOrderNo: wo.woNumber,
        unitCost: t.item.unitCost,
        cost: (t.item.unitCost ?? 0) * t.qty,
        txnDate: today,
        sourceKey,
        approvalStatus: 'APPROVED',
        approvalMode: 'manual',
        approver: 'seed-script',
        approvedAt: new Date().toISOString(),
        isDemo: true,
      } as never,
    })
    created++
  }
  console.log(`Created ${created} APPROVED OUT transactions for WO ${wo.woNumber}`)
  console.log('DONE')
  await db.$disconnect()
}

main().catch((e) => {
  console.error('FAIL:', e)
  process.exit(1)
})
