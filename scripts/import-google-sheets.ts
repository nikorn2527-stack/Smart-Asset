/**
 * import-google-sheets.ts — ดึงข้อมูลจาก Google Sheets ใส่ Prisma database
 *
 * วิธีใช้: bun run scripts/import-google-sheets.ts
 */

import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse/sync'

const db = new PrismaClient()

const SPREADSHEET_ID = '1Zi2sDW1xeAUdHb6MSt0AdpZttRY8C3-WB5agHLaeUpc'
const BASE_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv`

const SHEETS = {
  All_Devices: 'All_Devices',
  Meter_Readings: 'Meter_Readings',
  Master_Items: 'Master_Items',
  Master_Category: 'Master_Category',
  Location_History: 'Location_History',
  Audit_Log: 'Audit_Log',
  User_Permissions: 'User_Permissions',
  Site_Attributes: 'Site_Attributes',
  App_Settings: 'App_Settings',
  License_Records: 'License_Records',
} as const

async function fetchSheet(sheetName: string): Promise<string> {
  const url = `${BASE_URL}&sheet=${encodeURIComponent(sheetName)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${sheetName}: ${res.status}`)
  return res.text()
}

function parseCsv(csvText: string): Record<string, string>[] {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  })
  return records as Record<string, string>[]
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

async function importDevices() {
  console.log('📦 Importing All_Devices...')
  const csv = await fetchSheet(SHEETS.All_Devices)
  const rows = parseCsv(csv)
  console.log(`   พบ ${rows.length} แถว`)
  let inserted = 0, skipped = 0
  for (const row of rows) {
    try {
      const assetNo = clean(row['asset_no'])
      if (!assetNo) { skipped++; continue }
      await db.device.upsert({
        where: { assetNo },
        create: {
          assetNo, deviceType: clean(row['device_type']), brand: clean(row['brand']),
          model: clean(row['model']), serial: clean(row['serial']),
          building: clean(row['building']), floor: clean(row['floor']),
          department: clean(row['department']), location: clean(row['location']),
          departmentCode: clean(row['department_code']),
          status: clean(row['status']) || 'Active', site: clean(row['site']),
          contractNo: clean(row['contract_no']), ip: clean(row['ip']), mac: clean(row['mac']),
          remoteId: clean(row['remote_id']), remark: clean(row['remark']), vendor: clean(row['vendor']),
          installDate: clean(row['install_date']), uninstallDate: clean(row['uninstall_date']),
          warrantyEnd: clean(row['warranty_end']), deviceGroup: clean(row['device_group']),
          costCenter: clean(row['cost_center']), meterRequired: parseBool(row['meter_required']),
          meterMode: clean(row['meter_mode']), assetSiteCode: clean(row['asset_site_code']),
          updatedBy: clean(row['updated_by']) || 'System',
        },
        update: {
          deviceType: clean(row['device_type']), brand: clean(row['brand']),
          model: clean(row['model']), serial: clean(row['serial']),
          building: clean(row['building']), floor: clean(row['floor']),
          department: clean(row['department']), location: clean(row['location']),
          departmentCode: clean(row['department_code']),
          status: clean(row['status']) || 'Active', site: clean(row['site']),
          contractNo: clean(row['contract_no']), ip: clean(row['ip']), mac: clean(row['mac']),
          remoteId: clean(row['remote_id']), remark: clean(row['remark']), vendor: clean(row['vendor']),
          installDate: clean(row['install_date']), uninstallDate: clean(row['uninstall_date']),
          warrantyEnd: clean(row['warranty_end']), deviceGroup: clean(row['device_group']),
          costCenter: clean(row['cost_center']), meterRequired: parseBool(row['meter_required']),
          meterMode: clean(row['meter_mode']), assetSiteCode: clean(row['asset_site_code']),
          updatedBy: clean(row['updated_by']) || 'System',
        },
      })
      inserted++
    } catch (e) { skipped++ }
  }
  console.log(`   ✅ inserted: ${inserted}, skipped: ${skipped}`)
}

async function importMeterReadings() {
  console.log('📈 Importing Meter_Readings...')
  const csv = await fetchSheet(SHEETS.Meter_Readings)
  const rows = parseCsv(csv)
  console.log(`   พบ ${rows.length} แถว`)
  let inserted = 0, skipped = 0
  for (const row of rows) {
    try {
      const assetNo = clean(row['asset_no'])
      if (!assetNo) { skipped++; continue }
      await db.meterReading.create({
        data: {
          readingId: clean(row['reading_id']), assetNo,
          readingDate: clean(row['reading_date']), readingMonth: clean(row['reading_month']),
          meterBw: parseInt0(row['meter_bw']), meterColor: parseInt0(row['meter_color']),
          pagesBw: parseInt0(row['pages_bw']), pagesColor: parseInt0(row['pages_color']),
          locationAtReading: clean(row['location_at_reading']), readBy: clean(row['read_by']),
          remark: clean(row['remark']), prevMeterBw: parseInt0(row['prev_meter_bw']),
          prevMeterColor: parseInt0(row['prev_meter_color']), readingType: clean(row['reading_type']),
          eventType: clean(row['event_type']), eventId: clean(row['event_id']),
          siteAtReading: clean(row['site_at_reading']), buildingAtReading: clean(row['building_at_reading']),
          floorAtReading: clean(row['floor_at_reading']), departmentAtReading: clean(row['department_at_reading']),
          departmentCodeAtReading: clean(row['department_code_at_reading']),
        },
      })
      inserted++
    } catch (e) { skipped++ }
  }
  console.log(`   ✅ inserted: ${inserted}, skipped: ${skipped}`)
}

async function importMasterItems() {
  console.log('📊 Importing Master_Items...')
  const csv = await fetchSheet(SHEETS.Master_Items)
  const rows = parseCsv(csv)
  console.log(`   พบ ${rows.length} แถว`)
  let inserted = 0, skipped = 0
  for (const row of rows) {
    try {
      const categoryKey = clean(row['CategoryKey'])
      const value = clean(row['Value'])
      if (!categoryKey || !value) { skipped++; continue }
      await db.masterItem.create({
        data: {
          itemId: clean(row['ItemID']), categoryKey, value,
          groupName: clean(row['GroupName']), parentRef: clean(row['ParentRef']),
          displayLabel: clean(row['DisplayLabel']), siteCode: clean(row['SiteCode']),
          allowedSites: clean(row['AllowedSites']), active: parseBool(row['Active']),
          departmentCode: clean(row['DepartmentCode']),
        },
      })
      inserted++
    } catch (e) { skipped++ }
  }
  console.log(`   ✅ inserted: ${inserted}, skipped: ${skipped}`)
}

async function importMasterCategory() {
  console.log('📋 Importing Master_Category...')
  const csv = await fetchSheet(SHEETS.Master_Category)
  const rows = parseCsv(csv)
  console.log(`   พบ ${rows.length} แถว`)
  let inserted = 0, skipped = 0
  for (const row of rows) {
    try {
      const categoryKey = clean(row['CategoryKey'])
      if (!categoryKey) { skipped++; continue }
      await db.masterCategory.upsert({
        where: { categoryKey },
        create: {
          categoryKey, displayName: clean(row['DisplayName']),
          sortOrder: parseInt0(row['SortOrder']), active: parseBool(row['Active']),
        },
        update: {
          displayName: clean(row['DisplayName']),
          sortOrder: parseInt0(row['SortOrder']), active: parseBool(row['Active']),
        },
      })
      inserted++
    } catch (e) { skipped++ }
  }
  console.log(`   ✅ inserted: ${inserted}, skipped: ${skipped}`)
}

async function importLocationHistory() {
  console.log('📍 Importing Location_History...')
  const csv = await fetchSheet(SHEETS.Location_History)
  const rows = parseCsv(csv)
  console.log(`   พบ ${rows.length} แถว`)
  let inserted = 0, skipped = 0
  for (const row of rows) {
    try {
      const assetNo = clean(row['Asset_No'])
      if (!assetNo) { skipped++; continue }
      await db.locationHistory.create({
        data: {
          logId: clean(row['Log_ID']), assetNo, moveDate: clean(row['Move_Date']),
          action: clean(row['Action']), fromStatus: clean(row['From_Status']),
          toStatus: clean(row['To_Status']), fromSite: clean(row['From_Site']),
          fromAssetSiteCode: clean(row['From_AssetSiteCode']), fromBuilding: clean(row['From_Building']),
          fromFloor: clean(row['From_Floor']), fromDepartment: clean(row['From_Department']),
          fromLocation: clean(row['From_Location']), toSite: clean(row['To_Site']),
          toAssetSiteCode: clean(row['To_AssetSiteCode']), toBuilding: clean(row['To_Building']),
          toFloor: clean(row['To_Floor']), toDepartment: clean(row['To_Department']),
          toLocation: clean(row['To_Location']), meterReadingId: clean(row['Meter_Reading_ID']),
          movedBy: clean(row['Moved_By']), remark: clean(row['Remark']),
        },
      })
      inserted++
    } catch (e) { skipped++ }
  }
  console.log(`   ✅ inserted: ${inserted}, skipped: ${skipped}`)
}

async function importAuditLog() {
  console.log('📜 Importing Audit_Log...')
  const csv = await fetchSheet(SHEETS.Audit_Log)
  const rows = parseCsv(csv)
  console.log(`   พบ ${rows.length} แถว`)
  let inserted = 0, skipped = 0
  for (const row of rows) {
    try {
      const action = clean(row['Action'])
      if (!action) { skipped++; continue }
      await db.auditLog.create({
        data: {
          timestamp: clean(row['Timestamp']), action,
          user: clean(row['User']), details: clean(row['Details']),
        },
      })
      inserted++
    } catch (e) { skipped++ }
  }
  console.log(`   ✅ inserted: ${inserted}, skipped: ${skipped}`)
}

async function importUserPermissions() {
  console.log('👥 Importing User_Permissions...')
  const csv = await fetchSheet(SHEETS.User_Permissions)
  const rows = parseCsv(csv)
  console.log(`   พบ ${rows.length} แถว`)
  let inserted = 0, skipped = 0
  for (const row of rows) {
    try {
      const email = clean(row['Email'])
      if (!email) { skipped++; continue }
      await db.userPermission.upsert({
        where: { email },
        create: {
          email, role: clean(row['Role']) || 'Viewer', active: parseBool(row['Active']),
          name: clean(row['Name']), username: clean(row['Username']),
          passwordHash: clean(row['PasswordHash']), passwordSalt: clean(row['PasswordSalt']),
          remark: clean(row['Remark']), lastLoginAt: clean(row['LastLoginAt']),
          allowedSites: clean(row['Allowed_Sites']),
        },
        update: {
          role: clean(row['Role']) || 'Viewer', active: parseBool(row['Active']),
          name: clean(row['Name']), username: clean(row['Username']),
          passwordHash: clean(row['PasswordHash']), passwordSalt: clean(row['PasswordSalt']),
          remark: clean(row['Remark']), lastLoginAt: clean(row['LastLoginAt']),
          allowedSites: clean(row['Allowed_Sites']),
        },
      })
      inserted++
    } catch (e) { skipped++ }
  }
  console.log(`   ✅ inserted: ${inserted}, skipped: ${skipped}`)
}

async function importSiteAttributes() {
  console.log('🏢 Importing Site_Attributes...')
  const csv = await fetchSheet(SHEETS.Site_Attributes)
  const rows = parseCsv(csv)
  console.log(`   พบ ${rows.length} แถว`)
  let inserted = 0, skipped = 0
  for (const row of rows) {
    try {
      const siteCode = clean(row['SiteCode'])
      if (!siteCode) { skipped++; continue }
      await db.siteAttribute.upsert({
        where: { siteCode },
        create: {
          siteCode, siteName: clean(row['SiteName']), lineOa: clean(row['LineOA']),
          hotline: clean(row['Hotline']),
          paperRateBw: parseFloat0(row['PaperRateBW']) || 0.5,
          paperRateColor: parseFloat0(row['PaperRateColor']) || 2.0,
        },
        update: {
          siteName: clean(row['SiteName']), lineOa: clean(row['LineOA']),
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
  console.log('⚙️ Importing App_Settings...')
  const csv = await fetchSheet(SHEETS.App_Settings)
  const rows = parseCsv(csv)
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

async function importLicenseRecords() {
  console.log('🔑 Importing License_Records...')
  const csv = await fetchSheet(SHEETS.License_Records)
  const rows = parseCsv(csv)
  console.log(`   พบ ${rows.length} แถว`)
  let inserted = 0, skipped = 0
  for (const row of rows) {
    try {
      const software = clean(row['Software'])
      if (!software) { skipped++; continue }
      await db.licenseRecord.create({
        data: {
          licenseId: clean(row['License_ID']), assetNo: clean(row['Asset_No']),
          software, licenseType: clean(row['LicenseType']), licenseKey: clean(row['License_Key']),
          quantity: parseInt0(row['Quantity']) || 1, expiryDate: clean(row['Expiry_Date']),
          remark: clean(row['Remark']),
        },
      })
      inserted++
    } catch (e) { skipped++ }
  }
  console.log(`   ✅ inserted: ${inserted}, skipped: ${skipped}`)
}

async function main() {
  console.log('🚀 เริ่ม import ข้อมูลจาก Google Sheets\n')
  await importDevices()
  await importMeterReadings()
  await importMasterItems()
  await importMasterCategory()
  await importLocationHistory()
  await importAuditLog()
  await importUserPermissions()
  await importSiteAttributes()
  await importAppSettings()
  await importLicenseRecords()
  console.log('\n✨ Import เสร็จสิ้น!')
  console.log('\n📊 สรุปข้อมูลใน database:')
  console.log('   Devices:', await db.device.count())
  console.log('   MeterReadings:', await db.meterReading.count())
  console.log('   MasterItems:', await db.masterItem.count())
  console.log('   MasterCategories:', await db.masterCategory.count())
  console.log('   LocationHistory:', await db.locationHistory.count())
  console.log('   AuditLogs:', await db.auditLog.count())
  console.log('   UserPermissions:', await db.userPermission.count())
  console.log('   SiteAttributes:', await db.siteAttribute.count())
  console.log('   AppSettings:', await db.appSetting.count())
  console.log('   LicenseRecords:', await db.licenseRecord.count())
}

main()
  .catch((e) => { console.error('❌ Import failed:', e); process.exit(1) })
  .finally(() => db.$disconnect())
