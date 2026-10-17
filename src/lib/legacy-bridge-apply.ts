// ============================================================
// Legacy Bridge Apply — controlled writes after preview approval
// ============================================================
// This service is called only by /api/sync/run after a completed preview.
// Every mutation is executed inside the caller's serializable transaction.
// Meter readings and stock transactions are append-only: a changed existing
// record is a conflict, never an in-place rewrite.
// ============================================================

import { Prisma } from '@prisma/client'
import type { LegacyBridgeModule } from '@/lib/legacy-bridge'
import type { LegacyBridgePreviewItem } from '@/lib/legacy-bridge-preview'
import { resolveWorkOrderReference } from '@/lib/stock-work-order-resolution'
import { redacted } from '@/lib/sync-adapter'

export type BridgeApplyTransaction = Prisma.TransactionClient

interface ApplyArgs {
  tx: BridgeApplyTransaction
  module: LegacyBridgeModule
  item: LegacyBridgePreviewItem
  actor: string
  source: string
  applyRunId: string
}

function payloadOf(item: LegacyBridgePreviewItem): Record<string, unknown> {
  if (!item.after || typeof item.after !== 'object' || Array.isArray(item.after)) {
    throw new Error('VALIDATION: after payload is required')
  }
  return item.after as Record<string, unknown>
}

function text(payload: Record<string, unknown>, key: string, fallback: string | null = null): string | null {
  const value = payload[key]
  if (value === undefined || value === null) return fallback
  const result = String(value).trim()
  return result === '' ? fallback : result
}

function int(payload: Record<string, unknown>, key: string, fallback = 0): number {
  const value = payload[key]
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value)
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').trim())
    if (Number.isFinite(parsed)) return Math.floor(parsed)
  }
  return fallback
}

function nullableInt(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key]
  if (value === undefined || value === null || String(value).trim() === '') return null
  return int(payload, key, Number.NaN)
}

function stripMetadata(payload: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, version: _version, ...rest } = payload
  return rest
}

async function resolveDeviceId(
  tx: BridgeApplyTransaction,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const reference = text(payload, 'deviceId')
  if (!reference) return null

  const byId = await tx.device.findUnique({ where: { id: reference }, select: { id: true } })
  if (byId) return byId.id

  const byAssetCode = await tx.device.findUnique({ where: { assetCode: reference }, select: { id: true } })
  if (byAssetCode) return byAssetCode.id

  throw new Error(`VALIDATION: device not found for reference=${reference}`)
}

function assertVersion(item: LegacyBridgePreviewItem, existing: Record<string, unknown> | null): void {
  if (item.expectedExists && !existing) throw new Error('CONFLICT: record deleted after preview — re-run preview')
  if (!item.expectedExists && existing) throw new Error('CONFLICT: record created after preview — re-run preview')
  if (item.expectedVersion !== null && existing && existing.version !== item.expectedVersion) {
    throw new Error(`CONFLICT: version ${existing.version} ≠ preview baseline ${item.expectedVersion}`)
  }
}

async function applyDevice(args: ApplyArgs): Promise<{ entityId: string; entityType: string }> {
  const payload = payloadOf(args.item)
  const assetCode = text(payload, 'assetCode')
  const serialNumber = text(payload, 'serialNumber')
  if (!assetCode || !serialNumber) throw new Error('VALIDATION: assetCode and serialNumber are mandatory as a pair')
  const existing = await args.tx.device.findUnique({ where: { assetCode }, select: { id: true, version: true, assetCode: true } })
  assertVersion(args.item, existing)

  const name = text(payload, 'name')
  const brand = text(payload, 'brand')
  const model = text(payload, 'model')
  const type = text(payload, 'type')
  const site = text(payload, 'site')
  if (!name || !brand || !model || !type || !site) throw new Error('VALIDATION: device requires name, brand, model, type and site')

  const patch = {
    serialNumber,
    name,
    brand,
    model,
    type,
    status: text(payload, 'status', 'Active') || 'Active',
    site,
    department: text(payload, 'department'),
    departmentCode: text(payload, 'departmentCode'),
    location: text(payload, 'location'),
    building: text(payload, 'building'),
    floor: text(payload, 'floor'),
    room: text(payload, 'room'),
    purchaseDate: text(payload, 'purchaseDate'),
    warrantyMonths: int(payload, 'warrantyMonths', 12),
    warrantyEnd: text(payload, 'warrantyEnd'),
    meterRequired: Boolean(payload.meterRequired),
    meterMode: text(payload, 'meterMode'),
    remark: text(payload, 'remark'),
    updatedBy: args.actor,
    isDemo: false,
  }
  const result = existing
    ? await args.tx.device.update({ where: { id: existing.id }, data: patch })
    : await args.tx.device.create({ data: { assetCode, ...patch } })
  return { entityId: result.id, entityType: 'Device' }
}

