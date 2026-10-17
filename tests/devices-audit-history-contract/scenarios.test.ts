// ============================================================
// Devices Audit History Contract — Tests (pure, no DB)
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  AUDIT_HISTORY_SCENARIOS,
  AUDIT_HISTORY_BOUNDS,
  DEVICE_AUDIT_ACTIONS,
  SENSITIVE_DETAIL_FIELDS,
  clampHistoryPagination,
  buildSiteFilter,
  validateHistoryQuery,
  filterAuditLogsBySite,
  redactAuditLogs,
  filterTransfersBySite,
  buildHistoryResult,
  type AuditLogFixture,
  type DeviceTransferFixture,
  type HistoryQueryInput,
} from '@/lib/devices-audit-history-contract/scenarios'

// ─── clampHistoryPagination ──────────────────────────────────────────
describe('clampHistoryPagination', () => {
  it('returns defaults when page/limit undefined', () => {
    const result = clampHistoryPagination(undefined, undefined)
    expect(result.page).toBe(1)
    expect(result.limit).toBe(AUDIT_HISTORY_BOUNDS.DEFAULT_LIMIT)
    expect(result.skip).toBe(0)
    expect(result.valid).toBe(true)
  })

  it('clamps page < 1 to 1', () => {
    const result = clampHistoryPagination(0, 50)
    expect(result.page).toBe(1)
    expect(result.skip).toBe(0)
  })

  it('clamps page > MAX_PAGE to MAX_PAGE', () => {
    const result = clampHistoryPagination(99999, 50)
    expect(result.page).toBe(AUDIT_HISTORY_BOUNDS.MAX_PAGE)
  })

  it('clamps limit > MAX_LIMIT to MAX_LIMIT', () => {
    const result = clampHistoryPagination(1, 99999)
    expect(result.limit).toBe(AUDIT_HISTORY_BOUNDS.MAX_LIMIT)
  })

  it('clamps limit < 1 to 1', () => {
    const result = clampHistoryPagination(1, 0)
    expect(result.limit).toBe(1)
  })

  it('handles NaN', () => {
    const result = clampHistoryPagination(NaN, NaN)
    expect(result.valid).toBe(false)
    expect(result.page).toBe(1)
    expect(result.limit).toBe(AUDIT_HISTORY_BOUNDS.DEFAULT_LIMIT)
  })

  it('handles Infinity', () => {
    const result = clampHistoryPagination(Infinity, Infinity)
    expect(result.valid).toBe(false)
  })

  it('calculates skip correctly', () => {
    expect(clampHistoryPagination(1, 50).skip).toBe(0)
    expect(clampHistoryPagination(2, 50).skip).toBe(50)
    expect(clampHistoryPagination(3, 25).skip).toBe(50)
  })
})

// ─── buildSiteFilter ────────────────────────────────────────────────
describe('buildSiteFilter', () => {
  it('returns null for superadmin (no filter)', () => {
    expect(buildSiteFilter(true, ['UDH'])).toBeNull()
    expect(buildSiteFilter(true, [])).toBeNull()
    expect(buildSiteFilter(true, undefined)).toBeNull()
  })

  it('returns empty array for non-superadmin with no grants', () => {
    expect(buildSiteFilter(false, [])).toEqual([])
    expect(buildSiteFilter(false, undefined)).toEqual([])
  })

  it('returns site array for non-superadmin with grants', () => {
    expect(buildSiteFilter(false, ['UDH', 'NKP'])).toEqual(['UDH', 'NKP'])
  })
})

