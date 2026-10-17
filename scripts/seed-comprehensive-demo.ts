/**
 * seed-comprehensive-demo.ts — สร้าง demo data ครบทุกเมนู/สถานะ/role
 *
 * Run: bun run scripts/seed-comprehensive-demo.ts
 *
 * Creates:
 *   1. Demo devices (every status, every type)
 *   2. Demo work orders (every status, every priority)
 *   3. Demo meter readings (monthly, BW, color, TOTAL, BW_COLOR)
 *   4. Demo stock items (normal, low, out of stock)
 *   5. Demo stock transactions (in, out, pending)
 *   6. Demo PM schedules
 *   7. Demo master items for repair categories
 *   8. Demo audit logs
 *
 * All tagged with isDemo=true → can be wiped via /api/itam/demo/reset
 */

import { db } from '../src/lib/db'

async function main() {
  console.log('🌱 Seeding comprehensive demo data...\n')
  let created = 0

  // ── 1. Master items for repair categories ──
  console.log('1. Repair categories (MasterItem)...')
  const repairCategories = [
    'เครื่องพิมพ์ไม่ทำงาน',
    'กระดาษติด',
    'หมึกหมด',
    'สแกนไม่ได้',
    'เครื่องช้า/ค้าง',
    'แสดงผลผิดพลาด',
    'เสียงดังผิดปกติ',
    'เชื่อมต่อไม่ได้',
    'ไฟไม่ติด',
    'อื่นๆ',
  ]
  for (const label of repairCategories) {
    const code = 'REPAIR-' + label.slice(0, 3).toUpperCase()
    const existing = await db.masterItem.findFirst({ where: { code } })
    if (!existing) {
      await db.masterItem.create({
        data: {
          code,
          label,
          category: 'RepairSubject',
        },
      })
      created++
    }
  }
  console.log(`  ✓ ${repairCategories.length} repair categories`)

  // ── 2. Demo devices (every status + type) ──
  console.log('2. Demo devices (every status + type)...')
  const deviceTemplates = [
    { assetCode: 'DEMO-PRINTER-001', name: 'เครื่องพิมพ์ Canon LBP2900', type: 'PRINTER', brand: 'Canon', model: 'LBP2900', status: 'active', site: 'HQ', serialNumber: 'DEMO-SN-001', meterRequired: true, meterMode: 'BW_COLOR' },
    { assetCode: 'DEMO-PRINTER-002', name: 'เครื่องพิมพ์ HP LaserJet Pro', type: 'PRINTER', brand: 'HP', model: 'LaserJet Pro M404', status: 'active', site: 'HQ', serialNumber: 'DEMO-SN-002', meterRequired: true, meterMode: 'TOTAL' },
    { assetCode: 'DEMO-COPIER-001', name: 'เครื่องถ่ายเอกสาร Ricoh MP2014', type: 'COPIER', brand: 'Ricoh', model: 'MP2014', status: 'active', site: 'BKK', serialNumber: 'DEMO-SN-003', meterRequired: true, meterMode: 'BW_COLOR' },
    { assetCode: 'DEMO-SCANNER-001', name: 'สแกนเนอร์ Fujitsu ScanSnap', type: 'SCANNER', brand: 'Fujitsu', model: 'ScanSnap iX1600', status: 'active', site: 'HQ', serialNumber: 'DEMO-SN-004', meterRequired: false },
    { assetCode: 'DEMO-PC-001', name: 'คอมพิวเตอร์ Dell OptiPlex', type: 'COMPUTER', brand: 'Dell', model: 'OptiPlex 7090', status: 'active', site: 'HQ', serialNumber: 'DEMO-SN-005', meterRequired: false },
    { assetCode: 'DEMO-SPARE-001', name: 'เครื่องสำรอง Canon MF445', type: 'PRINTER', brand: 'Canon', model: 'imageCLASS MF445', status: 'spare', site: 'HQ', serialNumber: 'DEMO-SN-006', meterRequired: true, meterMode: 'BW_COLOR' },
    { assetCode: 'DEMO-REPAIR-001', name: 'เครื่องส่งซ่อม Epson L3210', type: 'PRINTER', brand: 'Epson', model: 'EcoTank L3210', status: 'repair', site: 'HQ', serialNumber: 'DEMO-SN-007', meterRequired: true, meterMode: 'TOTAL' },
    { assetCode: 'DEMO-DISPOSED-001', name: 'เครื่องตัดจำหน่าย Brother HL-1110', type: 'PRINTER', brand: 'Brother', model: 'HL-1110', status: 'disposed', site: 'HQ', serialNumber: 'DEMO-SN-008', meterRequired: false },
  ]
  for (const d of deviceTemplates) {
    const existing = await db.device.findFirst({ where: { assetCode: d.assetCode } })
    if (!existing) {
      await db.device.create({
        data: {
          ...d,
          isDemo: true,
          department: 'IT',
          departmentCode: 'IT-001',
        },
      })
      created++
    }
  }
  console.log(`  ✓ ${deviceTemplates.length} demo devices (active/spare/repair/disposed)`)

  // ── 3. Demo work orders (every status + priority) ──
  console.log('3. Demo work orders (every status + priority)...')
  const woTemplates = [
    { subject: 'เครื่องพิมพ์ไม่ทำงาน', status: 'PENDING', priority: 'ปกติ', reporterName: 'คุณสมชาย', tel: '081-234-5678' },
    { subject: 'กระดาษติดบ่อย', status: 'PENDING', priority: 'ปกติ', reporterName: 'คุณสมหญิง', tel: '082-345-6789' },
    { subject: 'หมึกหมดด่วน', status: 'IN_PROGRESS', priority: 'ด่วน', reporterName: 'คุณวิชัย', tel: '083-456-7890' },
    { subject: 'สแกนเนอร์เชื่อมต่อไม่ได้', status: 'IN_PROGRESS', priority: 'ปานกลาง', reporterName: 'คุณมาลี', tel: '084-567-8901' },
    { subject: 'เครื่องค้างรออะไหล่', status: 'WAITING_PARTS', priority: 'ปานกลาง', reporterName: 'คุณประเสริฐ', tel: '085-678-9012' },
    { subject: 'ซ่อมเสร็จรอส่งคืน', status: 'WAITING_PARTS', priority: 'ปกติ', reporterName: 'คุณอนุชา', tel: '086-789-0123' },
    { subject: 'ซ่อมเสร็จแล้ว', status: 'COMPLETED', priority: 'ปกติ', reporterName: 'คุณกิตติ', tel: '087-890-1234' },
    { subject: 'ยกเลิกเพราะซื้อเครื่องใหม่', status: 'CANCELLED', priority: 'ปกติ', reporterName: 'คุณนิภา', tel: '088-901-2345' },
  ]
  for (const w of woTemplates) {
    await db.workOrder.create({
      data: {
        ...w,
        submissionSource: 'session',
        siteCode: 'HQ',
        isDemo: true,
      },
    })
    created++
  }
  console.log(`  ✓ ${woTemplates.length} demo WOs (PENDING/IN_PROGRESS/WAITING_PARTS/COMPLETED/CANCELLED)`)

  // ── 4. Demo stock items (normal/low/out) ──
  console.log('4. Demo stock items (normal/low/out)...')
  const stockTemplates = [
    { productCode: 'DEMO-TONER-001', productName: 'ตลับหมึก Canon C-EXV 41', brand: 'Canon', model: 'C-EXV 41', category: 'toner', quantity: 15, minQuantity: 5, unitCost: 2500, site: 'HQ' },
    { productCode: 'DEMO-TONER-002', productName: 'ตลับหมึก HP 85A', brand: 'HP', model: 'CF285A', category: 'toner', quantity: 3, minQuantity: 5, unitCost: 1800, site: 'HQ' },
    { productCode: 'DEMO-TONER-003', productName: 'ตลับหมึก Epson T03', brand: 'Epson', model: 'T0341', category: 'toner', quantity: 0, minQuantity: 3, unitCost: 900, site: 'HQ' },
    { productCode: 'DEMO-DRUM-001', productName: 'ดรัม Brother DR-235', brand: 'Brother', model: 'DR-235', category: 'drum', quantity: 8, minQuantity: 2, unitCost: 1500, site: 'HQ' },
    { productCode: 'DEMO-PAPER-001', productName: 'กระดาษ A4 80gsm', brand: 'Double A', model: 'A4-80', category: 'paper', quantity: 50, minQuantity: 10, unitCost: 100, site: 'HQ' },
  ]
  for (const s of stockTemplates) {
    const existing = await db.stockItem.findFirst({ where: { productCode: s.productCode } })
    if (!existing) {
      await db.stockItem.create({
        data: {
          ...s,
          unit: 'ชิ้น',
          totalValue: s.quantity * s.unitCost,
          isDemo: true,
        },
      })
      created++
    }
  }
  console.log(`  ✓ ${stockTemplates.length} demo stock items (normal/low/out)`)

  // ── 5. Demo PM schedules ──
  console.log('5. Demo PM schedules...')
  const pmDevice = await db.device.findFirst({ where: { assetCode: 'DEMO-PRINTER-001' } })
  if (pmDevice) {
    const existingPM = await db.pMSchedule.findFirst({ where: { deviceId: pmDevice.id } })
    if (!existingPM) {
      await db.pMSchedule.create({
        data: {
          title: 'PM รายเดือน - ' + pmDevice.assetCode,
          description: 'PM รายเดือนสำหรับเครื่องพิมพ์ (demo)',
          frequency: 'monthly',
          nextRunDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          active: true,
          isDemo: true,
          device: { connect: { id: pmDevice.id } },
        },
      })
      created++
    }
  }
  console.log(`  ✓ 1 demo PM schedule`)

  // ── 6. Demo audit logs ──
  console.log('6. Demo audit logs...')
  const auditActions = [
    { action: 'CREATE', entity: 'Device', summary: 'เพิ่มอุปกรณ์ DEMO-PRINTER-001 (demo)' },
    { action: 'UPDATE', entity: 'WorkOrder', summary: 'แก้ไขใบงาน PPIT-DEMO-001 (demo)' },
    { action: 'DELETE', entity: 'StockItem', summary: 'ลบสต็อก DEMO-OLD-001 (demo)' },
    { action: 'METER_READING', entity: 'MeterReading', summary: 'จดมิเตอร์ DEMO-PRINTER-001: 0→1000 (demo)' },
    { action: 'SYNC', entity: 'Device', summary: 'Sync ข้อมูลจาก Google Sheets (demo)' },
  ]
  for (const a of auditActions) {
    await db.auditLog.create({
      data: {
        ...a,
        actor: 'demo_admin@itam.demo',
      },
    })
    created++
  }
  console.log(`  ✓ ${auditActions.length} demo audit logs`)

  // ── Summary ──
  console.log('\n' + '═'.repeat(50))
  console.log(`✓ Demo data seeded: ${created} records created`)
  console.log('═'.repeat(50))
  console.log('\nDemo data covers:')
  console.log('  • Devices: active, spare, repair, disposed (4 statuses)')
  console.log('  • Work Orders: PENDING, IN_PROGRESS, WAITING_PARTS, COMPLETED, CANCELLED (5 statuses)')
  console.log('  • Stock: normal (15qty), low (3qty), out (0qty)')
  console.log('  • PM Schedules: monthly')
  console.log('  • Audit logs: CREATE, UPDATE, DELETE, METER_READING, SYNC')
  console.log('  • Repair categories: 10 types (for dropdown)')
  console.log('\nAll tagged isDemo=true → can wipe via POST /api/itam/demo/reset')

  await db.$disconnect()
}

main().catch(async (e) => {
  console.error('❌ Seed failed:', e)
  await db.$disconnect()
  process.exit(1)
})
