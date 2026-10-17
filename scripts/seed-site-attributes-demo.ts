/**
 * seed-site-attributes-demo.ts — Seed demo SiteAttribute rows + monthly meter readings
 * so Paper Analytics (วิเคราะห์กระดาษ) has data to report.
 *
 * What it does (idempotent — safe to re-run):
 *   1. Upsert SiteAttribute rows for the sites demo devices live in:
 *        HQ  → PaperRateBW 0.5 / PaperRateColor 3.0
 *        BKK → PaperRateBW 0.6 / PaperRateColor 3.5
 *      (Distinct rates so per-site cost calculation (CONSULTING-007) is
 *       verifiable end-to-end: same page counts → different cost per site.)
 *   2. For every demo device with a printer-like category, create 6 months of
 *      monthly MeterReading rows (pagesBw / pagesColor) tagged isDemo=true.
 *
 * Usage: bun scripts/seed-site-attributes-demo.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const DEMO_SITES = [
  {
    SiteCode: 'HQ',
    SiteName: 'HQ',
    PaperRateBW: 0.5,
    PaperRateColor: 3.0,
    Hotline: '042-000-111',
  },
  {
    SiteCode: 'BKK',
    SiteName: 'BKK',
    PaperRateBW: 0.6,
    PaperRateColor: 3.5,
    Hotline: '02-000-222',
  },
]

async function main() {
  console.log('══════════════════════════════════════════')
  console.log('  Seed demo SiteAttributes + meter readings')
  console.log('══════════════════════════════════════════')

  // ── 1. SiteAttribute upserts ─────────────────────────────────────────────
  for (const s of DEMO_SITES) {
    await db.siteAttribute.upsert({
      where: { SiteCode: s.SiteCode },
      update: {
        SiteName: s.SiteName,
        PaperRateBW: s.PaperRateBW,
        PaperRateColor: s.PaperRateColor,
        Hotline: s.Hotline,
      },
      create: {
        SiteCode: s.SiteCode,
        SiteName: s.SiteName,
        PaperRateBW: s.PaperRateBW,
        PaperRateColor: s.PaperRateColor,
        Hotline: s.Hotline,
        isDemo: true,
      },
    })
    console.log(`  ✓ SiteAttribute ${s.SiteCode} (BW ${s.PaperRateBW} ฿/แผ่น, Color ${s.PaperRateColor} ฿/แผ่น)`)
  }

  // ── 2. Meter readings for demo devices ───────────────────────────────────
  // Find the admin user to attribute readings (fallback: any admin).
  const admin = await db.user.findFirst({ where: { role: 'admin' }, select: { username: true } })
  const readBy = admin?.username ?? 'admin'

  const org = await db.organization.findFirst({ where: { code: 'PILOT' }, select: { id: true } })
  const organizationId = org?.id ?? null

  const devices = await db.device.findMany({
    where: { isDemo: true, status: { in: ['active', 'spare'] } },
    select: { id: true, assetCode: true, site: true, type: true },
  })
  if (devices.length === 0) {
    console.log('  ⚠ No demo devices found — skipping meter readings (run seed-comprehensive-demo first)')
    return
  }

  // 6 months ending with the current month (YYYY-MM keys)
  const now = new Date()
  const months: string[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  // Deterministic pseudo-random per device index so re-runs produce the same data
  let created = 0
  for (let di = 0; di < devices.length; di++) {
    const dev = devices[di]
    // Skip non-printer-ish devices half of the time (deterministic)
    const printerish = (dev.type ?? '').match(/printer|copier|มัลติ|ปรินท์/i) || di % 2 === 0
    if (!printerish) continue

    let meterBw = 1000 + di * 137
    let meterColor = 500 + di * 89
    for (const m of months) {
      const pagesBw = 120 + ((di * 31 + Number(m.slice(-2)) * 17) % 180)
      const pagesColor = 30 + ((di * 13 + Number(m.slice(-2)) * 7) % 90)
      const prevBw = meterBw
      const prevColor = meterColor
      meterBw += pagesBw
      meterColor += pagesColor
      const [y, mo] = m.split('-').map(Number)
      const readingDate = new Date(y, mo, 0, 10, 0, 0).toISOString().slice(0, 10) // last day of month

      const existing = await db.meterReading.findFirst({
        where: { deviceId: dev.id, readingMonth: m, isDemo: true },
        select: { id: true },
      })
      if (existing) continue // idempotent

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
          readBy,
          siteAtReading: dev.site,
          buildingAtReading: 'อาคาร 1',
          floorAtReading: 'ชั้น 2',
          isDemo: true,
        },
      })
      created++
    }
  }

  console.log(`  ✓ Created ${created} demo meter readings across ${months.length} months (${months[0]} → ${months[months.length - 1]})`)

  // ── Verification ──────────────────────────────────────────────────────────
  const siteCount = await db.siteAttribute.count()
  const readingCount = await db.meterReading.count()
  console.log('═══ Verification ═══')
  console.log(`  SiteAttribute rows: ${siteCount}`)
  console.log(`  MeterReading rows : ${readingCount}`)
  console.log('✓ Done')
}

main()
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
