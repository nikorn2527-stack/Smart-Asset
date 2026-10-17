/**
 * scripts/seed-master-data.ts
 *
 * Seeds the cascading master data system:
 *   • DeviceType → Brand → Model   (3 new normalized tables)
 *   • MasterItem entries for: Building, Floor, Department, DeviceGroup, Status
 *
 * Source: ./upload/IT_Asset_Management_Database - All_Devices.csv
 *
 * Idempotent: each run upserts based on natural keys (name / code+category),
 * so re-running after a CSV update won't create duplicates.
 *
 * Usage:
 *   DATABASE_URL='postgresql://…' bunx tsx scripts/seed-master-data.ts
 */

import * as fs from 'fs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ─────────────────────────────────────────────────────────────
// Site name → site code mapping (mirrors import-devices.ts)
// ─────────────────────────────────────────────────────────────
function siteNameToCode(siteName: string | null | undefined): string {
  if (!siteName) return 'HQ'
  const s = siteName.trim()
  if (s.includes('อุดร')) return 'UDH'
  if (s.includes('นครปฐม')) return 'NKP'
  if (s.includes('เชียงใหม่')) return 'CNX'
  if (s.includes('กรุงเทบ')) return 'BKK-1'
  return 'HQ'
}

// ─────────────────────────────────────────────────────────────
// Minimal RFC-4180 CSV parser (BOM-stripped, quoted fields supported)
// ─────────────────────────────────────────────────────────────
function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
      continue
    }
    if (c === ',') {
      cur.push(field)
      field = ''
      continue
    }
    if (c === '\r') {
      if (src[i + 1] === '\n') i++
      cur.push(field)
      rows.push(cur)
      cur = []
      field = ''
      continue
    }
    if (c === '\n') {
      cur.push(field)
      rows.push(cur)
      cur = []
      field = ''
      continue
    }
    field += c
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field)
    rows.push(cur)
  }
  // Drop trailing empty row
  if (
    rows.length > 0 &&
    rows[rows.length - 1].length === 1 &&
    rows[rows.length - 1][0] === ''
  ) {
    rows.pop()
  }
  return rows
}

function toStr(v: string | undefined): string | null {
  if (!v) return null
  const s = v.trim()
  return s === '' ? null : s
}

interface CsvRow {
  type: string
  brand: string
  model: string
  building: string | null
  floor: string | null
  department: string | null
  location: string | null
  deviceGroup: string | null
  status: string | null
  siteName: string | null
  siteCode: string
}

function readCsv(): CsvRow[] {
  // Try multiple candidate paths so the script works in different environments:
  //   - sandbox:    ./upload/...
  //   - cloned dev: ./upload/... (next to project root)
  //   - cloned dev: <projectRoot>/upload/...
  const candidates = [
    './upload/IT_Asset_Management_Database - All_Devices.csv',
    './upload/IT_Asset_Management_Database - All_Devices.csv',
    `${process.cwd()}/upload/IT_Asset_Management_Database - All_Devices.csv`,
  ]
  const csvPath = candidates.find((p) => fs.existsSync(p))
  if (!csvPath) {
    // CSV is optional demo data. When absent (e.g. fresh clone from GitHub),
    // return an empty array so the caller can seed a minimal fallback catalog
    // instead of aborting the entire db:seed run.
    console.warn(
      `  [seed-master-data] CSV not found in any candidate path — falling back to minimal catalog.`,
    )
    console.warn(`  Checked: ${candidates.join(', ')}`)
    return []
  }
  console.log(`  [seed-master-data] Using CSV: ${csvPath}`)
  const text = fs.readFileSync(csvPath, 'utf-8')
  const rows = parseCsv(text)
  if (rows.length < 2) {
    console.warn('  [seed-master-data] CSV has no data rows — falling back to minimal catalog.')
    return []
  }
  const headers = rows[0].map((h) => h.trim().toLowerCase())
  const idx = (name: string) => headers.indexOf(name.toLowerCase())
  const dataRows = rows.slice(1)

  return dataRows
    .map((row) => {
      const typeRaw = toStr(row[idx('device_type')]) ?? 'OTHER'
      const brandRaw = toStr(row[idx('brand')]) ?? 'Unknown'
      const modelRaw = toStr(row[idx('model')]) ?? 'Unknown'
      const siteName = toStr(row[idx('site')])
      const siteCode = siteNameToCode(siteName)
      return {
        type: typeRaw,
        brand: brandRaw,
        model: modelRaw,
        building: toStr(row[idx('building')]),
        floor: toStr(row[idx('floor')]),
        department: toStr(row[idx('department')]),
        location: toStr(row[idx('location')]),
        deviceGroup: toStr(row[idx('device_group')]),
        status: toStr(row[idx('status')]),
        siteName,
        siteCode,
      }
    })
    .filter((r) => r.type && r.brand && r.model)
}

