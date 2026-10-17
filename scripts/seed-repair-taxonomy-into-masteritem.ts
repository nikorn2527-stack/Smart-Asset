/**
 * scripts/seed-repair-taxonomy-into-masteritem.ts
 *
 * Seed Repair taxonomy into MasterItem (3 categories):
 *   - RepairGroup (14 rows) — IT groups
 *   - RepairProblem (24 rows) — RP-* codes
 *   - RepairResolution (18 rows) — RX-* codes
 */

import { PrismaClient } from '@prisma/client'

function buildPoolUrl(raw: string): string {
  let u = raw
  if (/\.pooler\.supabase\.com:5432(\/|\?|$)/.test(u)) {
    u = u.replace('.pooler.supabase.com:5432', '.pooler.supabase.com:6543')
  }
  const extras: string[] = []
  if (!u.includes('connection_limit=')) extras.push('connection_limit=3')
  if (!u.includes('pool_timeout=')) extras.push('pool_timeout=30')
  if (/\.pooler\.supabase\.com/.test(u) && !u.includes('pgbouncer=')) extras.push('pgbouncer=true')
  if (!extras.length) return u
  return u + (u.includes('?') ? '&' : '?') + extras.join('&')
}

const rawUrl = process.env.ITAM_DB_URL ?? ''
if (!rawUrl.startsWith('postgres')) {
  console.error('❌ Missing ITAM_DB_URL')
  process.exit(1)
}
const poolUrl = buildPoolUrl(rawUrl)
const db = new PrismaClient({ datasources: { db: { url: poolUrl } }, log: ['error'] })

