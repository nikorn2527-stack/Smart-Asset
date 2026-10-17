/**
 * Authorization Matrix Tests
 *
 * Task ID: PHASE1-AUTH-MATRIX-TESTS
 *
 * Tests the authorization context for the following scenarios:
 *   1. superadmin → all sites, all permissions
 *   2. single-Site admin → only their Site
 *   3. multi-Site admin → only their Sites
 *   4. viewer → read-only permissions
 *   5. expired grant → no access (treated as no grant)
 *   6. no grant (non-superadmin) → no access (fail-closed)
 *   7. cross-Site denial → cannot access Site outside scope
 *
 * Run with: npx tsx tests/auth/authorization-matrix.test.ts
 *
 * These tests use the actual database (SQLite in sandbox) with
 * test users created in setUp and cleaned up in tearDown.
 */

import { db } from '../../src/lib/db'
import {
  buildAuthorizationContext,
  getAuthzMigrationMode,
} from '../../src/lib/authorization-context'
import { hashNewPassword } from '../../src/lib/auth'
import type { AuthUser } from '../../src/lib/auth-shared'
import { normalizeSiteCode } from '../../src/lib/site-scope'

// ── Test helpers ──────────────────────────────────────
interface TestUser {
  id: string
  email: string
  authUser: AuthUser
  cleanup: () => Promise<void>
}

let testCounter = 0
function testEmail(): string {
  testCounter++
  return `test-authz-${Date.now()}-${testCounter}@itam-test.local`
}

async function createTestUser(opts: {
  role: string
  allowedSites?: string | null
  permissions?: string[]
  grants?: Array<{ siteCode: string; roleCode: string; active?: boolean; validFrom?: Date; validUntil?: Date }>
}): Promise<TestUser> {
  const email = testEmail()
  const { hash, salt } = hashNewPassword('test-pass-123')
  const user = await db.user.create({
    data: {
      email,
      username: `testuser${testCounter}`,
      name: `Test User ${testCounter}`,
      role: opts.role,
      allowedSites: opts.allowedSites ?? null,
      passwordHash: hash,
      passwordSalt: salt,
      active: true,
      permissions: opts.permissions ? JSON.stringify(opts.permissions) : null,
    },
  })

  // Create grants if specified
  if (opts.grants) {
    for (const g of opts.grants) {
      // Ensure the Site exists
      const existingSite = await db.site.findUnique({ where: { code: g.siteCode } })
      if (!existingSite) {
        await db.site.create({
          data: { code: g.siteCode, name: `Test Site ${g.siteCode}` },
        })
      }
      await db.userSiteGrant.create({
        data: {
          userId: user.id,
          siteCode: g.siteCode,
          roleCode: g.roleCode,
          active: g.active ?? true,
          validFrom: g.validFrom ?? null,
          validUntil: g.validUntil ?? null,
          createdBy: 'test-setup',
        },
      })
    }
  }

  const authUser: AuthUser = {
    email,
    role: opts.role as AuthUser['role'],
    name: user.name,
    username: user.username,
    allowedSites: (opts.allowedSites ?? '') as string | 'ALL',
    permissions: (opts.permissions ?? []) as AuthUser['permissions'],
    isDemo: false,
  }

  return {
    id: user.id,
    email,
    authUser,
    cleanup: async () => {
      await db.userSiteGrant.deleteMany({ where: { userId: user.id } }).catch(() => {})
      await db.user.delete({ where: { id: user.id } }).catch(() => {})
    },
  }
}

// ── Test runner ───────────────────────────────────────
let passed = 0
let failed = 0
const failures: string[] = []

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++
    console.log(`  ✓ ${message}`)
  } else {
    failed++
    failures.push(message)
    console.log(`  ✗ ${message}`)
  }
}

