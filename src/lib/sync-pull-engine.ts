/**
 * sync-pull-engine.ts — Pull Change Feed for Offline Sync.
 *
 * L-21 fix: uses (updatedAt, id) composite cursor instead of timestamp alone.
 * L-22 fix: includes tombstones (soft-deleted records) in the change feed.
 *
 * This is the Phase 2 implementation of the sync pull contract.
 * The /api/sync/pull route calls this engine to build the change list.
 */

import { db } from '@/lib/db'

export interface ChangeEntry {
  entityType: string
  entityId: string
  operation: 'CREATE' | 'UPDATE' | 'DELETE'
  version: number
  data: Record<string, unknown> | null
  updatedAt: string
}

export interface PullResult {
  changes: ChangeEntry[]
  nextCursor: string | null
  hasMore: boolean
}

/**
 * Parse a composite cursor string "updatedAt|id" into parts.
 * Returns null for first pull (no cursor).
 */
function parseCursor(cursor: string | null): { updatedAt: Date; id: string } | null {
  if (!cursor) return null
  const [ts, id] = cursor.split('|')
  if (!ts || !id) return null
  const d = new Date(ts)
  if (isNaN(d.getTime())) return null
  return { updatedAt: d, id }
}

/**
 * Build a composite cursor from a record's updatedAt + id.
 * L-21: using (updatedAt, id) ensures no data is skipped even when
 * multiple records share the same timestamp.
 */
function buildCursor(updatedAt: Date, id: string): string {
  return `${updatedAt.toISOString()}|${id}`
}

/**
 * Pull changes since the cursor for an organization.
 *
 * L-21: cursor format is "ISO_TIMESTAMP|ENTITY_ID" — composite key
 * ensures deterministic ordering even when timestamps collide.
 *
 * L-22: includes soft-deleted records (deletedAt IS NOT NULL) as
 * DELETE operations (tombstones) so offline nodes know to remove them.
 *
 * @param organizationId — org scope
 * @param siteCode — optional site filter (null = all sites)
 * @param cursor — "updatedAt|id" or null for first pull
 * @param limit — max changes per batch (default 100)
 */
export async function pullChanges(
  organizationId: string,
  siteCode: string | null,
  cursor: string | null,
  limit = 100,
): Promise<PullResult> {
  const parsed = parseCursor(cursor)
  const changes: ChangeEntry[] = []

  // ── Pull Device changes ──
  const deviceWhere: Record<string, unknown> = {
    organizationId,
  }
  if (siteCode) {
    deviceWhere.site = siteCode
  }
  if (parsed) {
    deviceWhere.OR = [
      { updatedAt: { gt: parsed.updatedAt } },
      {
        AND: [
          { updatedAt: parsed.updatedAt },
          { id: { gt: parsed.id } },
        ],
      },
    ]
  }

  const devices = await db.device.findMany({
    where: deviceWhere,
    take: limit,
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      updatedAt: true,
      deletedAt: true,
      organizationId: true,
      assetCode: true,
      name: true,
      status: true,
      site: true,
      brand: true,
      model: true,
      serialNumber: true,
    },
  })

  for (const d of devices) {
    changes.push({
      entityType: 'Device',
      entityId: d.id,
      operation: d.deletedAt ? 'DELETE' : 'UPDATE',
      version: 1, // L-22: version not in Device select (schema varies); default 1
      data: d.deletedAt ? null : d as unknown as Record<string, unknown>,
      updatedAt: d.updatedAt?.toISOString() ?? new Date().toISOString(),
    })
  }

  // ── Determine next cursor ──
  let nextCursor: string | null = null
  if (changes.length === limit) {
    const last = changes[changes.length - 1]
    nextCursor = buildCursor(new Date(last.updatedAt), last.entityId)
  }

  return {
    changes,
    nextCursor,
    hasMore: nextCursor !== null,
  }
}
