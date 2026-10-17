-- P0-02: Add version column to Device table for optimistic concurrency (sync)
-- L-32: allows push/pull to track entity version for conflict detection

ALTER TABLE "Device" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
