/**
 * scripts/expand-demo-data.ts — Idempotent demo data expansion.
 *
 * Why this script exists:
 *   demoFilter() in src/lib/demo-mode.ts was tightened so demo users only see
 *   records tagged `isDemo: true`. The pre-existing demo dataset was thin
 *   (15 devices / 40 WOs / 9 stock / 8 meter readings / 1 PM), so demo users
 *   landed on mostly empty pages. This script backfills enough demo data to
 *   make every screen feel populated and testable:
 *
 *     1. Devices          → 100  (DEMO-DEV-001 … DEMO-DEV-100)
 *     2. Work Orders       →  50  (DEMO-WO-006 … DEMO-WO-055 — continues existing 001..005)
 *     3. Stock Items       →  30  (DEMO-STK-001 … DEMO-STK-030)
 *     4. Meter Readings    → ~100  (months 2026-08 + 2026-09, MONTHLY type)
 *     5. PM Schedules      →   5  (mix of PENDING / COMPLETED executions)
 *     6. SiteAttribute     →   1  (PPIT tagged isDemo=true)
 *
 * Idempotency:
 *   - Devices / StockItems / WorkOrders / PMSchedules → `upsert` on unique key
 *   - MeterReadings → check (deviceId, readingMonth, readingType) before create
 *   - SiteAttribute PPIT → update isDemo=true if false
 *
 * Re-run-safe: running twice yields the same final state. Inserts new rows on
 * first run, updates / skips on subsequent runs. Reports per-model counts of
 * created/updated/skipped at the end.
 *
 * Usage:
 *   DATABASE_URL="postgresql://…?pgbouncer=true&connection_limit=1&pool_timeout=20" \
 *     bun run scripts/expand-demo-data.ts
 *
 * Notes:
 *   - Uses sequential awaits (no Promise.all) because the supplied DATABASE_URL
 *     sets connection_limit=1 — parallel queries would queue/block.
 *   - Does NOT use db.$transaction([...]) because some batches exceed Prisma's
 *     inline-transaction size limits on Supabase transaction-mode pooler.
 *   - All writes set `isDemo: true` so /api/itam/demo/reset can purge them.
 */

import { PrismaClient } from '@prisma/client'

// ── Bootstrap Prisma (standalone client — do NOT import src/lib/db because
//    the global cache there is tuned for Next.js hot-reload, not CLI use) ──────
const db = new PrismaClient({
  log: ['error'],
})

// ── Counter helpers for the final summary ────────────────────────────────────
type Counter = { created: number; updated: number; skipped: number }
const counters: Record<string, Counter> = {}
const bump = (model: string, key: keyof Counter) => {
  if (!counters[model]) counters[model] = { created: 0, updated: 0, skipped: 0 }
  counters[model][key]++
}
const log = (msg: string) => console.log(msg)

