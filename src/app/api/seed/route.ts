import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import type { Device } from '@prisma/client'

function isoDaysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function POST() {
  // ── P1 Security: Seed endpoint is PERMANENTLY disabled via HTTP ──
  // Per consultant P1 recommendation: the override ALLOW_SEED_IN_PRODUCTION
  // has been removed. Seeding should ONLY be done via `bun run db:seed`
  // CLI script (which has direct DB access, no HTTP exposure).
  //
  // Even in development, prefer the CLI script. This endpoint remains
  // accessible in dev mode for convenience, but is blocked entirely
  // in production with NO override.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      {
        error:
          'Seed endpoint is disabled in production. Use `bun run db:seed` CLI script instead.',
      },
      { status: 403 },
    )
  }

  try {
    const existing = await db.device.count()
    if (existing > 0) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        message: 'Database already has data',
      })
    }

    // Sites
    const sites = await db.site.createMany({
      data: [
        { code: 'HQ', name: 'สำนักงานใหญ่' },
        { code: 'BKK-1', name: 'สาขากรุงเทพ 1' },
        { code: 'CNX', name: 'สาขาเชียงใหม่' },
      ],
    })

    // Default site rates (0.5 ฿/sheet BW, 2.0 ฿/sheet color)
    const siteRates = await db.siteRate.createMany({
      data: [
        { siteCode: 'HQ', bwRate: 0.5, colorRate: 2.0 },
        { siteCode: 'BKK-1', bwRate: 0.5, colorRate: 2.0 },
        { siteCode: 'CNX', bwRate: 0.5, colorRate: 2.0 },
      ],
    })

    // Master items: 6 per category
    const masterSeed: Array<{ category: string; code: string; label: string }> = [
      // Brand
      { category: 'Brand', code: 'HP', label: 'HP' },
      { category: 'Brand', code: 'CANON', label: 'Canon' },
      { category: 'Brand', code: 'BROTHER', label: 'Brother' },
      { category: 'Brand', code: 'EPSON', label: 'Epson' },
      { category: 'Brand', code: 'KONICA', label: 'Konica Minolta' },
      { category: 'Brand', code: 'RICOH', label: 'Ricoh' },
      // Type
      { category: 'Type', code: 'PRINTER', label: 'เครื่องพิมพ์' },
      { category: 'Type', code: 'COPIER', label: 'เครื่องถ่ายเอกสาร' },
      { category: 'Type', code: 'SCANNER', label: 'สแกนเนอร์' },
      { category: 'Type', code: 'MFP', label: 'มัลติฟังก์ชัน' },
      { category: 'Type', code: 'LAPTOP', label: 'โน้ตบุ๊ก' },
      { category: 'Type', code: 'MONITOR', label: 'จอภาพ' },
      // Model
      { category: 'Model', code: 'HP-LJ-4001', label: 'HP|PRINTER|LaserJet 4001' },
      { category: 'Model', code: 'CANON-IR2630', label: 'CANON|COPIER|imageRUNNER 2630' },
      { category: 'Model', code: 'BROTHER-DCP', label: 'BROTHER|MFP|DCP-L3520' },
      { category: 'Model', code: 'EPSON-L3250', label: 'EPSON|MFP|L3250' },
      { category: 'Model', code: 'KONICA-C250i', label: 'KONICA|COPIER|bizhub C250i' },
      { category: 'Model', code: 'RICOH-IMC', label: 'RICOH|COPIER|IM C2500' },
      // Department
      { category: 'Department', code: 'IT', label: 'ฝ่ายเทคโนโลยีสารสนเทศ' },
      { category: 'Department', code: 'HR', label: 'ฝ่ายทรัพยากรบุคคล' },
      { category: 'Department', code: 'FIN', label: 'ฝ่ายการเงิน' },
      { category: 'Department', code: 'SALES', label: 'ฝ่ายขาย' },
      { category: 'Department', code: 'MKT', label: 'ฝ่ายการตลาด' },
      { category: 'Department', code: 'OPS', label: 'ฝ่ายปฏิบัติการ' },
      // Status
      { category: 'Status', code: 'active', label: 'ใช้งานอยู่' },
      { category: 'Status', code: 'spare', label: 'สำรอง' },
      { category: 'Status', code: 'repair', label: 'ส่งซ่อม' },
      { category: 'Status', code: 'disposed', label: 'ตัดของออก' },
      { category: 'Status', code: 'pending', label: 'รอตรวจสอบ' },
      { category: 'Status', code: 'transfer', label: 'โอนย้าย' },
      // DeviceGroup
      { category: 'DeviceGroup', code: 'PRINT', label: 'กลุ่มเครื่องพิมพ์' },
      { category: 'DeviceGroup', code: 'COPY', label: 'กลุ่มเครื่องถ่ายเอกสาร' },
      { category: 'DeviceGroup', code: 'SCAN', label: 'กลุ่มสแกนเนอร์' },
      { category: 'DeviceGroup', code: 'PC', label: 'กลุ่มคอมพิวเตอร์' },
      { category: 'DeviceGroup', code: 'DISPLAY', label: 'กลุ่มจอภาพ' },
      { category: 'DeviceGroup', code: 'NETWORK', label: 'กลุ่มอุปกรณ์เครือข่าย' },
    ]
    await db.masterItem.createMany({ data: masterSeed })

    // Devices (~12 mixed)
    type DeviceSeed = {
      assetCode: string
      name: string
      brand: string
      model: string
      type: string
      serialNumber?: string
      status: string
      site: string
      department?: string
      location?: string
      purchaseDate?: string
      lastMeterBw: number
    }
    const deviceSeeds: DeviceSeed[] = [
      { assetCode: 'IT-PRT-001', name: 'เครื่องพิมพ์ห้อง IT', brand: 'HP', model: 'LaserJet 4001', type: 'PRINTER', serialNumber: 'SN-HP-001', status: 'active', site: 'HQ', department: 'ฝ่ายเทคโนโลยีสารสนเทศ', location: 'ชั้น 3 ห้อง IT', purchaseDate: '2023-01-15', lastMeterBw: 124500 },
      { assetCode: 'IT-COP-002', name: 'เครื่องถ่ายเอกสารชั้น 1', brand: 'Canon', model: 'imageRUNNER 2630', type: 'COPIER', serialNumber: 'SN-CN-002', status: 'active', site: 'HQ', department: 'ฝ่ายปฏิบัติการ', location: 'ชั้น 1', purchaseDate: '2022-08-20', lastMeterBw: 285000 },
      { assetCode: 'IT-MFP-003', name: 'MFP สาขา BKK-1', brand: 'Brother', model: 'DCP-L3520', type: 'MFP', serialNumber: 'SN-BR-003', status: 'active', site: 'BKK-1', department: 'ฝ่ายขาย', location: 'โซน A', purchaseDate: '2023-03-10', lastMeterBw: 56000 },
      { assetCode: 'IT-MFP-004', name: 'MFP สาขา CNX', brand: 'Epson', model: 'L3250', type: 'MFP', serialNumber: 'SN-EP-004', status: 'spare', site: 'CNX', department: 'ฝ่ายการตลาด', location: 'คลัง', purchaseDate: '2023-05-01', lastMeterBw: 12000 },
      { assetCode: 'IT-COP-005', name: 'เครื่องถ่ายเอกสารชั้น 5', brand: 'Konica Minolta', model: 'bizhub C250i', type: 'COPIER', serialNumber: 'SN-KM-005', status: 'active', site: 'HQ', department: 'ฝ่ายการเงิน', location: 'ชั้น 5', purchaseDate: '2022-11-25', lastMeterBw: 410000 },
      { assetCode: 'IT-COP-006', name: 'เครื่องถ่ายเอกสาร CNX', brand: 'Ricoh', model: 'IM C2500', type: 'COPIER', serialNumber: 'SN-RC-006', status: 'repair', site: 'CNX', department: 'ฝ่ายทรัพยากรบุคคล', location: 'ชั้น 2', purchaseDate: '2021-07-19', lastMeterBw: 332000 },
      { assetCode: 'IT-PRT-007', name: 'เครื่องพิมพ์ห้องประชุม', brand: 'HP', model: 'LaserJet 4001', type: 'PRINTER', serialNumber: 'SN-HP-007', status: 'active', site: 'BKK-1', department: 'ฝ่ายขาย', location: 'ห้องประชุม', purchaseDate: '2023-06-22', lastMeterBw: 38000 },
      { assetCode: 'IT-SCN-008', name: 'สแกนเนอร์ห้องเอกสาร', brand: 'Canon', model: 'imageFormula R40', type: 'SCANNER', serialNumber: 'SN-CN-008', status: 'active', site: 'HQ', department: 'ฝ่ายการเงิน', location: 'ชั้น 2', purchaseDate: '2023-02-11', lastMeterBw: 0 },
      { assetCode: 'IT-MFP-009', name: 'MFP สำรอง HQ', brand: 'Epson', model: 'L3250', type: 'MFP', serialNumber: 'SN-EP-009', status: 'spare', site: 'HQ', department: 'ฝ่ายเทคโนโลยีสารสนเทศ', location: 'คลังชั้น 3', purchaseDate: '2024-01-05', lastMeterBw: 2500 },
      { assetCode: 'IT-PRT-010', name: 'เครื่องพิมพ์ฝ่ายการตลาด', brand: 'Brother', model: 'DCP-L3520', type: 'PRINTER', serialNumber: 'SN-BR-010', status: 'active', site: 'HQ', department: 'ฝ่ายการตลาด', location: 'ชั้น 4', purchaseDate: '2023-09-30', lastMeterBw: 22400 },
      { assetCode: 'IT-COP-011', name: 'เครื่องถ่ายเอกสาร BKK-1', brand: 'Konica Minolta', model: 'bizhub C250i', type: 'COPIER', serialNumber: 'SN-KM-011', status: 'active', site: 'BKK-1', department: 'ฝ่ายปฏิบัติการ', location: 'ชั้น 1', purchaseDate: '2022-04-14', lastMeterBw: 510000 },
      { assetCode: 'IT-COP-012', name: 'เครื่องถ่ายเอกสารเก่า', brand: 'Ricoh', model: 'IM C2500', type: 'COPIER', serialNumber: 'SN-RC-012', status: 'disposed', site: 'HQ', department: 'ฝ่ายเทคโนโลยีสารสนเทศ', location: 'คลังรอตัดของ', purchaseDate: '2019-12-01', lastMeterBw: 999999 },
    ]

    const createdDevices: Device[] = []
    for (const seed of deviceSeeds) {
      const d = await db.device.create({ data: seed })
      createdDevices.push(d)
    }

    // Active cycle: start today-10d, end today+20d
    const cycle = await db.cycle.create({
      data: {
        name: `รอบจดมิเตอร์ ${isoDaysFromNow(-10)} → ${isoDaysFromNow(20)}`,
        startDate: isoDaysFromNow(-10),
        endDate: isoDaysFromNow(20),
        status: 'active',
      },
    })

    // ~20 meter readings across devices/dates.
    // NOTE: MeterReading stores the BW/Color split (meterBw/meterColor,
    // prevMeterBw/prevMeterColor, pagesBw/pagesColor) and has NO
    // reading/prevReading/delta/date/cycleId columns — the previous shape
    // would have made createMany() throw and aborted the whole seed.
    const meterables = createdDevices.filter(
      (d) => d.type === 'COPIER' || d.type === 'MFP' || d.type === 'PRINTER',
    )
    const readingsToCreate: Prisma.MeterReadingCreateManyInput[] = []
    for (const dev of meterables) {
      let prev = Math.max(0, dev.lastMeterBw - 30000)
      // 2-3 readings per device over the past ~30 days
      const numReadings = dev.status === 'disposed' ? 1 : 2 + (Math.floor(Math.random() % 2))
      for (let i = 0; i < numReadings; i++) {
        const increment = Math.floor(500 + Math.random() * 4000)
        const newReading = prev + increment
        const dayOffset = -25 + i * 12 + (meterables.indexOf(dev) % 5)
        const date = isoDaysFromNow(dayOffset)
        readingsToCreate.push({
          deviceId: dev.id,
          assetCode: dev.assetCode,
          readingDate: date,
          readingMonth: date.slice(0, 7), // YYYY-MM
          meterBw: newReading,
          meterColor: 0,
          prevMeterBw: prev,
          prevMeterColor: 0,
          pagesBw: newReading - prev,
          pagesColor: 0,
          readingType: 'MONTHLY',
          meterMode: dev.meterMode,
        })
        prev = newReading
      }
    }
    if (readingsToCreate.length > 0) {
      await db.meterReading.createMany({ data: readingsToCreate })
    }
    // Sync lastMeterBw to latest reading per device
    for (const dev of meterables) {
      const latest = readingsToCreate
        .filter((r) => r.deviceId === dev.id)
        .sort((a, b) => a.readingDate.localeCompare(b.readingDate))
        .at(-1)
      if (latest) {
        await db.device.update({
          where: { id: dev.id },
          data: { lastMeterBw: latest.meterBw },
        })
      }
    }

    // Default app settings
    await db.appSetting.createMany({
      data: [
        { key: 'orgName', value: 'องค์กรของคุณ' },
        { key: 'defaultSite', value: 'HQ' },
        { key: 'enablePasswordLogin', value: 'true' },
        { key: 'stickerTemplate', value: 'template-1' },
        { key: 'docTemplate', value: 'doc-1' },
      ],
    })

    // Demo users (3) — only if no users exist yet
    const existingUsers = await db.user.count()
    let userCount = 0
    if (existingUsers === 0) {
      const created = await db.user.createMany({
        data: [
          { email: 'admin@example.com', name: 'ผู้ดูแลระบบ', role: 'admin', active: true },
          { email: 'editor@example.com', name: 'ผู้แก้ไข', role: 'editor', active: true },
          { email: 'viewer@example.com', name: 'ผู้ดู', role: 'viewer', active: true },
        ],
      })
      userCount = created.count
    }

    const counts = {
      sites: sites.count,
      siteRates: siteRates.count,
      masterItems: masterSeed.length,
      devices: deviceSeeds.length,
      readings: readingsToCreate.length,
      cycle: 1,
      settings: 5,
      users: userCount,
    }

    await logAudit(
      'SEED',
      'Setting',
      null,
      `โหลดข้อมูลตัวอย่าง (${counts.devices} อุปกรณ์, ${counts.masterItems} รายการมาตรฐาน, ${counts.readings} มิเตอร์)`,
      { counts },
    )

    return NextResponse.json({
      ok: true,
      counts,
    })
  } catch (err) {
    console.error('POST /api/seed', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Seed failed') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
