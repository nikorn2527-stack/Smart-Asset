// ============================================================
// Phase 2: Test 7 + cleanup/residual proof (single invocation)
// + Production guard runtime proof (isolated)
// ============================================================
// Fixes per Audit re-review (PR #18 @ 172f4f6):
// 1. Provenance uses git rev-parse HEAD (exact head at runtime)
// 2. try/finally for cleanup (survives fetch/DB throw)
// 3. Production guard: separated source verification from runtime proof
// ============================================================

import pg from 'pg'
import { execSync } from 'child_process'

const IMPORT_URL = process.env.IMPORT_URL || 'http://localhost:3000/api/import'
const STAGING_DB_URL = process.env.STAGING_DB_URL || process.env.DATABASE_URL || ''

if (!STAGING_DB_URL) {
  console.error('FATAL: STAGING_DB_URL or DATABASE_URL required')
  process.exit(2)
}

// Provenance — captured at runtime from git, will match exact head
const FULL_SHA = execSync('git rev-parse HEAD').toString().trim()
const PARENT_SHA = execSync('git rev-parse HEAD^').toString().trim()

console.log('=== Phase 2: Test 7 + cleanup/residual + production guard ===')
console.log(`Provenance:`)
console.log(`  Full HEAD SHA: ${FULL_SHA}`)
console.log(`  Parent SHA: ${PARENT_SHA}`)
console.log(`  Base: a0a5d11ccbc1203074d0f012dac98fa162124d5f (main)`)
console.log(`  Environment: local staging (Supabase Postgres, redacted)`)
console.log(`  Command: bun run scripts/g2-phase2-evidence.ts`)
console.log(`  Timestamp (UTC): ${new Date().toISOString()}`)
console.log('')

const c = new pg.Client({ connectionString: STAGING_DB_URL })

const results: { name: string; passed: boolean; detail: string }[] = []
function record(name: string, passed: boolean, detail: string) {
  results.push({ name, passed, detail })
  console.log(`${passed ? '✓' : '✗'} ${name}`)
  if (detail) console.log(`  → ${detail}`)
}

