/**
 * scripts/fix-permission-table-schema.ts
 *
 * Permission table in DB has wrong columns (name, category) but Prisma schema
 * expects (resource, action). This script:
 * 1. DROP + RECREATE Permission table with correct columns
 * 2. Re-seed 28 permissions with resource+action derived from code (e.g. "devices:view" → resource="devices", action="view")
 * 3. Re-seed RolePermission mappings
 */

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

const rawUrl = process.env.ITAM_DB_URL ?? ''
if (!rawUrl.startsWith('postgres')) {
  console.error('❌ Missing ITAM_DB_URL')
  process.exit(1)
}
const poolUrl = buildPoolUrl(rawUrl)
const db = new PrismaClient({ datasources: { db: { url: poolUrl } }, log: ['error'] })

const PERMISSIONS = [
  // Devices
  { code: 'devices:view', resource: 'devices', action: 'view', description: 'ดูอุปกรณ์' },
  { code: 'devices:edit', resource: 'devices', action: 'edit', description: 'แก้ไขอุปกรณ์' },
  { code: 'devices:delete', resource: 'devices', action: 'delete', description: 'ลบอุปกรณ์' },
  { code: 'devices:transfer', resource: 'devices', action: 'transfer', description: 'ย้ายอุปกรณ์' },
  { code: 'meter:write', resource: 'meter', action: 'write', description: 'จดมิเตอร์' },
  // Work Orders
  { code: 'wo:create', resource: 'work_orders', action: 'create', description: 'แจ้งซ่อม' },
  { code: 'wo:view:all', resource: 'work_orders', action: 'view:all', description: 'ดูทุกใบงาน' },
  { code: 'wo:view:site', resource: 'work_orders', action: 'view:site', description: 'ดูใบงานสาขาตัวเอง' },
  { code: 'wo:view:own', resource: 'work_orders', action: 'view:own', description: 'ดูใบงานที่ตัวเองแจ้ง' },
  { code: 'wo:assign', resource: 'work_orders', action: 'assign', description: 'มอบหมายงาน' },
  { code: 'wo:update', resource: 'work_orders', action: 'update', description: 'อัปเดตสถานะ' },
  { code: 'wo:complete', resource: 'work_orders', action: 'complete', description: 'ปิดงาน' },
  { code: 'wo:cancel', resource: 'work_orders', action: 'cancel', description: 'ยกเลิกงาน' },
  { code: 'wo:unlock', resource: 'work_orders', action: 'unlock', description: 'ปลดล็อกแก้ไข' },
  // Stock
  { code: 'stock:view', resource: 'stock', action: 'view', description: 'ดูสต็อก' },
  { code: 'stock:in', resource: 'stock', action: 'in', description: 'รับเข้า' },
  { code: 'stock:out', resource: 'stock', action: 'out', description: 'เบิกออก' },
  { code: 'stock:approve', resource: 'stock', action: 'approve', description: 'อนุมัติเบิก' },
  { code: 'stock:adjust', resource: 'stock', action: 'adjust', description: 'ปรับปรุง' },
  // Purchase Orders
  { code: 'po:create', resource: 'purchase_orders', action: 'create', description: 'สร้างใบสั่งซื้อ' },
  { code: 'po:approve', resource: 'purchase_orders', action: 'approve', description: 'อนุมัติใบสั่งซื้อ' },
  // Reports
  { code: 'dashboard:view', resource: 'dashboard', action: 'view', description: 'ดูแดชบอร์ด' },
  { code: 'reports:view', resource: 'reports', action: 'view', description: 'ดูรายงาน' },
  { code: 'reports:export', resource: 'reports', action: 'export', description: 'ส่งออกรายงาน' },
  // Admin
  { code: 'users:manage', resource: 'users', action: 'manage', description: 'จัดการผู้ใช้' },
  { code: 'settings:manage', resource: 'settings', action: 'manage', description: 'จัดการตั้งค่า' },
  { code: 'templates:manage', resource: 'templates', action: 'manage', description: 'จัดการเทมเพลต' },
  { code: 'import:data', resource: 'import', action: 'data', description: 'นำเข้าข้อมูล' },
]

