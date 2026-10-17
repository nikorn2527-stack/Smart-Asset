/**
 * backfill-wo-numbers.ts — Backfill woNumber for WorkOrders that have null woNumber.
 *
 * Bug #WO-001 from QA batch 1: ~99% of demo WOs had null woNumber.
 * This script reads the active WoPattern and generates a woNumber for each
 * WO that doesn't have one.
 *
 * Usage:
 *   bun run scripts/backfill-wo-numbers.ts
 *
 * Safe to re-run — only updates WOs where woNumber IS NULL.
 */
import { PrismaClient } from '@prisma/client'
import { generateWoNumberFromPattern, getActiveWoPattern } from '../src/lib/wo-number-pattern'

const db = new PrismaClient()

async function main() {
  console.log('🔧 Backfilling woNumber for WorkOrders with null woNumber...\n')

  const pattern = await getActiveWoPattern()
  if (!pattern) {
    console.log('⚠️  No active WoPattern found. Using fallback "PPIT-XXXXXX".')
  } else {
    console.log(`📋 Active pattern: ${pattern.name} → ${pattern.pattern}`)
  }

  // Find all WOs with null woNumber
  const wos = await db.workOrder.findMany({
    where: { woNumber: null },
    select: { id: true, systemJobNo: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`Found ${wos.length} WorkOrder(s) with null woNumber.\n`)

  if (wos.length === 0) {
    console.log('✅ Nothing to backfill — all WorkOrders already have woNumber.')
    return
  }

  let updated = 0
  let failed = 0

  for (const wo of wos) {
    let woNumber: string | null = null

    if (pattern) {
      woNumber = await generateWoNumberFromPattern(pattern)
    }

    // Fallback: PPIT-XXXXXX (6-digit padded)
    if (!woNumber) {
      const seq = String(5000 + updated).padStart(6, '0')
      woNumber = `PPIT-${seq}`
    }

    // Verify uniqueness
    const exists = await db.workOrder.findFirst({
      where: { OR: [{ id: woNumber }, { woNumber }], NOT: { id: wo.id } },
      select: { id: true },
    })
    if (exists) {
      // Append random 4 chars if collision
      const rnd = Math.random().toString(36).slice(2, 6).toUpperCase()
      woNumber = `${woNumber}-${rnd}`
    }

    try {
      await db.workOrder.update({
        where: { id: wo.id },
        data: { woNumber, systemJobNo: wo.systemJobNo ?? woNumber },
      })
      updated++
      if (updated <= 5 || updated % 50 === 0) {
        console.log(`  [${updated}/${wos.length}] ${wo.id.slice(-8)} → ${woNumber}`)
      }
    } catch (e) {
      failed++
      console.error(`  ✗ Failed: ${wo.id} → ${(e as Error).message}`)
    }
  }

  console.log(`\n════════════════════════════════════════════`)
  console.log(`✓ Updated: ${updated}`)
  console.log(`✗ Failed:  ${failed}`)
  console.log(`════════════════════════════════════════════`)
}

main()
  .catch((e) => {
    console.error('Fatal:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
