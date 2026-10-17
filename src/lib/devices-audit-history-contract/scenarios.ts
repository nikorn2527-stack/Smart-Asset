// ============================================================
// Devices Audit History Contract — Validation scenarios (pure)
// ============================================================
// Module: Devices (Dev-3 / Asset & Meter Team)
// Work Package: C — parallel preparation
//
// Purpose: validation scenarios for device audit history queries.
//   - AuditLog query by entity + entityId
//   - DeviceTransfer history query by deviceId
//   - Site-scoped audit query (per NF-2 fix — siteCode column)
//   - Bounded pagination for history queries
//   - Redaction of sensitive detail fields
//
// Contract under test:
//   - AuditLog.entity = 'Device', entityId = device.id
//   - AuditLog.siteCode populated for Site-scoped actions (NF-2 fix)
//   - AuditLog.detail is JSON string — may contain sensitive data
//   - DeviceTransfer.deviceId = device.id (FK)
//   - History queries must be bounded (pagination + limit)
//   - Site scope enforced on history queries
//
// Pure functions only — no DB, no I/O.
//
// Governance:
//   - B4 frozen files: NOT touched (uses logAudit helper, not patch it)
//   - SYNC_RUN permission: NOT added
//   - prisma db:push: NOT used
//   - Schema/migration: NOT changed
// ============================================================

/**
 * Audit log entry fixture (matches AuditLog schema shape).
 */
export interface AuditLogFixture {
  id: string
  action: string // CREATE | UPDATE | DELETE | TRANSFER | IMPORT | etc.
  entity: string // 'Device' | 'DeviceTransfer' | etc.
  entityId: string | null
  summary: string
  detail: string | null // JSON string
  actor: string
  siteCode: string | null
  createdAt: string // ISO datetime
}

/**
 * DeviceTransfer history entry fixture.
 */
export interface DeviceTransferFixture {
  id: string
  deviceId: string
  assetCode: string | null
  moveDate: string | null
  action: string | null // TRANSFER | TRANSFER_SITE | STATUS_CHANGE | etc.
  fromStatus: string | null
  toStatus: string | null
  fromSite: string | null
  toSite: string
  movedBy: string | null
  remark: string | null
  transferDate: string
  reason: string | null
  createdAt: string
}

/**
 * History query input.
 */
export interface HistoryQueryInput {
  deviceId: string
  page?: number
  limit?: number
  siteScope?: string[] // caller's allowed sites (empty + !isSuperAdmin = fail-closed)
  isSuperAdmin?: boolean
}

/**
 * Bounded query params (after clamping).
 */
export interface BoundedHistoryQuery {
  deviceId: string
  page: number
  limit: number
  skip: number
  siteFilter: string[] | null // null = no filter (superadmin), string[] = filter IN
}

/**
 * History query result.
 */
export interface HistoryQueryResult {
  ok: boolean
  code?: 'MISSING_DEVICE_ID' | 'SITE_SCOPE_DENIED' | 'INVALID_PAGINATION'
  auditLogs: AuditLogFixture[]
  transfers: DeviceTransferFixture[]
  page: number
  limit: number
  total: number
  totalPages: number
}

/**
 * Redacted audit log entry (sensitive detail removed).
 */
export interface RedactedAuditLog {
  id: string
  action: string
  entity: string
  entityId: string | null
  summary: string
  actor: string
  siteCode: string | null
  createdAt: string
  // detail field is REMOVED — may contain sensitive data
  // if caller needs detail, separate permission required
}

// ─── Constants ────────────────────────────────────────────────────────

export const AUDIT_HISTORY_BOUNDS = {
  MAX_LIMIT: 100, // history queries are smaller than list queries
  DEFAULT_LIMIT: 50,
  MIN_LIMIT: 1,
  MAX_PAGE: 1000,
} as const

/**
 * Audit actions relevant to Devices module.
 */
export const DEVICE_AUDIT_ACTIONS = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  TRANSFER: 'TRANSFER',
  IMPORT: 'IMPORT',
  STATUS_CHANGE: 'STATUS_CHANGE',
  LIFECYCLE: 'LIFECYCLE',
} as const

/**
 * Fields in AuditLog.detail that are considered sensitive and must be
 * redacted when returning history to non-superadmin callers.
 */
export const SENSITIVE_DETAIL_FIELDS = [
  'serialNumber',
  'ip',
  'mac',
  'remoteId',
  'contractNo',
  'vendor',
  'purchasePrice',
  'costCenter',
  'remark', // may contain PII
  'actorEmail',
  'performedBy',
] as const

