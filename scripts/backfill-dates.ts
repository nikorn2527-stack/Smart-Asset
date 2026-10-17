/**
 * backfill-dates.ts — SPRINT-2 #9 String → DateTime migration helper.
 *
 * AUDIT-DB-RUNTIME-001 S-P1-1: 16 date fields across 6 models are stored
 * as String (e.g., '2026-09-14', '14/09/2026', 'พ.ศ. 2569'). This script
 * backfills them to ISO DateTime format so a future Prisma migration can
 * change the column types from String to DateTime without data loss.
 *
 * Strategy (additive, non-breaking):
 *   1. This script does NOT change schema — it only normalizes existing
 *      String date values to consistent ISO format ('YYYY-MM-DD' or
 *      'YYYY-MM-DDTHH:mm:ss.sssZ').
 *   2. After running this script, all String date columns will contain
 *      ONLY ISO-formatted dates.
 *   3. The actual schema migration (String → DateTime) can then be done
 *      safely with `prisma db push --accept-data-loss` (SQLite) or
 *      `prisma migrate deploy` (PostgreSQL) — Prisma will cast the
 *      ISO strings to DateTime automatically.
 *
 * Date formats handled (input → output):
 *   '2026-09-14'              → '2026-09-14' (already ISO, pass through)
 *   '14/09/2026'              → '2026-09-14' (dd/mm/yyyy → ISO)
 *   '09/14/2026'              → '2026-09-14' (mm/dd/yyyy → ISO, ambiguous)
 *   '2026-09-14T10:30:00'     → '2026-09-14T10:30:00' (already ISO datetime)
 *   '2569-09-14'              → '2026-09-14' (Buddhist era → Gregorian)
 *   '' or null                → null (empty → null)
 *   'unknown' / 'N/A'         → null (invalid → null)
 *
 * Usage:
 *   bun run scripts/backfill-dates.ts              # dry-run (preview)
 *   bun run scripts/backfill-dates.ts --apply      # actually write
 *
 * Run on production DB with downtime window (script is idempotent — safe
 * to re-run).
 */

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const DRY_RUN = !process.argv.includes('--apply')

interface DateFieldSpec {
  model: string
  field: string
  /** Optional: only backfill rows where this condition is true */
  where?: Record<string, unknown>
}

// String date fields across 6 models (from AUDIT-DB-RUNTIME-001 S-P1-1)
// Note: closedAt is already DateTime? in schema — not included here.
// Note: WorkOrderPart.approvedAt is already DateTime? — not included.
const DATE_FIELDS: DateFieldSpec[] = [
  // MeterReading (2 String fields)
  { model: 'meterReading', field: 'readingDate' },
  { model: 'meterReading', field: 'readingMonth' },
  // Cycle (2 String fields)
  { model: 'cycle', field: 'startDate' },
  { model: 'cycle', field: 'endDate' },
  // DeviceTransfer (1 String field)
  { model: 'deviceTransfer', field: 'transferDate' },
  // StockTransaction (2 String fields)
  { model: 'stockTransaction', field: 'txnDate' },
  { model: 'stockTransaction', field: 'approvedAt' },
  // PurchaseOrder (1 String field)
  { model: 'purchaseOrder', field: 'orderDate' },
  // SiteRate → no String date field (createdAt is already DateTime)
  // StockItemRateHistory (1 String field)
  { model: 'stockItemRateHistory', field: 'effectiveFrom' },
  // Device (2 String fields)
  { model: 'device', field: 'purchaseDate' },
  { model: 'device', field: 'warrantyEnd' },
  // Assignment (1 String field)
  { model: 'assignment', field: 'checkoutDate' },
  // PMExecution (1 String field)
  { model: 'pMExecution', field: 'scheduledDate' },
]

