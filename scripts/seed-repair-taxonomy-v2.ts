/**
 * Seed Repair taxonomy into MasterItem — UPDATED for current schema.
 *
 * Schema fields (current):
 *   id, category, code, label, brand, model, deviceType,
 *   parentRef, displayLabel, siteCode, active, isDemo
 *
 * Repair taxonomy (3 categories, 56 rows total):
 *   - RepairGroup      (14 rows) — IT-PRN, IT-COM, IT-NET, ...
 *   - RepairProblem    (24 rows) — RP-PRN-001, ...
 *   - RepairResolution (18 rows) — RX-PRN-001, ...
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

const rawUrl = process.env.ITAM_DB_URL ?? process.env.DATABASE_URL ?? ''
if (!rawUrl.startsWith('postgres')) {
  console.error('❌ Need ITAM_DB_URL or DATABASE_URL pointing to PostgreSQL')
  process.exit(1)
}
const poolUrl = buildPoolUrl(rawUrl)
const db = new PrismaClient({ datasources: { db: { url: poolUrl } }, log: ['error'] })

// ── Repair Groups (14) ──────────────────────────────────────────────
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

// ── Problems (24) — [code, label, groupCode, groupLabel] ───────────
const PROBLEMS = [
  ['RP-PRN-001', 'วัสดุสิ้นเปลือง หมึก ดรัม หรือกล่องบำรุงรักษา', 'IT-PRN', 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก'],
  ['RP-PRN-002', 'พิมพ์ไม่ออก Offline หรือเครื่องไม่ทำงาน', 'IT-PRN', 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก'],
  ['RP-PRN-003', 'งานพิมพ์ไม่ชัด สีเพี้ยน เป็นเส้น หรือเลอะ', 'IT-PRN', 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก'],
  ['RP-PRN-004', 'กระดาษติดหรือเครื่องไม่ดึงกระดาษ', 'IT-PRN', 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก'],
  ['RP-PRN-005', 'Error Code หรือไฟแจ้งเตือน', 'IT-PRN', 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก'],
  ['RP-PRN-006', 'Driver, Spooler, Share Printer หรือ IP ของ Printer', 'IT-PRN', 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก'],
  ['RP-PRN-007', 'ติดตั้ง ย้าย หรือเปลี่ยนจุดใช้งาน Printer', 'IT-PRN', 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก'],
  ['RP-COM-001', 'เปิดไม่ติด ไฟไม่เข้า หรือจอมืด', 'IT-COM', 'คอมพิวเตอร์และโน้ตบุ๊ก'],
  ['RP-COM-002', 'Windows ช้า ค้าง หรือ Error บ่อย', 'IT-COM', 'คอมพิวเตอร์และโน้ตบุ๊ก'],
  ['RP-COM-003', 'โปรแกรมเปิดไม่ได้ ใช้งานไม่ได้', 'IT-COM', 'คอมพิวเตอร์และโน้ตบุ๊ก'],
  ['RP-NET-001', 'อินเทอร์เน็ตใช้ไม่ได้ หรือเน็ตช้า', 'IT-NET', 'Network และการเชื่อมต่อ'],
  ['RP-NET-002', 'Wi-Fi ไม่เข้า หรือสัญญาณอ่อน', 'IT-NET', 'Network และการเชื่อมต่อ'],
  ['RP-NET-003', 'Share Drive, Printer หรือ Network Folder ไม่ได้', 'IT-NET', 'Network และการเชื่อมต่อ'],
  ['RP-SFT-001', 'ติดตั้งหรืออัปเดตโปรแกรม', 'IT-SFT', 'Software และระบบปฏิบัติการ'],
  ['RP-SFT-002', 'License หรือ Activation มีปัญหา', 'IT-SFT', 'Software และระบบปฏิบัติการ'],
  ['RP-SFT-003', 'ไวรัส มัลแวร์ หรือปัญหาความปลอดภัย', 'IT-SFT', 'Software และระบบปฏิบัติการ'],
  ['RP-ACC-001', 'ขอรหัสผ่านใหม่ หรือลืมรหัสผ่าน', 'IT-ACC', 'บัญชีผู้ใช้และสิทธิ์การใช้งาน'],
  ['RP-ACC-002', 'ขอสิทธิ์เข้าถึงระบบเพิ่มเติม', 'IT-ACC', 'บัญชีผู้ใช้และสิทธิ์การใช้งาน'],
  ['RP-ACC-003', 'บัญชีผู้ใช้ถูกล็อกหรือระงับ', 'IT-ACC', 'บัญชีผู้ใช้และสิทธิ์การใช้งาน'],
  ['RP-SCN-001', 'สแกนไม่ได้ หรือสแกนไม่ครบ', 'IT-SCN', 'Scanner และอุปกรณ์สแกน'],
  ['RP-SCN-002', 'สแกนแล้วภาพไม่ชัด หรือสีเพี้ยน', 'IT-SCN', 'Scanner และอุปกรณ์สแกน'],
  ['RP-INS-001', 'ติดตั้งอุปกรณ์ใหม่ หรือย้ายจุดวาง', 'IT-INS', 'ติดตั้ง ย้าย และตั้งค่าอุปกรณ์'],
  ['RP-MNT-001', 'บำรุงรักษาตามรอบ (PM) หรือเช็กสภาพ', 'IT-MNT', 'บำรุงรักษาและตรวจสอบเชิงป้องกัน'],
  ['RP-OTH-999', 'อื่น ๆ / รอเจ้าหน้าที่จำแนก', 'IT-OTH', 'งาน IT อื่น ๆ'],
] as const

// ── Resolutions (18) ────────────────────────────────────────────────
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

async function upsertMasterItem(data: {
  category: string
  code: string
  label: string
  parentRef?: string | null
  displayLabel?: string | null
  active: boolean
}) {
  const existing = await db.masterItem.findFirst({
    where: { category: data.category, code: data.code },
  })
  if (existing) {
    return db.masterItem.update({
      where: { id: existing.id },
      data: {
        label: data.label,
        parentRef: data.parentRef ?? null,
        displayLabel: data.displayLabel ?? data.label,
        active: data.active,
        isDemo: false,
      },
    })
  }
  return db.masterItem.create({
    data: {
      id: `repair-${data.category}-${data.code}`,
      category: data.category,
      code: data.code,
      label: data.label,
      parentRef: data.parentRef ?? null,
      displayLabel: data.displayLabel ?? data.label,
      active: data.active,
      isDemo: false,
    },
  })
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Seed Repair Taxonomy into MasterItem (current schema)')
  console.log('═══════════════════════════════════════════════════════════════\n')

  // RepairGroup — 14 rows
  console.log('📝 RepairGroup (14)...')
  for (const g of GROUPS) {
    await upsertMasterItem({
      category: 'RepairGroup',
      code: g.code,
      label: g.label,
      displayLabel: g.label,
      active: g.status === 'active',
    })
  }
  console.log('   ✅ 14 RepairGroup rows')

  // RepairProblem — 24 rows (parentRef = group code)
  console.log('\n📝 RepairProblem (24)...')
  for (const p of PROBLEMS) {
    await upsertMasterItem({
      category: 'RepairProblem',
      code: p[0],
      label: p[1],
      parentRef: p[2], // IT-PRN etc.
      displayLabel: p[1],
      active: true,
    })
  }
  console.log('   ✅ 24 RepairProblem rows')

  // RepairResolution — 18 rows (parentRef = group code)
  console.log('\n📝 RepairResolution (18)...')
  for (const r of RESOLUTIONS) {
    await upsertMasterItem({
      category: 'RepairResolution',
      code: r[0],
      label: r[1],
      parentRef: r[2],
      displayLabel: r[1],
      active: true,
    })
  }
  console.log('   ✅ 18 RepairResolution rows')

  // Verify
  console.log('\n✅ Verify...')
  const total = await db.masterItem.count()
  console.log(`   Total MasterItem: ${total}`)

  const byCat = await db.masterItem.groupBy({
    by: ['category'],
    _count: { _all: true },
    orderBy: { _count: { category: 'desc' } },
  })
  for (const c of byCat) {
    console.log(`     ${c.category}: ${c._count._all}`)
  }
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