// ─── Pure helpers ────────────────────────────────────────────────────

/**
 * Clamp page + limit for history queries (pure — no DB).
 */
export function clampHistoryPagination(
  page: number | undefined,
  limit: number | undefined,
): { page: number; limit: number; skip: number; valid: boolean } {
  const rawPage = Number(page ?? 1)
  const rawLimit = Number(limit ?? AUDIT_HISTORY_BOUNDS.DEFAULT_LIMIT)

  if (!Number.isFinite(rawPage) || !Number.isFinite(rawLimit)) {
    return { page: 1, limit: AUDIT_HISTORY_BOUNDS.DEFAULT_LIMIT, skip: 0, valid: false }
  }

  const safePage = Math.max(1, Math.min(AUDIT_HISTORY_BOUNDS.MAX_PAGE, Math.floor(rawPage)))
  const safeLimit = Math.max(
    AUDIT_HISTORY_BOUNDS.MIN_LIMIT,
    Math.min(AUDIT_HISTORY_BOUNDS.MAX_LIMIT, Math.floor(rawLimit)),
  )

  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
    valid: true,
  }
}

/**
 * Build site filter for history query (pure — no DB).
 *
 * Returns:
 *   - null = no filter (superadmin sees all)
 *   - string[] = filter IN these sites
 *   - empty array = fail-closed (non-superadmin with no grants)
 */
export function buildSiteFilter(
  isSuperAdmin: boolean,
  siteScope: string[] | undefined,
): string[] | null {
  if (isSuperAdmin) return null
  if (!siteScope || siteScope.length === 0) return []
  return siteScope
}

/**
 * Validate history query input (pure — no DB).
 */
export function validateHistoryQuery(
  input: HistoryQueryInput,
): { ok: boolean; code?: string; query?: BoundedHistoryQuery } {
  if (!input.deviceId?.trim()) {
    return { ok: false, code: 'MISSING_DEVICE_ID' }
  }

  const pagination = clampHistoryPagination(input.page, input.limit)
  if (!pagination.valid && (input.page !== undefined || input.limit !== undefined)) {
    // Invalid pagination — but we clamped to defaults, so continue
    // (don't fail the whole query for bad page/limit input)
  }

  const siteFilter = buildSiteFilter(input.isSuperAdmin ?? false, input.siteScope)
  if (siteFilter !== null && siteFilter.length === 0) {
    return { ok: false, code: 'SITE_SCOPE_DENIED' }
  }

  return {
    ok: true,
    query: {
      deviceId: input.deviceId,
      page: pagination.page,
      limit: pagination.limit,
      skip: pagination.skip,
      siteFilter,
    },
  }
}

/**
 * Filter audit logs by site scope (pure — no DB).
 */
export function filterAuditLogsBySite(
  logs: AuditLogFixture[],
  siteFilter: string[] | null,
): AuditLogFixture[] {
  if (siteFilter === null) return logs // superadmin — no filter
  if (siteFilter.length === 0) return [] // fail-closed
  return logs.filter((log) => {
    if (!log.siteCode) return false // no site = not visible to non-superadmin
    return siteFilter.includes(log.siteCode)
  })
}

/**
 * Redact sensitive fields from audit log detail (pure — no DB).
 *
 * Returns a new array with detail field removed for non-superadmin callers.
 */
export function redactAuditLogs(
  logs: AuditLogFixture[],
  isSuperAdmin: boolean,
): RedactedAuditLog[] {
  if (isSuperAdmin) {
    // Superadmin sees full logs but we still strip the raw detail string
    // (they can query individual log detail with separate permission if needed)
    return logs.map((log) => ({
      id: log.id,
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      summary: log.summary,
      actor: log.actor,
      siteCode: log.siteCode,
      createdAt: log.createdAt,
    }))
  }
  // Non-superadmin — redact
  return logs.map((log) => ({
    id: log.id,
    action: log.action,
    entity: log.entity,
    entityId: log.entityId,
    summary: log.summary,
    actor: log.actor,
    siteCode: log.siteCode,
    createdAt: log.createdAt,
  }))
}

/**
 * Filter device transfers by site scope (pure — no DB).
 */
export function filterTransfersBySite(
  transfers: DeviceTransferFixture[],
  siteFilter: string[] | null,
): DeviceTransferFixture[] {
  if (siteFilter === null) return transfers // superadmin
  if (siteFilter.length === 0) return [] // fail-closed
  return transfers.filter((t) => {
    // Transfer must be at a site the caller can access (fromSite OR toSite)
    const fromOk = t.fromSite ? siteFilter.includes(t.fromSite) : false
    const toOk = siteFilter.includes(t.toSite)
    return fromOk || toOk
  })
}

