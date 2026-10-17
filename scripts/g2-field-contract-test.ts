// ============================================================
// G2 Field-Level Contract Test (Audit Path B condition #3 — revised per P1-R3)
// ============================================================
// Compares the staging service response against the SyncApi.gs expected output
// (sanitizeRecordForExternal_ allowlist + derived is_fifty_baht).
//
// Now verifies EXACT parity for all 20 allowlist fields (after is_fifty_baht
// derivation was added to the staging service per P1-R3 fix).
// Staging-specific extra fields (requestId, site, siteCode) are documented
// as intentional deviations (used by sync-adapter, not in SyncApi.gs allowlist).
// ============================================================

// ── SyncApi.gs expected sanitized record shape (from ExternalApi.gs @ 7428eb2) ──
// sanitizeRecordForExternal_(r) returns exactly these 21 fields (20 allowlist + is_fifty_baht derived):
const SYNC_API_ALLOWLIST = [
  'id', 'subject', 'status', 'building', 'location', 'details', 'details_admin',
  'priority', 'reporter_name', 'tel', 'employee_code', 'assigned_to',
  'is_fifty_baht', // DERIVED via isFiftyBahtJob_(r) — regex on details+details_admin
  'pic_before', 'pic_onsite', 'pic_after', 'created_at', 'updated_at',
  'work_completed_at', 'closed_at', 'canceled_at',
]

// Staging-specific extra fields (NOT in SyncApi.gs allowlist — used by sync-adapter)
const STAGING_EXTRA_FIELDS = ['requestId', 'site', 'siteCode']

const STAGING_URL = process.env.STAGING_TEST_URL || 'http://localhost:3030/exec'
const STAGING_TOKEN =
  process.env.STAGING_TEST_TOKEN || 'staging-non-secret-fixture-token-7428eb2'

interface TestResult {
  name: string
  passed: boolean
  detail: string
}

const results: TestResult[] = []

function record(name: string, passed: boolean, detail: string) {
  results.push({ name, passed, detail })
  console.log(`${passed ? '✓' : '✗'} ${name}`)
  if (detail) console.log(`  → ${detail}`)
}

// ── Fetch ALL records from the staging service ──
async function fetchStagingRecords(): Promise<Record<string, unknown>[]> {
  const resp = await fetch(STAGING_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authToken: STAGING_TOKEN, source: 'services', options: {} }),
  })
  const data = await resp.json()
  return (data.records as Record<string, unknown>[]) || []
}

// ── Expected is_fifty_baht values for each fixture record ──
// Based on the isFiftyBahtJob_ regex: /(นอกเวลา|50 บ|50บ|50 b|50b|50 บาท)/
// Fixture 1: details='นอกเวลา — test details' → matches 'นอกเวลา' → true
// Fixture 2: details='50 บาท — fifty baht case' → matches '50 บาท' → true
// Fixture 3: details='regular case' → no match → false
const EXPECTED_IS_FIFTY_BAHT: Record<string, boolean> = {
  'STG-WO-001': true,  // details contains 'นอกเวลา'
  'STG-WO-002': true,  // details contains '50 บาท'
  'STG-WO-003': false, // regular case
}

// ── Test 1: all 20 SyncApi.gs allowlist fields present (no documented gaps) ──
async function test1_allowlistCoverage(records: Record<string, unknown>[]) {
  const stagingFields = Object.keys(records[0])
  const missingFromStaging = SYNC_API_ALLOWLIST.filter((f) => !stagingFields.includes(f))
  const extraInStaging = stagingFields.filter((f) => !SYNC_API_ALLOWLIST.includes(f))
  // Extra fields must be exactly the documented staging extras
  const unexpectedExtra = extraInStaging.filter((f) => !STAGING_EXTRA_FIELDS.includes(f))

  record(
    'Test 1: all 20 SyncApi.gs allowlist fields present (no documented gaps; is_fifty_baht now derived)',
    missingFromStaging.length === 0 && unexpectedExtra.length === 0,
    `missing: ${missingFromStaging.join(', ') || '(none)'} | extra (documented): ${extraInStaging.filter(f=>STAGING_EXTRA_FIELDS.includes(f)).join(', ')} | unexpected extra: ${unexpectedExtra.join(', ') || '(none)'}`,
  )
}

