import { NextRequest, NextResponse } from 'next/server'
import { db, getBaseClient } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { getOrgScope } from '@/lib/org-scope'
import { logAudit } from '@/lib/audit'
import { chooseResolutionPayload } from '@/lib/sync-conflict-policy'

/**
 * POST /api/sync/conflicts/[id]/resolve
 *   Resolve a sync conflict (admin chooses cloud, offline, merged, or reject).
 *
 * L-17 fix: Resolve now runs in a transaction that updates:
 *   1. The entity itself (Device/WorkOrder/etc.) with chosen payload
 *   2. Bumps entity version
 *   3. Marks conflict as RESOLVED
 *   4. Marks originating outbox entry as ACKED
 *   5. Writes audit log
 *
 * Body: { resolution: 'CLOUD' | 'OFFLINE' | 'MERGED' | 'REJECTED',
 *         mergedPayload?, expectedCloudVersion? }
 */
interface Params {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: Params) {
  const unavailable = await moduleUnavailableResponse('sync')
  if (unavailable) return unavailable

  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const orgScope = getOrgScope(auth.user)
  if (!orgScope.ok) {
    return NextResponse.json(
      { error: orgScope.error.message },
      { status: orgScope.error.status },
    )
  }

  const { id: conflictId } = await params
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const { resolution, mergedPayload, expectedCloudVersion } = body as {
    resolution?: string
    mergedPayload?: Record<string, unknown>
    expectedCloudVersion?: number
  }

  if (!resolution || !['CLOUD', 'OFFLINE', 'MERGED', 'REJECTED'].includes(resolution)) {
    return NextResponse.json(
      { error: 'resolution must be CLOUD, OFFLINE, MERGED, or REJECTED' },
      { status: 422 },
    )
  }

  // Scope the conflict by org (superadmin bypass)
  const where =
    auth.user.role === 'superadmin'
      ? { id: conflictId }
      : { id: conflictId, organizationId: orgScope.organizationId }

  // L-17: run the entire resolve in a transaction
  try {
    const result = await getBaseClient().$transaction(async (tx) => {
      const conflict = await (tx).syncConflict.findFirst({ where })
      if (!conflict) {
        throw new Error('CONFLICT_NOT_FOUND')
      }
      if (conflict.status !== 'OPEN') {
        throw new Error(`CONFLICT_ALREADY_${conflict.status}`)
      }

      // Optimistic concurrency
      if (expectedCloudVersion !== undefined && conflict.cloudVersion !== expectedCloudVersion) {
        throw new Error('VERSION_CONFLICT')
      }

      const actor = auth.row.username ?? auth.user.email

      // If REJECTED, just mark and return (no entity update)
      if (resolution === 'REJECTED') {
        const updated = await (tx).syncConflict.update({
          where: { id: conflict.id },
          data: {
            status: 'REJECTED',
            resolution,
            resolvedBy: actor,
            resolvedAt: new Date().toISOString(),
          },
        })
        return { conflict: updated, entityUpdated: false }
      }

      // L-17: choose payload + update entity
      const chosenPayload = chooseResolutionPayload(
        resolution as 'CLOUD' | 'OFFLINE' | 'MERGED',
        {
          cloudPayload: conflict.cloudPayload,
          offlinePayload: conflict.offlinePayload,
        },
        mergedPayload,
      )

      // P1-04: Update entity — only Device has adapter; reject others
      if (chosenPayload) {
        if (conflict.entityType === 'Device') {
          const entityId = conflict.entityId
          const existingDevice = await (tx).device.findFirst({
            where: { id: entityId, organizationId: conflict.organizationId },
          })
          if (existingDevice) {
            // Apply chosen payload (only non-metadata fields)
            const updateData: Record<string, unknown> = {}
            const skipFields = new Set(['id', 'createdAt', 'updatedAt', 'organizationId', 'deletedAt', 'version'])
            for (const [key, value] of Object.entries(chosenPayload)) {
              if (!skipFields.has(key)) {
                updateData[key] = value
              }
            }
            // Bump version
            updateData.version = { increment: 1 }

            await (tx).device.update({
              where: { id: entityId },
              data: updateData,
            })
          }
        } else {
          // P1-04: reject entity types that don't have a resolve adapter
          throw new Error(`UNSUPPORTED_ENTITY: ${conflict.entityType} — resolve adapter not implemented`)
        }
      }

      // Mark conflict as resolved
      const updated = await (tx).syncConflict.update({
        where: { id: conflict.id },
        data: {
          status: 'RESOLVED',
          resolution,
          resolvedBy: actor,
          resolvedAt: new Date().toISOString(),
        },
      })

      // Mark originating outbox entry as ACKED
      if (conflict.nodeId) {
        await (tx).syncOutbox.updateMany({
          where: {
            nodeId: conflict.nodeId,
            entityId: conflict.entityId,
            entityType: conflict.entityType,
            status: 'CONFLICT',
          },
          data: { status: 'ACKED', ackedAt: new Date().toISOString() },
        })
      }

      // Audit log
      await (tx).auditLog.create({
        data: {
          action: 'SYNC_CONFLICT_RESOLVE',
          entity: conflict.entityType,
          entityId: conflict.entityId,
          summary: `Resolved conflict: ${resolution} (entity ${conflict.entityType}:${conflict.entityId})`,
          // AuditLog.detail is a JSON *string* column (String?), not an object.
          detail: JSON.stringify({ resolution, actor, conflictId: conflict.id }),
          actor,
        },
      })

      return { conflict: updated, entityUpdated: true }
    })

    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'CONFLICT_NOT_FOUND') {
      return NextResponse.json(
        { error: 'Conflict not found in your organization' },
        { status: 404 },
      )
    }
    if (msg.startsWith('CONFLICT_ALREADY_')) {
      return NextResponse.json(
        { error: 'Conflict is already resolved', currentStatus: msg.replace('CONFLICT_ALREADY_', '') },
        { status: 422 },
      )
    }
    if (msg === 'VERSION_CONFLICT') {
      return NextResponse.json(
        { error: 'Conflict changed; reload before resolving', code: 'VERSION_CONFLICT' },
        { status: 409 },
      )
    }
    console.error('conflict resolve error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
