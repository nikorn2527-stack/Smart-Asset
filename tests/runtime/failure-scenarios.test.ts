/**
 * failure-scenarios.test.ts — Runtime test for failure handling.
 *
 * Verifies that the system fails closed (stops cleanly) when:
 *   - Missing auth token
 *   - Invalid permission
 *   - Missing required fields
 *   - Non-existent resource
 *   - Concurrent modifications (version conflict)
 *
 * Prerequisites:
 *   - Server running on http://localhost:3000
 *   - admin/test1234 seeded
 *
 * Usage:
 *   bun run tests/runtime/failure-scenarios.test.ts
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

interface TestResult {
  name: string
  passed: boolean
  detail?: string
}

const results: TestResult[] = []

async function login(username: string, password: string): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/api/itam/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) return null
  return (await res.json()).token
}

async function apiCall(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

async function test(name: string, fn: () => Promise<boolean>, detail?: string) {
  try {
    const passed = await fn()
    results.push({ name, passed, detail })
    console.log(`${passed ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
  } catch (err) {
    results.push({ name, passed: false, detail: String(err) })
    console.log(`✗ ${name} — ${err}`)
  }
}

async function main() {
  console.log('═'.repeat(60))
  console.log('  Failure Scenarios Test')
  console.log('═'.repeat(60))
  console.log(`Base URL: ${BASE_URL}`)
  console.log('')

  const token = await login('admin', 'test1234')
  if (!token) {
    console.error('❌ Cannot login as admin')
    process.exit(1)
  }

  // ── Test 1: No token → 401 ──
  await test(
    'GET /api/devices without token → 401',
    async () => {
      const res = await apiCall('GET', '/api/devices', null)
      return res.status === 401
    },
  )

  // ── Test 2: Invalid token → 401 ──
  await test(
    'GET /api/devices with invalid token → 401',
    async () => {
      const res = await apiCall('GET', '/api/devices', 'invalid-token-xxx')
      return res.status === 401
    },
  )

  // ── Test 3: Non-existent device → 404 ──
  await test(
    'GET /api/devices/nonexistent-id → 404',
    async () => {
      const res = await apiCall('GET', '/api/devices/nonexistent-id-xxx', token)
      return res.status === 404 || res.status === 400
    },
  )

  // ── Test 4: Create device without required fields → 400 ──
  await test(
    'POST /api/devices with empty body → 400',
    async () => {
      const res = await apiCall('POST', '/api/devices', token, {})
      return res.status === 400 || res.status === 422
    },
  )

  // ── Test 5: Setup Run PATCH with invalid status transition → 422 ──
  await test(
    'PATCH /api/setup/runs/[id] with invalid status transition → 422',
    async () => {
      // First create a run
      const createRes = await apiCall('POST', '/api/setup/runs', token, {})
      const runId = createRes.body?.run?.id
      if (!runId) return false

      // Try to transition from IN_PROGRESS to FAILED (valid) then to COMPLETED (invalid — terminal)
      await apiCall('PATCH', `/api/setup/runs/${runId}`, token, { status: 'CANCELLED' })

      // Now try to transition CANCELLED → COMPLETED (should fail — terminal state)
      const res = await apiCall('PATCH', `/api/setup/runs/${runId}`, token, { status: 'COMPLETED' })
      return res.status === 422
    },
  )

  // ── Test 6: Setup Run PATCH with wrong expectedVersion → 409 ──
  await test(
    'PATCH /api/setup/runs/[id] with wrong expectedVersion → 409',
    async () => {
      const createRes = await apiCall('POST', '/api/setup/runs', token, {})
      const runId = createRes.body?.run?.id
      if (!runId) return false

      // Use wrong version (999) — should get 409 VERSION_CONFLICT
      const res = await apiCall('PATCH', `/api/setup/runs/${runId}`, token, {
        status: 'COMPLETED',
        expectedVersion: 999,
      })
      return res.status === 409
    },
  )

  // ── Test 7: Sync push to non-existent node → 404 ──
  await test(
    'POST /api/sync/push with non-existent node → 404',
    async () => {
      const res = await apiCall('POST', '/api/sync/push', token, {
        nodeId: 'non-existent-node',
        changes: [],
      })
      return res.status === 404
    },
  )

  // ── Test 8: Sync push with append-only UPDATE to StockTransaction → REJECTED ──
  await test(
    'Sync push UPDATE to StockTransaction → REJECTED (append-only)',
    async () => {
      // Register a node first
      const nodeRes = await apiCall('POST', '/api/sync/nodes/register', token, {
        nodeType: 'LAN',
      })
      const nodeId = nodeRes.body?.nodeId
      if (!nodeId) return false

      // Try to push an UPDATE to a StockTransaction (should be rejected)
      const res = await apiCall('POST', '/api/sync/push', token, {
        nodeId,
        changes: [{
          idempotencyKey: 'test-append-only-1',
          entityType: 'StockTransaction',
          entityId: 'nonexistent',
          operation: 'UPDATE',
          baseVersion: 1,
          payload: { quantity: 999 },
        }],
      })
      // Should return 200 with the change in 'failed' array
      if (res.status !== 200) return false
      const failed = res.body?.failed || []
      return failed.some((f: { error?: string }) => f.error?.includes('append-only'))
    },
  )

  // ── Test 9: Health endpoint works ──
  await test(
    'GET /api/health → 200',
    async () => {
      const res = await apiCall('GET', '/api/health', null)
      return res.status === 200
    },
  )

  // ── Test 10: Health endpoint doesn't leak error details ──
  await test(
    'GET /api/health response has no "detail" field (no leak)',
    async () => {
      const res = await apiCall('GET', '/api/health', null)
      if (res.status !== 200) return false
      // Response should NOT have a "detail" field (security fix)
      const services = res.body?.services || []
      return services.every((s: { detail?: string }) => s.detail === undefined)
    },
  )

  // ── Summary ──
  console.log('')
  console.log('═'.repeat(60))
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  console.log(`  Results: ${passed} passed, ${failed} failed (${results.length} total)`)
  console.log('═'.repeat(60))

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