// ── Test 2: value parity for ALL allowlist fields across all records ──
async function test2_valueParityAllFields(records: Record<string, unknown>[]) {
  // Expected fixture values (from mini-services/staging-apps-script/index.ts TEST_RECORDS)
  const expectedFixtures: Record<string, Record<string, unknown>> = {
    'STG-WO-001': {
      id: 'STG-WO-001', subject: 'Staging Test WO 1', status: '🟠รอดำเนินการ',
      building: 'B1', location: 'L1', details: 'นอกเวลา — test details',
      details_admin: 'admin note', priority: 'medium', reporter_name: 'Staging User',
      tel: '0800000001', employee_code: 'EMP001', assigned_to: 'tech1',
      is_fifty_baht: true, pic_before: '', pic_onsite: '', pic_after: '',
      created_at: '2026-08-01T10:00:00Z', updated_at: '2026-08-01T11:00:00Z',
      work_completed_at: '', closed_at: '', canceled_at: '',
    },
    'STG-WO-002': {
      id: 'STG-WO-002', subject: 'Staging Test WO 2', status: '🔵สำรวจหน้างาน/แก้ไข',
      building: 'B2', location: 'L2', details: '50 บาท — fifty baht case',
      details_admin: '', priority: 'high', reporter_name: 'Staging User 2',
      tel: '0800000002', employee_code: 'EMP002', assigned_to: 'tech2',
      is_fifty_baht: true, pic_before: '', pic_onsite: '', pic_after: '',
      created_at: '2026-08-02T11:00:00Z', updated_at: '2026-08-02T12:00:00Z',
      work_completed_at: '', closed_at: '', canceled_at: '',
    },
    'STG-WO-003': {
      id: 'STG-WO-003', subject: 'Staging Test WO 3', status: '🟢เสร็จสมบูรณ์',
      building: 'B3', location: 'L3', details: 'regular case',
      details_admin: '', priority: 'low', reporter_name: 'Staging User 3',
      tel: '0800000003', employee_code: 'EMP003', assigned_to: 'tech3',
      is_fifty_baht: false, pic_before: '', pic_onsite: '', pic_after: '',
      created_at: '2026-08-03T12:00:00Z', updated_at: '2026-08-03T13:00:00Z',
      work_completed_at: '2026-08-03T13:30:00Z', closed_at: '2026-08-03T14:00:00Z', canceled_at: '',
    },
  }

  let allMatch = true
  const mismatches: string[] = []
  for (const rec of records) {
    const rid = String(rec.id || '')
    const expected = expectedFixtures[rid]
    if (!expected) {
      mismatches.push(`${rid}: unexpected record (not in fixtures)`)
      allMatch = false
      continue
    }
    for (const field of SYNC_API_ALLOWLIST) {
      const got = rec[field]
      const want = expected[field]
      // is_fifty_baht is boolean — compare strictly
      if (field === 'is_fifty_baht') {
        if (got !== want) {
          mismatches.push(`${rid}.${field}: expected=${want}, got=${got}`)
          allMatch = false
        }
      } else {
        if (String(got || '') !== String(want || '')) {
          mismatches.push(`${rid}.${field}: expected='${want}', got='${got}'`)
          allMatch = false
        }
      }
    }
  }
  record(
    `Test 2: value parity for ALL 20 allowlist fields × ${records.length} records (incl. is_fifty_baht derivation)`,
    allMatch,
    allMatch ? `all ${records.length * SYNC_API_ALLOWLIST.length} field values match` : mismatches.slice(0, 5).join('; ') + (mismatches.length > 5 ? ` (+${mismatches.length-5} more)` : ''),
  )
}

