/**
 * import-sheets-v2.ts — แก้ปัญหา Audit_Log/Site_Attributes/App_Settings
 * ที่ Google Sheets ส่ง row แรกมาแบบค่าติดกัน (ไม่มี comma)
 *
 * วิธีแก้: ใช้ header จากแถวแรกที่แยกด้วย comma จริงๆ (เช่น "Timestamp","Action","User","Details")
 * แต่ถ้า row แรกไม่มี comma → ใช้ fallback headers ที่กำหนดเอง
 */

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const SPREADSHEET_ID = '1Zi2sDW1xeAUdHb6MSt0AdpZttRY8C3-WB5agHLaeUpc'
const BASE_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv`

// Fallback headers สำหรับ sheets ที่มีปัญหา
const FALLBACK_HEADERS: Record<string, string[]> = {
  'Audit_Log': ['Timestamp', 'Action', 'User', 'Details'],
  'Site_Attributes': ['SiteCode', 'SiteName', 'LineOA', 'Hotline', 'PaperRateBW', 'PaperRateColor'],
  'App_Settings': ['Key', 'Value', 'Description', 'UpdatedAt'],
}

async function fetchSheet(sheetName: string): Promise<string> {
  const url = `${BASE_URL}&sheet=${encodeURIComponent(sheetName)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${sheetName}: ${res.status}`)
  return res.text()
}

// Parse CSV แบบ manual — รองรับ quoted fields ที่มี comma ข้างใน
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result.map(s => s.trim().replace(/^"|"$/g, ''))
}

function parseCsvWithFallback(csvText: string, fallbackHeaders?: string[]): Record<string, string>[] {
  const lines = csvText.split('\n').filter(l => l.trim())
  if (lines.length === 0) return []

  // Parse บรรทัดแรก
  const firstRow = parseCsvLine(lines[0])

  // ตรวจว่า row 1 เป็น header ปกติหรือ header+data ติดกัน
  // ถ้าคอลัมน์แรกมีช่องว่าง (เช่น "SiteCode MECUD") → เป็น header+data
  const isFirstColHeaderOnly = !firstRow[0].includes(' ') ||
    (fallbackHeaders && firstRow[0] === fallbackHeaders[0])

  let headers: string[]
  let startIdx: number
  const rows: Record<string, string>[] = []

  if (isFirstColHeaderOnly && firstRow.length > 1) {
    // Row 1 เป็น header ปกติ
    headers = firstRow
    startIdx = 1
  } else if (fallbackHeaders) {
    // Row 1 มี header+data ติดกัน → ใช้ fallback headers
    // ดึงค่า data ออกจาก row 1 (ค่าหลังช่องว่างแรกในแต่ละคอลัมน์)
    headers = fallbackHeaders
    const rowDataFromLine1: Record<string, string> = {}
    firstRow.forEach((val, idx) => {
      const headerName = fallbackHeaders[idx] || ''
      // ค่าหลังช่องว่างแรก = data จริง (เช่น "SiteCode MECUD" → "MECUD")
      const spaceIdx = val.indexOf(' ')
      const dataValue = spaceIdx >= 0 ? val.substring(spaceIdx + 1).trim() : ''
      rowDataFromLine1[headerName] = dataValue
    })
    rows.push(rowDataFromLine1)
    startIdx = 1 // row 2 เป็นข้อมูลปกติ
  } else {
    headers = firstRow
    startIdx = 1
  }

  // อ่านข้อมูลจากแถวถัดไป
  for (let i = startIdx; i < lines.length; i++) {
    const values = parseCsvLine(lines[i])
    while (values.length < headers.length) values.push('')
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = values[idx] || ''
    })
    rows.push(row)
  }

  return rows
}

function clean(val: string | undefined | null): string | null {
  if (val == null) return null
  const trimmed = String(val).trim()
  if (trimmed === '' || trimmed === 'undefined' || trimmed === 'null') return null
  return trimmed
}

function parseBool(val: string | undefined | null): boolean {
  if (val == null) return false
  const v = String(val).trim().toUpperCase()
  return v === 'TRUE' || v === '1' || v === 'YES' || v === 'Y'
}

function parseInt0(val: string | undefined | null): number {
  if (val == null) return 0
  const n = parseInt(String(val).trim(), 10)
  return isNaN(n) ? 0 : n
}

function parseFloat0(val: string | undefined | null): number {
  if (val == null) return 0
  const n = parseFloat(String(val).trim())
  return isNaN(n) ? 0 : n
}

async function importAuditLog() {
  console.log('📜 Importing Audit_Log (v2)...')
  const csv = await fetchSheet('Audit_Log')
  const rows = parseCsvWithFallback(csv, FALLBACK_HEADERS['Audit_Log'])
  console.log(`   พบ ${rows.length} แถว`)
  let inserted = 0, skipped = 0
  for (const row of rows) {
    try {
      const action = clean(row['Action'])
      if (!action) { skipped++; continue }
      await db.auditLog.create({
        data: {
          timestamp: clean(row['Timestamp']),
          action,
          user: clean(row['User']),
          details: clean(row['Details']),
        },
      })
      inserted++
    } catch (e) { skipped++ }
  }
  console.log(`   ✅ inserted: ${inserted}, skipped: ${skipped}`)
}

async function importSiteAttributes() {
  console.log('🏢 Importing Site_Attributes (v2)...')
  const csv = await fetchSheet('Site_Attributes')
  const rows = parseCsvWithFallback(csv, FALLBACK_HEADERS['Site_Attributes'])
  console.log(`   พบ ${rows.length} แถว`)
  let inserted = 0, skipped = 0
  for (const row of rows) {
    try {
      const siteCode = clean(row['SiteCode'])
      if (!siteCode) { skipped++; continue }
      await db.siteAttribute.upsert({
        where: { siteCode },
        create: {
          siteCode,
          siteName: clean(row['SiteName']),
          lineOa: clean(row['LineOA']),
          hotline: clean(row['Hotline']),
          paperRateBw: parseFloat0(row['PaperRateBW']) || 0.5,
          paperRateColor: parseFloat0(row['PaperRateColor']) || 2.0,
        },
        update: {
          siteName: clean(row['SiteName']),
          lineOa: clean(row['LineOA']),
          hotline: clean(row['Hotline']),
          paperRateBw: parseFloat0(row['PaperRateBW']) || 0.5,
          paperRateColor: parseFloat0(row['PaperRateColor']) || 2.0,
        },
      })
      inserted++
    } catch (e) { skipped++ }
  }
  console.log(`   ✅ inserted: ${inserted}, skipped: ${skipped}`)
}

async function importAppSettings() {
  console.log('⚙️ Importing App_Settings (v2)...')
  const csv = await fetchSheet('App_Settings')
  const rows = parseCsvWithFallback(csv, FALLBACK_HEADERS['App_Settings'])
  console.log(`   พบ ${rows.length} แถว`)
  let inserted = 0, skipped = 0
  for (const row of rows) {
    try {
      const key = clean(row['Key'])
      if (!key) { skipped++; continue }
      await db.appSetting.upsert({
        where: { key },
        create: { key, value: clean(row['Value']), description: clean(row['Description']) },
        update: { value: clean(row['Value']), description: clean(row['Description']) },
      })
      inserted++
    } catch (e) { skipped++ }
  }
  console.log(`   ✅ inserted: ${inserted}, skipped: ${skipped}`)
}

async function main() {
  console.log('🚀 เริ่ม import 3 sheets ที่มีปัญหา (v2)\n')
  await importAuditLog()
  await importSiteAttributes()
  await importAppSettings()
  console.log('\n✨ Import v2 เสร็จสิ้น!')
  console.log('\n📊 สรุป:')
  console.log('   AuditLogs:', await db.auditLog.count())
  console.log('   SiteAttributes:', await db.siteAttribute.count())
  console.log('   AppSettings:', await db.appSetting.count())
}

main()
  .catch((e) => { console.error('❌ Import failed:', e); process.exit(1) })
  .finally(() => db.$disconnect())
