/**
 * Create PMSchedule + PMExecution tables + indexes.
 * Run: bun /home/z/my-project/scripts/create-pm-tables.ts
 */
import { db } from '../src/lib/db'

async function main() {
  // Check if tables already exist
  const existing = await db.$queryRaw`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('PMSchedule', 'PMExecution')
  `
  const exists = (existing as { table_name: string }[]).map((r) => r.table_name)
  console.log('Existing tables:', exists)

  if (!exists.includes('PMSchedule')) {
    console.log('Creating PMSchedule table...')
    await db.$executeRawUnsafe(`
      CREATE TABLE "PMSchedule" (
        "id" TEXT NOT NULL,
        "scheduleNo" TEXT,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "frequency" TEXT NOT NULL DEFAULT 'monthly',
        "intervalDays" INTEGER,
        "dayOfMonth" INTEGER,
        "weekday" TEXT,
        "startMonth" INTEGER,
        "deviceType" TEXT,
        "site" TEXT,
        "deviceId" TEXT,
        "checklist" TEXT,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "startDate" TEXT,
        "lastRunDate" TEXT,
        "nextRunDate" TEXT,
        "autoCreateWO" BOOLEAN NOT NULL DEFAULT false,
        "assignedTo" TEXT,
        "createdBy" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "PMSchedule_pkey" PRIMARY KEY ("id")
      )
    `)
    await db.$executeRawUnsafe(`CREATE UNIQUE INDEX "PMSchedule_scheduleNo_key" ON "PMSchedule"("scheduleNo")`)
    await db.$executeRawUnsafe(`CREATE INDEX "PMSchedule_active_nextRunDate_idx" ON "PMSchedule"("active", "nextRunDate")`)
    await db.$executeRawUnsafe(`CREATE INDEX "PMSchedule_frequency_idx" ON "PMSchedule"("frequency")`)
    await db.$executeRawUnsafe(`CREATE INDEX "PMSchedule_site_idx" ON "PMSchedule"("site")`)
    await db.$executeRawUnsafe(`CREATE INDEX "PMSchedule_deviceType_idx" ON "PMSchedule"("deviceType")`)
    await db.$executeRawUnsafe(`CREATE INDEX "PMSchedule_deviceId_idx" ON "PMSchedule"("deviceId")`)
    await db.$executeRawUnsafe(`ALTER TABLE "PMSchedule" ADD CONSTRAINT "PMSchedule_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE`)
    console.log('  ✓ PMSchedule created')
  } else {
    console.log('  SKIP PMSchedule (already exists)')
  }

  if (!exists.includes('PMExecution')) {
    console.log('Creating PMExecution table...')
    await db.$executeRawUnsafe(`
      CREATE TABLE "PMExecution" (
        "id" TEXT NOT NULL,
        "scheduleId" TEXT NOT NULL,
        "workOrderId" TEXT,
        "scheduledDate" TEXT NOT NULL,
        "executedDate" TEXT,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "checklistResult" TEXT,
        "remark" TEXT,
        "performedBy" TEXT,
        "images" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "PMExecution_pkey" PRIMARY KEY ("id")
      )
    `)
    await db.$executeRawUnsafe(`CREATE INDEX "PMExecution_scheduleId_scheduledDate_idx" ON "PMExecution"("scheduleId", "scheduledDate")`)
    await db.$executeRawUnsafe(`CREATE INDEX "PMExecution_status_idx" ON "PMExecution"("status")`)
    await db.$executeRawUnsafe(`CREATE INDEX "PMExecution_scheduledDate_idx" ON "PMExecution"("scheduledDate")`)
    await db.$executeRawUnsafe(`ALTER TABLE "PMExecution" ADD CONSTRAINT "PMExecution_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "PMSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE`)
    console.log('  ✓ PMExecution created')
  } else {
    console.log('  SKIP PMExecution (already exists)')
  }

  console.log('DONE')
  await db.$disconnect()
}

main().catch((e) => {
  console.error('FAIL:', e)
  process.exit(1)
})
