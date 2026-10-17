// ============================================================
// PR-SYNC-1 Auth Contract Tests — authToken in POST body
// ============================================================
// P9-03 (round 5): regression tests for the new auth contract.
// All tests run with default SYNC_SOURCE_MAX_RETRIES=3.
//
// KEY DESIGN (P9-03 fix — separates retry-delay from request-timeout):
// - Retry backoff is routed through the injectable _setRetryDelayForTesting
//   seam in src/lib/sync-adapter.ts. Tests make backoff instant via this
//   seam WITHOUT touching globalThis.setTimeout.
// - The AbortController request-timeout timer stays on the REAL
//   globalThis.setTimeout (never mocked), so it cannot fire before
//   fetch resolves. Previously, mocking globalThis.setTimeout fired
//   controller.abort() BEFORE fetch ran — but mockFetch ignored
//   signal.aborted, producing FALSE PASSES (the audit probe confirmed
//   this at head 44e7848).
// - Every mock fetch invocation records signal.aborted. An afterEach
//   guard asserts it was NEVER true across the whole suite. A dedicated
//   PROBE test makes the invariant explicit.
// - NO fake timers (vi.useFakeTimers deadlocks with async/await).
// - Retry count is NOT reduced (stays SYNC_SOURCE_MAX_RETRIES=3).
// - Request-timeout semantics are NOT cancelled (the real timer is
//   scheduled and cleared in a finally block — see sync-adapter.ts).
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  fetchFromAppsScript,
  _setSiteAllowlistForTesting,
  _setRetryDelayForTesting,
} from '@/lib/sync-adapter'

// ── Mock fetch ──────────────────────────────────────────────
const mockFetch = vi.fn()
globalThis.fetch = mockFetch as unknown as typeof fetch

// ── P9-03 signal-integrity tracker ──────────────────────────
// Every mock fetch call records whether the AbortController signal was
// already aborted at call time. An afterEach guard asserts it was NEVER
// true — proving the request-timeout timer did not fire before fetch.
const signalStates: boolean[] = []

function recordSignal(init: unknown): void {
  const signal = (init as { signal?: { aborted?: boolean } } | undefined)?.signal
  signalStates.push(!!signal?.aborted)
}

// ── Mock response builders ─────────────────────────────────
// Each builder records signal.aborted so the afterEach guard can verify
// the AbortController never fired prematurely.
function okResponse(body: unknown) {
  return (_url: unknown, init: unknown) => {
    recordSignal(init)
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
    })
  }
}

function httpErrorResponse(status: number, statusText: string) {
  return (_url: unknown, init: unknown) => {
    recordSignal(init)
    return Promise.resolve({
      ok: false,
      status,
      statusText,
      json: async () => ({}),
    })
  }
}

beforeEach(() => {
  mockFetch.mockReset()
  signalStates.length = 0
  // P9-03: make retry backoff instant via the DEDICATED seam — NOT by
  // mocking globalThis.setTimeout (which would also fire the AbortController
  // request-timeout callback prematurely and cause a false pass).
  _setRetryDelayForTesting(() => Promise.resolve())
  _setSiteAllowlistForTesting(new Set(['HQ', 'UDH']))
})

afterEach(() => {
  // P9-03 GLOBAL GUARD: the request-timeout timer must NEVER have fired
  // before fetch resolved. If any recorded signal.aborted === true, the
  // test is producing a false pass (the real fetch would have aborted).
  // This guard is the suite-level regression net that the audit's probe
  // demanded.
  expect(
    signalStates.every((s) => s === false),
    `P9-03 violation: signal.aborted was true on at least one fetch call — ` +
      `the request-timeout timer fired before fetch resolved (false-pass). ` +
      `signalStates=${JSON.stringify(signalStates)}`,
  ).toBe(true)
  // Restore real retry delay + clear allowlist override
  _setRetryDelayForTesting(null)
  _setSiteAllowlistForTesting(null)
})

