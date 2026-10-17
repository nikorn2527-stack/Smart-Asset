import { PrismaClient } from '@prisma/client'

function buildPoolUrl(raw: string): string {
  let u = raw
  if (/\.pooler\.supabase\.com:5432(\/|\?|$)/.test(u)) {
    u = u.replace('.pooler.supabase.com:5432', '.pooler.supabase.com:6543')
  }
  const extras: string[] = []
  if (!u.includes('connection_limit=')) extras.push('connection_limit=3')
  if (!u.includes('pool_timeout=')) extras.push('pool_timeout=30')
  if (/\.pooler\.supabase\.com/.test(u) && !u.includes('pgbouncer=')) extras.push('pgbouncer=true')
  if (!extras.length) return u
  return u + (u.includes('?') ? '&' : '?') + extras.join('&')
}

const db = new PrismaClient({
  datasources: { db: { url: buildPoolUrl(process.env.ITAM_DB_URL!) } },
  log: ['error'],
})

async function main() {
  // Device Type/Brand/Model columns state
  const cols = await db.$queryRaw`
    SELECT
      COUNT(*) FILTER (WHERE "type" IS NOT NULL AND "type" != '') as has_legacy_type,
      COUNT(*) FILTER (WHERE brand IS NOT NULL AND brand != '') as has_legacy_brand,
      COUNT(*) FILTER (WHERE model IS NOT NULL AND model != '') as has_legacy_model,
      COUNT(*) FILTER (WHERE "typeId" IS NOT NULL) as has_typeId,
      COUNT(*) FILTER (WHERE "brandId" IS NOT NULL) as has_brandId,
      COUNT(*) FILTER (WHERE "modelId" IS NOT NULL) as has_modelId,
      COUNT(*) as total
    FROM "Device"
  ` as any
  const c = cols[0]
  console.log('=== Device Type/Brand/Model columns state ===')
  console.log(`Total devices: ${c.total}`)
  console.log(`Legacy type:   ${c.has_legacy_type}  | typeId FK:    ${c.has_typeId}`)
  console.log(`Legacy brand:  ${c.has_legacy_brand} | brandId FK:   ${c.has_brandId}`)
  console.log(`Legacy model:  ${c.has_legacy_model} | modelId FK:   ${c.has_modelId}`)
  console.log('')

  // Composite match check — use "type" column (not "deviceType" in DB)
  const composite = await db.$queryRaw`
    WITH device_combo AS (
      SELECT DISTINCT brand, model, "type" as device_type
      FROM "Device"
      WHERE brand IS NOT NULL AND brand != ''
        AND model IS NOT NULL AND model != ''
        AND "type" IS NOT NULL AND "type" != ''
    )
    SELECT
      COUNT(*) as total_combos,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM "DeviceType" dt
        JOIN "Brand" b ON b."typeId" = dt.id
        JOIN "Model" m ON m."brandId" = b.id
        WHERE dt.name = dc.device_type AND b.name = dc.brand AND m.name = dc.model
      )) as exact_match
    FROM device_combo dc
  ` as any
  const cb = composite[0]
  console.log('=== Composite match analysis ===')
  const totalCombos = Number(cb.total_combos)
  const exactMatch = Number(cb.exact_match)
  console.log(`Distinct Brand+Model+Type combos in Device: ${totalCombos}`)
  console.log(`Combos exist in normalized tables: ${exactMatch}`)
  console.log(`Coverage: ${totalCombos > 0 ? Math.round((exactMatch / totalCombos) * 100) : 0}%`)
  console.log('')

  // parentRef analysis
  const deptWithParent = await db.masterItem.findMany({
    where: {
      category: 'Department',
      NOT: { OR: [{ parentRef: null }, { parentRef: '' }] },
    },
    select: { parentRef: true },
  })
  const uniqueParents = [...new Set(deptWithParent.map((d) => d.parentRef))]
  console.log('=== Affiliation (parentRef) check ===')
  console.log(`Departments with parentRef: ${deptWithParent.length}/458`)
  console.log(`Unique parentRef values: ${uniqueParents.length}`)
  const looksLikeCode = uniqueParents.filter((p) => /^[A-Z]{2,4}-\d/.test(p || ''))
  const looksLikeText = uniqueParents.filter((p) => !/^[A-Z]{2,4}-\d/.test(p || ''))
  console.log(`Look like codes (AFF-001): ${looksLikeCode.length}`)
  console.log(`Look like display text: ${looksLikeText.length}`)
  console.log('Sample parentRef:')
  for (const p of uniqueParents.slice(0, 8)) {
    console.log(`  "${p}"`)
  }
  console.log('')

  // Stock category
  console.log('=== Stock category (current) ===')
  const stock = await db.stockItem.findMany({ select: { category: true, quantity: true } })
  const byCat: Record<string, { count: number; qty: number }> = {}
  for (const s of stock) {
    const c = s.category || '(empty)'
    if (!byCat[c]) byCat[c] = { count: 0, qty: 0 }
    byCat[c].count++
    byCat[c].qty += s.quantity
  }
  for (const [c, info] of Object.entries(byCat).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${c}: ${info.count} items, qty=${info.qty}`)
  }

  // WorkOrder subjects
  console.log('')
  console.log('=== WorkOrder subject sample ===')
  const wo = await db.workOrder.findMany({
    select: { subject: true, resolution: true, resolutionGroup: true },
    take: 10,
  })
  for (const w of wo.slice(0, 5)) {
    console.log(`  subject: "${w.subject?.slice(0, 60)}" | resolution: "${w.resolution ?? '(empty)'}"`)
  }
}

main()
  .catch((e) => {
    console.error('ERR:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
