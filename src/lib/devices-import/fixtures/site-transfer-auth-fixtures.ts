// ============================================================
// Devices Import — Site/transfer authorization fixtures (pure)
// ============================================================
// Module: Devices (Dev-3 / Asset & Meter Team)
// Work Package: C — parallel preparation
//
// Purpose: fixtures for site/transfer authorization validation.
//   - caller site scope vs target site
//   - superadmin bypass
//   - cross-site access (denied)
//   - transfer from/to site pair validation
//   - actor binding (authenticated session)
//
// These fixtures are PURE — they describe inputs + expected
// authorization decisions. The actual validation logic lives
// in the route (which uses buildAuthorizationContext from B4
// frozen authorization-context.ts). These fixtures verify the
// decision table without touching the DB or the B4 frozen layer.
//
// Governance:
//   - B4 frozen files untouched (we use the existing helper, not patch it)
//   - No SYNC_RUN permission added
//   - No schema/migration changes
// ============================================================

/**
 * Caller's authorization scope (simplified — actual type lives in
 * authorization-context.ts). We only model the fields needed for
 * site/transfer decisions.
 */
export interface CallerScope {
  isSuperAdmin: boolean
  siteCodes: string[] // empty + isSuperAdmin=false → no access
  actor: string // authenticated user identity (email)
}

/**
 * Site access decision fixture.
 */
export interface SiteAccessFixture {
  name: string
  caller: CallerScope
  targetSite: string
  expectedAllowed: boolean
  description: string
}

export const SITE_ACCESS_FIXTURES: SiteAccessFixture[] = [
  {
    name: 'superadmin can access any site',
    caller: { isSuperAdmin: true, siteCodes: [], actor: 'admin@itam.local' },
    targetSite: 'UDH',
    expectedAllowed: true,
    description: 'superadmin bypasses site scope check',
  },
  {
    name: 'non-superadmin with explicit grant — allowed',
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH', 'NKP'],
      actor: 'editor@itam.local',
    },
    targetSite: 'UDH',
    expectedAllowed: true,
    description: 'caller has grant for UDH → access allowed',
  },
  {
    name: 'non-superadmin without grant — denied',
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH'],
      actor: 'editor@itam.local',
    },
    targetSite: 'NKP',
    expectedAllowed: false,
    description: 'caller has UDH only, requests NKP → access denied',
  },
  {
    name: 'non-superadmin with empty scope — denied (fail-closed)',
    caller: {
      isSuperAdmin: false,
      siteCodes: [],
      actor: 'newuser@itam.local',
    },
    targetSite: 'UDH',
    expectedAllowed: false,
    description: 'no grants at all → fail-closed denial',
  },
  {
    name: 'case-insensitive site matching',
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH'],
      actor: 'editor@itam.local',
    },
    targetSite: 'udh',
    expectedAllowed: true,
    description: 'targetSite "udh" matches grant "UDH" (case-insensitive)',
  },
]

/**
 * Transfer authorization fixture (from-site → to-site + actor).
 */
export interface TransferAuthFixture {
  name: string
  caller: CallerScope
  fromSite: string
  toSite: string
  expectedAllowed: boolean
  expectedError?: string
  description: string
}

export const TRANSFER_AUTH_FIXTURES: TransferAuthFixture[] = [
  {
    name: 'superadmin transfer between any sites',
    caller: { isSuperAdmin: true, siteCodes: [], actor: 'admin@itam.local' },
    fromSite: 'UDH',
    toSite: 'NKP',
    expectedAllowed: true,
    description: 'superadmin can transfer between any sites',
  },
  {
    name: 'non-superadmin transfer within own site',
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH'],
      actor: 'editor@itam.local',
    },
    fromSite: 'UDH',
    toSite: 'UDH',
    expectedAllowed: true,
    description: 'transfer within own site — allowed',
  },
  {
    name: 'non-superadmin transfer to unauthorized site',
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH'],
      actor: 'editor@itam.local',
    },
    fromSite: 'UDH',
    toSite: 'NKP',
    expectedAllowed: false,
    expectedError: 'ไม่มีสิทธิ์โอนย้ายไปยังสาขา NKP',
    description: 'caller has UDH only, target is NKP → denied',
  },
  {
    name: 'non-superadmin transfer from unauthorized site',
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH'],
      actor: 'editor@itam.local',
    },
    fromSite: 'NKP',
    toSite: 'UDH',
    expectedAllowed: false,
    expectedError: 'ไม่มีสิทธิ์โอนย้ายจากสาขา NKP',
    description: 'caller has UDH only, source is NKP → denied (cannot move from unauthorized site)',
  },
  {
    name: 'actor binding required — anonymous transfer denied',
    caller: {
      isSuperAdmin: false,
      siteCodes: ['UDH'],
      actor: '', // empty actor — anonymous
    },
    fromSite: 'UDH',
    toSite: 'UDH',
    expectedAllowed: false,
    expectedError: 'transfer requires authenticated actor',
    description: 'actor must be a non-empty authenticated identity',
  },
]

/**
 * Pure helper to decide site access (testable without DB).
 * This mirrors the logic that the route does with buildAuthorizationContext
 * but in a pure, decoupled form for fixture validation.
 */
export function decideSiteAccess(
  caller: CallerScope,
  targetSite: string,
): { allowed: boolean; reason: string } {
  if (caller.isSuperAdmin) {
    return { allowed: true, reason: 'superadmin bypass' }
  }
  if (!caller.actor) {
    return { allowed: false, reason: 'actor binding required — anonymous access denied' }
  }
  if (caller.siteCodes.length === 0) {
    return { allowed: false, reason: 'fail-closed: no site grants' }
  }
  const target = targetSite.toUpperCase()
  const allowed = caller.siteCodes.some((s) => s.toUpperCase() === target)
  if (!allowed) {
    return {
      allowed: false,
      reason: `site '${targetSite}' not in caller scope [${caller.siteCodes.join(', ')}]`,
    }
  }
  return { allowed: true, reason: 'explicit grant' }
}

/**
 * Pure helper to decide transfer authorization (testable without DB).
 */
export function decideTransferAuth(
  caller: CallerScope,
  fromSite: string,
  toSite: string,
): { allowed: boolean; reason: string; error?: string } {
  if (!caller.actor) {
    return {
      allowed: false,
      reason: 'transfer requires authenticated actor',
      error: 'transfer requires authenticated actor',
    }
  }
  if (caller.isSuperAdmin) {
    return { allowed: true, reason: 'superadmin bypass' }
  }
  const from = fromSite.toUpperCase()
  const to = toSite.toUpperCase()
  const hasFrom = caller.siteCodes.some((s) => s.toUpperCase() === from)
  const hasTo = caller.siteCodes.some((s) => s.toUpperCase() === to)
  if (!hasFrom) {
    return {
      allowed: false,
      reason: `caller cannot transfer from ${fromSite} (not in scope)`,
      error: `ไม่มีสิทธิ์โอนย้ายจากสาขา ${fromSite}`,
    }
  }
  if (!hasTo) {
    return {
      allowed: false,
      reason: `caller cannot transfer to ${toSite} (not in scope)`,
      error: `ไม่มีสิทธิ์โอนย้ายไปยังสาขา ${toSite}`,
    }
  }
  return { allowed: true, reason: 'both sites in caller scope' }
}
