/**
 * sync-conflict-policy.ts — Central Conflict Resolution Service.
 *
 * P1-03: Per-entity conflict policy per consultant blueprint §3.6.
 *
 * Each entity type has a different policy because business impact differs:
 *   - Device: field-level merge — different fields can be merged without conflict
 *   - WorkOrder: status is cloud-authoritative (workflow integrity); remarks merge
 *   - StockTransaction: APPEND-ONLY — never merge balances, always append new txn
 *   - MasterItem: manual review required when code/brand/model collide
 *   - AuditLog: APPEND-ONLY — never update or delete
 *   - CustomFieldValue: field-level merge (like Device)
 *   - User/Permission: cloud-authoritative — admin changes win
 *
 * The service is used by /api/sync/push to detect conflicts and decide
 * whether to auto-merge or create a SyncConflict record.
 */

import type { Prisma } from '@prisma/client'

/** Entities that can participate in sync (Phase 2 will expand this). */
export type SyncableEntity =
  | 'Device'
  | 'WorkOrder'
  | 'StockTransaction'
  | 'MasterItem'
  | 'AuditLog'
  | 'CustomFieldValue'
  | 'User'

/** Result of applying a push change. */
export type ApplyResult =
  | { status: 'ACKED'; newVersion: number; noOp?: boolean }
  | { status: 'CONFLICT'; conflictFields: string[]; cloudPayload: Record<string, unknown>; offlinePayload: Record<string, unknown> }
  | { status: 'REJECTED'; reason: string }

/**
 * Fields that are safe to auto-merge (different fields edited by both sides
 * → no conflict, just apply both). Everything else triggers a conflict.
 */
const MERGEABLE_FIELDS: Record<SyncableEntity, Set<string>> = {
  Device: new Set(['name', 'serialNumber', 'location', 'department', 'floor', 'room', 'remark', 'warrantyEnd']),
  WorkOrder: new Set(['remark', 'detailsAdmin', 'resolution', 'assignedNote']),
  StockTransaction: new Set(), // append-only — no merge
  MasterItem: new Set(), // manual review always
  AuditLog: new Set(), // append-only — no merge
  CustomFieldValue: new Set(['valueText', 'valueNumber', 'valueBoolean']),
  User: new Set(), // cloud-authoritative
}

/**
 * Fields where the cloud/server is authoritative (offline edits to these
 * fields are always overridden by cloud state).
 */
const CLOUD_AUTHORITATIVE_FIELDS: Record<SyncableEntity, Set<string>> = {
  Device: new Set(['assetCode', 'organizationId']), // identity fields
  WorkOrder: new Set(['status', 'assignedTo', 'workCompletedAt', 'closedAt']), // workflow
  StockTransaction: new Set(), // append-only
  MasterItem: new Set(['code', 'category']), // identity
  AuditLog: new Set(), // append-only
  CustomFieldValue: new Set(),
  User: new Set(['role', 'allowedSites', 'active', 'permissions']), // security
}

/**
 * Entities where offline pushes are APPEND-ONLY (no UPDATE or DELETE allowed
 * from an offline node — they must create new records instead).
 */
const APPEND_ONLY_ENTITIES = new Set<SyncableEntity>([
  'StockTransaction',
  'AuditLog',
])

/**
 * Detect conflict between a cloud entity and an offline push.
 *
 * @param entityType - which entity type
 * @param operation - CREATE | UPDATE | DELETE
 * @param baseVersion - version the offline node read before editing
 * @param cloudVersion - current version in the cloud
 * @param cloudPayload - current cloud state of the entity
 * @param offlinePayload - the change the offline node wants to apply
 * @returns ApplyResult — either ACKED (apply), CONFLICT (record), or REJECTED
 */
