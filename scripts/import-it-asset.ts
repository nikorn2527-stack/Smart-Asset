/**
 * Import IT-Asset CSV — ดึงข้อมูลอุปกรณ์จาก Google Sheets export
 */

import { db } from '@/lib/db'
import { parseCsv, mapCsvRow, FIELD_MAPPINGS } from '@/lib/csv-mapping'
import * as fs from 'fs'
import * as path from 'path'

async function main() {
  const csvPath = path.join(process.cwd(), 'upload', 'IT_Asset_Management_Database - All_Devices.csv')
  const csvText = fs.readFileSync(csvPath, 'utf-8')
  const rows = parseCsv(csvText)

  console.log(`📊 Parsed ${rows.length} rows from CSV`)

  let inserted = 0
  let updated = 0
  let errors = 0

  for (let i = 0; i < rows.length; i++) {
    try {
      const { mapped } = mapCsvRow(rows[i], FIELD_MAPPINGS.device)
      const assetCode = String(mapped.assetCode || '').trim()
      if (!assetCode) { errors++; continue }

      const meterRequired = String(mapped.meterRequired).toUpperCase() === 'TRUE' || String(mapped.meterRequired) === '1'
      const brand = String(mapped.brand || '')
      const model = String(mapped.model || '')

      const data = {
        assetCode,
        name: `${brand} ${model}`.trim() || assetCode,
        brand: brand || 'Unknown',
        model: model || 'Unknown',
        type: String(mapped.type || 'OTHER'),
        serialNumber: String(mapped.serialNumber || '') || null,
        status: String(mapped.status || 'Active'),
        site: String(mapped.site || ''),
        department: String(mapped.department || '') || null,
        departmentCode: String(mapped.departmentCode || '') || null,
        displayLabel: String(mapped.displayLabel || '') || null,
        location: String(mapped.location || '') || null,
        building: String(mapped.building || '') || null,
        floor: String(mapped.floor || '') || null,
        contractNo: String(mapped.contractNo || '') || null,
        ip: String(mapped.ip || '') || null,
        mac: String(mapped.mac || '') || null,
        remoteId: String(mapped.remoteId || '') || null,
        purchaseDate: String(mapped.purchaseDate || '') || null,
        uninstallDate: String(mapped.uninstallDate || '') || null,
        warrantyEnd: String(mapped.warrantyEnd || '') || null,
        vendor: String(mapped.vendor || '') || null,
        deviceGroup: String(mapped.deviceGroup || '') || null,
        costCenter: String(mapped.costCenter || '') || null,
        meterRequired,
        meterMode: String(mapped.meterMode || '') || null,
        remark: String(mapped.remark || '') || null,
        updatedBy: String(mapped.updatedBy || 'System'),
      }

      const existing = await db.device.findUnique({ where: { assetCode } })
      if (existing) { await db.device.update({ where: { assetCode }, data }); updated++ }
      else { await db.device.create({ data }); inserted++ }

      if ((i + 1) % 500 === 0) console.log(`  ... ${i + 1}/${rows.length} (ins: ${inserted}, upd: ${updated})`)
    } catch (err) {
      errors++
    }
  }

  console.log(`\n✅ Inserted: ${inserted}, Updated: ${updated}, Errors: ${errors}`)
  console.log(`📦 Total in DB: ${await db.device.count()}`)
}

main().then(() => db.$disconnect()).catch((e) => { console.error(e); db.$disconnect(); process.exit(1) })
