// ============================================================
// Sync Adapter — Server-side Pull from Legacy Apps Script
// ============================================================
// ดึงข้อมูลจาก Apps Script Web App ฝั่ง server เท่านั้น
// Browser ไม่เห็น credential ใดๆ
//
// Reuse: FIELD_MAPPINGS.workOrder + STATUS_MAPPINGS.workOrder
// จาก src/lib/csv-field-mapping.ts
// ============================================================

import { FIELD_MAPPINGS, STATUS_MAPPINGS, normalizeKey } from '@/lib/csv-field-mapping'

// ── Types ─────────────────────────────────────────────────────

export interface SyncSourceRecord {
  [key: string]: unknown
}

export interface SyncAdapterResult {
  records: SyncSourceRecord[]
  metadata: {
    totalFetched: number
    unmappedColumns: string[]
    cursor?: string
  }
}

export interface SiteMappingResult {
  siteCode: string | null
  reason: 'mapped' | 'missing' | 'unknown'
}

// ── Constants ─────────────────────────────────────────────────

const SYNC_SOURCE_TIMEOUT_MS = Number(process.env.SYNC_SOURCE_TIMEOUT_MS) || 30000
const SYNC_SOURCE_MAX_RETRIES = Number(process.env.SYNC_SOURCE_MAX_RETRIES) || 3
const SYNC_PREVIEW_MAX_ROWS = Number(process.env.SYNC_PREVIEW_MAX_ROWS) || 1000

// ── Site allowlist (versioned, server-side) ───────────────────
// In production this should be loaded from DB or config.
// For MVP, derive from known Site codes in the system.

let _siteAllowlistCache: Set<string> | null = null
let _siteAllowlistOverride: Set<string> | null = null

/**
 * Override allowlist for testing (I-08-04 cache isolation).
 * Pass null to clear override and restore DB-backed loading.
 *
 * GUARD: Only available in test/CI environments.
 * In production, this function is a no-op.
 */
export function _setSiteAllowlistForTesting(allowlist: Set<string> | null): void {
  if (process.env.NODE_ENV === 'production') {
    // Never allow test overrides in production
    return
  }
  _siteAllowlistOverride = allowlist
  _siteAllowlistCache = null // force reload on next getSiteAllowlist() call
}

/**
 * Load Site allowlist from DB.
 * FAIL-CLOSED: empty/unavailable = no sites allowed.
 */
export async function getSiteAllowlist(): Promise<Set<string>> {
  // Test override takes precedence
  if (_siteAllowlistOverride !== null) return _siteAllowlistOverride

  if (_siteAllowlistCache) return _siteAllowlistCache

  try {
    const { db } = await import('@/lib/db')
    const sites = await db.site.findMany({ select: { code: true } })
    _siteAllowlistCache = new Set(sites.map((s) => s.code))
  } catch {
    // DB unavailable — fail closed
    _siteAllowlistCache = new Set()
  }

  return _siteAllowlistCache
}

// ── Redaction allowlist ───────────────────────────────────────
// Only fields in FIELD_MAPPINGS.workOrder + siteCode + status
// are kept. Everything else is stripped.
// F-01 fix: internal fields (id, createdAt, updatedAt, version) must be
// stripped even if they appear in FIELD_MAPPINGS — they are Prisma-managed
// and should not leak into audit log detail.

const INTERNAL_FIELDS_BLOCKLIST = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'version',
])

function getRedactionAllowlist(): Set<string> {
  const allowlist = new Set<string>()
  for (const prismaField of Object.values(FIELD_MAPPINGS.workOrder)) {
    if (!INTERNAL_FIELDS_BLOCKLIST.has(prismaField)) {
      allowlist.add(prismaField)
    }
  }
  allowlist.add('siteCode')
  allowlist.add('site')
  allowlist.add('status')
  return allowlist
}

/**
 * Redact an object: keep only allowlisted keys, strip PII/credentials.
 */
export function redacted(obj: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!obj) return null
  const allowlist = getRedactionAllowlist()
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (allowlist.has(key)) {
      result[key] = value
    }
  }
  return result
}

// ── Site mapping (fail-closed) ────────────────────────────────

/**
 * Derive canonical siteCode from a source record.
 * - If source has siteCode field → use it
 * - If source has site field → map via allowlist
 * - Missing/unknown → null (caller must quarantine)
 */