// ─── validateHistoryQuery ──────────────────────────────────────────
describe('validateHistoryQuery', () => {
  it('MISSING_DEVICE_ID when deviceId is empty', () => {
    const input: HistoryQueryInput = {
      deviceId: '',
      isSuperAdmin: true,
      page: 1,
      limit: 50,
    }
    const result = validateHistoryQuery(input)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('MISSING_DEVICE_ID')
  })

  it('SITE_SCOPE_DENIED for non-superadmin with no grants', () => {
    const input: HistoryQueryInput = {
      deviceId: 'dev-1',
      isSuperAdmin: false,
      siteScope: [],
      page: 1,
      limit: 50,
    }
    const result = validateHistoryQuery(input)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('SITE_SCOPE_DENIED')
  })

  it('ok for superadmin', () => {
    const input: HistoryQueryInput = {
      deviceId: 'dev-1',
      isSuperAdmin: true,
      page: 1,
      limit: 50,
    }
    const result = validateHistoryQuery(input)
    expect(result.ok).toBe(true)
    expect(result.query?.siteFilter).toBeNull()
  })

  it('ok for non-superadmin with grants', () => {
    const input: HistoryQueryInput = {
      deviceId: 'dev-1',
      isSuperAdmin: false,
      siteScope: ['UDH'],
      page: 1,
      limit: 50,
    }
    const result = validateHistoryQuery(input)
    expect(result.ok).toBe(true)
    expect(result.query?.siteFilter).toEqual(['UDH'])
  })
})

// ─── filterAuditLogsBySite ──────────────────────────────────────────
describe('filterAuditLogsBySite', () => {
  const logs: AuditLogFixture[] = [
    {
      id: 'log-1',
      action: 'CREATE',
      entity: 'Device',
      entityId: 'dev-1',
      summary: 'UDH log',
      detail: null,
      actor: 'admin',
      siteCode: 'UDH',
      createdAt: '2026-08-21T10:00:00Z',
    },
    {
      id: 'log-2',
      action: 'TRANSFER',
      entity: 'Device',
      entityId: 'dev-1',
      summary: 'NKP log',
      detail: null,
      actor: 'admin',
      siteCode: 'NKP',
      createdAt: '2026-08-21T11:00:00Z',
    },
    {
      id: 'log-3',
      action: 'LOGIN',
      entity: 'User',
      entityId: null,
      summary: 'Global log',
      detail: null,
      actor: 'system',
      siteCode: null, // global
      createdAt: '2026-08-21T09:00:00Z',
    },
  ]

  it('superadmin sees all logs', () => {
    const result = filterAuditLogsBySite(logs, null)
    expect(result.length).toBe(3)
  })

  it('non-superadmin with UDH sees only UDH logs', () => {
    const result = filterAuditLogsBySite(logs, ['UDH'])
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('log-1')
  })

  it('non-superadmin with no grants sees nothing (fail-closed)', () => {
    const result = filterAuditLogsBySite(logs, [])
    expect(result.length).toBe(0)
  })

  it('global logs (siteCode=null) not visible to non-superadmin', () => {
    const result = filterAuditLogsBySite(logs, ['UDH'])
    expect(result.find((l) => l.id === 'log-3')).toBeUndefined()
  })
})

// ─── redactAuditLogs ────────────────────────────────────────────────
describe('redactAuditLogs', () => {
  const logs: AuditLogFixture[] = [
    {
      id: 'log-1',
      action: 'CREATE',
      entity: 'Device',
      entityId: 'dev-1',
      summary: 'Device created',
      detail: '{"serialNumber":"SN001","ip":"10.0.0.1"}',
      actor: 'admin@itam.local',
      siteCode: 'UDH',
      createdAt: '2026-08-21T10:00:00Z',
    },
  ]

  it('superadmin gets redacted (no raw detail string)', () => {
    const result = redactAuditLogs(logs, true)
    expect(result.length).toBe(1)
    expect(result[0]).not.toHaveProperty('detail')
    expect(result[0].id).toBe('log-1')
    expect(result[0].action).toBe('CREATE')
  })

  it('non-superadmin gets redacted (no raw detail)', () => {
    const result = redactAuditLogs(logs, false)
    expect(result.length).toBe(1)
    expect(result[0]).not.toHaveProperty('detail')
  })

  it('preserves essential fields', () => {
    const result = redactAuditLogs(logs, false)
    expect(result[0]).toHaveProperty('id')
    expect(result[0]).toHaveProperty('action')
    expect(result[0]).toHaveProperty('entity')
    expect(result[0]).toHaveProperty('entityId')
    expect(result[0]).toHaveProperty('summary')
    expect(result[0]).toHaveProperty('actor')
    expect(result[0]).toHaveProperty('siteCode')
    expect(result[0]).toHaveProperty('createdAt')
  })
})

