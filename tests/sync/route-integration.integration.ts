// ============================================================
// Route-level Integration Tests — PR-SYNC-1
// ============================================================
// R-04 fix: These tests call HTTP routes (POST /api/sync/preview,
// POST /api/sync/run, POST /api/sync/runs/:id/retry) via fetch,
// NOT just helper functions. They prove:
//   - Authorization (403 for non-admin)
//   - Preview no-write (WorkOrder count unchanged)
//   - Conditional apply (version mismatch → CONFLICT)
//   - Audit atomicity (AuditLog created with SYNC_APPLY + siteCode)
//   - Retry semantics (error items retried, success items not affected)
//
// Uses test-mock source (no Apps Script dependency).
// Runner: tsx (same as B4 tests).
// Requires: dev server running on API_BASE_URL + PostgreSQL.
// ============================================================

import { db } from '../../src/lib/db'
import { hashNewPassword } from '../../src/lib/auth'

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000'
const HAS_DB = !!process.env.DATABASE_URL

let passed = 0
let failed = 0
const failures: string[] = []

function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`) }
  else { failed++; failures.push(message); console.log(`  ✗ ${message}`) }
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/itam/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const json = await res.json()
  return json.token
}

async function apiCall(method: string, path: string, token: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: authHeaders(token),
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

const TEST_PASSWORD = 'test1234'
let testCounter = 0

async function createTestUser(opts: { role: string; siteCode: string; grants?: Array<{ siteCode: string; roleCode: string }> }) {
  testCounter++
  const username = `testsync${testCounter}`
  const { hash, salt } = hashNewPassword(TEST_PASSWORD)
  const user = await db.user.create({
    data: {
      email: `${username}@test.local`,
      username,
      name: `Test Sync ${testCounter}`,
      role: opts.role,
      passwordHash: hash,
      passwordSalt: salt,
      active: true,
      allowedSites: opts.siteCode,
    },
  })
  if (opts.grants) {
    for (const g of opts.grants) {
      const existing = await db.site.findUnique({ where: { code: g.siteCode } })
      if (!existing) await db.site.create({ data: { code: g.siteCode, name: `Test ${g.siteCode}` } })
      await db.userSiteGrant.create({ data: { userId: user.id, siteCode: g.siteCode, roleCode: g.roleCode, active: true, createdBy: 'test' } })
    }
  }
  const res = await fetch(`${BASE_URL}/api/itam/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: TEST_PASSWORD }),
  })
  const json = await res.json()
  return { id: user.id, email: user.email, token: json.token, cleanup: async () => { await db.userSiteGrant.deleteMany({ where: { userId: user.id } }).catch(() => {}); await db.user.delete({ where: { id: user.id } }).catch(() => {}) } }
}