export async function deriveSiteCode(record: SyncSourceRecord): Promise<SiteMappingResult> {
  const allowlist = await getSiteAllowlist()

  // FAIL-CLOSED: empty/unavailable allowlist = no sites allowed
  if (allowlist.size === 0) {
    return { siteCode: null, reason: 'unknown' }
  }

  // Direct siteCode from source
  if (record.siteCode && typeof record.siteCode === 'string') {
    const code = record.siteCode.trim()
    if (code) {
      if (!allowlist.has(code)) {
        return { siteCode: null, reason: 'unknown' }
      }
      return { siteCode: code, reason: 'mapped' }
    }
  }

  // Derive from site field
  if (record.site && typeof record.site === 'string') {
    const site = record.site.trim()
    if (!site) return { siteCode: null, reason: 'missing' }

    if (allowlist.has(site)) {
      return { siteCode: site, reason: 'mapped' }
    }

    return { siteCode: null, reason: 'unknown' }
  }

  return { siteCode: null, reason: 'missing' }
}

// ── Apps Script Web App adapter ───────────────────────────────

interface AppsScriptResponse {
  records?: SyncSourceRecord[]
  metadata?: {
    total?: number
    cursor?: string
    [key: string]: unknown
  }
  error?: string
}

// ── Retry-delay seam (P9-03) ─────────────────────────────────
// The retry backoff delay is routed through this injectable holder so
// that tests can make it instant WITHOUT touching globalThis.setTimeout.
//
// WHY THIS EXISTS:
// fetchFromAppsScript() uses globalThis.setTimeout for TWO independent
// purposes:
//   1. Retry backoff delay (this seam)
//   2. AbortController request-timeout timer (real setTimeout, never mocked)
// Previously, tests mocked globalThis.setTimeout globally to skip the
// 1s/2s/4s retry backoff. That also fired controller.abort() BEFORE fetch
// ran — but mockFetch ignored signal.aborted, producing FALSE PASSES
// (the audit's P9-03 probe confirmed this).
//
// Separating the two timers means tests override ONLY the retry backoff
// (via _setRetryDelayForTesting) while the request-timeout timer stays on
// the real globalThis.setTimeout and cannot fire prematurely. The retry
// count (SYNC_SOURCE_MAX_RETRIES=3) and timeout semantics are preserved.
let _retryDelayFn: (ms: number) => Promise<void> = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Override the retry-delay function for testing.
 * Pass a function that resolves immediately to skip the 1s/2s/4s
 * exponential backoff WITHOUT affecting the AbortController
 * request-timeout timer (which stays on the real globalThis.setTimeout).
 *
 * Pass null to restore the real delay.
 *
 * GUARD: No-op in production.
 */
export function _setRetryDelayForTesting(
  fn: ((ms: number) => Promise<void>) | null,
): void {
  if (process.env.NODE_ENV === 'production') {
    // Never allow test overrides in production
    return
  }
  _retryDelayFn =
    fn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
}

/**
 * Fetch records from Apps Script Web App endpoint.
 * Uses server-side credential only — never exposed to browser.
 */
