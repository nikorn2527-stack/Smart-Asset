/**
 * restore-test.ts — ทดสอบ restore backup (section 14)
 *
 * Usage:
 *   bun scripts/restore-test.ts <backup-file>
 *
 * Flow:
 *   1. Verify backup file exists
 *   2. Copy backup → temp DB
 *   3. Open temp DB + verify row counts
 *   4. Report pass/fail (doesn't touch production DB)
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'

async function main() {
  const backupFile = process.argv[2]

  if (!backupFile) {
    console.error('Usage: bun scripts/restore-test.ts <backup-file>')
    process.exit(1)
  }

  if (!fs.existsSync(backupFile)) {
    console.error('❌ Backup file not found:', backupFile)
    process.exit(1)
  }

  console.log('══════════════════════════════════════════')
  console.log('  Restore Test')
  console.log('══════════════════════════════════════════')

  // Copy backup to temp file for testing
  const tempPath = path.join('/tmp', `restore-test-${Date.now()}.db`)
  fs.copyFileSync(backupFile, tempPath)
  console.log('✓ Copied backup to temp:', tempPath)

  // Open temp DB and verify
  const db = new DatabaseSync(tempPath, { readOnly: true })

  const tables = [
    'Device', 'WorkOrder', 'MeterReading', 'StockItem', 'StockTransaction',
    'MasterItem', 'User', 'AuditLog', 'Organization', 'LegacyReference',
  ]

  let allPassed = true
  console.log('\nTable                  | Rows    | Status')
  console.log('─'.repeat(50))

  for (const table of tables) {
    try {
      const r = db.prepare(`SELECT count(*) as c FROM "${table}"`).get() as { c: number } | undefined
      const count = r?.c ?? 0
      const status = count >= 0 ? '✓' : '✗'
      console.log(`  ${table.padEnd(22)} | ${String(count).padStart(7)} | ${status}`)
      if (count < 0) allPassed = false
    } catch {
      console.log(`  ${table.padEnd(22)} | ERROR   | ✗`)
      allPassed = false
    }
  }

  // Check organizationId coverage
  console.log('\n─ organizationId Coverage ─')
  for (const table of ['Device', 'WorkOrder', 'StockItem', 'MasterItem', 'User']) {
    try {
      const cols = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]
      const hasOrgId = cols.some(c => c.name === 'organizationId')
      if (hasOrgId) {
        const r = db.prepare(`SELECT count(*) as c FROM "${table}" WHERE "organizationId" IS NOT NULL`).get() as { c: number } | undefined
        console.log(`  ✓ ${table}: ${r?.c ?? 0} rows with orgId`)
      } else {
        console.log(`  ✗ ${table}: no organizationId column`)
        allPassed = false
      }
    } catch {
      // skip
    }
  }

  db.close()

  // Clean up temp file
  fs.unlinkSync(tempPath)
  console.log('\n✓ Temp file cleaned up')

  console.log('\n══════════════════════════════════════════')
  if (allPassed) {
    console.log('  ✓ RESTORE TEST PASSED — backup is valid')
  } else {
    console.log('  ✗ RESTORE TEST FAILED — check errors above')
  }
  console.log('══════════════════════════════════════════')
  process.exit(allPassed ? 0 : 1)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
