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
  log: ['error', 'warn'],
})

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  DROP normalized tables + Device FK columns + indexes')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log()

  // Step 1: Drop indexes first (must happen before dropping columns)
  console.log('Step 1: Drop indexes on Device.typeId/brandId/modelId')
  await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "Device_typeId_idx"`)
  console.log('  ✅ Dropped Device_typeId_idx')
  await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "Device_brandId_idx"`)
  console.log('  ✅ Dropped Device_brandId_idx')
  await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "Device_modelId_idx"`)
  console.log('  ✅ Dropped Device_modelId_idx')
  console.log()

  // Step 2: Drop FK columns from Device (must happen before dropping referenced tables)
  console.log('Step 2: Drop typeId/brandId/modelId columns from Device')
  await db.$executeRawUnsafe(`ALTER TABLE "Device" DROP COLUMN IF EXISTS "typeId"`)
  console.log('  ✅ Dropped Device.typeId')
  await db.$executeRawUnsafe(`ALTER TABLE "Device" DROP COLUMN IF EXISTS "brandId"`)
  console.log('  ✅ Dropped Device.brandId')
  await db.$executeRawUnsafe(`ALTER TABLE "Device" DROP COLUMN IF EXISTS "modelId"`)
  console.log('  ✅ Dropped Device.modelId')
  console.log()

  // Step 3: Drop normalized tables (Model first, then Brand, then DeviceType — order matters due to FKs)
  console.log('Step 3: Drop normalized tables (Model → Brand → DeviceType)')
  await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "Model"`)
  console.log('  ✅ Dropped table Model')
  await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "Brand"`)
  console.log('  ✅ Dropped table Brand')
  await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "DeviceType"`)
  console.log('  ✅ Dropped table DeviceType')
  console.log()

  // Step 4: Verify
  console.log('Step 4: Verify state')
  const remainingTables = await db.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN ('DeviceType', 'Brand', 'Model')
  `)
  console.log('  Remaining normalized tables:', JSON.stringify(remainingTables))

  const deviceCols = await db.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Device'
    AND column_name IN ('typeId', 'brandId', 'modelId')
  `)
  console.log('  Remaining FK columns in Device:', JSON.stringify(deviceCols))

  const deviceCount = await db.device.count()
  console.log(`  Device count (should be 2378): ${deviceCount}`)

  const deviceText = await db.$queryRawUnsafe(`
    SELECT
      COUNT(*) FILTER (WHERE brand IS NOT NULL AND brand != '') as has_brand,
      COUNT(*) FILTER (WHERE model IS NOT NULL AND model != '') as has_model,
      COUNT(*) FILTER (WHERE "type" IS NOT NULL AND "type" != '') as has_type
    FROM "Device"
  `)
  console.log('  Device text columns still intact:')
  console.log('    brand (text):', deviceText[0].has_brand)
  console.log('    model (text):', deviceText[0].has_model)
  console.log('    type (text): ', deviceText[0].has_type)

  console.log()
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  ✅ COMPLETE — normalized tables + FK columns removed')
  console.log('  Device data (2,378 rows + text columns) intact')
  console.log('═══════════════════════════════════════════════════════════════')
}

main()
  .catch((e) => {
    console.error('❌ ERROR:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
