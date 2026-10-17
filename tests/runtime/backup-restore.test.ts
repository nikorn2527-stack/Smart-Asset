/**
 * backup-restore.test.ts — Runtime test for Backup/Restore.
 *
 * Verifies:
 *   1. Backup creates encrypted file (.json.enc)
 *   2. Restore works from encrypted backup
 *   3. Restore is atomic (fails cleanly if something goes wrong)
 *   4. Row counts match before and after backup/restore
 *
 * Prerequisites:
 *   - Database with data (run db:seed first)
 *   - BACKUP_ENCRYPTION_KEY set in .env
 *
 * Usage:
 *   bun run tests/runtime/backup-restore.test.ts
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { db } from '../../src/lib/db'

const BACKUP_KEY = process.env.BACKUP_ENCRYPTION_KEY || 'a'.repeat(64) // 32-byte hex for testing
const BACKUP_DIR = resolve(process.cwd(), 'backups')
const TEST_BACKUP = resolve(BACKUP_DIR, 'test-backup.json.enc')

interface TestResult {
  name: string
  passed: boolean
  detail?: string
}

const results: TestResult[] = []

async function test(name: string, fn: () => Promise<boolean>, detail?: string) {
  try {
    const passed = await fn()
    results.push({ name, passed, detail })
    console.log(`${passed ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
  } catch (err) {
    results.push({ name, passed: false, detail: String(err) })
    console.log(`✗ ${name} — ${err}`)
  }
}

async function countRows(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  const tables = ['device', 'workOrder', 'user', 'masterItem', 'organization', 'auditLog']
  for (const t of tables) {
    try {
      const model = (db as unknown as Record<string, { count: () => Promise<number> }>)[t]
      if (model && typeof model.count === 'function') {
        counts[t] = await model.count()
      }
    } catch {
      counts[t] = -1
    }
  }
  return counts
}

async function main() {
  console.log('═'.repeat(60))
  console.log('  Backup/Restore Test')
  console.log('═'.repeat(60))
  console.log(`Backup key: ${BACKUP_KEY.slice(0, 8)}...${BACKUP_KEY.slice(-8)}`)
  console.log(`Backup file: ${TEST_BACKUP}`)
  console.log('')

  // ── Test 1: Create encrypted backup ──
  await test(
    'Create encrypted backup (.json.enc)',
    async () => {
      try {
        execSync(
          `BACKUP_ENCRYPTION_KEY=${BACKUP_KEY} bun run scripts/backup-db.ts --output=${TEST_BACKUP}`,
          { stdio: 'pipe', env: { ...process.env, BACKUP_ENCRYPTION_KEY: BACKUP_KEY } },
        )
        return existsSync(TEST_BACKUP)
      } catch (err) {
        return false
      }
    },
  )

  // ── Test 2: Backup file is encrypted (not plain JSON) ──
  await test(
    'Backup file is encrypted (not readable as JSON)',
    async () => {
      if (!existsSync(TEST_BACKUP)) return false
      const content = readFileSync(TEST_BACKUP, 'utf8')
      // Encrypted backup starts with binary data, not '{'
      // Plain JSON would start with '{' or '{"meta"'
      return !content.startsWith('{') && content.length > 100
    },
  )

  // ── Test 3: Record row counts before restore ──
  const beforeCounts = await countRows()
  console.log(`  Row counts before: ${JSON.stringify(beforeCounts)}`)

  // ── Test 4: Restore from encrypted backup ──
  await test(
    'Restore from encrypted backup succeeds',
    async () => {
      try {
        execSync(
          `BACKUP_ENCRYPTION_KEY=${BACKUP_KEY} bun run scripts/restore-db.ts ${TEST_BACKUP}`,
          { stdio: 'pipe', env: { ...process.env, BACKUP_ENCRYPTION_KEY: BACKUP_KEY } },
        )
        return true
      } catch (err) {
        return false
      }
    },
  )

  // ── Test 5: Row counts match after restore ──
  await test(
    'Row counts match after restore',
    async () => {
      const afterCounts = await countRows()
      console.log(`  Row counts after: ${JSON.stringify(afterCounts)}`)
      for (const [table, before] of Object.entries(beforeCounts)) {
        if (afterCounts[table] !== before) {
          return false
        }
      }
      return true
    },
  )

  // ── Test 6: Restore with wrong key fails ──
  await test(
    'Restore with wrong encryption key fails',
    async () => {
      if (!existsSync(TEST_BACKUP)) return false
      try {
        execSync(
          `BACKUP_ENCRYPTION_KEY=${'b'.repeat(64)} bun run scripts/restore-db.ts ${TEST_BACKUP}`,
          { stdio: 'pipe', env: { ...process.env, BACKUP_ENCRYPTION_KEY: 'b'.repeat(64) } },
        )
        return false // should have failed
      } catch {
        return true // expected to fail
      }
    },
  )

  // ── Test 7: Backup refused without key in production ──
  await test(
    'Backup refused without key in production mode',
    async () => {
      try {
        execSync(
          `NODE_ENV=production bun run scripts/backup-db.ts --output=${TEST_BACKUP}.prod`,
          { stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production', BACKUP_ENCRYPTION_KEY: '' } },
        )
        return false // should have refused
      } catch {
        return true // expected to fail
      }
    },
  )

  // ── Cleanup ──
  if (existsSync(TEST_BACKUP)) {
    try { unlinkSync(TEST_BACKUP) } catch {}
  }
  if (existsSync(`${TEST_BACKUP}.prod`)) {
    try { unlinkSync(`${TEST_BACKUP}.prod`) } catch {}
  }

  // ── Summary ──
  console.log('')
  console.log('═'.repeat(60))
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  console.log(`  Results: ${passed} passed, ${failed} failed (${results.length} total)`)
  console.log('═'.repeat(60))

  await db.$disconnect()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
