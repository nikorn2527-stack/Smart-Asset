// ============================================================
// prisma/seed.ts — Test data seed for CI
// ============================================================
// Called by: npx tsx prisma/seed.ts
// Creates minimal Site + User data for sync tests
// ============================================================

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding test data...')

  // Check if already seeded
  const siteCount = await prisma.site.count()
  if (siteCount > 0) {
    console.log('Database already has data, skipping seed')
    return
  }

  // Roles (F-03 fix: B4 auth tests create UserSiteGrant with roleCode
  // referencing Role table — without Role records, P2003 foreign key
  // violation occurs)
  await prisma.role.createMany({
    data: [
      { code: 'superadmin', name: 'Super Admin', isSystem: true },
      { code: 'admin', name: 'Administrator', isSystem: true },
      { code: 'editor', name: 'Editor', isSystem: true },
      { code: 'viewer', name: 'Viewer', isSystem: true },
      { code: 'site_manager', name: 'Site Manager', isSystem: true },
      { code: 'coordinator', name: 'Coordinator', isSystem: true },
      { code: 'technician', name: 'Technician', isSystem: true },
      { code: 'requester', name: 'Requester', isSystem: true },
    ],
  })
  console.log('Created 8 roles')

  // Sites (includes UDH + NKP which B4 auth tests expect)
  await prisma.site.createMany({
    data: [
      { code: 'HQ', name: 'สำนักงานใหญ่' },
      { code: 'BKK-1', name: 'สาขากรุงเทพ 1' },
      { code: 'CNX', name: 'สาขาเชียงใหม่' },
      { code: 'UDH', name: 'Udon Thani' },
      { code: 'NKP', name: 'Nakhon Pathom' },
    ],
  })
  console.log('Created 5 sites (incl. UDH + NKP for B4 tests)')

  // Users (admin for each site)
  const bcrypt = await import('bcryptjs')
  const hash = await bcrypt.hash('test1234', 10)

  await prisma.user.createMany({
    data: [
      {
        email: 'admin@itam.local',
        role: 'admin',
        name: 'Test Admin',
        username: 'admin',
        passwordHash: hash,
        passwordSalt: 'test',
        allowedSites: 'HQ,BKK-1,CNX',
        active: true,
      },
      {
        email: 'superadmin@itam.local',
        role: 'superadmin',
        name: 'Test Superadmin',
        username: 'superadmin',
        passwordHash: hash,
        passwordSalt: 'test',
        allowedSites: 'ALL',
        active: true,
      },
      {
        email: 'viewer@itam.local',
        role: 'viewer',
        name: 'Test Viewer',
        username: 'viewer',
        passwordHash: hash,
        passwordSalt: 'test',
        allowedSites: 'HQ',
        active: true,
      },
    ],
  })
  console.log('Created 3 users')

  // Sample WorkOrder for conflict/idempotency tests
  await prisma.workOrder.createMany({
    data: [
      {
        requestId: 'WO-TEST-001',
        subject: 'Test Work Order 1',
        status: 'PENDING',
        siteCode: 'HQ',
        priority: 'NORMAL',
      },
      {
        requestId: 'WO-TEST-002',
        subject: 'Test Work Order 2',
        status: 'IN_PROGRESS',
        siteCode: 'BKK-1',
        priority: 'HIGH',
      },
    ],
  })
  console.log('Created 2 test WorkOrders')

  console.log('Seed complete')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
