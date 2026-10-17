import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { logAudit } from '@/lib/audit'
import { db } from '@/lib/db'

/**
 * GET /api/integrations/google-sheets/export-spreadsheet
 *
 * Backs up ALL ITAM database data as a single multi-sheet TSV file
 * (tab-separated values, with sheet-separator rows). This format:
 *   - Opens cleanly in Google Sheets (File → Import → Tab-separated)
 *   - Opens cleanly in Microsoft Excel
 *   - Opens cleanly in Numbers / LibreOffice
 *
 * The file contains one "sheet" per ITAM entity, separated by a special
 * marker line `### SHEET: <name> ###`. Each sheet starts with a header row.
 *
 * Included entities (in order):
 *   1. Devices
 *   2. WorkOrders
 *   3. MeterReadings
 *   4. StockItems
 *   5. StockTransactions
 *   6. Users
 *   7. Sites
 *   8. MasterItems
 *   9. PurchaseOrders
 *   10. AuditLogs (last 1000 — for traceability)
 *
 * Permission: SYSTEM_CONFIG (admin-only — full data export)
 * Module gate: 'authorization'
 *
 * Query params:
 *   ?format=tsv|csv   (default: tsv)
 *   ?entities=all|devices,workorders,...  (comma-separated subset)
 *
 * Response: text/plain (or text/csv) attachment
 */
export const maxDuration = 60

// ── Helpers ───────────────────────────────────────────────────────────

function escapeTsv(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  // TSV: tabs and newlines must be escaped (replace with space)
  // Double-quotes are NOT special in TSV (unlike CSV)
  return s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
}

