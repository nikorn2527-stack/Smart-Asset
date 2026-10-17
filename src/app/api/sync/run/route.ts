// ============================================================
// POST /api/sync/run — Apply previewed changes
// ============================================================
// I-01: Added run ownership + per-item ctx.canAtSite()
// I-05: Conditional versioned create/update with expectedVersion/expectedExists
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { withSerializableRetryTracked } from '@/lib/retry-transaction'
import { redacted } from '@/lib/sync-adapter'
import { logAudit } from '@/lib/audit'
import { isLegacyBridgeModule, type LegacyBridgeModule } from '@/lib/legacy-bridge'
import type { LegacyBridgePreviewItem } from '@/lib/legacy-bridge-preview'
import { applyLegacyBridgeItem, createBridgeAudit } from '@/lib/legacy-bridge-apply'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// Helper: convert JsonValue | null to Prisma Json? input type
function toJsonInput(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === null || value === undefined) {
    return Prisma.JsonNull
  }
  return value as Prisma.InputJsonValue
}

function bridgeModuleFromTarget(target: string): LegacyBridgeModule | null {
  const prefix = 'legacy-bridge:'
  if (!target.startsWith(prefix)) return null
  const candidate = target.slice(prefix.length)
  return isLegacyBridgeModule(candidate) ? candidate : null
}

