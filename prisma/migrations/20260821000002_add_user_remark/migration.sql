-- Migration: Preserve legacy user remark metadata
-- Purpose: align the User row with the shared auth contract and legacy
-- User_Permissions import mapping. The field is nullable and additive.
-- Apply with: prisma migrate deploy (never prisma db push).
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "remark" TEXT;
