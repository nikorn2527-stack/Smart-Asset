/**
 * retry-transaction.ts — Server-side retry for Prisma serialization conflicts.
 *
 * Wraps a Prisma transaction with automatic retry on P2034
 * (serialization conflict). This is required for Serializable isolation
 * level transactions where concurrent writes may conflict.
 *
 * Usage:
 *   const { result, attempts, p2034Count } = await withSerializableRetry(async (tx) => {
 *     // transaction logic
 *   }, { maxAttempts: 3 })
 *
 * Task ID: B4-RETRY-P2034
 */

import { db, getBaseClient } from '@/lib/db'
import { Prisma } from '@prisma/client'

export interface RetryOptions {
  /** Maximum number of attempts (1 = no retry, 3 = up to 3 tries). Default: 3 */
  maxAttempts?: number
  /** Base delay for exponential backoff in ms. Default: 50 */
  baseDelayMs?: number
  /** Maximum delay cap in ms. Default: 500 */
  maxDelayMs?: number
}

export interface RetryResult<T> {
  result: T
  /** Total number of attempts (1 = succeeded first try, 2 = retried once, etc.) */
  attempts: number
  /** Number of P2034 serialization conflicts encountered (0 = no conflict) */
  p2034Count: number
}

/**
 * Check if an error is a Prisma P2034 serialization conflict.
 * Only matches the official Prisma error code P2034 — does NOT use
 * message matching (which was too broad and could match unrelated errors
 * containing "serialization" in their message text).
 */
export function isP2034Error(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2034'
  )
}

/**
 * Execute a Prisma transaction with Serializable isolation and automatic
 * retry on serialization conflict (P2034).
 *
 * Returns the result AND metadata about retry attempts (for test assertions).
 *
 * The transaction is retried with exponential backoff:
 *   attempt 1: immediate
 *   attempt 2: after baseDelayMs (default 50ms)
 *   attempt 3: after baseDelayMs * 2 (100ms)
 *
 * Non-P2034 errors are re-thrown immediately (no retry).
 */
export async function withSerializableRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const { result } = await withSerializableRetryTracked(fn, options)
  return result
}

/**
 * Same as withSerializableRetry, but returns retry metadata (attempts, p2034Count).
 * Use this in tests to verify that P2034 occurred and retry happened.
 */
export async function withSerializableRetryTracked<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: RetryOptions,
): Promise<RetryResult<T>> {
  const maxAttempts = options?.maxAttempts ?? 3
  const baseDelayMs = options?.baseDelayMs ?? 50
  const maxDelayMs = options?.maxDelayMs ?? 500

  let lastError: unknown = null
  let attempts = 0
  let p2034Count = 0

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    attempts++
    try {
      const result = await getBaseClient().$transaction(fn, {
        isolationLevel: 'Serializable',
      })
      return { result, attempts, p2034Count }
    } catch (err) {
      lastError = err

      if (isP2034Error(err)) {
        p2034Count++

        // Last attempt — don't wait, just re-throw
        if (attempt === maxAttempts - 1) {
          break
        }

        // Exponential backoff with jitter
        const delay = Math.min(
          baseDelayMs * Math.pow(2, attempt),
          maxDelayMs,
        )
        const jitter = Math.random() * delay * 0.1
        await new Promise((resolve) => setTimeout(resolve, delay + jitter))
      } else {
        // Not a serialization conflict — re-throw immediately (no retry)
        throw err
      }
    }
  }

  throw lastError
}
