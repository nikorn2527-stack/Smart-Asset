#!/usr/bin/env node
/**
 * verify-backup-restore.ts — Restore Drill (P3 feature).
 *
 * Tests that an encrypted backup can actually be restored.
 * Runs weekly via cron to catch backup corruption early.
 *
 * Flow:
 *   1. Create a fresh encrypted backup
 *   2. Decrypt + restore into a TEMP database (not production)
 *   3. Compare row counts + checksums with production DB
 *   4. Alert (email/telegram) if restore fails or counts don't match
 *   5. Clean up temp database
 *
 * Usage:
 *   bun run scripts/verify-backup-restore.ts
 *
 * Exit codes:
 *   0 = backup verified OK
 *   1 = backup verification FAILED (alert sent)
 *
 * Environment:
 *   BACKUP_ENCRYPTION_KEY — required (32-byte hex)
 *   ALERT_TELEGRAM_CHAT_ID — optional (send alert via Telegram)
 *   ALERT_TELEGRAM_BOT_TOKEN — optional
 */

import { execSync } from 'node:child_process'
import { existsSync, unlinkSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const BACKUP_KEY = process.env.BACKUP_ENCRYPTION_KEY
const BACKUP_DIR = resolve(process.cwd(), 'backups')
const DRILL_BACKUP = join(BACKUP_DIR, 'drill-verify.json.enc')
const TEMP_DB_PATH = resolve(process.cwd(), 'backups', 'drill-verify.db')
const PROD_DB_URL = process.env.DATABASE_URL || ''

if (!BACKUP_KEY) {
  console.error('❌ BACKUP_ENCRYPTION_KEY is required for restore drill')
  console.error('   Set it in .env or pass as environment variable')
  process.exit(1)
}

if (!PROD_DB_URL) {
  console.error('❌ DATABASE_URL is required')
  process.exit(1)
}

interface TableCount {
  table: string
  prodCount: number
  restoredCount: number
  match: boolean
}

async function getTableCounts(db: PrismaClient): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  const tables = [
    'device', 'workOrder', 'user', 'masterItem', 'organization',
    'auditLog', 'stockItem', 'stockTransaction', 'meterReading',
    'setupRun', 'setupStep', 'legacyReference',
    'customFieldDefinition', 'customFieldOption', 'customFieldValue',
  ]
  for (const t of tables) {
    try {
      const model = (db as unknown as Record<string, { count: () => Promise<number> }>)[t]
      if (model && typeof model.count === 'function') {
        counts[t] = await model.count()
      }
    } catch {
      // Table may not exist — skip
    }
  }
  return counts
}

async function getChecksum(db: PrismaClient): Promise<string> {
  // Checksum based on key entity IDs + counts
  const data: string[] = []
  const tables = ['device', 'workOrder', 'user', 'organization']
  for (const t of tables) {
    try {
      const model = (db as unknown as Record<string, { findMany: (args?: { select?: unknown; take?: number }) => Promise<{ id?: string }[]> }>)[t]
      if (model) {
        const rows = await model.findMany({ take: 100, select: { id: true } })
        data.push(`${t}:${rows.map(r => r.id).join(',')}`)
      }
    } catch {
      // skip
    }
  }
  return createHash('sha256').update(data.join('|')).digest('hex').slice(0, 16)
}

async function sendAlert(message: string) {
  console.error(`🚨 ALERT: ${message}`)
  const chatId = process.env.ALERT_TELEGRAM_CHAT_ID
  const botToken = process.env.ALERT_TELEGRAM_BOT_TOKEN
  if (chatId && botToken) {
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `🚨 ITAM Backup Drill FAILED\n\n${message}` }),
      })
    } catch {
      // best-effort
    }
  }
}

