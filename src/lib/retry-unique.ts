/**
 * retry-unique.ts — Server-side retry for Prisma unique-constraint violations.
 *
 * Wraps a Prisma `db.X.create()` call (or any async function) with automatic
 * retry on P2002 (unique constraint violation). This is required for any
 * generator that uses the `findMax + 1` pattern (productCode, woNumber,
 * poNumber, etc.) because two concurrent requests can compute the same
 * next-sequence number and both try to insert — one succeeds, the other
 * gets P2002. Retrying re-computes the sequence with the row now visible.
 *
 * Usage:
 *   import { withRetryOnUnique } from '@/lib/retry-unique'
 *   const created = await withRetryOnUnique(() =>
 *     db.stockItem.create({ data: { productCode: await nextCode(), ... } }),
 *   )
 *
 * The wrapped function is re-invoked on each retry — so any generator
 * call inside it (e.g. `await nextCode()`) is also re-evaluated, which is
 * what we want: the second attempt should see the row inserted by the
 * first attempt and pick the next sequence number.
 *
 * Non-P2002 errors are re-thrown immediately (no retry).
 *
 * Task ID: P1-CORE-FIXES (FIX-024)
 */

/** Prisma's well-known error code for unique constraint violations. */
const P2002 = 'P2002'

/**
 * Detect a Prisma P2002 error without depending on Prisma's runtime class
 * (so the helper is unit-testable in isolation). Matches on `code` property
 * to avoid message-string matching (which is brittle).
 */
export function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (!('code' in err)) return false
  return (err as { code?: string }).code === P2002
}

/**
 * Execute `fn` and retry on P2002 (unique constraint violation).
 *
 * @param fn  An async function that performs the create (and may compute a
 *            new sequence number internally). It MUST be idempotent enough
 *            to re-run safely — i.e. re-compute any generated sequence
 *            number on each call.
 * @param maxAttempts Maximum number of attempts. Default: 5.
 *
 * @returns The result of `fn` on the first successful attempt.
 * @throws  The last error if all attempts fail (or immediately for non-P2002 errors).
 */
export async function withRetryOnUnique<T>(
  fn: () => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      lastError = err
      if (!isUniqueViolation(err)) throw err
      // Last attempt — don't wait, just re-throw.
      if (attempt === maxAttempts - 1) break
      // Exponential backoff with a tiny jitter — 50ms, 100ms, 150ms, 200ms.
      const delay = 50 * (attempt + 1) + Math.random() * 10
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastError
}
