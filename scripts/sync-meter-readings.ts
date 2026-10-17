import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'

const db = new PrismaClient()

function parseCSV(csv: string): Record<string, string>[] {
  const lines: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]
    if (char === '"') {
      if (inQuotes && csv[i + 1] === '"') { current += '"'; i++ }
      else { inQuotes = !inQuotes; current += char }
    } else if (char === '\n' && !inQuotes) { lines.push(current); current = '' }
    else if (char === '\r') { /* skip */ }
    else { current += char }
  }
  if (current) lines.push(current)
  if (lines.length < 2) return []

  const parseLine = (line: string): string[] => {
    const result: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
        else { inQ = !inQ }
      } else if (char === ',' && !inQ) { result.push(cur); cur = '' }
      else { cur += char }
      }
    result.push(cur)
    return result
  }

  const headers = parseLine(lines[0]).map((h) => h.replace(/"/g, '').trim())
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const values = parseLine(lines[i])
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] ?? '').replace(/^"|"$/g, '').replace(/""/g, '"').trim()
    }
    rows.push(row)
  }
  return rows
}

async function main() {
  console.log('=== Meter Readings Sync: Google Sheets → Supabase ===\n')

  const csv = readFileSync('/tmp/meter_readings.csv', 'utf8')
  const rows = parseCSV(csv)
  console.log(`CSV rows: ${rows.length}`)

  // Build device lookup: assetCode → deviceId
  const devices = await db.device.findMany({ select: { id: true, assetCode: true } })
  const deviceMap = new Map(devices.map((d) => [d.assetCode, d.id]))
  console.log(`Device lookup: ${deviceMap.size} devices`)

  // Get existing readings to avoid duplicates
  const existingReadings = await db.meterReading.findMany({
    select: { readingId: true },
    where: { readingId: { not: null } },
  })
  const existingIds = new Set(existingReadings.map((r) => r.readingId))
  console.log(`Existing readings with readingId: ${existingIds.size}`)

  let created = 0
  let skipped = 0
  let noDevice = 0
  let batchSize = 0
  const batch: Array<{
    readingId: string | null
    deviceId: string
    assetCode: string | null
    readingDate: string
    readingMonth: string | null
    meterBw: number
    meterColor: number
    pagesBw: number
    pagesColor: number
    prevMeterBw: number
    prevMeterColor: number
    readingType: string | null
    readBy: string | null
    remark: string | null
    locationAtReading: string | null
    siteAtReading: string | null
    buildingAtReading: string | null
    floorAtReading: string | null
    departmentAtReading: string | null
  }> = []

  for (const row of rows) {
    const assetCode = row.asset_no?.trim()
    const readingId = row.reading_id?.trim()

    if (!assetCode) { skipped++; continue }

    const deviceId = deviceMap.get(assetCode)
    if (!deviceId) { noDevice++; continue }

    // Skip if reading already exists
    if (readingId && existingIds.has(readingId)) { skipped++; continue }

    batch.push({
      readingId: readingId || null,
      deviceId,
      assetCode,
      readingDate: row.reading_date?.split(' ')[0] || new Date().toISOString().slice(0, 10),
      readingMonth: row.reading_month || null,
      meterBw: parseInt(row.meter_bw || '0', 10) || 0,
      meterColor: parseInt(row.meter_color || '0', 10) || 0,
      pagesBw: parseInt(row.pages_bw || '0', 10) || 0,
      pagesColor: parseInt(row.pages_color || '0', 10) || 0,
      prevMeterBw: parseInt(row.prev_meter_bw || '0', 10) || 0,
      prevMeterColor: parseInt(row.prev_meter_color || '0', 10) || 0,
      readingType: row.reading_type || null,
      readBy: row.read_by || null,
      remark: row.remark || null,
      locationAtReading: row.location_at_reading || null,
      siteAtReading: row.site_at_reading || null,
      buildingAtReading: row.building_at_reading || null,
      floorAtReading: row.floor_at_reading || null,
      departmentAtReading: row.department_at_reading || null,
    })
    batchSize++

    // Batch insert every 500 rows
    if (batchSize >= 500) {
      try {
        await db.meterReading.createMany({ data: batch, skipDuplicates: true })
        created += batch.length
      } catch (err) {
        console.error('Batch insert error:', err instanceof Error ? err.message.slice(0, 100) : 'unknown')
      }
      batch.length = 0
      batchSize = 0
      console.log(`Progress: ${created}/${rows.length} created, ${skipped} skipped, ${noDevice} no device`)
    }
  }

  // Insert remaining
  if (batch.length > 0) {
    try {
      await db.meterReading.createMany({ data: batch, skipDuplicates: true })
      created += batch.length
    } catch (err) {
      console.error('Final batch error:', err instanceof Error ? err.message.slice(0, 100) : 'unknown')
    }
  }

  console.log(`\n=== Sync Results ===`)
  console.log(`Created: ${created}`)
  console.log(`Skipped (duplicate/no readingId): ${skipped}`)
  console.log(`No matching device: ${noDevice}`)
  console.log(`Total processed: ${created + skipped + noDevice}`)

  const finalCount = await db.meterReading.count()
  console.log(`DB meter readings after sync: ${finalCount}`)

  await db.$disconnect()
}

main().catch((e) => {
  console.error('Error:', e)
  process.exit(1)
})
