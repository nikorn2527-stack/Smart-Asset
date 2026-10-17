// ============================================================
// Staging Apps Script-compatible service
// ============================================================
// Implements the EXACT SyncApi.gs doPost contract (Services repo @ 7428eb2)
// so the ITAM-NextJS sync-adapter can be tested end-to-end against a REAL
// HTTP endpoint (not mocked fetch) for the G2 real-token test matrix.
//
// This is a STAGING service — separate from production Apps Script deployment.
// It is NOT the actual Google Apps Script Web App; it implements the same
// contract so Dev can prove the adapter works against real HTTP.
//
// Contract (from SyncApi.gs):
//   POST {URL}  Content-Type: application/json
//   Body: { authToken, source, options: { since, siteFilter, limit, cursor } }
//
//   All responses HTTP 200 (Apps Script ContentService behavior):
//     - Bad JSON body          → { error: 'Bad Request: invalid JSON body', code: 'BAD_REQUEST' }
//     - No SYNC_API_TOKEN set  → { error: 'Server configuration error: SYNC_API_TOKEN not set', code: 'SERVER_CONFIG_ERROR' }
//     - Missing/wrong token    → { error: 'Unauthorized: missing or invalid token', code: 'UNAUTHORIZED' }
//     - Valid token + success  → { records: [...], metadata: { totalFetched, cursor, unmappedColumns } }
//     - Internal error         → { error: 'Internal server error: ...', code: 'INTERNAL_ERROR' }
//
// Port: 3030 (fixed — separate from Next.js dev server on 3000)
// Token: SYNC_API_TOKEN env var (simulates Apps Script Script Property)
// ============================================================

const PORT = Number(process.env.PORT) || 3030
const SYNC_API_TOKEN = process.env.SYNC_API_TOKEN || ''

// ── Test fixture records (mimics readJsonFromSheet('Data') in Apps Script) ──
// These are staging test records — NOT production data.
// Records include ALL fields from SyncApi.gs sanitizeRecordForExternal_ allowlist
// (so the field-level contract test can verify parity) + staging-specific fields
// (requestId, siteCode) that the adapter uses but Apps Script derives elsewhere.
const TEST_RECORDS = [
  {
    id: 'STG-WO-001', subject: 'Staging Test WO 1', status: '🟠รอดำเนินการ',
    building: 'B1', location: 'L1', details: 'นอกเวลา — test details',
    details_admin: 'admin note', priority: 'medium', reporter_name: 'Staging User',
    tel: '0800000001', employee_code: 'EMP001', assigned_to: 'tech1',
    pic_before: '', pic_onsite: '', pic_after: '',
    created_at: '2026-08-01T10:00:00Z', updated_at: '2026-08-01T11:00:00Z',
    work_completed_at: '', closed_at: '', canceled_at: '',
    // staging-specific (used by sync-adapter, not in SyncApi.gs allowlist):
    requestId: 'STG-WO-001', site: 'HQ', siteCode: 'HQ',
  },
  {
    id: 'STG-WO-002', subject: 'Staging Test WO 2', status: '🔵สำรวจหน้างาน/แก้ไข',
    building: 'B2', location: 'L2', details: '50 บาท — fifty baht case',
    details_admin: '', priority: 'high', reporter_name: 'Staging User 2',
    tel: '0800000002', employee_code: 'EMP002', assigned_to: 'tech2',
    pic_before: '', pic_onsite: '', pic_after: '',
    created_at: '2026-08-02T11:00:00Z', updated_at: '2026-08-02T12:00:00Z',
    work_completed_at: '', closed_at: '', canceled_at: '',
    requestId: 'STG-WO-002', site: 'UDH', siteCode: 'UDH',
  },
  {
    id: 'STG-WO-003', subject: 'Staging Test WO 3', status: '🟢เสร็จสมบูรณ์',
    building: 'B3', location: 'L3', details: 'regular case',
    details_admin: '', priority: 'low', reporter_name: 'Staging User 3',
    tel: '0800000003', employee_code: 'EMP003', assigned_to: 'tech3',
    pic_before: '', pic_onsite: '', pic_after: '',
    created_at: '2026-08-03T12:00:00Z', updated_at: '2026-08-03T13:00:00Z',
    work_completed_at: '2026-08-03T13:30:00Z', closed_at: '2026-08-03T14:00:00Z', canceled_at: '',
    requestId: 'STG-WO-003', site: 'NKP', siteCode: 'NKP',
  },
]

