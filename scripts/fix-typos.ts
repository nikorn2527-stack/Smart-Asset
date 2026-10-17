/**
 * fix-typos.ts — Backfill/correct Thai-character typos in DB records.
 *
 * Bug Group A — Seed data typos (Low):
 *   1. StockItem.unit "กล่่อง" → "กล่อง" (extra "่")
 *   2. Device.department "หอผู้ป่วยอายุุรกรรมหญิง" → "หอผู้ป่วยอายุรกรรมหญิง" (extra "ุ")
 *      Device.department "OPD อายุุรกรรม" → "OPD อายุรกรรม" (extra "ุ")
 *   3. User.name "นิกร พันโนนงื้ว" → "นิกร พันโนน"
 *   4. MasterItem.label "OPD อายุุรกรรม" / "หอผู้ป่วยอายุุรกรรมหญิง" → fixed versions
 *
 * Run: bun scripts/fix-typos.ts
 *
 * Note: These typos originated from CSV uploads
 * (upload/IT_Asset_Management_Database - Master_Items.csv,
 *  upload/IT_Asset_Management_Database - All_Devices.csv).
 * The CSV source files have been corrected to prevent future re-imports.
 */

import { db } from '../src/lib/db'

async function main() {
  console.log('🔧 Fixing Thai-character typos in DB...\n')
  let totalUpdated = 0

  // ── 1. StockItem.unit "กล่่อง" → "กล่อง" ──
  console.log('1. StockItem.unit "กล่่อง" → "กล่อง"')
  const stockUpdated = await db.stockItem.updateMany({
    where: { OR: [{ unit: { contains: 'กล่่อง' } }, { productName: { contains: 'กล่่อง' } }] },
    data: {
      unit: 'กล่อง',
    },
  })
  // Also fix productName if it had the typo
  await db.stockItem.updateMany({
    where: { productName: { contains: 'กล่่อง' } },
    data: { productName: 'หมึก WF-M5899 (BK)' },
  })
  console.log(`  ✓ Updated ${stockUpdated.count} stock item(s)`)
  totalUpdated += stockUpdated.count

  // ── 2. Device.department typos ──
  console.log('2. Device.department "อายุุรกรรม" → "อายุรกรรม"')
  const devUpdated1 = await db.device.updateMany({
    where: { department: { contains: 'อายุุรกรรม' } },
    data: {
      department: 'หอผู้ป่วยอายุรกรรมหญิง',
    },
  })
  // Some have "OPD อายุุรกรรม" — fix those separately
  const devUpdated2 = await db.device.updateMany({
    where: { department: { contains: 'OPD อายุุรกรรม' } },
    data: {
      department: 'OPD อายุรกรรม',
    },
  })
  const devTotal = devUpdated1.count + devUpdated2.count
  console.log(`  ✓ Updated ${devTotal} device(s)`)
  totalUpdated += devTotal

  // ── 3. User.name "นิกร พันโนนงื้ว" → "นิกร พันโนน" ──
  console.log('3. User.name "นิกร พันโนนงื้ว" → "นิกร พันโนน"')
  const userUpdated = await db.user.updateMany({
    where: { name: { contains: 'พันโนนงื้ว' } },
    data: {
      name: 'นิกร พันโนน',
    },
  })
  console.log(`  ✓ Updated ${userUpdated.count} user(s)`)
  totalUpdated += userUpdated.count

  // ── 4. MasterItem.label typos ──
  console.log('4. MasterItem.label typos')
  const miUpdated1 = await db.masterItem.updateMany({
    where: { label: { contains: 'OPD อายุุรกรรม' } },
    data: { label: 'OPD อายุรกรรม' },
  })
  const miUpdated2 = await db.masterItem.updateMany({
    where: { label: { contains: 'หอผู้ป่วยอายุุรกรรมหญิง' } },
    data: { label: 'หอผู้ป่วยอายุรกรรมหญิง' },
  })
  const miTotal = miUpdated1.count + miUpdated2.count
  console.log(`  ✓ Updated ${miTotal} master item(s)`)
  totalUpdated += miTotal

  console.log('\n' + '═'.repeat(50))
  console.log(`✓ Total records updated: ${totalUpdated}`)
  console.log('═'.repeat(50))

  await db.$disconnect()
}

main().catch(async (e) => {
  console.error('❌ Fix typos failed:', e)
  await db.$disconnect()
  process.exit(1)
})
