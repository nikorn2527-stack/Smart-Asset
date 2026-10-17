import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isNumericShortQuery } from '@/lib/suffix-search'
import { verifyToken } from '@/lib/auth'

/**
 * GET /api/search?q=<query>[&type=all|devices|masters]
 *
 * Performance optimized:
 *   - All queries run in PARALLEL (Promise.all)
 *   - Uses select to reduce payload
 *   - Short numeric: suffix match first (1 query, not 3)
 *   - Results limited to 8 per type
 *
 * Auth (FIX API-BUG-044): Bearer token required AND must be a valid signed JWT.
 *   Previously this route only checked that the header STARTED with "Bearer "
 *   — any garbage string after that prefix would pass, allowing unauthenticated
 *   search across ALL sites (bypassing row-level security).
 *   Now we call verifyToken() to check signature + expiry before running queries.
 *   We do NOT call requireAuth() (which also loads the user row from DB) because
 *   search is on the hot path and we only need to verify identity, not refresh
 *   permissions on every keystroke.
 *
 * DEMO/SITE ISOLATION (QA-ROUND-G fix): this route used to query WITHOUT any
 *   demo or site scope — demo users could search and see REAL hospital data
 *   (e.g. querying "UDH" as demo_admin returned real devices). The JWT payload
 *   carries `email` + `allowedSites`, which is enough to scope without loading
 *   the user row (keeping the hot path fast):
 *   - demo = payload.email ends with @itam.demo (every demo account uses that
 *     domain — same discriminator the SSE route uses for audit actors).
 *   - sites = payload.allowedSites ('ALL' for admins, otherwise a comma-separated
 *     site-code list).
 */

// Cache for 30 seconds — search results don't change frequently
export const revalidate = 30
export const dynamic = 'force-dynamic'

interface SearchDevice {
  type: 'device'
  id: string
  title: string
  subtitle: string
  url: null
}
interface SearchMaster {
  type: 'master'
  id: string
  title: string
  subtitle: string
}
interface SearchWorkOrder {
  type: 'workorder'
  id: string
  title: string
  subtitle: string
}
interface SearchStock {
  type: 'stock'
  id: string
  title: string
  subtitle: string
}

interface SearchResults {
  devices: SearchDevice[]
  master: SearchMaster[]
  workOrders: SearchWorkOrder[]
  stock: SearchStock[]
  meter: unknown[]
  audit: unknown[]
  sites: unknown[]
}

