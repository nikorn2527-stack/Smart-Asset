-- ============================================================
-- Migration: multi_org_foundation
-- ตามพิมพ์เขียวที่ปรึกษา — additive only (no data loss)
-- ============================================================

-- 1. Organization table
CREATE TABLE IF NOT EXISTS "Organization" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "type" TEXT,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  "currency" TEXT NOT NULL DEFAULT 'THB',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "address" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "logoUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Organization_active_idx" ON "Organization"("active");

-- 2. LegacyReference table
CREATE TABLE IF NOT EXISTS "LegacyReference" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL DEFAULT 'default',
  "sourceApp" TEXT NOT NULL,
  "sourceSheet" TEXT,
  "sourceEntity" TEXT NOT NULL,
  "sourceRecordId" TEXT,
  "legacyCode" TEXT NOT NULL,
  "legacyLabel" TEXT,
  "targetEntity" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "targetCode" TEXT,
  "mappingStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  "mappingNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LegacyReference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LegacyReference_org_app_entity_code_key"
  ON "LegacyReference"("organizationId", "sourceApp", "sourceEntity", "legacyCode");
CREATE INDEX IF NOT EXISTS "LegacyReference_target_idx" ON "LegacyReference"("targetEntity", "targetId");
CREATE INDEX IF NOT EXISTS "LegacyReference_org_legacy_idx" ON "LegacyReference"("organizationId", "legacyCode");

-- 3. SetupRun table
CREATE TABLE IF NOT EXISTS "SetupRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "currentStep" TEXT,
  "startedBy" TEXT NOT NULL,
  "completedBy" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  CONSTRAINT "SetupRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SetupRun_org_status_idx" ON "SetupRun"("organizationId", "status");

-- 4. SetupStep table
CREATE TABLE IF NOT EXISTS "SetupStep" (
  "id" TEXT NOT NULL,
  "setupRunId" TEXT NOT NULL,
  "stepKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "inputHash" TEXT,
  "resultJson" JSONB,
  "errorMessage" TEXT,
  "completedBy" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "SetupStep_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SetupStep_setupRunId_fkey" FOREIGN KEY ("setupRunId") REFERENCES "SetupRun"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "SetupStep_run_key_key" ON "SetupStep"("setupRunId", "stepKey");
CREATE INDEX IF NOT EXISTS "SetupStep_status_idx" ON "SetupStep"("status");

-- 5. CustomFieldDefinition table
CREATE TABLE IF NOT EXISTS "CustomFieldDefinition" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL DEFAULT 'default',
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "targetEntity" TEXT NOT NULL,
  "fieldType" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "section" TEXT,
  "placeholder" TEXT,
  "validationJson" JSONB,
  "visibilityJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomFieldDefinition_org_entity_key_key"
  ON "CustomFieldDefinition"("organizationId", "targetEntity", "key");
CREATE INDEX IF NOT EXISTS "CustomFieldDefinition_org_entity_active_idx"
  ON "CustomFieldDefinition"("organizationId", "targetEntity", "active");

-- 6. CustomFieldOption table
CREATE TABLE IF NOT EXISTS "CustomFieldOption" (
  "id" TEXT NOT NULL,
  "fieldId" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "CustomFieldOption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomFieldOption_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "CustomFieldDefinition"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomFieldOption_field_value_key" ON "CustomFieldOption"("fieldId", "value");
CREATE INDEX IF NOT EXISTS "CustomFieldOption_field_active_idx" ON "CustomFieldOption"("fieldId", "active");

-- 7. CustomFieldValue table
CREATE TABLE IF NOT EXISTS "CustomFieldValue" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL DEFAULT 'default',
  "fieldId" TEXT NOT NULL,
  "targetEntity" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "valueJson" JSONB NOT NULL,
  "valueText" TEXT,
  "valueNumber" DECIMAL(65,30),
  "valueDate" TIMESTAMP(3),
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "CustomFieldDefinition"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomFieldValue_org_field_target_key"
  ON "CustomFieldValue"("organizationId", "fieldId", "targetEntity", "targetId");
CREATE INDEX IF NOT EXISTS "CustomFieldValue_org_target_idx"
  ON "CustomFieldValue"("organizationId", "targetEntity", "targetId");
CREATE INDEX IF NOT EXISTS "CustomFieldValue_field_text_idx"
  ON "CustomFieldValue"("fieldId", "valueText");

-- 8. Add organizationId + legacy fields to business tables (nullable for migration)
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "legacyAssetCode" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "legacySourceApp" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "legacySourceKey" TEXT;

ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "legacySourceApp" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "legacySourceKey" TEXT;

ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "legacyProductCode" TEXT;
ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "legacySourceApp" TEXT;
ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "legacySourceKey" TEXT;

ALTER TABLE "StockTransaction" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "MeterReading" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "DeviceTransfer" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "AssetCategory" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "SyncRun" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "MasterItem" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "AssetNumberPattern" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "AssetNumberPattern" ADD COLUMN IF NOT EXISTS "siteCode" TEXT;
ALTER TABLE "WoNumberPattern" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "WoNumberPattern" ADD COLUMN IF NOT EXISTS "siteCode" TEXT;

-- 9. Add indexes for organizationId on business tables
CREATE INDEX IF NOT EXISTS "Device_orgId_idx" ON "Device"("organizationId");
CREATE INDEX IF NOT EXISTS "WorkOrder_orgId_idx" ON "WorkOrder"("organizationId");
CREATE INDEX IF NOT EXISTS "StockItem_orgId_idx" ON "StockItem"("organizationId");
CREATE INDEX IF NOT EXISTS "MeterReading_orgId_idx" ON "MeterReading"("organizationId");
CREATE INDEX IF NOT EXISTS "MasterItem_orgId_idx" ON "MasterItem"("organizationId");
CREATE INDEX IF NOT EXISTS "User_orgId_idx" ON "User"("organizationId");
CREATE INDEX IF NOT EXISTS "AssetNumberPattern_org_site_active_idx"
  ON "AssetNumberPattern"("organizationId", "siteCode", "isActive");
CREATE INDEX IF NOT EXISTS "WoNumberPattern_org_site_active_idx"
  ON "WoNumberPattern"("organizationId", "siteCode", "isActive");