const ROLE_PERMS: Record<string, string[]> = {
  superadmin: PERMISSIONS.map(p => p.code),
  manager: ['dashboard:view', 'reports:view', 'reports:export', 'devices:view', 'wo:view:all', 'stock:view', 'po:approve'],
  staff: ['dashboard:view', 'devices:view', 'devices:edit', 'wo:create', 'wo:view:all', 'wo:update', 'wo:complete', 'stock:view', 'stock:out'],
  coordinator: ['dashboard:view', 'wo:create', 'wo:view:own'],
  viewer: ['dashboard:view', 'devices:view', 'wo:view:site', 'stock:view'],
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Fix Permission table schema (resource + action columns)')
  console.log('═══════════════════════════════════════════════════════════════')

  // Step 1: DROP Permission + RolePermission (RolePermission depends on Permission)
  console.log('\n🗑️  Step 1: DROP Permission + RolePermission...')
  await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "RolePermission" CASCADE`)
  console.log('  ✅ Dropped RolePermission')
  await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "Permission" CASCADE`)
  console.log('  ✅ Dropped Permission')

  // Step 2: CREATE Permission with correct schema (matching Prisma)
  console.log('\n📊 Step 2: CREATE Permission table (resource + action)...')
  await db.$executeRawUnsafe(`
    CREATE TABLE "Permission" (
      "code" TEXT NOT NULL,
      "resource" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "description" TEXT,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Permission_pkey" PRIMARY KEY ("code")
    )
  `)
  console.log('  ✅ Created Permission table')

  // Step 3: CREATE RolePermission
  console.log('\n📊 Step 3: CREATE RolePermission table...')
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "RolePermission" (
      "roleCode" TEXT NOT NULL,
      "permissionCode" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleCode", "permissionCode")
    )
  `)
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "RolePermission_permissionCode_idx" ON "RolePermission"("permissionCode")`)
  console.log('  ✅ Created RolePermission table')

  // Step 4: Seed Permissions
  console.log('\n🌱 Step 4: Seed Permissions (28)...')
  for (const p of PERMISSIONS) {
    await db.$executeRawUnsafe(`
      INSERT INTO "Permission" ("code", "resource", "action", "description", "active", "createdAt")
      VALUES ($1, $2, $3, $4, true, NOW())
      ON CONFLICT ("code") DO UPDATE SET
        "resource" = EXCLUDED."resource",
        "action" = EXCLUDED."action",
        "description" = EXCLUDED."description"
    `, p.code, p.resource, p.action, p.description)
  }
  console.log(`  ✅ Seeded ${PERMISSIONS.length} Permissions`)

  // Step 5: Seed RolePermission mappings
  console.log('\n🌱 Step 5: Seed RolePermission mappings...')
  let count = 0
  for (const [roleCode, perms] of Object.entries(ROLE_PERMS)) {
    for (const permCode of perms) {
      await db.$executeRawUnsafe(`
        INSERT INTO "RolePermission" ("roleCode", "permissionCode", "createdAt")
        VALUES ($1, $2, NOW())
        ON CONFLICT ("roleCode", "permissionCode") DO NOTHING
      `, roleCode, permCode)
      count++
    }
  }
  console.log(`  ✅ Seeded ${count} RolePermission mappings`)

  // Step 6: Verify
  console.log('\n✅ Step 6: Verify...')
  const pCount = await db.$queryRawUnsafe(`SELECT COUNT(*)::int as c FROM "Permission"`)
  const rpCount = await db.$queryRawUnsafe(`SELECT COUNT(*)::int as c FROM "RolePermission"`)
  const rCount = await db.$queryRawUnsafe(`SELECT COUNT(*)::int as c FROM "Role"`)
  const gCount = await db.$queryRawUnsafe(`SELECT COUNT(*)::int as c FROM "UserSiteGrant"`)
  const sCount = await db.$queryRawUnsafe(`SELECT COUNT(*)::int as c FROM "Site"`)
  console.log(`  Sites: ${sCount[0].c}`)
  console.log(`  Roles: ${rCount[0].c}`)
  console.log(`  Permissions: ${pCount[0].c}`)
  console.log(`  RolePermissions: ${rpCount[0].c}`)
  console.log(`  UserSiteGrants: ${gCount[0].c}`)

  // Sample
  const sample = await db.$queryRawUnsafe(`
    SELECT code, resource, action, description FROM "Permission" LIMIT 5
  `)
  console.log('\n  Sample Permissions:')
  for (const s of sample) {
    console.log(`    ${s.code} | resource=${s.resource} | action=${s.action} | ${s.description}`)
  }

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  ✅ COMPLETE — Permission schema fixed')
  console.log('═══════════════════════════════════════════════════════════════')
}

main()
  .catch((e) => { console.error('❌', e); process.exit(1) })
  .finally(() => db.$disconnect())
