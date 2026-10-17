-- Migration: Preserve DeviceTransfer department-code fields
-- Purpose: retain the legacy transfer contract while the canonical Prisma
-- names use fromDepartment/toDepartment. The fields are nullable and additive.
-- Apply with: prisma migrate deploy (never prisma db push).
ALTER TABLE "DeviceTransfer"
  ADD COLUMN IF NOT EXISTS "fromDepartmentCode" TEXT;
ALTER TABLE "DeviceTransfer"
  ADD COLUMN IF NOT EXISTS "toDepartmentCode" TEXT;