// ─── filterTransfersBySite ──────────────────────────────────────────
describe('filterTransfersBySite', () => {
  const transfers: DeviceTransferFixture[] = [
    {
      id: 'tf-1',
      deviceId: 'dev-1',
      assetCode: 'A001',
      moveDate: '2026-08-21',
      action: 'TRANSFER_SITE',
      fromStatus: 'active',
      toStatus: 'active',
      fromSite: 'UDH',
      toSite: 'NKP',
      movedBy: 'admin',
      remark: null,
      transferDate: '2026-08-21',
      reason: 'move',
      createdAt: '2026-08-21T11:00:00Z',
    },
    {
      id: 'tf-2',
      deviceId: 'dev-1',
      assetCode: 'A001',
      moveDate: '2026-08-22',
      action: 'TRANSFER_SITE',
      fromStatus: 'active',
      toStatus: 'active',
      fromSite: 'NKP',
      toSite: 'MECUD',
      movedBy: 'admin',
      remark: null,
      transferDate: '2026-08-22',
      reason: 'move',
      createdAt: '2026-08-22T11:00:00Z',
    },
  ]

  it('superadmin sees all transfers', () => {
    const result = filterTransfersBySite(transfers, null)
    expect(result.length).toBe(2)
  })

  it('non-superadmin with UDH sees tf-1 (fromSite UDH)', () => {
    const result = filterTransfersBySite(transfers, ['UDH'])
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('tf-1')
  })

  it('non-superadmin with NKP sees both (fromSite OR toSite in scope)', () => {
    const result = filterTransfersBySite(transfers, ['NKP'])
    expect(result.length).toBe(2)
  })

  it('non-superadmin with no grants sees nothing', () => {
    const result = filterTransfersBySite(transfers, [])
    expect(result.length).toBe(0)
  })
})

// ─── buildHistoryResult ─────────────────────────────────────────────
describe('buildHistoryResult', () => {
  it('combines audit logs + transfers with pagination', () => {
    const auditLogs: AuditLogFixture[] = [
      {
        id: 'log-1',
        action: 'CREATE',
        entity: 'Device',
        entityId: 'dev-1',
        summary: 'Created',
        detail: null,
        actor: 'admin',
        siteCode: 'UDH',
        createdAt: '2026-08-21T10:00:00Z',
      },
    ]
    const transfers: DeviceTransferFixture[] = [
      {
        id: 'tf-1',
        deviceId: 'dev-1',
        assetCode: 'A001',
        moveDate: '2026-08-21',
        action: 'TRANSFER_SITE',
        fromStatus: 'active',
        toStatus: 'active',
        fromSite: 'UDH',
        toSite: 'NKP',
        movedBy: 'admin',
        remark: null,
        transferDate: '2026-08-21',
        reason: 'move',
        createdAt: '2026-08-21T11:00:00Z',
      },
    ]
    const query = {
      deviceId: 'dev-1',
      page: 1,
      limit: 50,
      skip: 0,
      siteFilter: null, // superadmin
    }
    const result = buildHistoryResult(auditLogs, transfers, query, true)
    expect(result.ok).toBe(true)
    expect(result.total).toBe(2)
    expect(result.totalPages).toBe(1)
  })
})

