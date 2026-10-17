/**
 * full-text-search.ts — cross-entity search helpers (SQLite-native).
 *
 * QA-ROUND-G REWRITE: the previous implementation tried PostgreSQL
 * `to_tsvector`/`plainto_tsquery` raw SQL first and fell back to Prisma
 * `contains` when it failed. On the SQLite deployment the FTS attempt threw
 * on EVERY call (wasted roundtrip + console spam), and — worse — the
 * fallback had NO demo/site scoping, so demo users could look up REAL
 * devices/stock/work orders through the QR-scan flows that call this route.
 *
 * The helpers now:
 *   - run plain Prisma `contains` queries (SQLite LIKE is case-insensitive
 *     for ASCII; Thai script has no case, so `mode: 'insensitive'` is
 *     unnecessary — and it is not supported on SQLite anyway)
 *   - accept a `user` and apply `demoFilter` + the user's allowed-sites scope
 *     (devices/stock via `site`, work orders via `siteCode`)
 *
 * If the project ever moves to PostgreSQL, the GIN/tsvector version can be
 * reintroduced — see the git history for the original implementation.
 */

import { db } from './db'
import { demoFilter } from './demo-mode'

export interface SearchResult {
  id: string
  type: 'device' | 'work-order' | 'stock-item' | 'meter-reading' | 'master'
  title: string
  subtitle: string
  url?: string
  score?: number
}

/** Scope info derived from the authenticated user. */
export interface SearchScope {
  /** Demo users see only isDemo rows; real users see only real rows. */
  isDemo?: boolean | null
  /** Comma-separated allowed site codes, or 'ALL' / empty for unrestricted. */
  allowedSites?: string | null
}

function siteList(scope: SearchScope | undefined): string[] | null {
  const raw = String(scope?.allowedSites ?? '').trim()
  if (!raw || raw.toUpperCase() === 'ALL') return null
  const arr = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return arr.length ? arr : null
}

/**
 * Search devices.
 * Searchable fields: assetCode, name, brand, model, serialNumber, site, department
 */
export async function searchDevices(
  query: string,
  options: { limit?: number; siteCode?: string; user?: SearchScope } = {},
): Promise<SearchResult[]> {
  const limit = Math.min(options.limit ?? 20, 100)
  const q = query.trim()
  if (!q) return []

  const sites = siteList(options.user)
  const where = {
    ...demoFilter(options.user ?? null),
    ...(options.siteCode ? { site: options.siteCode } : sites ? { site: { in: sites } } : {}),
    OR: [
      { assetCode: { contains: q } },
      { name: { contains: q } },
      { brand: { contains: q } },
      { model: { contains: q } },
      { serialNumber: { contains: q } },
      { site: { contains: q } },
      { department: { contains: q } },
    ],
  }

  const devices = await db.device.findMany({
    where,
    select: {
      id: true,
      assetCode: true,
      name: true,
      brand: true,
      model: true,
      serialNumber: true,
      site: true,
    },
    take: limit,
    orderBy: { assetCode: 'asc' },
  })

  return devices.map((d) => ({
    id: d.id,
    type: 'device' as const,
    title: `${d.assetCode ?? ''} — ${d.name ?? ''}`.trim(),
    subtitle: `${d.brand ?? ''} ${d.model ?? ''} · ${d.serialNumber ?? ''} · ${d.site ?? ''}`.trim(),
  }))
}

/**
 * Search work orders.
 * Searchable fields: woNumber, subject, reporterName, tel, details, siteCode
 */
export async function searchWorkOrders(
  query: string,
  options: { limit?: number; siteCode?: string; user?: SearchScope } = {},
): Promise<SearchResult[]> {
  const limit = Math.min(options.limit ?? 20, 100)
  const q = query.trim()
  if (!q) return []

  const sites = siteList(options.user)
  const wos = await db.workOrder.findMany({
    where: {
      ...demoFilter(options.user ?? null),
      ...(options.siteCode
        ? { siteCode: options.siteCode }
        : sites
          ? { siteCode: { in: sites } }
          : {}),
      OR: [
        { woNumber: { contains: q } },
        { subject: { contains: q } },
        { reporterName: { contains: q } },
        { tel: { contains: q } },
        { details: { contains: q } },
      ],
    },
    select: {
      id: true,
      woNumber: true,
      subject: true,
      reporterName: true,
      tel: true,
      siteCode: true,
    },
    take: limit,
    orderBy: { createdAt: 'desc' },
  })

  return wos.map((w) => ({
    id: w.id,
    type: 'work-order' as const,
    title: `${w.woNumber ?? ''} — ${w.subject ?? ''}`.trim(),
    subtitle: `${w.reporterName ?? ''} · ${w.tel ?? ''} · ${w.siteCode ?? ''}`.trim(),
  }))
}

/**
 * Search stock items.
 * Searchable fields: productCode, productName, brand, model
 */
export async function searchStockItems(
  query: string,
  options: { limit?: number; user?: SearchScope } = {},
): Promise<SearchResult[]> {
  const limit = Math.min(options.limit ?? 20, 100)
  const q = query.trim()
  if (!q) return []

  const sites = siteList(options.user)
  const items = await db.stockItem.findMany({
    where: {
      ...demoFilter(options.user ?? null),
      ...(sites ? { OR: [{ site: null }, { site: { in: sites } }] } : {}),
      AND: [
        {
          OR: [
            { productCode: { contains: q } },
            { productName: { contains: q } },
            { brand: { contains: q } },
            { model: { contains: q } },
          ],
        },
      ],
    },
    select: {
      id: true,
      productCode: true,
      productName: true,
      brand: true,
      model: true,
      quantity: true,
    },
    take: limit,
  })

  return items.map((s) => ({
    id: s.id,
    type: 'stock-item' as const,
    title: `${s.productCode ?? ''} — ${s.productName ?? ''}`.trim(),
    subtitle: `${s.brand ?? ''} ${s.model ?? ''} · คงเหลือ: ${s.quantity}`.trim(),
  }))
}

/**
 * Universal search across all entity types.
 * Returns combined results sorted by relevance.
 */
export async function searchAll(
  query: string,
  options: { limit?: number; siteCode?: string; user?: SearchScope } = {},
): Promise<SearchResult[]> {
  const limit = options.limit ?? 10
  const [devices, wos, stock] = await Promise.all([
    searchDevices(query, { limit, siteCode: options.siteCode, user: options.user }),
    searchWorkOrders(query, { limit, siteCode: options.siteCode, user: options.user }),
    searchStockItems(query, { limit, user: options.user }),
  ])

  // Combine + sort by score (if available), otherwise interleave
  const all = [...devices, ...wos, ...stock]
  return all
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit * 3) // 3x because we want variety across types
}
