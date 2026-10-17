import { db } from '@/lib/db'

/**
 * Records an audit log entry. Non-fatal — any DB error is swallowed so
 * the calling mutation still succeeds. All summaries should be in Thai.
 *
 * AuditLog table columns (PostgreSQL camelCase):
 *   id, action, entity, entityId, summary, detail, actor, siteCode, createdAt
 *
 * `createdAt` has a DB default (`now()`) so we don't set it manually.
 * `actor` defaults to 'system' when no user is supplied.
 * `siteCode` is optional — populate it for Site-scoped actions so that
 *   Site-scoped queries can filter on `AuditLog.siteCode` directly
 *   instead of resolving `entityId` → entity → Site (NF-2 fix).
 */
export async function logAudit(
  action: string,
  entity: string,
  /**
   * Target row id. `undefined` is accepted as well as `null` for callers that
   * only conditionally have an id (e.g. bulk seed operations that create rows
   * with generated ids) — it is coerced to null below.
   */
  entityId: string | null | undefined,
  summary: string,
  detail?: Record<string, unknown>,
  user?: string | null,
  siteCode?: string | null,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action,
        entity,
        entityId: entityId ?? null,
        summary,
        detail: detail ? JSON.stringify(detail) : null,
        actor: user ?? 'system',
        siteCode: siteCode ?? null,
      },
    })
  } catch (err) {
    // Audit logging must never break the user's mutation.
    console.error('logAudit failed:', err)
  }
}
