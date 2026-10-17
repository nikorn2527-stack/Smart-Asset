-- Migration: Add WorkOrder dual job-number fields
-- Purpose: preserve immutable legacy identifiers while introducing a new
-- ITAM-NextJS system identifier. Existing woNumber remains unchanged for
-- backward compatibility with current APIs, UI, LINE, and public lookup.
-- Apply with: prisma migrate deploy (never prisma db push).

ALTER TABLE "WorkOrder"
  ADD COLUMN IF NOT EXISTS "legacy_job_no" TEXT;

ALTER TABLE "WorkOrder"
  ADD COLUMN IF NOT EXISTS "system_job_no" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "WorkOrder_system_job_no_key"
  ON "WorkOrder"("system_job_no");

CREATE INDEX IF NOT EXISTS "WorkOrder_legacy_job_no_idx"
  ON "WorkOrder"("legacy_job_no");
