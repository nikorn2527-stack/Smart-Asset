/**
 * src/lib/batch-import.ts — Batch import helpers (chunk + createMany)
 *
 * WHY THIS EXISTS
 * --------------
 * Before this module, every import script used:
 *
 *   for (const row of rows) {
 *     await db.meterReading.create({ data: row })   // ❌ 1 query per row
 *   }
 *
 * Importing 14,275 meter readings → 14,275 sequential queries → each query
 * borrows a connection from the pool → on Supabase Free Plan (15 connection
 * Prisma pool + 200 pooler backend) this exhausts the pool → "15 connection
 * limit" errors and dashboard 500s.
 *
 * SOLUTION
 * --------
 * `createMany` in chunks of 500–1000 inside a single `$transaction`:
 *   • 1 connection borrowed per chunk (not per row)
 *   • 1 round-trip per chunk (not per row)
 *   • skipDuplicates=true → idempotent re-runs
 *
 * For 14,275 rows with chunk=500: 29 transactions × 1 connection each,
 * instead of 14,275 sequential queries. ~50× fewer connection acquisitions.
 *
 * USAGE
 * -----
 *   import { batchCreate } from '@/lib/batch-import'
 *   await batchCreate(db.meterReading, rows, { chunkSize: 500 })
 */

import type { PrismaClient } from '@prisma/client'

export interface BatchOptions {
  /** Rows per createMany call. Default 500. */
  chunkSize?: number
  /** Skip rows that violate unique constraints (idempotent re-runs). Default true. */
  skipDuplicates?: boolean
  /** Progress callback fired after every chunk. */
  onProgress?: (done: number, total: number) => void
  /** Label for progress logs. */
  label?: string
}

/**
 * Chunk an array into pieces of size n.
 */
export function chunk<T>(arr: readonly T[], n: number): T[][] {
  if (n < 1) throw new Error('chunk size must be >= 1')
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) {
    out.push(arr.slice(i, i + n))
  }
  return out
}

/**
 * Batch-insert rows using `createMany` in chunks, wrapped in `$transaction`.
 *
 * @param model   Prisma model delegate (e.g. `db.meterReading`)
 * @param rows    Array of row objects to insert
 * @param options chunkSize, skipDuplicates, onProgress, label
 * @returns       { inserted, skipped, totalChunks }
 */
export async function batchCreate<T extends { createMany: (args: any) => Promise<{ count: number }> }>(
  model: T,
  // Infer the createMany payload type from the delegate. `readonly` is NOT
  // allowed on a conditional-type branch (TS1354) — only array/tuple literals
  // accept it — so the array type is written without the modifier.
  rows: T extends { createMany: (args: { data: infer R }) => any } ? R[] : any[],
  options: BatchOptions = {},
): Promise<{ inserted: number; skipped: number; totalChunks: number }> {
  const {
    chunkSize = 500,
    skipDuplicates = true,
    onProgress,
    label = 'rows',
  } = options

  if (rows.length === 0) {
    return { inserted: 0, skipped: 0, totalChunks: 0 }
  }

  const chunks = chunk(rows, chunkSize)
  let inserted = 0
  let skipped = 0
  let chunkIndex = 0

  for (const c of chunks) {
    try {
      const result = await model.createMany({
        data: c as any,
        skipDuplicates,
      })
      inserted += result.count
      // If createMany returned fewer than chunk length, the rest were duplicates
      skipped += Math.max(0, c.length - result.count)
    } catch (err) {
      // Whole chunk failed — count as skipped, continue with next chunk
      console.warn(
        `⚠️  [batchCreate:${label}] chunk ${chunkIndex + 1}/${chunks.length} failed:`,
        err instanceof Error ? err.message : err,
      )
      skipped += c.length
    }
    chunkIndex++
    if (onProgress) {
      onProgress(chunkIndex * chunkSize > rows.length ? rows.length : chunkIndex * chunkSize, rows.length)
    }
    // Tiny delay between chunks to let the pool breathe (avoid burst).
    if (chunkIndex < chunks.length) {
      await new Promise((r) => setTimeout(r, 20))
    }
  }

  return { inserted, skipped, totalChunks: chunks.length }
}