// ── jsonResult_ helper (mimics Apps Script ContentService.createTextOutput) ──
// Apps Script always returns HTTP 200, even for errors.
function jsonResult(obj: Record<string, unknown>): Response {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ── isFiftyBahtJob_ (protocol-equivalent — mirrors SyncApi.gs/ExternalApi.gs logic) ──
// Derived field: is_fifty_baht. Regex matches SyncApi.gs isFiftyBahtJob_ exactly:
//   /(นอกเวลา|50 บ|50บ|50 b|50b|50 บาท)/.test((details + ' ' + details_admin).toLowerCase())
// Added per Audit P1-R3: derive is_fifty_baht so field-level parity test can verify all 20 fields.
function isFiftyBahtJob(record: Record<string, unknown>): boolean {
  if (!record) return false
  const detailText = (
    String(record.details || '') + ' ' + String(record.details_admin || '')
  ).toLowerCase()
  return /(นอกเวลา|50 บ|50บ|50 b|50b|50 บาท)/.test(detailText)
}

// ── sanitizeRecordForExternal_ (protocol-equivalent — now with is_fifty_baht derivation) ──
// Mirrors SyncApi.gs sanitizeRecordForExternal_ (ExternalApi.gs @ 7428eb2):
//   - Explicit 20-field allowlist (id, subject, status, building, location, details,
//     details_admin, priority, reporter_name, tel, employee_code, assigned_to,
//     is_fifty_baht, pic_before, pic_onsite, pic_after, created_at, updated_at,
//     work_completed_at, closed_at, canceled_at)
//   - Derived field: is_fifty_baht via isFiftyBahtJob_ (regex on details+details_admin)
// Now includes is_fifty_baht derivation (P1-R3 fix) so field-level parity is exact
// for all 20 allowlist fields. Staging-specific fields (requestId, site, siteCode)
// are kept as EXTRA fields (used by sync-adapter, not in SyncApi.gs allowlist).
function sanitizeRecord(r: Record<string, unknown>): Record<string, unknown> {
  if (!r) return {} as Record<string, unknown>
  return {
    id: r.id || '',
    subject: r.subject || '',
    status: r.status || '',
    building: r.building || '',
    location: r.location || '',
    details: r.details || '',
    details_admin: r.details_admin || '',
    priority: r.priority || '',
    reporter_name: r.reporter_name || '',
    tel: r.tel || '',
    employee_code: r.employee_code || '',
    assigned_to: r.assigned_to || '',
    is_fifty_baht: isFiftyBahtJob(r), // DERIVED — mirrors SyncApi.gs isFiftyBahtJob_
    pic_before: r.pic_before || '',
    pic_onsite: r.pic_onsite || '',
    pic_after: r.pic_after || '',
    created_at: r.created_at || '',
    updated_at: r.updated_at || '',
    work_completed_at: r.work_completed_at || '',
    closed_at: r.closed_at || '',
    canceled_at: r.canceled_at || '',
    // staging-specific (NOT in SyncApi.gs allowlist — used by sync-adapter):
    requestId: r.requestId || '',
    site: r.site || '',
    siteCode: r.siteCode || '',
  }
}

// ── doPost handler (implements SyncApi.gs doPost logic exactly) ──
async function doPost(body: Record<string, unknown>): Promise<Response> {
  // 1. Token verification (from body, NOT header — per SyncApi.gs)
  const token = String(body.authToken || '').trim()

  // 2. Check SYNC_API_TOKEN is configured (simulates Script Property)
  if (!SYNC_API_TOKEN) {
    // Fail-closed: if no token configured, deny all access
    return jsonResult({
      error: 'Server configuration error: SYNC_API_TOKEN not set',
      code: 'SERVER_CONFIG_ERROR',
    })
  }

  // 3. Verify token (basic equality — NOT constant-time, matches SyncApi.gs P9-05)
  if (!token || token !== SYNC_API_TOKEN) {
    return jsonResult({
      error: 'Unauthorized: missing or invalid token',
      code: 'UNAUTHORIZED',
    })
  }

  // 4. Parse request parameters
  const source = String(body.source || 'services')
  const options = (body.options as Record<string, unknown>) || {}
  const since = options.since ? String(options.since) : ''
  const limit = parseInt(String(options.limit), 10) || 500
  const cursor = options.cursor ? String(options.cursor) : ''
  const siteFilter = options.siteFilter ? String(options.siteFilter) : ''

  // 5. Enforce max limit (per SyncApi.gs)
  const effectiveLimit = limit > 1000 ? 1000 : limit

  // 6. Fetch records (from test fixture — mimics readJsonFromSheet)
  try {
    let records = [...TEST_RECORDS]

    // Filter by 'since' date
    if (since) {
      const sinceDate = new Date(since)
      records = records.filter((r) => {
        if (!r.created_at) return false
        return new Date(r.created_at) >= sinceDate
      })
    }

    // Filter by site
    if (siteFilter) {
      records = records.filter((r) => {
        const recordSite = String(r.site || r.siteCode || '').toUpperCase()
        return recordSite === siteFilter.toUpperCase()
      })
    }

    // Apply limit
    const totalCount = records.length
    let hasMore = false
    if (records.length > effectiveLimit) {
      records = records.slice(0, effectiveLimit)
      hasMore = true
    }

    // 7. Return response in sync-adapter contract format
    return jsonResult({
      records: records.map(sanitizeRecord),
      metadata: {
        totalFetched: records.length,
        cursor: hasMore ? (cursor || 'offset:' + effectiveLimit) : null,
        unmappedColumns: [],
      },
    })
  } catch (err) {
    return jsonResult({
      error: 'Internal server error: ' + (err instanceof Error ? err.message : String(err)),
      code: 'INTERNAL_ERROR',
    })
  }
}

// ── HTTP server (Bun.serve) ──
const server = Bun.serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    // Health check endpoint (GET)
    if (req.method === 'GET' && url.pathname === '/health') {
      return jsonResult({
        status: 'ok',
        service: 'staging-apps-script',
        tokenConfigured: !!SYNC_API_TOKEN,
        recordsCount: TEST_RECORDS.length,
      })
    }

    // doPost endpoint (POST any path — mimics Apps Script /exec)
    if (req.method === 'POST') {
      let body: Record<string, unknown> = {}
      try {
        const rawBody = await req.text()
        body = JSON.parse(rawBody) || {}
      } catch (parseErr) {
        return jsonResult({
          error: 'Bad Request: invalid JSON body',
          code: 'BAD_REQUEST',
        })
      }
      return doPost(body)
    }

    // 404 for other methods
    return new Response('Not Found', { status: 404 })
  },
})

console.log(`[staging-apps-script] listening on http://localhost:${PORT}`)
console.log(`[staging-apps-script] SYNC_API_TOKEN configured: ${!!SYNC_API_TOKEN}`)
console.log(`[staging-apps-script] test records: ${TEST_RECORDS.length}`)

export { server }
