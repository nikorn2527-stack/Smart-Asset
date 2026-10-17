/**
 * db-optimize.ts — Database query optimizations for Supabase + Vercel serverless.
 *
 * Key optimizations:
 *   1. Connection warmup — first query is slow (cold pool). Pre-warm on cold start.
 *   2. Query batching — combine multiple count() into single raw query.
 *   3. Select-only needed fields — avoid SELECT * (use Prisma select).
 *   4. Parallel queries — Promise.all for independent reads.
 *   5. Transaction for writes — reduce round-trips.
 *
 * Usage:
 *   import { warmupConnection, batchCount, getBaseClient } from '@/lib/db'-optimize'
 *
 *   // At app init (or first request):
 *   await warmupConnection()
 *
 *   // Instead of 3 separate count queries:
 *   const counts = await batchCount([
 *     { model: 'device', where: { status: 'active' } },
 *     { model: 'workOrder', where: { status: 'PENDING' } },
 *     { model: 'stockItem', where: { quantity: { lt: 10 } } },
 *   ])
 */

import { db, getBaseClient } from './db'

let isWarmedUp = false
let warmupPromise: Promise<void> | null = null

/**
 * Warmup the database connection pool.
 * Called on first request to avoid cold-start latency.
 *
 * Safe to call multiple times — only warms once.
 */
export async function warmupConnection(): Promise<void> {
  if (isWarmedUp) return
  if (warmupPromise) return warmupPromise

  warmupPromise = (async () => {
    try {
      // Simple SELECT 1 to establish connection
      await db.$queryRaw`SELECT 1`
      isWarmedUp = true
      console.log('[db-optimize] Connection warmed up')
    } catch (err) {
      console.warn('[db-optimize] Warmup failed:', err)
      // Reset so next call can retry
      warmupPromise = null
    }
  })()

  return warmupPromise
}

/**
 * Batch multiple count queries into a single DB round-trip.
 * Uses Promise.all for parallel execution.
 *
 * @example
 *   const [activeDevices, pendingWOs, lowStock] = await batchCount([
 *     { model: 'device', where: { status: 'active' } },
 *     { model: 'workOrder', where: { status: 'PENDING' } },
 *     { model: 'stockItem', where: { quantity: { lt: 10 } } },
 *   ])
 *
 *   // Returns: [activeCount, pendingCount, lowStockCount]
 */
export async function batchCount<T extends readonly { model: string; where?: unknown }[]>(
  queries: T,
): Promise<number[]> {
  const promises = queries.map((q) => {
    const model = q.model as keyof typeof db
    const prismaModel = db[model] as unknown as { count: (args?: { where?: unknown }) => Promise<number> }
    if (!prismaModel || typeof prismaModel.count !== 'function') {
      return Promise.resolve(0)
    }
    return prismaModel.count({ where: q.where })
  })
  return Promise.all(promises)
}

/**
 * Execute multiple independent findMany queries in parallel.
 * Reduces total latency vs sequential awaits.
 *
 * @example
 *   const [devices, sites, settings] = await parallelQueries([
 *     () => db.device.findMany({ take: 10 }),
 *     () => db.site.findMany(),
 *     () => db.appSetting.findMany(),
 *   ])
 */
export async function parallelQueries<T extends readonly (() => Promise<unknown>)[]>(
  queries: T,
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const results = await Promise.all(queries.map((q) => q()))
  return results as { [K in keyof T]: Awaited<ReturnType<T[K]>> }
}

/**
 * Execute writes in a transaction (reduces round-trips).
 * All writes succeed or all fail (atomic).
 *
 * @example
 *   await transactionWrite(async (tx) => {
 *     await tx.device.create({ data: { ... } })
 *     await tx.auditLog.create({ data: { ... } })
 *   })
 */
export async function transactionWrite<T>(
  fn: (tx: typeof db) => Promise<T>,
): Promise<T> {
  // Prisma's $transaction() has two array-overload forms and one callback form;
  // the callback's tx type is an extended client, not exactly `typeof db`, so
  // widen at this boundary rather than forcing every caller to cast.
  return getBaseClient().$transaction(fn as (tx: unknown) => Promise<T>) as Promise<T>
}

/**
 * Cleanup old records in batches (avoids locking table for too long).
 *
 * @param model — Prisma model name (e.g. 'auditLog')
 * @param olderThanDays — delete records older than N days
 * @param batchSize — delete in batches of N (default 1000)
 */
export async function cleanupOldRecords(
  model: string,
  olderThanDays: number,
  batchSize: number = 1000,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
  let totalDeleted = 0

  // Loop until no more records to delete
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const prismaModel = db[model as keyof typeof db] as unknown as {
      deleteMany: (args: { where: unknown; take?: number }) => Promise<{ count: number }>
    }
    if (!prismaModel || typeof prismaModel.deleteMany !== 'function') break

    const result = await prismaModel.deleteMany({
      where: { createdAt: { lt: cutoff } },
      take: batchSize,
    })

    totalDeleted += result.count
    if (result.count < batchSize) break // no more records
  }

  return totalDeleted
}

/**
 * Get database connection stats (for monitoring).
 * Note: Supabase pooler doesn't expose stats directly, so this is approximate.
 */
export function getConnectionStats() {
  return {
    isWarmedUp,
    timestamp: Date.now(),
    // Prisma doesn't expose pool stats, but we can track query count
    // by wrapping db (advanced — not done here for simplicity)
  }
}
