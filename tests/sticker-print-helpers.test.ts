/**
 * tests/sticker-print-helpers.test.ts
 *
 * Tests for the sticker print contract — printSingleSticker + printBulkStickers.
 * Covers: success path, error path (HTTP 4xx/5xx, network failure), busy state,
 * empty selection, and the "keep selection on error, reset on success" rule.
 *
 * These are pure logic tests — they mock fetch + window.open to avoid touching
 * the real DOM. Run with: `bun test tests/sticker-print-helpers.test.ts`
 *
 * Uses Bun's built-in test runner (no vitest required).
 */

import { describe, it, expect, beforeEach, mock, afterEach } from 'bun:test'

// ─────────────────────────────────────────────────────────────
// Mock window.open BEFORE importing the helpers (module reads window at
// call time, so we can set it up in beforeEach).
// ─────────────────────────────────────────────────────────────
const mockWindowOpen = mock(() => ({
  document: {
    open: mock(() => {}),
    write: mock(() => {}),
    close: mock(() => {}),
  },
  focus: mock(() => {}),
  print: mock(() => {}),
  close: mock(() => {}),
}))

beforeEach(() => {
  // Reset all mocks between tests so call counts + return values don't leak.
  mockWindowOpen.mockClear()
  mockWindowOpen.mockReturnValue({
    document: { open: mock(() => {}), write: mock(() => {}), close: mock(() => {}) },
    focus: mock(() => {}),
    print: mock(() => {}),
    close: mock(() => {}),
  })
  // Polyfill window if not defined (test env runs in Node).
  const g = globalThis as unknown as { window?: { open: unknown } }
  if (!g.window) {
    g.window = { open: mockWindowOpen }
  } else {
    g.window.open = mockWindowOpen
  }
})

afterEach(() => {
  // Bun doesn't have vi.restoreAllMocks — mocks auto-clear per-test
  // when declared with mock(). For module-level reset, re-import in each test.
})

// ─────────────────────────────────────────────────────────────
// Helpers — load the module fresh per test so mocks take effect.
// ─────────────────────────────────────────────────────────────
async function loadHelpers() {
  // Dynamic import — bun caches modules, so we need to bust the cache.
  // Use a unique query string to force re-evaluation.
  const path = `../src/components/itam/sticker-print-helpers?t=${Date.now()}-${Math.random()}`
  return await import(path)
}

function mockFetchSuccess(body: unknown) {
  const fetchMock = mock(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => body,
    } as unknown as Response),
  )
  ;(globalThis as unknown as { fetch: unknown }).fetch = fetchMock
  return fetchMock
}

function mockFetchError(status: number, errorBody: { error?: string } = {}) {
  const fetchMock = mock(() =>
    Promise.resolve({
      ok: false,
      status,
      json: async () => errorBody,
    } as unknown as Response),
  )
  ;(globalThis as unknown as { fetch: unknown }).fetch = fetchMock
  return fetchMock
}

function mockFetchNetworkFailure() {
  const fetchMock = mock(() =>
    Promise.reject(new TypeError('Failed to fetch')),
  )
  ;(globalThis as unknown as { fetch: unknown }).fetch = fetchMock
  return fetchMock
}

const SAMPLE_TEMPLATE = {
  id: 'tpl-default',
  name: 'Default',
  isDefault: true,
  canvas: { width: 50, height: 30, unit: 'mm' as const },
  overflow: 'scale' as const,
  elements: [],
}

const SAMPLE_RENDER_RESPONSE = {
  html: '<div class="sticker">UDH-00001</div>',
  template: SAMPLE_TEMPLATE,
  paperWidth: 50,
  paperHeight: 30,
}

const SAMPLE_BULK_RESPONSE = {
  stickers: [
    { assetNo: 'UDH-00001', html: '<div>1</div>' },
    { assetNo: 'UDH-00002', html: '<div>2</div>' },
    { assetNo: 'UDH-00003', html: '<div>3</div>' },
  ],
  cols: 3,
  paperWidth: 50,
  paperHeight: 30,
  template: SAMPLE_TEMPLATE,
}

