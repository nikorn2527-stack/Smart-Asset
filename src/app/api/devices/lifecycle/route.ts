import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { demoFilter } from '@/lib/demo-mode'
import { siteFilterForUser } from '@/lib/auth'

// Heavy operation — needs longer timeout (Vercel Hobby: max 60s)
export const maxDuration = 60

/**
 * Lifecycle / replacement-planning endpoint.
 *
 * NOTE: The Device model has NO `assetCode`, `name`, `purchaseDate`, or
 * `warrantyMonths` fields. Real schema (see prisma/schema.prisma):
 *   - `assetNo`     (was assetCode)
 *   - `brand` + `model`  (was name)
 *   - `installDate` (closest analog to purchaseDate — used for age)
 *   - `warrantyEnd` (the actual expiry date — used directly, not computed)
 *
 * This route:
 *   1. Computes a per-device replacement score from age + warranty status
 *      (kept identical to the legacy algorithm so the frontend's
 *      `replacementScore` / `recommendation` UI keeps working).
 *   2. Returns the legacy `{ devices, summary }` shape (frontend compat)
 *      PLUS the spec's new `{ byType, agingBuckets, warrantyExpired }`
 *      analytics shape.
 */

type WarrantyStatus = 'active' | 'expiring' | 'expired' | 'unknown'
type Recommendation = 'replace' | 'monitor' | 'ok'

interface LifecycleDevice {
  id: string
  assetCode: string
  name: string
  brand: string | null
  model: string | null
  site: string | null
  status: string
  deviceType: string | null
  purchaseDate: string | null
  ageInMonths: number
  warrantyStatus: WarrantyStatus
  warrantyExpiry: string | null
  replacementScore: number
  recommendation: Recommendation
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/

/** Build a display name from brand + model (falls back to assetCode). */
function deviceName(d: {
  brand: string | null
  model: string | null
  assetCode: string
}): string {
  if (d.brand && d.model) return `${d.brand} ${d.model}`.trim()
  if (d.brand) return d.brand
  if (d.model) return d.model
  return d.assetCode
}

/** Compute age in months from a YYYY-MM-DD purchase date. 0 if invalid. */
function computeAgeInMonths(purchaseDate: string | null | undefined): number {
  if (!purchaseDate || !DATE_RE.test(purchaseDate)) return 0
  const start = new Date(purchaseDate.slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(start.getTime())) return 0
  const now = new Date()
  let months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth())
  if (now.getDate() < start.getDate()) months -= 1
  return Math.max(0, months)
}

/** Compute warranty status from `warrantyEnd` (YYYY-MM-DD). */
function computeWarrantyStatus(
  warrantyEnd: string | null | undefined,
): { status: WarrantyStatus; expiryISO: string | null } {
  if (!warrantyEnd || !DATE_RE.test(warrantyEnd)) {
    return { status: 'unknown', expiryISO: null }
  }
  const expiryISO = warrantyEnd.slice(0, 10)
  const expiry = new Date(expiryISO + 'T00:00:00')
  if (Number.isNaN(expiry.getTime())) {
    return { status: 'unknown', expiryISO: null }
  }
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffMs = expiry.getTime() - today.getTime()
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24))
  if (days < 0) return { status: 'expired', expiryISO }
  if (days <= 30) return { status: 'expiring', expiryISO }
  return { status: 'active', expiryISO }
}

/** Canonical status bucket — matches the shared status-utils vocabulary. */
function isActiveStatus(raw: string): boolean {
  const s = (raw ?? '').trim().toLowerCase()
  return s === 'active' || s === 'in use' || s === 'ใช้งานอยู่'
}

/** Aging bucket label from age in months. */
function agingBucketLabel(ageInMonths: number): string {
  if (ageInMonths <= 0) return 'ไม่ระบุ'
  if (ageInMonths < 12) return '< 1 ปี'
  if (ageInMonths < 36) return '1–3 ปี'
  if (ageInMonths < 60) return '3–5 ปี'
  return '> 5 ปี'
}