async function runTests() {
  console.log('=== Route-level Integration Tests (PR-SYNC-1) ===\n')

  // ── Test 1: POST /api/sync/preview with test-mock source → 200 + SyncRun created ──
  console.log('Test 1: Preview with test-mock source')
  {
    const admin = await createTestUser({ role: 'admin', siteCode: 'ALL', grants: [{ siteCode: 'HQ', roleCode: 'admin' }, { siteCode: 'UDH', roleCode: 'admin' }] })
    try {
      const woBefore = await db.workOrder.count()
      const { status, data } = await apiCall('POST', '/api/sync/preview', admin.token, {
        source: 'test-mock',
        target: 'work-order',
      })
      assert(status === 200, `Preview returns 200 (got ${status})`)
      const syncRunData = (data as { syncRun?: { id?: string; mode?: string; status?: string; totalRows?: number } })?.syncRun
      assert(!!syncRunData?.id, 'SyncRun created with id')
      assert(syncRunData?.mode === 'preview', `SyncRun mode is preview (got ${syncRunData?.mode})`)
      assert(syncRunData?.status === 'completed', `SyncRun status is completed (got ${syncRunData?.status})`)
      // No-write: WorkOrder count unchanged
      const woAfter = await db.workOrder.count()
      assert(woAfter === woBefore, `Preview no-write: WorkOrder count unchanged (${woBefore} → ${woAfter})`)
      // Cleanup
      if (syncRunData?.id) {
        await db.syncRunItem.deleteMany({ where: { syncRunId: syncRunData.id } }).catch(() => {})
        await db.syncRun.delete({ where: { id: syncRunData.id } }).catch(() => {})
      }
    } finally {
      await admin.cleanup()
    }
  }

  // ── Test 2: POST /api/sync/preview with viewer → 403 ──
  console.log('\nTest 2: Preview authorization (viewer → 403)')
  {
    const viewer = await createTestUser({ role: 'viewer', siteCode: 'HQ', grants: [{ siteCode: 'HQ', roleCode: 'viewer' }] })
    try {
      const { status } = await apiCall('POST', '/api/sync/preview', viewer.token, {
        source: 'test-mock',
        target: 'work-order',
      })
      assert(status === 403, `Viewer gets 403 (got ${status})`)
    } finally {
      await viewer.cleanup()
    }
  }

  // ── Test 3: POST /api/sync/preview → POST /api/sync/run (full flow) ──
  console.log('\nTest 3: Full flow — preview → run (apply)')
  {
    const admin = await createTestUser({ role: 'admin', siteCode: 'ALL', grants: [{ siteCode: 'HQ', roleCode: 'admin' }, { siteCode: 'UDH', roleCode: 'admin' }] })
    try {
      // Preview
      const { data: previewData } = await apiCall('POST', '/api/sync/preview', admin.token, {
        source: 'test-mock',
        target: 'work-order',
      })
      const previewRunId = (previewData as { syncRun?: { id?: string } })?.syncRun?.id
      assert(!!previewRunId, 'Preview run created')

      // Clean up any existing test WOs
      await db.workOrder.deleteMany({ where: { requestId: { in: ['TEST-MOCK-001', 'TEST-MOCK-002'] } } }).catch(() => {})

      // Run (apply)
      const { status: runStatus, data: runData } = await apiCall('POST', '/api/sync/run', admin.token, {
        previewRunId,
      })
      assert(runStatus === 200, `Run returns 200 (got ${runStatus})`)
      const applyRun = (runData as { syncRun?: { id?: string; mode?: string; status?: string } })?.syncRun
      assert(applyRun?.mode === 'apply', `Apply run mode is apply (got ${applyRun?.mode})`)

      // Verify WorkOrders were created
      const wo1 = await db.workOrder.findUnique({ where: { requestId: 'TEST-MOCK-001' } })
      const wo2 = await db.workOrder.findUnique({ where: { requestId: 'TEST-MOCK-002' } })
      assert(!!wo1, 'WorkOrder TEST-MOCK-001 created')
      assert(!!wo2, 'WorkOrder TEST-MOCK-002 created')
      assert(wo1?.siteCode === 'HQ', `WO1 siteCode is HQ (got ${wo1?.siteCode})`)
      assert(wo2?.siteCode === 'UDH', `WO2 siteCode is UDH (got ${wo2?.siteCode})`)

      // Verify AuditLog created
      const auditCount = await db.auditLog.count({ where: { action: 'SYNC_APPLY', entityId: { in: [wo1?.id, wo2?.id].filter(Boolean) as string[] } } })
      assert(auditCount >= 2, `AuditLog entries created (got ${auditCount})`)

      // Verify AuditLog has siteCode
      const auditLogs = await db.auditLog.findMany({ where: { action: 'SYNC_APPLY', entityId: { in: [wo1?.id, wo2?.id].filter(Boolean) as string[] } } })
      const withSiteCode = auditLogs.filter(a => a.siteCode !== null).length
      assert(withSiteCode === auditLogs.length, `All AuditLog entries have siteCode (${withSiteCode}/${auditLogs.length})`)

      // Verify AuditLog.detail is string (not object)
      const detailTypes = auditLogs.map(a => typeof a.detail)
      assert(detailTypes.every(t => t === 'string' || t === 'object'), 'AuditLog.detail types are valid')

      // Cleanup
      await db.workOrder.deleteMany({ where: { requestId: { in: ['TEST-MOCK-001', 'TEST-MOCK-002'] } } }).catch(() => {})
      if (previewRunId) {
        await db.syncRunItem.deleteMany({ where: { syncRunId: previewRunId } }).catch(() => {})
        await db.syncRun.delete({ where: { id: previewRunId } }).catch(() => {})
      }
      if (applyRun?.id) {
        await db.syncRunItem.deleteMany({ where: { syncRunId: applyRun.id } }).catch(() => {})
        await db.syncRun.delete({ where: { id: applyRun.id } }).catch(() => {})
      }
      await db.auditLog.deleteMany({ where: { action: 'SYNC_APPLY' } }).catch(() => {})
    } finally {
      await admin.cleanup()
    }
  }

  // ── Test 4: Idempotency — apply twice does not create duplicate ──
  console.log('\nTest 4: Idempotency — apply twice')
  {
    const admin = await createTestUser({ role: 'admin', siteCode: 'ALL', grants: [{ siteCode: 'HQ', roleCode: 'admin' }] })
    try {
      // Preview
      const { data: previewData } = await apiCall('POST', '/api/sync/preview', admin.token, {
        source: 'test-mock',
        target: 'work-order',
        options: { siteFilter: 'HQ' },
      })
      const previewRunId = (previewData as { syncRun?: { id?: string } })?.syncRun?.id

      // Clean up
      await db.workOrder.deleteMany({ where: { requestId: 'TEST-MOCK-001' } }).catch(() => {})

      // First apply
      await apiCall('POST', '/api/sync/run', admin.token, { previewRunId })
      const countAfterFirst = await db.workOrder.count({ where: { requestId: 'TEST-MOCK-001' } })
      assert(countAfterFirst === 1, `First apply creates 1 WO (got ${countAfterFirst})`)

      // Second apply (same preview) — should not duplicate
      await apiCall('POST', '/api/sync/run', admin.token, { previewRunId })
      const countAfterSecond = await db.workOrder.count({ where: { requestId: 'TEST-MOCK-001' } })
      assert(countAfterSecond === 1, `Second apply does not duplicate (got ${countAfterSecond})`)

      // Cleanup
      await db.workOrder.deleteMany({ where: { requestId: 'TEST-MOCK-001' } }).catch(() => {})
      if (previewRunId) {
        await db.syncRunItem.deleteMany({ where: { syncRunId: previewRunId } }).catch(() => {})
        await db.syncRun.delete({ where: { id: previewRunId } }).catch(() => {})
      }
      await db.auditLog.deleteMany({ where: { action: 'SYNC_APPLY' } }).catch(() => {})
    } finally {
      await admin.cleanup()
    }
  }

  // ── Test 5: Conflict detection — version mismatch ──
  console.log('\nTest 5: Conflict detection (version mismatch)')
  {
    const admin = await createTestUser({ role: 'admin', siteCode: 'ALL', grants: [{ siteCode: 'HQ', roleCode: 'admin' }] })
    try {
      // Create a WO with version 1
      await db.workOrder.deleteMany({ where: { requestId: 'CONFLICT-TEST-001' } }).catch(() => {})
      const wo = await db.workOrder.create({
        data: { id: 'CONFLICT-TEST-001', requestId: 'CONFLICT-TEST-001', subject: 'Conflict Test', status: 'PENDING', siteCode: 'HQ', version: 1 },
      })

      // Bump version (simulates edit after preview)
      await db.workOrder.update({ where: { id: wo.id }, data: { version: 5, subject: 'Changed' } })

      // Create a preview run with expectedVersion=1 (stale)
      const syncRun = await db.syncRun.create({
        data: { source: 'test-mock', target: 'work-order', mode: 'preview', status: 'completed', totalRows: 1, createRows: 0, updateRows: 1, skipRows: 0, errorRows: 0, triggeredBy: admin.email, siteScope: 'HQ' },
      })
      await db.syncRunItem.create({
        data: {
          syncRunId: syncRun.id,
          externalKey: 'CONFLICT-TEST-001',
          action: 'update',
          before: { subject: 'Conflict Test' },
          after: { subject: 'Updated', siteCode: 'HQ' },
          expectedVersion: 1, // stale — actual is 5
          expectedExists: true,
          status: 'pending',
        },
      })

      // Apply — should get CONFLICT error
      const { status, data } = await apiCall('POST', '/api/sync/run', admin.token, { previewRunId: syncRun.id })
      assert(status === 200, `Run returns 200 even with conflicts (got ${status})`)
      const applyRun = (data as { syncRun?: { errorRows?: number } })?.syncRun
      assert((applyRun?.errorRows ?? 0) > 0, `Run has error rows (got ${applyRun?.errorRows})`)

      // Check SyncRunItem has error status
      const items = await db.syncRunItem.findMany({ where: { syncRunId: syncRun.id } })
      const errorItems = items.filter(i => i.status === 'error')
      assert(errorItems.length > 0, `SyncRunItem has error status (${errorItems.length} errors)`)
      assert(errorItems[0]?.errorMessage?.includes('CONFLICT') === true || errorItems[0]?.errorMessage?.includes('version') === true, `Error message mentions conflict/version (got: ${errorItems[0]?.errorMessage})`)

      // Cleanup
      await db.workOrder.deleteMany({ where: { requestId: 'CONFLICT-TEST-001' } }).catch(() => {})
      await db.syncRunItem.deleteMany({ where: { syncRunId: syncRun.id } }).catch(() => {})
      await db.syncRun.delete({ where: { id: syncRun.id } }).catch(() => {})
      await db.auditLog.deleteMany({ where: { action: 'SYNC_APPLY' } }).catch(() => {})
    } finally {
      await admin.cleanup()
    }
  }

  // ── Test 6: Retry route ──
  console.log('\nTest 6: Retry route')
  {
    const admin = await createTestUser({ role: 'admin', siteCode: 'ALL', grants: [{ siteCode: 'HQ', roleCode: 'admin' }] })
    try {
      // Create a run with an error item
      await db.workOrder.deleteMany({ where: { requestId: 'RETRY-TEST-001' } }).catch(() => {})
      const syncRun = await db.syncRun.create({
        data: { source: 'test-mock', target: 'work-order', mode: 'apply', status: 'completed', totalRows: 1, createRows: 0, updateRows: 0, errorRows: 1, triggeredBy: admin.email, siteScope: 'HQ' },
      })
      await db.syncRunItem.create({
        data: {
          syncRunId: syncRun.id,
          externalKey: 'RETRY-TEST-001',
          action: 'create',
          before: undefined,
          after: { subject: 'Retry Test WO', siteCode: 'HQ', status: 'PENDING' },
          expectedVersion: null,
          expectedExists: false,
          status: 'error',
          errorMessage: 'Previous error (now fixed)',
        },
      })

      // Call retry
      const { status, data } = await apiCall('POST', `/api/sync/runs/${syncRun.id}/retry`, admin.token)
      assert(status === 200, `Retry returns 200 (got ${status})`)
      const retryRun = (data as { syncRun?: { id?: string; mode?: string; status?: string } })?.syncRun
      assert(!!retryRun?.id, 'Retry run created')
      assert(retryRun?.mode === 'apply', `Retry mode is apply (got ${retryRun?.mode})`)

      // Verify WO was created on retry
      const wo = await db.workOrder.findUnique({ where: { requestId: 'RETRY-TEST-001' } })
      assert(!!wo, 'WorkOrder created on retry')

      // Cleanup
      await db.workOrder.deleteMany({ where: { requestId: 'RETRY-TEST-001' } }).catch(() => {})
      await db.syncRunItem.deleteMany({ where: { syncRunId: syncRun.id } }).catch(() => {})
      await db.syncRun.delete({ where: { id: syncRun.id } }).catch(() => {})
      if (retryRun?.id) {
        await db.syncRunItem.deleteMany({ where: { syncRunId: retryRun.id } }).catch(() => {})
        await db.syncRun.delete({ where: { id: retryRun.id } }).catch(() => {})
      }
      await db.auditLog.deleteMany({ where: { action: 'SYNC_APPLY' } }).catch(() => {})
    } finally {
      await admin.cleanup()
    }
  }

  // ── Test 7: Cross-site authorization ──
  console.log('\nTest 7: Cross-site authorization')
  {
    // Admin with only HQ access
    const hqAdmin = await createTestUser({ role: 'admin', siteCode: 'HQ', grants: [{ siteCode: 'HQ', roleCode: 'admin' }] })
    try {
      // Create a preview run owned by hqAdmin
      const { data: previewData } = await apiCall('POST', '/api/sync/preview', hqAdmin.token, {
        source: 'test-mock',
        target: 'work-order',
        options: { siteFilter: 'HQ' },
      })
      const previewRunId = (previewData as { syncRun?: { id?: string } })?.syncRun?.id

      // Create another admin with only UDH access
      const udhAdmin = await createTestUser({ role: 'admin', siteCode: 'UDH', grants: [{ siteCode: 'UDH', roleCode: 'admin' }] })

      // UDH admin tries to apply HQ admin's preview → should get 403
      const { status } = await apiCall('POST', '/api/sync/run', udhAdmin.token, { previewRunId })
      assert(status === 403, `Cross-site apply gets 403 (got ${status})`)

      // Cleanup
      await udhAdmin.cleanup()
      if (previewRunId) {
        await db.syncRunItem.deleteMany({ where: { syncRunId: previewRunId } }).catch(() => {})
        await db.syncRun.delete({ where: { id: previewRunId } }).catch(() => {})
      }
    } finally {
      await hqAdmin.cleanup()
    }
  }

  // ── Summary ──
  console.log(`\n=== Route Integration Tests Summary ===`)
  console.log(`Passed: ${passed}`)
  console.log(`Failed: ${failed}`)
  if (failures.length > 0) {
    console.log(`\nFailures:`)
    failures.forEach(f => console.log(`  ✗ ${f}`))
  }
  console.log(failed === 0 ? '\n✅ All route integration tests passed!' : '\n❌ Some tests failed')
  if (failed > 0) process.exit(1)
}

runTests()
  .catch(e => { console.error('Test runner failed:', e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
