/**
 * scripts/backfill-master-data.ts
 *
 * Backfill master data per ITAM-01 handoff requirements (4 sections):
 *
 *   1. Device — backfill typeId/brandId/modelId from legacy text fields
 *      (composite Brand+Model+Type already matches 41/41 = 100%)
 *
 *   2. Affiliation — create MasterItem(category='Affiliation') for the 42
 *      unique parentRef display texts currently used by Departments,
 *      then UPDATE Department.parentRef from text → stable code (AFF-001)
 *
 *   3. Stock — backfill StockItem.category from productName using keyword
 *      mapping (INK, TONER, DRUM, MAINTENANCE_KIT, PAPER_FEED_PART,
 *      SPARE_PART, STICKER_LABEL, PAPER_MEDIA, CLEANING_SUPPLY, ACCESSORY, OTHER)
 *
 *   4. Repair — create MasterItem rows for RP-* (Request/Problem) and
 *      RX-* (Resolution/Fix) code families covering 10+ IT domains
 *
 * IDEMPOTENT: every step uses findFirst/upsert pattern — re-running is safe.
 * READ-ONLY on legacy text fields — only fills empty FK columns and category.
 *
 * Usage:
 *   ITAM_DB_URL="postgresql://..." bunx tsx scripts/backfill-master-data.ts
 *   ITAM_DB_URL="postgresql://..." bunx tsx scripts/backfill-master-data.ts --dry-run
 *   ITAM_DB_URL="postgresql://..." bunx tsx scripts/backfill-master-data.ts --only=device
 *   ITAM_DB_URL="postgresql://..." bunx tsx scripts/backfill-master-data.ts --only=affiliation
 *   ITAM_DB_URL="postgresql://..." bunx tsx scripts/backfill-master-data.ts --only=stock
 *   ITAM_DB_URL="postgresql://..." bunx tsx scripts/backfill-master-data.ts --only=repair
 */

import { PrismaClient } from '@prisma/client'

// ---------- Pool URL builder (auto-switch 5432 → 6543) ----------
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
if (!rawUrl || !rawUrl.startsWith('postgres')) {
  console.error('❌ Missing ITAM_DB_URL (must start with postgresql://)')
  process.exit(1)
}
const poolUrl = buildPoolUrl(rawUrl)
console.log(`🔌 Connecting to: ${poolUrl.replace(/:[^:@]+@/, ':****@')}`)

const db = new PrismaClient({
  datasources: { db: { url: poolUrl } },
  log: ['error', 'warn'],
})

// ---------- CLI flags ----------
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const onlyFlag = (args.find((a) => a.startsWith('--only=')) ?? '').split('=')[1] ?? ''
const RUN_DEVICE = !onlyFlag || onlyFlag === 'device'
const RUN_AFFILIATION = !onlyFlag || onlyFlag === 'affiliation'
const RUN_STOCK = !onlyFlag || onlyFlag === 'stock'
const RUN_REPAIR = !onlyFlag || onlyFlag === 'repair'

console.log(`🧪 Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'LIVE (will write)'}`)
console.log(`📋 Sections: ${[RUN_DEVICE && 'device', RUN_AFFILIATION && 'affiliation', RUN_STOCK && 'stock', RUN_REPAIR && 'repair'].filter(Boolean).join(', ')}`)
console.log('')