/**
 * Build final history query result (pure — no DB).
 *
 * Combines audit logs + transfers, applies site filter + redaction,
 * paginates, and returns the result.
 */
export function buildHistoryResult(
  auditLogs: AuditLogFixture[],
  transfers: DeviceTransferFixture[],
  query: BoundedHistoryQuery,
  isSuperAdmin: boolean,
): HistoryQueryResult {
  const filteredLogs = filterAuditLogsBySite(auditLogs, query.siteFilter)
  const filteredTransfers = filterTransfersBySite(transfers, query.siteFilter)

  // Sort by createdAt desc
  const sortedLogs = [...filteredLogs].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
  const sortedTransfers = [...filteredTransfers].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )

  // Paginate
  const total = sortedLogs.length + sortedTransfers.length
  const start = query.skip
  const end = start + query.limit

  // Interleave: take from both arrays proportionally
  // Simple approach: take logs first, then transfers
  const paginatedLogs = sortedLogs.slice(
    Math.max(0, start - sortedTransfers.length),
    Math.max(0, end - sortedTransfers.length),
  )
  const paginatedTransfers = sortedTransfers.slice(
    Math.max(0, start - sortedLogs.length),
    Math.max(0, end - sortedLogs.length),
  )

  const redactedLogs = redactAuditLogs(paginatedLogs, isSuperAdmin)

  return {
    ok: true,
    // ── Return REDACTED logs, not raw paginatedLogs ────────────────
    // Audit (ITAM-02) REQUEST CHANGES: buildHistoryResult computed
    // redactedLogs but returned auditLogs: paginatedLogs (raw),
    // exposing raw detail to callers. Fix: return redactedLogs.
    auditLogs: redactedLogs as unknown as AuditLogFixture[],
    transfers: paginatedTransfers,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit),
  }
}

// ─── Scenario fixtures ───────────────────────────────────────────────

export interface AuditHistoryScenario {
  name: string
  description: string
  input: HistoryQueryInput
  auditLogs: AuditLogFixture[]
  transfers: DeviceTransferFixture[]
  expected: {
    ok: boolean
    code?: string
    totalLogs?: number
    totalTransfers?: number
    redacted?: boolean
  }
}

