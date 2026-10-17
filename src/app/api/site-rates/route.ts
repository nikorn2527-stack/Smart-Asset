import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireAuth } from '@/lib/auth-middleware'

// Cache site rates for 5 minutes — changes infrequently
export const revalidate = 300

export async function GET(req: NextRequest) {
  // ── P0 Security: require authentication ──
  // Site rates are internal financial data; staff need read access but the
  // endpoint must not be publicly callable.
  const auth = await requireAuth(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    // APPENDIX-F: query SiteAttribute (the live sites master) instead of the
    // legacy `Site` table (which has 0 rows in production). Field mapping:
    //   Site.code   → SiteAttribute.SiteCode
    //   Site.name   → SiteAttribute.SiteName
    // We keep the { id, code, name } response shape so existing callers
    // don't break (the front-end still consumes `code` / `name`).
    const [rates, sites] = await Promise.all([
      db.siteRate.findMany({
        orderBy: { siteCode: 'asc' },
        // SiteRate has no effectiveFrom/effectiveTo/isActive columns — rates are
        // current-only. createdAt/updatedAt are selected because the response
        // mapper below returns them (they were being read off an unselected row).
        select: {
          id: true,
          siteCode: true,
          bwRate: true,
          colorRate: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      db.siteAttribute.findMany({
        select: { id: true, SiteCode: true, SiteName: true },
      }),
    ])
    const siteNameMap = new Map(
      sites.map((s) => [s.SiteCode, s.SiteName ?? s.SiteCode] as const),
    )

    // Auto-seed default rates for sites that don't yet have one
    const sitesWithoutRate = sites.filter(
      (s) => !rates.some((r) => r.siteCode === s.SiteCode),
    )
    if (sitesWithoutRate.length > 0) {
      await db.siteRate.createMany({
        data: sitesWithoutRate.map((s) => ({
          siteCode: s.SiteCode,
          bwRate: 0.5,
          colorRate: 2.0,
        })),
      })
      const refreshed = await db.siteRate.findMany({
        orderBy: { siteCode: 'asc' },
      })
      const merged = refreshed.map((r) => ({
        id: r.id,
        siteCode: r.siteCode,
        siteName: siteNameMap.get(r.siteCode) ?? r.siteCode,
        bwRate: r.bwRate,
        colorRate: r.colorRate,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }))
      return NextResponse.json({ rates: merged })
    }

    const merged = rates.map((r) => ({
      id: r.id,
      siteCode: r.siteCode,
      siteName: siteNameMap.get(r.siteCode) ?? r.siteCode,
      bwRate: r.bwRate,
      colorRate: r.colorRate,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }))
    return NextResponse.json({ rates: merged })
  } catch (err) {
    console.error('GET /api/site-rates', err)
    return NextResponse.json(
      { error: 'Failed to fetch site rates' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  // ── P0 Security: require ADMIN permission for writes ──
  // Setting/changing paper rates is an admin-only operation.
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await req.json()
    const { siteCode, bwRate, colorRate } = body as {
      siteCode?: string
      bwRate?: number
      colorRate?: number
    }
    if (!siteCode || !siteCode.trim()) {
      return NextResponse.json(
        { error: 'Missing required field: siteCode' },
        { status: 400 },
      )
    }
    const code = String(siteCode).trim()
    // APPENDIX-F: look up SiteAttribute by SiteCode (was: Site.code).
    const site = await db.siteAttribute.findUnique({
      where: { SiteCode: code },
      select: { SiteCode: true, SiteName: true },
    })
    if (!site) {
      return NextResponse.json(
        { error: `Site not found: ${code}` },
        { status: 404 },
      )
    }
    const bw = typeof bwRate === 'number' ? bwRate : 0.5
    const color = typeof colorRate === 'number' ? colorRate : 2.0

    const existing = await db.siteRate.findFirst({ where: { siteCode: code } })
    let rate
    if (existing) {
      rate = await db.siteRate.update({
        where: { id: existing.id },
        data: { bwRate: bw, colorRate: color },
      })
      await logAudit(
        'UPDATE',
        'Setting',
        rate.id,
        `แก้ไขอัตราค่ากระดาษสาขา ${code}: ขาวดำ ${bw}฿ / สี ${color}฿`,
        { siteCode: code, bwRate: bw, colorRate: color },
      )
    } else {
      rate = await db.siteRate.create({
        data: { siteCode: code, bwRate: bw, colorRate: color },
      })
      await logAudit(
        'CREATE',
        'Setting',
        rate.id,
        `ตั้งค่าอัตราค่ากระดาษสาขา ${code}: ขาวดำ ${bw}฿ / สี ${color}฿`,
        { siteCode: code, bwRate: bw, colorRate: color },
      )
    }
    return NextResponse.json(
      {
        rate: {
          id: rate.id,
          siteCode: rate.siteCode,
          // APPENDIX-F: use SiteAttribute.SiteName (was: site.name).
          siteName: site.SiteName ?? code,
          bwRate: rate.bwRate,
          colorRate: rate.colorRate,
          createdAt: rate.createdAt,
          updatedAt: rate.updatedAt,
        },
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('POST /api/site-rates', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to save rate') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