export function detectConflict(
  entityType: SyncableEntity,
  operation: 'CREATE' | 'UPDATE' | 'DELETE',
  baseVersion: number | undefined,
  cloudVersion: number,
  cloudPayload: Record<string, unknown>,
  offlinePayload: Record<string, unknown>,
): ApplyResult {
  // ── Rule 1: APPEND-ONLY entities reject UPDATE/DELETE ──
  if (APPEND_ONLY_ENTITIES.has(entityType) && operation !== 'CREATE') {
    return {
      status: 'REJECTED',
      reason: `${entityType} is append-only — offline nodes cannot ${operation.toLowerCase()} existing records. Create a new record instead.`,
    }
  }

  // ── Rule 2: if baseVersion matches cloudVersion → no conflict, apply ──
  if (baseVersion === cloudVersion) {
    return { status: 'ACKED', newVersion: cloudVersion + 1 }
  }

  // ── Rule 3: baseVersion < cloudVersion → check field overlap ──
  const mergeable = MERGEABLE_FIELDS[entityType] ?? new Set<string>()
  const cloudAuthoritative = CLOUD_AUTHORITATIVE_FIELDS[entityType] ?? new Set<string>()

  const conflictFields: string[] = []
  for (const key of Object.keys(offlinePayload)) {
    // Skip metadata fields
    if (['id', 'version', 'createdAt', 'updatedAt', 'organizationId'].includes(key)) continue

    // If this field is cloud-authoritative, offline change is overridden → no conflict, just ignore offline value
    if (cloudAuthoritative.has(key)) continue

    // If this field is mergeable AND cloud didn't change it (offline value == cloud value),
    // no conflict — apply offline value.
    const cloudVal = cloudPayload[key]
    const offlineVal = offlinePayload[key]
    if (mergeable.has(key) && JSON.stringify(cloudVal) === JSON.stringify(offlineVal)) {
      continue // same value, no conflict
    }

    // If this field is mergeable AND cloud changed it but offline didn't touch the SAME field
    // → we need to check if cloud also changed this field. If cloud changed it too → conflict.
    // For simplicity in Phase 1 stub: if values differ → conflict.
    if (mergeable.has(key) && JSON.stringify(cloudVal) !== JSON.stringify(offlineVal)) {
      conflictFields.push(key)
      continue
    }

    // Non-mergeable field that differs → conflict
    if (!mergeable.has(key)) {
      conflictFields.push(key)
    }
  }

  // ── Rule 4: DELETE vs UPDATE → always conflict (manual resolve) ──
  if (operation === 'DELETE') {
    return {
      status: 'CONFLICT',
      conflictFields: ['__delete__'],
      cloudPayload,
      offlinePayload,
    }
  }

  // ── Rule 5: if no conflict fields → no-op ACK (cloud already has the changes) ──
  if (conflictFields.length === 0) {
    return { status: 'ACKED', newVersion: cloudVersion, noOp: true }
  }

  // ── Rule 6: conflict → create SyncConflict record for manual resolution ──
  return {
    status: 'CONFLICT',
    conflictFields,
    cloudPayload,
    offlinePayload,
  }
}

/**
 * Choose which payload to apply when resolving a conflict.
 *
 * @param resolution - CLOUD | OFFLINE | MERGED | REJECTED
 * @param conflict - the SyncConflict record (cloudPayload + offlinePayload + conflictFields)
 * @param mergedPayload - admin's manual merge (only for MERGED resolution)
 */
export function chooseResolutionPayload(
  resolution: 'CLOUD' | 'OFFLINE' | 'MERGED' | 'REJECTED',
  conflict: { cloudPayload: string; offlinePayload: string },
  mergedPayload?: Record<string, unknown>,
): Record<string, unknown> | null {
  switch (resolution) {
    case 'CLOUD':
      return JSON.parse(conflict.cloudPayload)
    case 'OFFLINE':
      return JSON.parse(conflict.offlinePayload)
    case 'MERGED':
      if (!mergedPayload) {
        throw new Error('mergedPayload is required for MERGED resolution')
      }
      return mergedPayload
    case 'REJECTED':
      return null // no entity update — just mark conflict as rejected
  }
}

/**
 * Get the conflict policy label for an entity (for UI display).
 */
export function getConflictPolicyLabel(entityType: SyncableEntity): string {
  if (APPEND_ONLY_ENTITIES.has(entityType)) {
    return 'Append-Only (no merge)'
  }
  const mergeable = MERGEABLE_FIELDS[entityType]
  if (mergeable && mergeable.size > 0) {
    return 'Field-level Merge'
  }
  if (entityType === 'MasterItem') {
    return 'Manual Review'
  }
  if (entityType === 'User') {
    return 'Cloud-Authoritative'
  }
  return 'Manual Review'
}