export const AUDIT_HISTORY_SCENARIOS: AuditHistoryScenario[] = [
  {
    name: 'superadmin sees all audit logs + transfers',
    description:
      'Superadmin queries device history — sees all logs regardless of siteCode.',
    input: {
      deviceId: 'dev-001',
      isSuperAdmin: true,
      page: 1,
      limit: 50,
    },
    auditLogs: [
      {
        id: 'log-1',
        action: 'CREATE',
        entity: 'Device',
        entityId: 'dev-001',
        summary: 'Device created',
        detail: '{"assetCode":"A001","serialNumber":"SN001"}',
        actor: 'admin@itam.local',
        siteCode: 'UDH',
        createdAt: '2026-08-21T10:00:00Z',
      },
      {
        id: 'log-2',
        action: 'TRANSFER',
        entity: 'Device',
        entityId: 'dev-001',
        summary: 'Device transferred to NKP',
        detail: '{"fromSite":"UDH","toSite":"NKP"}',
        actor: 'admin@itam.local',
        siteCode: 'NKP',
        createdAt: '2026-08-21T11:00:00Z',
      },
    ],
    transfers: [
      {
        id: 'tf-1',
        deviceId: 'dev-001',
        assetCode: 'A001',
        moveDate: '2026-08-21',
        action: 'TRANSFER_SITE',
        fromStatus: 'active',
        toStatus: 'active',
        fromSite: 'UDH',
        toSite: 'NKP',
        movedBy: 'admin@itam.local',
        remark: null,
        transferDate: '2026-08-21',
        reason: 'Office move',
        createdAt: '2026-08-21T11:00:00Z',
      },
    ],
    expected: {
      ok: true,
      totalLogs: 2,
      totalTransfers: 1,
      redacted: false,
    },
  },
  {
    name: 'non-superadmin sees only their site logs',
    description:
      'Caller with UDH grant only — sees only UDH audit logs, NKP logs filtered out.',
    input: {
      deviceId: 'dev-001',
      isSuperAdmin: false,
      siteScope: ['UDH'],
      page: 1,
      limit: 50,
    },
    auditLogs: [
      {
        id: 'log-1',
        action: 'CREATE',
        entity: 'Device',
        entityId: 'dev-001',
        summary: 'Device created at UDH',
        detail: '{"assetCode":"A001"}',
        actor: 'admin@itam.local',
        siteCode: 'UDH',
        createdAt: '2026-08-21T10:00:00Z',
      },
      {
        id: 'log-2',
        action: 'TRANSFER',
        entity: 'Device',
        entityId: 'dev-001',
        summary: 'Device transferred to NKP',
        detail: null,
        actor: 'admin@itam.local',
        siteCode: 'NKP', // different site
        createdAt: '2026-08-21T11:00:00Z',
      },
    ],
    transfers: [],
    expected: {
      ok: true,
      totalLogs: 1, // only UDH log visible
      totalTransfers: 0,
      redacted: true,
    },
  },
  {
    name: 'non-superadmin with no grants → fail-closed',
    description:
      'Caller with no site grants — query denied with SITE_SCOPE_DENIED.',
    input: {
      deviceId: 'dev-001',
      isSuperAdmin: false,
      siteScope: [],
      page: 1,
      limit: 50,
    },
    auditLogs: [],
    transfers: [],
    expected: {
      ok: false,
      code: 'SITE_SCOPE_DENIED',
    },
  },
  {
    name: 'missing deviceId → fail',
    description: 'No deviceId provided.',
    input: {
      deviceId: '',
      isSuperAdmin: true,
      page: 1,
      limit: 50,
    },
    auditLogs: [],
    transfers: [],
    expected: {
      ok: false,
      code: 'MISSING_DEVICE_ID',
    },
  },
  {
    name: 'pagination clamps to bounds',
    description:
      'page=0, limit=9999 — clamped to page=1, limit=100 (MAX_LIMIT).',
    input: {
      deviceId: 'dev-001',
      isSuperAdmin: true,
      page: 0,
      limit: 9999,
    },
    auditLogs: [],
    transfers: [],
    expected: {
      ok: true,
    },
  },
  {
    name: 'audit logs without siteCode filtered for non-superadmin',
    description:
      'Audit logs with siteCode=null (global actions) are NOT visible to non-superadmin.',
    input: {
      deviceId: 'dev-001',
      isSuperAdmin: false,
      siteScope: ['UDH'],
      page: 1,
      limit: 50,
    },
    auditLogs: [
      {
        id: 'log-1',
        action: 'LOGIN',
        entity: 'User',
        entityId: null,
        summary: 'System login',
        detail: null,
        actor: 'system',
        siteCode: null, // global — not visible
        createdAt: '2026-08-21T09:00:00Z',
      },
      {
        id: 'log-2',
        action: 'UPDATE',
        entity: 'Device',
        entityId: 'dev-001',
        summary: 'Device updated at UDH',
        detail: null,
        actor: 'admin@itam.local',
        siteCode: 'UDH',
        createdAt: '2026-08-21T10:00:00Z',
      },
    ],
    transfers: [],
    expected: {
      ok: true,
      totalLogs: 1, // only UDH log visible
      redacted: true,
    },
  },
  {
    name: 'transfers visible if fromSite OR toSite in scope',
    description:
      'Transfer from UDH to NKP — caller with UDH grant sees it (fromSite in scope).',
    input: {
      deviceId: 'dev-001',
      isSuperAdmin: false,
      siteScope: ['UDH'],
      page: 1,
      limit: 50,
    },
    auditLogs: [],
    transfers: [
      {
        id: 'tf-1',
        deviceId: 'dev-001',
        assetCode: 'A001',
        moveDate: '2026-08-21',
        action: 'TRANSFER_SITE',
        fromStatus: 'active',
        toStatus: 'active',
        fromSite: 'UDH', // in scope
        toSite: 'NKP', // not in scope
        movedBy: 'admin@itam.local',
        remark: null,
        transferDate: '2026-08-21',
        reason: 'Office move',
        createdAt: '2026-08-21T11:00:00Z',
      },
      {
        id: 'tf-2',
        deviceId: 'dev-001',
        assetCode: 'A001',
        moveDate: '2026-08-22',
        action: 'TRANSFER_SITE',
        fromStatus: 'active',
        toStatus: 'active',
        fromSite: 'NKP', // not in scope
        toSite: 'MECUD', // not in scope
        movedBy: 'admin@itam.local',
        remark: null,
        transferDate: '2026-08-22',
        reason: 'Office move',
        createdAt: '2026-08-22T11:00:00Z',
      },
    ],
    expected: {
      ok: true,
      totalTransfers: 1, // only tf-1 (fromSite UDH in scope)
    },
  },
]
