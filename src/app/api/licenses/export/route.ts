import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { demoFilter } from '@/lib/demo-mode'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * GET /api/licenses/export
 *
 * Export licenses as a CSV file. Returns `Content-Type: text/csv` with
 * `Content-Disposition: attachment; filename="licenses-export-YYYYMMDD.csv"`.
 *
 * Query params (all optional, AND-combined):
 *   • site=PPIT           — filter by parent device site
 *   • deviceId=<deviceId> — filter by specific device ID (real FK)
 *   • assetNo=IT-00001    — filter by Asset_No string (legacy)
 *   • software=Office     — substring search on Software column
 *   • isActive=true       — only active licenses (defaults to all)
 *
 * CSV columns:
 * ```csv
 * license_id,asset_no,device_id,software,license_type,license_key,quantity,expiry_date,is_active,remark
 * ```
 *
 * Demo isolation: applies `demoFilter(auth.user)` so demo users only see
 * demo data, and real users only see real data.
 */

// Return different content per request — never cache.
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** Trim a string field, returning '' when null/missing. */
function csvVal(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

/** RFC-4180 escape: wrap in quotes when value contains comma, quote, or newline. */
function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

const COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'license_id', label: 'license_id' },
  { key: 'asset_no', label: 'asset_no' },
  { key: 'device_id', label: 'device_id' },
  { key: 'software', label: 'software' },
  { key: 'license_type', label: 'license_type' },
  { key: 'license_key', label: 'license_key' },
  { key: 'quantity', label: 'quantity' },
  { key: 'expiry_date', label: 'expiry_date' },
  { key: 'is_active', label: 'is_active' },
  { key: 'remark', label: 'remark' },
]

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(req.url)
    const site = searchParams.get('site')?.trim() ?? ''
    const deviceId = searchParams.get('deviceId')?.trim() ?? ''
    const assetNo = searchParams.get('assetNo')?.trim() ?? ''
    const software = searchParams.get('software')?.trim() ?? ''
    // ── isActive filter ──
    //   • `isActive=true`  → only active licenses
    //   • `isActive=false` → only inactive licenses
    //   • `isActive` unset → all licenses (default)
    const isActiveParam = searchParams.get('isActive')?.trim().toLowerCase() ?? ''
    const onlyActive = isActiveParam === 'true' || isActiveParam === '1'
    const onlyInactive = isActiveParam === 'false' || isActiveParam === '0'

    // ── Build where clause ──
    // demoFilter applies on the LicenseRecord table (it has isDemo).
    const where: Record<string, unknown> = { ...demoFilter(auth.user) }
    if (deviceId) where.deviceId = deviceId
    if (assetNo) where.Asset_No = assetNo
    if (software) where.Software = { contains: software }
    if (onlyActive) where.isActive = true
    if (onlyInactive) where.isActive = false
    if (site) {
      // Filter by parent device's site — we need a nested where on the
      // device relation (only works for licenses where deviceId is set).
      where.device = { site }
    }

    // ── Fetch licenses ──
    const licenses = await db.licenseRecord.findMany({
      where,
      orderBy: [{ Software: 'asc' }, { Asset_No: 'asc' }, { createdAt: 'desc' }],
      // Safety cap — exporting > 50k rows via API is the wrong tool.
      take: 50_000,
    })

    // ── Build CSV ──
    const headerLine = COLUMNS.map((c) => escapeCsv(c.label)).join(',')
    const rows = licenses.map((l) =>
      COLUMNS.map((c) => {
        switch (c.key) {
          case 'license_id':
            return escapeCsv(csvVal(l.License_ID))
          case 'asset_no':
            return escapeCsv(csvVal(l.Asset_No))
          case 'device_id':
            return escapeCsv(csvVal(l.deviceId))
          case 'software':
            return escapeCsv(csvVal(l.Software))
          case 'license_type':
            return escapeCsv(csvVal(l.LicenseType))
          case 'license_key':
            return escapeCsv(csvVal(l.License_Key))
          case 'quantity':
            return escapeCsv(csvVal(l.Quantity))
          case 'expiry_date':
            return escapeCsv(csvVal(l.Expiry_Date))
          case 'is_active':
            return escapeCsv(l.isActive ? 'true' : 'false')
          case 'remark':
            return escapeCsv(csvVal(l.Remark))
          default:
            return ''
        }
      }).join(','),
    )
    // UTF-8 BOM (\uFEFF) so Excel renders Thai text correctly.
    const csv = '\uFEFF' + [headerLine, ...rows].join('\n')

    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    const filename = `licenses-export-${stamp}.csv`

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        // Browsers should not cache exports — the demoFilter is per-user.
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (err) {
    console.error('GET /api/licenses/export', err)
    const message =
      process.env.NODE_ENV === 'development'
        ? err instanceof Error
          ? err.message
          : 'Failed to export licenses'
        : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