async function applyWorkOrder(args: ApplyArgs): Promise<{ entityId: string; entityType: string }> {
  const payload = payloadOf(args.item)
  const requestId = text(payload, 'requestId')
  const subject = text(payload, 'subject')
  const siteCode = text(payload, 'siteCode') || text(payload, 'site')
  if (!requestId || !subject || !siteCode) throw new Error('VALIDATION: requestId, subject and siteCode are required')
  const existing = await args.tx.workOrder.findUnique({ where: { requestId }, select: { id: true, version: true } })
  assertVersion(args.item, existing)
  const data = {
    requestId,
    legacyJobNo: text(payload, 'legacyJobNo'),
    subject,
    siteCode,
    building: text(payload, 'building'),
    location: text(payload, 'location'),
    details: text(payload, 'details'),
    priority: text(payload, 'priority', 'ปกติ') || 'ปกติ',
    reporterName: text(payload, 'reporterName'),
    reporterEmail: text(payload, 'reporterEmail'),
    tel: text(payload, 'tel'),
    status: text(payload, 'status', 'PENDING') || 'PENDING',
    deviceId: await resolveDeviceId(args.tx, payload),
    submissionSource: args.source,
    isDemo: false,
  }
  const result = existing
    ? await args.tx.workOrder.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
    : await args.tx.workOrder.create({ data })
  return { entityId: result.id, entityType: 'WorkOrder' }
}

async function applyMeterReading(args: ApplyArgs): Promise<{ entityId: string; entityType: string }> {
  const payload = payloadOf(args.item)
  const assetCode = text(payload, 'assetCode')
  const readingDate = text(payload, 'readingDate')
  if (!assetCode || !readingDate) throw new Error('VALIDATION: assetCode and readingDate are required')
  const readingId = text(payload, 'readingId') || args.item.externalKey
  const device = await args.tx.device.findUnique({ where: { assetCode }, select: { id: true, lastMeterBw: true, lastMeterColor: true } })
  if (!device) throw new Error(`VALIDATION: device not found for assetCode=${assetCode}`)
  const existing = await args.tx.meterReading.findUnique({ where: { readingId }, select: { id: true } })
  assertVersion(args.item, existing)
  if (existing) throw new Error('CONFLICT: MeterReading is append-only and already exists')

  const meterBw = int(payload, 'meterBw')
  const meterColor = int(payload, 'meterColor')
  const prevMeterBw = int(payload, 'prevMeterBw', device.lastMeterBw)
  const prevMeterColor = int(payload, 'prevMeterColor', device.lastMeterColor)
  const pagesBw = Math.max(0, int(payload, 'pagesBw', meterBw - prevMeterBw))
  const pagesColor = Math.max(0, int(payload, 'pagesColor', meterColor - prevMeterColor))
  const result = await args.tx.meterReading.create({
    data: {
      readingId,
      deviceId: device.id,
      assetCode,
      readingDate,
      readingMonth: text(payload, 'readingMonth') || readingDate.slice(0, 7),
      meterBw,
      meterColor,
      pagesBw,
      pagesColor,
      prevMeterBw,
      prevMeterColor,
      readingType: text(payload, 'readingType', 'MONTHLY') || 'MONTHLY',
      readBy: text(payload, 'readBy'),
      remark: text(payload, 'remark'),
      eventType: text(payload, 'eventType'),
      eventId: text(payload, 'eventId'),
      siteAtReading: text(payload, 'siteAtReading') || text(payload, 'siteCode') || text(payload, 'site'),
      isDemo: false,
    },
  })
  await args.tx.device.update({ where: { id: device.id }, data: { lastMeterBw: meterBw, lastMeterColor: meterColor, updatedBy: args.actor } })
  return { entityId: result.id, entityType: 'MeterReading' }
}