// Repair Groups (14)
const GROUPS = [
  { code: 'IT-PRN', label: 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก', status: 'active' },
  { code: 'IT-COM', label: 'คอมพิวเตอร์และโน้ตบุ๊ก', status: 'active' },
  { code: 'IT-NET', label: 'Network และการเชื่อมต่อ', status: 'active' },
  { code: 'IT-SFT', label: 'Software และระบบปฏิบัติการ', status: 'active' },
  { code: 'IT-ACC', label: 'บัญชีผู้ใช้และสิทธิ์การใช้งาน', status: 'active' },
  { code: 'IT-SCN', label: 'Scanner และอุปกรณ์สแกน', status: 'active' },
  { code: 'IT-PER', label: 'อุปกรณ์ต่อพ่วง', status: 'future' },
  { code: 'IT-INS', label: 'ติดตั้ง ย้าย และตั้งค่าอุปกรณ์', status: 'active' },
  { code: 'IT-SRV', label: 'Server, Storage และ Backup', status: 'future' },
  { code: 'IT-EML', label: 'Email และการสื่อสาร', status: 'future' },
  { code: 'IT-SEC', label: 'ระบบความปลอดภัยและอุปกรณ์รักษาความปลอดภัย', status: 'future' },
  { code: 'IT-TEL', label: 'โทรศัพท์และระบบสื่อสารภายใน', status: 'future' },
  { code: 'IT-MNT', label: 'บำรุงรักษาและตรวจสอบเชิงป้องกัน', status: 'active' },
  { code: 'IT-OTH', label: 'งาน IT อื่น ๆ', status: 'active' },
]

// Problems (24) — code, label, groupCode, groupLabel
const PROBLEMS = [
  ['RP-PRN-001', 'วัสดุสิ้นเปลือง หมึก ดรัม หรือกล่องบำรุงรักษา', 'IT-PRN', 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก'],
  ['RP-PRN-002', 'พิมพ์ไม่ออก Offline หรือเครื่องไม่ทำงาน', 'IT-PRN', 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก'],
  ['RP-PRN-003', 'งานพิมพ์ไม่ชัด สีเพี้ยน เป็นเส้น หรือเลอะ', 'IT-PRN', 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก'],
  ['RP-PRN-004', 'กระดาษติดหรือเครื่องไม่ดึงกระดาษ', 'IT-PRN', 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก'],
  ['RP-PRN-005', 'Error Code หรือไฟแจ้งเตือน', 'IT-PRN', 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก'],
  ['RP-PRN-006', 'Driver, Spooler, Share Printer หรือ IP ของ Printer', 'IT-PRN', 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก'],
  ['RP-PRN-007', 'ติดตั้ง ย้าย หรือเปลี่ยนจุดใช้งาน Printer', 'IT-PRN', 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก'],
  ['RP-COM-001', 'เปิดไม่ติด ไฟไม่เข้า หรือจอมืด', 'IT-COM', 'คอมพิวเตอร์และโน้ตบุ๊ก'],
  ['RP-COM-002', 'เครื่องช้า ค้าง หรือจอฟ้า', 'IT-COM', 'คอมพิวเตอร์และโน้ตบุ๊ก'],
  ['RP-COM-003', 'Hardware ของคอมพิวเตอร์หรือโน้ตบุ๊กผิดปกติ', 'IT-COM', 'คอมพิวเตอร์และโน้ตบุ๊ก'],
  ['RP-COM-004', 'Windows, Driver หรือโปรแกรมในเครื่องมีปัญหา', 'IT-COM', 'คอมพิวเตอร์และโน้ตบุ๊ก'],
  ['RP-NET-001', 'เชื่อมต่อ Wi-Fi หรือ LAN ไม่ได้', 'IT-NET', 'Network และการเชื่อมต่อ'],
  ['RP-NET-002', 'Network Offline หรือเชื่อมต่อระบบ/อุปกรณ์ไม่ได้', 'IT-NET', 'Network และการเชื่อมต่อ'],
  ['RP-NET-003', 'สาย LAN, USB, Port หรืออุปกรณ์เครือข่ายมีปัญหา', 'IT-NET', 'Network และการเชื่อมต่อ'],
  ['RP-NET-004', 'IP, Share หรือการตั้งค่า Network มีปัญหา', 'IT-NET', 'Network และการเชื่อมต่อ'],
  ['RP-SFT-001', 'โปรแกรมหรือระบบมี Error', 'IT-SFT', 'Software และระบบปฏิบัติการ'],
  ['RP-SFT-002', 'Driver หรือ Windows Update มีปัญหา', 'IT-SFT', 'Software และระบบปฏิบัติการ'],
  ['RP-SFT-003', 'ติดตั้งหรือปรับตั้งค่าโปรแกรม', 'IT-SFT', 'Software และระบบปฏิบัติการ'],
  ['RP-ACC-001', 'เข้าใช้งานไม่ได้หรือบัญชีผู้ใช้มีปัญหา', 'IT-ACC', 'บัญชีผู้ใช้และสิทธิ์การใช้งาน'],
  ['RP-ACC-002', 'รหัสผ่านหรือสิทธิ์การใช้งาน', 'IT-ACC', 'บัญชีผู้ใช้และสิทธิ์การใช้งาน'],
  ['RP-SCN-001', 'Scan เข้าคอมพิวเตอร์หรือ Email ไม่ได้', 'IT-SCN', 'Scanner และอุปกรณ์สแกน'],
  ['RP-INS-001', 'ติดตั้ง ย้าย หรือเปลี่ยนจุดใช้งานอุปกรณ์', 'IT-INS', 'ติดตั้ง ย้าย และตั้งค่าอุปกรณ์'],
  ['RP-MNT-001', 'งานบำรุงรักษาและตรวจสอบตามรอบ', 'IT-MNT', 'บำรุงรักษาและตรวจสอบเชิงป้องกัน'],
  ['RP-OTH-999', 'อื่น ๆ / รอเจ้าหน้าที่จำแนก', 'IT-OTH', 'งาน IT อื่น ๆ'],
] as const

// Resolutions (18)
const RESOLUTIONS = [
  ['RX-PRN-001', 'เติมหรือเปลี่ยนหมึก ดรัม หรือกล่องบำรุงรักษา', 'IT-PRN', 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก'],
  ['RX-PRN-002', 'ตรวจชุดพิมพ์ หัวพิมพ์ คุณภาพงานพิมพ์ หรือ Error Code', 'IT-PRN', 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก'],
  ['RX-PRN-003', 'เคลียร์กระดาษติดและตรวจชุดป้อนกระดาษ', 'IT-PRN', 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก'],
  ['RX-PRN-004', 'ติดตั้งหรือปรับ Driver, Spooler, Share และ IP', 'IT-PRN', 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก'],
  ['RX-COM-001', 'ตรวจไฟเลี้ยง สายไฟ อุปกรณ์ และ Hardware', 'IT-COM', 'คอมพิวเตอร์และโน้ตบุ๊ก'],
  ['RX-COM-002', 'ตรวจระบบ Windows, Driver หรือโปรแกรม', 'IT-COM', 'คอมพิวเตอร์และโน้ตบุ๊ก'],
  ['RX-COM-003', 'เปลี่ยนหรือซ่อมอุปกรณ์คอมพิวเตอร์/โน้ตบุ๊ก', 'IT-COM', 'คอมพิวเตอร์และโน้ตบุ๊ก'],
  ['RX-NET-001', 'ตรวจสาย Port Switch Wi-Fi และสัญญาณเครือข่าย', 'IT-NET', 'Network และการเชื่อมต่อ'],
  ['RX-NET-002', 'ตรวจหรือปรับ IP, DNS, Share และ Network Configuration', 'IT-NET', 'Network และการเชื่อมต่อ'],
  ['RX-NET-003', 'เปลี่ยนสายหรืออุปกรณ์เครือข่ายที่ชำรุด', 'IT-NET', 'Network และการเชื่อมต่อ'],
  ['RX-SFT-001', 'ติดตั้ง อัปเดต หรือตั้งค่าโปรแกรมและ Driver', 'IT-SFT', 'Software และระบบปฏิบัติการ'],
  ['RX-SFT-002', 'แก้ไข Configuration หรือประสานเจ้าของระบบ', 'IT-SFT', 'Software และระบบปฏิบัติการ'],
  ['RX-ACC-001', 'Reset Password หรือแก้ไขบัญชีผู้ใช้', 'IT-ACC', 'บัญชีผู้ใช้และสิทธิ์การใช้งาน'],
  ['RX-ACC-002', 'ปรับสิทธิ์หรือกำหนดสิทธิ์การใช้งาน', 'IT-ACC', 'บัญชีผู้ใช้และสิทธิ์การใช้งาน'],
  ['RX-SCN-001', 'ตั้งค่า Scan, Folder, Email หรือ Driver', 'IT-SCN', 'Scanner และอุปกรณ์สแกน'],
  ['RX-INS-001', 'ติดตั้ง ย้าย และตั้งค่าจุดใช้งานใหม่', 'IT-INS', 'ติดตั้ง ย้าย และตั้งค่าอุปกรณ์'],
  ['RX-MNT-001', 'ทำความสะอาด ตรวจเช็ก และบันทึกผลบำรุงรักษา', 'IT-MNT', 'บำรุงรักษาและตรวจสอบเชิงป้องกัน'],
  ['RX-OTH-999', 'อื่น ๆ / รอจำแนก', 'IT-OTH', 'งาน IT อื่น ๆ'],
] as const

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Seed Repair Taxonomy into MasterItem')
  console.log('═══════════════════════════════════════════════════════════════')

  // RepairGroup — 14 rows
  console.log('\n📝 RepairGroup (14)...')
  for (const g of GROUPS) {
    await db.masterItem.create({
      data: {
        categoryKey: 'RepairGroup',
        value: g.label,
        displayLabel: g.label,
        departmentCode: g.code,  // store IT-PRN etc. in departmentCode field (reuse)
        groupName: g.status,     // store 'active'/'future' in groupName field (reuse)
        active: g.status === 'active',
      } as any,
    })
  }
  console.log('   ✅ 14 RepairGroup rows')

  // RepairProblem — 24 rows
  console.log('\n📝 RepairProblem (24)...')
  for (const p of PROBLEMS) {
    await db.masterItem.create({
      data: {
        categoryKey: 'RepairProblem',
        value: p[1],
        displayLabel: p[1],
        departmentCode: p[0],   // RP-PRN-001
        parentRef: p[2],       // IT-PRN
        groupName: p[3],       // group label
        active: true,
      } as any,
    })
  }
  console.log('   ✅ 24 RepairProblem rows')

  // RepairResolution — 18 rows
  console.log('\n📝 RepairResolution (18)...')
  for (const r of RESOLUTIONS) {
    await db.masterItem.create({
      data: {
        categoryKey: 'RepairResolution',
        value: r[1],
        displayLabel: r[1],
        departmentCode: r[0],   // RX-PRN-001
        parentRef: r[2],       // IT-PRN
        groupName: r[3],       // group label
        active: true,
      } as any,
    })
  }
  console.log('   ✅ 18 RepairResolution rows')

  // Verify
  console.log('\n✅ Verify...')
  const total = await db.masterItem.count()
  console.log(`   Total MasterItem: ${total}`)

  const byCat = await db.masterItem.findMany({ select: { categoryKey: true } })
  const catCount: Record<string, number> = {}
  for (const c of byCat) {
    catCount[c.categoryKey] = (catCount[c.categoryKey] || 0) + 1
  }
  for (const [cat, n] of Object.entries(catCount).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${cat}: ${n}`)
  }

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  ✅ COMPLETE')
  console.log('═══════════════════════════════════════════════════════════════')
}

main().catch((e) => { console.error('❌', e); process.exit(1) }).finally(() => db.$disconnect())
