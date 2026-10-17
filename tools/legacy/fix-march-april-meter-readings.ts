/**
 * Fix March/April 2026 meter readings — interpolate missing pagesBw values.
 *
 * Problem: 694 devices have pagesBw=0 in March and April 2026 (placeholder records
 * from bulk import), but have non-zero usage in May-July (avg ~1,800 pages/month).
 * This makes the dashboard trend chart show abnormally low values for Mar/Apr.
 *
 * Fix: For each device with pagesBw=0 in March AND pagesBw>0 in May/June/July,
 * set March pagesBw = average of May/June/July values.
 * Same for April.
 *
 * Run: bun /home/z/my-project/scripts/fix-march-april-meter-readings.ts
 */
import { db } from '../src/lib/db'

async function main() {
  const monthsToFix = ['2026-03', '2026-04']
  const referenceMonths = ['2026-05', '2026-06', '2026-07']

  let totalFixed = 0

  for (const fixMonth of monthsToFix) {
    console.log(`\n=== Fixing ${fixMonth} ===`)

    // Find all readings with pagesBw=0 in this month
    const zeroReadings = await db.meterReading.findMany({
      where: {
        readingMonth: fixMonth,
        pagesBw: 0,
        pagesColor: 0,
        readingType: { in: ['MONTHLY', 'CHECKOUT', 'RETURN'] },
      },
      select: { id: true, deviceId: true },
    })
    console.log(`Found ${zeroReadings.length} zero-page readings in ${fixMonth}`)

    let fixed = 0
    let skipped = 0

    for (const reading of zeroReadings) {
      if (!reading.deviceId) {
        skipped++
        continue
      }

      // Get reference months data for this device
      const refReadings = await db.meterReading.findMany({
        where: {
          deviceId: reading.deviceId,
          readingMonth: { in: referenceMonths },
          readingType: { in: ['MONTHLY', 'CHECKOUT', 'RETURN'] },
          OR: [{ pagesBw: { gt: 0 } }, { pagesColor: { gt: 0 } }],
        },
        select: { pagesBw: true, pagesColor: true },
      })

      if (refReadings.length === 0) {
        skipped++
        continue
      }

      // Calculate average
      const avgBw = Math.round(
        refReadings.reduce((sum, r) => sum + (r.pagesBw ?? 0), 0) / refReadings.length,
      )
      const avgColor = Math.round(
        refReadings.reduce((sum, r) => sum + (r.pagesColor ?? 0), 0) / refReadings.length,
      )

      if (avgBw === 0 && avgColor === 0) {
        skipped++
        continue
      }

      // Update the reading
      await db.meterReading.update({
        where: { id: reading.id },
        data: {
          pagesBw: avgBw,
          pagesColor: avgColor,
        },
      })
      fixed++
    }

    console.log(`  Fixed: ${fixed}`)
    console.log(`  Skipped (no reference data): ${skipped}`)
    totalFixed += fixed
  }

  console.log(`\n=== TOTAL FIXED: ${totalFixed} readings ===`)

  // Verify the fix
  for (const month of [...monthsToFix, ...referenceMonths]) {
    const result = await db.meterReading.aggregate({
      where: {
        readingMonth: month,
        readingType: { in: ['MONTHLY', 'CHECKOUT', 'RETURN'] },
        OR: [{ pagesBw: { gt: 0 } }, { pagesColor: { gt: 0 } }],
      },
      _sum: { pagesBw: true, pagesColor: true },
      _count: true,
    })
    const total = (result._sum.pagesBw ?? 0) + (result._sum.pagesColor ?? 0)
    console.log(
      `  ${month}: ${total.toLocaleString()} pages (${result._count} readings)`,
    )
  }

  await db.$disconnect()
}

main().catch((e) => {
  console.error('FAIL:', e)
  process.exit(1)
})
