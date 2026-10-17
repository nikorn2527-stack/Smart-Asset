import { db } from '@/lib/db'
import { logAudit } from './audit'

/**
 * Records a single audit log entry summarising a BULK operation.
 *
 * Bulk actions (bulk status change, bulk site move, bulk delete) touch many
 * rows but should produce ONE concise audit entry rather than one-per-row.
 *
 * Non-fatal — any DB error is swallowed so the calling mutation still
 * succeeds. All summaries should be in Thai.
 *
 * AuditLog table columns: { action, entity, entityId, summary, detail, actor, createdAt }
 *
 * @param action  Audit action key, e.g. 'BULK_UPDATE', 'BULK_TRANSFER', 'BULK_DELETE'
 * @param entity  Affected entity, e.g. 'Device'
 * @param summary One-line Thai summary
 * @param detail  Optional structured detail (counts, ids, from→to, etc.)
 * @param user    Optional user email (defaults to 'system')
 */
export async function logBulkAudit(
  action: string,
  entity: string,
  summary: string,
  detail?: Record<string, unknown>,
  user?: string | null,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action,
        entity,
        entityId: null,
        summary,
        detail: detail ? JSON.stringify(detail) : null,
        actor: user ?? 'system',
      },
    })
  } catch (err) {
    // Audit logging must never break the user's mutation.
    console.error('logBulkAudit failed:', err)
  }
}

// Re-export logAudit for convenience so callers can import both from one place.
export { logAudit }
