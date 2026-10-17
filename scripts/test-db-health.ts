// Quick DB sanity test — run with: bunx tsx scripts/test-db-health.ts
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient({ log: ['error', 'warn'] })

async function main() {
  const start = Date.now()
  const ping = await db.$queryRaw`SELECT 1 as ok`
  console.log('✅ DB ping:', ping, 'in', Date.now() - start, 'ms')

  const counts = {
    devices: await db.device.count(),
    workOrders: await db.workOrder.count(),
    meterReadings: await db.meterReading.count(),
    stockTransactions: await db.stockTransaction.count(),
    deviceTransfers: await db.deviceTransfer.count(),
  }
  console.log('📊 Counts:', counts)
}

main()
  .catch((err) => {
    console.error('❌ ERROR:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
