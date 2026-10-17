/**
 * seed-all.ts — master seed script with fail-closed behavior.
 *
 * P1 Security per consultant recommendation:
 *   - Separates "production" vs "demo" seed profiles
 *   - Production profile: NO demo users, NO sample data
 *   - Demo profile: includes everything (demo users, sample data)
 *   - Fail-closed: if any required seed module fails, exit code ≠ 0
 *   - No "Seed complete" message printed unless ALL modules succeed
 *   - Demo profile is REJECTED when NODE_ENV=production
 *
 * Usage:
 *   Production profile:  ITAM_SEED_PROFILE=production bun scripts/seed-all.ts
 *   Demo profile:         ITAM_SEED_PROFILE=demo bun scripts/seed-all.ts
 *   Default (auto):       bun scripts/seed-all.ts (uses demo if NODE_ENV≠production)
 */
import { execSync } from 'child_process'

type SeedProfile = 'production' | 'demo'
type SeedModule = {
  name: string
  file: string
  required: boolean // if true, failure = exit(1)
  profile: SeedProfile | 'both' // which profiles include this
}

const profile: SeedProfile =
  process.env.ITAM_SEED_PROFILE === 'production'
    ? 'production'
    : process.env.ITAM_SEED_PROFILE === 'demo'
      ? 'demo'
      : process.env.NODE_ENV === 'production'
        ? 'production'
        : 'demo'

// Reject demo profile in production
if (profile === 'demo' && process.env.NODE_ENV === 'production') {
  console.error('❌ FATAL: Demo seed profile is not allowed in production.')
  console.error('   Set ITAM_SEED_PROFILE=production or unset NODE_ENV.')
  process.exit(1)
}

const ALL_MODULES: SeedModule[] = [
  { name: 'Authorization catalog', file: 'scripts/seed-authorization-catalog.ts', required: true, profile: 'both' },
  { name: 'Default templates', file: 'scripts/seed-default-templates.ts', required: true, profile: 'both' },
  { name: 'Master data', file: 'scripts/seed-master-data.ts', required: true, profile: 'both' },
  { name: 'Master catalog v2', file: 'scripts/seed-master-catalog-v2.ts', required: false, profile: 'both' },
  { name: 'Contact directory', file: 'scripts/seed-contact-directory.ts', required: false, profile: 'both' },
  { name: 'Notification templates', file: 'scripts/seed-notification-templates.ts', required: false, profile: 'both' },
  // Demo-only modules (NEVER in production profile)
  { name: 'Demo users', file: 'scripts/create-demo-users.js', required: false, profile: 'demo' },
  { name: 'Material cost sample', file: 'scripts/seed-material-cost.ts', required: false, profile: 'demo' },
  { name: 'Comprehensive demo', file: 'scripts/seed-comprehensive-demo.ts', required: false, profile: 'demo' },
]

const modules = ALL_MODULES.filter(
  (m) => m.profile === 'both' || m.profile === profile,
)

async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  ITAM-NextJS Master Seed Script')
  console.log(`  Profile: ${profile}`)
  console.log(`  Modules: ${modules.length}`)
  console.log('═══════════════════════════════════════════\n')

  let failures = 0
  let successes = 0

  for (const mod of modules) {
    console.log(`\n▶ ${mod.name} (${mod.file})`)
    try {
      execSync(`bun ${mod.file}`, {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: { ...process.env },
      })
      console.log(`  ✓ ${mod.name} completed`)
      successes++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`  ✗ ${mod.name} failed: ${msg}`)
      failures++
      if (mod.required) {
        // Fail-closed: required module failure = stop immediately
        console.error(`\n❌ REQUIRED module "${mod.name}" failed — aborting seed.`)
        console.error('   Fix the error above and re-run. No "Seed complete" will be printed.')
        process.exit(1)
      } else {
        console.warn(`  ⚠️ Non-required module failed — continuing to next.`)
      }
    }
  }

  console.log('\n═══════════════════════════════════════════')
  console.log(`  Seed Summary`)
  console.log(`  Profile: ${profile}`)
  console.log(`  Success: ${successes}/${modules.length}`)
  console.log(`  Failed:  ${failures}/${modules.length}`)

  if (failures > 0) {
    console.error(`\n❌ Seed completed with ${failures} failure(s).`)
    console.error('   Review the errors above before using the system.')
    process.exit(1)
  }

  console.log('\n  ✓ All modules completed successfully.')

  if (profile === 'demo') {
    console.log('  Login: demo_admin / demo123')
  } else {
    console.log('  No demo users created (production profile).')
    console.log('  Create admin: bun scripts/create-superadmin.ts')
  }
  console.log('═══════════════════════════════════════════')
}

main().catch((e) => {
  console.error('❌ Seed failed:', e)
  process.exit(1)
})
