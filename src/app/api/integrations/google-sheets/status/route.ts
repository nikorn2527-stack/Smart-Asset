import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { db } from '@/lib/db'

/**
 * GET /api/integrations/google-sheets/status
 *
 * Returns the current connection status of the Google Sheets integration:
 *   - Whether the Service Account credentials + Sheet IDs are configured
 *   - Which env vars are missing
 *   - When credentials exist, attempts a lightweight authorize() probe and
 *     reports ok/error (does NOT fetch any sheet data)
 *   - The most recent legacy-sync audit entries (last 10)
 *
 * Permission: SYSTEM_CONFIG (admin-only — exposes env-var presence info)
 * Module gate: 'authorization' (system-level admin feature)
 *
 * Response shape:
 *   {
 *     configured: boolean,
 *     missingEnvVars: string[],
 *     sheetIds: { itam, services, stock },     // booleans
 *     serviceAccountEmail: string | null,       // masked
 *     authProbe: { ok: boolean, error?: string } | null,
 *     recentSyncs: Array<{ action, summary, actor, createdAt, detail }>,
 *     dbRowCounts: { devices, workOrders, stockItems, meterReadings, users, sites }
 *   }
 */
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('authorization')
  if (unavailable) return unavailable

  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    // ── 1. Inspect env vars WITHOUT importing googleapis ──
    const env = process.env
    const hasKeyStr = !!env.GOOGLE_SERVICE_ACCOUNT_KEY
    const hasKeyFile = !!env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE
    const sheetIds = {
      itam: !!env.GOOGLE_SHEETS_ID_ITAM,
      services: !!env.GOOGLE_SHEETS_ID_SERVICES,
      stock: !!env.GOOGLE_SHEETS_ID_STOCK,
    }

    const missingEnvVars: string[] = []
    if (!hasKeyStr && !hasKeyFile) {
      missingEnvVars.push('GOOGLE_SERVICE_ACCOUNT_KEY')
    }
    if (!sheetIds.itam) missingEnvVars.push('GOOGLE_SHEETS_ID_ITAM')
    if (!sheetIds.services) missingEnvVars.push('GOOGLE_SHEETS_ID_SERVICES')
    if (!sheetIds.stock) missingEnvVars.push('GOOGLE_SHEETS_ID_STOCK')

    const configured = missingEnvVars.length === 0

    // ── 2. Extract service account email (masked) ──
    let serviceAccountEmail: string | null = null
    if (hasKeyStr) {
      try {
        const creds = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY!)
        if (creds.client_email) {
          const email: string = creds.client_email
          const [name, domain] = email.split('@')
          const maskedName =
            name.length > 4
              ? name.slice(0, 4) + '•'.repeat(Math.max(2, name.length - 4))
              : name
          serviceAccountEmail = `${maskedName}@${domain}`
        }
      } catch {
        // Key is malformed — surface this in the authProbe step
      }
    }

    // ── 3. Auth probe (only if creds look present) ──
    let authProbe: { ok: boolean; error?: string } | null = null
    if (hasKeyStr || hasKeyFile) {
      try {
        const { checkServiceAccount } = await import('@/lib/google-sheets-service')
        authProbe = await checkServiceAccount()
      } catch (err) {
        authProbe = {
          ok: false,
          error: err instanceof Error ? err.message : 'googleapis not available',
        }
      }
    }

    // ── 4. Recent sync audit entries ──
    let recentSyncs: Array<Record<string, unknown>> = []
    try {
      const rows = await db.auditLog.findMany({
        where: {
          action: { startsWith: 'LEGACY_SYNC' },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          action: true,
          summary: true,
          actor: true,
          createdAt: true,
          detail: true,
        },
      })
      recentSyncs = rows.map((r) => ({
        action: r.action,
        summary: r.summary,
        actor: r.actor,
        createdAt: r.createdAt,
        detail: r.detail,
      }))
    } catch {
      // AuditLog table might not exist in some envs — non-fatal
    }

    // ── 5. DB row counts (so admin can compare to Sheets preview) ──
    let dbRowCounts: Record<string, number> = {}
    try {
      const [devices, workOrders, stockItems, meterReadings, users, sites] =
        await Promise.all([
          db.device.count(),
          db.workOrder.count(),
          db.stockItem.count(),
          db.meterReading.count(),
          db.user.count(),
          db.site.count(),
        ])
      dbRowCounts = { devices, workOrders, stockItems, meterReadings, users, sites }
    } catch {
      // Non-fatal — leave empty
    }

    return NextResponse.json({
      configured,
      missingEnvVars,
      sheetIds,
      serviceAccountEmail,
      authProbe,
      recentSyncs,
      dbRowCounts,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[google-sheets/status] error:', msg)
    return NextResponse.json(
      { error: 'Failed to read Google Sheets status', detail: msg },
      { status: 500 },
    )
  }
}