// ═════════════════════════════════════════════════════════════
// printSingleSticker
// ═════════════════════════════════════════════════════════════
describe('printSingleSticker', () => {
  it('succeeds and returns true when API responds 200', async () => {
    const fetchMock = mockFetchSuccess(SAMPLE_RENDER_RESPONSE)
    const { printSingleSticker } = await loadHelpers()

    const result = await printSingleSticker('UDH-00001')

    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Verify the request body contains the assetNo
    const callArgs = fetchMock.mock.calls[0]
    expect(callArgs[0]).toBe('/api/itam/sticker/render')
    const opts = callArgs[1]
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ assetNo: 'UDH-00001', templateId: undefined })
  })

  it('passes templateId through when provided', async () => {
    const fetchMock = mockFetchSuccess(SAMPLE_RENDER_RESPONSE)
    const { printSingleSticker } = await loadHelpers()

    await printSingleSticker('UDH-00001', 'tpl-custom')

    const opts = fetchMock.mock.calls[0][1]
    expect(JSON.parse(opts.body)).toEqual({ assetNo: 'UDH-00001', templateId: 'tpl-custom' })
  })

  it('throws when API responds 4xx', async () => {
    mockFetchError(404, { error: 'Device not found' })
    const { printSingleSticker } = await loadHelpers()

    await expect(printSingleSticker('INVALID-99999')).rejects.toThrow('Device not found')
  })

  it('throws when API responds 5xx', async () => {
    mockFetchError(500, { error: 'Internal server error' })
    const { printSingleSticker } = await loadHelpers()

    await expect(printSingleSticker('UDH-00001')).rejects.toThrow('Internal server error')
  })

  it('throws when API responds with non-JSON error body', async () => {
    mockFetchError(502)
    const { printSingleSticker } = await loadHelpers()

    await expect(printSingleSticker('UDH-00001')).rejects.toThrow('HTTP 502')
  })

  it('throws on network failure', async () => {
    mockFetchNetworkFailure()
    const { printSingleSticker } = await loadHelpers()

    await expect(printSingleSticker('UDH-00001')).rejects.toThrow('Failed to fetch')
  })

  it('throws when window.open returns null (popup blocked)', async () => {
    mockFetchSuccess(SAMPLE_RENDER_RESPONSE)
    mockWindowOpen.mockReturnValue(null as unknown as ReturnType<typeof mockWindowOpen>)
    const { printSingleSticker } = await loadHelpers()

    await expect(printSingleSticker('UDH-00001')).rejects.toThrow()
  })
})

// ═════════════════════════════════════════════════════════════
// printBulkStickers
// ═════════════════════════════════════════════════════════════
describe('printBulkStickers', () => {
  it('returns the count of stickers rendered on success', async () => {
    mockFetchSuccess(SAMPLE_BULK_RESPONSE)
    const { printBulkStickers } = await loadHelpers()

    const count = await printBulkStickers(['UDH-00001', 'UDH-00002', 'UDH-00003'])

    expect(count).toBe(3)
  })

  it('sends all asset codes in the request body', async () => {
    const fetchMock = mockFetchSuccess(SAMPLE_BULK_RESPONSE)
    const { printBulkStickers } = await loadHelpers()

    await printBulkStickers(['UDH-00001', 'UDH-00002', 'UDH-00003'], 'tpl-grid')

    const opts = fetchMock.mock.calls[0][1]
    expect(JSON.parse(opts.body)).toEqual({
      assetNos: ['UDH-00001', 'UDH-00002', 'UDH-00003'],
      templateId: 'tpl-grid',
    })
  })

  it('throws immediately when called with empty selection', async () => {
    const fetchMock = mockFetchSuccess(SAMPLE_BULK_RESPONSE)
    const { printBulkStickers } = await loadHelpers()

    await expect(printBulkStickers([])).rejects.toThrow('ต้องเลือกอุปกรณ์อย่างน้อย 1 เครื่อง')
    // Should NOT have called fetch — fail fast on client-side validation.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws when API responds with empty stickers array', async () => {
    mockFetchSuccess({
      stickers: [],
      cols: 1,
      paperWidth: 50,
      paperHeight: 30,
      template: SAMPLE_TEMPLATE,
    })
    const { printBulkStickers } = await loadHelpers()

    await expect(
      printBulkStickers(['UDH-99999']),
    ).rejects.toThrow('ไม่พบอุปกรณ์ที่เลือก (อาจไม่มีสิทธิ์เข้าถึงสาขา)')
  })

  it('throws when API responds 4xx with error message', async () => {
    mockFetchError(403, { error: 'Forbidden: no access to site UDH' })
    const { printBulkStickers } = await loadHelpers()

    await expect(
      printBulkStickers(['UDH-00001']),
    ).rejects.toThrow('Forbidden: no access to site UDH')
  })

  it('throws when API responds 5xx', async () => {
    mockFetchError(500, { error: 'Database connection failed' })
    const { printBulkStickers } = await loadHelpers()

    await expect(
      printBulkStickers(['UDH-00001']),
    ).rejects.toThrow('Database connection failed')
  })

  it('throws on network failure', async () => {
    mockFetchNetworkFailure()
    const { printBulkStickers } = await loadHelpers()

    await expect(
      printBulkStickers(['UDH-00001']),
    ).rejects.toThrow('Failed to fetch')
  })

  it('throws when window.open returns null (popup blocked)', async () => {
    mockFetchSuccess(SAMPLE_BULK_RESPONSE)
    mockWindowOpen.mockReturnValue(null as unknown as ReturnType<typeof mockWindowOpen>)
    const { printBulkStickers } = await loadHelpers()

    await expect(
      printBulkStickers(['UDH-00001']),
    ).rejects.toThrow('ไม่สามารถเปิดหน้าต่างพิมพ์ได้ — กรุณาอนุญาตป๊อปอัป')
  })

  it('handles single-item bulk print (degenerate case)', async () => {
    mockFetchSuccess({
      stickers: [{ assetNo: 'UDH-00001', html: '<div>1</div>' }],
      cols: 1,
      paperWidth: 50,
      paperHeight: 30,
      template: SAMPLE_TEMPLATE,
    })
    const { printBulkStickers } = await loadHelpers()

    const count = await printBulkStickers(['UDH-00001'])

    expect(count).toBe(1)
  })
})

