/**
 * seed-master-catalog-v2.ts — Seed MasterItem ให้ครบตาม catalog ใหม่
 *
 * เพิ่ม categories ที่ขาดตาม section 7:
 *   - Priority (Low, Normal, High, Urgent)
 *   - Unit (ชิ้น, กล่อง, แพ็ค, ...)
 *   - Condition (New, Used, Refurbished)
 *   - OwnershipType (Buy, Lease, Loan)
 *   - WarrantyType (Standard, Extended, None)
 *   - ContractType (Purchase, Service, Rental)
 *   - WorkOrderStatus (Pending, Assigned, In Progress, Completed, Cancelled)
 *   - ServiceChannel (QR, LINE, Phone, Walk-in, Email)
 *   - StockCategory (Toner, Drum, Spare Part, Accessory, Consumable)
 *   - StockUnit (ชิ้น, กล่อง, แพ็ค, ชุด)
 *   - StockPurpose (Repair, Spare, Donation, Disposal)
 *   - StockStatus (In Stock, Low Stock, Out of Stock, Reserved)
 *   - TransactionType (IN, OUT, ADJUST, TRANSFER)
 *
 * Idempotent: ใช้ findFirst + create (skip ถ้ามีอยู่แล้ว)
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const PILOT_ORG_ID = 'cmtxppz3i0000q2gvoue8u7bj'

interface SeedItem {
  category: string
  code: string
  label: string
  displayLabel?: string
  parentRef?: string | null
  sortOrder?: number
}

const SEED_DATA: SeedItem[] = [
  // ── Core: Priority ──
  { category: 'Priority', code: 'PRIORITY-LOW', label: 'ต่ำ', displayLabel: 'Low', sortOrder: 1 },
  { category: 'Priority', code: 'PRIORITY-NORMAL', label: 'ปกติ', displayLabel: 'Normal', sortOrder: 2 },
  { category: 'Priority', code: 'PRIORITY-HIGH', label: 'สูง', displayLabel: 'High', sortOrder: 3 },
  { category: 'Priority', code: 'PRIORITY-URGENT', label: 'ด่วน', displayLabel: 'Urgent', sortOrder: 4 },

  // ── Core: Unit ──
  { category: 'Unit', code: 'UNIT-PCS', label: 'ชิ้น', displayLabel: 'Piece', sortOrder: 1 },
  { category: 'Unit', code: 'UNIT-BOX', label: 'กล่อง', displayLabel: 'Box', sortOrder: 2 },
  { category: 'Unit', code: 'UNIT-PACK', label: 'แพ็ค', displayLabel: 'Pack', sortOrder: 3 },
  { category: 'Unit', code: 'UNIT-SET', label: 'ชุด', displayLabel: 'Set', sortOrder: 4 },
  { category: 'Unit', code: 'UNIT-ROLL', label: 'ม้วน', displayLabel: 'Roll', sortOrder: 5 },
  { category: 'Unit', code: 'UNIT-BOTTLE', label: 'ขวด', displayLabel: 'Bottle', sortOrder: 6 },

  // ── Core: CostCenter ──
  { category: 'CostCenter', code: 'CC-001', label: 'Cost Center 001', sortOrder: 1 },

  // ── Device: Condition ──
  { category: 'Condition', code: 'COND-NEW', label: 'ใหม่', displayLabel: 'New', sortOrder: 1 },
  { category: 'Condition', code: 'COND-USED', label: 'มือสอง', displayLabel: 'Used', sortOrder: 2 },
  { category: 'Condition', code: 'COND-REFURB', label: 'ปรับปรุง', displayLabel: 'Refurbished', sortOrder: 3 },

  // ── Device: OwnershipType ──
  { category: 'OwnershipType', code: 'OWN-BUY', label: 'ซื้อ', displayLabel: 'Buy', sortOrder: 1 },
  { category: 'OwnershipType', code: 'OWN-LEASE', label: 'เช่า', displayLabel: 'Lease', sortOrder: 2 },
  { category: 'OwnershipType', code: 'OWN-LOAN', label: 'ยืม', displayLabel: 'Loan', sortOrder: 3 },
  { category: 'OwnershipType', code: 'OWN-DONATE', label: 'รับบริจาค', displayLabel: 'Donated', sortOrder: 4 },

  // ── Device: WarrantyType ──
  { category: 'WarrantyType', code: 'WTY-STANDARD', label: 'รับประกันมาตรฐาน', displayLabel: 'Standard', sortOrder: 1 },
  { category: 'WarrantyType', code: 'WTY-EXTENDED', label: 'รับประกันขยาย', displayLabel: 'Extended', sortOrder: 2 },
  { category: 'WarrantyType', code: 'WTY-NONE', label: 'ไม่มีรับประกัน', displayLabel: 'None', sortOrder: 3 },

  // ── Device: ContractType ──
  { category: 'ContractType', code: 'CT-PURCHASE', label: 'สัญญาซื้อ', displayLabel: 'Purchase', sortOrder: 1 },
  { category: 'ContractType', code: 'CT-SERVICE', label: 'สัญญาบริการ', displayLabel: 'Service', sortOrder: 2 },
  { category: 'ContractType', code: 'CT-RENTAL', label: 'สัญญาเช่า', displayLabel: 'Rental', sortOrder: 3 },

  // ── Repair: WorkOrderStatus ──
  { category: 'WorkOrderStatus', code: 'WOS-PENDING', label: 'รอรับเรื่อง', displayLabel: 'Pending', sortOrder: 1 },
  { category: 'WorkOrderStatus', code: 'WOS-ASSIGNED', label: 'มอบหมายแล้ว', displayLabel: 'Assigned', sortOrder: 2 },
  { category: 'WorkOrderStatus', code: 'WOS-INPROGRESS', label: 'กำลังดำเนินการ', displayLabel: 'In Progress', sortOrder: 3 },
  { category: 'WorkOrderStatus', code: 'WOS-COMPLETED', label: 'เสร็จสิ้น', displayLabel: 'Completed', sortOrder: 4 },
  { category: 'WorkOrderStatus', code: 'WOS-CANCELLED', label: 'ยกเลิก', displayLabel: 'Cancelled', sortOrder: 5 },
  { category: 'WorkOrderStatus', code: 'WOS-ONHOLD', label: 'รอชิ้นงาน/อะไหล่', displayLabel: 'On Hold', sortOrder: 6 },

  // ── Repair: ServiceChannel ──
  { category: 'ServiceChannel', code: 'CH-QR', label: 'สแกน QR', displayLabel: 'QR Scan', sortOrder: 1 },
  { category: 'ServiceChannel', code: 'CH-LINE', label: 'LINE OA', displayLabel: 'LINE', sortOrder: 2 },
  { category: 'ServiceChannel', code: 'CH-PHONE', label: 'โทรศัพท์', displayLabel: 'Phone', sortOrder: 3 },
  { category: 'ServiceChannel', code: 'CH-WALKIN', label: 'มาแจ้งด้วยตัวเอง', displayLabel: 'Walk-in', sortOrder: 4 },
  { category: 'ServiceChannel', code: 'CH-EMAIL', label: 'อีเมล', displayLabel: 'Email', sortOrder: 5 },

  // ── Repair: RepairPriority (แยกจาก Core Priority — อาจมีค่าต่างกันเช่น SLA) ──
  { category: 'RepairPriority', code: 'RP-LOW', label: 'ต่ำ (SLA 7 วัน)', displayLabel: 'Low', sortOrder: 1 },
  { category: 'RepairPriority', code: 'RP-NORMAL', label: 'ปกติ (SLA 3 วัน)', displayLabel: 'Normal', sortOrder: 2 },
  { category: 'RepairPriority', code: 'RP-HIGH', label: 'สูง (SLA 1 วัน)', displayLabel: 'High', sortOrder: 3 },
  { category: 'RepairPriority', code: 'RP-URGENT', label: 'ด่วน (SLA 4 ชม.)', displayLabel: 'Urgent', sortOrder: 4 },

  // ── Stock: StockCategory ──
  { category: 'StockCategory', code: 'SC-TONER', label: 'หมึกเครื่องพิมพ์', displayLabel: 'Toner', sortOrder: 1 },
  { category: 'StockCategory', code: 'SC-DRUM', label: 'ดรัม', displayLabel: 'Drum', sortOrder: 2 },
  { category: 'StockCategory', code: 'SC-SPARE', label: 'อะไหล่', displayLabel: 'Spare Part', sortOrder: 3 },
  { category: 'StockCategory', code: 'SC-ACCESSORY', label: 'อุปกรณ์เสริม', displayLabel: 'Accessory', sortOrder: 4 },
  { category: 'StockCategory', code: 'SC-CONSUMABLE', label: 'วัสดุสิ้นเปลือง', displayLabel: 'Consumable', sortOrder: 5 },
  { category: 'StockCategory', code: 'SC-PAPER', label: 'กระดาษ', displayLabel: 'Paper', sortOrder: 6 },

  // ── Stock: StockUnit (อาจซ้ำกับ Core Unit แต่เก็บแยกเพื่อความชัดเจน) ──
  { category: 'StockUnit', code: 'SU-PCS', label: 'ชิ้น', displayLabel: 'Piece', sortOrder: 1 },
  { category: 'StockUnit', code: 'SU-BOX', label: 'กล่อง', displayLabel: 'Box', sortOrder: 2 },
  { category: 'StockUnit', code: 'SU-PACK', label: 'แพ็ค', displayLabel: 'Pack', sortOrder: 3 },
  { category: 'StockUnit', code: 'SU-SET', label: 'ชุด', displayLabel: 'Set', sortOrder: 4 },
  { category: 'StockUnit', code: 'SU-ROLL', label: 'ม้วน', displayLabel: 'Roll', sortOrder: 5 },
  { category: 'StockUnit', code: 'SU-BOTTLE', label: 'ขวด', displayLabel: 'Bottle', sortOrder: 6 },

  // ── Stock: StockPurpose ──
  { category: 'StockPurpose', code: 'SP-REPAIR', label: 'ใช้ซ่อม', displayLabel: 'Repair', sortOrder: 1 },
  { category: 'StockPurpose', code: 'SP-SPARE', label: 'สำรอง', displayLabel: 'Spare', sortOrder: 2 },
  { category: 'StockPurpose', code: 'SP-DONATE', label: 'บริจาค', displayLabel: 'Donation', sortOrder: 3 },
  { category: 'StockPurpose', code: 'SP-DISPOSAL', label: 'รอตัดของ', displayLabel: 'Disposal', sortOrder: 4 },

  // ── Stock: StockStatus ──
  { category: 'StockStatus', code: 'SS-INSTOCK', label: 'ในสต็อก', displayLabel: 'In Stock', sortOrder: 1 },
  { category: 'StockStatus', code: 'SS-LOW', label: 'ใกล้หมด', displayLabel: 'Low Stock', sortOrder: 2 },
  { category: 'StockStatus', code: 'SS-OUT', label: 'หมดสต็อก', displayLabel: 'Out of Stock', sortOrder: 3 },
  { category: 'StockStatus', code: 'SS-RESERVED', label: 'จองแล้ว', displayLabel: 'Reserved', sortOrder: 4 },

  // ── Stock: TransactionType ──
  { category: 'TransactionType', code: 'TT-IN', label: 'รับเข้า', displayLabel: 'IN', sortOrder: 1 },
  { category: 'TransactionType', code: 'TT-OUT', label: 'เบิกออก', displayLabel: 'OUT', sortOrder: 2 },
  { category: 'TransactionType', code: 'TT-ADJUST', label: 'ปรับปรุง', displayLabel: 'ADJUST', sortOrder: 3 },
  { category: 'TransactionType', code: 'TT-TRANSFER', label: 'โอนย้าย', displayLabel: 'TRANSFER', sortOrder: 4 },
  { category: 'TransactionType', code: 'TT-RETURN', label: 'คืน', displayLabel: 'RETURN', sortOrder: 5 },
]

async function main() {
  console.log('══════════════════════════════════════════')
  console.log('  Seed Master Catalog v2 (ตาม section 7)')
  console.log('══════════════════════════════════════════')
  console.log(`  Total seed items: ${SEED_DATA.length}`)
  console.log('')

  let created = 0, skipped = 0, errors = 0
  const ts = Date.now()

  for (const item of SEED_DATA) {
    try {
      const existing = await db.masterItem.findFirst({
        where: { category: item.category, code: item.code },
      })
      if (existing) {
        skipped++
        continue
      }

      await db.masterItem.create({
        data: {
          id: `seed-${item.category}-${item.code}`,
          category: item.category,
          code: item.code,
          label: item.label,
          displayLabel: item.displayLabel ?? item.label,
          parentRef: item.parentRef ?? null,
          organizationId: PILOT_ORG_ID, // org-specific (can be promoted to global later)
          active: true,
          isDemo: false,
          createdAt: new Date(ts),
          updatedAt: new Date(ts),
        },
      })
      created++
    } catch (e: any) {
      errors++
      if (errors <= 3) console.error('  ✗', item.category, item.code, ':', e.message.slice(0, 80))
    }
  }

  console.log(`\n✓ Created: ${created} | Skipped (existing): ${skipped} | Errors: ${errors}`)

  // Verify — group by category
  console.log('\n═══ Master Catalog Summary ═══')
  const all = await db.masterItem.groupBy({
    by: ['category'],
    _count: { _all: true },
    orderBy: { category: 'asc' },
  })
  all.forEach(c => console.log(`  ${c.category.padEnd(20)}: ${c._count._all}`))
  console.log(`  ${'─'.repeat(30)}`)
  const total = await db.masterItem.count()
  console.log(`  ${'TOTAL'.padEnd(20)}: ${total}`)
}

main()
  .catch(e => { console.error('FATAL:', e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
