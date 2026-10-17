/**
 * pre-migration-backup.ts — สร้าง backup ก่อนรัน migration (section 14)
 *
 * Usage:
 *   bun scripts/pre-migration-backup.ts
 *
 * Flow:
 *   1. Check health
 *   2. Create backup file (timestamped)
 *   3. Export Master Catalog + LegacyReference
 *   4. Report backup location
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'

const SQLITE = './db/custom.db'
const BACKUP_DIR = './db/backups'

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupPath = path.join(BACKUP_DIR, `pre-migration-${timestamp}.db`)

  console.log('══════════════════════════════════════════')
  console.log('  Pre-Migration Backup')
  console.log('══════════════════════════════════════════')

  // 1. Create backup directory if not exists
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    console.log('✓ Created backup directory:', BACKUP_DIR)
  }

  // 2. Check DB exists
  if (!fs.existsSync(SQLITE)) {
    console.error('❌ Database file not found:', SQLITE)
    process.exit(1)
  }

  // 3. Copy SQLite file (backup)
  fs.copyFileSync(SQLITE, backupPath)
  const stats = fs.statSync(backupPath)
  console.log('✓ Backup created:', backupPath)
  console.log('  Size:', (stats.size / 1024 / 1024).toFixed(2), 'MB')

  // 4. Export Master Catalog + LegacyReference as JSON
  const db = new DatabaseSync(SQLITE, { readOnly: true })

  const masterItems = db.prepare('SELECT * FROM MasterItem').all()
  const legacyRefs = db.prepare('SELECT * FROM LegacyReference').all()
  const orgs = db.prepare('SELECT * FROM Organization').all()
  const users = db.prepare('SELECT id, email, username, role, organizationId, active FROM "User"').all()

  db.close()

  const jsonPath = path.join(BACKUP_DIR, `pre-migration-${timestamp}.json`)
  const exportData = {
    timestamp,
    database: SQLITE,
    summary: {
      organizations: orgs.length,
      masterItems: masterItems.length,
      legacyReferences: legacyRefs.length,
      users: users.length,
    },
    organizations: orgs,
    masterItems: masterItems,
    legacyReferences: legacyRefs,
    users: users,
  }
  fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2))
  console.log('✓ JSON export:', jsonPath)

  // 5. Summary
  console.log('\n── Backup Summary ──')
  console.log(`  Organizations: ${orgs.length}`)
  console.log(`  MasterItems: ${masterItems.length}`)
  console.log(`  LegacyReferences: ${legacyRefs.length}`)
  console.log(`  Users: ${users.length}`)
  console.log('')
  console.log('✓ Pre-migration backup complete. Safe to run migration.')
  console.log(`  Restore: cp ${backupPath} ${SQLITE}`)
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL:', e); process.exit(1) })
