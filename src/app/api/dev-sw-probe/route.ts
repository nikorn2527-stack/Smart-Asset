import { NextResponse } from 'next/server'

/**
 * GET /api/dev-sw-probe
 *
 * Returns 204 (No Content) in development mode, 404 in production.
 *
 * This endpoint exists solely as a "dev mode marker" for the service worker
 * (public/sw.js). When the SW activates, it fetches this endpoint:
 *   - 204 → we're in dev mode → SW self-unregisters + clears all caches
 *     (prevents stale Turbopack chunks from crashing the page)
 *   - 404 → we're in production → SW runs normally (offline cache enabled)
 *
 * Why an endpoint instead of a static file?
 *   - A static file would be cached by the SW itself, defeating the probe.
 *   - An API route is always dynamic (never cached by Next.js), so the SW
 *     gets a fresh answer every time.
 *
 * NOTE: do NOT name this folder with a leading underscore (_dev-sw-probe)
 * because Next.js App Router treats folders starting with `_` as private
 * folders and does NOT register their route handlers.
 */
export function GET() {
  if (process.env.NODE_ENV === 'development') {
    return new NextResponse(null, { status: 204 })
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}
