import pg from 'pg'
import { DatabaseSync } from 'node:sqlite'

const TABLES = ['StockTransaction', 'WorkOrder', 'WorkOrderMessage', 'WorkOrderReview', 'MaintenanceLog', 'AuditLog', 'DocumentTemplate', 'DeviceTransfer', 'Assignment', 'PurchaseOrderItem']

async function main() {
  const sqlite = new DatabaseSync('/home/z/my-project/db/custom.db')
  const supa = new pg.Client({ connectionString: process.env.SUPABASE_DATABASE_URL, connectionTimeoutMillis: 30000 })
  await supa.connect()
  await supa.query('SET session_replication_role = replica')
  
  const timestampCols = new Set(['createdAt', 'updatedAt', 'lastLoginAt', 'assignedAt', 'workCompletedAt', 'closedAt', 'canceledAt', 'editUnlockAt', 'dateAdmin', 'deletedAt', 'txnDate', 'readingDate', 'approvedAt', 'completedAt', 'installDate', 'uninstallDate'])
  
  let total = 0
  for (const table of TABLES) {
    try {
      const rows = sqlite.prepare('SELECT * FROM ' + table).all() as any[]
      if (rows.length === 0) { console.log('  ' + table + ': empty'); continue }
      
      let inserted = 0, errors = 0
      const cols = Object.keys(rows[0])
      const colList = cols.map(c => '"' + c + '"').join(', ')
      const placeholders = cols.map((_, i) => '$' + (i + 1)).join(', ')
      const sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
      
      for (const row of rows) {
        try {
          const values = cols.map(c => {
            const v = row[c]
            if (v === undefined || v === null) return null
            if (timestampCols.has(c) && typeof v === 'number') return new Date(v).toISOString()
            if (typeof v === 'number' && (v === 0 || v === 1) && (c.startsWith('is') || c === 'trackable' || c === 'editUnlockActive' || c === 'active')) return v === 1
            return v
          })
          const res = await supa.query(sql, values)
          inserted += res.rowCount || 0
        } catch (e: any) {
          errors++
          if (errors <= 1) console.error('  ✗', table, 'error:', e.message.slice(0, 150))
        }
      }
      total += inserted
      console.log(`✓ ${table}: ${inserted}/${rows.length} rows (errors ${errors})`)
    } catch (e: any) {
      console.error(`✗ ${table}: ${e.message.slice(0, 150)}`)
    }
  }
  
  await supa.query('SET session_replication_role = origin')
  await supa.end()
  sqlite.close()
  console.log('')
  console.log(`═══ Migration ตารางที่เหลือเสร็จ — Total: ${total} rows ═══`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
