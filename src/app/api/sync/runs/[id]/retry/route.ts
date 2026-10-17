// ============================================================
// POST /api/sync/runs/[id]/retry — Retry error items
// ============================================================
// I-02: AuthorizationContext + per-item Site authorization
// I-03: SyncRunItem in same tx as WorkOrder/AuditLog
// I-05: Enforce expectedVersion/expectedExists
// I-06: Accumulate attempts/p2034Count
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { withSerializableRetryTracked } from '@/lib/retry-transaction'
import { redacted } from '@/lib/sync-adapter'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// Helper: convert JsonValue | null to Prisma Json? input type
function toJsonInput(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === null || value === undefined) {
    return Prisma.JsonNull
  }
  return value as Prisma.InputJsonValue
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('sync')
  if (unavailable) return unavailable


  // 1. Auth + AuthorizationContext (I-02)
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const user = auth.user
  const ctx = await buildAuthorizationContext(user, auth.row.id, auth.row.allowedSites)
  const { id } = await params

  // 2. Load original run
  const originalRun = await db.syncRun.findUnique({
    where: { id },
    include: { items: true },
  })

  if (!originalRun) {
    return NextResponse.json({ error: 'SyncRun not found' }, { status: 404 })
  }

  // 3. Run ownership check (I-02)
  if (user.role !== 'superadmin' && originalRun.triggeredBy !== user.email) {
    return NextResponse.json(
      { error: "Cannot retry another user's sync run" },
      { status: 403 },
    )
  }

  // 4. Check siteScope authorization (I-02)
  if (originalRun.siteScope) {
    const siteScopeCodes = originalRun.siteScope.split(',').map((s) => s.trim()).filter(Boolean)
    for (const siteCode of siteScopeCodes) {
      if (!ctx.canAtSite(siteCode, 'ADMIN')) {
        return NextResponse.json(
          { error: `No permission to retry site: ${siteCode}` },
          { status: 403 },
        )
      }
    }
  }

  // 5. Filter error items
  const errorItems = originalRun.items.filter((item) => item.status === 'error')

  if (errorItems.length === 0) {
    return NextResponse.json({ error: 'No error items to retry' }, { status: 400 })
  }

  // 6. Create retry run
  const retryRun = await db.syncRun.create({
    data: {
      source: originalRun.source,
      target: originalRun.target,
      mode: 'apply',
      status: 'running',
      triggeredBy: user.email,
      siteScope: originalRun.siteScope,
      retryOf: originalRun.id,
    },
  })

  let totalAttempts = 0
  let totalP2034 = 0
  let appliedCount = 0
  let errorCount = 0

  // 7. Retry each item (I-02, I-03, I-05, I-06)
  for (const item of errorItems) {
    // Per-item Site authorization check (I-02)
    const afterData = item.after as Record<string, unknown> | null
    const itemSiteCode = (afterData?.siteCode as string) || (afterData?.site as string) || null

    if (!itemSiteCode) {
      // Create error item OUTSIDE transaction (this is intentional error recording)
      await db.syncRunItem.create({
        data: {
          syncRunId: retryRun.id,
          externalKey: item.externalKey,
          action: item.action,
          before: toJsonInput(item.before),
          after: toJsonInput(item.after),
          expectedVersion: item.expectedVersion,
          expectedExists: item.expectedExists,
          status: 'error',
          errorMessage: 'MISSING_SITE: no siteCode in item data',
          processedAt: new Date(),
        },
      })
      errorCount++
      continue
    }

    if (!ctx.canAtSite(itemSiteCode, 'ADMIN')) {
      await db.syncRunItem.create({
        data: {
          syncRunId: retryRun.id,
          externalKey: item.externalKey,
          action: item.action,
          before: toJsonInput(item.before),
          after: toJsonInput(item.after),
          expectedVersion: item.expectedVersion,
          expectedExists: item.expectedExists,
          status: 'error',
          errorMessage: `OUT_OF_SCOPE: site ${itemSiteCode} not in user scope`,
          processedAt: new Date(),
        },
      })
      errorCount++
      continue
    }

    // Apply in transaction (I-03: all writes in same tx)
    try {
      const { attempts, p2034Count } = await withSerializableRetryTracked(
        async (tx) => {
          // Re-check in transaction
          const existing = await tx.workOrder.findUnique({
            where: { requestId: item.externalKey },
            select: { id: true, version: true },
          })

          // Conflict detection with original preview baseline (I-05)
          if (item.expectedExists && !existing) {
            throw new Error('CONFLICT: record deleted since preview — re-run preview')
          }
          if (!item.expectedExists && existing) {
            throw new Error('CONFLICT: record created by another source since preview — re-run preview')
          }

          if (!afterData) {
            throw new Error('No after data to apply')
          }

          // B-02 fix: extract subject explicitly — WorkOrder.subject is required.
          const subject = afterData.subject as string | undefined
          if (!subject || typeof subject !== 'string' || subject.trim() === '') {
            throw new Error('VALIDATION: subject is required but missing from after payload')
          }

          const { id: _id, createdAt: _ca, updatedAt: _ua, version: _v, ...patch } = afterData as Record<string, unknown>

          let targetWorkOrderId: string

          if (existing) {
            // I-05: Enforce expectedVersion
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
            const created = await tx.workOrder.create({
              data: { ...patch, requestId: item.externalKey, subject },
            })
            targetWorkOrderId = created.id
          }

          // Audit log in same transaction
          await tx.auditLog.create({
            data: {
              action: 'SYNC_APPLY',
              entity: 'WorkOrder',
              entityId: targetWorkOrderId,
              summary: `Sync retry from ${originalRun.source} (key=${item.externalKey})`,
              detail: JSON.stringify({
                before: redacted(item.before as Record<string, unknown>),
                after: redacted(afterData),
                syncRunId: retryRun.id,
                externalKey: item.externalKey,
                retryOf: originalRun.id,
              }),
              actor: user.email,
              siteCode: itemSiteCode,
            },
          })

          // I-03: SyncRunItem in SAME transaction
          await tx.syncRunItem.create({
            data: {
              syncRunId: retryRun.id,
              externalKey: item.externalKey,
              action: item.action,
              before: toJsonInput(item.before),
              after: toJsonInput(item.after),
              expectedVersion: item.expectedVersion,
              expectedExists: item.expectedExists,
              status: 'applied',
              entityId: targetWorkOrderId,
              entityType: 'WorkOrder',
              processedAt: new Date(),
            },
          })

          return { targetWorkOrderId }
        },
      )

      // I-06: Accumulate attempts/p2034Count
      totalAttempts += attempts
      totalP2034 += p2034Count
      appliedCount++
    } catch (err) {
      // Error item recorded outside transaction (intentional — not a business apply)
      await db.syncRunItem.create({
        data: {
          syncRunId: retryRun.id,
          externalKey: item.externalKey,
          action: item.action,
          before: toJsonInput(item.before),
          after: toJsonInput(item.after),
          expectedVersion: item.expectedVersion,
          expectedExists: item.expectedExists,
          status: 'error',
          errorMessage: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : String(err)) : 'Internal server error',
          processedAt: new Date(),
        },
      })
      errorCount++
    }
  }

  // 8. Update retry run with stats (I-06: include attempts/p2034Count)
  const completedAt = new Date()
  await db.syncRun.update({
    where: { id: retryRun.id },
    data: {
      status: 'completed',
      totalRows: errorItems.length,
      createRows: 0,
      updateRows: appliedCount,
      errorRows: errorCount,
      completedAt,
      durationMs: completedAt.getTime() - retryRun.startedAt.getTime(),
      attempts: totalAttempts,
      p2034Count: totalP2034,
    },
  })

  await logAudit(
    'SYNC_APPLY',
    'SyncRun',
    retryRun.id,
    `Retry sync from ${originalRun.source} — ${appliedCount} applied, ${errorCount} errors`,
    undefined,
    user.email,
    originalRun.siteScope,
  )

  return NextResponse.json({
    syncRun: {
      id: retryRun.id,
      mode: 'apply',
      status: 'completed',
      retryOf: originalRun.id,
      totalRows: errorItems.length,
      updateRows: appliedCount,
      errorRows: errorCount,
    },
  })
}