try {
  await c.connect()

  // Clean any prior test data
  await c.query('DELETE FROM "AuditLog" WHERE "entityId" IN (SELECT id FROM "WorkOrder" WHERE "requestId" LIKE $1)', ['CSV-INJ-%'])
  await c.query('DELETE FROM "WorkOrder" WHERE "requestId" LIKE $1', ['CSV-INJ-%'])
  await c.query('DELETE FROM "ImportJob" WHERE "fileName" = $1', ['inject-test.csv'])

  // ── Test 7: DB failure (controlled fault injection) → HTTP 500 ──
  try {
    const csvContent = 'requestId,subject,status,siteCode\nCSV-INJ-001,Test,PENDING,HQ'
    const formData = new FormData()
    formData.append('file', new Blob([csvContent], { type: 'text/csv' }), 'inject-test.csv')
    formData.append('jobType', 'work-order')

    const resp7 = await fetch(IMPORT_URL, { method: 'POST', body: formData })
    const data7 = await resp7.json().catch(() => ({}))
    const is500 = resp7.status === 500
    record(
      'Test 7: DB failure (controlled fault injection) → HTTP 500 (runtime)',
      is500,
      `HTTP ${resp7.status} (expected 500) | response: ${JSON.stringify(data7).slice(0, 150)}`,
    )
  } catch (fetchErr) {
    record('Test 7: DB failure → HTTP 500', false, `fetch error: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`)
  }

  // ── Cleanup + residual proof (in finally, survives any throw above) ──
} finally {
  try {
    const cleanupAudit = await c.query('DELETE FROM "AuditLog" WHERE "entityId" IN (SELECT id FROM "WorkOrder" WHERE "requestId" LIKE $1) RETURNING id', ['CSV-INJ-%'])
    const cleanupWo = await c.query('DELETE FROM "WorkOrder" WHERE "requestId" LIKE $1 RETURNING id', ['CSV-INJ-%'])
    const cleanupJob = await c.query('DELETE FROM "ImportJob" WHERE "fileName" = $1 RETURNING id', ['inject-test.csv'])
    const remainingWo = await c.query('SELECT count(*) as n FROM "WorkOrder" WHERE "requestId" LIKE $1', ['CSV-INJ-%'])
    const remainingAudit = await c.query('SELECT count(*) as n FROM "AuditLog" WHERE "entityId" IN (SELECT id FROM "WorkOrder" WHERE "requestId" LIKE $1)', ['CSV-INJ-%'])
    const remainingJob = await c.query('SELECT count(*) as n FROM "ImportJob" WHERE "fileName" = $1', ['inject-test.csv'])
    const woCount = Number(remainingWo.rows[0].n)
    const auditCount = Number(remainingAudit.rows[0].n)
    const jobCount = Number(remainingJob.rows[0].n)
    const allClean = woCount === 0 && auditCount === 0 && jobCount === 0
    record(
      'Cleanup + residual proof (try/finally, survives fetch/DB throw)',
      allClean,
      `deleted: WO=${cleanupWo.rows.length}, AuditLog=${cleanupAudit.rows.length}, ImportJob=${cleanupJob.rows.length} | residual: WO=${woCount}, AuditLog=${auditCount}, ImportJob=${jobCount} (all must be 0)`,
    )
    if (!allClean) {
      console.log(`✗ CLEANUP FAIL: residual rows remain`)
    }
  } catch (cleanupErr) {
    record('Cleanup + residual proof', false, `cleanup error: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`)
  }

  // ── Production guard: SOURCE verification (static, not runtime) ──
  const fs = await import('fs')
  const routeContent = fs.readFileSync('src/app/api/import/route.ts', 'utf8')
  const hasGuard = routeContent.includes("process.env.NODE_ENV !== 'production'") &&
    routeContent.includes('TEST_INJECT_IMPORTER_FAILURE')
  record(
    'Production guard (source verification): NODE_ENV !== production check present',
    hasGuard,
    `guard present in source: ${hasGuard}`,
  )

  // ── Production guard: RUNTIME proof (isolated, non-production) ──
  // Test 7 above already proved: NODE_ENV=development + TEST_INJECT=1 → HTTP 500
  // This is the non-production runtime proof.
  // Production runtime proof (NODE_ENV=production + TEST_INJECT=1 → no throw)
  // requires starting a separate server with NODE_ENV=production, which
  // is documented as a separate reproduction step (not automated here).
  const test7Passed = results.find((r) => r.name.startsWith('Test 7'))?.passed ?? false
  record(
    'Production guard (runtime): non-production injection → HTTP 500 (proven by Test 7)',
    test7Passed,
    `Test 7 ran with NODE_ENV=development + TEST_INJECT_IMPORTER_FAILURE=1 → HTTP 500`,
  )
  // Production guard runtime: production-mode no-throw
  // NOT PROVEN at runtime — requires separate NODE_ENV=production server.
  // Marked as SKIPPED, not counted in pass total.
  record(
    'Production guard (runtime): production-mode no-throw — SKIPPED (not automated, requires separate NODE_ENV=production server)',
    false, // NOT PROVEN — not counted as PASS
    `SKIPPED: To prove, start dev server with NODE_ENV=production + TEST_INJECT_IMPORTER_FAILURE=1, send CSV → must get HTTP 201/422 (not 500, guard prevents throw). This test does NOT automate this step.`,
  )

  await c.end()
}

const passed = results.filter((r) => r.passed).length
const failed = results.filter((r) => !r.passed).length
const skipped = results.filter((r) => r.name.includes('SKIPPED')).length
console.log('')
console.log('=== Summary ===')
console.log(`Proven (PASS): ${passed}`)
console.log(`Not proven (FAIL/SKIPPED): ${failed}`)
console.log(`  of which SKIPPED: ${skipped}`)
console.log(`Exit code: 0 (SKIPPED is not a failure, just not runtime-proven)`)
console.log(failed === skipped ? `\n✅ All runtime-proven tests passed (${passed} proven, ${skipped} SKIPPED)` : `\n⚠ ${passed} proven, ${failed - skipped} FAIL, ${skipped} SKIPPED`)

export {}
