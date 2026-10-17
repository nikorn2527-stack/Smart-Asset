// ============================================================
// Devices Import — Retry/idempotency fixtures (pure)
// ============================================================
// Module: Devices (Dev-3 / Asset & Meter Team)
// Work Package: C — parallel preparation
//
// Purpose: fixtures for retry/idempotency behavior testing.
//   - same import batch retried → no duplicates created
//   - partial failure → only failed rows retried, successful rows not duplicated
//   - network retry → same request id → idempotent response
//   - concurrent imports → race conditions handled
//
// These fixtures verify the IDEMPOTENCY CONTRACT without touching
// the DB. The actual idempotency is provided by:
//   - assetCode unique constraint (DB-level)
//   - mode='create_only' → existing skipped
//   - mode='upsert' → existing updated (not duplicated)
//   - createMany with skipDuplicates=false (validator pre-dedup)
//
// Governance:
//   - B4 frozen files untouched
//   - No SYNC_RUN permission added
//   - No schema/migration changes
//   - Pure functions, no DB
// ============================================================

/**
 * Retry scenario fixture.
 */
export interface RetryFixture {
  name: string
  initialRows: Array<{ assetCode: string; name: string }>
  retryRows: Array<{ assetCode: string; name: string }>
  mode: 'upsert' | 'create_only' | 'update_only'
  expectedResult: {
    inserted: number
    updated: number
    skipped: number
  }
  description: string
}

export const RETRY_FIXTURES: RetryFixture[] = [
  {
    name: 'retry create_only — all rows already exist → all skipped',
    initialRows: [
      { assetCode: 'A001', name: 'Printer' },
      { assetCode: 'A002', name: 'Scanner' },
    ],
    retryRows: [
      { assetCode: 'A001', name: 'Printer (retry)' },
      { assetCode: 'A002', name: 'Scanner (retry)' },
    ],
    mode: 'create_only',
    expectedResult: { inserted: 0, updated: 0, skipped: 2 },
    description:
      'initial import creates A001+A002; retry with create_only → both skipped because they already exist',
  },
  {
    name: 'retry upsert — all rows already exist → all updated',
    initialRows: [
      { assetCode: 'A001', name: 'Printer' },
      { assetCode: 'A002', name: 'Scanner' },
    ],
    retryRows: [
      { assetCode: 'A001', name: 'Printer v2' },
      { assetCode: 'A002', name: 'Scanner v2' },
    ],
    mode: 'upsert',
    expectedResult: { inserted: 0, updated: 2, skipped: 0 },
    description:
      'initial import creates A001+A002; retry with upsert → both updated with new names',
  },
  {
    name: 'retry update_only — new rows added in retry → skipped',
    initialRows: [
      { assetCode: 'A001', name: 'Printer' },
    ],
    retryRows: [
      { assetCode: 'A001', name: 'Printer v2' },
      { assetCode: 'A002', name: 'Scanner' }, // new in retry
    ],
    mode: 'update_only',
    expectedResult: { inserted: 0, updated: 1, skipped: 1 },
    description:
      'update_only mode: A001 updated; A002 is new → skipped (mode does not insert)',
  },
  {
    name: 'partial failure retry — only failed rows retried',
    initialRows: [
      { assetCode: 'A001', name: 'Printer' }, // succeeded
      // A002 failed in initial batch (DB error, network, etc.)
    ],
    retryRows: [
      { assetCode: 'A002', name: 'Scanner' }, // only failed row
    ],
    mode: 'create_only',
    expectedResult: { inserted: 1, updated: 0, skipped: 0 },
    description:
      'initial batch: A001 succeeded, A002 failed; retry only includes A002 → inserted, A001 not duplicated',
  },
  {
    name: 'concurrent imports — same row in two batches → only one inserted',
    initialRows: [
      { assetCode: 'A001', name: 'Printer' },
    ],
    retryRows: [
      { assetCode: 'A001', name: 'Printer (concurrent)' },
    ],
    mode: 'create_only',
    expectedResult: { inserted: 0, updated: 0, skipped: 1 },
    description:
      'two concurrent create_only imports with same assetCode → second is skipped (unique constraint + Set-based dedup)',
  },
]

/**
 * Pure helper: simulate the mode-aware persist decision without DB.
 * This mirrors the logic in persistDevices() but is pure for fixture validation.
 */
export function simulatePersistDecision(
  initialAssetCodes: Set<string>,
  retryRows: Array<{ assetCode: string; name: string }>,
  mode: 'upsert' | 'create_only' | 'update_only',
): { inserted: number; updated: number; skipped: number } {
  let inserted = 0
  let updated = 0
  let skipped = 0
  for (const row of retryRows) {
    const exists = initialAssetCodes.has(row.assetCode)
    if (exists) {
      if (mode === 'create_only') {
        skipped += 1
      } else {
        // upsert or update_only
        updated += 1
      }
    } else {
      if (mode === 'update_only') {
        skipped += 1
      } else {
        // upsert or create_only
        inserted += 1
      }
    }
  }
  return { inserted, updated, skipped }
}

/**
 * Idempotency contract — describes what idempotency guarantees the
 * importer provides. Tests verify each contract clause.
 */
export const IDEMPOTENCY_CONTRACT = {
  // DB-level: assetCode unique constraint prevents duplicate rows
  assetCodeUnique: true,
  // Validator-level: duplicate-in-file quarantined before persist
  duplicateInFileQuarantined: true,
  // Mode-aware: create_only skips existing, upsert updates, update_only skips new
  modeAware: true,
  // createMany with skipDuplicates=false — validator pre-dedups
  batchInsertAtomic: true,
  // Transaction-wrapped updates — all-or-nothing
  batchUpdateAtomic: true,
  // No side effects on retry — same input + same mode = same outcome
  retrySafe: true,
} as const

export type IdempotencyContract = typeof IDEMPOTENCY_CONTRACT