const EMPTY: SearchResults = {
  devices: [],
  master: [],
  workOrders: [],
  stock: [],
  meter: [],
  audit: [],
  sites: [],
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // FIX API-BUG-044: verify the JWT signature + expiry, don't just trust
    // that the header starts with "Bearer ". A garbage token like
    // "Bearer foobar" used to pass and let anyone search across all sites.
    const token = authHeader.slice(7).trim()
    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    // ── DEMO/SITE scope derived from the JWT (see route docs) ──
    const isDemo = payload.email.toLowerCase().endsWith('@itam.demo')
    const demoScope = { isDemo } // demo users see only demo rows, real users only real rows
    const allowedRaw = String(payload.allowedSites ?? '').trim()
    const siteScope =
      !allowedRaw || allowedRaw === 'ALL'
        ? null
        : allowedRaw.split(',').map((s) => s.trim()).filter(Boolean)

    const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
    const searchType = (new URL(req.url).searchParams.get('type') ?? 'all').trim()
    if (q.length < 2) {
      return NextResponse.json({ results: EMPTY, total: 0 })
    }

    const isShort = isNumericShortQuery(q)

    // ── Build device where clause (1 query, not 3) ──
    // For short numeric: try suffix + contains in one query
    // For text: contains on all fields
    const deviceWhere = {
      ...demoScope,
      ...(siteScope ? { site: { in: siteScope } } : {}),
      ...(isShort
        ? {
            OR: [
              { assetCode: { endsWith: q } },
              { serialNumber: { endsWith: q } },
              { assetSiteCode: { endsWith: q } },
              { assetCode: { contains: q } },
              { serialNumber: { contains: q } },
            ],
          }
        : {
            OR: [
              { assetCode: { contains: q } },
              { serialNumber: { contains: q } },
              { name: { contains: q } },
              { brand: { contains: q } },
              { model: { contains: q } },
            ],
          }),
    }

    // ── Build master where clause ──
    // Composed via AND: the site scope OR and the search OR must BOTH apply
    // (a naive spread would let the second OR overwrite the first).
    const masterWhere = {
      ...demoScope,
      AND: [
        ...(siteScope
          ? [{ OR: [{ siteCode: null }, { siteCode: 'ALL' }, { siteCode: { in: siteScope } }] }]
          : []),
        {
          OR: isShort
            ? [
                { code: { endsWith: q } },
                { code: { contains: q } },
                { label: { contains: q } },
              ]
            : [
                { code: { contains: q } },
                { label: { contains: q } },
              ],
        },
      ],
    }

    // ── Build work-order where clause (QA-ROUND-G feature) ──
    const woWhere = {
      ...demoScope,
      ...(siteScope ? { siteCode: { in: siteScope } } : {}),
      OR: [
        { woNumber: { contains: q } },
        { systemJobNo: { contains: q } },
        { subject: { contains: q } },
        { reporterName: { contains: q } },
        { building: { contains: q } },
      ],
    }
    // ── Build stock where clause (QA-ROUND-G feature) ──
    // Composed via AND (site scope OR + search OR must both apply).
    const stockWhere = {
      ...demoScope,
      AND: [
        ...(siteScope ? [{ OR: [{ site: null }, { site: { in: siteScope } }] }] : []),
        {
          OR: isShort
            ? [
                { productCode: { endsWith: q } },
                { productCode: { contains: q } },
                { productName: { contains: q } },
              ]
            : [
                { productCode: { contains: q } },
                { productName: { contains: q } },
                { brand: { contains: q } },
                { model: { contains: q } },
              ],
        },
      ],
    }

    // ── Run queries in PARALLEL ──
    const [devices, masters, workOrders, stock] = await Promise.all([
      db.device.findMany({
        where: deviceWhere,
        take: 8,
        orderBy: { assetCode: 'asc' },
        select: {
          id: true,
          assetCode: true,
          name: true,
          brand: true,
          model: true,
          serialNumber: true,
          site: true,
        },
      }),
      searchType === 'all' || searchType === 'masters'
        ? db.masterItem.findMany({
            where: masterWhere,
            take: 5,
            orderBy: { code: 'asc' },
            select: {
              id: true,
              code: true,
              label: true,
              category: true,
            },
          })
        : Promise.resolve([]),
      db.workOrder.findMany({
        where: woWhere,
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          woNumber: true,
          systemJobNo: true,
          subject: true,
          status: true,
          reporterName: true,
        },
      }),
      db.stockItem.findMany({
        where: stockWhere,
        take: 5,
        orderBy: { productName: 'asc' },
        select: {
          id: true,
          productCode: true,
          productName: true,
          brand: true,
          quantity: true,
          unit: true,
          minQuantity: true,
        },
      }),
    ])

    const deviceResults: SearchDevice[] = devices.map((d) => ({
      type: 'device' as const,
      id: d.id,
      title: `${d.assetCode} · ${d.name}`,
      subtitle: `S/N: ${d.serialNumber ?? '-'} | ${d.brand ?? ''} ${d.model ?? ''} · ${d.site ?? ''}`,
      url: null,
    }))

    const masterResults: SearchMaster[] = masters.map((m) => ({
      type: 'master' as const,
      id: m.id,
      title: m.code,
      subtitle: `${m.label} · ${m.category}`,
    }))

    const woResults: SearchWorkOrder[] = workOrders.map((w) => ({
      type: 'workorder' as const,
      id: w.id,
      title: `${w.woNumber ?? w.systemJobNo ?? '—'} · ${w.subject}`,
      subtitle: `${w.reporterName ?? '—'} · ${w.status}`,
    }))

    const stockResults: SearchStock[] = stock.map((s) => ({
      type: 'stock' as const,
      id: s.id,
      title: `${s.productCode} · ${s.productName}`,
      subtitle: `${s.brand ?? ''} · คงเหลือ ${s.quantity} ${s.unit ?? 'ชิ้น'}${
        s.minQuantity > 0 && s.quantity <= s.minQuantity ? ' · ⚠ ต่ำกว่าขั้นต่ำ' : ''
      }`,
    }))

    const results: SearchResults = {
      devices: deviceResults,
      master: masterResults,
      workOrders: woResults,
      stock: stockResults,
      meter: [],
      audit: [],
      sites: [],
    }

    const total =
      results.devices.length + results.master.length + results.workOrders.length + results.stock.length

    return NextResponse.json({ results, total })
  } catch (err) {
    console.error('GET /api/search', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
