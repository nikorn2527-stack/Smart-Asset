import { db } from '../src/lib/db'
async function main() {
  // Find WOs with approved parts transactions
  const txns = await db.stockTransaction.findMany({
    where: { type: 'OUT', approvalStatus: 'APPROVED', workOrderId: { not: null } },
    select: { workOrderId: true, workOrderNo: true, productCode: true, productName: true, quantity: true, cost: true },
    take: 10,
  })
  console.log('Approved OUT txns with WO:', txns.length)
  const byWo = new Map<string, number>()
  for (const t of txns) {
    const key = t.workOrderId ?? ''
    byWo.set(key, (byWo.get(key) ?? 0) + 1)
  }
  console.log('By WO:', Array.from(byWo.entries()).slice(0, 5))
  await db.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
