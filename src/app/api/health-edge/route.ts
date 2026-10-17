/**
 * health-edge/route.ts — Lightweight health check on Edge runtime
 *
 * Why Edge runtime?
 * - Cold start ~50ms (vs Node.js ~200-500ms)
 * - Free tier: 1M Edge Requests/month
 * - Global edge locations (300+)
 *
 * This route doesn't query DB (DB queries require Node.js runtime).
 * Use /api/health (Node.js) for DB health, /api/health-edge for uptime checks.
 *
 * Usage:
 *   GET /api/health-edge → { ok: true, region: 'edge', ts: ... }
 */

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({
    ok: true,
    runtime: 'edge',
    region: process.env.VERCEL_REGION || 'unknown',
    timestamp: new Date().toISOString(),
    deployment: process.env.VERCEL_DEPLOYMENT_ID || 'dev',
    gitCommit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'unknown',
  })
}