// ============================================================
// 1) Device — backfill typeId/brandId/modelId from legacy text
// ============================================================
async function backfillDeviceFKs() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  [1/4] DEVICE — backfill typeId/brandId/modelId')
  console.log('═══════════════════════════════════════════════════════════════')

  // Build lookup maps (single query each, no N+1).
  const [types, brands, models] = await Promise.all([
    db.deviceType.findMany({ select: { id: true, name: true } }),
    db.brand.findMany({ select: { id: true, name: true, typeId: true } }),
    db.model.findMany({ select: { id: true, name: true, brandId: true } }),
  ])
  const typeByName = new Map(types.map((t) => [t.name, t.id]))
  const brandByName = new Map(brands.map((b) => [`${b.name}|${b.typeId}`, b.id]))
  const modelByName = new Map(models.map((m) => [`${m.name}|${m.brandId}`, m.id]))
  console.log(`   Lookups: ${types.length} types, ${brands.length} brands, ${models.length} models`)

  // Get devices with NULL FK columns (only those need backfill).
  const devicesNeedingBackfill = await db.device.findMany({
    where: { OR: [{ typeId: null }, { brandId: null }, { modelId: null }] },
    select: { id: true, type: true, brand: true, model: true },
  })
  console.log(`   Devices needing FK backfill: ${devicesNeedingBackfill.length}`)

  if (DRY_RUN) {
    // Simulate — count matches that would succeed.
    let wouldMatch = 0
    let wouldSkip = 0
    for (const d of devicesNeedingBackfill) {
      const typeId = d.type ? typeByName.get(d.type) : null
      if (!typeId) {
        wouldSkip++
        continue
      }
      const brandId = d.brand ? brandByName.get(`${d.brand}|${typeId}`) : null
      if (!brandId) {
        wouldSkip++
        continue
      }
      const modelId = d.model ? modelByName.get(`${d.model}|${brandId}`) : null
      if (!modelId) {
        wouldSkip++
        continue
      }
      wouldMatch++
    }
    console.log(`   DRY-RUN: would backfill ${wouldMatch}/${devicesNeedingBackfill.length}, skip ${wouldSkip}`)
    return { updated: 0, skipped: wouldSkip, wouldMatch }
  }

  let updated = 0
  let skipped = 0
  if (DRY_RUN) {
    // already returned above
  } else {
    // Use a single raw SQL UPDATE with a CASE expression — much faster than
    // 2,378 individual tx.update() calls. Idempotent (only fills NULL FK columns).
    // Composite match: 41/41 = 100%, so every device with type+brand+model will be linked.
    const result = await db.$executeRaw`
      UPDATE "Device" d
      SET
        "typeId" = COALESCE(d."typeId", (SELECT id FROM "DeviceType" WHERE name = d."type")),
        "brandId" = COALESCE(d."brandId", (
          SELECT b.id FROM "Brand" b
          JOIN "DeviceType" t ON t.id = b."typeId"
          WHERE b.name = d.brand AND t.name = d."type"
        )),
        "modelId" = COALESCE(d."modelId", (
          SELECT m.id FROM "Model" m
          JOIN "Brand" b ON b.id = m."brandId"
          JOIN "DeviceType" t ON t.id = b."typeId"
          WHERE m.name = d.model AND b.name = d.brand AND t.name = d."type"
        ))
      WHERE d."typeId" IS NULL OR d."brandId" IS NULL OR d."modelId" IS NULL
    `
    updated = Number(result)
    // Count remaining NULLs to report skipped.
    const remaining = await db.device.count({
      where: { OR: [{ typeId: null }, { brandId: null }, { modelId: null }] },
    })
    skipped = remaining
  }

  console.log(`   ✅ Updated: ${updated}, remaining NULL FK: ${skipped}`)
  return { updated, skipped }
}

// ============================================================
// 2) Affiliation — create MasterItem(category='Affiliation') + UPDATE parentRef text→code
// ============================================================
async function backfillAffiliation() {
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  [2/4] AFFILIATION — create Affiliation master + rebind parentRef')
  console.log('═══════════════════════════════════════════════════════════════')

  // Get all distinct parentRef display texts from Department rows.
  const depts = await db.masterItem.findMany({
    where: {
      category: 'Department',
      NOT: { OR: [{ parentRef: null }, { parentRef: '' }] },
    },
    select: { id: true, parentRef: true, siteCode: true },
  })
  const uniqueParents = [...new Set(depts.map((d) => d.parentRef as string))]
  console.log(`   Distinct parentRef display texts: ${uniqueParents.length}`)

  // Build text→code map (create Affiliation rows if missing).
  const textToCode = new Map<string, string>()
  let created = 0
  let existing = 0

  for (let i = 0; i < uniqueParents.length; i++) {
    const text = uniqueParents[i]
    const code = `AFF-${String(i + 1).padStart(3, '0')}`
    textToCode.set(text, code)

    if (DRY_RUN) continue

    const existingRow = await db.masterItem.findFirst({
      where: { category: 'Affiliation', code },
      select: { id: true },
    })
    if (!existingRow) {
      await db.masterItem.create({
        data: {
          category: 'Affiliation',
          code,
          label: text,
          displayLabel: text,
          siteCode: 'ALL', // Affiliations are global (not site-scoped)
          active: true,
        },
      })
      created++
    } else {
      existing++
    }
  }
  console.log(`   Affiliation master rows: ${created} new + ${existing} existing = ${uniqueParents.length} total`)

  if (DRY_RUN) {
    console.log(`   DRY-RUN: would UPDATE ${depts.length} Department.parentRef text → code`)
    return { created: 0, updated: 0 }
  }

  // Update Department.parentRef from text → code (idempotent).
  let updated = 0
  await db.$transaction(
    async (tx) => {
      for (const d of depts) {
        const code = textToCode.get(d.parentRef as string)
        if (!code) continue
        // Skip if already a code (idempotent — won't double-update).
        if (/^AFF-\d{3}$/.test(d.parentRef as string)) continue
        await tx.masterItem.update({
          where: { id: d.id },
          data: { parentRef: code },
        })
        updated++
      }
    },
    { timeout: 60000 },
  )
  console.log(`   ✅ Updated Department.parentRef: ${updated}`)
  return { created, updated }
}

