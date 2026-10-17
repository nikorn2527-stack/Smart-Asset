/**
 * route-config.ts — Shared Next.js Route Segment Config for API routes.
 *
 * Usage:
 *   import { HEAVY_API, STANDARD_API, EDGE_API, CACHEABLE_API } from '@/lib/route-config'
 *
 *   export const { maxDuration, runtime } = HEAVY_API
 *
 * Tiers:
 *   - HEAVY_API: 60s — import CSV, report generation, sync, force-close
 *   - STANDARD_API: 30s — normal CRUD with DB writes
 *   - LIGHT_API: 10s (Vercel Hobby default) — simple reads
 *   - EDGE_API: edge runtime — health checks, public reads
 *   - CACHEABLE_API: with revalidate — master data, settings
 *
 * Vercel limits:
 *   - Hobby: 10s default, max 60s
 *   - Pro: 15s default, max 300s
 *   - Enterprise: 60s default, max 900s
 */

export const HEAVY_API = {
  maxDuration: 60,
  runtime: 'nodejs' as const,
}

export const STANDARD_API = {
  maxDuration: 30,
  runtime: 'nodejs' as const,
}

export const LIGHT_API = {
  maxDuration: 10,
  runtime: 'nodejs' as const,
}

export const EDGE_API = {
  runtime: 'edge' as const,
}

/**
 * Cacheable API config for data that changes infrequently.
 * Examples: master data, sites, settings, org-profile.
 *
 * @param revalidateSeconds - seconds before cache invalidated (default 300 = 5 min)
 */
export function cacheableApi(revalidateSeconds = 300) {
  return {
    runtime: 'nodejs' as const,
    // Note: force-dynamic overrides revalidate. Use only one.
    // For read-heavy endpoints, use `revalidate` + remove `dynamic = 'force-dynamic'`.
    revalidate: revalidateSeconds,
  }
}

/**
 * Heavy API routes that process bulk data or run complex aggregations.
 * These need longer timeouts to avoid Vercel 10s default timeout.
 */
export const HEAVY_ROUTE_PATTERNS = [
  // Import / Export
  'api/import',
  'api/devices/import',
  'api/itam/devices/import',
  // Sync
  'api/sync/run',
  'api/sync/google-sheets',
  'api/sync/preview',
  'api/master/sync',
  'api/site-attributes/sync',
  // Reports
  'api/reports/unified',
  'api/reports/monthly',
  'api/reports/wo-cost-summary',
  'api/cycles/[id]/report',
  // Meter heavy ops
  'api/itam/meter-readings/force-close',
  // Bulk operations
  'api/work-orders/batch-status',
] as const
