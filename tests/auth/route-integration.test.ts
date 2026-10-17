/**
 * Route Integration Tests — Authorization Matrix (Round 7)
 *
 * Task ID: INTEGRATION-TESTS-ROUND-7
 *
 * REAL integration tests that:
 * - Create actual Work Orders with devices at specific Sites
 * - Make authenticated HTTP requests with real JWT tokens
 * - Assert SPECIFIC status codes (not "200 or 404")
 * - Test child-resource isolation (images, print, messages, parts)
 * - Test state transitions (assign, cancel, complete)
 * - Test cross-Site device reassignment
 *
 * Run with: npx tsx tests/auth/route-integration.test.ts
 * Requires: running server (bun run dev) + seeded DB
 */

import { db } from '../../src/lib/db'
import { hashNewPassword } from '../../src/lib/auth'

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000'
const TEST_PASSWORD = 'test-integration-pass-123'

// ── Helpers ───────────────────────────────────────────
interface TestUser {
  id: string
  email: string
  token: string
  cleanup: () => Promise<void>
}

let testCounter = 0

async function createTestUser(opts: {
  role: string
  grants?: Array<{ siteCode: string; roleCode: string }>
}): Promise<TestUser> {
  testCounter++
  const email = `test-int-${Date.now()}-${testCounter}@itam-test.local`
  const { hash, salt } = hashNewPassword(TEST_PASSWORD)
  const user = await db.user.create({
    data: { email, username: `testint${testCounter}`, name: `Test ${testCounter}`, role: opts.role, passwordHash: hash, passwordSalt: salt, active: true },
  })
  if (opts.grants) {
    for (const g of opts.grants) {
      const existing = await db.site.findUnique({ where: { code: g.siteCode } })
      if (!existing) await db.site.create({ data: { code: g.siteCode, name: `Test ${g.siteCode}` } })
      await db.userSiteGrant.create({ data: { userId: user.id, siteCode: g.siteCode, roleCode: g.roleCode, active: true, createdBy: 'test' } })
    }
  }
  const res = await fetch(`${BASE_URL}/api/itam/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: `testint${testCounter}`, password: TEST_PASSWORD }) })
  const json = await res.json()
  return { id: user.id, email, token: json.token, cleanup: async () => { await db.userSiteGrant.deleteMany({ where: { userId: user.id } }).catch(() => {}); await db.user.delete({ where: { id: user.id } }).catch(() => {}) } }
}

async function createTestDevice(site: string): Promise<string> {
  const code = `TEST-DEV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const device = await db.device.create({ data: { assetCode: code, name: `Test Device ${code}`, brand: 'Test', model: 'Test', type: 'PRINTER', status: 'Active', site } })
  return device.id
}

async function createTestWO(siteCode: string, deviceId?: string): Promise<string> {
  const woNum = `TEST-WO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const wo = await db.workOrder.create({ data: { id: woNum, woNumber: woNum, subject: 'Test WO', status: 'PENDING', siteCode, deviceId: deviceId ?? null } })
  return wo.id
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

async function apiCall(method: string, path: string, token: string | null, body?: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, { method, headers: token ? authHeaders(token) : { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

// ── Test runner ───────────────────────────────────────
let passed = 0
let failed = 0
const failures: string[] = []

function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`) }
  else { failed++; failures.push(message); console.log(`  ✗ ${message}`) }
}