async function applyStockItem(args: ApplyArgs): Promise<{ entityId: string; entityType: string }> {
  const payload = payloadOf(args.item)
  const productCode = text(payload, 'productCode')
  const productName = text(payload, 'productName')
  if (!productCode || !productName) throw new Error('VALIDATION: productCode and productName are required')
  const existing = await args.tx.stockItem.findUnique({ where: { productCode }, select: { id: true, productCode: true } })
  assertVersion(args.item, existing)
  const data = {
    productCode,
    productName,
    category: text(payload, 'category'),
    brand: text(payload, 'brand'),
    model: text(payload, 'model'),
    unit: text(payload, 'unit', 'ชิ้น') || 'ชิ้น',
    quantity: int(payload, 'quantity'),
    minQuantity: int(payload, 'minQuantity'),
    maxQuantity: int(payload, 'maxQuantity'),
    unitCost: nullableInt(payload, 'unitCost'),
    location: text(payload, 'location'),
    site: text(payload, 'site') || text(payload, 'siteCode'),
    compatibleDevices: text(payload, 'compatibleDevices'),
    remark: text(payload, 'remark'),
    active: payload.active === undefined ? true : Boolean(payload.active),
    lastUpdated: text(payload, 'lastUpdated'),
  }
  const result = existing
    ? await args.tx.stockItem.update({ where: { id: existing.id }, data })
    : await args.tx.stockItem.create({ data })
  return { entityId: result.id, entityType: 'StockItem' }
}

