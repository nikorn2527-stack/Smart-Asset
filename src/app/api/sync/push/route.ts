import { NextRequest, NextResponse } from 'next/server'
import { db, getBaseClient } from '@/lib/db'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { verifyNodeOrUser } from '@/lib/sync-node-guard'
import { logAudit } from '@/lib/audit'
import { detectConflict, type SyncableEntity, type ApplyResult } from '@/lib/sync-conflict-policy'

/**
 * POST /api/sync/push
 *
 * Phase 1 → Phase 2 contract stub.
 * Receives changes from an offline/lan node and applies them with
 * Optimistic Concurrency Control (baseVersion check).
 *
 * Request:
 *   { nodeId, changes: [{ idempotencyKey, entityType, entityId, operation,
 *                          baseVersion, entityVersion, payload }] }
 *
 * Response:
 *   { accepted: [{ idempotencyKey, newVersion, status }], conflicts: [...], failed: [...] }
 *
 * Phase 2 will add: per-entity conflict policy (Device field-merge,
 * WorkOrder status-cloud-wins, StockTransaction append-only, etc.)
 */
interface PushChange {
  idempotencyKey: string
  entityType: string
  entityId: string
  operation: 'CREATE' | 'UPDATE' | 'DELETE'
  baseVersion?: number
  entityVersion?: number
  payload: Record<string, unknown>
}

interface PushResult {
  accepted: Array<{ idempotencyKey: string; newVersion?: number; status: string; noOp?: boolean }>
  conflicts: Array<{ idempotencyKey: string; conflictId: string; cloudVersion: number; status: string }>
  failed: Array<{ idempotencyKey: string; error: string }>
}

