import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { demoFilter } from '@/lib/demo-mode'
import { canAccessSite } from '@/lib/auth'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * GET /api/licenses
 *
 * List ALL license records (across all devices), with optional filters.
 *
 * Query params (all optional, AND-combined):
 *   • site=PPIT         — filter by parent device site
 *   • expiring=30       — only licenses whose Expiry_Date is within the next
 *                         N days (and not already expired). The number is
 *                         parsed loosely; non-numeric values are ignored.
 *
 * Each license row is returned with a joined `device` object containing
 * `{ id, assetCode, name, site }` so the UI can render the "Device" column
 * without an extra round-trip per row.
 *
 * Response shape:
 *   { data: LicenseRow[] }
 *
 * Auth: requires `VIEW_DASHBOARD` (so anyone who can see the dashboard can
 * see the license overview). Demo users only see demo data, real users only
 * see real data — applied via `demoFilter(auth.user)`.
 *
 * NOTE: When a license row has no `deviceId` (legacy data linked only via
 * the `Asset_No` string), the `device` field is `null` — the UI shows "—".
 */

// Return different content per request — never cache.
export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface DeviceBrief {
  id: string
  assetCode: string
  name: string
  site: string
}

interface LicenseRow {
  id: string
  licenseId: string | null
  assetCode: string | null
  software: string
  licenseType: string | null
  licenseKey: string | null
  quantity: number
  expiryDate: string | null
  remark: string | null
  isActive: boolean
  deviceId: string | null
  device: DeviceBrief | null
  createdAt: string
  updatedAt: string
}

/** Parse the `expiring` query param into a positive integer (days). */
function parseExpiringDays(raw: string | null): number | null {
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}

/** Compute the ISO date string (yyyy-mm-dd) for "today + days". */
function isoPlusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'VIEW_DASHBOARD')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(req.url)
    const site = searchParams.get('site')?.trim() ?? ''
    const expiringDays = parseExpiringDays(searchParams.get('expiring'))

    // ── Build where clause ──
    // demoFilter applies on the LicenseRecord table (it has isDemo).
    const where: Record<string, unknown> = { ...demoFilter(auth.user) }

    if (site) {
      // Filter by parent device's site (works via the device relation).
      where.device = { site }
    }

    if (expiringDays !== null) {
      // Expiry_Date is a string in yyyy-mm-dd format (ISO date),
      // so lexicographic comparison gives the correct date range.
      const todayIso = new Date().toISOString().slice(0, 10)
      const upperIso = isoPlusDays(expiringDays)
      where.Expiry_Date = {
        gte: todayIso,
        lte: upperIso,
      }
    }

    // ── Fetch licenses with the joined device ──
    const rows = await db.licenseRecord.findMany({
      where,
      orderBy: [
        { Software: 'asc' },
        { Expiry_Date: 'asc' },
        { createdAt: 'desc' },
      ],
      include: {
        device: {
          select: {
            id: true,
            assetCode: true,
            name: true,
            site: true,
          },
        },
      },
      // Safety cap — if a tenant has more than 50k licenses, they should
      // use the CSV export endpoint instead of the JSON list.
      take: 50_000,
    })

    // ── Site-scope guard for non-admin users ──
    // Prisma's nested filter already returns only licenses whose parent
    // device.site matches; this guard also covers licenses whose parent
    // device lookup fell back to the legacy `Asset_No` string (no
    // `deviceId`). For those, we drop rows whose Asset_No points to a
    // device whose site the user can't access.
    const user = auth.row
    const isAdmin =
      user.role === 'admin' || user.role === 'superadmin'

    const data: LicenseRow[] = []
    for (const r of rows) {
      if (!isAdmin && r.device && !canAccessSite(user, r.device.site)) {
        continue
      }
      data.push({
        id: r.id,
        licenseId: r.License_ID,
        assetCode: r.Asset_No,
        software: r.Software,
        licenseType: r.LicenseType,
        licenseKey: r.License_Key,
        quantity: r.Quantity,
        expiryDate: r.Expiry_Date,
        remark: r.Remark,
        isActive: r.isActive,
        deviceId: r.deviceId,
        device: r.device
          ? {
              id: r.device.id,
              assetCode: r.device.assetCode,
              name: r.device.name,
              site: r.device.site,
            }
          : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })
    }

    return NextResponse.json({ data })
  } catch (err) {
    console.error('GET /api/licenses', err)
    const message =
      process.env.NODE_ENV === 'development'
        ? err instanceof Error
          ? err.message
          : 'Failed to fetch licenses'
        : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
