/**
 * db-retry.ts — Retry wrapper for Prisma operations that may fail due to
 * transient connection issues (Supabase pooler timeouts, network blips).
 *
 * Usage:
 *   import { withRetry } from '@/lib/db-retry'
 *
 *   const device = await withRetry(() =>
 *     db.device.findUnique({ where: { id } })
 *   )
 *
 * Retries on:
 *   - P1001 (Can't reach database server)
 *   - P1002 (Database server timeout)
 *   - P1008 (Operations timed out)
 *   - P1017 (Server closed the connection)
 *   - Connection reset / ECONNRESET
 *
 * Does NOT retry on:
 *   - P2002 (Unique constraint violation) — retrying won't help
 *   - P2025 (Record not found) — retrying won't help
 *   - Any validation error
 */

interface RetryOptions {
  /** Max retry attempts (default: 3) */
  maxRetries?: number
  /** Initial delay in ms (default: 200) */
  initialDelayMs?: number
  /** Max delay in ms (default: 2000) */
  maxDelayMs?: number
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 200,
  maxDelayMs: 2000,
  backoffMultiplier: 2,
}

/** Prisma error codes that are safe to retry */
const RETRYABLE_CODES = new Set([
  'P1001', // Can't reach database server
  'P1002', // Database server timeout
  'P1008', // Operations timed out
  'P1017', // Server closed the connection
])

/** Error message patterns that indicate transient issues */
const RETRYABLE_PATTERNS = [
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /connection.*reset/i,
  /connection.*refused/i,
  /connection.*terminated/i,
  /too many connections/i,
  /server closed the connection/i,
  /terminating connection/i,
]

function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false

  // Prisma error with code
  const code = (err as { code?: string }).code
  if (code && RETRYABLE_CODES.has(code)) return true

  // Network errors by message
  const message = (err as { message?: string }).message ?? ''
  if (message && RETRYABLE_PATTERNS.some((p) => p.test(message))) return true

  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Execute a function with retry logic for transient database errors.
 *
 * @example
 * const result = await withRetry(() => db.device.findMany(), {
 *   maxRetries: 5,
 *   initialDelayMs: 500,
 * })
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  let lastError: unknown

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err

      if (attempt === opts.maxRetries) {
        // No more retries — rethrow
        throw err
      }

      if (!isRetryableError(err)) {
        // Non-retryable error — rethrow immediately
        throw err
      }

      // Calculate backoff delay
      const delay = Math.min(
        opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt),
        opts.maxDelayMs,
      )

      // Add small jitter (0-100ms) to avoid thundering herd
      const jitter = Math.random() * 100
      await sleep(delay + jitter)

      console.warn(
        `[db-retry] Attempt ${attempt + 1}/${opts.maxRetries} failed, retrying in ${Math.round(delay + jitter)}ms:`,
        (err as { message?: string })?.message ?? String(err),
      )
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError
}
