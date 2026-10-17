/**
 * backup-db.ts — Backup database to encrypted JSON before migration.
 *
 * P1 Security: Backup files are now encrypted with AES-256-GCM using
 * BACKUP_ENCRYPTION_KEY env var. Without the key, the file is unreadable.
 *
 * Usage:
 *   bun run scripts/backup-db.ts                    → backup to ./backups/backup-<timestamp>.json.enc
 *   bun run scripts/backup-db.ts --output=/tmp/x.json.enc
 *
 * Restore (manual):
 *   bun run scripts/restore-db.ts ./backups/backup-<timestamp>.json.enc
 *
 * Encryption: AES-256-GCM. Key from BACKUP_ENCRYPTION_KEY env var
 * (32-byte hex string). If not set, warns but still creates unencrypted
 * backup (dev mode only — production MUST set the key).
 */

import { db } from '../src/lib/db'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes, createCipheriv } from 'node:crypto'

interface BackupData {
  meta: {
    timestamp: string
    prismaVersion: string
    tableCount: number
    totalRows: number
  }
  tables: Record<string, unknown[]>
}

// All Prisma models to backup (must match schema.prisma order)
// H-03 fix: added 7 new multi-org models that were missing
const TABLES_TO_BACKUP = [
  'device',
  'meterReading',
  'cycle',
  'deviceTransfer',
  'assignment',
  'maintenanceLog',
  'workOrder',
  'workOrderMessage',
  'workOrderReview',
  'workOrderImage',
  'workOrderPart',
  'licenseRecord',
  'siteAttribute',
  'site',
  'siteRate',
  'masterItem',
  'stockItem',
  'stockItemCompatibility',
  'stockTransaction',
  'purchaseOrder',
  'purchaseOrderItem',
  'user',
  'role',
  'permission',
  'rolePermission',
  'userSiteGrant',
  'auditLog',
  'appSetting',
  'pushSubscription',
  'stockItemRateHistory',
  'userNotificationPreference',
  'assetNumberPattern',
  'woNumberPattern',
  'organizationProfile',
  'documentTemplate',
  'importJob',
  'lineBinding',
  'report',
  'passwordResetToken',
  'syncRun',
  'syncRunItem',
  'pMSchedule',
  'pMExecution',
  // ── H-03: Multi-Org Foundation models (7 new) ──
  'organization',
  'legacyReference',
  'setupRun',
  'setupStep',
  'customFieldDefinition',
  'customFieldOption',
  'customFieldValue',
  // ── Asset depreciation (added later) ──
  'assetCategory',
  'contactDirectory',
] as const

async function main() {
  const startTime = Date.now()
  const args = process.argv.slice(2)
  const outputArg = args.find((a) => a.startsWith('--output='))
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outputDir = resolve(process.cwd(), 'backups')
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY
  const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'lan'
  const fileExt = encryptionKey ? '.json.enc' : '.json'
  const outputFile = outputArg
    ? outputArg.split('=')[1]
    : resolve(outputDir, `backup-${timestamp}${fileExt}`)

  // ── H-04: Force encryption in production/LAN ──
  // Without BACKUP_ENCRYPTION_KEY in production, REFUSE to create unencrypted backup.
  if (isProduction && !encryptionKey) {
    console.error('❌ FATAL: BACKUP_ENCRYPTION_KEY is required in production/LAN mode.')
    console.error('   Set BACKUP_ENCRYPTION_KEY env var to a 32-byte hex string (64 chars).')
    console.error('   Generate one with: openssl rand -hex 32')
    console.error('   Refusing to create unencrypted backup with sensitive data.')
    process.exit(1)
  }

  console.log('📦 Database Backup')
  console.log('─'.repeat(50))
  console.log(`Timestamp: ${timestamp}`)
  console.log(`Output: ${outputFile}`)
  console.log(`Encryption: ${encryptionKey ? 'AES-256-GCM ✓' : '⚠️  NONE (dev mode only)'}`)
  console.log(`Mode: ${isProduction ? 'production (encrypted)' : 'development'}`)
  console.log('─'.repeat(50))

  mkdirSync(outputDir, { recursive: true })

  const backup: BackupData = {
    meta: {
      timestamp,
      prismaVersion: '6.19.2',
      tableCount: 0,
      totalRows: 0,
    },
    tables: {},
  }

  let totalRows = 0

  for (const table of TABLES_TO_BACKUP) {
    try {
      const prismaModel = (db as unknown as Record<string, { findMany: () => Promise<unknown[]> }>)[table]
      if (!prismaModel || typeof prismaModel.findMany !== 'function') {
        console.log(`  ⚠️  ${table}: model not found in Prisma client — skip`)
        continue
      }

      const rows = await prismaModel.findMany()
      backup.tables[table] = rows
      totalRows += rows.length
      console.log(`  ✓ ${table}: ${rows.length} rows`)
    } catch (err) {
      console.log(`  ✗ ${table}: ${err instanceof Error ? err.message : String(err)}`)
      // Continue with other tables
    }
  }

  backup.meta.tableCount = Object.keys(backup.tables).length
  backup.meta.totalRows = totalRows

  // ── P1 Security: Encrypt backup if key is set ──
  const jsonData = JSON.stringify(backup, null, 2)
  if (encryptionKey) {
    // AES-256-GCM encryption
    const key = Buffer.from(encryptionKey, 'hex')
    if (key.length !== 32) {
      console.error('❌ BACKUP_ENCRYPTION_KEY must be 32 bytes (64 hex chars)')
      process.exit(1)
    }
    const iv = randomBytes(12) // GCM uses 12-byte IV
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([
      cipher.update(jsonData, 'utf8'),
      cipher.final(),
      cipher.getAuthTag(), // 16-byte auth tag appended at end
    ])
    // Prepend IV (12 bytes) + auth tag is at end (16 bytes)
    const fileData = Buffer.concat([iv, encrypted])
    writeFileSync(outputFile, fileData)
  } else {
    writeFileSync(outputFile, jsonData)
  }

  const elapsedMs = Date.now() - startTime
  const sizeMB = (JSON.stringify(backup).length / 1024 / 1024).toFixed(2)

  console.log('─'.repeat(50))
  console.log(`✓ Backup complete in ${elapsedMs}ms`)
  console.log(`  Tables: ${backup.meta.tableCount}`)
  console.log(`  Total rows: ${totalRows}`)
  console.log(`  File size: ${sizeMB} MB`)
  console.log(`  Saved to: ${outputFile}`)

  await db.$disconnect()
}

main().catch(async (e) => {
  console.error('❌ Backup failed:', e)
  await db.$disconnect()
  process.exit(1)
})
