/**
 * rate-limit.ts — In-memory rate limiting for API routes.
 *
 * Designed for Vercel serverless (each function instance has its own Map).
 * For multi-instance accuracy, consider Upstash Redis (@upstash/ratelimit).
 * For now, in-memory is sufficient for single-user demo + small teams.
 *
 * Usage:
 *   import { checkRateLimit } from '@/lib/rate-limit'
 *
 *   export async function POST(req: Request) {
 *     const auth = await requireAuth(req, 'DEVICE_EDIT')
 *     if (!auth.ok) return NextResponse.json({...}, { status: auth.status })
 *
 *     const rl = checkRateLimit(`write:${auth.user.email}`, {
 *       maxRequests: 30,
 *       windowMs: 60_000, // 30 writes per minute per user
 *     })
 *     if (!rl.allowed) {
 *       return NextResponse.json(
 *         { error: 'ทำรายการเร็วเกินไป กรุณารอสักครู่' },
 *         { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
 *       )
 *     }
 *     // ... proceed
 *   }
 */

interface RateBucket {
  count: number
  windowStart: number
}

interface RateLimitOptions {
  /** Max requests allowed in the window */
  maxRequests: number
  /** Window size in milliseconds */
  windowMs: number
}

interface RateLimitResult {
  allowed: boolean
  retryAfterMs: number
  remaining: number
  limit: number
}

// Map<key, bucket> — persists across warm serverless invocations
const buckets = new Map<string, RateBucket>()

// Cleanup expired buckets every 5 minutes to prevent memory leak
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000
let lastCleanup = Date.now()

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > 60_000) {
      buckets.delete(key)
    }
  }
}

/**
 * Check rate limit for a given key.
 * Returns { allowed, retryAfterMs, remaining, limit }.
 */
export function checkRateLimit(
  key: string,
  options: RateLimitOptions,
): RateLimitResult {
  cleanup()
  const now = Date.now()
  const k = String(key ?? '').trim()

  let bucket = buckets.get(k)
  if (!bucket || now - bucket.windowStart > options.windowMs) {
    // New window
    bucket = { count: 0, windowStart: now }
    buckets.set(k, bucket)
  }

  bucket.count += 1
  const remaining = Math.max(0, options.maxRequests - bucket.count)
  const allowed = bucket.count <= options.maxRequests

  // If denied, calculate retry-after (when current window expires)
  const retryAfterMs = allowed ? 0 : bucket.windowStart + options.windowMs - now

  return {
    allowed,
    retryAfterMs: Math.max(0, retryAfterMs),
    remaining,
    limit: options.maxRequests,
  }
}

/**
 * Common rate limit presets.
 */
export const RATE_LIMITS = {
  /** Login attempts: 5 per 5 minutes (same as auth.ts) */
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
  // Vercel sets these headers
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    return xff.split(',')[0].trim()
  }
  const xRealIP = req.headers.get('x-real-ip')
  if (xRealIP) return xRealIP.trim()
  return 'unknown'
}
