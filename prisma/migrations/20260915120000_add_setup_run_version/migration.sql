-- Add SetupRun.version for optimistic concurrency (P1-04).
-- 1) SetupRun.version — optimistic concurrency for setup runs. Two admins
--    updating the same run concurrently is rejected via the `version`
--    compare-and-swap in PATCH /api/setup/runs/[id] (same pattern as
--    WorkOrder.version / Device.version).
--
-- 2) WorkOrderReview.workOrderId becomes UNIQUE — the review route enforces
--    "one review per work order" with a findUnique-then-create check. Without
--    a DB-level constraint, two concurrent submissions both pass that check
--    and insert duplicate reviews. Existing duplicates are collapsed first
--    (keeping the earliest row per work order) so the UNIQUE index can be
--    created on a non-unique table.
--
-- Both changes are additive/idempotent. Written in the "IF NOT EXISTS" form
-- used by the other version migrations so re-applying is safe.

ALTER TABLE "SetupRun" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "SetupRun_version_idx" ON "SetupRun"("version");

-- Collapse any pre-existing duplicate reviews (keep the earliest per work order).
DELETE FROM "WorkOrderReview"
WHERE "id" NOT IN (
  SELECT "id" FROM (
    SELECT MIN("id") AS "id"
    FROM "WorkOrderReview"
    GROUP BY "workOrderId"
  ) AS keep_rows
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkOrderReview_workOrderId_key"
  ON "WorkOrderReview"("workOrderId");