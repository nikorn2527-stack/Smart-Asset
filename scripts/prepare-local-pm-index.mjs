/** Add the PM occurrence uniqueness index safely on existing LOCAL SQLite databases. */
import { PrismaClient } from '@prisma/client';
if (!process.env.DATABASE_URL?.startsWith('file:') || process.env.NODE_ENV === 'production') {
  throw new Error('This migration helper is for local SQLite development only.');
}
const db = new PrismaClient();
try {
  await db.$transaction(async tx => {
    const tables = await tx.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name='PMExecution'");
    if (tables.length === 0) return; // Fresh database: db push will create the table/index together.
    const duplicates = await tx.$queryRawUnsafe('SELECT "scheduleId", "scheduledDate" FROM "PMExecution" GROUP BY "scheduleId", "scheduledDate" HAVING COUNT(*) > 1 LIMIT 1');
    if (duplicates.length) throw new Error('Duplicate PM occurrences exist. Database preserved; review and reconcile duplicates before migration.');
    await tx.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "PMExecution_scheduleId_scheduledDate_key" ON "PMExecution" ("scheduleId", "scheduledDate")');
  });
} finally { await db.$disconnect(); }