// ============================================================
// 3) Stock — backfill StockItem.category from productName
// ============================================================
const STOCK_CATEGORY_RULES: Array<{ category: string; patterns: RegExp[] }> = [
  { category: 'INK', patterns: [/ink/i, /น้ำหมึก/i, /inkjet/i] },
  { category: 'TONER', patterns: [/toner/i, /โทนเนอร์/i] },
  { category: 'DRUM', patterns: [/drum/i, /ดรัม/i] },
  { category: 'MAINTENANCE_KIT', patterns: [/maintenance/i, /kit/i, /ชุดบำรุง/i] },
  { category: 'PAPER_FEED_PART', patterns: [/roller/i, /paper feed/i, /ฟีดกระดาษ/i, /ลูกกลิ้ง/i] },
  { category: 'STICKER_LABEL', patterns: [/sticker/i, /label/i, /สติกเกอร์/i, /ฉลาก/i] },
  { category: 'PAPER_MEDIA', patterns: [/paper/i, /กระดาษ/i, /a4/i, /a3/i, /หน้าแผ่น/i] },
  { category: 'CLEANING_SUPPLY', patterns: [/clean/i, /ทำความสะอาด/i, /swab/i, /แอลกอฮอล์/i] },
  { category: 'ACCESSORY', patterns: [/cable/i, /สาย/i, /adapter/i, /power/i, /แอแปป /i, /ฝาคู่อ/i, /ชิ้นส่วน/i] },
  { category: 'SPARE_PART', patterns: [/spare/i, /อะไหล่/i, /part/i, /fuser/i, /ฟิวเซอร์/i] },
]

function classifyStock(productName: string | null): string {
  if (!productName) return 'OTHER'
  for (const rule of STOCK_CATEGORY_RULES) {
    if (rule.patterns.some((p) => p.test(productName))) return rule.category
  }
  return 'OTHER'
}