async function runTests() {
  console.log('=== Authorization Matrix Tests ===')
  console.log(`Migration mode: ${getAuthzMigrationMode()}`)
  console.log('')

  // ── Test 1: superadmin → all sites, all permissions ──
  console.log('Test 1: superadmin → all sites, all permissions')
  {
    const u = await createTestUser({ role: 'superadmin', allowedSites: 'ALL' })
    try {
      const ctx = await buildAuthorizationContext(u.authUser, u.id, 'ALL')
      assert(ctx.isSuperAdmin === true, 'isSuperAdmin should be true')
      assert(ctx.siteScope.kind === 'all', 'siteScope should be "all"')
      assert(ctx.can('VIEW_DASHBOARD'), 'should have VIEW_DASHBOARD')
      assert(ctx.can('USER_MANAGE'), 'should have USER_MANAGE')
      assert(ctx.can('DEVICE_EDIT'), 'should have DEVICE_EDIT')
      assert(ctx.canAccessSite('UDH'), 'should access UDH')
      assert(ctx.canAccessSite('NKP'), 'should access NKP')
      assert(ctx.canAccessSite('ANYTHING'), 'should access any Site')
      assert(ctx.siteWhere() === undefined || Object.keys(ctx.siteWhere()).length === 0, 'siteWhere should be empty (all sites)')
    } finally {
      await u.cleanup()
    }
  }
  console.log('')

  // ── Test 2: single-Site admin → only their Site ──
  console.log('Test 2: single-Site admin → only their Site')
  {
    const u = await createTestUser({
      role: 'admin',
      grants: [{ siteCode: 'UDH', roleCode: 'admin' }],
    })
    try {
      const ctx = await buildAuthorizationContext(u.authUser, u.id, null)
      assert(!ctx.isSuperAdmin, 'should not be superadmin')
      assert(ctx.siteScope.kind === 'sites', 'siteScope should be "sites"')
      assert(ctx.siteScope.siteCodes.includes('UDH'), 'should include UDH')
      assert(ctx.siteScope.siteCodes.length === 1, 'should have exactly 1 Site')
      assert(ctx.canAccessSite('UDH'), 'should access UDH')
      assert(!ctx.canAccessSite('NKP'), 'should NOT access NKP')
      assert(!ctx.canAccessSite(null), 'should NOT access null Site')
      assert(ctx.can('DEVICE_EDIT'), 'should have DEVICE_EDIT (from admin role)')
      assert(ctx.can('WO_ASSIGN'), 'should have WO_ASSIGN')
    } finally {
      await u.cleanup()
    }
  }
  console.log('')

  // ── Test 3: multi-Site admin → only their Sites ──
  console.log('Test 3: multi-Site admin → only their Sites')
  {
    const u = await createTestUser({
      role: 'admin',
      grants: [
        { siteCode: 'UDH', roleCode: 'admin' },
        { siteCode: 'NKP', roleCode: 'viewer' },
      ],
    })
    try {
      const ctx = await buildAuthorizationContext(u.authUser, u.id, null)
      assert(ctx.siteScope.kind === 'sites', 'siteScope should be "sites"')
      assert(ctx.siteScope.siteCodes.length === 2, 'should have 2 Sites')
      assert(ctx.canAccessSite('UDH'), 'should access UDH')
      assert(ctx.canAccessSite('NKP'), 'should access NKP')
      assert(!ctx.canAccessSite('PPIT'), 'should NOT access PPIT')
      // Effective permissions should include both admin and viewer perms
      assert(ctx.can('DEVICE_EDIT'), 'should have DEVICE_EDIT (from UDH admin)')
      assert(ctx.can('VIEW_DASHBOARD'), 'should have VIEW_DASHBOARD (from both)')
    } finally {
      await u.cleanup()
    }
  }
  console.log('')

  // ── Test 4: viewer → read-only permissions ──
  console.log('Test 4: viewer → read-only permissions')
  {
    const u = await createTestUser({
      role: 'viewer',
      grants: [{ siteCode: 'UDH', roleCode: 'viewer' }],
    })
    try {
      const ctx = await buildAuthorizationContext(u.authUser, u.id, null)
      assert(ctx.can('VIEW_DASHBOARD'), 'should have VIEW_DASHBOARD')
      assert(ctx.can('VIEW_DEVICES'), 'should have VIEW_DEVICES')
      assert(!ctx.can('DEVICE_EDIT'), 'should NOT have DEVICE_EDIT')
      assert(!ctx.can('DEVICE_DELETE'), 'should NOT have DEVICE_DELETE')
      assert(!ctx.can('WO_ASSIGN'), 'should NOT have WO_ASSIGN')
      assert(!ctx.can('STOCK_APPROVE'), 'should NOT have STOCK_APPROVE')
      assert(ctx.canAccessSite('UDH'), 'should access UDH')
    } finally {
      await u.cleanup()
    }
  }
  console.log('')

  // ── Test 5: expired grant → no access ──
  console.log('Test 5: expired grant → no access')
  {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000) // yesterday
    const u = await createTestUser({
      role: 'admin',
      grants: [
        { siteCode: 'UDH', roleCode: 'admin', validUntil: pastDate },
      ],
    })
    try {
      const ctx = await buildAuthorizationContext(u.authUser, u.id, null)
      // Expired grant should not count
      assert(ctx.siteScope.kind === 'none', 'siteScope should be "none" (expired grant)')
      assert(!ctx.canAccessSite('UDH'), 'should NOT access UDH (expired)')
      assert(ctx.siteScope.siteCodes.length === 0, 'should have 0 Sites')
    } finally {
      await u.cleanup()
    }
  }
  console.log('')

  // ── Test 6: no grant (non-superadmin) → fail-closed ──
  console.log('Test 6: no grant (non-superadmin) → fail-closed')
  {
    const u = await createTestUser({
      role: 'viewer',
      allowedSites: null, // no allowedSites, no grants
    })
    try {
      const ctx = await buildAuthorizationContext(u.authUser, u.id, null)
      // In dual_read mode with no allowedSites, should be fail-closed
      if (getAuthzMigrationMode() === 'strict') {
        assert(ctx.siteScope.kind === 'none', 'strict mode: should be "none"')
        assert(!ctx.canAccessSite('UDH'), 'strict mode: should NOT access any Site')
      } else {
        // dual_read mode: empty allowedSites → no sites (fail-closed after fix)
        assert(ctx.siteScope.kind === 'none', 'dual_read: empty allowedSites should be "none"')
        assert(!ctx.canAccessSite('UDH'), 'dual_read: should NOT access UDH')
      }
    } finally {
      await u.cleanup()
    }
  }
  console.log('')

  // ── Test 7: cross-Site denial ──
  console.log('Test 7: cross-Site denial')
  {
    const u = await createTestUser({
      role: 'admin',
      grants: [{ siteCode: 'UDH', roleCode: 'admin' }],
    })
    try {
      const ctx = await buildAuthorizationContext(u.authUser, u.id, null)
      assert(ctx.canAccessSite('UDH'), 'should access UDH (in scope)')
      assert(!ctx.canAccessSite('NKP'), 'should NOT access NKP (cross-Site)')
      assert(!ctx.canAccessSite('PPIT'), 'should NOT access PPIT (cross-Site)')
      assert(!ctx.canAccessSite(''), 'should NOT access empty string')
      assert(!ctx.canAccessSite(null), 'should NOT access null')
      assert(!ctx.canAccessSite(undefined), 'should NOT access undefined')
      // siteWhere should filter to UDH only
      const where = ctx.siteWhere()
      assert('site' in where, 'siteWhere should have site field')
      const siteFilter = (where as Record<string, unknown>).site as Record<string, unknown>
      assert(Array.isArray(siteFilter.in), 'siteWhere should use in: [...]')
      assert((siteFilter.in as string[]).includes('UDH'), 'siteWhere should include UDH')
      assert((siteFilter.in as string[]).length === 1, 'siteWhere should have exactly 1 Site')
    } finally {
      await u.cleanup()
    }
  }
  console.log('')

  // ── Test 8: future grant (not yet valid) → no access ──
  console.log('Test 8: future grant (not yet valid) → no access')
  {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // next week
    const u = await createTestUser({
      role: 'admin',
      grants: [
        { siteCode: 'UDH', roleCode: 'admin', validFrom: futureDate },
      ],
    })
    try {
      const ctx = await buildAuthorizationContext(u.authUser, u.id, null)
      assert(ctx.siteScope.kind === 'none', 'siteScope should be "none" (future grant)')
      assert(!ctx.canAccessSite('UDH'), 'should NOT access UDH (not yet valid)')
    } finally {
      await u.cleanup()
    }
  }
  console.log('')

  // ── Test 9: inactive grant → no access ──
  console.log('Test 9: inactive grant → no access')
  {
    const u = await createTestUser({
      role: 'admin',
      grants: [
        { siteCode: 'UDH', roleCode: 'admin', active: false },
      ],
    })
    try {
      const ctx = await buildAuthorizationContext(u.authUser, u.id, null)
      assert(ctx.siteScope.kind === 'none', 'siteScope should be "none" (inactive grant)')
      assert(!ctx.canAccessSite('UDH'), 'should NOT access UDH (inactive)')
    } finally {
      await u.cleanup()
    }
  }
  console.log('')

  // ── Test 10: roleAtSite returns correct role ──
  console.log('Test 10: roleAtSite returns correct role')
  {
    const u = await createTestUser({
      role: 'admin',
      grants: [
        { siteCode: 'UDH', roleCode: 'admin' },
        { siteCode: 'NKP', roleCode: 'viewer' },
      ],
    })
    try {
      const ctx = await buildAuthorizationContext(u.authUser, u.id, null)
      assert(ctx.roleAtSite('UDH') === 'admin', 'roleAtSite(UDH) should be admin')
      assert(ctx.roleAtSite('NKP') === 'viewer', 'roleAtSite(NKP) should be viewer')
      assert(ctx.roleAtSite('PPIT') === null, 'roleAtSite(PPIT) should be null (not in scope)')
      assert(ctx.roleAtSite(null) === null, 'roleAtSite(null) should be null')
    } finally {
      await u.cleanup()
    }
  }
  console.log('')

  // ── Test 11: canAtSite prevents privilege escalation via union ──
  // User has admin role at UDH (which grants DEVICE_EDIT) and viewer
  // role at NKP (which does NOT grant DEVICE_EDIT). The effective
  // permissions UNION includes DEVICE_EDIT (because UDH admin has it),
  // so ctx.can('DEVICE_EDIT') returns true. But ctx.canAtSite('NKP',
  // 'DEVICE_EDIT') must return FALSE — the user's role AT NKP is
  // viewer, which doesn't grant DEVICE_EDIT.
  //
  // This is the core security guarantee of the audit round-2 fixes:
  // routes must use canAtSite() for Site-scoped action decisions, not
  // the union `can()`.
  console.log('Test 11: canAtSite prevents privilege escalation (UDH=admin, NKP=viewer)')
  {
    const u = await createTestUser({
      role: 'admin',
      grants: [
        { siteCode: 'UDH', roleCode: 'admin' },
        { siteCode: 'NKP', roleCode: 'viewer' },
      ],
    })
    try {
      const ctx = await buildAuthorizationContext(u.authUser, u.id, null)
      // canAtSite at UDH (admin) → DEVICE_EDIT allowed
      assert(
        ctx.canAtSite('UDH', 'DEVICE_EDIT') === true,
        'canAtSite(UDH, DEVICE_EDIT) should be true (admin role)',
      )
      // canAtSite at NKP (viewer) → DEVICE_EDIT DENIED
      assert(
        ctx.canAtSite('NKP', 'DEVICE_EDIT') === false,
        'canAtSite(NKP, DEVICE_EDIT) should be FALSE (viewer role — prevents escalation)',
      )
      // can (union) returns true — but routes should NOT use this for
      // action decisions. This assertion documents the danger so a
      // future refactor doesn't accidentally "fix" can() and weaken
      // the contract.
      assert(
        ctx.can('DEVICE_EDIT') === true,
        'can(DEVICE_EDIT) returns true (union — but should NOT be used for action decisions)',
      )
      // Sanity: WO_CREATE is in admin role but NOT in viewer role
      assert(
        ctx.canAtSite('UDH', 'WO_CREATE') === true,
        'canAtSite(UDH, WO_CREATE) should be true',
      )
      assert(
        ctx.canAtSite('NKP', 'WO_CREATE') === false,
        'canAtSite(NKP, WO_CREATE) should be FALSE (viewer has no WO_CREATE)',
      )
    } finally {
      await u.cleanup()
    }
  }
  console.log('')

  // ── Test 12: permissionsAtSite returns only that Site's permissions ──
  // For the same UDH=admin/NKP=viewer user, permissionsAtSite('UDH')
  // should return admin's permission set (incl. DEVICE_EDIT, WO_ASSIGN),
  // while permissionsAtSite('NKP') should return viewer's set (no
  // DEVICE_EDIT, no WO_ASSIGN). The union should be larger than either.
  console.log('Test 12: permissionsAtSite returns only that Site\'s permissions')
  {
    const u = await createTestUser({
      role: 'admin',
      grants: [
        { siteCode: 'UDH', roleCode: 'admin' },
        { siteCode: 'NKP', roleCode: 'viewer' },
      ],
    })
    try {
      const ctx = await buildAuthorizationContext(u.authUser, u.id, null)
      const udhPerms = ctx.permissionsAtSite('UDH')
      const nkpPerms = ctx.permissionsAtSite('NKP')
      // UDH (admin) has DEVICE_EDIT and WO_ASSIGN
      assert(
        udhPerms.includes('DEVICE_EDIT'),
        'permissionsAtSite(UDH) should include DEVICE_EDIT',
      )
      assert(
        udhPerms.includes('WO_ASSIGN'),
        'permissionsAtSite(UDH) should include WO_ASSIGN',
      )
      // NKP (viewer) does NOT have DEVICE_EDIT or WO_ASSIGN
      assert(
        !nkpPerms.includes('DEVICE_EDIT'),
        'permissionsAtSite(NKP) should NOT include DEVICE_EDIT',
      )
      assert(
        !nkpPerms.includes('WO_ASSIGN'),
        'permissionsAtSite(NKP) should NOT include WO_ASSIGN',
      )
      // Both should include VIEW_DASHBOARD (it's in both admin and viewer roles)
      assert(
        udhPerms.includes('VIEW_DASHBOARD'),
        'permissionsAtSite(UDH) should include VIEW_DASHBOARD',
      )
      assert(
        nkpPerms.includes('VIEW_DASHBOARD'),
        'permissionsAtSite(NKP) should include VIEW_DASHBOARD',
      )
      // Out-of-scope Site → empty array
      assert(
        ctx.permissionsAtSite('PPIT').length === 0,
        'permissionsAtSite(PPIT) should be empty (out of scope)',
      )
    } finally {
      await u.cleanup()
    }
  }
  console.log('')

  // ── Test 13: canAtSite with null/undefined/out-of-scope returns false ──
  // canAtSite must never throw on bad input. It must return false for:
  //   • null siteCode
  //   • undefined siteCode
  //   • empty string
  //   • out-of-scope Site codes
  //   • lowercase / mixed-case (normalization handles this)
  console.log('Test 13: canAtSite rejects null/undefined/out-of-scope siteCode')
  {
    const u = await createTestUser({
      role: 'admin',
      grants: [{ siteCode: 'UDH', roleCode: 'admin' }],
    })
    try {
      const ctx = await buildAuthorizationContext(u.authUser, u.id, null)
      // Bad inputs → false (never throw)
      assert(ctx.canAtSite(null, 'DEVICE_EDIT') === false, 'canAtSite(null, ...) should be false')
      assert(ctx.canAtSite(undefined, 'DEVICE_EDIT') === false, 'canAtSite(undefined, ...) should be false')
      assert(ctx.canAtSite('', 'DEVICE_EDIT') === false, 'canAtSite("", ...) should be false')
      // Out-of-scope Site → false
      assert(ctx.canAtSite('NKP', 'DEVICE_EDIT') === false, 'canAtSite(NKP, ...) should be false (out of scope)')
      assert(ctx.canAtSite('PPIT', 'DEVICE_EDIT') === false, 'canAtSite(PPIT, ...) should be false (out of scope)')
      // Lowercase / mixed-case is normalized — UDH admin grant matches 'udh' too
      assert(ctx.canAtSite('udh', 'DEVICE_EDIT') === true, 'canAtSite(udh, ...) should be true (case-insensitive)')
      assert(ctx.canAtSite('UdH', 'DEVICE_EDIT') === true, 'canAtSite(UdH, ...) should be true (case-insensitive)')
      // Even superadmin-style permission at out-of-scope Site is denied
      assert(ctx.canAtSite('NKP', 'VIEW_DASHBOARD') === false, 'canAtSite(NKP, VIEW_DASHBOARD) should be false (no grant at NKP)')
    } finally {
      await u.cleanup()
    }
  }
  console.log('')

  // ── Test 14: (INTEGRATION) Images route — UDH=admin, NKP=viewer cannot
  //    GET/POST/DELETE images on an NKP Work Order ──
  //
  // NOTE: This is an integration test scenario. It documents the expected
  // HTTP behaviour of /api/work-orders/[id]/images after Task ID
  // RESIDUAL-BLOCKERS-ROUND-4. It requires a running dev server (with
  // the DB seeded) and real login tokens. Run manually with:
  //
  //   RUN_INTEGRATION=1 npx tsx tests/auth/authorization-matrix.test.ts
  //
  // Setup:
  //   const u = await createTestUser({
  //     role: 'admin',
  //     grants: [
  //       { siteCode: 'UDH', roleCode: 'admin' },
  //       { siteCode: 'NKP', roleCode: 'viewer' },
  //     ],
  //   })
  //   // Create a Work Order at NKP (siteCode='NKP' or device.site='NKP')
  //   // Login as u, get a JWT token.
  //
  // Expected behaviour (the assertions the integration test would make):
  //   • GET    /api/work-orders/{nkpWoId}/images  → 404 (not 403 — hides existence)
  //     Reason: loadAuthorizedWorkOrder calls ctx.canAtSite('NKP', 'WO_VIEW_ALL')
  //     which returns FALSE because the user's NKP role is viewer (no WO_VIEW_ALL).
  //     allowOwn:true is set, but the WO isn't theirs (different reporter).
  //   • POST   /api/work-orders/{nkpWoId}/images  → 404
  //     Reason: loadAuthorizedWorkOrder(req, id, 'WO_ASSIGN') — NKP viewer
  //     has no WO_ASSIGN at NKP. No allowOwn for POST.
  //   • DELETE /api/work-orders/{nkpWoId}/images?imageId=... → 404
  //     Reason: same as POST — WO_ASSIGN required at NKP, viewer lacks it.
  //
  //   Contrast: a UDH WO should return 200/201 for the same user (UDH admin
  //   has WO_VIEW_ALL + WO_ASSIGN at UDH).
  //
  // The unit-level guarantee that backs these integration assertions is
  // already covered by Test 11 (canAtSite prevents escalation). We add
  // this scenario here so the contract is documented end-to-end.
  console.log('Test 14: (INTEGRATION) Images route — UDH=admin, NKP=viewer cannot access NKP WO images')
  console.log('  [skipped] Requires running server + seeded DB. See comment for expected behaviour.')
  console.log('')

  // ── Test 15: (INTEGRATION) Print route — UDH=admin, NKP=viewer cannot
  //    print an NKP Work Order ──
  //
  // NOTE: Integration test scenario. Same setup as Test 14.
  //
  // Expected behaviour:
  //   • GET /api/work-orders/{nkpWoId}/print?paper=a4-portrait
  //       → 404 with Content-Type text/html, body '<h1>ไม่พบใบงาน</h1>'
  //     Reason: loadAuthorizedWorkOrder(req, id, 'WO_VIEW_ALL', { allowOwn: true })
  //     calls ctx.canAtSite('NKP', 'WO_VIEW_ALL') — NKP viewer lacks it.
  //     This is the core RESIDUAL-BLOCKERS-ROUND-4 fix: the previous
  //     implementation used ctx.can('WO_VIEW_ALL') (the UNION — true
  //     because UDH admin has it) + ctx.canAccessSite('NKP') (true
  //     because the user has any grant at NKP), so the print route
  //     would have returned the WO HTML to an unauthorized user.
  //   • GET /api/work-orders/{udhWoId}/print → 200 text/html (UDH admin)
  console.log('Test 15: (INTEGRATION) Print route — UDH=admin, NKP=viewer cannot print NKP WO')
  console.log('  [skipped] Requires running server + seeded DB. See comment for expected behaviour.')
  console.log('')

  // ── Test 16: (INTEGRATION) edit-unlock — non-admin cannot unlock;
  //    admin at UDH cannot unlock an NKP Work Order ──
  //
  // NOTE: Integration test scenario.
  //
  // Setup:
  //   - User A: UDH admin only (no NKP grant)
  //   - User B: viewer at UDH (no WO_ASSIGN anywhere)
  //   - Work Order at NKP, status=COMPLETED (so it's eligible for edit-unlock)
  //
  // Expected behaviour:
  //   • POST /api/work-orders/{nkpWoId}/edit-unlock  (as User A)
  //       → 404
  //     Reason: loadAuthorizedWorkOrder(req, id, 'WO_ASSIGN') calls
  //     ctx.canAtSite('NKP', 'WO_ASSIGN') — User A has no grant at NKP.
  //     Previously: requireAuth(req, 'ADMIN') returned true (User A is
  //     admin globally) and there was NO Site check at all → User A
  //     could unlock (and then edit) any WO in the system. This is
  //     fixed.
  //   • POST /api/work-orders/{udhWoId}/edit-unlock  (as User B, viewer)
  //       → 404 (or 403 if the WO exists and User B has view access)
  //     Reason: viewer role has no WO_ASSIGN anywhere — canAtSite returns
  //     false at every Site.
  console.log('Test 16: (INTEGRATION) edit-unlock — non-admin + cross-Site admin blocked')
  console.log('  [skipped] Requires running server + seeded DB. See comment for expected behaviour.')
  console.log('')

  // ── Test 17: (INTEGRATION) WO PUT — cannot change deviceId to a device
  //    at a different Site without WO_ASSIGN at BOTH Sites ──
  //
  // NOTE: Integration test scenario.
  //
  // Setup:
  //   - User A: UDH admin only (has WO_ASSIGN at UDH, NOT at NKP)
  //   - Work Order at UDH (siteCode='UDH', deviceId=device_udh_1)
  //   - Device device_nkp_1 at NKP
  //
  // Expected behaviour:
  //   • PUT /api/work-orders/{udhWoId}  body: { deviceId: 'device_nkp_1' }  (as User A)
  //       → 403 with body:
  //         { error: 'ไม่สามารถเปลี่ยนอุปกรณ์เป็นอุปกรณ์จากสาขาอื่นได้ — ต้องมีสิทธิ์ WO_ASSIGN ทั้งที่สาขาเดิม (UDH) และสาขาใหม่ (NKP)' }
  //     Reason: loadAuthorizedWorkOrder succeeds (User A has WO_ASSIGN at
  //     UDH, the WO's current Site). But the cross-Site deviceId check
  //     detects that newDeviceSite='NKP' !== oldWoSite='UDH', and
  //     requires canAtSite('NKP', 'WO_ASSIGN') — which is FALSE for
  //     User A. Previously: the route would have silently updated
  //     deviceId to an NKP device, leaving the WO's siteCode='UDH'
  //     but its device at NKP — a Site-scope inconsistency that
  //     would later confuse every Site-scoped query.
  //   • PUT /api/work-orders/{udhWoId}  body: { deviceId: 'device_nkp_1' }
  //     (as a user with UDH=admin AND NKP=admin)
  //       → 200, and the WO's siteCode is also updated to 'NKP'.
  //     Reason: the caller has WO_ASSIGN at both Sites — the cross-Site
  //     move is permitted, and data.siteCode is set to the new Site so
  //     the WO stays consistent with its device.
  console.log('Test 17: (INTEGRATION) WO PUT — cross-Site deviceId change blocked without dual-Site WO_ASSIGN')
  console.log('  [skipped] Requires running server + seeded DB. See comment for expected behaviour.')
  console.log('')

  // ── Test 18: Legacy allowedSites='ALL' fail-closed for non-superadmin ──
  // Task ID: RESIDUAL-BLOCKERS-ROUND-4 Fix 6.
  //
  // A non-superadmin user with no UserSiteGrant rows but
  // allowedSites='ALL' (legacy data) must NOT get all-Sites access.
  // Previously the dual_read fallback returned a fail-open context
  // (siteScope: 'all', canAtSite: based on global perms). Now it
  // returns a fail-closed context: siteScope='none', canAtSite always
  // false, canAccessSite always false, siteWhere matches nothing.
  //
  // This is a UNIT test — it doesn't need a running server, just the
  // DB (to load the catalog, which can be empty since the legacy ALL
  // path doesn't consult the catalog).
  console.log('Test 18: Legacy allowedSites=\'ALL\' fail-closed for non-superadmin')
  {
    // Skip if the env var opts into the legacy fail-open path.
    if (process.env.AUTHZ_LEGACY_ALL_FAIL_OPEN === '1') {
      console.log('  [skipped] AUTHZ_LEGACY_ALL_FAIL_OPEN=1 — legacy fail-open is active')
    } else {
      const u = await createTestUser({
        role: 'admin',
        allowedSites: 'ALL', // legacy ALL, no UserSiteGrant rows
      })
      try {
        const ctx = await buildAuthorizationContext(u.authUser, u.id, 'ALL')
        assert(!ctx.isSuperAdmin, 'should NOT be superadmin')
        assert(ctx.usedLegacyFallback === true, 'should mark legacy fallback used')
        // Site scope must be 'none' (fail-closed), NOT 'all'
        assert(
          ctx.siteScope.kind === 'none',
          'siteScope should be "none" (fail-closed) — NOT "all"',
        )
        assert(
          ctx.siteScope.siteCodes.length === 0,
          'siteScope.siteCodes should be empty',
        )
        // canAccessSite must be false everywhere
        assert(!ctx.canAccessSite('UDH'), 'should NOT access UDH (fail-closed)')
        assert(!ctx.canAccessSite('NKP'), 'should NOT access NKP (fail-closed)')
        assert(!ctx.canAccessSite('ANYTHING'), 'should NOT access any Site')
        // canAtSite must be false everywhere, even for VIEW_DASHBOARD
        // (which admin role would normally have)
        assert(!ctx.canAtSite('UDH', 'VIEW_DASHBOARD'), 'canAtSite(UDH, VIEW_DASHBOARD) should be false')
        assert(!ctx.canAtSite('NKP', 'DEVICE_EDIT'), 'canAtSite(NKP, DEVICE_EDIT) should be false')
        // The union `can()` is also false — the user has no effective
        // permissions in the fail-closed context.
        assert(!ctx.can('VIEW_DASHBOARD'), 'can(VIEW_DASHBOARD) should be false (no effective perms)')
        assert(!ctx.can('DEVICE_EDIT'), 'can(DEVICE_EDIT) should be false')
        // siteWhere must match nothing
        const where = ctx.siteWhere()
        assert('site' in where, 'siteWhere should have site field')
        const siteFilter = (where as Record<string, unknown>).site as Record<string, unknown>
        assert(
          Array.isArray(siteFilter.in) && siteFilter.in.length === 0,
          'siteWhere should be { site: { in: [] } } (matches nothing)',
        )
      } finally {
        await u.cleanup()
      }
    }
  }
  console.log('')


  // ── Summary ──
  console.log('=== Summary ===')
  console.log(`Passed: ${passed}`)
  console.log(`Failed: ${failed}`)
  if (failures.length > 0) {
    console.log('')
    console.log('Failures:')
    for (const f of failures) {
      console.log(`  - ${f}`)
    }
    process.exit(1)
  } else {
    console.log('')
    console.log('All tests passed! ✅')
    process.exit(0)
  }
}

runTests()
  .catch((e) => {
    console.error('Test runner failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