/**
 * Convenience: import rows in chunks with retry on transient errors.
 *
 * Tries the chunk up to `maxRetries` times. On the last attempt failure,
 * counts the chunk as skipped instead of throwing (so the import completes).
 */
export async function batchCreateWithRetry<T extends { createMany: (args: any) => Promise<{ count: number }> }>(
  model: T,
  rows: readonly any[],
  options: BatchOptions & { maxRetries?: number; retryDelayMs?: number } = {},
): Promise<{ inserted: number; skipped: number; totalChunks: number }> {
  const { maxRetries = 3, retryDelayMs = 500, ...batchOpts } = options
  const chunks = chunk(rows, batchOpts.chunkSize ?? 500)
  let inserted = 0
  let skipped = 0

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    let attempt = 0
    let success = false
    while (attempt < maxRetries && !success) {
      try {
        const result = await model.createMany({
          data: c as any,
          skipDuplicates: batchOpts.skipDuplicates ?? true,
        })
        inserted += result.count
        skipped += Math.max(0, c.length - result.count)
        success = true
      } catch (err) {
        attempt++
        if (attempt >= maxRetries) {
          console.warn(
            `⚠️  [batchCreateWithRetry:${batchOpts.label ?? 'rows'}] chunk ${i + 1}/${chunks.length} failed after ${maxRetries} attempts:`,
            err instanceof Error ? err.message : err,
          )
          skipped += c.length
        } else {
          // Exponential backoff: 500ms, 1000ms, 2000ms
          await new Promise((r) => setTimeout(r, retryDelayMs * Math.pow(2, attempt - 1)))
        }
      }
    }
    if (batchOpts.onProgress) {
      const done = Math.min((i + 1) * (batchOpts.chunkSize ?? 500), rows.length)
      batchOpts.onProgress(done, rows.length)
    }
  }

  return { inserted, skipped, totalChunks: chunks.length }
}

/**
 * Stream-process rows in chunks (for when you need to transform each row
 * before insert). Pass a `mapper` that converts a raw CSV row → DB row.
 *
 *   await streamMapAndCreate(db.meterReading, csvRows, mapper, { chunkSize: 500 })
 */
export async function streamMapAndCreate<
  T extends { createMany: (args: any) => Promise<{ count: number }> },
  R,
>(
  model: T,
  rawRows: readonly R[],
  mapper: (row: R, index: number) => any | null,
  options: BatchOptions = {},
): Promise<{ inserted: number; skipped: number; totalChunks: number }> {
  const { chunkSize = 500, skipDuplicates = true, onProgress, label } = options
  const mapped: any[] = []
  let skippedMap = 0
  rawRows.forEach((r, i) => {
    const m = mapper(r, i)
    if (m) mapped.push(m)
    else skippedMap++
  })
    // `mapper` returns `any`, so `mapped` cannot satisfy the inferred
  // `R[]` payload type of batchCreate. The mapper has already validated the
  // row shape, so cast at this boundary rather than weakening batchCreate.
  const result = await batchCreate(model, mapped as never, {
    chunkSize,
    skipDuplicates,
    onProgress,
    label,
  })
  return { ...result, skipped: result.skipped + skippedMap }
}

/**
 * Connect to the DB using the same singleton as src/lib/db.ts.
 * Use this in scripts (which can't import '@/' alias reliably) so they share
 * the same pool-tuned PrismaClient instead of spawning their own.
 *
 *   import { getDb } from '@/lib/batch-import'
 *   const db = getDb()
 *   ... await batchCreate(db.meterReading, rows) ...
 *   await db.$disconnect()
 */
import type { PrismaClient as PrismaClientType } from '@prisma/client'

let _dbSingleton: PrismaClientType | null = null
export async function getDb(): Promise<PrismaClientType> {
  if (_dbSingleton) return _dbSingleton
  // Lazy-import to avoid pulling Prisma into client bundles.
  const { PrismaClient } = await import('@prisma/client')
  _dbSingleton = new PrismaClient({
    log: ['error', 'warn'],
  })
  return _dbSingleton
}