// ─── Scenario integrity ─────────────────────────────────────────────

  it('non-superadmin buildHistoryResult output has no detail/raw sensitive payload', () => {
    const auditLogs: AuditLogFixture[] = [
      {
        id: 'log-1',
        action: 'CREATE',
        entity: 'Device',
        entityId: 'dev-1',
        summary: 'Device created',
        detail: '{"serialNumber":"SN001","ip":"10.0.0.1","password":"secret"}',
        actor: 'admin@itam.local',
        siteCode: 'UDH',
        createdAt: '2026-08-21T10:00:00Z',
      },
    ]
    const query = {
      deviceId: 'dev-1',
      page: 1,
      limit: 50,
      skip: 0,
      siteFilter: ['UDH'],
    }
    // Non-superadmin — redaction should be applied
    const result = buildHistoryResult(auditLogs, [], query, false)
    expect(result.ok).toBe(true)
    expect(result.auditLogs.length).toBe(1)
    // The returned auditLogs should be redacted — no 'detail' field
    const returnedLog = result.auditLogs[0] as unknown as Record<string, unknown>
    expect(returnedLog).not.toHaveProperty('detail')
    // Should still have essential fields
    expect(returnedLog).toHaveProperty('id')
    expect(returnedLog).toHaveProperty('action')
    expect(returnedLog).toHaveProperty('summary')
  })

  it('superadmin buildHistoryResult output also redacts detail (consistent redaction)', () => {
    const auditLogs: AuditLogFixture[] = [
      {
        id: 'log-1',
        action: 'CREATE',
        entity: 'Device',
        entityId: 'dev-1',
        summary: 'Device created',
        detail: '{"serialNumber":"SN001"}',
        actor: 'admin@itam.local',
        siteCode: 'UDH',
        createdAt: '2026-08-21T10:00:00Z',
      },
    ]
    const query = {
      deviceId: 'dev-1',
      page: 1,
      limit: 50,
      skip: 0,
      siteFilter: null, // superadmin
    }
    const result = buildHistoryResult(auditLogs, [], query, true)
    expect(result.ok).toBe(true)
    expect(result.auditLogs.length).toBe(1)
    // Superadmin also gets redacted logs (no raw detail string)
    const returnedLog = result.auditLogs[0] as unknown as Record<string, unknown>
    expect(returnedLog).not.toHaveProperty('detail')
  })

describe('Scenario integrity', () => {
  it('AUDIT_HISTORY_SCENARIOS has 7 scenarios', () => {
    expect(AUDIT_HISTORY_SCENARIOS.length).toBe(7)
  })

  it('scenarios cover ok + fail outcomes', () => {
    const hasOk = AUDIT_HISTORY_SCENARIOS.some((s) => s.expected.ok)
    const hasFail = AUDIT_HISTORY_SCENARIOS.some((s) => !s.expected.ok)
    expect(hasOk).toBe(true)
    expect(hasFail).toBe(true)
  })

  it('scenarios cover superadmin + non-superadmin', () => {
    const hasSuperadmin = AUDIT_HISTORY_SCENARIOS.some(
      (s) => s.input.isSuperAdmin,
    )
    const hasNonSuperadmin = AUDIT_HISTORY_SCENARIOS.some(
      (s) => !s.input.isSuperAdmin,
    )
    expect(hasSuperadmin).toBe(true)
    expect(hasNonSuperadmin).toBe(true)
  })

  it('scenarios cover error codes MISSING_DEVICE_ID + SITE_SCOPE_DENIED', () => {
    const codes = new Set(
      AUDIT_HISTORY_SCENARIOS.filter((s) => !s.expected.ok).map(
        (s) => s.expected.code,
      ),
    )
    expect(codes.has('MISSING_DEVICE_ID')).toBe(true)
    expect(codes.has('SITE_SCOPE_DENIED')).toBe(true)
  })
})

// ─── Constants integrity ────────────────────────────────────────────
describe('Constants integrity', () => {
  it('AUDIT_HISTORY_BOUNDS has correct values', () => {
    expect(AUDIT_HISTORY_BOUNDS.MAX_LIMIT).toBe(100)
    expect(AUDIT_HISTORY_BOUNDS.DEFAULT_LIMIT).toBe(50)
    expect(AUDIT_HISTORY_BOUNDS.MIN_LIMIT).toBe(1)
    expect(AUDIT_HISTORY_BOUNDS.MAX_PAGE).toBe(1000)
  })

  it('DEVICE_AUDIT_ACTIONS has all 7 actions', () => {
    expect(Object.values(DEVICE_AUDIT_ACTIONS).length).toBe(7)
    expect(DEVICE_AUDIT_ACTIONS.CREATE).toBe('CREATE')
    expect(DEVICE_AUDIT_ACTIONS.TRANSFER).toBe('TRANSFER')
    expect(DEVICE_AUDIT_ACTIONS.IMPORT).toBe('IMPORT')
  })

  it('SENSITIVE_DETAIL_FIELDS includes serialNumber, ip, mac', () => {
    expect(SENSITIVE_DETAIL_FIELDS).toContain('serialNumber')
    expect(SENSITIVE_DETAIL_FIELDS).toContain('ip')
    expect(SENSITIVE_DETAIL_FIELDS).toContain('mac')
    expect(SENSITIVE_DETAIL_FIELDS).toContain('contractNo')
  })
})
