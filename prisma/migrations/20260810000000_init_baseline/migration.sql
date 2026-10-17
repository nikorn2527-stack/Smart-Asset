-- Migration: Init baseline (all tables)
-- Created: 2026-08-10 (backdated before 20260815000001)
-- Task ID: CI-VERIFICATION-BASELINE
--
-- This migration creates ALL tables defined in the Prisma schema.
-- It is the baseline migration that was missing from the repo —
-- previous migrations (20260815000001_add_version_and_audit_sitecode
-- and 20260816000001_add_device_displaylabel) only ALTER existing
-- tables, so prisma migrate deploy on a fresh PostgreSQL database
-- failed with "relation does not exist".
--
-- Generated automatically via: prisma migrate diff --from-empty --to-schema-datamodel
-- This migration is idempotent (uses CREATE TABLE IF NOT EXISTS is NOT
-- used by Prisma's generator, so it must run on a truly empty database,
-- which is the case in CI/staging verification runs).

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "serialNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "site" TEXT NOT NULL,
    "department" TEXT,
    "departmentCode" TEXT,
    "parentRef" TEXT,
    "assetSiteCode" TEXT,
    "displayLabel" TEXT,
    "location" TEXT,
    "building" TEXT,
    "floor" TEXT,
    "room" TEXT,
    "purchaseDate" TEXT,
    "purchasePrice" DOUBLE PRECISION,
    "salvageValue" DOUBLE PRECISION DEFAULT 0,
    "usefulLife" INTEGER,
    "warrantyMonths" INTEGER NOT NULL DEFAULT 12,
    "warrantyEnd" TEXT,
    "vendor" TEXT,
    "contractNo" TEXT,
    "uninstallDate" TEXT,
    "meterRequired" BOOLEAN NOT NULL DEFAULT false,
    "meterMode" TEXT,
    "lastMeterBw" INTEGER NOT NULL DEFAULT 0,
    "lastMeterColor" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT,
    "mac" TEXT,
    "remoteId" TEXT,
    "currentAssignee" TEXT,
    "remark" TEXT,
    "costCenter" TEXT,
    "deviceGroup" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT DEFAULT 'System',

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL,
    "readingId" TEXT,
    "deviceId" TEXT NOT NULL,
    "assetCode" TEXT,
    "readingDate" TEXT NOT NULL,
    "readingMonth" TEXT,
    "meterBw" INTEGER NOT NULL DEFAULT 0,
    "meterColor" INTEGER NOT NULL DEFAULT 0,
    "pagesBw" INTEGER NOT NULL DEFAULT 0,
    "pagesColor" INTEGER NOT NULL DEFAULT 0,
    "prevMeterBw" INTEGER NOT NULL DEFAULT 0,
    "prevMeterColor" INTEGER NOT NULL DEFAULT 0,
    "readingType" TEXT,
    "readBy" TEXT,
    "remark" TEXT,
    "locationAtReading" TEXT,
    "siteAtReading" TEXT,
    "buildingAtReading" TEXT,
    "floorAtReading" TEXT,
    "departmentAtReading" TEXT,
    "departmentCodeAtReading" TEXT,
    "eventType" TEXT,
    "eventId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cycle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "site" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceTransfer" (
    "id" TEXT NOT NULL,
    "logId" TEXT,
    "deviceId" TEXT NOT NULL,
    "assetCode" TEXT,
    "moveDate" TEXT,
    "action" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "fromSite" TEXT,
    "fromAssetSiteCode" TEXT,
    "fromBuilding" TEXT,
    "fromFloor" TEXT,
    "fromDepartment" TEXT,
    "fromLocation" TEXT,
    "toSite" TEXT NOT NULL,
    "toAssetSiteCode" TEXT,
    "toBuilding" TEXT,
    "toFloor" TEXT,
    "toDepartment" TEXT,
    "toLocation" TEXT,
    "meterReadingId" TEXT,
    "movedBy" TEXT,
    "remark" TEXT,
    "transferDate" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT,
    "deviceId" TEXT NOT NULL,
    "assignee" TEXT NOT NULL,
    "assigneeRole" TEXT,
    "department" TEXT,
    "checkoutDate" TEXT NOT NULL,
    "expectedReturnDate" TEXT,
    "actualReturnDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceLog" (
    "id" TEXT NOT NULL,
    "logId" TEXT,
    "deviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "cost" DOUBLE PRECISION,
    "vendor" TEXT,
    "description" TEXT NOT NULL,
    "resolvedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "woNumber" TEXT,
    "requestId" TEXT,
    "subject" TEXT NOT NULL,
    "building" TEXT,
    "location" TEXT,
    "details" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'ปกติ',
    "reporterName" TEXT,
    "reporterEmail" TEXT,
    "tel" TEXT,
    "employeeCode" TEXT,
    "submissionSource" TEXT NOT NULL DEFAULT 'guest',
    "trackable" BOOLEAN NOT NULL DEFAULT false,
    "lineUserId" TEXT,
    "lineMessageId" TEXT,
    "printTemplateId" TEXT,
    "externalMeta" TEXT,
    "picBefore" TEXT,
    "picOnsite" TEXT,
    "picAfter" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "acceptStatus" TEXT,
    "assignedTo" TEXT,
    "assignedBy" TEXT,
    "assignedAt" TIMESTAMP(3),
    "assignmentNote" TEXT,
    "detailsAdmin" TEXT,
    "dateAdmin" TEXT,
    "resolution" TEXT,
    "resolutionGroup" TEXT,
    "editUnlockActive" BOOLEAN NOT NULL DEFAULT false,
    "editUnlockBy" TEXT,
    "editUnlockAt" TIMESTAMP(3),
    "editUnlockNote" TEXT,
    "workCompletedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "deviceId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "isSpecialFee" BOOLEAN NOT NULL DEFAULT false,
    "siteCode" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderMessage" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "author" TEXT,
    "authorRole" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderReview" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_images" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "image_data" TEXT NOT NULL,
    "fileName" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_records" (
    "id" TEXT NOT NULL,
    "License_ID" TEXT,
    "Asset_No" TEXT,
    "Software" TEXT NOT NULL,
    "LicenseType" TEXT,
    "License_Key" TEXT,
    "Quantity" INTEGER NOT NULL DEFAULT 1,
    "Expiry_Date" TEXT,
    "Remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "license_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_attributes" (
    "id" TEXT NOT NULL,
    "SiteCode" TEXT NOT NULL,
    "SiteName" TEXT,
    "LineOA" TEXT,
    "Hotline" TEXT,
    "PaperRateBW" DOUBLE PRECISION DEFAULT 0.5,
    "PaperRateColor" DOUBLE PRECISION DEFAULT 2.0,
    "TelegramChatId" TEXT,
    "EmailAddress" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteRate" (
    "id" TEXT NOT NULL,
    "siteCode" TEXT NOT NULL,
    "bwRate" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "colorRate" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterItem" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parentRef" TEXT,
    "displayLabel" TEXT,
    "siteCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "category" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'ชิ้น',
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "minQuantity" INTEGER NOT NULL DEFAULT 0,
    "maxQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DOUBLE PRECISION,
    "totalValue" DOUBLE PRECISION,
    "location" TEXT,
    "site" TEXT,
    "compatibleDevices" TEXT,
    "remark" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUpdated" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransaction" (
    "id" TEXT NOT NULL,
    "txnNumber" TEXT,
    "stockItemId" TEXT NOT NULL,
    "productCode" TEXT,
    "productName" TEXT,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT,
    "balanceAfter" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "requester" TEXT,
    "department" TEXT,
    "purpose" TEXT,
    "approver" TEXT,
    "approvedAt" TEXT,
    "workOrderId" TEXT,
    "workOrderNo" TEXT,
    "deviceId" TEXT,
    "cost" DOUBLE PRECISION,
    "unitCost" DOUBLE PRECISION,
    "vendor" TEXT,
    "receiver" TEXT,
    "purchaseOrderNo" TEXT,
    "txnDate" TEXT NOT NULL,
    "performedBy" TEXT,
    "remark" TEXT,
    "sourceKey" TEXT,
    "processedFlag" TEXT,
    "approvalStatus" TEXT,
    "approvalMode" TEXT,
    "autoApproveAt" TEXT,
    "rejectReason" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT,
    "orderDate" TEXT NOT NULL,
    "supplier" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "totalValue" DOUBLE PRECISION,
    "createdBy" TEXT,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "quantityOrdered" INTEGER NOT NULL,
    "quantityReceived" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" DOUBLE PRECISION,
    "totalValue" DOUBLE PRECISION,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "department" TEXT,
    "permissions" TEXT,
    "allowedSites" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "passwordHash" TEXT,
    "passwordSalt" TEXT,
    "avatarUrl" TEXT,
    "phone" TEXT,
    "lineUserId" TEXT,
    "lastLoginAt" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Permission" (
    "code" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleCode" TEXT NOT NULL,
    "permissionCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleCode","permissionCode")
);

-- CreateTable
CREATE TABLE "UserSiteGrant" (
    "userId" TEXT NOT NULL,
    "siteCode" TEXT NOT NULL,
    "roleCode" TEXT NOT NULL DEFAULT 'viewer',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSiteGrant_pkey" PRIMARY KEY ("userId","siteCode")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "siteCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetNumberPattern" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "defaultPrefix" TEXT,
    "seqPadding" INTEGER NOT NULL DEFAULT 5,
    "seqStart" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetNumberPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WoNumberPattern" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "defaultPrefix" TEXT,
    "seqPadding" INTEGER NOT NULL DEFAULT 4,
    "seqStart" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WoNumberPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationProfile" (
    "id" TEXT NOT NULL,
    "appName" TEXT NOT NULL DEFAULT 'ระบบจัดการสินทรัพย์',
    "appTagline" TEXT NOT NULL DEFAULT 'Asset Management System',
    "industryType" TEXT NOT NULL DEFAULT 'general',
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#f97316',
    "accentColor" TEXT NOT NULL DEFAULT '#0d9488',
    "language" TEXT NOT NULL DEFAULT 'th',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "allowExcelImport" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isFixed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL DEFAULT 'excel',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineBinding" (
    "id" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "lineDisplayName" TEXT,
    "reporterName" TEXT,
    "tel" TEXT,
    "employeeCode" TEXT,
    "workOrderCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rangeKey" TEXT,
    "filters" TEXT,
    "data" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'json',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" TEXT,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_assetCode_key" ON "Device"("assetCode");

-- CreateIndex
CREATE INDEX "Device_site_idx" ON "Device"("site");

-- CreateIndex
CREATE INDEX "Device_assetSiteCode_idx" ON "Device"("assetSiteCode");

-- CreateIndex
CREATE INDEX "Device_status_idx" ON "Device"("status");

-- CreateIndex
CREATE INDEX "Device_type_idx" ON "Device"("type");

-- CreateIndex
CREATE INDEX "Device_meterRequired_idx" ON "Device"("meterRequired");

-- CreateIndex
CREATE UNIQUE INDEX "MeterReading_readingId_key" ON "MeterReading"("readingId");

-- CreateIndex
CREATE INDEX "MeterReading_deviceId_idx" ON "MeterReading"("deviceId");

-- CreateIndex
CREATE INDEX "MeterReading_readingMonth_idx" ON "MeterReading"("readingMonth");

-- CreateIndex
CREATE INDEX "MeterReading_isDemo_idx" ON "MeterReading"("isDemo");

-- CreateIndex
CREATE INDEX "Cycle_status_idx" ON "Cycle"("status");

-- CreateIndex
CREATE INDEX "Cycle_site_idx" ON "Cycle"("site");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceTransfer_logId_key" ON "DeviceTransfer"("logId");

-- CreateIndex
CREATE INDEX "DeviceTransfer_deviceId_idx" ON "DeviceTransfer"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceTransfer_toSite_idx" ON "DeviceTransfer"("toSite");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_assignmentId_key" ON "Assignment"("assignmentId");

-- CreateIndex
CREATE INDEX "Assignment_deviceId_idx" ON "Assignment"("deviceId");

-- CreateIndex
CREATE INDEX "Assignment_assignee_idx" ON "Assignment"("assignee");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceLog_logId_key" ON "MaintenanceLog"("logId");

-- CreateIndex
CREATE INDEX "MaintenanceLog_deviceId_idx" ON "MaintenanceLog"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_woNumber_key" ON "WorkOrder"("woNumber");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_requestId_key" ON "WorkOrder"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_lineMessageId_key" ON "WorkOrder"("lineMessageId");

-- CreateIndex
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");

-- CreateIndex
CREATE INDEX "WorkOrder_assignedTo_idx" ON "WorkOrder"("assignedTo");

-- CreateIndex
CREATE INDEX "WorkOrder_deviceId_idx" ON "WorkOrder"("deviceId");

-- CreateIndex
CREATE INDEX "WorkOrder_isDemo_idx" ON "WorkOrder"("isDemo");

-- CreateIndex
CREATE INDEX "WorkOrder_isSpecialFee_idx" ON "WorkOrder"("isSpecialFee");

-- CreateIndex
CREATE INDEX "WorkOrder_siteCode_status_createdAt_idx" ON "WorkOrder"("siteCode", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WorkOrder_version_idx" ON "WorkOrder"("version");

-- CreateIndex
CREATE INDEX "WorkOrderMessage_workOrderId_idx" ON "WorkOrderMessage"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderReview_workOrderId_idx" ON "WorkOrderReview"("workOrderId");

-- CreateIndex
CREATE INDEX "work_order_images_workOrderId_idx" ON "work_order_images"("workOrderId");

-- CreateIndex
CREATE INDEX "work_order_images_stage_idx" ON "work_order_images"("stage");

-- CreateIndex
CREATE INDEX "license_records_Asset_No_idx" ON "license_records"("Asset_No");

-- CreateIndex
CREATE UNIQUE INDEX "site_attributes_SiteCode_key" ON "site_attributes"("SiteCode");

-- CreateIndex
CREATE UNIQUE INDEX "Site_code_key" ON "Site"("code");

-- CreateIndex
CREATE INDEX "SiteRate_siteCode_idx" ON "SiteRate"("siteCode");

-- CreateIndex
CREATE INDEX "MasterItem_category_idx" ON "MasterItem"("category");

-- CreateIndex
CREATE INDEX "MasterItem_code_idx" ON "MasterItem"("code");

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_productCode_key" ON "StockItem"("productCode");

-- CreateIndex
CREATE INDEX "StockItem_productCode_idx" ON "StockItem"("productCode");

-- CreateIndex
CREATE INDEX "StockItem_category_idx" ON "StockItem"("category");

-- CreateIndex
CREATE INDEX "StockTransaction_stockItemId_idx" ON "StockTransaction"("stockItemId");

-- CreateIndex
CREATE INDEX "StockTransaction_type_idx" ON "StockTransaction"("type");

-- CreateIndex
CREATE INDEX "StockTransaction_approvalStatus_idx" ON "StockTransaction"("approvalStatus");

-- CreateIndex
CREATE INDEX "StockTransaction_isDemo_idx" ON "StockTransaction"("isDemo");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isDemo_idx" ON "User"("isDemo");

-- CreateIndex
CREATE INDEX "RolePermission_permissionCode_idx" ON "RolePermission"("permissionCode");

-- CreateIndex
CREATE INDEX "UserSiteGrant_siteCode_active_idx" ON "UserSiteGrant"("siteCode", "active");

-- CreateIndex
CREATE INDEX "UserSiteGrant_userId_active_idx" ON "UserSiteGrant"("userId", "active");

-- CreateIndex
CREATE INDEX "UserSiteGrant_roleCode_active_idx" ON "UserSiteGrant"("roleCode", "active");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_siteCode_createdAt_idx" ON "AuditLog"("siteCode", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_key_key" ON "AppSetting"("key");

-- CreateIndex
CREATE INDEX "LineBinding_lineUserId_idx" ON "LineBinding"("lineUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_email_idx" ON "PasswordResetToken"("email");

-- CreateIndex
CREATE INDEX "PasswordResetToken_token_idx" ON "PasswordResetToken"("token");

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceTransfer" ADD CONSTRAINT "DeviceTransfer_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceLog" ADD CONSTRAINT "MaintenanceLog_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderMessage" ADD CONSTRAINT "WorkOrderMessage_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderReview" ADD CONSTRAINT "WorkOrderReview_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_images" ADD CONSTRAINT "work_order_images_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleCode_fkey" FOREIGN KEY ("roleCode") REFERENCES "Role"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "Permission"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSiteGrant" ADD CONSTRAINT "UserSiteGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSiteGrant" ADD CONSTRAINT "UserSiteGrant_roleCode_fkey" FOREIGN KEY ("roleCode") REFERENCES "Role"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