describe('Auth contract: authToken in POST body', () => {
  it('request body contains authToken', async () => {
    process.env.APPS_SCRIPT_SERVICES_URL = 'https://example.com/exec'
    process.env.APPS_SCRIPT_SERVICES_TOKEN = 'test-token-123'

    mockFetch.mockImplementationOnce(
      okResponse({
        records: [{ requestId: 'WO-001', subject: 'Test', status: 'PENDING', siteCode: 'HQ' }],
        metadata: { totalFetched: 1, cursor: null, unmappedColumns: [] },
      }),
    )

    await fetchFromAppsScript({ source: 'services', limit: 100 })

    const callArgs = mockFetch.mock.calls[0]
    const body = JSON.parse(callArgs[1].body)
    expect(body.authToken).toBe('test-token-123')
  })

  it('no Authorization header in request', async () => {
    process.env.APPS_SCRIPT_SERVICES_URL = 'https://example.com/exec'
    process.env.APPS_SCRIPT_SERVICES_TOKEN = 'test-token-123'

    mockFetch.mockImplementationOnce(
      okResponse({
        records: [],
        metadata: { totalFetched: 0, cursor: null, unmappedColumns: [] },
      }),
    )

    await fetchFromAppsScript({ source: 'services' })

    const callArgs = mockFetch.mock.calls[0]
    const headers = callArgs[1].headers
    expect(headers['Authorization']).toBeUndefined()
    expect(headers['authorization']).toBeUndefined()
  })

  it('token not in URL query string', async () => {
    process.env.APPS_SCRIPT_SERVICES_URL = 'https://example.com/exec'
    process.env.APPS_SCRIPT_SERVICES_TOKEN = 'secret-token-456'

    mockFetch.mockImplementationOnce(
      okResponse({
        records: [],
        metadata: { totalFetched: 0, cursor: null, unmappedColumns: [] },
      }),
    )

    await fetchFromAppsScript({ source: 'services' })

    const url = mockFetch.mock.calls[0][0] as string
    expect(url).not.toContain('token')
    expect(url).not.toContain('secret')
    expect(url).not.toContain('authToken')
    expect(url).not.toContain('auth')
  })

  it('Apps Script error response → adapter throws after 3 retries', async () => {
    process.env.APPS_SCRIPT_SERVICES_URL = 'https://example.com/exec'
    process.env.APPS_SCRIPT_SERVICES_TOKEN = 'test-token-123'

    // mockImplementation returns the same response on every call
    // (3 retries × 1 call each = 3 total calls)
    mockFetch.mockImplementation(
      okResponse({
        error: 'Unauthorized: missing or invalid token',
        code: 'UNAUTHORIZED',
      }),
    )

    await expect(fetchFromAppsScript({ source: 'services' })).rejects.toThrow(
      'Source error: Unauthorized',
    )

    // Verify all 3 retry attempts were made (default SYNC_SOURCE_MAX_RETRIES=3)
    expect(mockFetch).toHaveBeenCalledTimes(3)
    // P9-03: signal integrity verified across ALL 3 retry attempts
    expect(signalStates).toHaveLength(3)
  })

  it('successful response returns records and metadata', async () => {
    process.env.APPS_SCRIPT_SERVICES_URL = 'https://example.com/exec'
    process.env.APPS_SCRIPT_SERVICES_TOKEN = 'test-token-123'

    const mockRecords = [
      { requestId: 'WO-001', subject: 'Test WO 1', status: 'PENDING', siteCode: 'HQ' },
      { requestId: 'WO-002', subject: 'Test WO 2', status: 'IN_PROGRESS', siteCode: 'UDH' },
    ]

    mockFetch.mockImplementationOnce(
      okResponse({
        records: mockRecords,
        metadata: { totalFetched: 2, cursor: 'offset:2', unmappedColumns: [] },
      }),
    )

    const result = await fetchFromAppsScript({ source: 'services', limit: 100 })

    expect(result.records).toHaveLength(2)
    expect(result.records[0].requestId).toBe('WO-001')
    expect(result.metadata.totalFetched).toBe(2)
    expect(result.metadata.cursor).toBe('offset:2')
  })

  it('token not in error messages (no echo)', async () => {
    process.env.APPS_SCRIPT_SERVICES_URL = 'https://example.com/exec'
    process.env.APPS_SCRIPT_SERVICES_TOKEN = 'super-secret-token-xyz'

    // mockImplementation for all 3 retry attempts
    mockFetch.mockImplementation(
      okResponse({
        error: 'Unauthorized: missing or invalid token',
        code: 'UNAUTHORIZED',
      }),
    )

    try {
      await fetchFromAppsScript({ source: 'services' })
      expect.fail('Should have thrown')
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      expect(errMsg).not.toContain('super-secret-token-xyz')
      expect(errMsg).not.toContain('super')
      expect(errMsg).not.toContain('secret')
    }
  })

  it('missing token env var → throws configuration error', async () => {
    delete process.env.APPS_SCRIPT_SERVICES_URL
    delete process.env.APPS_SCRIPT_SERVICES_TOKEN

    await expect(fetchFromAppsScript({ source: 'services' })).rejects.toThrow(
      'Source URL not configured',
    )
  })

  it('HTTP non-200 response → throws with status code after 3 retries', async () => {
    process.env.APPS_SCRIPT_SERVICES_URL = 'https://example.com/exec'
    process.env.APPS_SCRIPT_SERVICES_TOKEN = 'test-token-123'

    mockFetch.mockImplementation(httpErrorResponse(500, 'Internal Server Error'))

    await expect(fetchFromAppsScript({ source: 'services' })).rejects.toThrow(
      'Source responded 500',
    )

    // Verify all 3 retry attempts were made
    expect(mockFetch).toHaveBeenCalledTimes(3)
    // P9-03: signal integrity verified across ALL 3 retry attempts
    expect(signalStates).toHaveLength(3)
  })

  // ── P9-03 PROBE: signal NOT aborted when fetch is invoked ────
  // This test directly verifies the audit's requirement: the retry-delay
  // mock must NOT also fire the request-timeout timer. At head 44e7848 the
  // suite mocked globalThis.setTimeout, which fired controller.abort()
  // before fetch ran — a false pass because mockFetch ignored signal.aborted.
  //
  // Fix: retry backoff uses the dedicated _setRetryDelayForTesting seam, so
  // globalThis.setTimeout (used by the request-timeout timer) is NEVER
  // mocked and cannot fire before fetch resolves.
  it('PROBE: AbortController signal is NOT aborted when fetch is invoked (P9-03 regression guard)', async () => {
    process.env.APPS_SCRIPT_SERVICES_URL = 'https://example.com/exec'
    process.env.APPS_SCRIPT_SERVICES_TOKEN = 'test-token-123'

    mockFetch.mockImplementationOnce(
      okResponse({
        records: [],
        metadata: { totalFetched: 0, cursor: null, unmappedColumns: [] },
      }),
    )

    await fetchFromAppsScript({ source: 'services' })

    // The signal passed to fetch must NOT be aborted at call time.
    expect(signalStates).toHaveLength(1)
    expect(signalStates[0]).toBe(false)
  })

  // ── P9-03 PROBE: retry-delay seam does not touch request-timeout timer ─
  // Verifies the two timers are truly separated by counting globalThis.setTimeout
  // invocations during a 3-retry failure path. The request-timeout timer is
  // scheduled once per attempt (3 total). The retry backoff is routed through
  // the seam (instant), so it contributes ZERO globalThis.setTimeout calls.
  // If the retry path leaked through globalThis.setTimeout, the count would
  // be 6 (3 timeouts + 3 backoffs) — this test would catch that regression.
  it('PROBE: request-timeout timer scheduled per attempt; retry backoff routed through the seam (timer separation)', async () => {
    process.env.APPS_SCRIPT_SERVICES_URL = 'https://example.com/exec'
    process.env.APPS_SCRIPT_SERVICES_TOKEN = 'test-token-123'

    // Spy on the real globalThis.setTimeout WITHOUT replacing it (spyOn
    // calls through by default). The production finally block clears each
    // timer before it fires, so no real 30s wait occurs.
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    try {
      mockFetch.mockImplementation(httpErrorResponse(500, 'Internal Server Error'))

      await expect(fetchFromAppsScript({ source: 'services' })).rejects.toThrow(
        'Source responded 500',
      )

      // 3 retry attempts → 3 request-timeout timers via the REAL setTimeout.
      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(setTimeoutSpy).toHaveBeenCalledTimes(3)
      // If retry backoff had leaked through globalThis.setTimeout, the
      // count would be 6 (3 timeouts + 3 backoffs). It is exactly 3,
      // proving the retry-delay seam is the ONLY path for backoff.
      // Signal integrity also holds across all 3 attempts.
      expect(signalStates).toHaveLength(3)
      expect(signalStates.every((s) => s === false)).toBe(true)
    } finally {
      setTimeoutSpy.mockRestore()
    }
  })
})