const AGING_BUCKET_ORDER = ['ไม่ระบุ', '< 1 ปี', '1–3 ปี', '3–5 ปี', '> 5 ปี']

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    // QA-ROUND-2026-09-16-E: scope all three queries to the caller's data
    // (demo isolation + allowed sites). Previously unfiltered — demo users
    // saw real devices' lifecycle data and site-restricted users saw every
    // site. Same bug class as the warranty-route leak fixed this round.
    const scopedWhere = {
      ...demoFilter(auth.user),
      ...siteFilterForUser(auth.row),
    }
    // Fetch only the columns we need for lifecycle analysis. The schema has
    // indexes on `status` and `deviceType` so the groupBy queries below are
    // cheap; we still need the per-device rows for the replacement-score table.
    const [devices, byTypeGroups, statusGroups] = await Promise.all([
      db.device.findMany({
        where: scopedWhere,
        select: {
          id: true,
          assetCode: true,
          type: true,
          brand: true,
          model: true,
          site: true,
          status: true,
          purchaseDate: true,
          warrantyEnd: true,
        },
        orderBy: { assetCode: 'asc' },
      }),
      // Group by type × status to build the byType analytics without a
      // second findMany + JS loop. Prisma can group by multiple columns.
      db.device.groupBy({
        by: ['type', 'status'],
        where: scopedWhere,
        _count: { _all: true },
      }),
      // Group by status alone (used to fill the active/inactive totals when
      // a type has no rows for a given status).
      db.device.groupBy({
        by: ['status'],
        where: scopedWhere,
        _count: { _all: true },
      }),
    ])

    const entries: LifecycleDevice[] = devices.map((d) => {
      const { status: warrantyStatus, expiryISO } = computeWarrantyStatus(
        d.warrantyEnd,
      )
      const ageInMonths = computeAgeInMonths(d.purchaseDate)

      // Replacement score (0-100):
      //   - base by age: ramps from 0 at 0 months → 60 at 60 months (5y).
      //     +1.0 per month up to 60 months; beyond 60 months adds 0.4/mo.
      //   - +20 if warranty expired
      //   - +10 if warranty expiring
      //   - +15 if status=repair
      //   - clamp 0..100
      let score = 0
      if (ageInMonths > 0) {
        if (ageInMonths <= 60) {
          score += ageInMonths * 1.0
        } else {
          score += 60 + (ageInMonths - 60) * 0.4
        }
      }
      if (warrantyStatus === 'expired') score += 20
      else if (warrantyStatus === 'expiring') score += 10
      const rawStatus = (d.status ?? '').toLowerCase()
      if (rawStatus === 'repair' || rawStatus === 'in repair' || rawStatus === 'pending repair' || rawStatus === 'ส่งซ่อม') {
        score += 15
      }
      score = Math.max(0, Math.min(100, Math.round(score)))

      const recommendation: Recommendation =
        score >= 70 ? 'replace' : score >= 40 ? 'monitor' : 'ok'

      return {
        id: d.id,
        assetCode: d.assetCode,
        name: deviceName(d),
        brand: d.brand,
        model: d.model,
        site: d.site,
        status: d.status,
        deviceType: d.type,
        purchaseDate: d.purchaseDate,
        ageInMonths,
        warrantyStatus,
        warrantyExpiry: expiryISO,
        replacementScore: score,
        recommendation,
      }
    })

    entries.sort((a, b) => b.replacementScore - a.replacementScore)

    // ---- Per-device summary (legacy shape, for the frontend) ----
    const total = entries.length
    const replaceCount = entries.filter(
      (e) => e.recommendation === 'replace',
    ).length
    const monitorCount = entries.filter(
      (e) => e.recommendation === 'monitor',
    ).length
    const okCount = entries.filter((e) => e.recommendation === 'ok').length
    const avgAge =
      total === 0
        ? 0
        : Math.round(entries.reduce((s, e) => s + e.ageInMonths, 0) / total)

    // ---- Spec-shape analytics ----
    // byType: [{ type, total, active, inactive }]
    // Built from the deviceType × status groupBy result.
    const typeMap = new Map<
      string,
      { total: number; active: number; inactive: number }
    >()
    for (const g of byTypeGroups) {
      const typeKey = g.type ?? 'ไม่ระบุ'
      const count = g._count._all
      const entry = typeMap.get(typeKey) ?? { total: 0, active: 0, inactive: 0 }
      entry.total += count
      if (isActiveStatus(g.status)) {
        entry.active += count
      } else {
        entry.inactive += count
      }
      typeMap.set(typeKey, entry)
    }
    const byType = Array.from(typeMap.entries())
      .map(([type, v]) => ({ type, ...v }))
      .sort((a, b) => b.total - a.total)

    // agingBuckets: [{ label, count }]
    const agingMap = new Map<string, number>()
    for (const label of AGING_BUCKET_ORDER) agingMap.set(label, 0)
    for (const e of entries) {
      const label = agingBucketLabel(e.ageInMonths)
      agingMap.set(label, (agingMap.get(label) ?? 0) + 1)
    }
    const agingBuckets = AGING_BUCKET_ORDER.map((label) => ({
      label,
      count: agingMap.get(label) ?? 0,
    }))

    // warrantyExpired: count of devices whose warrantyEnd is in the past
    const warrantyExpired = entries.filter(
      (e) => e.warrantyStatus === 'expired',
    ).length

    // Status groups are fetched for future use; expose them as a bonus field
    // (the spec doesn't require it, but it's cheap and useful for dashboards).
    const byStatus = statusGroups.map((g) => ({
      status: g.status,
      count: g._count._all,
    }))

    return NextResponse.json({
      // Legacy shape (frontend reads `devices` + `summary`).
      devices: entries,
      summary: {
        total,
        replace: replaceCount,
        monitor: monitorCount,
        ok: okCount,
        avgAge,
      },
      // Spec shape — analytics aggregations.
      byType,
      agingBuckets,
      warrantyExpired,
      byStatus,
    })
  } catch (err) {
    console.error('GET /api/devices/lifecycle', err)
    return NextResponse.json(
      { error: 'Failed to fetch lifecycle data' },
      { status: 500 },
    )
  }
}
