-- ============================================================
-- Migration: add_license_device_id_and_active
-- Task ID: PUBLIC-QR-PHASE-1-SCHEMA (LicenseRecord real FK + active flag)
--
-- Adds two new nullable/binary columns to license_records:
--   • deviceId TEXT NULL — real FK to Device(id), replaces the legacy
--     Asset_No string lookup. ON DELETE SET NULL so deleting a Device
--     keeps the license record (audit trail) instead of cascading.
--   • isActive BOOLEAN NOT NULL DEFAULT true — used by the replace-device
--     flow: when moveLicenses=false, the licenses on the old device get
--     isActive=false instead of being deleted.
--
-- Additive only — no destructive changes (no DROP, no column renames).
-- Backward compatible: existing rows get deviceId=NULL + isActive=true
-- (the DB defaults). Backfill of deviceId from Asset_No is done in
-- scripts/migrate-license-device-id.ts.
-- ============================================================

-- AlterTable: add nullable deviceId column (only if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'license_records' AND column_name = 'deviceId'
    ) THEN
        ALTER TABLE "license_records" ADD COLUMN "deviceId" TEXT;
    END IF;
END$$;

-- AlterTable: add isActive column (only if missing) — defaults to true so
-- existing rows are considered "active" until the replace flow deactivates them.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'license_records' AND column_name = 'isActive'
    ) THEN
        ALTER TABLE "license_records"
          ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
    END IF;
END$$;

-- CreateIndex: deviceId (only if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'license_records_deviceId_idx'
    ) THEN
        CREATE INDEX "license_records_deviceId_idx" ON "license_records"("deviceId");
    END IF;
END$$;

-- CreateIndex: isActive (only if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'license_records_isActive_idx'
    ) THEN
        CREATE INDEX "license_records_isActive_idx" ON "license_records"("isActive");
    END IF;
END$$;

-- CreateIndex: isDemo (only if missing) — present in schema, may not have a
-- DB index yet on legacy installations.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'license_records_isDemo_idx'
    ) THEN
        CREATE INDEX "license_records_isDemo_idx" ON "license_records"("isDemo");
    END IF;
END$$;

-- AddForeignKey: deviceId → Device(id) ON DELETE SET NULL (only if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'license_records_deviceId_fkey'
    ) THEN
        ALTER TABLE "license_records"
          ADD CONSTRAINT "license_records_deviceId_fkey"
          FOREIGN KEY ("deviceId") REFERENCES "Device"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END$$;
