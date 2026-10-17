// ============================================================
// Legacy Bridge Preview — read-only diff against ITAM-DB
// ============================================================

import type { LegacyBridgeModule, BridgeEnvelope, BridgeQuarantine } from '@/lib/legacy-bridge'

export interface LegacyBridgePreviewItem {
  externalKey: string
  action: 'create' | 'update' | 'skip' | 'error'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  expectedVersion: number | null
  expectedExists: boolean
  siteCode: string | null
  errorMessage?: string
}

export interface LegacyBridgeDb {
  device: { findUnique: (args: unknown) => Promise<Record<string, unknown> | null> }
  workOrder: { findUnique: (args: unknown) => Promise<Record<string, unknown> | null> }
  meterReading: { findUnique: (args: unknown) => Promise<Record<string, unknown> | null> }
  stockItem: { findUnique: (args: unknown) => Promise<Record<string, unknown> | null> }
  stockTransaction: { findFirst: (args: unknown) => Promise<Record<string, unknown> | null> }
}

const METADATA_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'version'])

function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  return value
}

function hasChanges(existing: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(payload)) {
    if (METADATA_FIELDS.has(key) || key.startsWith('_')) continue
    if (comparable(existing[key]) !== comparable(value)) return true
  }
  return false
}

function siteCodeFrom(envelope: BridgeEnvelope): string | null {
  const payload = envelope.payload
  const source = envelope.sourceRecord
  for (const value of [payload.siteCode, payload.site, payload.siteAtReading, source.siteCode, source.site]) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function selectFor(module: LegacyBridgeModule): Record<string, boolean> {
  switch (module) {
    case 'device':
      return { id: true, assetCode: true, serialNumber: true, name: true, brand: true, model: true, type: true, status: true, site: true, department: true, location: true, version: true }
    case 'work-order':
      return { id: true, requestId: true, legacyJobNo: true, subject: true, status: true, siteCode: true, version: true, building: true, location: true, details: true, priority: true, reporterName: true, reporterEmail: true, tel: true }
    case 'meter-reading':
      return { id: true, readingId: true, deviceId: true, assetCode: true, readingDate: true, readingMonth: true, meterBw: true, meterColor: true, pagesBw: true, pagesColor: true, prevMeterBw: true, prevMeterColor: true, readingType: true, readBy: true }
    case 'stock-item':
      return { id: true, productCode: true, productName: true, category: true, brand: true, model: true, unit: true, quantity: true, minQuantity: true, maxQuantity: true, unitCost: true, active: true, site: true, location: true, version: true }
    case 'stock-transaction':
      return { id: true, sourceKey: true, stockItemId: true, productCode: true, productName: true, type: true, quantity: true, txnDate: true, workOrderNo: true, requester: true, department: true, purpose: true, approver: true, approvedAt: true, deviceId: true, unit: true, reason: true, approvalStatus: true, processedFlag: true, remark: true, cost: true, unitCost: true, performedBy: true }
  }
}

async function findExisting(
  envelope: BridgeEnvelope,
  db: LegacyBridgeDb,
): Promise<Record<string, unknown> | null> {
  const { module, payload, externalKey } = envelope
  const select = selectFor(module)
  switch (module) {
    case 'device':
      return db.device.findUnique({ where: { assetCode: String(payload.assetCode) }, select })
    case 'work-order':
      return db.workOrder.findUnique({ where: { requestId: String(payload.requestId) }, select })
    case 'meter-reading':
      return db.meterReading.findUnique({ where: { readingId: String(payload.readingId || externalKey) }, select })
    case 'stock-item':
      return db.stockItem.findUnique({ where: { productCode: String(payload.productCode) }, select })
    case 'stock-transaction':
      return db.stockTransaction.findFirst({ where: { sourceKey: String(payload.sourceKey || externalKey) }, orderBy: { createdAt: 'desc' }, select })
  }
}

function expectedVersion(existing: Record<string, unknown> | null): number | null {
  return typeof existing?.version === 'number' ? existing.version : null
}

function quarantineItem(item: BridgeQuarantine): LegacyBridgePreviewItem {
  return {
    externalKey: item.externalKey === '(unknown)' ? item.externalKey : `QUARANTINED:${item.externalKey}`,
    action: 'error',
    before: null,
    after: item.sourceRecord,
    expectedVersion: null,
    expectedExists: false,
    siteCode: typeof item.sourceRecord.siteCode === 'string' ? item.sourceRecord.siteCode : null,
    errorMessage: item.reasons.join('; '),
  }
}

export async function computeLegacyBridgePreviewItems(
  ready: BridgeEnvelope[],
  quarantine: BridgeQuarantine[],
  db: LegacyBridgeDb,
  siteScope?: string[],
): Promise<LegacyBridgePreviewItem[]> {
  const items: LegacyBridgePreviewItem[] = quarantine.map(quarantineItem)

  for (const envelope of ready) {
    const siteCode = siteCodeFrom(envelope)
    if (siteScope && siteScope.length > 0 && siteCode && !siteScope.includes(siteCode)) {
      items.push({
        externalKey: envelope.externalKey,
        action: 'error',
        before: null,
        after: envelope.payload,
        expectedVersion: null,
        expectedExists: false,
        siteCode,
        errorMessage: `OUT_OF_SCOPE: site ${siteCode} not in user scope`,
      })
      continue
    }

    const existing = await findExisting(envelope, db)
    const after = envelope.payload

    if (!existing) {
      items.push({
        externalKey: envelope.externalKey,
        action: 'create',
        before: null,
        after,
        expectedVersion: null,
        expectedExists: false,
        siteCode,
      })
      continue
    }

    // Stock transactions are append-only ledger rows. A matching sourceKey
    // is idempotent only when the canonical values are unchanged. A changed
    // row is quarantined, never updated or silently skipped.
    if (envelope.module === 'stock-transaction') {
      const changed = hasChanges(existing, after)
      items.push({
        externalKey: envelope.externalKey,
        action: changed ? 'error' : 'skip',
        before: existing,
        after,
        expectedVersion: null,
        expectedExists: true,
        siteCode,
        errorMessage: changed
          ? 'CONFLICT: append-only stock transaction changed for existing sourceKey'
          : undefined,
      })
      continue
    }

    items.push({
      externalKey: envelope.externalKey,
      action: hasChanges(existing, after) ? 'update' : 'skip',
      before: existing,
      after,
      expectedVersion: expectedVersion(existing),
      expectedExists: true,
      siteCode,
    })
  }

  return items
}
