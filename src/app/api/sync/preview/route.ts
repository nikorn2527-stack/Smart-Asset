// ============================================================
// POST /api/sync/preview — Preview changes (read-only)
// ============================================================
// Server-side pull from Apps Script → compute diff → store in SyncRun/SyncRunItem
// Does NOT write to WorkOrder/Device/StockItem tables.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { fetchFromAppsScript, computePreviewItems, redacted } from '@/lib/sync-adapter'
import { computeServicesWorkOrderPreview } from '@/lib/services-work-order-preview'
import { adaptLegacyRecords, isLegacyBridgeModule, type LegacyBridgeModule } from '@/lib/legacy-bridge'
import { computeLegacyBridgePreviewItems } from '@/lib/legacy-bridge-preview'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// Helper: convert JsonValue | null to Prisma Json? input type
function toJsonInput(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === null || value === undefined) {
    return Prisma.JsonNull
  }
  return value as Prisma.InputJsonValue
}

// Heavy operation — needs longer timeout (Vercel Hobby: max 60s)
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('sync')
  if (unavailable) return unavailable


  // 1. Auth — use ADMIN (not SYNC_RUN, B4 frozen rule)
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const user = auth.user

  // 2. Build authorization context
  const ctx = await buildAuthorizationContext(user, auth.row.id, auth.row.allowedSites)

  // 3. Parse request
  let body: { source?: string; target?: string; module?: string; options?: { since?: string; siteFilter?: string; limit?: number } }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const source = body.source || 'services'
  const requestedTarget = body.target || 'work-order'
  // Bridge mode is deliberately opt-in. Existing callers that send only
  // target=work-order must keep the established WorkOrder preview semantics.
  const requestedModule = typeof body.module === 'string' ? body.module : null
  const isBridgeTarget = requestedModule !== null && isLegacyBridgeModule(requestedModule)
  const bridgeModule = isBridgeTarget ? requestedModule as LegacyBridgeModule : null
  // Persist a namespaced bridge target so apply cannot confuse the legacy
  // WorkOrder path (target=work-order) with the opt-in bridge module.
  const target = bridgeModule ? `legacy-bridge:${bridgeModule}` : requestedTarget
  const options = body.options || {}

  // 4. Site scope for non-superadmin
  let siteScope: string[] | undefined
  if (user.role !== 'superadmin' && ctx.siteScope?.siteCodes) {
    siteScope = ctx.siteScope.siteCodes
  }

  // 5. Check siteFilter authorization
  if (options.siteFilter) {
    if (!ctx.canAtSite(options.siteFilter, 'ADMIN')) {
      return NextResponse.json(
        { error: `No permission to sync site: ${options.siteFilter}` },
        { status: 403 },
      )
    }
  }

  // 6. Create SyncRun (mode=preview, status=running)
  const syncRun = await db.syncRun.create({
    data: {
      source,
      target,
      mode: 'preview',
      status: 'running',
      triggeredBy: user.email,
      siteScope: options.siteFilter || (siteScope ? siteScope.join(',') : null),
    },
  })

  try {
    // 7. Fetch from source (server-side)
    const result = await fetchFromAppsScript({
      source,
      since: options.since,
      siteFilter: options.siteFilter,
      limit: options.limit || 500,
    })

    // 8. Compute preview items (read-only — no business table writes)
    const previewDb = db as unknown as Parameters<typeof computePreviewItems>[1]
    const isServicesWorkOrder = source === 'services' && target === 'work-order'
    const repairPreview = isServicesWorkOrder
      ? await computeServicesWorkOrderPreview(result.records, previewDb, siteScope)
      : null
    const bridgePreview = bridgeModule
      ? await (async () => {
          const adapted = adaptLegacyRecords(source, bridgeModule, result.records)
          const items = await computeLegacyBridgePreviewItems(
            adapted.ready,
            adapted.quarantine,
            db as unknown as Parameters<typeof computeLegacyBridgePreviewItems>[2],
            siteScope,
          )
          return { items, unmappedColumns: [...new Set([...result.metadata.unmappedColumns, ...adapted.unmappedColumns])], quarantinedRows: adapted.quarantine.length }
        })()
      : null
    const previewItems = bridgePreview?.items || repairPreview?.items || await computePreviewItems(
      result.records,
      previewDb,
      siteScope,
    )

    // 9. Count stats
    let createRows = 0
    let updateRows = 0
    let skipRows = 0
    let errorRows = 0

    for (const item of previewItems) {
      if (item.action === 'create') createRows++
      else if (item.action === 'update') updateRows++
      else if (item.action === 'skip') skipRows++
      else if (item.action === 'error') errorRows++
    }

    // 10. Create SyncRunItems
    await db.syncRunItem.createMany({
      data: previewItems.map((item) => ({
        syncRunId: syncRun.id,
        externalKey: item.externalKey,
        action: item.action,
        before: toJsonInput(item.before),
        after: toJsonInput(item.after),
        expectedVersion: item.expectedVersion,
        expectedExists: item.expectedExists,
        status: item.action === 'error' ? 'error' : 'pending',
        errorMessage: item.errorMessage || null,
      })),
    })

    // 11. Update SyncRun with stats
    const completedAt = new Date()
    await db.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: 'completed',
        totalRows: previewItems.length,
        createRows,
        updateRows,
        skipRows,
        errorRows,
        completedAt,
        durationMs: completedAt.getTime() - syncRun.startedAt.getTime(),
        sourceCursor: result.metadata.cursor,
      },
    })

    // 12. Audit log
    await logAudit(
      'SYNC_PREVIEW',
      'SyncRun',
      syncRun.id,
      `Preview sync from ${source} — ${previewItems.length} rows (${createRows} create, ${updateRows} update, ${skipRows} skip, ${errorRows} error)`,
      undefined,
      user.email,
      options.siteFilter || null,
    )

    // 13. Return result
    const items = await db.syncRunItem.findMany({
      where: { syncRunId: syncRun.id },
      orderBy: { id: 'asc' },
    })

    return NextResponse.json({
      syncRun: {
        id: syncRun.id,
        mode: 'preview',
        status: 'completed',
        totalRows: previewItems.length,
        createRows,
        updateRows,
        skipRows,
        errorRows,
        durationMs: completedAt.getTime() - syncRun.startedAt.getTime(),
      },
      items: items.map((item) => ({
        id: item.id,
        externalKey: item.externalKey,
        action: item.action,
        status: item.status,
        before: item.before,
        after: item.after,
        errorMessage: item.errorMessage,
      })),
      sourceMetadata: {
        totalFetched: result.metadata.totalFetched,
        unmappedColumns: bridgePreview?.unmappedColumns || repairPreview?.unmappedColumns || result.metadata.unmappedColumns,
        quarantinedRows: bridgePreview?.quarantinedRows || repairPreview?.quarantinedRows || 0,
      },
    })
  } catch (err) {
    const errorMessage = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : String(err)) : 'Internal server error'

    await db.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: 'failed',
        errorMessage,
        completedAt: new Date(),
      },
    })

    return NextResponse.json(
      { error: errorMessage, syncRunId: syncRun.id },
      { status: 500 },
    )
  }
}
