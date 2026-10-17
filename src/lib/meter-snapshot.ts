/**
 * Meter Snapshot Service (aligned with Apps Script MeterSnapshotService.gs).
 *
 * Creates immutable, SHA-256-hashed snapshots of meter readings when a cycle
 * is CLOSED. This prevents retroactive edits from silently changing historical
 * billing data.
 *
 * Lifecycle:
 *   1. Cycle OPEN → readings can be added/edited freely
 *   2. Cycle CLOSE → createMeterReportSnapshot(month) is called BEFORE writing
 *      Status='CLOSED'. If snapshot creation fails, the cycle stays OPEN.
 *   3. CLOSED month → readings are read-only (enforced by assertMeterMonthWritable)
 *   4. Amendment → if a correction is needed, a NEW snapshot revision is created
 *      (the original is never overwritten, only marked SUPERSEDED)
 *
 * Storage:
 *   • MeterReportSnapshot — metadata (1 row per snapshot)   ⚠️ NOT IN SCHEMA
 *   • MeterReportSnapshotRow — frozen reading data (N rows)  ⚠️ NOT IN SCHEMA
 *   • MeterReportAmendment — audit trail for corrections      ✅ exists
 *
 * ⚠️ FEATURE STATUS — snapshot-on-close is DISABLED
 * -------------------------------------------------------------------------
 * `MeterReportSnapshot` and `MeterReportSnapshotRow` were removed from
 * `prisma/schema.prisma` and have NOT been restored. Consequently
 * `createMeterReportSnapshot()` and `verifyMeterReportSnapshot()` are
 * no-op stubs that return `null`.
 *
 * The billing-integrity protection that DOES still work is
 * `assertMeterMonthWritable()` below, which refuses writes to any month
 * overlapped by a CLOSED cycle. That cycle-lock is the only active
 * guard against retroactive edits to historical meter data.
 *
 * To re-enable snapshot-on-close:
 *   1. Re-add the `MeterReportSnapshot` + `MeterReportSnapshotRow` models
 *      to `prisma/schema.prisma` (see worklog.md ~line 4121 for the
 *      original definitions).
 *   2. Create + apply a Prisma migration (`prisma migrate deploy`).
 *   3. Restore the previous bodies of `createMeterReportSnapshot()` and
 *      `verifyMeterReportSnapshot()` from git history
 *      (`git show <ref>:src/lib/meter-snapshot.ts`), renaming
 *      `SiteAttribute.SiteName → siteName` and
 *      `PaperRateBW/PaperRateColor → paperRateBw/paperRateColor`
 *      to match the current lower-camelCase schema.
 *
 * NOTE: This file deliberately contains NO references to
 * `db.meterReportSnapshot` / `db.meterReportSnapshotRow`, because those
 * models do not exist in the Prisma client and would fail both typecheck
 * and runtime validation.
 */

import { db } from '@/lib/db'

/**
 * Result shape returned when a snapshot IS successfully created.
 * Kept narrow on purpose — callers only need identity + integrity proof.
 */
export interface MeterSnapshotSummary {
  snapshotId: string
  contentHash: string
  rowCount: number
}

/**
 * Create an immutable snapshot of all meter readings for a given cycle month.
 *
 * Called by the cycle-close flow BEFORE writing Status='CLOSED'.
 *
 * ⚠️ Currently a no-op stub: the underlying snapshot tables are absent from
 * the Prisma schema, so this returns `null` instead of throwing.
 *
 * Callers MUST treat a `null` return as "snapshot skipped" and must not
 * assume immutability was established by this call.
 *
 * @param cycleMonth - e.g. "2026-08"
 * @param createdBy  - user email
 * @returns the snapshot summary, or `null` when snapshots are unavailable
 */
export async function createMeterReportSnapshot(
  cycleMonth: string,
  createdBy: string,
): Promise<MeterSnapshotSummary | null> {
  console.warn(
    '[meter-snapshot] snapshot-on-close is DISABLED: MeterReportSnapshot tables ' +
      'are not present in prisma/schema.prisma. No immutable snapshot was written ' +
      `for cycleMonth=${cycleMonth} (requested by ${createdBy}). ` +
      'Cycle-lock enforcement (assertMeterMonthWritable) remains the only ' +
      'protection against retroactive edits.',
  )
  return null
}

/**
 * Verify a snapshot's integrity by re-computing its content hash and
 * comparing against the stored hash.
 *
 * ⚠️ Currently a no-op stub (snapshot tables absent) — always returns `null`,
 * which callers should read as "integrity could not be verified".
 *
 * @param cycleMonth - e.g. "2026-08"
 */
export async function verifyMeterReportSnapshot(
  cycleMonth: string,
): Promise<{
  verified: boolean
  snapshotId: string
  storedHash: string
  computedHash: string
} | null> {
  console.warn(
    '[meter-snapshot] verifyMeterReportSnapshot is DISABLED (snapshot tables ' +
      `absent). Cannot verify integrity for cycleMonth=${cycleMonth}.`,
  )
  return null
}

/**
 * Assert that a meter-reading month is writable (cycle is OPEN).
 * Throws if the cycle for the given month is CLOSED — preventing retroactive
 * edits to frozen billing data.
 *
 * Aligned with Apps Script assertMeterMonthWritable (commit 67f8e54).
 *
 * @param month - e.g. "2026-08"
 * @param actionLabel - description of the attempted action (for error message)
 */
export async function assertMeterMonthWritable(
  month: string,
  actionLabel: string,
): Promise<void> {
  // Find the cycle whose date range contains this month
  const cycles = await db.cycle.findMany({
    where: {
      OR: [
        { status: 'CLOSED' },
        { status: 'closed' },
      ],
    },
  })

  // Check if any CLOSED cycle's date range overlaps this month
  const monthStart = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const monthEnd = `${month}-${String(daysInMonth).padStart(2, '0')}`

  for (const c of cycles) {
    // Cycle range overlaps month range?
    if (c.startDate <= monthEnd && c.endDate >= monthStart) {
      throw new Error(
        `ไม่สามารถ${actionLabel}ได้: รอบจดมิเตอร์ ${c.name} (${c.startDate} → ${c.endDate}) ถูกปิดและสร้าง snapshot แล้ว — ข้อมูลถูกล็อกเพื่อความถูกต้องของการเรียกเก็บเงิน`,
      )
    }
  }
}
