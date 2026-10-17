import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyCronSecret } from '@/lib/cron-auth'

/**
 * GET /api/cron/keepalive
 *
 * Cron job — runs daily (Mon 9 AM) to:
 *   1. Prevent Supabase Free auto-pause (7 days inactivity → pause)
 *   2. Ping Vercel KV (if configured) to keep connection warm
 *   3. Log health snapshot for monitoring
 *
 * Setup in vercel.json:
 *   "crons": [{ "path": "/api/cron/keepalive", "schedule": "0 9 * * 1" }]
 *
 * Security: requires CRON_SECRET header (set in Vercel env vars).
 * In development (no CRON_SECRET set), allows access without auth.
 */
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const auth = verifyCronSecret(req)
  if (auth) return auth

  const results: { service: string; status: string; latencyMs?: number }[] = []

  // ── 1. Database keepalive (critical) ──
  const dbStart = Date.now()
  try {
    await db.$queryRaw`SELECT 1`
    const userCount = await db.user.count()
    results.push({
      service: 'database',
      status: 'up',
      latencyMs: Date.now() - dbStart,
    })
    // Log to console (visible in Vercel logs)
    console.log(`[keepalive] DB up — ${userCount} users, ${Date.now() - dbStart}ms`)
  } catch (err) {
    console.error('[keepalive] DB down:', err)
    results.push({
      service: 'database',
      status: 'down',
      latencyMs: Date.now() - dbStart,
    })
    return NextResponse.json(
      { ok: false, error: 'Database unreachable', results },
      { status: 500 },
    )
  }

  // ── 2. Vercel KV keepalive (optional) ──
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const kvStart = Date.now()
    try {
      // SET a keepalive timestamp key (auto-expires in 8 days)
      await fetch(
        `${process.env.KV_REST_API_URL}/set/keepalive:ts/${Date.now()}/EX/691200`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
        },
      )
      results.push({
        service: 'vercel-kv',
        status: 'up',
        latencyMs: Date.now() - kvStart,
      })
    } catch (err) {
      console.warn('[keepalive] KV ping failed:', err)
      results.push({
        service: 'vercel-kv',
        status: 'down',
        latencyMs: Date.now() - kvStart,
      })
    }
  }

  // ── 3. Supabase Realtime keepalive (optional) ──
  // Just log that it's configured — no actual ping needed
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    results.push({
      service: 'supabase-realtime',
      status: 'configured',
    })
  }

  return NextResponse.json({
    ok: true,
    ts: Date.now(),
    // `true` when no CRON_SECRET is configured, i.e. the route is running
    // in open dev mode (verifyCronSecret allows unauthenticated access).
    dev: !process.env.CRON_SECRET,
    results,
  })
}
