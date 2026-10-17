import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'

const db = new PrismaClient()

interface DeviceRow {
  asset_no: string
  device_type: string
  brand: string
  model: string
  serial: string
  building: string
  floor: string
  department: string
  location: string
  department_code: string
  status: string
  site: string
  contract_no: string
  ip: string
  mac: string
  remote_id: string
  updated_at: string
  updated_by: string
  remark: string
  vendor: string
  install_date: string
  uninstall_date: string
  warranty_end: string
  device_group: string
  cost_center: string
  meter_required: string
  meter_mode: string
  asset_site_code: string
}

function parseCSV(csv: string): DeviceRow[] {
  const lines: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]
    if (char === '"') {
      if (inQuotes && csv[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
        current += char
      }
    } else if (char === '\n' && !inQuotes) {
      lines.push(current)
      current = ''
    } else if (char === '\r') {
      // skip
    } else {
      current += char
    }
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
        if (inQ && line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQ = !inQ
        }
      } else if (char === ',' && !inQ) {
        result.push(cur)
        cur = ''
      } else {
        cur += char
      }
    }
    result.push(cur)
    return result
  }

  const headers = parseLine(lines[0]).map((h) => h.replace(/"/g, '').trim())
  const rows: DeviceRow[] = []

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const values = parseLine(lines[i])
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] ?? '').replace(/^"|"$/g, '').replace(/""/g, '"').trim()
    }
    rows.push(row as unknown as DeviceRow)
  }

  return rows
}

async function main() {
  console.log('=== Device Sync: Google Sheets → Supabase ===\n')

  // 1. Read CSV
  const csv = readFileSync('/tmp/devices.csv', 'utf8')
  const rows = parseCSV(csv)
  console.log(`CSV rows: ${rows.length}`)

  // 2. Get current DB devices
  const existing = await db.device.findMany({
    select: { assetCode: true },
  })
  const existingCodes = new Set(existing.map((d) => d.assetCode))
  console.log(`DB existing: ${existing.size}`)

  // 3. Prepare data
  let toCreate = 0
  let toUpdate = 0
  let skipped = 0

  for (const row of rows) {
    const assetCode = row.asset_no?.trim()
    if (!assetCode) {
      skipped++
      continue
    }

    const data = {
      assetCode,
      type: row.device_type || null,
      brand: row.brand || null,
      model: row.model || null,
      serialNumber: row.serial || null,
      building: row.building || null,
      floor: row.floor || null,
      department: row.department || null,
      location: row.location || null,
      status: row.status || 'Active',
      site: row.site || null,
      meterRequired: row.meter_required?.toUpperCase() === 'TRUE',
      meterMode: row.meter_mode || null,
      assetSiteCode: row.asset_site_code || null,
      deviceGroup: row.device_group || null,
      costCenter: row.cost_center || null,
      remark: row.remark || null,
      vendor: row.vendor || null,
      warrantyEnd: row.warranty_end || null,
      installDate: row.install_date || null,
      updatedBy: row.updated_by || 'sync',
    }

    if (existingCodes.has(assetCode)) {
      // Update existing
      await db.device.update({
        where: { assetCode },
        data,
      }).catch(() => { skipped++ })
      toUpdate++
    } else {
      // Create new
      try {
        await db.device.create({
          data: {
            ...data,
            name: `${row.brand || ''} ${row.model || ''}`.trim() || assetCode,
          },
        })
        toCreate++
      } catch (err) {
        skipped++
      }
    }
  }

  console.log(`\n=== Sync Results ===`)
  console.log(`Created: ${toCreate}`)
  console.log(`Updated: ${toUpdate}`)
  console.log(`Skipped: ${skipped}`)
  console.log(`Total processed: ${toCreate + toUpdate + skipped}`)

  const finalCount = await db.device.count()
  console.log(`DB devices after sync: ${finalCount}`)

  await db.$disconnect()
}

main().catch((e) => {
  console.error('Error:', e)
  process.exit(1)
})
