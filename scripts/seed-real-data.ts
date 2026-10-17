/**
 * seed-real-data.ts — Seed REAL (isDemo=false) baseline data for the admin login.
 *
 * Context (QA-ROUND-2026-09-16-C): after the sandbox restore, the DB only had
 * DEMO data (isDemo=true). Demo isolation (src/lib/demo-mode.ts) means real
 * users (admin/test1234) see ONLY isDemo=false rows → admin saw an empty
 * system (0 devices, 0 WOs, 0 sites). This seed fills the real side with a
 * realistic Thai hospital-network dataset so both login paths are useful:
 *
 *   1. SiteAttribute (real): UDH (อุดรธานี HQ), NKP (นครพนม), KKN (ขอนแก่น)
 *      — distinct paper rates per site (verifiable per-site cost math).
 *   2. MasterItem Department rows (real) — แผนกที่ใช้งานจริงในโรงพยาบาล.
 *   3. Devices (real): 12 units — printers/copiers/scanners/computers across
 *      3 sites, Thai departments, buildings/floors, warranty, meter config.
 *   4. Work orders (real): 10 across all statuses/priorities, linked to devices.
 *   5. Meter readings (real): 6 months for every metered device.
 *
 * Idempotent — safe to re-run (checks existing rows before create).
 * Usage: bun scripts/seed-real-data.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

// ── 1. Real sites (hospital network) ─────────────────────────────────────────
const SITES = [
  {
    SiteCode: 'UDH',
    SiteName: 'โรงพยาบาลศูนย์อุดรธานี',
    PaperRateBW: 0.5,
    PaperRateColor: 3.0,
    Hotline: '042-221-111',
  },
  {
    SiteCode: 'NKP',
    SiteName: 'โรงพยาบาลนครพนม',
    PaperRateBW: 0.45,
    PaperRateColor: 2.8,
    Hotline: '042-511-222',
  },
  {
    SiteCode: 'KKN',
    SiteName: 'โรงพยาบาลขอนแก่น',
    PaperRateBW: 0.55,
    PaperRateColor: 3.2,
    Hotline: '043-333-333',
  },
]

// ── 2. Real departments (MasterItem) ─────────────────────────────────────────
const DEPARTMENTS = [
  { code: 'DEP-PHA', label: 'แผนกเภสัชกรรม' },
  { code: 'DEP-MR', label: 'แผนกเวชระเบียง' },
  { code: 'DEP-OPD', label: 'แผนกตารวจ (OPD)' },
  { code: 'DEP-FIN', label: 'แผนกการเงินและบัญชี' },
  { code: 'DEP-IT', label: 'แผนกเทคโนโลยีสารสนเทศ' },
  { code: 'DEP-LAB', label: 'แผนกห้องปฏิบัติการทางการแพทย์' },
]

// ── 3. Real devices ──────────────────────────────────────────────────────────
// assetCode convention: <SITE>-<TYPE>-<YEAR>-<SEQ>
const DEVICES = [
  { assetCode: 'UDH-PRN-2023-001', name: 'เครื่องพิมพ์เลเซอร์ Canon LBP-2900', type: 'PRINTER', brand: 'Canon', model: 'LBP-2900', status: 'active', site: 'UDH', serialNumber: 'UDH-PRN-001-SN', department: 'แผนกเภสัชกรรม', departmentCode: 'DEP-PHA', building: 'อาคารผู้ป่วยนอก', floor: 'ชั้น 1', room: 'ห้องจ่ายยา 1', meterRequired: true, meterMode: 'BW_COLOR', purchaseDate: '2023-03-15', purchasePrice: 5900, warrantyMonths: 24, vendor: 'สยามออฟฟิศ', ip: '10.4.1.21' },
  { assetCode: 'UDH-PRN-2023-002', name: 'เครื่องพิมพ์ HP LaserJet Pro M404dn', type: 'PRINTER', brand: 'HP', model: 'LaserJet Pro M404dn', status: 'active', site: 'UDH', serialNumber: 'UDH-PRN-002-SN', department: 'แผนกเวชระเบียง', departmentCode: 'DEP-MR', building: 'อาคารบริการ 1', floor: 'ชั้น 2', room: 'ห้องเวชระเบียง', meterRequired: true, meterMode: 'BW_COLOR', purchaseDate: '2023-06-20', purchasePrice: 9200, warrantyMonths: 24, vendor: 'คอมเทค', ip: '10.4.1.34' },
  { assetCode: 'UDH-CPY-2024-001', name: 'เครื่องถ่ายเอกสาร Ricoh MP 2014AD', type: 'COPIER', brand: 'Ricoh', model: 'MP 2014AD', status: 'active', site: 'UDH', serialNumber: 'UDH-CPY-001-SN', department: 'แผนกตารวจ (OPD)', departmentCode: 'DEP-OPD', building: 'อาคารผู้ป่วยนอก', floor: 'ชั้น 1', room: 'จุดลงทะเบียน OPD', meterRequired: true, meterMode: 'BW_COLOR', purchaseDate: '2024-01-10', purchasePrice: 38500, warrantyMonths: 36, vendor: 'ริโก้ไทยแลนด์', ip: '10.4.1.50' },
  { assetCode: 'UDH-CPY-2024-002', name: 'เครื่องถ่ายเอกสาร Sharp AR-6020', type: 'COPIER', brand: 'Sharp', model: 'AR-6020', status: 'active', site: 'UDH', serialNumber: 'UDH-CPY-002-SN', department: 'แผนกการเงินและบัญชี', departmentCode: 'DEP-FIN', building: 'อาคารบริหาร', floor: 'ชั้น 3', room: 'ห้องการเงิน', meterRequired: true, meterMode: 'BW_COLOR', purchaseDate: '2024-04-05', purchasePrice: 32000, warrantyMonths: 36, vendor: 'ชาร์ปไทย', ip: '10.4.2.11' },
  { assetCode: 'UDH-SCN-2023-001', name: 'สแกนเนอร์ Fujitsu ScanSnap iX1600', type: 'SCANNER', brand: 'Fujitsu', model: 'ScanSnap iX1600', status: 'active', site: 'UDH', serialNumber: 'UDH-SCN-001-SN', department: 'แผนกเวชระเบียง', departmentCode: 'DEP-MR', building: 'อาคารบริการ 1', floor: 'ชั้น 2', room: 'ห้องสแกนเอกสาร', meterRequired: false, purchaseDate: '2023-09-12', purchasePrice: 14500, warrantyMonths: 12, vendor: 'ฟูจิตสึ' },
  { assetCode: 'UDH-PC-2024-001', name: 'เครื่องคอมพิวเตอร์ Dell OptiPlex 7010', type: 'COMPUTER', brand: 'Dell', model: 'OptiPlex 7010', status: 'active', site: 'UDH', serialNumber: 'UDH-PC-001-SN', department: 'แผนกเทคโนโลยีสารสนเทศ', departmentCode: 'DEP-IT', building: 'อาคารบริหาร', floor: 'ชั้น 1', room: 'ห้อง IT', meterRequired: false, purchaseDate: '2024-02-18', purchasePrice: 27500, warrantyMonths: 36, vendor: 'เดลล์ ไทยแลนด์', ip: '10.4.3.5' },
  { assetCode: 'UDH-PRN-2022-001', name: 'เครื่องพิมพ์ Epson EcoTank L3210', type: 'PRINTER', brand: 'Epson', model: 'EcoTank L3210', status: 'repair', site: 'UDH', serialNumber: 'UDH-PRN-003-SN', department: 'แผนกห้องปฏิบัติการทางการแพทย์', departmentCode: 'DEP-LAB', building: 'อาคารบริการ 2', floor: 'ชั้น 1', room: 'ห้องแล็บ', meterRequired: true, meterMode: 'BW_COLOR', purchaseDate: '2022-08-01', purchasePrice: 4600, warrantyMonths: 12, vendor: 'อีปซอน' },
  { assetCode: 'UDH-PRN-2021-001', name: 'เครื่องพิมพ์ Brother HL-1110', type: 'PRINTER', brand: 'Brother', model: 'HL-1110', status: 'spare', site: 'UDH', serialNumber: 'UDH-PRN-004-SN', department: 'แผนกเทคโนโลยีสารสนเทศ', departmentCode: 'DEP-IT', building: 'อาคารบริหาร', floor: 'ชั้น 1', room: 'คลังอุปกรณ์', meterRequired: false, purchaseDate: '2021-05-20', purchasePrice: 3200, warrantyMonths: 12, vendor: 'บราเดอร์' },
  { assetCode: 'NKP-PRN-2023-001', name: 'เครื่องพิมพ์ Canon imageCLASS MF445', type: 'PRINTER', brand: 'Canon', model: 'imageCLASS MF445', status: 'active', site: 'NKP', serialNumber: 'NKP-PRN-001-SN', department: 'แผนกเภสัชกรรม', departmentCode: 'DEP-PHA', building: 'อาคารผู้ป่วยนอก', floor: 'ชั้น 1', room: 'ห้องจ่ายยา', meterRequired: true, meterMode: 'BW_COLOR', purchaseDate: '2023-11-02', purchasePrice: 11800, warrantyMonths: 24, vendor: 'สยามออฟฟิศ', ip: '10.5.1.15' },
  { assetCode: 'NKP-CPY-2024-001', name: 'เครื่องถ่ายเอกสาร Konica Minolta bizhub 225i', type: 'COPIER', brand: 'Konica Minolta', model: 'bizhub 225i', status: 'active', site: 'NKP', serialNumber: 'NKP-CPY-001-SN', department: 'แผนกตารวจ (OPD)', departmentCode: 'DEP-OPD', building: 'อาคารบริการ', floor: 'ชั้น 2', room: 'จุดรอคอย', meterRequired: true, meterMode: 'BW_COLOR', purchaseDate: '2024-03-25', purchasePrice: 45000, warrantyMonths: 36, vendor: 'โคนิก้า', ip: '10.5.1.30' },
  { assetCode: 'KKN-PRN-2023-001', name: 'เครื่องพิมพ์ HP LaserJet M141w', type: 'PRINTER', brand: 'HP', model: 'LaserJet M141w', status: 'active', site: 'KKN', serialNumber: 'KKN-PRN-001-SN', department: 'แผนกการเงินและบัญชี', departmentCode: 'DEP-FIN', building: 'อาคารบริหาร', floor: 'ชั้น 2', room: 'ห้องบัญชี', meterRequired: true, meterMode: 'BW_COLOR', purchaseDate: '2023-07-14', purchasePrice: 7900, warrantyMonths: 24, vendor: 'คอมเทค', ip: '10.6.1.8' },
  { assetCode: 'KKN-CPY-2022-001', name: 'เครื่องถ่ายเอกสาร Toshiba e-STUDIO 2309A', type: 'COPIER', brand: 'Toshiba', model: 'e-STUDIO 2309A', status: 'active', site: 'KKN', serialNumber: 'KKN-CPY-001-SN', department: 'แผนกห้องปฏิบัติการทางการแพทย์', departmentCode: 'DEP-LAB', building: 'อาคารบริการ 1', floor: 'ชั้น 3', room: 'ห้องแล็บกลาง', meterRequired: true, meterMode: 'BW_COLOR', purchaseDate: '2022-12-01', purchasePrice: 41000, warrantyMonths: 36, vendor: 'โตชิบา', ip: '10.6.2.20' },
]

// ── 4. Real work orders ──────────────────────────────────────────────────────
// deviceRef links to DEVICES[].assetCode; status/priority cover the full matrix.
const WORK_ORDERS = [
  { subject: 'เครื่องพิมพ์ห้องจ่ายยา 1 พิมพ์ไม่ออก', deviceRef: 'UDH-PRN-2023-001', status: 'PENDING', priority: 'ด่วน', reporterName: 'คุณสมพร ใจดี', tel: '081-111-2233', building: 'อาคารผู้ป่วยนอก', location: 'ห้องจ่ายยา 1', details: 'เปิดสวิตช์แล้วไฟไม่ติด กลิ่นเหม็นเผาไหม้เล็กน้อย' },
  { subject: 'กระดาษติดบ่อยที่จุดลงทะเบียน OPD', deviceRef: 'UDH-CPY-2024-001', status: 'PENDING', priority: 'ปกติ', reporterName: 'คุณมาลี รักงาน', tel: '082-222-3344', building: 'อาคารผู้ป่วยนอก', location: 'จุดลงทะเบียน OPD', details: 'เครื่องดึงกระดาษหลายแผ่นพร้อมกันทุกครั้ง' },
  { subject: 'เครื่องถ่ายเอกสารห้องการเงิน ขาดหมึก', deviceRef: 'UDH-CPY-2024-002', status: 'IN_PROGRESS', priority: 'ด่วน', reporterName: 'คุณวิชัย มั่นคง', tel: '083-333-4455', building: 'อาคารบริหาร', location: 'ห้องการเงิน', details: 'แจ้งขอเปลี่ยนตลับหมึก ต้องใช้ดำพิเศษ' },
  { subject: 'สแกนเนอร์เชื่อมต่อคอมไม่ได้', deviceRef: 'UDH-SCN-2023-001', status: 'IN_PROGRESS', priority: 'ปานกลาง', reporterName: 'คุณปิยะ ตั้งใจ', tel: '084-444-5566', building: 'อาคารบริการ 1', location: 'ห้องสแกนเอกสาร', details: 'USB ไม่รู้จักเครื่อง ลองเปลี่ยนสายแล้ว' },
  { subject: 'เครื่องพิมพ์แล็บส่งซ่อม รออะไหล่หัวพิมพ์', deviceRef: 'UDH-PRN-2022-001', status: 'WAITING_PARTS', priority: 'ปานกลาง', reporterName: 'คุณอรุณี สุขใจ', tel: '085-555-6677', building: 'อาคารบริการ 2', location: 'ห้องแล็บ', details: 'หัวพิมพ์ตัน สั่งอะไหล่รอส่งจากกรุงเทพฯ' },
  { subject: 'ปรับปรุงเฟิร์มแวร์เครื่อง bizhub', deviceRef: 'NKP-CPY-2024-001', status: 'WAITING_PARTS', priority: 'ปกติ', reporterName: 'คุณธนกร ใฝ่รู้', tel: '086-666-7788', building: 'อาคารบริการ', location: 'จุดรอคอย', details: 'รอทีมช่างของโคนิก้ามาอัปเดตเฟิร์มแวร์' },
  { subject: 'เปลี่ยนตลับหมึก M141w เรียบร้อย', deviceRef: 'KKN-PRN-2023-001', status: 'COMPLETED', priority: 'ปกติ', reporterName: 'คุณกิตติ เก่งงาน', tel: '087-777-8899', building: 'อาคารบริหาร', location: 'ห้องบัญชี', details: 'เปลี่ยนตลับหมึกและทำความสะอาดแล้ว ใช้งานได้ปกติ', resolution: 'เปลี่ยน HP 105A และทำความสะอาด roller' },
  { subject: 'ซ่อม e-STUDIO จอแสดงผล', deviceRef: 'KKN-CPY-2022-001', status: 'COMPLETED', priority: 'ด่วนมาก', reporterName: 'คุณนภา ใจเย็น', tel: '088-888-9900', building: 'อาคารบริการ 1', location: 'ห้องแล็บกลาง', details: 'จอสั่นและเป็นเส้น มองเห็นยาก', resolution: 'เปลี่ยนสายแพนเนลและจัดตำแหน่งใหม่' },
  { subject: 'ยกเลิก — เครื่องพิมพ์ spare ย้ายไปใช้แทน', deviceRef: 'UDH-PRN-2023-001', status: 'CANCELLED', priority: 'ปกติ', reporterName: 'คุณสมชาย ช่างซ่อม', tel: '089-999-0011', building: 'อาคารบริหาร', location: 'ห้อง IT', details: 'ใช้เครื่องสำรอง Brother จากคลังแทน' },
  { subject: 'PM ตรวจสอบเครื่องพิมพ์เภสัชกรรมประจำเดือน', deviceRef: 'NKP-PRN-2023-001', status: 'COMPLETED', priority: 'ปกติ', reporterName: 'ระบบ PM อัตโนมัติ', tel: '-', building: 'อาคารผู้ป่วยนอก', location: 'ห้องจ่ายยา', details: 'ทำความสะอาด, ตรวจ roller, อัปเดตมิเตอร์', resolution: 'สภาพดี ใช้งานต่อได้' },
]

async function main() {
  console.log('══════════════════════════════════════════════')
  console.log('  Seed REAL data (isDemo=false) for admin view')
  console.log('══════════════════════════════════════════════')

  const org = await db.organization.findFirst({ where: { code: 'PILOT' }, select: { id: true } })
  const organizationId = org?.id ?? null
  if (!organizationId) console.log('  ⚠ PILOT org not found — rows will have organizationId=null (still visible to global admin)')

  // ── 1. Sites ──
  console.log('1. Real SiteAttributes (UDH/NKP/KKN)...')
  for (const s of SITES) {
    await db.siteAttribute.upsert({
      where: { SiteCode: s.SiteCode },
      update: { SiteName: s.SiteName, PaperRateBW: s.PaperRateBW, PaperRateColor: s.PaperRateColor, Hotline: s.Hotline, isDemo: false },
      create: { ...s, isDemo: false },
    })
    console.log(`  ✓ ${s.SiteCode} — ${s.SiteName} (BW ${s.PaperRateBW} / Color ${s.PaperRateColor} ฿/แผ่น)`)
  }

  // ── 2. Departments ──
  console.log('2. Department MasterItems...')
  for (const d of DEPARTMENTS) {
    const existing = await db.masterItem.findFirst({ where: { category: 'Department', code: d.code, isDemo: false } })
    if (!existing) {
      await db.masterItem.create({ data: { category: 'Department', code: d.code, label: d.label, organizationId, isDemo: false } })
    }
  }
  console.log(`  ✓ ${DEPARTMENTS.length} departments (DEP-*)`)

  // ── 3. Devices ──
  console.log('3. Real devices...')
  let devCreated = 0
  for (const d of DEVICES) {
    const existing = await db.device.findFirst({ where: { assetCode: d.assetCode }, select: { id: true } })
    if (existing) continue
    // warrantyEnd = purchaseDate + warrantyMonths
    const pd = new Date(d.purchaseDate!)
    const we = new Date(pd)
    we.setMonth(we.getMonth() + d.warrantyMonths)
    await db.device.create({
      data: {
        ...d,
        purchasePrice: d.purchasePrice ?? undefined,
        warrantyEnd: we.toISOString().slice(0, 10),
        organizationId,
        isDemo: false,
        updatedBy: 'seed-real-data',
      },
    })
    devCreated++
  }
  console.log(`  ✓ ${devCreated} new devices (${DEVICES.length} total defined: 3 sites × printers/copiers/scanners/PCs)`)

  // ── 4. Work orders ──
  console.log('4. Real work orders...')
  const adminUser = await db.user.findFirst({ where: { username: 'admin' }, select: { username: true } })
  const assignedTo = adminUser?.username ?? 'admin'
  let woCreated = 0
  for (const w of WORK_ORDERS) {
    const dev = await db.device.findFirst({ where: { assetCode: w.deviceRef }, select: { id: true, site: true } })
    const dupe = await db.workOrder.findFirst({
      where: { subject: w.subject, isDemo: false },
      select: { id: true },
    })
    if (dupe) continue
    const isDone = w.status === 'COMPLETED'
    const now = new Date()
    const createdAt = new Date(now.getTime() - Math.floor(Math.random() * 20 + 1) * 24 * 60 * 60 * 1000)
    await db.workOrder.create({
      data: {
        subject: w.subject,
        details: w.details,
        priority: w.priority,
        status: w.status,
        reporterName: w.reporterName,
        tel: w.tel,
        building: w.building,
        location: w.location,
        deviceId: dev?.id ?? null,
        siteCode: dev?.site ?? 'UDH',
        submissionSource: 'session',
        assignedTo: w.status === 'PENDING' ? null : assignedTo,
        assignedBy: w.status === 'PENDING' ? null : assignedTo,
        assignedAt: w.status === 'PENDING' ? null : new Date(createdAt.getTime() + 3600_000),
        resolution: isDone ? w.resolution ?? 'ดำเนินการเรียบร้อย' : null,
        workCompletedAt: isDone ? new Date(createdAt.getTime() + 3 * 86400_000) : null,
        closedAt: isDone ? new Date(createdAt.getTime() + 4 * 86400_000) : null,
        cancelReason: w.status === 'CANCELLED' ? 'ยกเลิกโดยผู้แจ้ง — ใช้เครื่องสำรองแทน' : null,
        canceledAt: w.status === 'CANCELLED' ? new Date(createdAt.getTime() + 86400_000) : null,
        organizationId,
        isDemo: false,
        createdAt,
      },
    })
    woCreated++
  }
  console.log(`  ✓ ${woCreated} new work orders (${WORK_ORDERS.length} defined: PENDING/IN_PROGRESS/WAITING_PARTS/COMPLETED/CANCELLED)`)

  // ── 5. Meter readings (6 months for every metered device) ──
  console.log('5. Real meter readings (6 months)...')
  const metered = await db.device.findMany({
    where: { isDemo: false, meterRequired: true, status: { in: ['active', 'repair', 'spare'] } },
    select: { id: true, assetCode: true, site: true, building: true, floor: true, department: true },
  })
  const now = new Date()
  const months: string[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  let mrCreated = 0
  for (let di = 0; di < metered.length; di++) {
    const dev = metered[di]
    let meterBw = 8000 + di * 513
    let meterColor = 3000 + di * 277
    for (const m of months) {
      const existing = await db.meterReading.findFirst({ where: { deviceId: dev.id, readingMonth: m, isDemo: false }, select: { id: true } })
      if (existing) continue
      // Hospital-scale volumes: OPD/copier heavy, pharmacy printers medium
      const heavy = /CPY/.test(dev.assetCode)
      const pagesBw = (heavy ? 400 : 150) + ((di * 47 + Number(m.slice(-2)) * 29) % (heavy ? 350 : 200))
      const pagesColor = (heavy ? 90 : 25) + ((di * 19 + Number(m.slice(-2)) * 11) % (heavy ? 120 : 70))
      const prevBw = meterBw
      const prevColor = meterColor
      meterBw += pagesBw
      meterColor += pagesColor
      const [y, mo] = m.split('-').map(Number)
      const readingDate = new Date(y, mo, 0, 10, 0, 0).toISOString().slice(0, 10) // last day of month
      await db.meterReading.create({
        data: {
          deviceId: dev.id,
          assetCode: dev.assetCode,
          organizationId,
          readingDate,
          readingMonth: m,
          meterBw,
          meterColor,
          pagesBw,
          pagesColor,
          prevMeterBw: prevBw,
          prevMeterColor: prevColor,
          meterMode: 'BW_COLOR',
          readingType: 'MONTHLY',
          readBy: 'admin',
          siteAtReading: dev.site,
          buildingAtReading: dev.building,
          floorAtReading: dev.floor,
          departmentAtReading: dev.department,
          isDemo: false,
        },
      })
      mrCreated++
    }
    // Keep device lastMeter in sync with final reading
    await db.device.update({
      where: { id: dev.id },
      data: { lastMeterBw: meterBw, lastMeterColor: meterColor },
    })
  }
  console.log(`  ✓ ${mrCreated} meter readings across ${metered.length} metered devices (${months[0]} → ${months[months.length - 1]})`)

  // ── Verification ──
  const realDevices = await db.device.count({ where: { isDemo: false } })
  const realWOs = await db.workOrder.count({ where: { isDemo: false } })
  const realMRs = await db.meterReading.count({ where: { isDemo: false } })
  const realSites = await db.siteAttribute.count({ where: { isDemo: false } })
  console.log('═══ Verification (isDemo=false counts) ═══')
  console.log(`  Devices: ${realDevices} | WOs: ${realWOs} | MeterReadings: ${realMRs} | SiteAttributes: ${realSites}`)
  console.log('✓ Done — log in as admin/test1234 to see the real dataset')
}

main()
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