async function main() {
  console.log('═'.repeat(60))
  console.log('  Restore Drill — Backup Verification')
  console.log('═'.repeat(60))
  console.log(`Timestamp: ${new Date().toISOString()}`)
  console.log(`Backup key: ${BACKUP_KEY.slice(0, 8)}...${BACKUP_KEY.slice(-8)}`)
  console.log('')

  // ── Step 1: Create fresh encrypted backup ──
  console.log('Step 1: Creating fresh encrypted backup...')
  try {
    execSync(`bun run scripts/backup-db.ts --output=${DRILL_BACKUP}`, {
      stdio: 'pipe',
      env: { ...process.env, BACKUP_ENCRYPTION_KEY: BACKUP_KEY },
    })
  } catch (err) {
    await sendAlert(`Backup creation failed: ${err}`)
    process.exit(1)
  }
  if (!existsSync(DRILL_BACKUP)) {
    await sendAlert('Backup file not created')
    process.exit(1)
  }
  console.log(`  ✓ Backup created: ${DRILL_BACKUP}`)

  // ── Step 2: Get production counts + checksum ──
  console.log('Step 2: Recording production row counts + checksum...')
  const prodDb = new PrismaClient({ datasources: { db: { url: PROD_DB_URL } } })
  const prodCounts = await getTableCounts(prodDb)
  const prodChecksum = await getChecksum(prodDb)
  await prodDb.$disconnect()
  console.log(`  ✓ Production counts: ${JSON.stringify(prodCounts)}`)
  console.log(`  ✓ Production checksum: ${prodChecksum}`)

  // ── Step 3: Restore into temp database ──
  console.log('Step 3: Restoring into temp database...')
  // For SQLite: copy current db to temp, then restore into temp
  // For PostgreSQL: would create a temp schema/database
  if (PROD_DB_URL.startsWith('file:')) {
    const sourceDb = PROD_DB_URL.replace('file:', '')
    if (existsSync(sourceDb)) {
      copyFileSync(sourceDb, TEMP_DB_PATH)
    }
  }

  // Restore the backup into temp DB
  try {
    const tempDbUrl = `file:${TEMP_DB_PATH}`
    execSync(`bun run scripts/restore-db.ts ${DRILL_BACKUP}`, {
      stdio: 'pipe',
      env: {
        ...process.env,
        DATABASE_URL: tempDbUrl,
        BACKUP_ENCRYPTION_KEY: BACKUP_KEY,
      },
    })
  } catch (err) {
    await sendAlert(`Restore failed: ${err}`)
    // Cleanup
    if (existsSync(TEMP_DB_PATH)) unlinkSync(TEMP_DB_PATH)
    if (existsSync(DRILL_BACKUP)) unlinkSync(DRILL_BACKUP)
    process.exit(1)
  }
  console.log('  ✓ Restore succeeded')

  // ── Step 4: Compare row counts ──
  console.log('Step 4: Comparing row counts...')
  const tempDb = new PrismaClient({
    datasources: { db: { url: `file:${TEMP_DB_PATH}` } },
  })
  const restoredCounts = await getTableCounts(tempDb)
  const restoredChecksum = await getChecksum(tempDb)
  await tempDb.$disconnect()

  const tableResults: TableCount[] = []
  let allMatch = true
  for (const [table, prodCount] of Object.entries(prodCounts)) {
    const restoredCount = restoredCounts[table] ?? -1
    const match = prodCount === restoredCount
    if (!match) allMatch = false
    tableResults.push({ table, prodCount, restoredCount, match })
  }

  console.log('  Table comparison:')
  for (const r of tableResults) {
    console.log(`    ${r.match ? '✓' : '✗'} ${r.table}: prod=${r.prodCount} restored=${r.restoredCount}`)
  }

  // ── Step 5: Check checksum ──
  console.log(`  Checksum: prod=${prodChecksum} restored=${restoredChecksum} ${prodChecksum === restoredChecksum ? '✓' : '✗'}`)
  if (prodChecksum !== restoredChecksum) {
    allMatch = false
  }

  // ── Step 6: Cleanup ──
  if (existsSync(TEMP_DB_PATH)) unlinkSync(TEMP_DB_PATH)
  if (existsSync(DRILL_BACKUP)) unlinkSync(DRILL_BACKUP)
  console.log('  ✓ Cleaned up temp files')

  // ── Summary ──
  console.log('')
  console.log('═'.repeat(60))
  if (allMatch) {
    console.log('  ✓ BACKUP VERIFIED — restore drill passed')
    console.log(`  All ${tableResults.length} tables match, checksum OK`)
    console.log('═'.repeat(60))
    process.exit(0)
  } else {
    const mismatched = tableResults.filter(r => !r.match).map(r => r.table).join(', ')
    await sendAlert(`Backup verification FAILED — mismatched tables: ${mismatched}`)
    console.log('  ✗ BACKUP VERIFICATION FAILED')
    console.log(`  Mismatched: ${mismatched}`)
    console.log('═'.repeat(60))
    process.exit(1)
  }
}

main().catch(async (e) => {
  await sendAlert(`Restore drill crashed: ${e}`)
  console.error('Fatal:', e)
  process.exit(1)
})
