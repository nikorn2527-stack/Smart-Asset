-- Migration: Add WorkOrder.version + AuditLog.siteCode
-- Created: 2026-08-15
-- Task ID: B4-NF1-NF2-PRODUCTION
--
-- This migration adds:
-- 1. WorkOrder.version (Int, default 1) for optimistic concurrency
-- 2. AuditLog.siteCode (String, nullable) for canonical Site FK
-- 3. Indexes for efficient querying
--
-- All changes are additive — no data loss.

-- Add version column to WorkOrder
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

-- Add siteCode column to AuditLog
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "siteCode" TEXT;

-- Create indexes
CREATE INDEX IF NOT EXISTS "WorkOrder_version_idx" ON "WorkOrder"("version");
CREATE INDEX IF NOT EXISTS "AuditLog_siteCode_createdAt_idx" ON "AuditLog"("siteCode", "createdAt");
