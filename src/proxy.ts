/**
 * proxy.ts — Edge runtime proxy for:
 *   1. Maintenance mode check (via Edge Config — <50ms globally)
 *   2. Optional: rate limiting on public endpoints
 *
 * Why proxy (not route handlers):
 *   - Runs on Edge runtime (global, ~50ms)
 *   - Before route handlers → fast fail for maintenance mode
 *   - Doesn't consume serverless function invocations
 *
 * Maintenance mode check:
 *   - Reads from Edge Config (if configured)
 *   - Returns 503 with maintenance page if enabled
 *   - Allows /api/health, /api/health-edge to still work (for monitoring)
 *   - Allows /_next/* static files (so maintenance page renders)
 *
 * Setup:
 *   1. Create Edge Config: Vercel Dashboard → Storage → Create → Edge Config
 *   2. Link to project: vercel link + vercel env pull
 *   3. Set maintenance flag:
 *      curl -X PATCH "https://api.vercel.com/v1/edge-config/{EC_ID}/items?teamId={TEAM}" \
 *        -H "Authorization: Bearer {TOKEN}" \
 *        -H "Content-Type: application/json" \
 *        -d '{ "items": [{ "operation": "upsert", "key": "feature.maintenanceMode", "value": true }] }'
 */

import { NextRequest, NextResponse } from 'next/server'

// Paths that bypass maintenance mode check
const BYPASS_PATHS = [
  '/api/health',
  '/api/health-edge',
  '/api/cron/keepalive',
  '/api/cron/daily-report',
  '/_next',
  '/favicon.ico',
  '/sw-push.js',
  '/manifest.json',
]

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2)$).*)',
  ],
}

/**
 * Safely get a value from Edge Config.
 * Returns null if Edge Config is not configured or the get fails.
 * Uses dynamic import to avoid module-level crashes on Vercel.
 */
async function safeGet<T>(key: string): Promise<T | null> {
  if (!process.env.EDGE_CONFIG) return null
  try {
    const { get } = await import('@vercel/edge-config')
    // get() resolves to undefined for a missing key — normalise to null so the
    // declared `T | null` contract holds and callers can rely on `?? default`.
    return (await get<T>(key)) ?? null
  } catch {
    // Edge Config not available or error — don't block traffic
    return null
  }
}

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname

  // ── Maintenance mode check (Edge Config) ──
  const maintenanceMode = await safeGet<boolean>('feature.maintenanceMode')
  if (maintenanceMode) {
    // Allow bypass paths
    if (BYPASS_PATHS.some((p) => path.startsWith(p))) {
      return NextResponse.next()
    }

    // API routes get JSON 503
    if (path.startsWith('/api/')) {
      return NextResponse.json(
        {
          error: 'ระบบอยู่ในช่วงปิดบำรุง กรุณาลองใหม่ภายหลัง',
          maintenance: true,
          retryAfter: 300,
        },
        { status: 503, headers: { 'Retry-After': '300' } },
      )
    }

    // HTML pages get maintenance page
    const maintenanceUrl = new URL('/maintenance', req.url)
    return NextResponse.rewrite(maintenanceUrl)
  }

  // ── Read-only mode (block writes) ──
  const readOnly = await safeGet<boolean>('feature.readOnly')
  if (readOnly && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    // Allow login + cron
    if (
      path.startsWith('/api/itam/auth/') ||
      path.startsWith('/api/cron/')
    ) {
      return NextResponse.next()
    }

    if (path.startsWith('/api/')) {
      return NextResponse.json(
        {
          error: 'ระบบอยู่ในโหมดอ่านอย่างเดียว (บำรุงระบบ) — ไม่สามารถบันทึกข้อมูลได้',
          readOnly: true,
        },
        { status: 503 },
      )
    }
  }

  // ── Dev-mode cache-busting ──
  // Force the browser (especially the preview-panel iframe) to always fetch
  // fresh HTML in dev mode. Without this, the iframe caches stale chunk URLs
  // across dev server restarts and shows "This page couldn't load".
  const res = NextResponse.next()
  if (process.env.NODE_ENV === 'development') {
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.headers.set('Pragma', 'no-cache')
    res.headers.set('Expires', '0')
  }
  return res
}