export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('sync')
  if (unavailable) return unavailable

  // P0-03: verify node token OR user JWT
  const authResult = await verifyNodeOrUser(req)
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  const scopedOrgId = authResult.orgId
  const node = authResult.node
  const actor = node.id // use nodeId as actor for sync push

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const { nodeId, changes } = body as { nodeId?: string; changes?: PushChange[] }

  if (!nodeId) {
    return NextResponse.json({ error: 'nodeId is required' }, { status: 422 })
  }
  if (!Array.isArray(changes)) {
    return NextResponse.json({ error: 'changes must be an array' }, { status: 422 })
  }

  // Node is already verified by verifyNodeOrUser — just verify nodeId matches
  if (nodeId !== node.id) {
    return NextResponse.json(
      { error: 'nodeId in body does not match authenticated node' },
      { status: 403 },
    )
  }

  const result: PushResult = { accepted: [], conflicts: [], failed: [] }

  for (const change of changes) {
    try {
      // Idempotency: if we've seen this idempotencyKey and it was ACKED,
      // return the cached result without re-applying.
      const existing = await db.syncOutbox.findUnique({
        where: { idempotencyKey: change.idempotencyKey },
      })
      if (existing?.status === 'ACKED') {
        result.accepted.push({
          idempotencyKey: change.idempotencyKey,
          status: 'ACKED',
          noOp: true,
        })
        continue
      }

      // Record the outbox entry (pending)
      await db.syncOutbox.upsert({
        where: { idempotencyKey: change.idempotencyKey },
        update: {
          status: 'SENT',
          sentAt: new Date().toISOString(),
          attempts: { increment: 1 },
        },
        create: {
          nodeId: node.id,
          organizationId: scopedOrgId,
          entityType: change.entityType,
          entityId: change.entityId,
          operation: change.operation,
          baseVersion: change.baseVersion ?? null,
          entityVersion: change.entityVersion ?? null,
          idempotencyKey: change.idempotencyKey,
          payloadJson: JSON.stringify(change.payload),
          status: 'SENT',
          sentAt: new Date().toISOString(),
        },
      })

      // P1-03: use Central Conflict Policy service to detect conflicts.
      // For now we still don't apply entity changes (Phase 2 will wire the
      // actual entity update), but we DO call detectConflict() so the
      // conflict policy is exercised and SyncConflict records are created
      // when appropriate. This lets us test the conflict flow end-to-end
      // before the full entity-apply logic lands.

      // Load current cloud state of the entity (if it exists).
      // Phase 2: replace with a generic loadScopedEntity() helper.
      let cloudPayload: Record<string, unknown> = {}
      let cloudVersion = 0
      let entityExists = false
      try {
        // Try to load from the entity table (best-effort — Phase 2 will
        // make this a proper generic lookup).
        if (change.entityType === 'Device') {
          const d = await db.device.findFirst({
            where: { id: change.entityId, organizationId: scopedOrgId },
          })
          if (d) {
            cloudPayload = d as unknown as Record<string, unknown>
            cloudVersion = (d as { version?: number }).version ?? 1
            entityExists = true
          }
        }
        // Phase 2: add WorkOrder, StockTransaction, MasterItem, etc.
      } catch {
        // Entity lookup failed — treat as not-found (CREATE scenario)
      }

      const applyResult: ApplyResult = detectConflict(
        change.entityType as SyncableEntity,
        change.operation,
        change.baseVersion,
        cloudVersion,
        cloudPayload,
        change.payload,
      )

      if (applyResult.status === 'REJECTED') {
        // Entity policy rejected the push (e.g. append-only UPDATE)
        await db.syncOutbox.update({
          where: { idempotencyKey: change.idempotencyKey },
          data: { status: 'FAILED', lastError: applyResult.reason },
        })
        result.failed.push({
          idempotencyKey: change.idempotencyKey,
          error: applyResult.reason,
        })
        continue
      }

      if (applyResult.status === 'CONFLICT') {
        // Create SyncConflict record for manual resolution
        const conflict = await db.syncConflict.create({
          data: {
            organizationId: scopedOrgId,
            nodeId: node.id,
            entityType: change.entityType,
            entityId: change.entityId,
            baseVersion: change.baseVersion ?? null,
            cloudVersion,
            offlineVersion: change.entityVersion ?? cloudVersion + 1,
            cloudPayload: JSON.stringify(applyResult.cloudPayload),
            offlinePayload: JSON.stringify(applyResult.offlinePayload),
            conflictFields: JSON.stringify(applyResult.conflictFields),
            status: 'OPEN',
          },
        })
        await db.syncOutbox.update({
          where: { idempotencyKey: change.idempotencyKey },
          data: { status: 'CONFLICT', lastError: `Conflict ${conflict.id}` },
        })
        result.conflicts.push({
          idempotencyKey: change.idempotencyKey,
          conflictId: conflict.id,
          cloudVersion,
          status: 'CONFLICT',
        })
        continue
      }

      // P0-02 fix: actually apply entity changes (CREATE/UPDATE/DELETE)
      // Previously this only ACK'd the outbox without modifying the entity.
      // Now we apply the change in a transaction + audit log.

      // Skip apply if noOp (cloud already has the change — e.g. duplicate push)
      if (!applyResult.noOp) {
        try {
          await getBaseClient().$transaction(async (tx) => {
            const entityType = change.entityType
            const entityId = change.entityId
            const operation = change.operation
            const payload = change.payload

            if (entityType === 'Device') {
              if (operation === 'CREATE') {
                // Create new device with org scope
                await (tx).device.create({
                  data: {
                    id: entityId,
                    organizationId: scopedOrgId,
                    assetCode: (payload.assetCode as string) || `AST-${Date.now()}`,
                    name: (payload.name as string) || 'Untitled',
                    // Device.brand / Device.model are REQUIRED (non-nullable) columns, so a
                    // missing/blank payload value must fall back to '' — writing
                    // null would violate the schema and abort the whole batch.
                    brand: (payload.brand as string) || '',
                    model: (payload.model as string) || '',
                    serialNumber: (payload.serialNumber as string) || null,
                    status: (payload.status as string) || 'Active',
                    site: (payload.site as string) || 'HQ',
                    type: (payload.type as string) || '',
                  },
                })
              } else if (operation === 'UPDATE') {
                // SYNC-05: Check expectedVersion for optimistic concurrency
                if (change.baseVersion !== undefined) {
                  const existing = await (tx).device.findFirst({
                    where: { id: entityId },
                    select: { version: true },
                  })
                  if (existing && existing.version !== change.baseVersion) {
                    throw new Error(`VERSION_CONFLICT: expected ${change.baseVersion}, got ${existing.version}`)
                  }
                }
                // Update existing device (only non-metadata fields)
                const updateData: Record<string, unknown> = {}
                const skipFields = new Set(['id', 'createdAt', 'updatedAt', 'organizationId', 'deletedAt', 'version'])
                for (const [key, value] of Object.entries(payload)) {
                  if (!skipFields.has(key)) {
                    updateData[key] = value
                  }
                }
                // SYNC-05: increment version atomically in transaction
                updateData.version = { increment: 1 }
                await (tx).device.update({
                  where: { id: entityId },
                  data: updateData,
                })
              } else if (operation === 'DELETE') {
                // Soft-delete (tombstone) — L-22: don't hard-delete
                await (tx).device.update({
                  where: { id: entityId },
                  data: { deletedAt: new Date().toISOString() },
                })
              }
            } else {
              // P1-01: reject entity types that don't have an apply adapter
              throw new Error(`UNSUPPORTED_ENTITY: ${entityType} — apply adapter not implemented yet`)
            }

            // Audit log
            await (tx).auditLog.create({
              data: {
                action: `SYNC_PUSH_${operation}`,
                entity: entityType,
                entityId,
                summary: `Sync push ${operation} ${entityType} from node ${node.id}`,
                // AuditLog.detail is a JSON *string* column (String?), not a JSON object —
                // passing an object here would either be rejected by Prisma or
                // persist "[object Object]" and make the audit trail unreadable.
                detail: JSON.stringify({ nodeId: node.id, idempotencyKey: change.idempotencyKey }),
                actor: actor,
              },
            })
          })
        } catch (applyErr) {
          // Entity apply failed — mark outbox as FAILED (not ACKED)
          console.error('sync push: entity apply failed', applyErr)
          await db.syncOutbox.update({
            where: { idempotencyKey: change.idempotencyKey },
            data: {
              status: 'FAILED',
              lastError: applyErr instanceof Error ? applyErr.message : String(applyErr),
            },
          })
          result.failed.push({
            idempotencyKey: change.idempotencyKey,
            error: `Entity apply failed: ${applyErr instanceof Error ? applyErr.message : String(applyErr)}`,
          })
          continue
        }
      }

      // Mark outbox as ACKED (entity was applied or noOp)
      await db.syncOutbox.update({
        where: { idempotencyKey: change.idempotencyKey },
        data: {
          status: 'ACKED',
          ackedAt: new Date().toISOString(),
        },
      })

      result.accepted.push({
        idempotencyKey: change.idempotencyKey,
        newVersion: applyResult.newVersion,
        status: 'ACKED',
        noOp: applyResult.noOp,
      })
    } catch (err) {
      result.failed.push({
        idempotencyKey: change.idempotencyKey,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  await logAudit(
    'SYNC_PUSH',
    'SyncOutbox',
    node.id,
    `Pushed ${changes.length} changes from node ${node.id}: ${result.accepted.length} accepted, ${result.conflicts.length} conflicts, ${result.failed.length} failed`,
    { accepted: result.accepted.length, conflicts: result.conflicts.length, failed: result.failed.length },
    actor,
  )

  return NextResponse.json(result)
}
