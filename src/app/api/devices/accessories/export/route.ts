import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { demoFilter } from '@/lib/demo-mode'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * GET /api/devices/accessories/export
 *
 * Export accessories as a CSV file. Returns `Content-Type: text/csv` with
 * `Content-Disposition: attachment; filename="accessories-export-YYYYMMDD.csv"`.
 *
 * Query params (all optional, AND-combined):
 *   • site=PPIT           — filter by parent device site
 *   • parentId=<deviceId> — filter by specific parent device ID
 *   • status=Active       — filter by accessory status
 *   • type=KEYBOARD       — filter by accessoryType
 *
 * CSV columns:
 * ```csv
 * accessory_id,parent_asset_code,accessory_type,brand,model,serial_number,status,installed_date,removed_date,remark
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
  { key: 'accessory_id', label: 'accessory_id' },
  { key: 'parent_asset_code', label: 'parent_asset_code' },
  { key: 'accessory_type', label: 'accessory_type' },
  { key: 'brand', label: 'brand' },
  { key: 'model', label: 'model' },
  { key: 'serial_number', label: 'serial_number' },
  { key: 'status', label: 'status' },
  { key: 'installed_date', label: 'installed_date' },
  { key: 'removed_date', label: 'removed_date' },
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
    const parentId = searchParams.get('parentId')?.trim() ?? ''
    const status = searchParams.get('status')?.trim() ?? ''
    const type = searchParams.get('type')?.trim() ?? ''

    // ── Build where clause ──
    // demoFilter applies on the DeviceAccessory table (it has isDemo).
    const where: Record<string, unknown> = { ...demoFilter(auth.user) }
    if (parentId) where.parentDeviceId = parentId
    if (status) where.status = status
    if (type) where.accessoryType = type
    if (site) {
      // Filter by parent device's site — we need a nested where on the
      // parentDevice relation.
      where.parentDevice = { site }
    }

    // ── Fetch accessories with parent device for asset_code lookup ──
    const accessories = await db.deviceAccessory.findMany({
      where,
      orderBy: [{ parentDeviceId: 'asc' }, { accessoryType: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        accessoryType: true,
        brand: true,
        model: true,
        serialNumber: true,
        status: true,
        installedDate: true,
        removedDate: true,
        remark: true,
        parentDevice: { select: { assetCode: true } },
      },
      // Safety cap — exporting > 50k rows via API is the wrong tool.
      // For larger exports, use the dedicated export-from-DB pipeline.
      take: 50_000,
    })

    // ── Build CSV ──
    const headerLine = COLUMNS.map((c) => escapeCsv(c.label)).join(',')
    const rows = accessories.map((a) =>
      COLUMNS.map((c) => {
        switch (c.key) {
          case 'accessory_id':
            return escapeCsv(csvVal(a.id))
          case 'parent_asset_code':
            return escapeCsv(csvVal(a.parentDevice?.assetCode))
          case 'accessory_type':
            return escapeCsv(csvVal(a.accessoryType))
          case 'brand':
            return escapeCsv(csvVal(a.brand))
          case 'model':
            return escapeCsv(csvVal(a.model))
          case 'serial_number':
            return escapeCsv(csvVal(a.serialNumber))
          case 'status':
            return escapeCsv(csvVal(a.status))
          case 'installed_date':
            return escapeCsv(csvVal(a.installedDate))
          case 'removed_date':
            return escapeCsv(csvVal(a.removedDate))
          case 'remark':
            return escapeCsv(csvVal(a.remark))
          default:
            return ''
        }
      }).join(','),
    )
    // UTF-8 BOM (\uFEFF) so Excel renders Thai text correctly.
    const csv = '\uFEFF' + [headerLine, ...rows].join('\n')

    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    const filename = `accessories-export-${stamp}.csv`

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
    console.error('GET /api/devices/accessories/export', err)
    const message =
      process.env.NODE_ENV === 'development'
        ? err instanceof Error
          ? err.message
          : 'Failed to export accessories'
        : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