// ─────────────────────────────────────────────────────────────
// 1) Seed DeviceType → Brand → Model
// ─────────────────────────────────────────────────────────────
async function seedTypeBrandModel(rows: CsvRow[]) {
  // Unique Type → Brand → Model combinations
  const typeMap = new Map<
    string,
    Map<string, Set<string>> // brand → Set<model>
  >()
  for (const r of rows) {
    if (!typeMap.has(r.type)) typeMap.set(r.type, new Map())
    const brandMap = typeMap.get(r.type)!
    if (!brandMap.has(r.brand)) brandMap.set(r.brand, new Set())
    brandMap.get(r.brand)!.add(r.model)
  }

  let typeCount = 0
  let brandCount = 0
  let modelCount = 0

  for (const [typeName, brandMap] of typeMap.entries()) {
    // Upsert DeviceType by unique name
    const deviceType = await prisma.deviceType.upsert({
      where: { name: typeName },
      update: { active: true },
      create: { name: typeName, active: true },
    })
    typeCount++

    for (const [brandName, modelSet] of brandMap.entries()) {
      // Upsert Brand by (name, typeId) — but Prisma's compound unique needs
      // both fields in `where`. We use findFirst + create pattern.
      let brand = await prisma.brand.findFirst({
        where: { name: brandName, typeId: deviceType.id },
      })
      if (!brand) {
        brand = await prisma.brand.create({
          data: { name: brandName, typeId: deviceType.id, active: true },
        })
      } else if (!brand.active) {
        brand = await prisma.brand.update({
          where: { id: brand.id },
          data: { active: true },
        })
      }
      brandCount++

      for (const modelName of modelSet) {
        let model = await prisma.model.findFirst({
          where: { name: modelName, brandId: brand.id },
        })
        if (!model) {
          model = await prisma.model.create({
            data: { name: modelName, brandId: brand.id, active: true },
          })
          modelCount++
        }
      }
    }
  }

  console.log(
    `[Type/Brand/Model] types=${typeCount} brands=${brandCount} models=${modelCount} (new)`,
  )
}

// ─────────────────────────────────────────────────────────────
// 2) Seed MasterItem — Buildings (per site)
//    category='Building', code=siteCode+buildingSlug, label=building, siteCode=site
// ─────────────────────────────────────────────────────────────
async function seedBuildings(rows: CsvRow[]) {
  const seen = new Set<string>() // key: `${siteCode}|${building}`
  for (const r of rows) {
    if (!r.building) continue
    seen.add(`${r.siteCode}|${r.building}`)
  }

  let inserted = 0
  for (const key of seen) {
    const [siteCode, building] = key.split('|')
    if (!building) continue
    // code is site+building slug uppercased
    const code = `${siteCode}-${building.replace(/\s+/g, '_').toUpperCase()}`.slice(0, 80)
    const existing = await prisma.masterItem.findFirst({
      where: { category: 'Building', code, siteCode },
      select: { id: true },
    })
    if (!existing) {
      await prisma.masterItem.create({
        data: {
          category: 'Building',
          code,
          label: building,
          siteCode,
          active: true,
        },
      })
      inserted++
    }
  }
  console.log(
    `[MasterItem:Building] ${inserted} new (total candidates: ${seen.size})`,
  )
}

