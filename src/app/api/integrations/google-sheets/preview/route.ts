import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { logAudit } from '@/lib/audit'

/**
 * GET /api/integrations/google-sheets/preview
 *
 * Previews what's currently in the 3 legacy Google Sheets — without writing
 * anything to the database. For each of the 12 known sheet tabs, returns:
 *   - rowCount: number of data rows (excl. header)
 *   - headers: the column headers found in row 1
 *   - sample: first 3 data rows (truncated values)
 *   - error: string | null  (per-sheet error, e.g. "tab not found")
 *
 * This is the "what would I recover?" view — useful before running a real
 * sync, especially after a data-loss incident.
 *
 * Permission: SYSTEM_CONFIG
 * Module gate: 'authorization'
 *
 * Query params:
 *   ?tab=itam|services|stock|all  (default: all)
 */
export const maxDuration = 60

const SHEET_REGISTRY = [
  { app: 'itam' as const, tab: 'All_Devices', entity: 'Device' },
  { app: 'itam' as const, tab: 'Meter_Readings', entity: 'MeterReading' },
  { app: 'itam' as const, tab: 'Location_History', entity: 'DeviceTransfer' },
  { app: 'itam' as const, tab: 'User_Permissions', entity: 'User' },
  { app: 'itam' as const, tab: 'App_Settings', entity: 'AppSetting' },
  { app: 'itam' as const, tab: 'Master_Items', entity: 'MasterItem' },
  { app: 'itam' as const, tab: 'Site_Attributes', entity: 'SiteAttribute' },
  { app: 'services' as const, tab: 'Data', entity: 'WorkOrder' },
  { app: 'stock' as const, tab: 'Products', entity: 'StockItem' },
  { app: 'stock' as const, tab: 'PurchaseOrders', entity: 'PurchaseOrder' },
  { app: 'stock' as const, tab: 'StockIn', entity: 'StockTransaction(IN)' },
  { app: 'stock' as const, tab: 'StockOut', entity: 'StockTransaction(OUT)' },
]

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('authorization')
  if (unavailable) return unavailable

  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const url = new URL(req.url)
  const filter = (url.searchParams.get('tab') ?? 'all').toLowerCase()
  const validFilters = new Set(['all', 'itam', 'services', 'stock'])
  if (!validFilters.has(filter)) {
    return NextResponse.json(
      { error: 'Invalid ?tab= param. Use all|itam|services|stock' },
      { status: 400 },
    )
  }

  // ── Pre-flight: are credentials even configured? ──
  const env = process.env
  const hasKey = !!env.GOOGLE_SERVICE_ACCOUNT_KEY || !!env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE
  if (!hasKey) {
    return NextResponse.json(
      {
        error:
          'GOOGLE_SERVICE_ACCOUNT_KEY is not set. Configure it in .env first.',
        configured: false,
      },
      { status: 400 },
    )
  }

  const targets = SHEET_REGISTRY.filter(
    (s) => filter === 'all' || s.app === filter,
  )

  try {
    const { fetchSheet } = await import('@/lib/google-sheets-service')

    // Run fetches in parallel for speed (3 sheets × ~4 tabs each)
    const results = await Promise.all(
      targets.map(async (t) => {
        const started = Date.now()
        try {
          const { rows, error } = await fetchSheet(t.app, t.tab)
          const durationMs = Date.now() - started
          if (error) {
            return {
              app: t.app,
              tab: t.tab,
              entity: t.entity,
              rowCount: 0,
              headers: [] as string[],
              sample: [] as Record<string, string>[],
              error,
              durationMs,
            }
          }
          const headers =
            rows.length > 0 ? Object.keys(rows[0]) : ([] as string[])
          const sample = rows.slice(0, 3).map((r) => {
            // Truncate long values so the response stays small
            const out: Record<string, string> = {}
            for (const [k, v] of Object.entries(r)) {
              out[k] = v.length > 80 ? v.slice(0, 77) + '...' : v
            }
            return out
          })
          return {
            app: t.app,
            tab: t.tab,
            entity: t.entity,
            rowCount: rows.length,
            headers,
            sample,
            error: null,
            durationMs,
          }
        } catch (err) {
          return {
            app: t.app,
            tab: t.tab,
            entity: t.entity,
            rowCount: 0,
            headers: [],
            sample: [],
            error: err instanceof Error ? err.message : 'Unknown error',
            durationMs: Date.now() - started,
          }
        }
      }),
    )

    const totalRows = results.reduce((s, r) => s + r.rowCount, 0)
    const errorsCount = results.filter((r) => r.error).length

    // Audit log the preview access (admin viewed what's in Google Sheets)
    await logAudit(
      'LEGACY_SYNC_PREVIEW',
      'GoogleSheets',
      null,
      `Previewed ${results.length} sheet tabs from Google Sheets — total ${totalRows} rows, ${errorsCount} errors`,
      {
        filter,
        tabs: results.map((r) => ({
          app: r.app,
          tab: r.tab,
          rowCount: r.rowCount,
          error: r.error,
        })),
        totalRows,
        errorsCount,
      },
      auth.row.username ?? 'admin',
    )

    return NextResponse.json({
      configured: true,
      filter,
      tabs: results,
      totals: {
        tabs: results.length,
        rows: totalRows,
        errors: errorsCount,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[google-sheets/preview] error:', msg)
    return NextResponse.json(
      { error: 'Failed to preview Google Sheets', detail: msg },
      { status: 500 },
    )
  }
}