// ── Deterministic pseudo-random (seeded) so re-runs produce the same data ────
// Using Math.random would change every value on re-run, defeating idempotency
// for fields that aren't unique-keyed. Seeded RNG keeps outputs stable.
function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    // Mulberry32 — small, fast, deterministic PRNG
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = makeRng(20260904) // fixed seed
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]
const randInt = (min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min

// ── Constants ────────────────────────────────────────────────────────────────
const SITES = [
  { code: 'UDH', name: 'โรงพยาบาลศูนย์อุดรธานี' },
  { code: 'NKP', name: 'โรงพยาบาลนครพนม' },
  { code: 'MECUD', name: 'ศูนย์แพทย์โรงพยาบาลศูนย์อุดรธานี' },
  { code: 'PPIT', name: 'PPIT' },
] as const

const DEVICE_STATUSES = ['Active', 'Inactive', 'In Repair', 'Spare'] as const

// brand/model catalogue keyed by device type — coherent combos so demo data
// looks realistic (no Canon-brand Honeywell scanners).
const CATALOGUE: Record<string, Array<{ brand: string; model: string }>> = {
  'PRINTER LASER': [
    { brand: 'HP', model: 'LaserJet Pro M404' },
    { brand: 'HP', model: 'LaserJet M402dn' },
    { brand: 'HP', model: 'LaserJet Pro M15w' },
    { brand: 'Canon', model: 'LBP2900' },
    { brand: 'Canon', model: 'imageCLASS LBP223dw' },
    { brand: 'Canon', model: 'imageRUNNER 2420' },
    { brand: 'Brother', model: 'HL-L2350DW' },
    { brand: 'Brother', model: 'HL-L2375DW' },
    { brand: 'KYOCERA', model: 'ECOSYS P2235dn' },
    { brand: 'KYOCERA', model: 'FS-1041' },
    { brand: 'Ricoh', model: 'SP 230DNw' },
    { brand: 'Ricoh', model: 'MP2014' },
  ],
  'PRINTER INKJET': [
    { brand: 'Epson', model: 'EcoTank L3210' },
    { brand: 'Epson', model: 'L5290' },
    { brand: 'Epson', model: 'L6290' },
    { brand: 'Epson', model: 'WorkForce WF-2820' },
    { brand: 'Canon', model: 'Pixma G3010' },
    { brand: 'Canon', model: 'Pixma G4410' },
    { brand: 'HP', model: 'OfficeJet Pro 9015' },
    { brand: 'HP', model: 'DeskJet Plus 6075' },
    { brand: 'Brother', model: 'DCP-T720DW' },
    { brand: 'Brother', model: 'MFC-J2330DW' },
  ],
  'PRINTER THERMAL': [
    { brand: 'Epson', model: 'TM-T82' },
    { brand: 'Epson', model: 'TM-T20III' },
    { brand: 'Epson', model: 'TM-m30' },
    { brand: 'Star', model: 'TSP143III' },
    { brand: 'Bixolon', model: 'SRP-350III' },
  ],
  'SCANNERS': [
    { brand: 'Canon', model: 'LiDE 400' },
    { brand: 'Canon', model: 'imageFORMULA R40' },
    { brand: 'Fujitsu', model: 'ScanSnap iX1600' },
    { brand: 'Fujitsu', model: 'ScanSnap iX1300' },
    { brand: 'Epson', model: 'DS-530II' },
    { brand: 'Epson', model: 'V39 II' },
    { brand: 'HP', model: 'ScanJet Pro 4500' },
  ],
  'BARCODE SCANNERS': [
    { brand: 'Honeywell', model: 'Voyager 1450g' },
    { brand: 'Honeywell', model: 'Hyperion 1300g' },
    { brand: 'Zebra', model: 'DS2208' },
    { brand: 'Zebra', model: 'DS3608' },
    { brand: 'Datalogic', model: 'QuickScan QD2430' },
  ],
}
const DEVICE_TYPES = Object.keys(CATALOGUE)

// ── 1. Devices ──────────────────────────────────────────────────────────────
async function seedDevices() {
  log('\n────────────────────────────────────────────────────────────────')
  log('[1/6] Devices — target: 100 (DEMO-DEV-001 … DEMO-DEV-100)')
  log('────────────────────────────────────────────────────────────────')
  const TARGET = 100
  for (let i = 1; i <= TARGET; i++) {
    const seq = String(i).padStart(3, '0')
    const assetCode = `DEMO-DEV-${seq}`
    const type = DEVICE_TYPES[(i - 1) % DEVICE_TYPES.length]
    const bm = pick(CATALOGUE[type])
    const site = pick(SITES)
    // Status distribution: ~70 Active, 10 Inactive, 10 In Repair, 10 Spare
    // Use a weighted pick by index position so re-runs are deterministic.
    let status: string
    const mod = i % 10
    if (mod === 0) status = 'Spare'
    else if (mod === 9) status = 'In Repair'
    else if (mod === 8) status = 'Inactive'
    else status = 'Active'

    // Meter rules: printers/thermal = metered; scanners/barcode = not metered
    const meterRequired = type === 'PRINTER LASER' || type === 'PRINTER INKJET' || type === 'PRINTER THERMAL'
    const meterMode = meterRequired ? (rng() < 0.5 ? 'TOTAL' : 'BW_COLOR') : null
    const lastMeterBw = meterRequired ? randInt(0, 60000) : 0
    const lastMeterColor = meterRequired && meterMode === 'BW_COLOR' ? randInt(0, 8000) : 0

    const purchaseYear = randInt(2018, 2024)
    const purchaseMonth = String(randInt(1, 12)).padStart(2, '0')
    const purchaseDate = `${purchaseYear}-${purchaseMonth}-15`

    const serialNumber = `SN-${assetCode}-${randInt(1000, 9999)}`
    const location = pick(['ชั้น 1', 'ชั้น 2', 'ชั้น 3', 'ห้องจ่ายยา', 'ห้องปฏิบัติการ', 'ห้องธุรการ', 'OPD', 'IPD', 'ER', 'OPD-จ่ายยา'])
    const name = `${bm.brand} ${bm.model} ${site.code}-${seq}`

    try {
      const before = await db.device.findUnique({ where: { assetCode } })
      if (before) {
        // Update isDemo + key fields; keep createdAt untouched.
        await db.device.update({
          where: { assetCode },
          data: {
            name,
            brand: bm.brand,
            model: bm.model,
            type,
            status,
            site: site.name,
            location,
            serialNumber,
            meterRequired,
            meterMode,
            lastMeterBw,
            lastMeterColor,
            purchaseDate,
            isDemo: true,
            department: 'IT',
            departmentCode: 'IT-001',
          },
        })
        bump('devices', 'updated')
        if (i % 25 === 0) log(`  • ${assetCode} updated (${i}/${TARGET})`)
      } else {
        await db.device.create({
          data: {
            assetCode,
            name,
            brand: bm.brand,
            model: bm.model,
            type,
            status,
            site: site.name,
            location,
            serialNumber,
            meterRequired,
            meterMode,
            lastMeterBw,
            lastMeterColor,
            purchaseDate,
            isDemo: true,
            department: 'IT',
            departmentCode: 'IT-001',
            warrantyMonths: 12,
          },
        })
        bump('devices', 'created')
        if (i % 25 === 0) log(`  • ${assetCode} created (${i}/${TARGET})`)
      }
    } catch (err) {
      // Unique collision on assetCode is the only expected error → skip
      bump('devices', 'skipped')
      log(`  ⚠ ${assetCode} skipped: ${(err as Error).message}`)
    }
  }
  const c = counters.devices ?? { created: 0, updated: 0, skipped: 0 }
  log(`  ✓ Devices done — created=${c.created} updated=${c.updated} skipped=${c.skipped}`)
}

// ── 2. Work Orders ──────────────────────────────────────────────────────────
async function seedWorkOrders() {
  log('\n────────────────────────────────────────────────────────────────')
  log('[2/6] Work Orders — target: 50 (DEMO-WO-006 … DEMO-WO-055)')
  log('────────────────────────────────────────────────────────────────')
  // Continue from existing DEMO-WO-001..005 (already in DB)
  const START = 6
  const END = 55
  const SUBJECTS = [
    'เครื่องพิมพ์ไม่ทำงาน',
    'กระดาษติดบ่อย',
    'หมึกหมดด่วน',
    'สแกนเนอร์เชื่อมต่อไม่ได้',
    'เครื่องค้าง/แฮงค์',
    'พิมพ์สีไม่ตรง',
    'พิมพ์ไม่ติด',
    'หน้าจอแสดงผลผิดพลาด',
    'เครื่องเสียงดังผิดปกติ',
    'หมึกรั่วซึม',
    'สแกนภาพไม่ชัด',
    'พิมพ์ช้าผิดปกติ',
    'เครื่องดับกะทันหัน',
    'อื่นๆ',
  ]
  const PROBLEM_TYPES = ['hardware', 'software', 'network', 'consumable', 'other']
  const PRIORITIES = ['ปกติ', 'ปานกลาง', 'สูง', 'ด่วน']
  // Weighted status cycle so we get a realistic spread:
  //   PENDING × 12, IN_PROGRESS × 12, WAITING_PARTS × 8, COMPLETED × 13, CANCELLED × 5
  const STATUS_PLAN: string[] = [
    ...Array(12).fill('PENDING'),
    ...Array(12).fill('IN_PROGRESS'),
    ...Array(8).fill('WAITING_PARTS'),
    ...Array(13).fill('COMPLETED'),
    ...Array(5).fill('CANCELLED'),
  ]
  const LOCATIONS = [
    'ชั้น 1 OPD',
    'ชั้น 2 OPD',
    'ชั้น 3 IPD',
    'ห้องจ่ายยา',
    'ห้องปฏิบัติการ',
    'ห้องธุรการ',
    'ER',
    'OPD-จ่ายยา',
    'IPD ห้องพยาบาล',
    'อาคารผู้ป่วยนอก',
  ]
  const REPORTERS = [
    'คุณสมชาย ใจดี',
    'คุณสมหญิง รักษ์ดี',
    'คุณวิชัย พานิช',
    'คุณมาลี ส่งเสริม',
    'คุณประเสริฐ มั่นคง',
    'คุณอนุชา วงศ์ใหญ่',
    'คุณกิตติ ศรีสุข',
    'คุณนิภา พรมมา',
    'คุณบุญมี สายตรง',
    'คุณจันทรา กลางคืน',
  ]
  const TECHS = ['demo_admin@itam.demo', 'demo_tech@itam.demo']
  const TELEPHONES = ['081-234-5678', '082-345-6789', '083-456-7890', '084-567-8901', '085-678-9012', '086-789-0123']

  let idx = 0
  for (let n = START; n <= END; n++) {
    const seq = String(n).padStart(3, '0')
    const woNumber = `DEMO-WO-${seq}`
    const status = STATUS_PLAN[idx % STATUS_PLAN.length]
    idx++
    // Spread priorities: low chance of urgent
    const priorityRoll = rng()
    const priority = priorityRoll < 0.1 ? 'ด่วน' : priorityRoll < 0.3 ? 'สูง' : priorityRoll < 0.6 ? 'ปานกลาง' : 'ปกติ'
    const subject = pick(SUBJECTS)
    const problemType = pick(PROBLEM_TYPES)
    const location = pick(LOCATIONS)
    const reporterName = pick(REPORTERS)
    const tel = pick(TELEPHONES)
    const site = pick(SITES)
    // createdAt spread over last ~3 months
    const daysAgo = randInt(0, 90)
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
    const assignedTo = status === 'IN_PROGRESS' || status === 'WAITING_PARTS' || status === 'COMPLETED' ? pick(TECHS) : null
    const details = `ปัญหา: ${problemType}\nรายละเอียด: ${subject} ที่ ${location}\nแจ้งโดย: ${reporterName} (${tel})`
    const resolution =
      status === 'COMPLETED'
        ? 'ดำเนินการซ่อมและทดสอบเรียบร้อย ใช้งานได้ปกติ'
        : status === 'CANCELLED'
          ? 'ยกเลิกเนื่องจากไม่สามารถดำเนินการได้'
          : null

    try {
      const before = await db.workOrder.findUnique({ where: { woNumber } })
      const data = {
        subject,
        details,
        priority,
        reporterName,
        tel,
        location,
        status,
        siteCode: site.code,
        assignedTo,
        resolution,
        submissionSource: 'session',
        isDemo: true,
        createdAt,
      }
      if (before) {
        await db.workOrder.update({ where: { woNumber }, data })
        bump('workOrders', 'updated')
      } else {
        await db.workOrder.create({ data: { woNumber, ...data } })
        bump('workOrders', 'created')
      }
      if ((n - START + 1) % 10 === 0) {
        log(`  • ${woNumber} processed (${n - START + 1}/${END - START + 1})`)
      }
    } catch (err) {
      bump('workOrders', 'skipped')
      log(`  ⚠ ${woNumber} skipped: ${(err as Error).message}`)
    }
  }
  const c = counters.workOrders ?? { created: 0, updated: 0, skipped: 0 }
  log(`  ✓ WorkOrders done — created=${c.created} updated=${c.updated} skipped=${c.skipped}`)
}

// ── 3. Stock Items ──────────────────────────────────────────────────────────
async function seedStockItems() {
  log('\n────────────────────────────────────────────────────────────────')
  log('[3/6] Stock Items — target: 30 (DEMO-STK-001 … DEMO-STK-030)')
  log('────────────────────────────────────────────────────────────────')
  type Template = {
    productName: string
    category: string
    brand: string
    model: string
    quantity: number
    minQuantity: number
    maxQuantity: number
    unitCost: number
    siteCode: string
  }
  const TEMPLATES: Template[] = [
    // DRUM (5)
    { productName: 'Drum Unit Brother DR-235', category: 'DRUM', brand: 'Brother', model: 'DR-235', quantity: 8, minQuantity: 2, maxQuantity: 20, unitCost: 1500, siteCode: 'UDH' },
    { productName: 'Drum Unit HP 32A', category: 'DRUM', brand: 'HP', model: 'CF232A', quantity: 4, minQuantity: 2, maxQuantity: 15, unitCost: 3200, siteCode: 'UDH' },
    { productName: 'Drum Unit Canon C-EXV 41', category: 'DRUM', brand: 'Canon', model: 'C-EXV 41', quantity: 1, minQuantity: 2, maxQuantity: 12, unitCost: 2800, siteCode: 'NKP' },
    { productName: 'Drum Unit KYOCERA MK-1154', category: 'DRUM', brand: 'KYOCERA', model: 'MK-1154', quantity: 6, minQuantity: 2, maxQuantity: 18, unitCost: 2200, siteCode: 'MECUD' },
    { productName: 'Drum Unit Ricoh D048', category: 'DRUM', brand: 'Ricoh', model: 'D048', quantity: 3, minQuantity: 1, maxQuantity: 10, unitCost: 2500, siteCode: 'PPIT' },
    // INK (7)
    { productName: 'หมึกพิมพ์ดำ EPSON T544 (ขวด)', category: 'INK', brand: 'Epson', model: 'T544120', quantity: 12, minQuantity: 3, maxQuantity: 30, unitCost: 800, siteCode: 'UDH' },
    { productName: 'หมึกพิมพ์สี EPSON T544 (ขวด)', category: 'INK', brand: 'Epson', model: 'T544CMY', quantity: 8, minQuantity: 2, maxQuantity: 24, unitCost: 900, siteCode: 'UDH' },
    { productName: 'หมึกพิมพ์ดำ Canon GI-90 (ขวด)', category: 'INK', brand: 'Canon', model: 'GI-90BK', quantity: 5, minQuantity: 2, maxQuantity: 20, unitCost: 750, siteCode: 'NKP' },
    { productName: 'หมึกพิมพ์สี Canon GI-90 (ขวด)', category: 'INK', brand: 'Canon', model: 'GI-90C', quantity: 2, minQuantity: 2, maxQuantity: 18, unitCost: 850, siteCode: 'NKP' },
    { productName: 'หมึกพิมพ์ดำ Brother BT6000 (ขวด)', category: 'INK', brand: 'Brother', model: 'BT6000BK', quantity: 7, minQuantity: 2, maxQuantity: 22, unitCost: 780, siteCode: 'MECUD' },
    { productName: 'หมึกพิมพ์สี Brother BT6000 (ขวด)', category: 'INK', brand: 'Brother', model: 'BT6000C', quantity: 4, minQuantity: 2, maxQuantity: 20, unitCost: 820, siteCode: 'MECUD' },
    { productName: 'หมึกพิมพ์ดำ HP GT52 (ขวด)', category: 'INK', brand: 'HP', model: 'GT52XL', quantity: 0, minQuantity: 2, maxQuantity: 15, unitCost: 880, siteCode: 'PPIT' },
    // TONER (8)
    { productName: 'ตลับหมึก HP 85A Black', category: 'TONER', brand: 'HP', model: 'CF285A', quantity: 2, minQuantity: 5, maxQuantity: 25, unitCost: 1800, siteCode: 'UDH' },
    { productName: 'ตลับหมึก Canon C-EXV 41 Black', category: 'TONER', brand: 'Canon', model: 'C-EXV 41', quantity: 15, minQuantity: 5, maxQuantity: 40, unitCost: 2500, siteCode: 'UDH' },
    { productName: 'ตลับหมึก Brother TN-2320 Black', category: 'TONER', brand: 'Brother', model: 'TN-2320', quantity: 10, minQuantity: 3, maxQuantity: 30, unitCost: 1600, siteCode: 'NKP' },
    { productName: 'ตลับหมึก Epson S T03', category: 'TONER', brand: 'Epson', model: 'T0341', quantity: 0, minQuantity: 3, maxQuantity: 20, unitCost: 900, siteCode: 'NKP' },
    { productName: 'ตลับหมึก KYOCERA TK-1154', category: 'TONER', brand: 'KYOCERA', model: 'TK-1154', quantity: 6, minQuantity: 2, maxQuantity: 18, unitCost: 2100, siteCode: 'MECUD' },
    { productName: 'ตลับหมึก Ricoh D048', category: 'TONER', brand: 'Ricoh', model: 'D048', quantity: 4, minQuantity: 2, maxQuantity: 15, unitCost: 2300, siteCode: 'MECUD' },
    { productName: 'ตลับหมึก HP 26A Black', category: 'TONER', brand: 'HP', model: 'CF226A', quantity: 9, minQuantity: 3, maxQuantity: 25, unitCost: 2200, siteCode: 'PPIT' },
    { productName: 'ตลับหมึก Canon 052 Black', category: 'TONER', brand: 'Canon', model: 'C-EXV 52', quantity: 1, minQuantity: 3, maxQuantity: 20, unitCost: 1900, siteCode: 'PPIT' },
    // SPARE_PART (6)
    { productName: 'ฟิลม์ฟิวเซอร์ HP M404', category: 'SPARE_PART', brand: 'HP', model: 'RM2-5452', quantity: 5, minQuantity: 2, maxQuantity: 15, unitCost: 500, siteCode: 'UDH' },
    { productName: 'Pickup Roller Canon LBP2900', category: 'SPARE_PART', brand: 'Canon', model: 'RK-810', quantity: 3, minQuantity: 1, maxQuantity: 10, unitCost: 350, siteCode: 'NKP' },
    { productName: 'Pressure Roller Brother HL', category: 'SPARE_PART', brand: 'Brother', model: 'PR-HL2350', quantity: 4, minQuantity: 1, maxQuantity: 8, unitCost: 420, siteCode: 'MECUD' },
    { productName: 'Fuser Unit KYOCERA P2235', category: 'SPARE_PART', brand: 'KYOCERA', model: 'FU-P2235', quantity: 2, minQuantity: 1, maxQuantity: 6, unitCost: 2800, siteCode: 'PPIT' },
    { productName: 'Transfer Belt Ricoh MP2014', category: 'SPARE_PART', brand: 'Ricoh', model: 'TB-MP2014', quantity: 1, minQuantity: 1, maxQuantity: 5, unitCost: 3500, siteCode: 'UDH' },
    { productName: 'หมึก Low Stock Demo', category: 'SPARE_PART', brand: 'Epson', model: 'DEMO-LOW', quantity: 1, minQuantity: 3, maxQuantity: 15, unitCost: 800, siteCode: 'UDH' },
    // OTHER (4)
    { productName: 'กระดาษ A4 80gsm Double A', category: 'OTHER', brand: 'Double A', model: 'A4-80', quantity: 50, minQuantity: 10, maxQuantity: 200, unitCost: 100, siteCode: 'UDH' },
    { productName: 'สาย USB Type-B 1.5m', category: 'OTHER', brand: 'Belkin', model: 'USB-B-1.5', quantity: 12, minQuantity: 4, maxQuantity: 30, unitCost: 120, siteCode: 'NKP' },
    { productName: 'สาย Power C13 1.8m', category: 'OTHER', brand: 'APC', model: 'PWR-C13', quantity: 8, minQuantity: 3, maxQuantity: 25, unitCost: 90, siteCode: 'MECUD' },
    { productName: 'Sensor Cleaning Kit', category: 'OTHER', brand: 'Fujitsu', model: 'PA03642-001', quantity: 2, minQuantity: 2, maxQuantity: 10, unitCost: 450, siteCode: 'PPIT' },
  ]
  // sanity: templates length must be 30
  if (TEMPLATES.length !== 30) {
    log(`  ⚠ WARNING: TEMPLATES length is ${TEMPLATES.length}, expected 30`)
  }
  for (let i = 0; i < TEMPLATES.length; i++) {
    const t = TEMPLATES[i]
    const seq = String(i + 1).padStart(3, '0')
    const productCode = `DEMO-STK-${seq}`
    const totalValue = t.quantity * t.unitCost
    const siteName = SITES.find((s) => s.code === t.siteCode)?.name ?? t.siteCode
    try {
      const before = await db.stockItem.findUnique({ where: { productCode } })
      const data = {
        productName: t.productName,
        category: t.category,
        brand: t.brand,
        model: t.model,
        quantity: t.quantity,
        minQuantity: t.minQuantity,
        maxQuantity: t.maxQuantity,
        unitCost: t.unitCost,
        totalValue,
        unit: 'ชิ้น',
        site: siteName,
        active: true,
        isDemo: true,
      }
      if (before) {
        await db.stockItem.update({ where: { productCode }, data })
        bump('stockItems', 'updated')
      } else {
        await db.stockItem.create({ data: { productCode, ...data } })
        bump('stockItems', 'created')
      }
      if ((i + 1) % 10 === 0) log(`  • ${productCode} processed (${i + 1}/30)`)
    } catch (err) {
      bump('stockItems', 'skipped')
      log(`  ⚠ ${productCode} skipped: ${(err as Error).message}`)
    }
  }
  const c = counters.stockItems ?? { created: 0, updated: 0, skipped: 0 }
  log(`  ✓ StockItems done — created=${c.created} updated=${c.updated} skipped=${c.skipped}`)
}

// ── 4. Meter Readings ────────────────────────────────────────────────────────
async function seedMeterReadings() {
  log('\n────────────────────────────────────────────────────────────────')
  log('[4/6] Meter Readings — target: ~100 (months 2026-08 + 2026-09)')
  log('────────────────────────────────────────────────────────────────')
  // Use DEMO-DEV-* devices that have meterRequired=true (we seeded them in step 1).
  // For each device: create 1 reading for 2026-09 (current month).
  // For ~30 devices, also create a reading for 2026-08 (previous month).
  const demoDevices = await db.device.findMany({
    where: { isDemo: true, meterRequired: true },
    select: { id: true, assetCode: true, lastMeterBw: true, lastMeterColor: true, meterMode: true, site: true },
    orderBy: { assetCode: 'asc' },
  })
  log(`  • Found ${demoDevices.length} metered demo devices`)

  const MONTHS = [
    { month: '2026-09', day: 15 },
    { month: '2026-08', day: 14 },
  ]

  let total = 0
  let processedIndex = 0
  for (const d of demoDevices) {
    // Create readings for 2026-09 always, plus 2026-08 for every 3rd device
    // (gives ~33% with two months, total ~1.33 × device count = ~100 for ~75 metered devices).
    for (let mi = 0; mi < MONTHS.length; mi++) {
      if (mi === 1 && processedIndex % 3 !== 0) continue // only 1/3 get a 2nd reading
      const { month, day } = MONTHS[mi]
      // Idempotency: skip if a reading already exists for (device, month, MONTHLY type)
      const existing = await db.meterReading.findFirst({
        where: { deviceId: d.id, readingMonth: month, readingType: 'MONTHLY' },
        select: { id: true },
      })
      if (existing) {
        bump('meterReadings', 'skipped')
        continue
      }

      // Reverse-engineer plausible meter values from device.lastMeterBw/Color.
      // For 2026-09 (current month): meter = lastMeter.
      // For 2026-08 (previous month): meter = lastMeter - random delta (smaller).
      const isCurrent = mi === 0
      const deltaBw = isCurrent ? 0 : randInt(200, 1500)
      const deltaColor = isCurrent ? 0 : randInt(50, 600)
      const meterBw = Math.max(0, d.lastMeterBw - deltaBw)
      const meterColor = Math.max(0, d.lastMeterColor - deltaColor)
      // pagesBw/Color = delta from previous reading (set to ~80% of delta for realism)
      const pagesBw = isCurrent ? randInt(100, 1500) : deltaBw - randInt(0, Math.floor(deltaBw * 0.2))
      const pagesColor =
        d.meterMode === 'BW_COLOR' ? (isCurrent ? randInt(20, 400) : deltaColor - randInt(0, Math.floor(deltaColor * 0.2))) : 0

      const readingDate = `${month}-${String(day).padStart(2, '0')}`
      const readBy = 'demo_admin@itam.demo'
      try {
        await db.meterReading.create({
          data: {
            deviceId: d.id,
            assetCode: d.assetCode,
            readingDate,
            readingMonth: month,
            meterBw,
            meterColor,
            pagesBw,
            pagesColor,
            prevMeterBw: meterBw - pagesBw < 0 ? 0 : meterBw - pagesBw,
            prevMeterColor: meterColor - pagesColor < 0 ? 0 : meterColor - pagesColor,
            meterMode: d.meterMode,
            readingType: 'MONTHLY',
            readBy,
            siteAtReading: d.site,
            isDemo: true,
          },
        })
        bump('meterReadings', 'created')
        total++
      } catch (err) {
        bump('meterReadings', 'skipped')
        // Log only first 3 errors to avoid spam
        if (counters.meterReadings.skipped <= 3) {
          log(`  ⚠ meter reading skip for ${d.assetCode}/${month}: ${(err as Error).message}`)
        }
      }
    }
    processedIndex++
    if (processedIndex % 25 === 0) log(`  • Processed ${processedIndex}/${demoDevices.length} devices (total readings: ${total})`)
  }
  const c = counters.meterReadings ?? { created: 0, updated: 0, skipped: 0 }
  log(`  ✓ MeterReadings done — created=${c.created} skipped=${c.skipped} (total now in DB)`)
}

// ── 5. PM Schedules ─────────────────────────────────────────────────────────
async function seedPMSchedules() {
  log('\n────────────────────────────────────────────────────────────────')
  log('[5/6] PM Schedules — target: 5 new (PENDING + COMPLETED mix)')
  log('────────────────────────────────────────────────────────────────')
  // Pick 5 distinct demo devices (mix of printer types) — avoid the device
  // already used by the existing single demo PM schedule.
  const candidates = await db.device.findMany({
    where: { isDemo: true, type: { in: ['PRINTER LASER', 'PRINTER INKJET', 'PRINTER THERMAL'] } },
    select: { id: true, assetCode: true, brand: true, model: true, site: true },
    orderBy: { assetCode: 'asc' },
    take: 30, // grab enough variety then slice
  })
  if (candidates.length < 5) {
    log(`  ⚠ Only ${candidates.length} candidate demo devices — skipping PM seeding`)
    return
  }
  // Choose 5 spread across the list (deterministic).
  const chosen = [0, 5, 11, 18, 24].map((i) => candidates[i % candidates.length])
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const addDays = (n: number) => {
    const d = new Date(today)
    d.setDate(d.getDate() + n)
    return iso(d)
  }
  // Two future (PENDING), three past (COMPLETED via execution record)
  const plan: Array<{
    scheduleNo: string
    title: string
    description: string
    frequency: string
    nextRunDate: string
    lastRunDate: string | null
    status: 'PENDING' | 'COMPLETED'
  }> = [
    {
      scheduleNo: 'DEMO-PM-001',
      title: 'PM รายเดือน — เครื่องพิมพ์เลเซอร์',
      description: 'ทำความสะอาด roller + ตรวจสอบฟิวเซอร์ + ตรวจสอบคุณภาพการพิมพ์',
      frequency: 'monthly',
      nextRunDate: addDays(7),
      lastRunDate: null,
      status: 'PENDING',
    },
    {
      scheduleNo: 'DEMO-PM-002',
      title: 'PM รายไตรมาส — เครื่องพิมพ์อิงค์เจ็ท',
      description: 'เช็คหัวพิมพ์ + ทำความสะอาด print head + ตรวจสอบระบบหมึก',
      frequency: 'quarterly',
      nextRunDate: addDays(30),
      lastRunDate: null,
      status: 'PENDING',
    },
    {
      scheduleNo: 'DEMO-PM-003',
      title: 'PM รายเดือน — เครื่องพิมพ์เทอร์มัล',
      description: 'ทำความสะอาดหัวพิมพ์เทอร์มัล + ตรวจสอบ cutter',
      frequency: 'monthly',
      nextRunDate: addDays(-7),
      lastRunDate: addDays(-7),
      status: 'COMPLETED',
    },
    {
      scheduleNo: 'DEMO-PM-004',
      title: 'PM รายไตรมาส — เครื่องพิมพ์เลเซอร์',
      description: 'เปลี่ยน drum unit + ตรวจสอบ fuser film',
      frequency: 'quarterly',
      nextRunDate: addDays(-30),
      lastRunDate: addDays(-30),
      status: 'COMPLETED',
    },
    {
      scheduleNo: 'DEMO-PM-005',
      title: 'PM รายเดือน — เครื่องพิมพ์อิงค์เจ็ท',
      description: 'เช็คหัวพิมพ์ + ตรวจสอบการไหลของหมึก',
      frequency: 'monthly',
      nextRunDate: addDays(-60),
      lastRunDate: addDays(-60),
      status: 'COMPLETED',
    },
  ]

  for (let i = 0; i < chosen.length; i++) {
    const dev = chosen[i]
    const p = plan[i]
    try {
      const before = await db.pMSchedule.findUnique({ where: { scheduleNo: p.scheduleNo } })
      const data = {
        title: `${p.title} (${dev.assetCode})`,
        description: p.description,
        frequency: p.frequency,
        nextRunDate: p.nextRunDate,
        lastRunDate: p.lastRunDate,
        active: true,
        isDemo: true,
        deviceId: dev.id,
        site: dev.site,
        assignedTo: 'demo_admin@itam.demo',
        createdBy: 'demo_admin@itam.demo',
      }
      let scheduleId: string
      if (before) {
        const updated = await db.pMSchedule.update({ where: { scheduleNo: p.scheduleNo }, data })
        scheduleId = updated.id
        bump('pmSchedules', 'updated')
      } else {
        const created = await db.pMSchedule.create({ data: { scheduleNo: p.scheduleNo, ...data } })
        scheduleId = created.id
        bump('pmSchedules', 'created')
      }
      // Create PMExecution record for COMPLETED items (idempotent: check by scheduleId + scheduledDate)
      if (p.status === 'COMPLETED') {
        const existingExec = await db.pMExecution.findFirst({
          where: { scheduleId, scheduledDate: p.lastRunDate! },
          select: { id: true },
        })
        if (!existingExec) {
          await db.pMExecution.create({
            data: {
              scheduleId,
              scheduledDate: p.lastRunDate!,
              executedDate: p.lastRunDate!,
              status: 'COMPLETED',
              performedBy: 'demo_admin@itam.demo',
              remark: 'PM เสร็จสมบูรณ์ตาม checklist (demo)',
              isDemo: true,
            },
          })
          bump('pmExecutions', 'created')
        } else {
          bump('pmExecutions', 'skipped')
        }
      } else {
        // PENDING: create a PENDING execution for the upcoming scheduledDate
        const existingExec = await db.pMExecution.findFirst({
          where: { scheduleId, scheduledDate: p.nextRunDate },
          select: { id: true },
        })
        if (!existingExec) {
          await db.pMExecution.create({
            data: {
              scheduleId,
              scheduledDate: p.nextRunDate,
              status: 'PENDING',
              remark: 'รอดำเนินการ PM (demo)',
              isDemo: true,
            },
          })
          bump('pmExecutions', 'created')
        } else {
          bump('pmExecutions', 'skipped')
        }
      }
      log(`  • ${p.scheduleNo} processed (${i + 1}/5)`)
    } catch (err) {
      bump('pmSchedules', 'skipped')
      log(`  ⚠ ${p.scheduleNo} skipped: ${(err as Error).message}`)
    }
  }
  const c = counters.pmSchedules ?? { created: 0, updated: 0, skipped: 0 }
  log(`  ✓ PMSchedules done — created=${c.created} updated=${c.updated} skipped=${c.skipped}`)
}

// ── 6. SiteAttribute PPIT isDemo ────────────────────────────────────────────
async function seedSiteAttributes() {
  log('\n────────────────────────────────────────────────────────────────')
  log('[6/6] SiteAttribute — mark PPIT as isDemo=true')
  log('────────────────────────────────────────────────────────────────')
  // Iterate all 4 sites to report current state; update PPIT to isDemo=true.
  const allSites = await db.siteAttribute.findMany({
    select: { id: true, SiteCode: true, SiteName: true, isDemo: true },
  })
  for (const s of allSites) {
    if (s.SiteCode === 'PPIT') {
      if (s.isDemo) {
        log(`  • ${s.SiteCode} (${s.SiteName}) already isDemo=true — skip`)
        bump('siteAttributes', 'skipped')
      } else {
        await db.siteAttribute.update({ where: { id: s.id }, data: { isDemo: true } })
        log(`  • ${s.SiteCode} (${s.SiteName}) updated → isDemo=true`)
        bump('siteAttributes', 'updated')
      }
    } else {
      log(`  • ${s.SiteCode} (${s.SiteName}) isDemo=${s.isDemo} (unchanged — real site)`)
    }
  }
  const c = counters.siteAttributes ?? { created: 0, updated: 0, skipped: 0 }
  log(`  ✓ SiteAttributes done — updated=${c.updated} skipped=${c.skipped}`)
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  log('══════════════════════════════════════════════════════════════════')
  log('  EXPAND DEMO DATA — idempotent seed for richer demo experience')
  log('══════════════════════════════════════════════════════════════════')
  const t0 = Date.now()

  // Pre-flight: log current state
  log('\nPre-flight — current demo data counts:')
  const [d, w, s, mr, pm, sa] = await Promise.all([
    db.device.count({ where: { isDemo: true } }),
    db.workOrder.count({ where: { isDemo: true } }),
    db.stockItem.count({ where: { isDemo: true } }),
    db.meterReading.count({ where: { isDemo: true } }),
    db.pMSchedule.count({ where: { isDemo: true } }),
    db.siteAttribute.count({ where: { isDemo: true } }),
  ])
  log(`  Devices=${d}  WorkOrders=${w}  StockItems=${s}  MeterReadings=${mr}  PMSchedules=${pm}  SiteAttributes=${sa}`)

  await seedDevices()
  await seedWorkOrders()
  await seedStockItems()
  await seedMeterReadings()
  await seedPMSchedules()
  await seedSiteAttributes()

  // Post-run verification
  log('\n────────────────────────────────────────────────────────────────')
  log('Post-run verification — final demo data counts:')
  log('────────────────────────────────────────────────────────────────')
  const [d2, w2, s2, mr2, pm2, sa2, pe2] = await Promise.all([
    db.device.count({ where: { isDemo: true } }),
    db.workOrder.count({ where: { isDemo: true } }),
    db.stockItem.count({ where: { isDemo: true } }),
    db.meterReading.count({ where: { isDemo: true } }),
    db.pMSchedule.count({ where: { isDemo: true } }),
    db.siteAttribute.count({ where: { isDemo: true } }),
    db.pMExecution.count({ where: { isDemo: true } }),
  ])
  log(`  Devices=${d2}  WorkOrders=${w2}  StockItems=${s2}  MeterReadings=${mr2}`)
  log(`  PMSchedules=${pm2}  PMExecutions=${pe2}  SiteAttributes=${sa2}`)

  // Summary table
  log('\n══════════════════════════════════════════════════════════════════')
  log('  SUMMARY — created / updated / skipped per model')
  log('══════════════════════════════════════════════════════════════════')
  const modelOrder = [
    'devices',
    'workOrders',
    'stockItems',
    'meterReadings',
    'pmSchedules',
    'pmExecutions',
    'siteAttributes',
  ]
  for (const m of modelOrder) {
    const c = counters[m] ?? { created: 0, updated: 0, skipped: 0 }
    log(`  ${m.padEnd(18)} created=${c.created}  updated=${c.updated}  skipped=${c.skipped}`)
  }
  log(`\nCompleted in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  await db.$disconnect()
}

main().catch(async (e) => {
  console.error('❌ expand-demo-data failed:', e)
  await db.$disconnect()
  process.exit(1)
})
