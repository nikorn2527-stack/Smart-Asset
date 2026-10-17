/**
 * Seed default templates into the DocumentTemplate table.
 * Idempotent — only seeds when a template type has zero entries.
 *
 * Usage: bun run scripts/seed-default-templates.ts
 */
import { db } from '../src/lib/db'
import { ALL_DEFAULT_TEMPLATES } from '../src/lib/default-templates'

async function main() {
  console.log('🌱 Seeding default templates...\n')

  let created = 0
  let skipped = 0

  for (const tmpl of ALL_DEFAULT_TEMPLATES) {
    // Check if any template of this type already exists
    const existing = await db.documentTemplate.findFirst({
      where: { type: tmpl.type, isDefault: true },
    })

    if (existing) {
      console.log(`  ⏭️  ${tmpl.type}: "${tmpl.name}" — already exists (skip)`)
      skipped++
      continue
    }

    // Create the template
    const created2 = await db.documentTemplate.create({
      data: {
        name: tmpl.name,
        type: tmpl.type,
        category: tmpl.category ?? null,
        content: tmpl.content,
        isActive: true,
        isDefault: true,
        isFixed: false,
      },
    })

    console.log(`  ✅ ${tmpl.type}: "${tmpl.name}" — created (id=${created2.id.slice(0, 8)}...)`)
    created++
  }

  console.log(`\n📊 Done: ${created} created, ${skipped} skipped`)
  await db.$disconnect()
}

main().catch(async (e) => {
  console.error('❌ Seed failed:', e)
  await db.$disconnect()
  process.exit(1)
})