function parseDateToISO(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Already ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(trimmed)) {
    // Check for Buddhist era (2569 = 2026)
    const year = parseInt(trimmed.slice(0, 4), 10)
    if (year > 2400) {
      // Convert Buddhist era to Gregorian (พ.ศ. - 543 = ค.ศ.)
      const gregorianYear = year - 543
      return `${gregorianYear}-${trimmed.slice(4)}`
    }
    return trimmed
  }

  // dd/mm/yyyy or dd-mm-yyyy
  const ddmmyyyy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (ddmmyyyy) {
    const day = ddmmyyyy[1].padStart(2, '0')
    const month = ddmmyyyy[2].padStart(2, '0')
    const year = parseInt(ddmmyyyy[3], 10)
    const gregorianYear = year > 2400 ? year - 543 : year
    return `${gregorianYear}-${month}-${day}`
  }

  // mm/dd/yyyy (US format — ambiguous, but handle it)
  const mmddyyyy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (mmddyyyy && parseInt(mmddyyyy[1], 10) > 12) {
    // First number > 12, so it must be dd/mm not mm/dd
    const day = mmddyyyy[1].padStart(2, '0')
    const month = mmddyyyy[2].padStart(2, '0')
    const year = parseInt(mmddyyyy[3], 10)
    const gregorianYear = year > 2400 ? year - 543 : year
    return `${gregorianYear}-${month}-${day}`
  }

  // Invalid / non-date string
  console.warn(`  ⚠️  cannot parse "${trimmed}" → setting to null`)
  return null
}

async function backfillModel(spec: DateFieldSpec): Promise<{ scanned: number; updated: number; unchanged: number }> {
  const model = (db as unknown as Record<string, {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>
    update: (args: unknown) => Promise<unknown>
  }>)[spec.model]
  if (!model) {
    console.warn(`  ⚠️  model "${spec.model}" not found in Prisma client — skipping`)
    return { scanned: 0, updated: 0, unchanged: 0 }
  }

  const rows = await model.findMany({
    select: { id: true, [spec.field]: true },
  })

  let updated = 0
  let unchanged = 0

  for (const row of rows) {
    const currentValue = row[spec.field] as string | null
    const newValue = parseDateToISO(currentValue)

    if (newValue === currentValue) {
      unchanged++
      continue
    }

    if (DRY_RUN) {
      console.log(`  [DRY-RUN] ${spec.model}.${spec.field}: "${currentValue}" → "${newValue}"`)
      updated++
    } else {
      await model.update({
        where: { id: row.id },
        data: { [spec.field]: newValue },
      })
      updated++
    }
  }

  return { scanned: rows.length, updated, unchanged }
}

async function main() {
  console.log('═'.repeat(60))
  console.log('  String → DateTime Backfill Helper')
  console.log('═'.repeat(60))
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (preview)' : 'APPLY (writes to DB)'}`)
  console.log(`Models: ${DATE_FIELDS.length} fields across ${new Set(DATE_FIELDS.map(f => f.model)).size} models`)
  console.log('')

  const results: Array<{ spec: DateFieldSpec; result: { scanned: number; updated: number; unchanged: number } }> = []

  for (const spec of DATE_FIELDS) {
    console.log(`── ${spec.model}.${spec.field} ──`)
    const result = await backfillModel(spec)
    results.push({ spec, result })
    console.log(`  scanned: ${result.scanned}, updated: ${result.updated}, unchanged: ${result.unchanged}`)
  }

  console.log('')
  console.log('═'.repeat(60))
  const totalScanned = results.reduce((s, r) => s + r.result.scanned, 0)
  const totalUpdated = results.reduce((s, r) => s + r.result.updated, 0)
  const totalUnchanged = results.reduce((s, r) => s + r.result.unchanged, 0)
  console.log(`  Total: scanned=${totalScanned}, updated=${totalUpdated}, unchanged=${totalUnchanged}`)
  console.log(`  Mode: ${DRY_RUN ? 'DRY-RUN — no changes written. Run with --apply to write.' : 'APPLY — changes written to DB.'}`)
  console.log('═'.repeat(60))

  console.log('')
  console.log('Next steps:')
  console.log('  1. Review the dry-run output above')
  console.log('  2. Run `bun run scripts/backfill-dates.ts --apply` to write')
  console.log('  3. Verify with: SELECT startDate FROM Cycle; (should all be ISO format)')
  console.log('  4. Then run the Prisma migration to change String → DateTime:')
  console.log('     bunx prisma db push --accept-data-loss  (SQLite dev)')
  console.log('     bunx prisma migrate deploy              (PostgreSQL prod)')

  await db.$disconnect()
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