// Heavy operation — needs longer timeout (Vercel Hobby: max 60s)
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('sync')
  if (unavailable) return unavailable


  // 1. Auth + AuthorizationContext
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const user = auth.user
  const ctx = await buildAuthorizationContext(user, auth.row.id, auth.row.allowedSites)

  // 2. Parse request
  let body: { previewRunId?: string; itemIds?: string[] | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.previewRunId) {
    return NextResponse.json({ error: 'previewRunId required' }, { status: 400 })
  }

  // 3. Load preview run
  const previewRun = await db.syncRun.findUnique({
    where: { id: body.previewRunId },
    include: { items: true },
  })

  if (!previewRun) {
    return NextResponse.json({ error: 'Preview run not found' }, { status: 404 })
  }

  if (previewRun.mode !== 'preview') {
    return NextResponse.json({ error: 'Not a preview run' }, { status: 400 })
  }

  if (previewRun.status !== 'completed') {
    return NextResponse.json({ error: 'Preview run not completed' }, { status: 400 })
  }

  // 4. Run ownership check (I-01)
  // Non-superadmin can only apply their own runs
  if (user.role !== 'superadmin' && previewRun.triggeredBy !== user.email) {
    return NextResponse.json(
      { error: "Cannot apply another user's preview run" },
      { status: 403 },
    )
  }

  // 5. Check siteScope authorization (I-01)
  if (previewRun.siteScope) {
    const siteScopeCodes = previewRun.siteScope.split(',').map((s) => s.trim()).filter(Boolean)
    for (const siteCode of siteScopeCodes) {
      if (!ctx.canAtSite(siteCode, 'ADMIN')) {
        return NextResponse.json(
          { error: `No permission to sync site: ${siteCode}` },
          { status: 403 },
        )
      }
    }
  }

  // 6. Resolve an opt-in bridge target. A malformed namespaced target must
  // fail closed rather than falling through to the WorkOrder writer.
  const isNamespacedBridge = previewRun.target.startsWith('legacy-bridge:')
  const bridgeModule = bridgeModuleFromTarget(previewRun.target)
  if (isNamespacedBridge && !bridgeModule) {
    return NextResponse.json({ error: 'Invalid legacy bridge target' }, { status: 400 })
  }

  // 7. Filter items to apply. Explicit itemIds can never override the
  // pending-only rule for bridge runs; this prevents replaying applied rows.
  const selectedItems = body.itemIds
    ? previewRun.items.filter((item) => body.itemIds!.includes(item.id))
    : previewRun.items
  const itemsToApply = bridgeModule
    ? selectedItems.filter((item) => item.status === 'pending')
    : selectedItems

  if (itemsToApply.length === 0) {
    return NextResponse.json({ error: 'No pending items to apply' }, { status: 400 })
  }

  // 8. Pre-check per-item Site authorization (I-01)
  // Reject items with missing/unknown/out-of-scope site before starting mutations
  const authorizedItems: typeof itemsToApply = []
  const rejectedItems: { id: string; error: string }[] = []

  for (const item of itemsToApply) {
    const afterData = item.after as Record<string, unknown> | null
    const itemSiteCode = (afterData?.siteCode as string)
      || (afterData?.siteAtReading as string)
      || (afterData?.site as string)
      || null

    if (!itemSiteCode) {
      rejectedItems.push({ id: item.id, error: 'MISSING_SITE: no siteCode in item data' })
      continue
    }

    if (!ctx.canAtSite(itemSiteCode, 'ADMIN')) {
      rejectedItems.push({ id: item.id, error: `OUT_OF_SCOPE: site ${itemSiteCode} not in user scope` })
      continue
    }

    authorizedItems.push(item)
  }

  // 9. Create apply SyncRun
  const applyRun = await db.syncRun.create({
    data: {
      source: previewRun.source,
      target: previewRun.target,
      mode: 'apply',
      status: 'running',
      triggeredBy: user.email,
      siteScope: previewRun.siteScope,
      retryOf: null,
    },
  })

  let totalAttempts = 0
  let totalP2034 = 0
  let createRows = 0
  let updateRows = 0
  let errorRows = 0

  // Mark rejected items as error
  for (const rejected of rejectedItems) {
    await db.syncRunItem.create({
      data: {
        syncRunId: applyRun.id,
        externalKey: previewRun.items.find((i) => i.id === rejected.id)?.externalKey || '(unknown)',
        action: 'error',
        status: 'error',
        errorMessage: rejected.error,
        processedAt: new Date(),
      },
    })
    errorRows++
  }

  // 10. Apply each authorized item in separate transaction
  for (const item of authorizedItems) {
    try {
      // Bridge skip is a successful no-op, not a failed mutation.
      if (bridgeModule && item.action === 'skip') {
        await db.syncRunItem.update({
          where: { id: item.id },
          data: { status: 'skipped', processedAt: new Date() },
        })
        await db.syncRunItem.create({
          data: {
            syncRunId: applyRun.id,
            externalKey: item.externalKey,
            action: 'skip',
            before: toJsonInput(item.before),
            after: toJsonInput(item.after),
            expectedVersion: item.expectedVersion,
            expectedExists: item.expectedExists,
            status: 'skipped',
            processedAt: new Date(),
          },
        })
        continue
      }

      const { result, attempts, p2034Count } = await withSerializableRetryTracked(
        async (tx) => {
          if (bridgeModule) {
            const bridgeItem: LegacyBridgePreviewItem = {
              externalKey: item.externalKey,
              action: item.action as LegacyBridgePreviewItem['action'],
              before: item.before as Record<string, unknown> | null,
              after: item.after as Record<string, unknown> | null,
              expectedVersion: item.expectedVersion,
              expectedExists: item.expectedExists,
              siteCode: ((item.after as Record<string, unknown> | null)?.siteCode as string)
                || ((item.after as Record<string, unknown> | null)?.siteAtReading as string)
                || ((item.after as Record<string, unknown> | null)?.site as string)
                || null,
              errorMessage: item.errorMessage || undefined,
            }
            const bridgeResult = await applyLegacyBridgeItem({
              tx,
              module: bridgeModule,
              item: bridgeItem,
              actor: user.email,
              source: previewRun.source,
              applyRunId: applyRun.id,
            })
            await createBridgeAudit(tx, bridgeItem, bridgeResult, previewRun.source, user.email, applyRun.id)
            await tx.syncRunItem.update({
              where: { id: item.id },
              data: {
                status: 'applied',
                entityId: bridgeResult.entityId,
                entityType: bridgeResult.entityType,
                processedAt: new Date(),
              },
            })
            return { targetWorkOrderId: bridgeResult.entityId, bridgeResult }
          } else {
            // Re-check externalKey in transaction (race protection)
          const existing = await tx.workOrder.findUnique({
            where: { requestId: item.externalKey },
            select: { id: true, version: true },
          })

          // Conflict detection with preview baseline (I-05)
          if (item.expectedExists && !existing) {
            throw new Error('CONFLICT: record deleted after preview — re-run preview')
          }
          if (!item.expectedExists && existing) {
            throw new Error('CONFLICT: record created by another source after preview — re-run preview')
          }

          // Parse after data
          const afterData = item.after as Record<string, unknown> | null
          if (!afterData) {
            throw new Error('No after data to apply')
          }

          // B-02 fix: extract subject explicitly — WorkOrder.subject is required.
          // Fail-closed: if subject is missing, reject the item rather than
          // creating an incomplete WorkOrder.
          const subject = afterData.subject as string | undefined
          if (!subject || typeof subject !== 'string' || subject.trim() === '') {
            throw new Error('VALIDATION: subject is required but missing from after payload')
          }

          // Remove metadata fields from apply data
          const { id: _id, createdAt: _ca, updatedAt: _ua, version: _v, ...patch } = afterData as Record<string, unknown>

          let targetWorkOrderId: string

          if (existing) {
            // Conditional update with version check (I-05)
            if (item.expectedVersion != null && existing.version !== item.expectedVersion) {
              throw new Error(
                `CONFLICT: version ${existing.version} ≠ preview baseline ${item.expectedVersion}`,
              )
            }

            const updated = await tx.workOrder.update({
              where: { id: existing.id, version: existing.version },
              data: { ...patch, version: { increment: 1 } },
            })
            targetWorkOrderId = updated.id
          } else {
            // Create — subject is guaranteed non-empty (checked above)
            const created = await tx.workOrder.create({
              data: { ...patch, requestId: item.externalKey, subject },
            })
            targetWorkOrderId = created.id
          }

          // Audit log (in same transaction — atomic)
          const auditDetail = {
            before: redacted(item.before as Record<string, unknown>),
            after: redacted(afterData),
            syncRunId: applyRun.id,
            externalKey: item.externalKey,
          }

          await tx.auditLog.create({
            data: {
              action: 'SYNC_APPLY',
              entity: 'WorkOrder',
              entityId: targetWorkOrderId,
              summary: `Sync ${item.action} from ${previewRun.source} (key=${item.externalKey})`,
              detail: JSON.stringify(auditDetail),
              actor: user.email,
              siteCode: (afterData.siteCode as string) || (afterData.site as string) || null,
            },
          })

          // Update SyncRunItem in same transaction
          await tx.syncRunItem.update({
            where: { id: item.id },
            data: {
              status: 'applied',
              entityId: targetWorkOrderId,
              entityType: 'WorkOrder',
              processedAt: new Date(),
            },
          })

            return { targetWorkOrderId }
          }
        },
      )

      totalAttempts += attempts
      totalP2034 += p2034Count

      if (item.action === 'create') createRows++
      else if (item.action === 'update') updateRows++
    } catch (err) {
      const errorMessage = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : String(err)) : 'Internal server error'

      await db.syncRunItem.update({
        where: { id: item.id },
        data: {
          status: 'error',
          errorMessage,
          processedAt: new Date(),
        },
      })

      errorRows++
    }
  }

  // 11. Update SyncRun with final stats
  const completedAt = new Date()
  await db.syncRun.update({
    where: { id: applyRun.id },
    data: {
      status: errorRows > 0 ? 'completed' : 'completed',
      totalRows: itemsToApply.length,
      createRows,
      updateRows,
      errorRows,
      completedAt,
      durationMs: completedAt.getTime() - applyRun.startedAt.getTime(),
      attempts: totalAttempts,
      p2034Count: totalP2034,
    },
  })

  // 12. Audit log for the run
  await logAudit(
    'SYNC_APPLY',
    'SyncRun',
    applyRun.id,
    `Applied sync from ${previewRun.source} — ${createRows + updateRows} applied, ${errorRows} errors`,
    undefined,
    user.email,
    previewRun.siteScope,
  )

  return NextResponse.json({
    syncRun: {
      id: applyRun.id,
      mode: 'apply',
      status: 'completed',
      totalRows: itemsToApply.length,
      createRows,
      updateRows,
      errorRows,
      durationMs: completedAt.getTime() - applyRun.startedAt.getTime(),
    },
  })
}