async function applyStockTransaction(args: ApplyArgs): Promise<{ entityId: string; entityType: string }> {
  const payload = payloadOf(args.item)
  const productCode = text(payload, 'productCode')
  const type = text(payload, 'type')?.toUpperCase()
  const quantity = int(payload, 'quantity')
  const txnDate = text(payload, 'txnDate')
  const sourceKey = text(payload, 'sourceKey') || args.item.externalKey
  if (!productCode || !type || !txnDate) throw new Error('VALIDATION: productCode, type and txnDate are required')
  if (!['IN', 'OUT', 'ADJUST'].includes(type)) throw new Error(`VALIDATION: unsupported stock transaction type ${type}`)
  if ((type === 'ADJUST' && quantity < 0) || (type !== 'ADJUST' && quantity <= 0)) {
    throw new Error('VALIDATION: invalid stock transaction quantity')
  }

  const existing = await args.tx.stockTransaction.findFirst({ where: { sourceKey }, orderBy: { createdAt: 'desc' }, select: { id: true, sourceKey: true } })
  if (existing) throw new Error('CONFLICT: stock transaction sourceKey already exists; append-only ledger is idempotent')
  const item = await args.tx.stockItem.findUnique({ where: { productCode }, select: { id: true, productCode: true, productName: true, quantity: true } })
  if (!item) throw new Error(`VALIDATION: stock item not found for productCode=${productCode}`)
  if (type === 'OUT' && item.quantity - quantity < 0) {
    throw new Error('VALIDATION: stock OUT quantity exceeds current balance')
  }

  const balanceAfter = type === 'IN' ? item.quantity + quantity : type === 'OUT' ? item.quantity - quantity : quantity
  let workOrderId: string | null = null
  const workOrderNo = text(payload, 'workOrderNo')
  if (type === 'OUT') {
    const resolution = await resolveWorkOrderReference(
      {
        workOrderId: payload.workOrderId,
        workOrderNo,
        legacyJobNo: payload.legacyJobNo,
        systemJobNo: payload.systemJobNo,
        requestId: payload.requestId,
      },
      {
        byId: (value) => args.tx.workOrder.findUnique({ where: { id: value }, select: { id: true, woNumber: true, legacyJobNo: true, systemJobNo: true, requestId: true } }),
        byWoNumber: (value) => args.tx.workOrder.findUnique({ where: { woNumber: value }, select: { id: true, woNumber: true, legacyJobNo: true, systemJobNo: true, requestId: true } }),
                // WorkOrder.legacyJobNo is indexed but NOT @unique (legacy IDs can
        // repeat across source systems), so findUnique cannot target it —
        // findFirst returns the oldest match, matching the other resolvers'
        // "first match wins" semantics.
        byLegacyJobNo: (value) => args.tx.workOrder.findFirst({ where: { legacyJobNo: value }, select: { id: true, woNumber: true, legacyJobNo: true, systemJobNo: true, requestId: true } }),
        bySystemJobNo: (value) => args.tx.workOrder.findUnique({ where: { systemJobNo: value }, select: { id: true, woNumber: true, legacyJobNo: true, systemJobNo: true, requestId: true } }),
        byRequestId: (value) => args.tx.workOrder.findUnique({ where: { requestId: value }, select: { id: true, woNumber: true, legacyJobNo: true, systemJobNo: true, requestId: true } }),
      },
    )
    if (resolution.status === 'quarantined') {
      throw new Error(`VALIDATION: work-order reference quarantined (${resolution.reason})`)
    }
    workOrderId = resolution.status === 'resolved' ? resolution.workOrder.id : null
  }
  const result = await args.tx.stockTransaction.create({
    data: {
      txnNumber: text(payload, 'txnNumber'),
      stockItemId: item.id,
      productCode,
      productName: item.productName,
      type,
      quantity,
      balanceAfter,
      unit: text(payload, 'unit'),
      reason: text(payload, 'reason'),
      requester: type === 'OUT' ? text(payload, 'requester') : null,
      department: type === 'OUT' ? text(payload, 'department') : null,
      purpose: type === 'OUT' ? text(payload, 'purpose') : null,
      approver: type === 'OUT' ? text(payload, 'approver') : null,
      approvedAt: type === 'OUT' ? text(payload, 'approvedAt') : null,
      workOrderId,
      workOrderNo,
      deviceId: await resolveDeviceId(args.tx, payload),
      cost: nullableInt(payload, 'cost'),
      unitCost: nullableInt(payload, 'unitCost'),
      txnDate,
      performedBy: text(payload, 'performedBy') || args.actor,
      remark: text(payload, 'remark'),
      sourceKey,
      processedFlag: text(payload, 'processedFlag'),
      approvalStatus: text(payload, 'approvalStatus'),
      isDemo: false,
    },
  })
  await args.tx.stockItem.update({ where: { id: item.id }, data: { quantity: balanceAfter } })
  return { entityId: result.id, entityType: 'StockTransaction' }
}

export async function applyLegacyBridgeItem(args: ApplyArgs): Promise<{ entityId: string; entityType: string }> {
  if (args.item.action === 'skip') throw new Error('IDEMPOTENT_SKIP: item already matches target')
  if (args.item.action === 'error') throw new Error(args.item.errorMessage || 'QUARANTINED: item is not eligible for apply')
  switch (args.module) {
    case 'device': return applyDevice(args)
    case 'work-order': return applyWorkOrder(args)
    case 'meter-reading': return applyMeterReading(args)
    case 'stock-item': return applyStockItem(args)
    case 'stock-transaction': return applyStockTransaction(args)
    default: throw new Error(`VALIDATION: unsupported legacy bridge module ${String(args.module)}`)
  }
}

export async function createBridgeAudit(
  tx: BridgeApplyTransaction,
  item: LegacyBridgePreviewItem,
  result: { entityId: string; entityType: string },
  source: string,
  actor: string,
  applyRunId: string,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      action: 'SYNC_APPLY',
      entity: result.entityType,
      entityId: result.entityId,
      summary: `Bridge sync ${item.action} from ${source} (key=${item.externalKey})`,
      detail: JSON.stringify({
        before: redacted(item.before),
        after: redacted(item.after),
        syncRunId: applyRunId,
        externalKey: item.externalKey,
      }),
      actor,
      siteCode: (item.after?.siteCode as string)
        || (item.after?.siteAtReading as string)
        || (item.after?.site as string)
        || null,
    },
  })
}