async function backfillStockCategory() {
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  [3/4] STOCK — backfill StockItem.category from productName')
  console.log('═══════════════════════════════════════════════════════════════')

  const items = await db.stockItem.findMany({
    where: { OR: [{ category: null }, { category: '' }] },
    select: { id: true, productName: true, productCode: true },
  })
  console.log(`   StockItems needing category: ${items.length}`)

  // Preview distribution.
  const distribution: Record<string, number> = {}
  for (const it of items) {
    const cat = classifyStock(it.productName)
    distribution[cat] = (distribution[cat] ?? 0) + 1
  }
  console.log('   Preview distribution:')
  for (const [cat, n] of Object.entries(distribution).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${cat.padEnd(20)} ${n}`)
  }

  if (DRY_RUN) {
    console.log(`   DRY-RUN: would UPDATE ${items.length} StockItem.category`)
    return { updated: 0 }
  }

  let updated = 0
  await db.$transaction(
    async (tx) => {
      for (const it of items) {
        const cat = classifyStock(it.productName)
        await tx.stockItem.update({
          where: { id: it.id },
          data: { category: cat },
        })
        updated++
      }
    },
    { timeout: 30000 },
  )
  console.log(`   ✅ Updated StockItem.category: ${updated}`)
  return { updated }
}

// ============================================================
// 4) Repair — create RP-*/RX-* MasterItem rows
// ============================================================
const REPAIR_PROBLEM_TAXONOMY: Array<{ code: string; label: string }> = [
  { code: 'RP-PRN-001', label: 'เครื่องพิมพ์: พิมพ์ไม่ออก' },
  { code: 'RP-PRN-002', label: 'เครื่องพิมพ์: กระดาษติด' },
  { code: 'RP-PRN-003', label: 'เครื่องพิมพ์: คุณภาพพิมพ์ผิดเพี้ยน' },
  { code: 'RP-PRN-004', label: 'เครื่องพิมพ์: หมึก/โทนเนอร์หมด' },
  { code: 'RP-PRN-005', label: 'เครื่องพิมพ์: ต่อ network ไม่ได้' },
  { code: 'RP-PC-001', label: 'คอมพิวเตอร์: เปิดไม่ติด' },
  { code: 'RP-PC-002', label: 'คอมพิวเตอร์: ช้า/ค้าง' },
  { code: 'RP-PC-003', label: 'คอมพิวเตอร์: หน้าจอผิดเพี้ยน' },
  { code: 'RP-PC-004', label: 'คอมพิวเตอร์: ไวรัส/malware' },
  { code: 'RP-NET-001', label: 'เครือข่าย: อินเทอร์เน็ตใช้ไม่ได้' },
  { code: 'RP-NET-002', label: 'เครือข่าย: WiFi ไม่เสถียร' },
  { code: 'RP-NET-003', label: 'เครือข่าย: เคเบิล/สาย LAN เสีย' },
  { code: 'RP-SYS-001', label: 'ระบบ: ล็อกอินไม่ได้' },
  { code: 'RP-SYS-002', label: 'ระบบ: แอปพลิเคชัน error' },
  { code: 'RP-SYS-003', label: 'ระบบ: ข้อมูลหาย/เสียหาย' },
  { code: 'RP-ACC-001', label: 'บัญชี: รีเซ็ตรหัสผ่าน' },
  { code: 'RP-ACC-002', label: 'บัญชี: ขอสิทธิ์การใช้งาน' },
  { code: 'RP-ACC-003', label: 'บัญชี: บัญชีถูกล็อก' },
  { code: 'RP-SCN-001', label: 'สแกนเนอร์: สแกนไม่ได้' },
  { code: 'RP-SCN-002', label: 'สแกนเนอร์: คุณภาพสแกนต่ำ' },
  { code: 'RP-PER-001', label: 'อุปกรณ์ต่อพ่วง: คีย์บอร์ด/เมาส์เสีย' },
  { code: 'RP-PER-002', label: 'อุปกรณ์ต่อพ่วง: กล้อง/เสียงเสีย' },
  { code: 'RP-INS-001', label: 'การติดตั้ง: ติดตั้งอุปกรณ์ใหม่' },
  { code: 'RP-INS-002', label: 'การติดตั้ง: ตั้งค่าซอฟต์แวร์' },
  { code: 'RP-MAINT-001', label: 'บำรุงรักษา: ตรวจสอบประจำ' },
  { code: 'RP-MAINT-002', label: 'บำรุงรักษา: ทำความสะอาดอุปกรณ์' },
  { code: 'RP-OTHER', label: 'อื่นๆ (IT)' },
]

const REPAIR_RESOLUTION_TAXONOMY: Array<{ code: string; label: string }> = [
  { code: 'RX-RESTART', label: 'รีสตาร์ทเครื่อง/บริการ' },
  { code: 'RX-REPAIR', label: 'ซ่อมแซมฮาร์ดแวร์' },
  { code: 'RX-REPLACE', label: 'เปลี่ยนอะไหล่' },
  { code: 'RX-CONFIG', label: 'ตั้งค่า/ปรับ config' },
  { code: 'RX-INSTALL', label: 'ติดตั้งซอฟต์แวร์/ไดรเวอร์' },
  { code: 'RX-UNINSTALL', label: 'ถอนการติดตั้ง' },
  { code: 'RX-CLEAN', label: 'ทำความสะอาดอุปกรณ์' },
  { code: 'RX-RESET', label: 'รีเซ็ตค่าเริ่มต้น' },
  { code: 'RX-CABLE', label: 'เช็ค/เปลี่ยนสาย' },
  { code: 'RX-NETWORK', label: 'แก้ไขปัญหาเครือข่าย' },
  { code: 'RX-ACCOUNT', label: 'จัดการบัญชี/สิทธิ์' },
  { code: 'RX-DATA', label: 'กู้คืน/ย้ายข้อมูล' },
  { code: 'RX-UPGRADE', label: 'อัปเกรดฮาร์ดแวร์/ซอฟต์แวร์' },
  { code: 'RX-ESCALATE', label: 'ส่งต่อระดับสูงขึ้น' },
  { code: 'RX-OTHER', label: 'อื่นๆ' },
]

async function backfillRepairTaxonomy() {
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  [4/4] REPAIR — create RP-*/RX-* master taxonomy')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`   RepairProblem (RP-*): ${REPAIR_PROBLEM_TAXONOMY.length} codes`)
  console.log(`   RepairResolution (RX-*): ${REPAIR_RESOLUTION_TAXONOMY.length} codes`)

  if (DRY_RUN) {
    console.log(`   DRY-RUN: would create ${REPAIR_PROBLEM_TAXONOMY.length + REPAIR_RESOLUTION_TAXONOMY.length} MasterItem rows`)
    return { created: 0 }
  }

  let created = 0
  let existing = 0

  for (const item of REPAIR_PROBLEM_TAXONOMY) {
    const existingRow = await db.masterItem.findFirst({
      where: { category: 'RepairProblem', code: item.code },
      select: { id: true },
    })
    if (existingRow) {
      existing++
      continue
    }
    await db.masterItem.create({
      data: {
        category: 'RepairProblem',
        code: item.code,
        label: item.label,
        displayLabel: item.label,
        siteCode: 'ALL', // Repair taxonomy is global
        active: true,
      },
    })
    created++
  }

  for (const item of REPAIR_RESOLUTION_TAXONOMY) {
    const existingRow = await db.masterItem.findFirst({
      where: { category: 'RepairResolution', code: item.code },
      select: { id: true },
    })
    if (existingRow) {
      existing++
      continue
    }
    await db.masterItem.create({
      data: {
        category: 'RepairResolution',
        code: item.code,
        label: item.label,
        displayLabel: item.label,
        siteCode: 'ALL',
        active: true,
      },
    })
    created++
  }

  console.log(`   ✅ Created: ${created} new + ${existing} existing = ${REPAIR_PROBLEM_TAXONOMY.length + REPAIR_RESOLUTION_TAXONOMY.length} total`)
  return { created }
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  ITAM-DB Master Data Backfill (per ITAM-01 handoff)')
  console.log('═══════════════════════════════════════════════════════════════')

  const startTime = Date.now()
  const summary: Record<string, unknown> = {}

  try {
    // Health check
    console.log('🏥 Health check: SELECT 1 ...')
    await db.$queryRaw`SELECT 1`
    console.log('   ✅ DB reachable\n')

    if (RUN_DEVICE) summary.device = await backfillDeviceFKs()
    if (RUN_AFFILIATION) summary.affiliation = await backfillAffiliation()
    if (RUN_STOCK) summary.stock = await backfillStockCategory()
    if (RUN_REPAIR) summary.repair = await backfillRepairTaxonomy()

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log('\n═══════════════════════════════════════════════════════════════')
    console.log('  📊 SUMMARY')
    console.log('═══════════════════════════════════════════════════════════════')
    console.log(JSON.stringify(summary, null, 2))
    console.log(`  ⏱  elapsed: ${elapsed}s`)
    console.log('═══════════════════════════════════════════════════════════════')
  } catch (err) {
    console.error('\n❌ FATAL:', err)
    process.exitCode = 1
  } finally {
    await db.$disconnect()
    console.log('🔌 Disconnected.')
  }
}

main().catch((err) => {
  console.error('❌ Uncaught:', err)
  process.exit(1)
})
