import 'dotenv/config'
import { db } from '../src/lib/db'

async function main() {
  const byCat = await db.masterItem.groupBy({
    by: ['category'],
    _count: true,
    orderBy: { category: 'asc' },
  })
  console.log('=== MasterItem by category ===')
  for (const c of byCat) console.log(`${c.category}: ${c._count}`)

  console.log('\n=== DeviceGroup items ===')
  const dgs = await db.masterItem.findMany({
    where: { category: 'DeviceGroup' },
    select: { code: true, label: true, active: true },
  })
  for (const d of dgs) console.log(`  code=${d.code} label=${d.label} active=${d.active}`)

  console.log('\n=== Affiliation items (first 5) ===')
  const aff = await db.masterItem.findMany({
    where: { category: 'Affiliation' },
    select: { code: true, label: true, parentRef: true },
    take: 5,
  })
  for (const a of aff) console.log(`  code=${a.code} label=${a.label} parentRef=${a.parentRef ?? '-'}`)

  console.log('\n=== Sample Department items (first 10) ===')
  const deps = await db.masterItem.findMany({
    where: { category: 'Department' },
    select: { code: true, label: true, parentRef: true },
    take: 10,
  })
  for (const d of deps) console.log(`  code=${d.code} label=${d.label} parentRef=${d.parentRef ?? '-'}`)

  console.log('\n=== Sample DeviceClassification items ===')
  const cls = await db.masterItem.findMany({
    where: { category: 'DeviceClassification' },
    select: { code: true, label: true, deviceType: true, brand: true, model: true, parentRef: true },
    take: 10,
  })
  for (const c of cls) console.log(`  code=${c.code} label=${c.label} type=${c.deviceType} brand=${c.brand} model=${c.model} parentRef=${c.parentRef ?? '-'}`)

  console.log('\n=== Latest assetCode (max) ===')
  const latest = await db.device.findFirst({
    orderBy: { assetCode: 'desc' },
    select: { assetCode: true, name: true, site: true },
  })
  console.log(`  assetCode=${latest?.assetCode} name=${latest?.name} site=${latest?.site}`)

  console.log('\n=== Latest assetSiteCode for UDH ===')
  const latestUdh = await db.device.findFirst({
    where: { OR: [{ site: 'UDH' }, { assetSiteCode: { startsWith: 'UDH-' } }] },
    orderBy: { assetSiteCode: 'desc' },
    select: { assetCode: true, assetSiteCode: true, site: true },
  })
  console.log(`  ${JSON.stringify(latestUdh)}`)

  console.log('\n=== Device counts by site (top 8) ===')
  const bySite = await db.device.groupBy({ by: ['site'], _count: true, orderBy: { _count: { site: 'desc' } }, take: 8 })
  for (const s of bySite) console.log(`  site=${s.site} count=${s._count.site}`)

  // Check sample DeviceClassification to understand parentRef structure
  console.log('\n=== Sample DeviceClassification with parentRef structure ===')
  const clsParent = await db.masterItem.findMany({
    where: { category: 'DeviceClassification', parentRef: { not: null } },
    select: { code: true, label: true, deviceType: true, brand: true, model: true, parentRef: true },
    take: 5,
  })
  for (const c of clsParent) console.log(`  code=${c.code} type=${c.deviceType} brand=${c.brand} model=${c.model} parentRef=${c.parentRef}`)

  await db.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
