/**
 * scripts/create-repair-taxonomy-table.ts
 *
 * Creates the RepairTaxonomy table on production ITAM-DB + seeds it with:
 *   - 14 IT groups (IT-PRN, IT-COM, IT-NET, IT-SFT, IT-ACC, IT-SCN, IT-PER, IT-INS, IT-SRV, IT-EML, IT-SEC, IT-TEL, IT-MNT, IT-OTH)
 *   - 28 Problem codes (RP-PRN-001 ... RP-OTH-999)
 *   - 17 Resolution codes (RX-PRN-001 ... RX-OTH-999)
 *
 * Source: /home/z/my-project/upload/Repair IT Taxonomy — Expanded Preview.md
 */

import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'

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
console.log(`🔌 Connecting to: ${poolUrl.replace(/:[^:@]+@/, ':****@')}`)

const db = new PrismaClient({
  datasources: { db: { url: poolUrl } },
  log: ['error', 'warn'],
})

// ─────────────────────────────────────────────────────────────
// IT groups (14)
// ─────────────────────────────────────────────────────────────
const IT_GROUPS = [
  { code: 'IT-PRN', label: 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก', status: 'active', sortOrder: 1 },
  { code: 'IT-COM', label: 'คอมพิวเตอร์และโน้ตบุ๊ก', status: 'active', sortOrder: 2 },
  { code: 'IT-NET', label: 'Network และการเชื่อมต่อ', status: 'active', sortOrder: 3 },
  { code: 'IT-SFT', label: 'Software และระบบปฏิบัติการ', status: 'active', sortOrder: 4 },
  { code: 'IT-ACC', label: 'บัญชีผู้ใช้และสิทธิ์การใช้งาน', status: 'active', sortOrder: 5 },
  { code: 'IT-SCN', label: 'Scanner และอุปกรณ์สแกน', status: 'active', sortOrder: 6 },
  { code: 'IT-PER', label: 'อุปกรณ์ต่อพ่วง', status: 'future', sortOrder: 7 },
  { code: 'IT-INS', label: 'ติดตั้ง ย้าย และตั้งค่าอุปกรณ์', status: 'active', sortOrder: 8 },
  { code: 'IT-SRV', label: 'Server, Storage และ Backup', status: 'future', sortOrder: 9 },
  { code: 'IT-EML', label: 'Email และการสื่อสาร', status: 'future', sortOrder: 10 },
  { code: 'IT-SEC', label: 'ระบบความปลอดภัยและอุปกรณ์รักษาความปลอดภัย', status: 'future', sortOrder: 11 },
  { code: 'IT-TEL', label: 'โทรศัพท์และระบบสื่อสารภายใน', status: 'future', sortOrder: 12 },
  { code: 'IT-MNT', label: 'บำรุงรักษาและตรวจสอบเชิงป้องกัน', status: 'active', sortOrder: 13 },
  { code: 'IT-OTH', label: 'งาน IT อื่น ๆ', status: 'active', sortOrder: 14 },
] as const

// ─────────────────────────────────────────────────────────────
// Problem codes (RP-*) — 28 items
// ─────────────────────────────────────────────────────────────
const PROBLEM_CODES = [
  // Printer (7)
  { code: 'RP-PRN-001', label: 'วัสดุสิ้นเปลือง หมึก ดรัม หรือกล่องบำรุงรักษา', groupCode: 'IT-PRN', groupLabel: 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก', sortOrder: 1 },
  { code: 'RP-PRN-002', label: 'พิมพ์ไม่ออก Offline หรือเครื่องไม่ทำงาน', groupCode: 'IT-PRN', groupLabel: 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก', sortOrder: 2 },
  { code: 'RP-PRN-003', label: 'งานพิมพ์ไม่ชัด สีเพี้ยน เป็นเส้น หรือเลอะ', groupCode: 'IT-PRN', groupLabel: 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก', sortOrder: 3 },
  { code: 'RP-PRN-004', label: 'กระดาษติดหรือเครื่องไม่ดึงกระดาษ', groupCode: 'IT-PRN', groupLabel: 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก', sortOrder: 4 },
  { code: 'RP-PRN-005', label: 'Error Code หรือไฟแจ้งเตือน', groupCode: 'IT-PRN', groupLabel: 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก', sortOrder: 5 },
  { code: 'RP-PRN-006', label: 'Driver, Spooler, Share Printer หรือ IP ของ Printer', groupCode: 'IT-PRN', groupLabel: 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก', sortOrder: 6 },
  { code: 'RP-PRN-007', label: 'ติดตั้ง ย้าย หรือเปลี่ยนจุดใช้งาน Printer', groupCode: 'IT-PRN', groupLabel: 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก', sortOrder: 7 },
  // Computer (4)
  { code: 'RP-COM-001', label: 'เปิดไม่ติด ไฟไม่เข้า หรือจอมืด', groupCode: 'IT-COM', groupLabel: 'คอมพิวเตอร์และโน้ตบุ๊ก', sortOrder: 1 },
  { code: 'RP-COM-002', label: 'เครื่องช้า ค้าง หรือจอฟ้า', groupCode: 'IT-COM', groupLabel: 'คอมพิวเตอร์และโน้ตบุ๊ก', sortOrder: 2 },
  { code: 'RP-COM-003', label: 'Hardware ของคอมพิวเตอร์หรือโน้ตบุ๊กผิดปกติ', groupCode: 'IT-COM', groupLabel: 'คอมพิวเตอร์และโน้ตบุ๊ก', sortOrder: 3 },
  { code: 'RP-COM-004', label: 'Windows, Driver หรือโปรแกรมในเครื่องมีปัญหา', groupCode: 'IT-COM', groupLabel: 'คอมพิวเตอร์และโน้ตบุ๊ก', sortOrder: 4 },
  // Network (4)
  { code: 'RP-NET-001', label: 'เชื่อมต่อ Wi-Fi หรือ LAN ไม่ได้', groupCode: 'IT-NET', groupLabel: 'Network และการเชื่อมต่อ', sortOrder: 1 },
  { code: 'RP-NET-002', label: 'Network Offline หรือเชื่อมต่อระบบ/อุปกรณ์ไม่ได้', groupCode: 'IT-NET', groupLabel: 'Network และการเชื่อมต่อ', sortOrder: 2 },
  { code: 'RP-NET-003', label: 'สาย LAN, USB, Port หรืออุปกรณ์เครือข่ายมีปัญหา', groupCode: 'IT-NET', groupLabel: 'Network และการเชื่อมต่อ', sortOrder: 3 },
  { code: 'RP-NET-004', label: 'IP, Share หรือการตั้งค่า Network มีปัญหา', groupCode: 'IT-NET', groupLabel: 'Network และการเชื่อมต่อ', sortOrder: 4 },
  // Software/System (3)
  { code: 'RP-SFT-001', label: 'โปรแกรมหรือระบบมี Error', groupCode: 'IT-SFT', groupLabel: 'Software และระบบปฏิบัติการ', sortOrder: 1 },
  { code: 'RP-SFT-002', label: 'Driver หรือ Windows Update มีปัญหา', groupCode: 'IT-SFT', groupLabel: 'Software และระบบปฏิบัติการ', sortOrder: 2 },
  { code: 'RP-SFT-003', label: 'ติดตั้งหรือปรับตั้งค่าโปรแกรม', groupCode: 'IT-SFT', groupLabel: 'Software และระบบปฏิบัติการ', sortOrder: 3 },
  // Account/Access (2)
  { code: 'RP-ACC-001', label: 'เข้าใช้งานไม่ได้หรือบัญชีผู้ใช้มีปัญหา', groupCode: 'IT-ACC', groupLabel: 'บัญชีผู้ใช้และสิทธิ์การใช้งาน', sortOrder: 1 },
  { code: 'RP-ACC-002', label: 'รหัสผ่านหรือสิทธิ์การใช้งาน', groupCode: 'IT-ACC', groupLabel: 'บัญชีผู้ใช้และสิทธิ์การใช้งาน', sortOrder: 2 },
  // Scanner/Peripheral (1)
  { code: 'RP-SCN-001', label: 'Scan เข้าคอมพิวเตอร์หรือ Email ไม่ได้', groupCode: 'IT-SCN', groupLabel: 'Scanner และอุปกรณ์สแกน', sortOrder: 1 },
  // Installation (1)
  { code: 'RP-INS-001', label: 'ติดตั้ง ย้าย หรือเปลี่ยนจุดใช้งานอุปกรณ์', groupCode: 'IT-INS', groupLabel: 'ติดตั้ง ย้าย และตั้งค่าอุปกรณ์', sortOrder: 1 },
  // Maintenance (1)
  { code: 'RP-MNT-001', label: 'งานบำรุงรักษาและตรวจสอบตามรอบ', groupCode: 'IT-MNT', groupLabel: 'บำรุงรักษาและตรวจสอบเชิงป้องกัน', sortOrder: 1 },
  // Other IT (1)
  { code: 'RP-OTH-999', label: 'อื่น ๆ / รอเจ้าหน้าที่จำแนก', groupCode: 'IT-OTH', groupLabel: 'งาน IT อื่น ๆ', sortOrder: 999 },
] as const

// ─────────────────────────────────────────────────────────────
// Resolution codes (RX-*) — 17 items
// ─────────────────────────────────────────────────────────────
const RESOLUTION_CODES = [
  // Printer (4)
  { code: 'RX-PRN-001', label: 'เติมหรือเปลี่ยนหมึก ดรัม หรือกล่องบำรุงรักษา', groupCode: 'IT-PRN', groupLabel: 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก', sortOrder: 1 },
  { code: 'RX-PRN-002', label: 'ตรวจชุดพิมพ์ หัวพิมพ์ คุณภาพงานพิมพ์ หรือ Error Code', groupCode: 'IT-PRN', groupLabel: 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก', sortOrder: 2 },
  { code: 'RX-PRN-003', label: 'เคลียร์กระดาษติดและตรวจชุดป้อนกระดาษ', groupCode: 'IT-PRN', groupLabel: 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก', sortOrder: 3 },
  { code: 'RX-PRN-004', label: 'ติดตั้งหรือปรับ Driver, Spooler, Share และ IP', groupCode: 'IT-PRN', groupLabel: 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก', sortOrder: 4 },
  // Computer (3)
  { code: 'RX-COM-001', label: 'ตรวจไฟเลี้ยง สายไฟ อุปกรณ์ และ Hardware', groupCode: 'IT-COM', groupLabel: 'คอมพิวเตอร์และโน้ตบุ๊ก', sortOrder: 1 },
  { code: 'RX-COM-002', label: 'ตรวจระบบ Windows, Driver หรือโปรแกรม', groupCode: 'IT-COM', groupLabel: 'คอมพิวเตอร์และโน้ตบุ๊ก', sortOrder: 2 },
  { code: 'RX-COM-003', label: 'เปลี่ยนหรือซ่อมอุปกรณ์คอมพิวเตอร์/โน้ตบุ๊ก', groupCode: 'IT-COM', groupLabel: 'คอมพิวเตอร์และโน้ตบุ๊ก', sortOrder: 3 },
  // Network (3)
  { code: 'RX-NET-001', label: 'ตรวจสาย Port Switch Wi-Fi และสัญญาณเครือข่าย', groupCode: 'IT-NET', groupLabel: 'Network และการเชื่อมต่อ', sortOrder: 1 },
  { code: 'RX-NET-002', label: 'ตรวจหรือปรับ IP, DNS, Share และ Network Configuration', groupCode: 'IT-NET', groupLabel: 'Network และการเชื่อมต่อ', sortOrder: 2 },
  { code: 'RX-NET-003', label: 'เปลี่ยนสายหรืออุปกรณ์เครือข่ายที่ชำรุด', groupCode: 'IT-NET', groupLabel: 'Network และการเชื่อมต่อ', sortOrder: 3 },
  // Software/System (2)
  { code: 'RX-SFT-001', label: 'ติดตั้ง อัปเดต หรือตั้งค่าโปรแกรมและ Driver', groupCode: 'IT-SFT', groupLabel: 'Software และระบบปฏิบัติการ', sortOrder: 1 },
  { code: 'RX-SFT-002', label: 'แก้ไข Configuration หรือประสานเจ้าของระบบ', groupCode: 'IT-SFT', groupLabel: 'Software และระบบปฏิบัติการ', sortOrder: 2 },
  // Account/Access (2)
  { code: 'RX-ACC-001', label: 'Reset Password หรือแก้ไขบัญชีผู้ใช้', groupCode: 'IT-ACC', groupLabel: 'บัญชีผู้ใช้และสิทธิ์การใช้งาน', sortOrder: 1 },
  { code: 'RX-ACC-002', label: 'ปรับสิทธิ์หรือกำหนดสิทธิ์การใช้งาน', groupCode: 'IT-ACC', groupLabel: 'บัญชีผู้ใช้และสิทธิ์การใช้งาน', sortOrder: 2 },
  // Scanner/Peripheral (1)
  { code: 'RX-SCN-001', label: 'ตั้งค่า Scan, Folder, Email หรือ Driver', groupCode: 'IT-SCN', groupLabel: 'Scanner และอุปกรณ์สแกน', sortOrder: 1 },
  // Installation (1)
  { code: 'RX-INS-001', label: 'ติดตั้ง ย้าย และตั้งค่าจุดใช้งานใหม่', groupCode: 'IT-INS', groupLabel: 'ติดตั้ง ย้าย และตั้งค่าอุปกรณ์', sortOrder: 1 },
  // Maintenance (1)
  { code: 'RX-MNT-001', label: 'ทำความสะอาด ตรวจเช็ก และบันทึกผลบำรุงรักษา', groupCode: 'IT-MNT', groupLabel: 'บำรุงรักษาและตรวจสอบเชิงป้องกัน', sortOrder: 1 },
  // Other IT (1)
  { code: 'RX-OTH-999', label: 'อื่น ๆ / รอจำแนก', groupCode: 'IT-OTH', groupLabel: 'งาน IT อื่น ๆ', sortOrder: 999 },
] as const

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Create RepairTaxonomy table + seed taxonomy')
  console.log('═══════════════════════════════════════════════════════════════')

  // Step 1: Create table (raw SQL — idempotent)
  console.log('\n📊 Step 1: Create RepairTaxonomy table (idempotent)...')
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "RepairTaxonomy" (
      "id" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "code" TEXT NOT NULL,
      "label" TEXT NOT NULL,
      "groupCode" TEXT,
      "groupLabel" TEXT,
      "status" TEXT,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "RepairTaxonomy_pkey" PRIMARY KEY ("id")
    )
  `)
  console.log('   ✅ Table created')
  await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "RepairTaxonomy_code_key" ON "RepairTaxonomy"("code")`)
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "RepairTaxonomy_type_idx" ON "RepairTaxonomy"("type")`)
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "RepairTaxonomy_groupCode_idx" ON "RepairTaxonomy"("groupCode")`)
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "RepairTaxonomy_code_idx" ON "RepairTaxonomy"("code")`)
  console.log('   ✅ Indexes created')

  // Step 2: Seed IT groups (14)
  console.log('\n🌱 Step 2: Seed IT groups (14)...')
  for (const g of IT_GROUPS) {
    await db.$executeRawUnsafe(`
      INSERT INTO "RepairTaxonomy" ("id", "type", "code", "label", "status", "sortOrder", "active", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, 'group', $1, $2, $3, $4, true, NOW(), NOW())
      ON CONFLICT ("code") DO UPDATE SET
        "label" = EXCLUDED."label",
        "status" = EXCLUDED."status",
        "sortOrder" = EXCLUDED."sortOrder",
        "updatedAt" = NOW()
    `, g.code, g.label, g.status, g.sortOrder)
  }
  console.log(`   ✅ Inserted ${IT_GROUPS.length} IT groups`)

  // Step 3: Seed Problem codes (28)
  console.log('\n🌱 Step 3: Seed Problem codes (RP-*) (28)...')
  for (const p of PROBLEM_CODES) {
    await db.$executeRawUnsafe(`
      INSERT INTO "RepairTaxonomy" ("id", "type", "code", "label", "groupCode", "groupLabel", "status", "sortOrder", "active", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, 'problem', $1, $2, $3, $4, 'active', $5, true, NOW(), NOW())
      ON CONFLICT ("code") DO UPDATE SET
        "label" = EXCLUDED."label",
        "groupCode" = EXCLUDED."groupCode",
        "groupLabel" = EXCLUDED."groupLabel",
        "sortOrder" = EXCLUDED."sortOrder",
        "updatedAt" = NOW()
    `, p.code, p.label, p.groupCode, p.groupLabel, p.sortOrder)
  }
  console.log(`   ✅ Inserted ${PROBLEM_CODES.length} Problem codes`)

  // Step 4: Seed Resolution codes (17)
  console.log('\n🌱 Step 4: Seed Resolution codes (RX-*) (17)...')
  for (const r of RESOLUTION_CODES) {
    await db.$executeRawUnsafe(`
      INSERT INTO "RepairTaxonomy" ("id", "type", "code", "label", "groupCode", "groupLabel", "status", "sortOrder", "active", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, 'resolution', $1, $2, $3, $4, 'active', $5, true, NOW(), NOW())
      ON CONFLICT ("code") DO UPDATE SET
        "label" = EXCLUDED."label",
        "groupCode" = EXCLUDED."groupCode",
        "groupLabel" = EXCLUDED."groupLabel",
        "sortOrder" = EXCLUDED."sortOrder",
        "updatedAt" = NOW()
    `, r.code, r.label, r.groupCode, r.groupLabel, r.sortOrder)
  }
  console.log(`   ✅ Inserted ${RESOLUTION_CODES.length} Resolution codes`)

  // Step 5: Verify
  console.log('\n✅ Step 5: Verify...')
  const total = await db.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "RepairTaxonomy"`)
  console.log(`   Total RepairTaxonomy rows: ${total[0].c}`)
  const byType = await db.$queryRawUnsafe(`
    SELECT type, COUNT(*) as c FROM "RepairTaxonomy" GROUP BY type ORDER BY type
  `)
  for (const r of byType) {
    console.log(`   ${r.type}: ${r.c}`)
  }

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  ✅ COMPLETE — RepairTaxonomy table created + seeded')
  console.log('═══════════════════════════════════════════════════════════════')
}

main()
  .catch((e) => {
    console.error('❌ FATAL:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