// ─────────────────────────────────────────────────────────────
// 3) Seed MasterItem — Floors (parentRef = building name)
// ─────────────────────────────────────────────────────────────
async function seedFloors(rows: CsvRow[]) {
  const seen = new Set<string>() // key: `${siteCode}|${building}|${floor}`
  for (const r of rows) {
    if (!r.building || !r.floor) continue
    seen.add(`${r.siteCode}|${r.building}|${r.floor}`)
  }

  let inserted = 0
  for (const key of seen) {
    const [siteCode, building, floor] = key.split('|')
    if (!building || !floor) continue
    const code = `${siteCode}-${building.replace(/\s+/g, '_').toUpperCase()}-${floor.replace(/\s+/g, '_').toUpperCase()}`.slice(0, 100)
    const existing = await prisma.masterItem.findFirst({
      where: {
        category: 'Floor',
        code,
        siteCode,
        parentRef: building,
      },
      select: { id: true },
    })
    if (!existing) {
      await prisma.masterItem.create({
        data: {
          category: 'Floor',
          code,
          label: floor,
          parentRef: building,
          siteCode,
          active: true,
        },
      })
      inserted++
    }
  }
  console.log(`[MasterItem:Floor] ${inserted} new (total candidates: ${seen.size})`)
}

// ─────────────────────────────────────────────────────────────
// 4) Seed MasterItem — Departments (per site)
// ─────────────────────────────────────────────────────────────
async function seedDepartments(rows: CsvRow[]) {
  const seen = new Set<string>() // key: `${siteCode}|${department}`
  for (const r of rows) {
    if (!r.department) continue
    seen.add(`${r.siteCode}|${r.department}`)
  }

  let inserted = 0
  for (const key of seen) {
    const [siteCode, department] = key.split('|')
    if (!department) continue
    const code = `${siteCode}-${department.replace(/\s+/g, '_').slice(0, 60).toUpperCase()}`
    const existing = await prisma.masterItem.findFirst({
      where: { category: 'Department', code, siteCode },
      select: { id: true },
    })
    if (!existing) {
      await prisma.masterItem.create({
        data: {
          category: 'Department',
          code,
          label: department,
          siteCode,
          active: true,
        },
      })
      inserted++
    }
  }
  console.log(
    `[MasterItem:Department] ${inserted} new (total candidates: ${seen.size})`,
  )
}

// ─────────────────────────────────────────────────────────────
// 5) Seed MasterItem — DeviceGroups (global)
// ─────────────────────────────────────────────────────────────
async function seedDeviceGroups(rows: CsvRow[]) {
  const seen = new Set<string>()
  for (const r of rows) {
    if (!r.deviceGroup) continue
    seen.add(r.deviceGroup)
  }

  let inserted = 0
  for (const deviceGroup of seen) {
    const code = deviceGroup.replace(/\s+/g, '_').toUpperCase().slice(0, 60)
    const existing = await prisma.masterItem.findFirst({
      where: { category: 'DeviceGroup', code },
      select: { id: true },
    })
    if (!existing) {
      await prisma.masterItem.create({
        data: {
          category: 'DeviceGroup',
          code,
          label: deviceGroup,
          active: true,
        },
      })
      inserted++
    }
  }
  console.log(
    `[MasterItem:DeviceGroup] ${inserted} new (total candidates: ${seen.size})`,
  )
}