export async function fetchFromAppsScript(options: {
  source: string
  since?: string
  siteFilter?: string
  limit?: number
  cursor?: string
}): Promise<SyncAdapterResult> {
  const { source, since, siteFilter, limit, cursor } = options

  // R-04: test-mock source for route-level integration tests.
  // Returns fixed test records without calling Apps Script — enables
  // preview/run/retry route tests in CI without external dependencies.
  if (source === 'test-mock') {
    return {
      records: [
        { requestId: 'TEST-MOCK-001', subject: 'Test WO 1', status: '🟠รอดำเนินการ', siteCode: 'HQ', building: 'B1', location: 'L1', reporter_name: 'Test User', tel: '0812345678' },
        { requestId: 'TEST-MOCK-002', subject: 'Test WO 2', status: '🔵สำรวจหน้างาน/แก้ไข', siteCode: 'UDH', building: 'B2', location: 'L2', reporter_name: 'Test User 2', tel: '0898765432' },
      ],
      metadata: { totalFetched: 2, unmappedColumns: [] },
    }
  }

  // Get source URL and token from environment
  const urlEnvKey = `APPS_SCRIPT_${source.toUpperCase().replace(/-/g, '_')}_URL`
  const tokenEnvKey = `APPS_SCRIPT_${source.toUpperCase().replace(/-/g, '_')}_TOKEN`

  const baseUrl = process.env[urlEnvKey]
  const token = process.env[tokenEnvKey]

  if (!baseUrl) {
    throw new Error(`Source URL not configured: ${urlEnvKey}`)
  }
  if (!token) {
    throw new Error(`Source token not configured: ${tokenEnvKey}`)
  }

  // Build request URL with pagination
  const requestUrl = new URL(baseUrl)
  if (since) requestUrl.searchParams.set('since', since)
  if (siteFilter) requestUrl.searchParams.set('site', siteFilter)
  if (limit) requestUrl.searchParams.set('limit', String(Math.min(limit, SYNC_PREVIEW_MAX_ROWS)))
  if (cursor) requestUrl.searchParams.set('cursor', cursor)

  // Fetch with retry (source-level retry: SYNC_SOURCE_MAX_RETRIES attempts,
  // exponential backoff). Retry count is NOT reduced — default stays 3.
  //
  // P9-03 timer separation:
  //   - Retry backoff → _retryDelayFn seam (tests override via
  //     _setRetryDelayForTesting; production uses real setTimeout)
  //   - Request-timeout timer → real globalThis.setTimeout (NEVER mocked)
  // This guarantees mocking the retry delay cannot fire the AbortController
  // timeout prematurely, which was the false-pass root cause.
  let lastError: Error | null = null
  for (let attempt = 0; attempt < SYNC_SOURCE_MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    // Request-timeout timer — ALWAYS on the real globalThis.setTimeout
    // (never mocked by tests). Cleared in `finally` on every path so the
    // timer is cancelled whether fetch succeeded, threw, or response
    // processing threw. Preserves timeout semantics + prevents dangling
    // timers across retry attempts.
    const timeout = setTimeout(() => controller.abort(), SYNC_SOURCE_TIMEOUT_MS)
    try {
      const response = await fetch(requestUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ authToken: token, source, options: { since, siteFilter, limit, cursor } }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`Source responded ${response.status}: ${response.statusText}`)
      }

      // P9-02: Apps Script ContentService.createTextOutput always returns
      // HTTP 200, even for auth failures. Auth errors are indicated by
      // JSON body: { error: 'Unauthorized: ...', code: 'UNAUTHORIZED' }
      // The adapter checks data.error and throws, so auth failures are
      // caught even though HTTP status is 200. This is a known Apps Script
      // limitation — documented in the contract.
      const data: AppsScriptResponse = await response.json()

      if (data.error) {
        throw new Error(`Source error: ${data.error}`)
      }

      const records = data.records || []
      const unmappedColumns = detectUnmappedColumns(records)

      return {
        records: records.slice(0, SYNC_PREVIEW_MAX_ROWS),
        metadata: {
          totalFetched: records.length,
          unmappedColumns,
          cursor: data.metadata?.cursor,
        },
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      if (attempt < SYNC_SOURCE_MAX_RETRIES - 1) {
        // Exponential backoff: 1s, 2s, 4s
        // Routed through the _retryDelayFn seam so tests can make backoff
        // instant WITHOUT touching the request-timeout timer above.
        const delay = Math.pow(2, attempt) * 1000
        await _retryDelayFn(delay)
      }
    } finally {
      // Always clear the request-timeout timer — success, error, or throw.
      // This keeps timeout semantics intact (the timer is real and would
      // fire at SYNC_SOURCE_TIMEOUT_MS) while ensuring no dangling timer
      // leaks across the retry loop.
      clearTimeout(timeout)
    }
  }

  throw lastError || new Error('Source fetch failed after retries')
}

// ── Field mapping ─────────────────────────────────────────────

/**
 * Map a source record to Prisma WorkOrder fields using FIELD_MAPPINGS.
 * Returns mapped data and list of unmapped columns.
 */
export function mapSourceRecord(record: SyncSourceRecord): {
  mapped: Record<string, unknown>
  unmapped: string[]
} {
  const mapped: Record<string, unknown> = {}
  const unmapped: string[] = []
  const fieldMap = FIELD_MAPPINGS.workOrder as Record<string, string>
  const statusMap = STATUS_MAPPINGS.workOrder as Record<string, string>

  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = normalizeKey(key)

    // Try exact match first, then normalized
    const prismaField = fieldMap[key] || fieldMap[normalizedKey]

    if (prismaField) {
      // Special handling for status field
      if (prismaField === 'status' && typeof value === 'string') {
        mapped[prismaField] = statusMap[value] || statusMap[normalizeKey(value)] || value
      } else {
        mapped[prismaField] = value
      }
    } else {
      unmapped.push(key)
    }
  }

  return { mapped, unmapped }
}

/**
 * Detect unmapped columns across all records.
 */
function detectUnmappedColumns(records: SyncSourceRecord[]): string[] {
  if (records.length === 0) return []

  const allKeys = new Set<string>()
  for (const record of records) {
    for (const key of Object.keys(record)) {
      allKeys.add(key)
    }
  }

  const fieldMap = FIELD_MAPPINGS.workOrder as Record<string, string>
  const unmapped: string[] = []

  for (const key of allKeys) {
    const normalizedKey = normalizeKey(key)
    if (!fieldMap[key] && !fieldMap[normalizedKey]) {
      unmapped.push(key)
    }
  }

  return unmapped
}

// ── Preview logic ─────────────────────────────────────────────

