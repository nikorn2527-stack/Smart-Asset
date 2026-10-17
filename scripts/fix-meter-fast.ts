/**
 * Fix March/April 2026 — fast batch version
 * Uses raw SQL for speed (original script was too slow with per-row Prisma updates).
 */
import { db } from '../src/lib/db'

async function main() {
  const monthsToFix = ['2026-03', '2026-04']
  const referenceMonths = ['2026-05', '2026-06', '2026-07']

  for (const fixMonth of monthsToFix) {
    console.log(`\n=== Fixing ${fixMonth} ===`)

    // Use raw SQL to update all at once
    const result = await db.$executeRawUnsafe(`
      UPDATE "MeterReading" mr
      SET "pagesBw" = sub.avg_bw,
          "pagesColor" = sub.avg_color
      FROM (
        SELECT 
          zr."id" as reading_id,
          COALESCE(ROUND(AVG(ref."pagesBw")), 0) as avg_bw,
          COALESCE(ROUND(AVG(ref."pagesColor")), 0) as avg_color
        FROM "MeterReading" zr
        JOIN "MeterReading" ref ON ref."deviceId" = zr."deviceId"
          AND ref."readingMonth" IN ('2026-05', '2026-06', '2026-07')
          AND ref."readingType" IN ('MONTHLY', 'CHECKOUT', 'RETURN')
          AND (ref."pagesBw" > 0 OR ref."pagesColor" > 0)
        WHERE zr."readingMonth" = '${fixMonth}'
          AND zr."pagesBw" = 0
          AND zr."pagesColor" = 0
          AND zr."readingType" IN ('MONTHLY', 'CHECKOUT', 'RETURN')
        GROUP BY zr."id"
        HAVING COALESCE(ROUND(AVG(ref."pagesBw")), 0) > 0 
            OR COALESCE(ROUND(AVG(ref."pagesColor")), 0) > 0
      ) sub
      WHERE mr."id" = sub.reading_id
    `)

    console.log(`  Updated: ${result} rows`)

    // Verify
    const agg = await db.meterReading.aggregate({
      where: {
        readingMonth: fixMonth,
        readingType: { in: ['MONTHLY', 'CHECKOUT', 'RETURN'] },
        OR: [{ pagesBw: { gt: 0 } }, { pagesColor: { gt: 0 } }],
      },
      _sum: { pagesBw: true, pagesColor: true },
      _count: true,
    })
    const total = (agg._sum.pagesBw ?? 0) + (agg._sum.pagesColor ?? 0)
    console.log(`  ${fixMonth}: ${total.toLocaleString()} pages (${agg._count} readings)`)
  }

  // Final summary
  console.log('\n=== Final 6-month trend ===')
  for (const month of ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']) {
    const agg = await db.meterReading.aggregate({
      where: {
        readingMonth: month,
        readingType: { in: ['MONTHLY', 'CHECKOUT', 'RETURN'] },
        OR: [{ pagesBw: { gt: 0 } }, { pagesColor: { gt: 0 } }],
      },
      _sum: { pagesBw: true, pagesColor: true },
    })
    const total = (agg._sum.pagesBw ?? 0) + (agg._sum.pagesColor ?? 0)
    console.log(`  ${month}: ${total.toLocaleString()} pages`)
  }

  await db.$disconnect()
}

main().catch((e) => {
  console.error('FAIL:', e)
  process.exit(1)
})
