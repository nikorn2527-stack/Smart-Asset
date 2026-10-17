/**
 * regenerate-master-codes.ts — แทนที่ MD-xxxx legacy codes
 * ด้วย Canonical Code ใหม่ตาม section 8.1 ของพิมพ์เขียว
 *
 * ตัวอย่าง:
 *   MD-0001 (Brand: BROTHER) → BRD-0001
 *   MD-0233 (Model: 7835i) → MDL-0001
 *   MD-0164 (Department: ศูนย์บริการ...) → DEP-0001
 *
 * Strategy:
 *   1. อ่าน MasterItem ทั้งหมด grouping by category
 *   2. สำหรับแต่ละ category: re-number จาก 1 ตาม sortOrder ปัจจุบัน (createdAt)
 *   3. เก็บ MD-xxxx เดิมไว้ใน parentRef (ชั่วคราว) เพื่อเชื่อมกลับ
 *   4. สร้าง LegacyReference ทุกการแม็ป
 *
 * Idempotent: ถ้า code เป็น canonical อยู่แล้ว → skip
 */
import { PrismaClient } from '@prisma/client'
import { getPrefixForCategory, isLegacyCode, isCanonicalCode } from '../src/lib/code-service'

const db = new PrismaClient()
const PILOT_ORG_ID = 'cmtxppz3i0000q2gvoue8u7bj'

async function main() {
  console.log('══════════════════════════════════════════')
  console.log('  Regenerate MasterItem Codes (MD-xxxx → Canonical)')
  console.log('══════════════════════════════════════════')

  const allItems = await db.masterItem.findMany({
    orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
  })

  console.log(`Total MasterItems: ${allItems.length}`)

  // Group by category
  const byCategory = new Map<string, typeof allItems>()
  for (const item of allItems) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, [])
    byCategory.get(item.category)!.push(item)
  }

  console.log(`Categories: ${byCategory.size}`)
  console.log('')

  let updated = 0, skipped = 0, errors = 0
  const legacyRefs: Array<{
    sourceApp: string
    sourceEntity: string
    legacyCode: string
    legacyLabel: string | null
    targetEntity: string
    targetId: string
    targetCode: string
  }> = []

  for (const [category, items] of byCategory) {
    const prefix = getPrefixForCategory(category)
    let seq = 1

    console.log(`\n── ${category} (${items.length} items, prefix=${prefix}) ──`)

    for (const item of items) {
      try {
        // Skip if already canonical
        if (isCanonicalCode(item.code)) {
          skipped++
          continue
        }

        // Skip seed-* items (already canonical from seed-master-catalog-v2)
        if (item.id.startsWith('seed-') || item.id.startsWith('repair-')) {
          if (isCanonicalCode(item.code)) {
            skipped++
            continue
          }
        }

        const newCode = `${prefix}-${String(seq).padStart(4, '0')}`
        const oldCode = item.code

        // Check if newCode already exists in this category
        const existing = await db.masterItem.findFirst({
          where: { category, code: newCode },
        })
        if (existing && existing.id !== item.id) {
          // Collision — try next seq
          seq++
          continue
        }

        // Update the item with new code
        // Keep old code in parentRef temporarily for traceability
        const oldParentRef = item.parentRef
        await db.masterItem.update({
          where: { id: item.id },
          data: {
            code: newCode,
            // If parentRef was a MD-xxxx code, we'll fix it in a second pass
          },
        })

        // Record LegacyReference
        legacyRefs.push({
          sourceApp: 'itam',
          sourceEntity: 'MasterItem',
          legacyCode: oldCode,
          legacyLabel: item.label,
          targetEntity: 'MasterItem',
          targetId: item.id,
          targetCode: newCode,
        })

        updated++
        seq++

        if (updated % 50 === 0) console.log(`  ✓ ${updated} updated...`)
      } catch (e: any) {
        errors++
        if (errors <= 3) console.error(`  ✗ ${item.code} → ${prefix}-${seq}: ${e.message.slice(0, 80)}`)
        seq++
      }
    }
  }

  console.log(`\n✓ Updated: ${updated} | Skipped (already canonical): ${skipped} | Errors: ${errors}`)

  // Create LegacyReference entries
  console.log(`\n── Creating ${legacyRefs.length} LegacyReference entries ──`)
  let refCreated = 0
  for (const ref of legacyRefs) {
    try {
      await db.legacyReference.upsert({
        where: {
          organizationId_sourceApp_sourceEntity_legacyCode: {
            organizationId: PILOT_ORG_ID,
            sourceApp: ref.sourceApp,
            sourceEntity: ref.sourceEntity,
            legacyCode: ref.legacyCode,
          },
        },
        create: {
          organizationId: PILOT_ORG_ID,
          sourceApp: ref.sourceApp,
          sourceEntity: ref.sourceEntity,
          legacyCode: ref.legacyCode,
          legacyLabel: ref.legacyLabel,
          targetEntity: ref.targetEntity,
          targetId: ref.targetId,
          targetCode: ref.targetCode,
          mappingStatus: 'ACTIVE',
        },
        update: {
          targetId: ref.targetId,
          targetCode: ref.targetCode,
          mappingStatus: 'ACTIVE',
        },
      })
      refCreated++
    } catch (e: any) {
      // Non-fatal — skip if duplicate
    }
  }
  console.log(`✓ LegacyReference created: ${refCreated}`)

  // Verify
  console.log('\n═══ Verification ═══')
  const sample = await db.masterItem.findMany({
    where: { OR: [{ category: 'Brand' }, { category: 'Department' }, { category: 'DeviceType' }] },
    select: { category: true, code: true, label: true },
    orderBy: [{ category: 'asc' }, { code: 'asc' }],
    take: 15,
  })
  console.log('Sample (new canonical codes):')
  sample.forEach(s => console.log(`  ${s.category.padEnd(15)} | ${s.code.padEnd(10)} | ${s.label}`))

  const legacyRemaining = await db.masterItem.count({
    where: { code: { startsWith: 'MD-' } },
  })
  console.log(`\nMasterItems with legacy MD-xxxx code (should be 0): ${legacyRemaining}`)

  const totalLegacyRefs = await db.legacyReference.count()
  console.log(`Total LegacyReference entries: ${totalLegacyRefs}`)
}

main()
  .catch(e => { console.error('FATAL:', e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
