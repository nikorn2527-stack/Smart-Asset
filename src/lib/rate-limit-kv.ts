/**
 * rate-limit-kv.ts — Distributed rate limiting using Vercel KV (Redis).
 *
 * Why KV-based (not in-memory):
 *   - Vercel serverless runs multiple function instances in parallel
 *   - In-memory rate limit only works per-instance → user can bypass
 *     by hitting different instances
 *   - Vercel KV (256MB free) provides shared state across all instances
 *
 * Fallback: If KV not configured, falls back to in-memory (per-instance).
 *   This is acceptable for single-user demo / small teams.
 *
 * Setup:
 *   1. Create KV store: Vercel Dashboard → Storage → Create → KV
 *   2. Link to project: vercel env pull (or set KV_REST_API_URL + KV_REST_API_TOKEN)
 *   3. Use in API routes:
 *        import { checkRateLimit } from '@/lib/rate-limit-kv'
 *        const rl = await checkRateLimit(`write:${user.email}`, { maxRequests: 30, windowMs: 60_000 })
 *        if (!rl.allowed) return 429
 *
 * Cost (Vercel KV Free):
 *   - 256MB storage
 *   - 30,000 commands/month (plenty for rate limiting)
 */

interface RateLimitOptions {
  maxRequests: number
  windowMs: number
}

interface RateLimitResult {
  allowed: boolean
  retryAfterMs: number
  remaining: number
  limit: number
}

const KV_URL = process.env.KV_REST_API_URL
const KV_TOKEN = process.env.KV_REST_API_TOKEN

/** Check if Vercel KV is configured */
export function isKVConfigured(): boolean {
  return !!(KV_URL && KV_TOKEN)
}

/**
 * Distributed rate limit using Vercel KV (Redis-compatible).
 * Uses INCR + EXPIRE pattern for atomic counting.
 *
 * Algorithm:
 *   1. key = `rl:${bucket}:${windowStart}`  (windowStart = floor(now / windowMs) * windowMs)
 *   2. INCR key (returns count)
 *   3. If count === 1, set EXPIRE key windowMs (so it auto-cleans)
 *   4. allowed = count <= maxRequests
 */
export async function checkRateLimitKV(
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const now = Date.now()
  const windowStart = Math.floor(now / options.windowMs) * options.windowMs
  const kvKey = `rl:${key}:${windowStart}`

  try {
    // Vercel KV REST API: INCR
    const incrRes = await fetch(`${KV_URL}/incr/${encodeURIComponent(kvKey)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json',
      },
    })

    if (!incrRes.ok) {
      // KV failed — fall back to allow (don't block user due to infra issue)
      console.warn('[rate-limit-kv] INCR failed, allowing request')
      return {
        allowed: true,
        retryAfterMs: 0,
        remaining: options.maxRequests,
        limit: options.maxRequests,
      }
    }

    const count = (await incrRes.json()) as { result: number }
    const current = count.result ?? 1

    // Set expire on first request in window
    if (current === 1) {
      await fetch(`${KV_URL}/expire/${encodeURIComponent(kvKey)}/${Math.ceil(options.windowMs / 1000)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${KV_TOKEN}`,
        },
      })
    }

    const remaining = Math.max(0, options.maxRequests - current)
    const allowed = current <= options.maxRequests
    const retryAfterMs = allowed ? 0 : windowStart + options.windowMs - now

    return {
      allowed,
      retryAfterMs: Math.max(0, retryAfterMs),
      remaining,
      limit: options.maxRequests,
    }
  } catch (err) {
    // KV error — don't block user, fall back to allow
    console.warn('[rate-limit-kv] Error, allowing request:', err)
    return {
      allowed: true,
      retryAfterMs: 0,
      remaining: options.maxRequests,
      limit: options.maxRequests,
    }
  }
}

// ── In-memory fallback (per-instance) ──
interface MemBucket {
  count: number
  windowStart: number
}
const memBuckets = new Map<string, MemBucket>()

function checkRateLimitMem(
  key: string,
  options: RateLimitOptions,
): RateLimitResult {
  const now = Date.now()
  const windowStart = Math.floor(now / options.windowMs) * options.windowMs
  const k = `${key}:${windowStart}`

  let bucket = memBuckets.get(k)
  if (!bucket) {
    bucket = { count: 0, windowStart }
    memBuckets.set(k, bucket)
  }
  bucket.count += 1

  const remaining = Math.max(0, options.maxRequests - bucket.count)
  const allowed = bucket.count <= options.maxRequests
  const retryAfterMs = allowed ? 0 : windowStart + options.windowMs - now

  // Cleanup old buckets every 100 calls
  if (memBuckets.size > 1000) {
    for (const [bk, bb] of memBuckets) {
      if (now - bb.windowStart > options.windowMs * 2) {
        memBuckets.delete(bk)
      }
    }
  }

  return {
    allowed,
    retryAfterMs: Math.max(0, retryAfterMs),
    remaining,
    limit: options.maxRequests,
  }
}

/**
 * Unified rate limit check.
 * - If Vercel KV is configured: uses distributed KV (accurate across instances)
 * - If not: uses in-memory (per-instance, acceptable for small teams)
 *
 * @example
 *   import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit-kv'
 *
 *   const rl = await checkRateLimit(`write:${user.email}`, RATE_LIMITS.WRITE)
 *   if (!rl.allowed) {
 *     return NextResponse.json(
 *       { error: 'ทำรายการเร็วเกินไป กรุณารอสักครู่' },
 *       { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
 *     )
 *   }
 */
export async function checkRateLimit(
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  if (isKVConfigured()) {
    return checkRateLimitKV(key, options)
  }
  return checkRateLimitMem(key, options)
}

/**
 * Common rate limit presets.
 */
export const RATE_LIMITS = {
  /** Login attempts: 5 per 5 minutes */
  LOGIN: { maxRequests: 5, windowMs: 5 * 60 * 1000 },
  /** Write operations: 30 per minute per user */
  WRITE: { maxRequests: 30, windowMs: 60_000 },
  /** Read operations: 100 per minute per user */
  READ: { maxRequests: 100, windowMs: 60_000 },
  /** Heavy operations (import/sync/report): 5 per minute */
  HEAVY: { maxRequests: 5, windowMs: 60_000 },
  /** Public endpoints: 60 per minute per IP */
  PUBLIC: { maxRequests: 60, windowMs: 60_000 },
} as const

/**
 * Get client IP from request (for IP-based rate limiting).
 */
export function getClientIP(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xRealIP = req.headers.get('x-real-ip')
  if (xRealIP) return xRealIP.trim()
  return 'unknown'
}