// ─────────────────────────────────────────────────────────────
// 6) Seed MasterItem — Statuses (global)
// ─────────────────────────────────────────────────────────────
async function seedStatuses(rows: CsvRow[]) {
  const seen = new Set<string>()
  for (const r of rows) {
    if (!r.status) continue
    seen.add(r.status)
  }

  let inserted = 0
  for (const status of seen) {
    const code = status.replace(/\s+/g, '_').toUpperCase().slice(0, 40)
    const existing = await prisma.masterItem.findFirst({
      where: { category: 'Status', code },
      select: { id: true },
    })
    if (!existing) {
      await prisma.masterItem.create({
        data: {
          category: 'Status',
          code,
          label: status,
          active: true,
        },
      })
      inserted++
    }
  }
  console.log(
    `[MasterItem:Status] ${inserted} new (total candidates: ${seen.size})`,
  )
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
async function main() {
  console.log('═══ seed-master-data: starting ═══')
  const rows = readCsv()
  console.log(`Loaded ${rows.length} CSV rows`)

  if (rows.length === 0) {
    // No CSV available (fresh clone without private demo data).
    // Seed a MINIMAL catalog so the app's dropdowns aren't empty.
    // The full catalog (28 categories, 64+ items) is seeded separately by
    // scripts/seed-master-catalog-v2.ts which is also called by seed-all.ts.
    console.log('  [seed-master-data] Seeding minimal MasterItem fallback...')
    const fallback: { category: string; code: string; label: string; displayLabel: string }[] = [
      // DeviceType
      { category: 'DeviceType', code: 'DT-PRINTER', label: 'ปริ้นเตอร์ (Printer)', displayLabel: 'Printer' },
      { category: 'DeviceType', code: 'DT-COMPUTER', label: 'คอมพิวเตอร์ (Computer)', displayLabel: 'Computer' },
      { category: 'DeviceType', code: 'DT-SCANNER', label: 'สแกนเนอร์ (Scanner)', displayLabel: 'Scanner' },
      // Brand
      { category: 'Brand', code: 'BRD-OTHER', label: 'อื่นๆ / Unknown', displayLabel: 'Unknown' },
      // Status
      { category: 'Status', code: 'STATUS-ACTIVE', label: 'Active', displayLabel: 'Active' },
      { category: 'Status', code: 'STATUS-IN-REPAIR', label: 'In Repair', displayLabel: 'In Repair' },
      { category: 'Status', code: 'STATUS-RETIRED', label: 'Retired', displayLabel: 'Retired' },
      { category: 'Status', code: 'STATUS-SPARE', label: 'Spare', displayLabel: 'Spare' },
    ]
    let inserted = 0
    for (const m of fallback) {
      // MasterItem has no @@unique([category, code]) constraint, so we use
      // findFirst + create (skip if exists) instead of upsert.
      // Also no sortOrder field — ordering is done in-app by code/label.
      const existing = await prisma.masterItem.findFirst({
        where: { category: m.category, code: m.code },
      })
      if (existing) {
        await prisma.masterItem.update({
          where: { id: existing.id },
          data: { label: m.label, displayLabel: m.displayLabel, active: true },
        })
        continue
      }
      await prisma.masterItem.create({
        data: {
          category: m.category,
          code: m.code,
          label: m.label,
          displayLabel: m.displayLabel,
          active: true,
        },
      })
      inserted++
    }
    console.log(`  [seed-master-data] Minimal fallback seeded (${inserted} MasterItems: DeviceType/Brand/Status).`)
    console.log('  [seed-master-data] Run seed-master-catalog-v2 for the full 28-category catalog.')
  } else {
    await seedTypeBrandModel(rows)
    await seedBuildings(rows)
    await seedFloors(rows)
    await seedDepartments(rows)
    await seedDeviceGroups(rows)
    await seedStatuses(rows)
  }

  // Final counts (all use MasterItem now — DeviceType/Brand/Model normalized
  // tables were removed from the schema; they live in MasterItem instead).
  const buildingCount = await prisma.masterItem.count({
    where: { category: 'Building' },
  })
  const floorCount = await prisma.masterItem.count({
    where: { category: 'Floor' },
  })
  const deptCount = await prisma.masterItem.count({
    where: { category: 'Department' },
  })
  const dgCount = await prisma.masterItem.count({
    where: { category: 'DeviceGroup' },
  })
  const statusCount = await prisma.masterItem.count({
    where: { category: 'Status' },
  })
  const deviceTypeCount = await prisma.masterItem.count({
    where: { category: 'DeviceType' },
  })
  const brandCount = await prisma.masterItem.count({
    where: { category: 'Brand' },
  })

  console.log('\n═══ Final DB counts ═══')
  console.log(`  DeviceType:  ${deviceTypeCount}`)
  console.log(`  Brand:       ${brandCount}`)
  console.log(`  Building:    ${buildingCount}`)
  console.log(`  Floor:       ${floorCount}`)
  console.log(`  Department:  ${deptCount}`)
  console.log(`  DeviceGroup: ${dgCount}`)
  console.log(`  Status:      ${statusCount}`)
  console.log('═══ seed-master-data: done ═══')
}

main()
  .catch((e) => {
    console.error('SEED ERROR:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