// ═════════════════════════════════════════════════════════════
// Contract — busy state is owned by the caller, not the helper.
// The helpers are pure async functions; the caller is responsible
// for setting `stickerPrinting = true/false` around the call.
// This test verifies the helper does not leak state between calls.
// ═════════════════════════════════════════════════════════════
describe('state isolation', () => {
  it('concurrent single + bulk print calls are independent', async () => {
    // Alternate success responses for single vs bulk endpoints
    let callCount = 0
    const fetchMock = mock((url: string) => {
      callCount++
      if (url.includes('bulk-render')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => SAMPLE_BULK_RESPONSE,
        } as unknown as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => SAMPLE_RENDER_RESPONSE,
      } as unknown as Response)
    })
    ;(globalThis as unknown as { fetch: unknown }).fetch = fetchMock

    const { printSingleSticker, printBulkStickers } = await loadHelpers()

    const [singleResult, bulkCount] = await Promise.all([
      printSingleSticker('UDH-00001'),
      printBulkStickers(['UDH-00001', 'UDH-00002']),
    ])

    expect(singleResult).toBe(true)
    expect(bulkCount).toBe(3)
    expect(callCount).toBe(2)
  })
})

// ═════════════════════════════════════════════════════════════
// Selection reset contract — documents the expected UX behavior.
// This is a documentation test: the helper itself does NOT clear
// selection (that's the caller's job). The test asserts the helper
// returns the count so the caller can decide whether to clear.
// ═════════════════════════════════════════════════════════════
describe('selection reset contract (documentation)', () => {
  it('returns the exact count so caller can clear selection on success', async () => {
    mockFetchSuccess(SAMPLE_BULK_RESPONSE)
    const { printBulkStickers } = await loadHelpers()

    // Simulate the caller pattern from itam-devices.tsx:
    //   const n = await printBulkStickers(assetCodes)
    //   toast.success(`เตรียมสติกเกอร์ ${n} ใบแล้ว`)
    //   setSelectedAssetCodes(new Set())  // ← caller clears on success
    const selection = new Set(['UDH-00001', 'UDH-00002', 'UDH-00003'])
    const n = await printBulkStickers(Array.from(selection))

    expect(n).toBe(selection.size)
    // Caller is responsible for clearing selection after this point.
    // If n > 0, the print succeeded; caller should clear.
    // If n throws, caller should KEEP selection (for retry).
    expect(n).toBeGreaterThan(0)
  })
})
