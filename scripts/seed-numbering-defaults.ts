/**
 * seed-numbering-defaults.ts — หมวดหมู่ + รหัสหมวดเริ่มต้นสำหรับ Numbering Engine
 *
 * โครงสร้างตัวอย่าง (ผู้ใช้ปรับแก้ได้ใน ตั้งค่า → รูปแบบเลขทะเบียน):
 *   001 อุปกรณ์สำนักงาน          (หมวดใหญ่)
 *     201 ปรินเตอร์ AIO          (matchKey: PRINTER)
 *     202 เครื่องถ่ายเอกสาร      (matchKey: COPIER)
 *     203 สแกนเนอร์              (matchKey: SCANNER)
 *   002 อุปกรณ์ไอที               (หมวดใหญ่)
 *     101 คอมพิวเตอร์            (matchKey: COMPUTER)
 *
 * ผลลัพธ์ เช่น อุปกรณ์ PRINTER ซื้อปี 2569 → 001-201-2569-00001
 *
 * Idempotent — รันซ้ำได้ (ข้ามถ้ามีข้อมูลแล้ว)
 * Usage: bun scripts/seed-numbering-defaults.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const DEVICE_CATEGORIES = [
  // หมวดใหญ่
  { code: '001', label: 'อุปกรณ์สำนักงาน', parentCode: null, matchKey: null, sortOrder: 1 },
  { code: '002', label: 'อุปกรณ์ไอที', parentCode: null, matchKey: null, sortOrder: 2 },
  { code: '003', label: 'อุปกรณ์เครือข่าย', parentCode: null, matchKey: null, sortOrder: 3 },
  // หมวดย่อยของ 001
  { code: '201', label: 'ปรินเตอร์ AIO', parentCode: '001', matchKey: 'PRINTER', sortOrder: 11 },
  { code: '202', label: 'เครื่องถ่ายเอกสาร', parentCode: '001', matchKey: 'COPIER', sortOrder: 12 },
  { code: '203', label: 'สแกนเนอร์', parentCode: '001', matchKey: 'SCANNER', sortOrder: 13 },
  // หมวดย่อยของ 002
  { code: '101', label: 'คอมพิวเตอร์', parentCode: '002', matchKey: 'COMPUTER', sortOrder: 21 },
  { code: '102', label: 'โน้ตบุ๊ค', parentCode: '002', matchKey: 'LAPTOP', sortOrder: 22 },
  { code: '103', label: 'จอมอนิเตอร์', parentCode: '002', matchKey: 'MONITOR', sortOrder: 23 },
  // หมวดย่อยของ 003
  { code: '301', label: 'สวิตช์/เราเตอร์', parentCode: '003', matchKey: 'NETWORK', sortOrder: 31 },
]

async function main() {
  console.log('═══ Seed Numbering Defaults ═══')

  // 1) CategoryCode (device)
  const catCount = await db.categoryCode.count({ where: { docType: 'device' } })
  if (catCount > 0) {
    console.log(`✓ หมวดหมู่อุปกรณ์มีอยู่แล้ว ${catCount} แถว — ข้าม`)
  } else {
    for (const c of DEVICE_CATEGORIES) {
      await db.categoryCode.create({
        data: { docType: 'device', ...c },
      })
    }
    console.log(`✓ สร้างหมวดหมู่อุปกรณ์ ${DEVICE_CATEGORIES.length} แถว (หมวดใหญ่ 3 + หมวดย่อย 7)`)
  }

  // 2) Default schemes สร้างผ่าน ensureDefaultSchemes เมื่อเปิดหน้า settings
  //    แต่ seed ไว้เลยเพื่อให้ engine พร้อมใช้ทันที
  const schemeCount = await db.numberingScheme.count({ where: { docType: 'device' } })
  if (schemeCount === 0) {
    await db.numberingScheme.createMany({
      data: [
        {
          docType: 'device',
          name: 'หมวดหมู่–หมวดย่อย–ปี พ.ศ.–ลำดับ',
          pattern: '{cat1:3}-{cat2:3}-{yearBE:4}-{seq:5}',
          description: '001-201-2569-00001 (หมวดใหญ่-หมวดย่อย-ปีพ.ศ.-เลขลำดับ แยกนับต่อหมวดและปี)',
          resetPolicy: 'yearly',
          isActive: true,
        },
        {
          docType: 'device',
          name: 'แบบเรียบง่าย (คำนำหน้า-ลำดับ)',
          pattern: '{prefix}-{seq:5}',
          prefix: 'ASSET',
          description: 'ASSET-00001 (เลขลำดับเดี่ยว นับต่อเนื่อง)',
          resetPolicy: 'never',
          isActive: false,
        },
        {
          docType: 'device',
          name: 'สาขา–ปี พ.ศ.–ลำดับ',
          pattern: '{site}-{yearBE:4}-{seq:5}',
          description: 'UDH-2569-00001 (แยกตามสาขา รีเซ็ตรายปี)',
          resetPolicy: 'yearly',
          isActive: false,
        },
      ],
    })
    console.log('✓ สร้างรูปแบบเลขทะเบียนอุปกรณ์ 3 แบบ (เปิดใช้ "หมวดหมู่–ปี พ.ศ.–ลำดับ")')
  } else {
    console.log(`✓ รูปแบบเลขอุปกรณ์มีอยู่แล้ว ${schemeCount} แบบ — ข้าม`)
  }

  const woCount = await db.numberingScheme.count({ where: { docType: 'work-order' } })
  if (woCount === 0) {
    await db.numberingScheme.createMany({
      data: [
        {
          docType: 'work-order',
          name: 'คำนำหน้า–ปี พ.ศ.–ลำดับ',
          pattern: '{prefix}-{yearBE:2}-{seq:4}',
          prefix: 'WO',
          description: 'WO-69-0001 (รีเซ็ตลำดับรายปี) — ยังไม่เปิดใช้งาน ระบบยังใช้เลขใบงานเดิม',
          resetPolicy: 'yearly',
          isActive: false,
        },
      ],
    })
    console.log('✓ สร้างรูปแบบเลขใบงาน 1 แบบ (ไม่เปิดใช้งานอัตโนมัติ)')
  }

  console.log('✓ Done')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