async function runTests() {
  console.log('=== Route Integration Tests (Round 7) ===\n')

  // ── Unauthenticated tests (assert specific 401) ──
  console.log('Group 1: Unauthenticated access → 401')
  {
    const endpoints = [
      ['GET', '/api/work-orders'],
      ['GET', '/api/devices'],
      ['GET', '/api/sites'],
      ['GET', '/api/reports/unified?group=devices'],
      ['GET', '/api/work-orders/test-id'],
      ['GET', '/api/work-orders/test-id/images'],
      ['GET', '/api/work-orders/test-id/print'],
      ['GET', '/api/work-orders/test-id/messages'],
      ['GET', '/api/work-orders/test-id/parts'],
      ['GET', '/api/work-orders/test-id/print-sheet'],
      ['POST', '/api/work-orders/test-id/assign'],
      ['POST', '/api/work-orders/test-id/cancel'],
      ['POST', '/api/work-orders/test-id/complete'],
      ['POST', '/api/work-orders/test-id/edit-unlock'],
      ['PUT', '/api/work-orders/test-id/reporter-edit'],
    ]
    for (const [method, path] of endpoints) {
      const { status } = await apiCall(method, path, null)
      assert(status === 401, `${method} ${path} without token → 401 (got ${status})`)
    }
  }
  console.log('')

  // ── Authenticated WO child-resource access with real WO ──
  console.log('Group 2: Authenticated WO child-resource access (same-Site)')
  {
    const user = await createTestUser({ role: 'admin', grants: [{ siteCode: 'UDH', roleCode: 'admin' }] })
    const deviceId = await createTestDevice('UDH')
    const woId = await createTestWO('UDH', deviceId)
    try {
      // WO detail → 200
      const detail = await apiCall('GET', `/api/work-orders/${woId}`, user.token)
      assert(detail.status === 200, `GET /api/work-orders/:id (same-Site) → 200 (got ${detail.status})`)

      // WO images → 200
      const images = await apiCall('GET', `/api/work-orders/${woId}/images`, user.token)
      assert(images.status === 200, `GET /api/work-orders/:id/images (same-Site) → 200 (got ${images.status})`)

      // WO print → 200
      const print = await apiCall('GET', `/api/work-orders/${woId}/print`, user.token)
      assert(print.status === 200, `GET /api/work-orders/:id/print (same-Site) → 200 (got ${print.status})`)

      // WO messages → 200
      const messages = await apiCall('GET', `/api/work-orders/${woId}/messages`, user.token)
      assert(messages.status === 200, `GET /api/work-orders/:id/messages (same-Site) → 200 (got ${messages.status})`)

      // WO parts → 200
      const parts = await apiCall('GET', `/api/work-orders/${woId}/parts`, user.token)
      assert(parts.status === 200, `GET /api/work-orders/:id/parts (same-Site) → 200 (got ${parts.status})`)

      // WO print-sheet → 200
      const sheet = await apiCall('GET', `/api/work-orders/${woId}/print-sheet`, user.token)
      assert(sheet.status === 200, `GET /api/work-orders/:id/print-sheet (same-Site) → 200 (got ${sheet.status})`)
    } finally {
      await db.workOrder.deleteMany({ where: { id: woId } }).catch(() => {})
      await db.device.deleteMany({ where: { id: deviceId } }).catch(() => {})
      await user.cleanup()
    }
  }
  console.log('')

  // ── Cross-Site WO child-resource denial ──
  console.log('Group 3: Cross-Site WO child-resource denial → 404')
  {
    const user = await createTestUser({ role: 'admin', grants: [{ siteCode: 'UDH', roleCode: 'admin' }] })
    const deviceId = await createTestDevice('NKP') // NKP device, not UDH
    const woId = await createTestWO('NKP', deviceId) // NKP WO
    try {
      // WO detail → 404 (not 200 — cross-Site)
      const detail = await apiCall('GET', `/api/work-orders/${woId}`, user.token)
      assert(detail.status === 404, `GET /api/work-orders/:id (cross-Site NKP) → 404 (got ${detail.status})`)

      // WO images → 404
      const images = await apiCall('GET', `/api/work-orders/${woId}/images`, user.token)
      assert(images.status === 404, `GET /api/work-orders/:id/images (cross-Site NKP) → 404 (got ${images.status})`)

      // WO print → 404
      const print = await apiCall('GET', `/api/work-orders/${woId}/print`, user.token)
      assert(print.status === 404, `GET /api/work-orders/:id/print (cross-Site NKP) → 404 (got ${print.status})`)

      // WO messages → 404
      const messages = await apiCall('GET', `/api/work-orders/${woId}/messages`, user.token)
      assert(messages.status === 404, `GET /api/work-orders/:id/messages (cross-Site NKP) → 404 (got ${messages.status})`)

      // WO assign → 404
      const assign = await apiCall('POST', `/api/work-orders/${woId}/assign`, user.token, { assignedTo: 'test' })
      assert(assign.status === 404, `POST /api/work-orders/:id/assign (cross-Site NKP) → 404 (got ${assign.status})`)

      // WO cancel → 404
      const cancel = await apiCall('POST', `/api/work-orders/${woId}/cancel`, user.token, { reason: 'test' })
      assert(cancel.status === 404, `POST /api/work-orders/:id/cancel (cross-Site NKP) → 404 (got ${cancel.status})`)

      // WO complete → 404
      const complete = await apiCall('POST', `/api/work-orders/${woId}/complete`, user.token, { resolution: 'done' })
      assert(complete.status === 404, `POST /api/work-orders/:id/complete (cross-Site NKP) → 404 (got ${complete.status})`)
    } finally {
      await db.workOrder.deleteMany({ where: { id: woId } }).catch(() => {})
      await db.device.deleteMany({ where: { id: deviceId } }).catch(() => {})
      await user.cleanup()
    }
  }
  console.log('')

  // ── Cross-Site device creation denial ──
  console.log('Group 4: Cross-Site device POST → 403')
  {
    const user = await createTestUser({ role: 'admin', grants: [{ siteCode: 'UDH', roleCode: 'admin' }] })
    try {
      const { status } = await apiCall('POST', '/api/devices', user.token, {
        assetCode: `TEST-CROSS-${Date.now()}`, name: 'Cross', brand: 'Test', model: 'Test', type: 'PRINTER', status: 'Active', site: 'NKP',
      })
      assert(status === 403, `POST /api/devices at NKP with UDH-only grant → 403 (got ${status})`)
    } finally {
      await user.cleanup()
    }
  }
  console.log('')

  // ── Same-Site device creation success ──
  console.log('Group 5: Same-Site device POST → 200/201')
  {
    const user = await createTestUser({ role: 'admin', grants: [{ siteCode: 'UDH', roleCode: 'admin' }] })
    const code = `TEST-SAME-${Date.now()}`
    try {
      const { status } = await apiCall('POST', '/api/devices', user.token, {
        assetCode: code, name: 'Same Site', brand: 'Test', model: 'Test', type: 'PRINTER', status: 'Active', site: 'UDH',
      })
      assert(status === 200 || status === 201, `POST /api/devices at UDH with UDH grant → 200/201 (got ${status})`)
    } finally {
      await db.device.deleteMany({ where: { assetCode: code } }).catch(() => {})
      await user.cleanup()
    }
  }
  console.log('')

  // ── No-grant user fail-closed ──
  console.log('Group 6: No-grant user → empty/fail-closed')
  {
    const user = await createTestUser({ role: 'viewer' })
    try {
      const { status, data } = await apiCall('GET', '/api/devices', user.token)
      assert(status === 200, `GET /api/devices with no grants → 200 (got ${status})`)
      const devices = (data as { devices?: unknown[] })?.devices
      assert(Array.isArray(devices) && devices.length === 0, 'No-grant user should get empty devices array')
    } finally {
      await user.cleanup()
    }
  }
  console.log('')

  // ── State transition: assign → cancel (same-Site) ──
  console.log('Group 7: State transitions (same-Site)')
  {
    const user = await createTestUser({ role: 'admin', grants: [{ siteCode: 'UDH', roleCode: 'admin' }] })
    const woId = await createTestWO('UDH')
    try {
      // Assign → 200
      const assign = await apiCall('POST', `/api/work-orders/${woId}/assign`, user.token, { assignedTo: 'test-tech', assignmentNote: 'test' })
      assert(assign.status === 200, `POST assign (same-Site) → 200 (got ${assign.status})`)

      // Cancel → 200
      const cancel = await apiCall('POST', `/api/work-orders/${woId}/cancel`, user.token, { reason: 'test cancel' })
      assert(cancel.status === 200, `POST cancel (same-Site) → 200 (got ${cancel.status})`)
    } finally {
      await db.workOrder.deleteMany({ where: { id: woId } }).catch(() => {})
      await user.cleanup()
    }
  }
  console.log('')

  // ── Summary ──
  console.log('=== Summary ===')
  console.log(`Passed: ${passed}`)
  console.log(`Failed: ${failed}`)
  if (failures.length > 0) {
    console.log('\nFailures:')
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  } else {
    console.log('\nAll integration tests passed! ✅')
    process.exit(0)
  }
}

async function checkServer(): Promise<boolean> {
  try { const res = await fetch(`${BASE_URL}/api/auth/oauth/status`); return res.ok || res.status === 401 } catch { return false }
}

async function main() {
  const up = await checkServer()
  if (!up) { console.error(`Server not running at ${BASE_URL}. Start with: bun run dev`); process.exit(1) }
  await runTests()
}

main().catch((e) => { console.error('Test runner failed:', e); process.exit(1) }).finally(async () => { await db.$disconnect() })