export interface PreviewItem {
  externalKey: string
  action: 'create' | 'update' | 'skip' | 'error'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  expectedVersion: number | null
  expectedExists: boolean
  siteCode: string | null
  siteMappingReason: 'mapped' | 'missing' | 'unknown'
  errorMessage?: string
}

/**
 * Compute preview items by comparing source records against DB.
 * Read-only — does NOT write to any business table.
 */
export type PreviewRecordMapper = (record: SyncSourceRecord) => {
  mapped: Record<string, unknown>
  unmapped: string[]
}

export async function computePreviewItems(
  records: SyncSourceRecord[],
  tx: {
    workOrder: {
      findUnique: (args: { where: { requestId: string }; select?: Record<string, unknown> }) => Promise<Record<string, unknown> | null>
    }
  },
  siteScope?: string[],
  mapper: PreviewRecordMapper = mapSourceRecord,
): Promise<PreviewItem[]> {
  const items: PreviewItem[] = []

  for (const record of records) {
    const { mapped, unmapped } = mapper(record)
    const requestId = String(mapped.requestId || record.requestId || '')

    if (!requestId) {
      items.push({
        externalKey: '(unknown)',
        action: 'error',
        before: null,
        after: redacted(mapped),
        expectedVersion: null,
        expectedExists: false,
        siteCode: null,
        siteMappingReason: 'missing',
        errorMessage: 'Missing requestId — cannot sync',
      })
      continue
    }

    // Site mapping (fail-closed)
    const siteResult = await deriveSiteCode(record)

    // B-01 fix: inject canonical siteCode into mapped payload so it appears
    // in `after` (via redacted(mapped)). Without this, apply route sees
    // after.siteCode = undefined → rejects with MISSING_SITE.
    if (siteResult.siteCode) {
      mapped.siteCode = siteResult.siteCode
    }

    if (siteResult.reason === 'missing') {
      items.push({
        externalKey: requestId,
        action: 'error',
        before: null,
        after: redacted(mapped),
        expectedVersion: null,
        expectedExists: false,
        siteCode: null,
        siteMappingReason: 'missing',
        errorMessage: 'MISSING_SITE: source record has no site/siteCode',
      })
      continue
    }

    if (siteResult.reason === 'unknown') {
      items.push({
        externalKey: requestId,
        action: 'error',
        before: null,
        after: redacted(mapped),
        expectedVersion: null,
        expectedExists: false,
        siteCode: null,
        siteMappingReason: 'unknown',
        errorMessage: 'UNKNOWN_SITE: site not in allowlist',
      })
      continue
    }

    // Per-item Site authorization check
    if (siteScope && siteScope.length > 0 && siteResult.siteCode) {
      if (!siteScope.includes(siteResult.siteCode)) {
        items.push({
          externalKey: requestId,
          action: 'error',
          before: null,
          after: redacted(mapped),
          expectedVersion: null,
          expectedExists: false,
          siteCode: siteResult.siteCode,
          siteMappingReason: 'mapped',
          errorMessage: `OUT_OF_SCOPE: site ${siteResult.siteCode} not in user scope`,
        })
        continue
      }
    }

    // Look up existing record
    const existing = await tx.workOrder.findUnique({
      where: { requestId },
      select: { id: true, version: true, requestId: true, subject: true, status: true, siteCode: true },
    })

    if (!existing) {
      // Create
      items.push({
        externalKey: requestId,
        action: 'create',
        before: null,
        after: redacted(mapped),
        expectedVersion: null,
        expectedExists: false,
        siteCode: siteResult.siteCode,
        siteMappingReason: 'mapped',
      })
    } else {
      // Check if changed
      const isChanged = hasChanges(existing, mapped)

      if (isChanged) {
        items.push({
          externalKey: requestId,
          action: 'update',
          before: redacted(existing as Record<string, unknown>),
          after: redacted(mapped),
          expectedVersion: (existing as Record<string, unknown>).version as number,
          expectedExists: true,
          siteCode: siteResult.siteCode,
          siteMappingReason: 'mapped',
        })
      } else {
        items.push({
          externalKey: requestId,
          action: 'skip',
          before: redacted(existing as Record<string, unknown>),
          after: redacted(mapped),
          expectedVersion: (existing as Record<string, unknown>).version as number,
          expectedExists: true,
          siteCode: siteResult.siteCode,
          siteMappingReason: 'mapped',
        })
      }
    }
  }

  return items
}

/**
 * Check if source data differs from existing record.
 * Compares mapped fields only (not id, createdAt, updatedAt).
 */
function hasChanges(existing: Record<string, unknown>, mapped: Record<string, unknown>): boolean {
  const skipFields = new Set(['id', 'createdAt', 'updatedAt', 'version'])

  for (const [key, value] of Object.entries(mapped)) {
    if (skipFields.has(key)) continue
    if (existing[key] !== value) return true
  }

  return false
}
