/**
 * scripts/create-rbac-tables.ts
 *
 * Create the 5 missing RBAC tables on production ITAM-DB:
 *   1. Site — สาขา (UDH, NKP, CNX, BKK-1, HQ, PPIT)
 *   2. Role — บทบาท (superadmin, manager, staff, coordinator, viewer)
 *   3. Permission — permission catalog (26 permissions)
 *   4. RolePermission — mapping role → permissions
 *   5. UserSiteGrant — การมอบสิทธิ์ผู้ใช้ต่อสาขา
 *
 * Then seed initial data:
 *   - 6 Sites from MasterItem
 *   - 5 Roles
 *   - 26 Permissions
 *   - RolePermission mappings
 *   - UserSiteGrant for admin (ALL sites, superadmin)
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
console.log(`🔌 Connecting to: ${poolUrl.replace(/:[^:@]+@/, ':****@')}`)

const db = new PrismaClient({
  datasources: { db: { url: poolUrl } },
  log: ['error', 'warn'],
})

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Create RBAC tables (Site, Role, Permission, RolePermission, UserSiteGrant)')
  console.log('═══════════════════════════════════════════════════════════════')

  // ── Step 1: Create tables (idempotent) ──
  console.log('\n📊 Step 1: Create tables...')

  // 1. Site
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Site" (
      "id" TEXT NOT NULL,
      "code" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "address" TEXT,
      "phone" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
    )
  `)
  await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Site_code_key" ON "Site"("code")`)
  console.log('  ✅ Site table')

  // 2. Role
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Role" (
      "code" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "isSystem" BOOLEAN NOT NULL DEFAULT false,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "Role_pkey" PRIMARY KEY ("code")
    )
  `)
  console.log('  ✅ Role table')

  // 3. Permission
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Permission" (
      "code" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "category" TEXT,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Permission_pkey" PRIMARY KEY ("code")
    )
  `)
  console.log('  ✅ Permission table')

  // 4. RolePermission
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "RolePermission" (
      "roleCode" TEXT NOT NULL,
      "permissionCode" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleCode", "permissionCode")
    )
  `)
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "RolePermission_roleCode_idx" ON "RolePermission"("roleCode")`)
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "RolePermission_permissionCode_idx" ON "RolePermission"("permissionCode")`)
  console.log('  ✅ RolePermission table')

  // 5. UserSiteGrant
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "UserSiteGrant" (
      "userId" TEXT NOT NULL,
      "siteCode" TEXT NOT NULL,
      "roleCode" TEXT NOT NULL DEFAULT 'viewer',
      "active" BOOLEAN NOT NULL DEFAULT true,
      "validFrom" TIMESTAMP(3),
      "validUntil" TIMESTAMP(3),
      "createdBy" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "UserSiteGrant_pkey" PRIMARY KEY ("userId", "siteCode")
    )
  `)
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UserSiteGrant_siteCode_active_idx" ON "UserSiteGrant"("siteCode", "active")`)
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UserSiteGrant_userId_active_idx" ON "UserSiteGrant"("userId", "active")`)
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UserSiteGrant_roleCode_active_idx" ON "UserSiteGrant"("roleCode", "active")`)
  console.log('  ✅ UserSiteGrant table')

  // ── Step 2: Seed Sites (from MasterItem) ──
  console.log('\n🌱 Step 2: Seed Sites from MasterItem...')
  const sites = await db.masterItem.findMany({
    where: { category: 'Site' },
    select: { code: true, label: true, siteCode: true },
  })
  for (const s of sites) {
    await db.$executeRawUnsafe(`
      INSERT INTO "Site" ("id", "code", "name", "createdAt")
      VALUES (gen_random_uuid()::text, $1, $2, NOW())
      ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name"
    `, s.code, s.label)
  }
  console.log(`  ✅ Seeded ${sites.length} Sites`)
  for (const s of sites) {
    console.log(`     ${s.code}: ${s.label}`)
  }

  // ── Step 3: Seed Roles ──
  console.log('\n🌱 Step 3: Seed Roles...')
  const ROLES = [
    { code: 'superadmin', name: 'ผู้ดูแลระบบ', description: 'สิทธิ์ทั้งหมด', isSystem: true },
    { code: 'manager', name: 'ผู้จัดการ', description: 'ดูรายงาน + อนุมัติ', isSystem: true },
    { code: 'staff', name: 'ช่างเทคนิค', description: 'แก้ไขอุปกรณ์ + จัดการใบงาน + เบิกของ', isSystem: true },
    { code: 'coordinator', name: 'ผู้ประสานงาน', description: 'แจ้งซ่อม + ดูใบงานตัวเอง', isSystem: true },
    { code: 'viewer', name: 'ผู้ดู', description: 'ดูข้อมูลได้อย่างเดียว', isSystem: true },
  ]
  for (const r of ROLES) {
    await db.$executeRawUnsafe(`
      INSERT INTO "Role" ("code", "name", "description", "isSystem", "active", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, true, NOW(), NOW())
      ON CONFLICT ("code") DO UPDATE SET
        "name" = EXCLUDED."name",
        "description" = EXCLUDED."description",
        "isSystem" = EXCLUDED."isSystem",
        "updatedAt" = NOW()
    `, r.code, r.name, r.description, r.isSystem)
  }
  console.log(`  ✅ Seeded ${ROLES.length} Roles`)

  // ── Step 4: Seed Permissions ──
  console.log('\n🌱 Step 4: Seed Permissions (26)...')
  const PERMISSIONS = [
    // Devices
    { code: 'devices:view', name: 'ดูอุปกรณ์', category: 'Devices' },
    { code: 'devices:edit', name: 'แก้ไขอุปกรณ์', category: 'Devices' },
    { code: 'devices:delete', name: 'ลบอุปกรณ์', category: 'Devices' },
    { code: 'devices:transfer', name: 'ย้ายอุปกรณ์', category: 'Devices' },
    { code: 'meter:write', name: 'จดมิเตอร์', category: 'Devices' },
    // Work Orders
    { code: 'wo:create', name: 'แจ้งซ่อม', category: 'WorkOrders' },
    { code: 'wo:view:all', name: 'ดูทุกใบงาน', category: 'WorkOrders' },
    { code: 'wo:view:site', name: 'ดูใบงานสาขาตัวเอง', category: 'WorkOrders' },
    { code: 'wo:view:own', name: 'ดูใบงานที่ตัวเองแจ้ง', category: 'WorkOrders' },
    { code: 'wo:assign', name: 'มอบหมายงาน', category: 'WorkOrders' },
    { code: 'wo:update', name: 'อัปเดตสถานะ', category: 'WorkOrders' },
    { code: 'wo:complete', name: 'ปิดงาน', category: 'WorkOrders' },
    { code: 'wo:cancel', name: 'ยกเลิกงาน', category: 'WorkOrders' },
    { code: 'wo:unlock', name: 'ปลดล็อกแก้ไข', category: 'WorkOrders' },
    // Stock
    { code: 'stock:view', name: 'ดูสต็อก', category: 'Stock' },
    { code: 'stock:in', name: 'รับเข้า', category: 'Stock' },
    { code: 'stock:out', name: 'เบิกออก', category: 'Stock' },
    { code: 'stock:approve', name: 'อนุมัติเบิก', category: 'Stock' },
    { code: 'stock:adjust', name: 'ปรับปรุง', category: 'Stock' },
    // Purchase Orders
    { code: 'po:create', name: 'สร้างใบสั่งซื้อ', category: 'PurchaseOrders' },
    { code: 'po:approve', name: 'อนุมัติใบสั่งซื้อ', category: 'PurchaseOrders' },
    // Reports
    { code: 'dashboard:view', name: 'ดูแดชบอร์ด', category: 'Reports' },
    { code: 'reports:view', name: 'ดูรายงาน', category: 'Reports' },
    { code: 'reports:export', name: 'ส่งออกรายงาน', category: 'Reports' },
    // Admin
    { code: 'users:manage', name: 'จัดการผู้ใช้', category: 'Admin' },
    { code: 'settings:manage', name: 'จัดการตั้งค่า', category: 'Admin' },
    { code: 'templates:manage', name: 'จัดการเทมเพลต', category: 'Admin' },
    { code: 'import:data', name: 'นำเข้าข้อมูล', category: 'Admin' },
  ]
  for (const p of PERMISSIONS) {
    await db.$executeRawUnsafe(`
      INSERT INTO "Permission" ("code", "name", "description", "category", "active", "createdAt")
      VALUES ($1, $2, $3, $4, true, NOW())
      ON CONFLICT ("code") DO UPDATE SET
        "name" = EXCLUDED."name",
        "category" = EXCLUDED."category",
        "active" = true
    `, p.code, p.name, p.name, p.category)
  }
  console.log(`  ✅ Seeded ${PERMISSIONS.length} Permissions`)

  // ── Step 5: Seed RolePermission mappings ──
  console.log('\n🌱 Step 5: Seed RolePermission mappings...')
  const ROLE_PERMS: Record<string, string[]> = {
    superadmin: PERMISSIONS.map(p => p.code), // all
    manager: ['dashboard:view', 'reports:view', 'reports:export', 'devices:view', 'wo:view:all', 'stock:view', 'po:approve'],
    staff: ['dashboard:view', 'devices:view', 'devices:edit', 'wo:create', 'wo:view:all', 'wo:update', 'wo:complete', 'stock:view', 'stock:out'],
    coordinator: ['dashboard:view', 'wo:create', 'wo:view:own'],
    viewer: ['dashboard:view', 'devices:view', 'wo:view:site', 'stock:view'],
  }
  let permCount = 0
  for (const [roleCode, perms] of Object.entries(ROLE_PERMS)) {
    for (const permCode of perms) {
      await db.$executeRawUnsafe(`
        INSERT INTO "RolePermission" ("roleCode", "permissionCode", "createdAt")
        VALUES ($1, $2, NOW())
        ON CONFLICT ("roleCode", "permissionCode") DO NOTHING
      `, roleCode, permCode)
      permCount++
    }
  }
  console.log(`  ✅ Seeded ${permCount} RolePermission mappings`)

  // ── Step 6: Seed UserSiteGrant for admin ──
  console.log('\n🌱 Step 6: Seed UserSiteGrant for admin...')
  // Find admin user
  const adminUser = await db.user.findFirst({
    where: { username: 'admin' },
    select: { id: true, username: true, email: true },
  })
  if (adminUser) {
    // Grant admin access to all Sites
    for (const s of sites) {
      await db.$executeRawUnsafe(`
        INSERT INTO "UserSiteGrant" ("userId", "siteCode", "roleCode", "active", "createdBy", "createdAt", "updatedAt")
        VALUES ($1, $2, 'superadmin', true, 'system', NOW(), NOW())
        ON CONFLICT ("userId", "siteCode") DO UPDATE SET
          "roleCode" = 'superadmin',
          "active" = true,
          "updatedAt" = NOW()
      `, adminUser.id, s.code)
    }
    console.log(`  ✅ Granted admin (${adminUser.email}) access to ${sites.length} Sites as superadmin`)
  } else {
    console.log('  ⚠️  Admin user not found')
  }

  // ── Step 7: Verify ──
  console.log('\n✅ Step 7: Verify...')
  const siteCount = await db.$queryRawUnsafe(`SELECT COUNT(*)::int as c FROM "Site"`)
  const roleCount = await db.$queryRawUnsafe(`SELECT COUNT(*)::int as c FROM "Role"`)
  const permCountDb = await db.$queryRawUnsafe(`SELECT COUNT(*)::int as c FROM "Permission"`)
  const rpCount = await db.$queryRawUnsafe(`SELECT COUNT(*)::int as c FROM "RolePermission"`)
  const grantCount = await db.$queryRawUnsafe(`SELECT COUNT(*)::int as c FROM "UserSiteGrant"`)

  console.log(`  Sites: ${siteCount[0].c}`)
  console.log(`  Roles: ${roleCount[0].c}`)
  console.log(`  Permissions: ${permCountDb[0].c}`)
  console.log(`  RolePermissions: ${rpCount[0].c}`)
  console.log(`  UserSiteGrants: ${grantCount[0].c}`)

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  ✅ COMPLETE — RBAC tables created + seeded')
  console.log('═══════════════════════════════════════════════════════════════')
}

main()
  .catch((e) => {
    console.error('❌ FATAL:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
