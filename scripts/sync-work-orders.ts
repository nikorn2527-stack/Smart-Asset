import { google } from 'googleapis'
import { PrismaClient } from '@prisma/client'

// Read service account credentials from env var (production) or file (local dev only).
// IMPORTANT: never commit the real google-service-account.json to Git.
// In production (Vercel), set GOOGLE_APPLICATION_CREDENTIALS_JSON env var
// with the full JSON content of the service account key.
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || './google-service-account.json'
const keyContent = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON

const auth = keyContent
  ? new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      credentials: JSON.parse(keyContent),
    })
  : new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    })
const sheets = google.sheets({ version: 'v4', auth })
const db = new PrismaClient()

const STATUS_MAP: Record<string, string> = {
  '🟢จบงาน': 'COMPLETED',
  '🟡รอเบิกอะไหล่': 'WAITING_PARTS',
  '⚫ยกเลิกงาน': 'CANCELLED',
  '🔵สำรวจหน้างาน/แก้ไข': 'IN_PROGRESS',
  '🟠รอดำเนินการ': 'PENDING',
}

async function main() {
  console.log('=== WorkOrders Sync ===')

  // Fetch all WO data from Service sheet
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: '1_YPa5fvNnsoKA0I3JFk38x7A7kTGHCVfDhsvQ-aCmgw',
    range: 'Data!A:A',
  })
  const rows = r.data.values ?? []
  console.log('Sheet rows:', rows.length - 1)

  // Get existing woNumbers in DB
  const existing = await db.workOrder.findMany({ select: { woNumber: true } })
  const existingNumbers = new Set(existing.map(w => w.woNumber).filter(Boolean))
  console.log('DB existing WOs:', existing.size)

  let created = 0
  let skipped = 0
  let noId = 0
  const batch: Array<{
    woNumber: string
    subject: string
    status: string
    building: string | null
    location: string | null
    details: string | null
    tel: string | null
    picBefore: string | null
    picOnsite: string | null
    picAfter: string | null
    detailsAdmin: string | null
    dateAdmin: string | null
    acceptStatus: string | null
    priority: string
    assignedTo: string | null
    trackable: boolean
    submissionSource: string
    siteCode: string | null
  }> = []

  for (let i = 1; i < rows.length; i++) {
    const raw = rows[i]?.[0]
    if (!raw) { noId++; continue }

    let wo: Record<string, unknown>
    try {
      wo = JSON.parse(raw)
    } catch {
      skipped++
      continue
    }

    const woId = String(wo.id ?? '').trim()
    if (!woId) { noId++; continue }
    if (existingNumbers.has(woId)) { skipped++; continue }

    const status = STATUS_MAP[String(wo.status ?? '')] || 'PENDING'
    const priority = String(wo.priority ?? 'ปกติ').trim() || 'ปกติ'

    batch.push({
      woNumber: woId,
      subject: String(wo.subject ?? '').trim() || 'ไม่ระบุ',
      status,
      building: String(wo.building ?? '').trim() || null,
      location: String(wo.location ?? '').trim() || null,
      details: String(wo.details ?? '').trim() || null,
      tel: String(wo.tel ?? '').trim() || null,
      picBefore: String(wo.pic_before ?? '').trim() || null,
      picOnsite: String(wo.pic_onsite ?? '').trim() || null,
      picAfter: String(wo.pic_after ?? '').trim() || null,
      detailsAdmin: String(wo.details_admin ?? '').trim() || null,
      dateAdmin: String(wo.date_admin ?? '').trim() || null,
      acceptStatus: String(wo.accept_status ?? '').trim() || null,
      priority,
      assignedTo: String(wo.assigned_to ?? '').trim() || null,
      trackable: Boolean(wo.trackable),
      submissionSource: 'session',
      siteCode: 'โรงพยาบาลศูนย์อุดรธานี',
    })

    if (batch.length >= 100) {
      try {
        const result = await db.workOrder.createMany({ data: batch, skipDuplicates: true })
        created += result.count
      } catch (err) {
        console.error('Batch error:', err instanceof Error ? err.message.slice(0, 100) : 'unknown')
      }
      batch.length = 0
      console.log(`Progress: ${created} created, ${skipped} skipped`)
    }
  }

  // Final batch
  if (batch.length > 0) {
    try {
      const result = await db.workOrder.createMany({ data: batch, skipDuplicates: true })
      created += result.count
    } catch (err) {
      console.error('Final batch error:', err instanceof Error ? err.message.slice(0, 100) : 'unknown')
    }
  }

  console.log(`\n=== Results ===`)
  console.log(`Created: ${created}`)
  console.log(`Skipped (existing): ${skipped}`)
  console.log(`No ID: ${noId}`)
  console.log(`Total processed: ${created + skipped + noId}`)

  const finalCount = await db.workOrder.count()
  console.log(`DB WorkOrders after sync: ${finalCount}`)

  await db.$disconnect()
}

main().catch(e => { console.error('Error:', e); process.exit(1) })
