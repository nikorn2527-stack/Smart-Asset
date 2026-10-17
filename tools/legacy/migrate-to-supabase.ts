/**
 * Migrate data from local SQLite (sandbox) → Supabase (production PostgreSQL)
 * 
 * Strategy: For each table, read all rows from SQLite, then batch INSERT
 * into Supabase using ON CONFLICT DO NOTHING (skip existing PKs).
 */
import pg from 'pg'
import { DatabaseSync } from 'node:sqlite'

const SQLITE_PATH = '/home/z/my-project/db/custom.db'
const SUPABASE_URL = process.env.SUPABASE_DATABASE_URL

// Tables to migrate (in dependency order — parents first)
const TABLES = [
  'SiteAttribute',
  'MasterItem',
  'AppSetting',
  'AssetCategory',
  'AssetNumberPattern',
  'WoNumberPattern',
  'Cycle',
  'User',
  'Role',
  'Permission',
  'RolePermission',
  'UserSiteGrant',
  'Device',
  'DeviceAccessory',
  'DeviceTransfer',
  'Assignment',
  'StockItem',
  'PurchaseOrder',
  'PurchaseOrderItem',
  'StockTransaction',
  'WorkOrder',
  'WorkOrderMessage',
  'WorkOrderReview',
  'MaintenanceLog',
  'MeterReading',
  'AuditLog',
  'DocumentTemplate',
  'ImportJob',
  'Report',
  'LineBinding',
  'OrganizationProfile',
  'PasswordResetToken',
]

async function main() {
  const sqlite = new DatabaseSync(SQLITE_PATH)
  sqlite.exec('PRAGMA foreign_keys = OFF')
  
  const supa = new pg.Client({ connectionString: SUPABASE_URL, connectionTimeoutMillis: 30000 })
  await supa.connect()
  console.log('✓ เชื่อม Supabase ได้')
  
  // Disable FK constraints during migration
  await supa.query('SET session_replication_role = replica')
  
  let totalMigrated = 0
  let totalSkipped = 0
  const results: any[] = []
  
  for (const table of TABLES) {
    try {
      // Check if table exists in SQLite
      const sqliteCheck = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
      if (!sqliteCheck) {
        results.push({ table, status: 'not-in-sqlite' })
        continue
      }
      
      // Get all rows from SQLite
      const rows = sqlite.prepare('SELECT * FROM ' + table).all() as any[]
      if (rows.length === 0) {
        results.push({ table, status: 'empty', count: 0 })
        continue
      }
      
      // Get columns from SQLite
      const sqliteCols = Object.keys(rows[0])
      
      // Get columns from Supabase (PostgreSQL)
      // Note: table names in Supabase are case-sensitive (Device, not device)
      // because they were created with quoted identifiers.
      const colRes = await supa.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema='public' AND table_name=$1
      `, [table])
      const supaCols = colRes.rows.map((r: any) => r.column_name)
      
      // Find common columns (case-sensitive match — both use camelCase)
      const common = sqliteCols.filter(c => supaCols.includes(c))
      
      if (common.length === 0) {
        results.push({ table, status: 'no-common-cols', sqliteCols: sqliteCols.length, supaCols: supaCols.length })
        continue
      }
      
      // Build INSERT with ON CONFLICT DO NOTHING
      // Use parameterized query to handle special chars
      const colList = common.map(c => '"' + c + '"').join(', ')
      const placeholders = common.map((_, i) => '$' + (i + 1)).join(', ')
      const sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
      
      let inserted = 0
      let errors = 0
      const BATCH = 100
      
      // Identify timestamp columns (must convert from epoch ms → ISO string)
      const timestampCols = new Set(['createdAt', 'updatedAt', 'lastLoginAt', 'replacedAt', 'deletedAt', 'uninstallDate', 'installDate', 'approvedAt', 'completedAt', 'txnDate', 'orderDate', 'readingDate', 'effectiveFrom', 'effectiveTo', 'warrantyEnd', 'purchaseDate'])
      
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH)
        for (const row of batch) {
          try {
            const values = common.map(c => {
              const v = row[c]
              if (v === undefined || v === null) return null
              // Convert epoch ms timestamps → ISO string for PostgreSQL
              if (timestampCols.has(c) && typeof v === 'number') {
                return new Date(v).toISOString()
              }
              // SQLite stores booleans as 0/1 — convert to true/false
              if (typeof v === 'number' && (v === 0 || v === 1)) {
                // Heuristic: if column name starts with 'is' it's likely a boolean
                if (c.startsWith('is') || c === 'active' || c === 'meterRequired' || c === 'isDemo') {
                  return v === 1
                }
              }
              return v
            })
            const res = await supa.query(sql, values)
            inserted += res.rowCount || 0
          } catch (e: any) {
            errors++
            if (errors <= 2) console.error('  ✗', table, 'row error:', e.message.slice(0, 120))
          }
        }
      }
      
      totalMigrated += inserted
      totalSkipped += rows.length - inserted
      results.push({ table, status: 'migrated', inserted, total: rows.length, skipped: rows.length - inserted, errors, commonCols: common.length })
      console.log(`✓ ${table}: ${inserted}/${rows.length} rows (skipped ${rows.length - inserted}, errors ${errors})`)
    } catch (e: any) {
      results.push({ table, status: 'error', error: e.message.slice(0, 200) })
      console.error(`✗ ${table}: ${e.message.slice(0, 200)}`)
    }
  }
  
  // Re-enable FK constraints
  await supa.query('SET session_replication_role = origin')
  
  await supa.end()
  sqlite.close()
  
  console.log('')
  console.log('══════════════════════════════════════════')
  console.log('  MIGRATION COMPLETE')
  console.log('══════════════════════════════════════════')
  console.log(`  Total migrated: ${totalMigrated} rows`)
  console.log(`  Total skipped (already exist): ${totalSkipped} rows`)
  console.log('')
  console.log('Tables migrated:')
  results.filter(r => r.status === 'migrated').forEach(r => {
    console.log(`  ✓ ${r.table}: ${r.inserted}/${r.total} rows`)
  })
  console.log('')
  console.log('Tables skipped:')
  results.filter(r => r.status !== 'migrated' && r.status !== 'error').forEach(r => {
    console.log(`  - ${r.table}: ${r.status}`)
  })
  console.log('')
  console.log('Tables with errors:')
  results.filter(r => r.status === 'error').forEach(r => {
    console.log(`  ✗ ${r.table}: ${r.error}`)
  })
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL:', e); process.exit(1) })