function escapeCsv(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

interface SheetSpec {
  name: string
  fetch: () => Promise<{ columns: string[]; rows: Record<string, unknown>[] }>
}

// Build the list of sheets to export. We use prisma.findMany with select
// to keep payload sizes bounded (no joins → predictable shape).
function buildSheets(entities: Set<string>): SheetSpec[] {
  const sheets: SheetSpec[] = []

  if (entities.has('devices')) {
    sheets.push({
      name: 'Devices',
      fetch: async () => {
        const rows = await db.device.findMany({
          take: 10000,
          orderBy: { assetCode: 'asc' },
        })
        const columns = rows[0]
          ? Object.keys(rows[0])
          : ['id', 'assetCode', 'name', 'siteCode', 'status']
        return { columns, rows: rows as unknown as Record<string, unknown>[] }
      },
    })
  }

  if (entities.has('workorders')) {
    sheets.push({
      name: 'WorkOrders',
      fetch: async () => {
        const rows = await db.workOrder.findMany({
          take: 10000,
          orderBy: { createdAt: 'desc' },
        })
        const columns = rows[0]
          ? Object.keys(rows[0])
          : ['id', 'woNumber', 'status', 'siteCode']
        return { columns, rows: rows as unknown as Record<string, unknown>[] }
      },
    })
  }

  if (entities.has('meterreadings')) {
    sheets.push({
      name: 'MeterReadings',
      fetch: async () => {
        const rows = await db.meterReading.findMany({
          take: 20000,
          orderBy: { readingDate: 'desc' },
        })
        const columns = rows[0]
          ? Object.keys(rows[0])
          : ['id', 'deviceId', 'readingDate', 'bw', 'color']
        return { columns, rows: rows as unknown as Record<string, unknown>[] }
      },
    })
  }

  if (entities.has('stockitems')) {
    sheets.push({
      name: 'StockItems',
      fetch: async () => {
        const rows = await db.stockItem.findMany({
          take: 10000,
          orderBy: { productCode: 'asc' },
        })
        const columns = rows[0]
          ? Object.keys(rows[0])
          : ['id', 'productCode', 'productName', 'quantity']
        return { columns, rows: rows as unknown as Record<string, unknown>[] }
      },
    })
  }

  if (entities.has('stocktransactions')) {
    sheets.push({
      name: 'StockTransactions',
      fetch: async () => {
        const rows = await db.stockTransaction.findMany({
          take: 20000,
          orderBy: { txnDate: 'desc' },
        })
        const columns = rows[0]
          ? Object.keys(rows[0])
          : ['id', 'txnNumber', 'type', 'stockItemId', 'quantity']
        return { columns, rows: rows as unknown as Record<string, unknown>[] }
      },
    })
  }

  if (entities.has('users')) {
    sheets.push({
      name: 'Users',
      fetch: async () => {
        // Strip password hashes — never export secrets
        const rows = await db.user.findMany({
          take: 5000,
          orderBy: { createdAt: 'desc' },
          // Explicitly exclude passwordHash and passwordSalt
        })
        const safe = rows.map((r) => {
          const copy: Record<string, unknown> = { ...r }
          delete copy.passwordHash
          delete copy.passwordSalt
          delete copy.totpSecret
          return copy
        })
        const columns = safe[0] ? Object.keys(safe[0]) : ['id', 'username', 'email', 'role']
        return { columns, rows: safe }
      },
    })
  }

  if (entities.has('sites')) {
    sheets.push({
      name: 'Sites',
      fetch: async () => {
        const rows = await db.siteAttribute.findMany({ take: 1000 })
        const columns = rows[0]
          ? Object.keys(rows[0])
          : ['siteCode', 'siteName', 'lineOa', 'hotline']
        return { columns, rows: rows as unknown as Record<string, unknown>[] }
      },
    })
  }

  if (entities.has('masteritems')) {
    sheets.push({
      name: 'MasterItems',
      fetch: async () => {
        const rows = await db.masterItem.findMany({ take: 5000 })
        const columns = rows[0]
          ? Object.keys(rows[0])
          : ['id', 'category', 'code', 'label']
        return { columns, rows: rows as unknown as Record<string, unknown>[] }
      },
    })
  }

  if (entities.has('purchaseorders')) {
    sheets.push({
      name: 'PurchaseOrders',
      fetch: async () => {
        const rows = await db.purchaseOrder.findMany({ take: 5000 })
        const columns = rows[0]
          ? Object.keys(rows[0])
          : ['id', 'poNumber', 'supplier', 'status']
        return { columns, rows: rows as unknown as Record<string, unknown>[] }
      },
    })
  }

  if (entities.has('auditlogs')) {
    sheets.push({
      name: 'AuditLogs',
      fetch: async () => {
        const rows = await db.auditLog.findMany({
          take: 1000,
          orderBy: { createdAt: 'desc' },
        })
        const columns = rows[0]
          ? Object.keys(rows[0])
          : ['id', 'action', 'entity', 'createdAt']
        return { columns, rows: rows as unknown as Record<string, unknown>[] }
      },
    })
  }

  return sheets
}

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('authorization')
  if (unavailable) return unavailable

  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const url = new URL(req.url)
  const format = (url.searchParams.get('format') ?? 'tsv').toLowerCase()
  const entitiesParam = (url.searchParams.get('entities') ?? 'all').toLowerCase()

  if (!['tsv', 'csv'].includes(format)) {
    return NextResponse.json(
      { error: 'Invalid ?format=. Use tsv or csv' },
      { status: 400 },
    )
  }

  // Parse entities
  const allEntities = new Set([
    'devices', 'workorders', 'meterreadings', 'stockitems',
    'stocktransactions', 'users', 'sites', 'masteritems',
    'purchaseorders', 'auditlogs',
  ])
  const entities =
    entitiesParam === 'all'
      ? allEntities
      : new Set(
          entitiesParam
            .split(',')
            .map((s) => s.trim())
            .filter((s) => allEntities.has(s)),
        )

  if (entities.size === 0) {
    return NextResponse.json(
      { error: 'No valid entities selected' },
      { status: 400 },
    )
  }

  const sheets = buildSheets(entities)

  try {
    // Fetch all sheets in parallel (faster than sequential)
    const fetched = await Promise.all(
      sheets.map(async (s) => ({
        name: s.name,
        ...(await s.fetch()),
      })),
    )

    // ── Build the multi-sheet text body ──
    // Format: TSV with `### SHEET: <name> ###` separator lines
    // (CSV mode uses the same separators but with CSV escaping per cell)
    const sep = (name: string) => `### SHEET: ${name} ###`
    const escape = format === 'csv' ? escapeCsv : escapeTsv
    const delim = format === 'csv' ? ',' : '\t'

    const parts: string[] = []
    let totalRows = 0

    for (const sheet of fetched) {
      parts.push(sep(sheet.name))
      parts.push(sheet.columns.map(escape).join(delim))
      for (const row of sheet.rows) {
        const line = sheet.columns
          .map((c) => escape((row as Record<string, unknown>)[c]))
          .join(delim)
        parts.push(line)
      }
      parts.push('') // blank line between sheets
      totalRows += sheet.rows.length
    }

    // Add BOM for Excel/Thai-text compatibility
    const body = '\uFEFF' + parts.join('\n')
    const ext = format === 'csv' ? 'csv' : 'tsv'
    const stamp = new Date().toISOString().slice(0, 10)
    const filename = `itam-backup-${stamp}.${ext}`
    const mime = format === 'csv' ? 'text/csv' : 'text/tab-separated-values'

    // Audit log the export
    await logAudit(
      'LEGACY_SYNC_EXPORT',
      'GoogleSheets',
      null,
      `Exported ITAM backup as ${ext.toUpperCase()} — ${fetched.length} sheets, ${totalRows} rows total`,
      {
        format,
        sheets: fetched.map((s) => ({
          name: s.name,
          columns: s.columns.length,
          rows: s.rows.length,
        })),
        totalRows,
      },
      auth.row.username ?? 'admin',
    )

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': `${mime}; charset=utf-8`,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[google-sheets/export-spreadsheet] error:', msg)
    return NextResponse.json(
      { error: 'Failed to export spreadsheet', detail: msg },
      { status: 500 },
    )
  }
}