// ── Test 3: is_fifty_baht derivation matches isFiftyBahtJob_ regex exactly ──
async function test3_isFiftyBahtDerivation(records: Record<string, unknown>[]) {
  let allMatch = true
  const details: string[] = []
  for (const rec of records) {
    const rid = String(rec.id || '')
    const expected = EXPECTED_IS_FIFTY_BAHT[rid]
    if (expected === undefined) continue
    const got = rec.is_fifty_baht
    const match = got === expected
    if (!match) allMatch = false
    details.push(`${rid}: is_fifty_baht=${got} (expected ${expected}) ${match ? '✓' : '✗'}`)
  }
  record(
    'Test 3: is_fifty_baht derivation matches isFiftyBahtJob_ regex (นอกเวลา|50 บ|50บ|50 b|50b|50 บาท)',
    allMatch,
    details.join('; '),
  )
}

// ── Test 4: metadata shape parity ──
async function test4_metadataShape() {
  const resp = await fetch(STAGING_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authToken: STAGING_TOKEN, source: 'services', options: {} }),
  })
  const data = await resp.json()
  const md = data.metadata || {}
  const hasTotalFetched = typeof md.totalFetched === 'number'
  const hasCursor = md.cursor === null || typeof md.cursor === 'string'
  const hasUnmapped = Array.isArray(md.unmappedColumns)
  record(
    'Test 4: metadata shape (totalFetched: number, cursor: null|string, unmappedColumns: array)',
    hasTotalFetched && hasCursor && hasUnmapped,
    `totalFetched=${md.totalFetched}, cursor=${md.cursor}, unmappedColumns=${JSON.stringify(md.unmappedColumns)}`,
  )
}

// ── Test 5: HTTP status semantics (all 200, errors in JSON body) ──
async function test5_httpStatusSemantics() {
  const r1 = await fetch(STAGING_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authToken: STAGING_TOKEN, source: 'services', options: {} }),
  })
  const r2 = await fetch(STAGING_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authToken: 'wrong', source: 'services', options: {} }),
  })
  const d2 = await r2.json()
  const ok = r1.status === 200 && r2.status === 200 && d2.code === 'UNAUTHORIZED'
  record(
    'Test 5: HTTP status semantics (Apps Script ContentService — all 200, errors in JSON body)',
    ok,
    `valid=${r1.status}, wrong=${r2.status} (error code=${d2.code})`,
  )
}

// ── Run all tests ──
console.log('=== G2 Field-Level Contract Test (P1-R3 revised — exact parity) ===')
console.log(`Staging service: ${STAGING_URL}`)
console.log(`SyncApi.gs reference: ExternalApi.gs @ 7428eb2 (sanitizeRecordForExternal_ + isFiftyBahtJob_)`)
console.log(`Timestamp (UTC): ${new Date().toISOString()}`)
console.log('')

const records = await fetchStagingRecords()
if (records.length === 0) {
  console.log('FATAL: could not fetch staging records')
  process.exit(1)
}

console.log(`Fetched ${records.length} records`)
console.log('Record fields:', Object.keys(records[0]).join(', '))
console.log('SyncApi.gs allowlist (20 fields):', SYNC_API_ALLOWLIST.join(', '))
console.log('Staging extras (documented):', STAGING_EXTRA_FIELDS.join(', '))
console.log('')

await test1_allowlistCoverage(records)
await test2_valueParityAllFields(records)
await test3_isFiftyBahtDerivation(records)
await test4_metadataShape()
await test5_httpStatusSemantics()

// ── Summary ──
const passed = results.filter((r) => r.passed).length
const failed = results.filter((r) => !r.passed).length
console.log('')
console.log('=== Summary ===')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
console.log(failed === 0 ? '\n✅ All field-level contract tests passed (exact parity for all 20 fields)' : '\n❌ Some tests failed')

if (failed > 0) process.exit(1)

export {}
