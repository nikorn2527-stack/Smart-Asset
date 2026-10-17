/**
 * seed-notification-templates.ts — Seed default notification templates.
 *
 * Bug: Notification Templates page shows 0 templates — no defaults seeded.
 * This script seeds 6 default notification templates covering common events:
 *   - Work order created (LINE + email)
 *   - Work order assigned (LINE + email)
 *   - Work order completed (LINE)
 *   - Low stock alert (email)
 *   - PM due soon (LINE + email)
 *   - Meter reminder (LINE)
 *
 * Stored as JSON in AppSetting.key='notification_templates'.
 * Safe to re-run — only seeds if no templates exist.
 *
 * Usage:
 *   DATABASE_URL=... bun run scripts/seed-notification-templates.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const SETTING_KEY = 'notification_templates'

const DEFAULT_TEMPLATES = [
  {
    id: 'tpl_wo_created',
    app: 'itam',
    event: 'wo_created',
    channels: ['line-oa', 'email'],
    title: 'แจ้งซ่อมใหม่: {{woNumber}}',
    body: 'มีใบแจ้งซ่อมใหม่ {{woNumber}} จาก {{requesterName}}\nปัญหา: {{problemType}}\nสถานที่: {{location}}\nลำดับความเร่งด่วน: {{priority}}',
    enabled: true,
  },
  {
    id: 'tpl_wo_assigned',
    app: 'itam',
    event: 'wo_assigned',
    channels: ['line-oa', 'email'],
    title: 'มอบหมายงาน: {{woNumber}}',
    body: 'คุณได้รับมอบหมายใบงาน {{woNumber}}\nปัญหา: {{problemType}}\nอุปกรณ์: {{deviceName}}\nกรุณาตรวจสอบและดำเนินการ',
    enabled: true,
  },
  {
    id: 'tpl_wo_completed',
    app: 'itam',
    event: 'wo_completed',
    channels: ['line-oa'],
    title: 'ซ่อมเสร็จ: {{woNumber}}',
    body: 'ใบงาน {{woNumber}} ซ่อมเสร็จเรียบร้อย\nช่าง: {{technicianName}}\nผลการซ่อม: {{resolution}}',
    enabled: true,
  },
  {
    id: 'tpl_low_stock',
    app: 'stock',
    event: 'low_stock',
    channels: ['email'],
    title: 'แจ้งเตือนสต็อกต่ำ',
    body: 'รายการต่อไปนี้มีสต็อกต่ำกว่าจุดสั่งซื้อ:\n{{itemsList}}\nกรุณาสั่งซื้อเพิ่ม',
    enabled: true,
  },
  {
    id: 'tpl_pm_due',
    app: 'itam',
    event: 'pm_due',
    channels: ['line-oa', 'email'],
    title: 'PM ครบกำหนด: {{deviceName}}',
    body: 'อุปกรณ์ {{deviceName}} ({{assetCode}}) ถึงกำหนด PM\nประเภท: {{pmType}}\nวันที่กำหนด: {{scheduledDate}}\nกรุณานัดหมายเวลาทำ PM',
    enabled: true,
  },
  {
    id: 'tpl_meter_reminder',
    app: 'itam',
    event: 'meter_reminder',
    channels: ['line-oa'],
    title: 'แจ้งเตือนจดมิเตอร์',
    body: 'กรุณาจดมิเตอร์ประจำเดือน {{month}}\nจำนวนอุปกรณ์ที่ต้องจด: {{deviceCount}} เครื่อง\nตัดกำหนด: {{deadline}}',
    enabled: true,
  },
  {
    id: 'tpl_wo_cancelled',
    app: 'itam',
    event: 'wo_cancelled',
    channels: ['line-oa', 'email'],
    title: 'ยกเลิกใบงาน: {{woNumber}}',
    body: 'ใบงาน {{woNumber}} ถูกยกเลิก\nเหตุผล: {{cancelReason}}\nผู้ยกเลิก: {{cancelledBy}}',
    enabled: false, // disabled by default — opt-in
  },
  {
    id: 'tpl_stock_approved',
    app: 'stock',
    event: 'stock_approved',
    channels: ['line-oa', 'email'],
    title: 'อนุมัติเบิกของ: {{requestCode}}',
    body: 'คำขอเบิก {{requestCode}} ได้รับการอนุมัติ\nรายการ: {{itemCount}} รายการ\nผู้อนุมัติ: {{approverName}}\nกรุณามารับของได้ที่คลัง',
    enabled: true,
  },
]

async function main() {
  console.log('🔧 Seeding notification templates...\n')

  // Check existing
  const existing = await db.appSetting.findUnique({ where: { key: SETTING_KEY } })
  if (existing?.value) {
    try {
      const parsed = JSON.parse(existing.value)
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`⚠️  Already have ${parsed.length} notification templates — skipping seed.`)
        console.log('   (Delete them in Settings → Notification Templates to re-seed.)')
        return
      }
    } catch {
      // Value is malformed — proceed to overwrite
    }
  }

  // Seed
  await db.appSetting.upsert({
    where: { key: SETTING_KEY },
    create: {
      key: SETTING_KEY,
      value: JSON.stringify(DEFAULT_TEMPLATES),
    },
    update: {
      value: JSON.stringify(DEFAULT_TEMPLATES),
    },
  })

  console.log(`✓ Seeded ${DEFAULT_TEMPLATES.length} default notification templates:`)
  DEFAULT_TEMPLATES.forEach((t) => {
    console.log(`  - [${t.enabled ? '✓' : '✗'}] ${t.event}: "${t.title}"`)
    console.log(`      channels: ${t.channels.join(', ')}`)
  })
}

main()
  .catch((e) => {
    console.error('Fatal:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
