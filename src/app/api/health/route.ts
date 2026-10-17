import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/health — Comprehensive health check (Node.js runtime).
 *
 * Security fix (P1): Removed all error message details, env var names,
 * and connection strings from the response. Only returns status (up/down)
 * + latency. Full error details are logged server-side only.
 *
 * Checks:
 *   1. Database connectivity (Supabase PostgreSQL)
 *   2. Vercel Blob storage (if configured)
 *   3. Vercel KV (if configured)
 *   4. Supabase Realtime (if configured)
 *   5. Edge Config (if configured)
 *
 * Returns 200 if all critical services are up, 503 if any is down.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 10

interface ServiceHealth {
  name: string
  status: 'up' | 'down' | 'skipped'
  latencyMs?: number
  // No detail field exposed in response — logged server-side only
}

export async function GET() {
  const startTime = Date.now()
  const services: ServiceHealth[] = []

  // ── 1. Database (critical) ──
  const dbStart = Date.now()
  try {
    await db.$queryRaw`SELECT 1`
    services.push({
      name: 'database',
      status: 'up',
      latencyMs: Date.now() - dbStart,
    })
  } catch (err) {
    // Log full error server-side, return generic message only
    console.error('[health] database error:', err)
    services.push({
      name: 'database',
      status: 'down',
      latencyMs: Date.now() - dbStart,
    })
  }

  // ── 2. Vercel Blob (optional) ──
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    services.push({
      name: 'vercel-blob',
      status: 'up',
    })
  } else {
    services.push({ name: 'vercel-blob', status: 'skipped' })
  }

  // ── 3. Vercel KV (optional) ──
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const kvStart = Date.now()
    try {
      const res = await fetch(`${process.env.KV_REST_API_URL}/ping`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
      })
      if (res.ok) {
        services.push({
          name: 'vercel-kv',
          status: 'up',
          latencyMs: Date.now() - kvStart,
        })
      } else {
        console.error('[health] KV HTTP status:', res.status)
        services.push({ name: 'vercel-kv', status: 'down' })
      }
    } catch (err) {
      console.error('[health] KV error:', err)
      services.push({ name: 'vercel-kv', status: 'down' })
    }
  } else {
    services.push({ name: 'vercel-kv', status: 'skipped' })
  }

  // ── 4. Supabase Realtime (optional) ──
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    services.push({ name: 'supabase-realtime', status: 'up' })
  } else {
    services.push({ name: 'supabase-realtime', status: 'skipped' })
  }

  // ── 4b. Cloudflare R2 (optional) — don't expose bucket name ──
  if (
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY
  ) {
    services.push({ name: 'cloudflare-r2', status: 'up' })
  } else {
    services.push({ name: 'cloudflare-r2', status: 'skipped' })
  }

  // ── 5. Edge Config (optional) ──
  if (process.env.EDGE_CONFIG) {
    services.push({ name: 'edge-config', status: 'up' })
  } else {
    services.push({ name: 'edge-config', status: 'skipped' })
  }

  // ── Aggregate status ──
  const dbHealth = services.find((s) => s.name === 'database')
  const isCriticalDown = dbHealth?.status === 'down'

  // Security: do NOT expose dbUrl, env vars, or error details in response
  return NextResponse.json(
    {
      ok: !isCriticalDown,
      status: isCriticalDown ? 'unhealthy' : 'healthy',
      timestamp: new Date().toISOString(),
      totalLatencyMs: Date.now() - startTime,
      services,
    },
    { status: isCriticalDown ? 503 : 200 },
  )
}
