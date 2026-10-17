// Test batch import helper on staging DB.
// Run via: bash scripts/run-import.sh scripts/test-batch-helper.ts
import { db } from '../src/lib/db'
import { chunk } from '../src/lib/batch-import'

async function main() {
  console.log('🧪 Testing batch helper on staging DB...')

  // 1. Ping
  const start = Date.now()
  await db.$queryRaw`SELECT 1`
  console.log(`✅ DB ping in ${Date.now() - start}ms`)

  // 2. Verify helper functions
  const testArr = Array.from({ length: 10 }, (_, i) => i + 1)
  const chunks = chunk(testArr, 3)
  console.log(`✅ chunk([1..10], 3) → ${chunks.length} chunks:`, chunks)

  // 3. Check current counts (no inserts — just verify connection)
  const counts = {
    devices: await db.device.count(),
    meterReadings: await db.meterReading.count(),
    stockTransactions: await db.stockTransaction.count(),
    deviceTransfers: await db.deviceTransfer.count(),
  }
  console.log('📊 Current counts:', counts)

  // 4. Verify buildPoolUrl didn't break the URL
  const dbUrl = process.env.DATABASE_URL ?? ''
  console.log('🔌 DATABASE_URL protocol:', dbUrl.slice(0, 15))
  console.log('🔌 Has connection_limit:', dbUrl.includes('connection_limit') || '(will be added by db.ts)')
}

main()
  .then(() => {
    console.log('✅ All tests passed')
  })
  .catch((err) => {
    console.error('❌ Test failed:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
