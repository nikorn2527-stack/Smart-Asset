/**
 * seed-contact-directory.ts — Seed default contact directory entries.
 *
 * Bug: Contact Directory page shows 0 contacts — no defaults seeded.
 * This script seeds a few example contacts (admin/IT staff) so the
 * page isn't empty + demonstrates the expected data shape.
 *
 * Stored as JSON in AppSetting.key='contactDirectory'.
 * Safe to re-run — only seeds if no contacts exist.
 *
 * Usage:
 *   DATABASE_URL=... bun run scripts/seed-contact-directory.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const SETTING_KEY = 'contactDirectory'

const DEFAULT_CONTACTS = [
  {
    id: 'c_default_admin',
    full_name: 'ผู้ดูแลระบบ IT',
    phone_primary: '02-123-4567',
    employee_code: 'IT-001',
    department: 'ฝ่ายเทคโนโลยีสารสนเทศ',
    active: true,
    note: 'ผู้ดูแลระบบหลัก — ติดต่อกรณีฉุกเฉิน',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'c_default_it_staff_1',
    full_name: 'ช่างเทคนิค IT (กลางวัน)',
    phone_primary: '081-234-5678',
    employee_code: 'IT-002',
    department: 'ฝ่ายเทคโนโลยีสารสนเทศ',
    active: true,
    note: 'เวร 08:00-16:00',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'c_default_it_staff_2',
    full_name: 'ช่างเทคนิค IT (กลางคืน)',
    phone_primary: '089-876-5432',
    employee_code: 'IT-003',
    department: 'ฝ่ายเทคโนโลยีสารสนเทศ',
    active: true,
    note: 'เวร 16:00-24:00',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'c_default_helpdesk',
    full_name: 'Helpdesk (ศูนย์ช่วยเหลือ)',
    phone_primary: '02-345-6789',
    employee_code: 'IT-HD',
    department: 'ฝ่ายเทคโนโลยีสารสนเทศ',
    active: true,
    note: 'สายด่วนสำหรับแจ้งซ่อม',
    createdAt: new Date().toISOString(),
  },
]

async function main() {
  console.log('🔧 Seeding contact directory...\n')

  // Load existing + merge defaults (don't overwrite existing IDs)
  const existing = await db.appSetting.findUnique({ where: { key: SETTING_KEY } })
  let existingContacts: Array<{ id: string }> = []
  if (existing?.value) {
    try {
      const parsed = JSON.parse(existing.value)
      if (Array.isArray(parsed)) existingContacts = parsed
    } catch {
      // Value is malformed — proceed to overwrite
    }
  }

  const existingIds = new Set(existingContacts.map((c) => c.id))
  const toAdd = DEFAULT_CONTACTS.filter((c) => !existingIds.has(c.id))
  if (toAdd.length === 0) {
    console.log(`✓ Already have ${existingContacts.length} contacts — nothing to add.`)
    return
  }

  const merged = [...existingContacts, ...toAdd]
  await db.appSetting.upsert({
    where: { key: SETTING_KEY },
    create: {
      key: SETTING_KEY,
      value: JSON.stringify(merged),
    },
    update: {
      value: JSON.stringify(merged),
    },
  })

  console.log(`✓ Added ${toAdd.length} new contacts (now ${merged.length} total):`)
  toAdd.forEach((c) => {
    console.log(`  - ${c.full_name} (${c.employee_code}) — ${c.phone_primary}`)
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
