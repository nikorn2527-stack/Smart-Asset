-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logoUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LegacyReference" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SetupRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "currentStep" TEXT,
    "startedBy" TEXT NOT NULL,
    "completedBy" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "errorMessage" TEXT
);

-- CreateTable
CREATE TABLE "SetupStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "setupRunId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "inputHash" TEXT,
    "resultJson" JSONB,
    "errorMessage" TEXT,
    "completedBy" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "SetupStep_setupRunId_fkey" FOREIGN KEY ("setupRunId") REFERENCES "SetupRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomFieldDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CustomFieldOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "CustomFieldOption_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "CustomFieldDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomFieldValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT 'default',
    "fieldId" TEXT NOT NULL,
    "targetEntity" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "valueText" TEXT,
    "valueNumber" DECIMAL,
    "valueDate" DATETIME,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "CustomFieldDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetCode" TEXT NOT NULL,
    "organizationId" TEXT,
    "legacyAssetCode" TEXT,
    "legacySourceApp" TEXT,
    "legacySourceKey" TEXT,
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
    "purchasePrice" DECIMAL,
    "salvageValue" DECIMAL DEFAULT 0,
    "usefulLife" INTEGER,
    "warrantyMonths" INTEGER NOT NULL DEFAULT 12,
    "warrantyEnd" TEXT,
    "vendor" TEXT,
    "contractNo" TEXT,
    "installDate" TEXT,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "updatedBy" TEXT DEFAULT 'System',
    "tagId" TEXT,
    "tagType" TEXT NOT NULL DEFAULT 'QR',
    "parentDeviceId" TEXT,
    "setLabel" TEXT,
    "setPosition" INTEGER,
    "replacedById" TEXT,
    "replacedAt" DATETIME,
    "deletedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Device_parentDeviceId_fkey" FOREIGN KEY ("parentDeviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Device_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
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
    "meterMode" TEXT,
    "prevMeterMode" TEXT,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME,
    "deletedAt" DATETIME,
    CONSTRAINT "MeterReading_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Cycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "site" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME,
    "isDemo" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "DeviceTransfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "logId" TEXT,
    "deviceId" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
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
    "fromDepartmentCode" TEXT,
    "fromLocation" TEXT,
    "toSite" TEXT NOT NULL,
    "toAssetSiteCode" TEXT,
    "toBuilding" TEXT,
    "toFloor" TEXT,
    "toDepartment" TEXT,
    "toDepartmentCode" TEXT,
    "toLocation" TEXT,
    "meterReadingId" TEXT,
    "movedBy" TEXT,
    "remark" TEXT,
    "transferDate" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME,
    CONSTRAINT "DeviceTransfer_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assignmentId" TEXT,
    "deviceId" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "assignee" TEXT NOT NULL,
    "assigneeRole" TEXT,
    "department" TEXT,
    "checkoutDate" TEXT NOT NULL,
    "expectedReturnDate" TEXT,
    "actualReturnDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Assignment_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaintenanceLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "logId" TEXT,
    "deviceId" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "cost" DECIMAL,
    "vendor" TEXT,
    "description" TEXT NOT NULL,
    "resolvedNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MaintenanceLog_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "woNumber" TEXT,
    "organizationId" TEXT,
    "legacySourceApp" TEXT,
    "legacySourceKey" TEXT,
    "legacy_job_no" TEXT,
    "system_job_no" TEXT,
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
    "assignedAt" DATETIME,
    "assignmentNote" TEXT,
    "detailsAdmin" TEXT,
    "dateAdmin" TEXT,
    "resolution" TEXT,
    "resolutionGroup" TEXT,
    "editUnlockActive" BOOLEAN NOT NULL DEFAULT false,
    "editUnlockBy" TEXT,
    "editUnlockAt" DATETIME,
    "editUnlockNote" TEXT,
    "workCompletedAt" DATETIME,
    "closedAt" DATETIME,
    "canceledAt" DATETIME,
    "cancelReason" TEXT,
    "deviceId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "isSpecialFee" BOOLEAN NOT NULL DEFAULT false,
    "siteCode" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "publicReporterId" TEXT,
    "deletedAt" DATETIME,
    CONSTRAINT "WorkOrder_publicReporterId_fkey" FOREIGN KEY ("publicReporterId") REFERENCES "PublicReporter" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkOrder_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkOrderMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workOrderId" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT NOT NULL,
    "author" TEXT,
    "authorRole" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME,
    CONSTRAINT "WorkOrderMessage_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkOrderReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workOrderId" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "reviewedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME,
    CONSTRAINT "WorkOrderReview_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "work_order_images" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workOrderId" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "stage" TEXT NOT NULL,
    "image_data" TEXT NOT NULL,
    "imageUrl" TEXT,
    "storageProvider" TEXT,
    "sizeBytes" INTEGER,
    "fileName" TEXT,
    "uploadedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME,
    CONSTRAINT "work_order_images_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkOrderPart" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workOrderId" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "stockItemId" TEXT,
    "productCode" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL,
    "totalCost" DECIMAL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkOrderPart_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkOrderPart_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "license_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "License_ID" TEXT,
    "Asset_No" TEXT,
    "Software" TEXT NOT NULL,
    "LicenseType" TEXT,
    "License_Key" TEXT,
    "Quantity" INTEGER NOT NULL DEFAULT 1,
    "Expiry_Date" TEXT,
    "Remark" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deviceId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "license_records_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "site_attributes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "SiteCode" TEXT NOT NULL,
    "SiteName" TEXT,
    "LineOA" TEXT,
    "Hotline" TEXT,
    "PaperRateBW" DECIMAL DEFAULT 0.5,
    "PaperRateColor" DECIMAL DEFAULT 2.0,
    "TelegramChatId" TEXT,
    "EmailAddress" TEXT,
    "LiffId" TEXT,
    "LiffAutoFriendLine" TEXT,
    "PublicRepairDailyLimit" INTEGER NOT NULL DEFAULT 3,
    "PublicRepairIpDailyLimit" INTEGER NOT NULL DEFAULT 10,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME
);

-- CreateTable
CREATE TABLE "SiteRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteCode" TEXT NOT NULL,
    "bwRate" DECIMAL NOT NULL DEFAULT 0.5,
    "colorRate" DECIMAL NOT NULL DEFAULT 2.0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME,
    "isDemo" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "MasterItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "organizationId" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "deviceType" TEXT,
    "parentRef" TEXT,
    "displayLabel" TEXT,
    "siteCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productCode" TEXT NOT NULL,
    "organizationId" TEXT,
    "legacyProductCode" TEXT,
    "legacySourceApp" TEXT,
    "legacySourceKey" TEXT,
    "productName" TEXT NOT NULL,
    "category" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'ชิ้น',
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "minQuantity" INTEGER NOT NULL DEFAULT 0,
    "maxQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL,
    "totalValue" DECIMAL,
    "location" TEXT,
    "site" TEXT,
    "compatibleDevices" TEXT,
    "remark" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdated" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "costType" TEXT,
    "yieldPerPage" INTEGER,
    "depreciationMethod" TEXT,
    "usefulLifeMonths" INTEGER,
    "usefulLifePages" INTEGER,
    "costModel" TEXT,
    "expectedDevicesPerUnit" INTEGER,
    "expectedHoursPerUnit" INTEGER,
    "expectedPagesPerUnit" INTEGER,
    "ratePerPage" DECIMAL,
    "ratePerHour" DECIMAL,
    "ratePerMonth" DECIMAL,
    "ratePerDevice" DECIMAL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "StockItemRateHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockItemId" TEXT NOT NULL,
    "costModel" TEXT,
    "unitCost" DECIMAL,
    "ratePerPage" DECIMAL,
    "ratePerHour" DECIMAL,
    "ratePerMonth" DECIMAL,
    "ratePerDevice" DECIMAL,
    "effectiveFrom" TEXT NOT NULL,
    "effectiveTo" TEXT,
    "changedBy" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME,
    CONSTRAINT "StockItemRateHistory_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
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
    "cost" DECIMAL,
    "unitCost" DECIMAL,
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
    "usageQuantity" DECIMAL,
    "usageUnit" TEXT,
    "usageSource" TEXT,
    "usageHours" DECIMAL,
    "usagePages" INTEGER,
    "usageDevices" INTEGER,
    "clientMutationId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME,
    CONSTRAINT "StockTransaction_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockTransaction_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "poNumber" TEXT,
    "orderDate" TEXT NOT NULL,
    "supplier" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "totalValue" DECIMAL,
    "createdBy" TEXT,
    "remark" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseOrderId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "quantityOrdered" INTEGER NOT NULL,
    "quantityReceived" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL,
    "totalValue" DECIMAL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME,
    CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrderItem_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "organizationId" TEXT,
    "username" TEXT,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "department" TEXT,
    "permissions" TEXT,
    "allowedSites" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "passwordHash" TEXT,
    "passwordSalt" TEXT,
    "remark" TEXT,
    "avatarUrl" TEXT,
    "phone" TEXT,
    "lineUserId" TEXT,
    "googleSub" TEXT,
    "appleSub" TEXT,
    "source" TEXT DEFAULT 'local',
    "lastLoginAt" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Role" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Permission" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleCode" TEXT NOT NULL,
    "permissionCode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME,

    PRIMARY KEY ("roleCode", "permissionCode"),
    CONSTRAINT "RolePermission_roleCode_fkey" FOREIGN KEY ("roleCode") REFERENCES "Role" ("code") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RolePermission_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "Permission" ("code") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserSiteGrant" (
    "userId" TEXT NOT NULL,
    "siteCode" TEXT NOT NULL,
    "roleCode" TEXT NOT NULL DEFAULT 'viewer',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" DATETIME,
    "validUntil" DATETIME,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY ("userId", "siteCode"),
    CONSTRAINT "UserSiteGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserSiteGrant_roleCode_fkey" FOREIGN KEY ("roleCode") REFERENCES "Role" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "siteCode" TEXT,
    "userId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "target" TEXT,
    "entityId" TEXT,
    "entity" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" DATETIME,
    "sentAt" DATETIME,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME
);

-- CreateTable
CREATE TABLE "MeterReportAmendment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "amendmentNo" TEXT NOT NULL,
    "cycleMonth" TEXT NOT NULL,
    "cycleId" TEXT,
    "deviceId" TEXT NOT NULL,
    "oldMeterBw" INTEGER,
    "oldMeterColor" INTEGER,
    "oldPagesBw" INTEGER,
    "oldPagesColor" INTEGER,
    "newMeterBw" INTEGER,
    "newMeterColor" INTEGER,
    "newPagesBw" INTEGER,
    "newPagesColor" INTEGER,
    "reason" TEXT NOT NULL,
    "amendedBy" TEXT NOT NULL,
    "newRevision" INTEGER,
    "amendedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AssetNumberPattern" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "siteCode" TEXT,
    "name" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "defaultPrefix" TEXT,
    "seqPadding" INTEGER NOT NULL DEFAULT 5,
    "seqStart" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "WoNumberPattern" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "siteCode" TEXT,
    "name" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "defaultPrefix" TEXT,
    "seqPadding" INTEGER NOT NULL DEFAULT 4,
    "seqStart" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "OrganizationProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1,
    "defaultCapitalizeThreshold" DECIMAL DEFAULT 10000,
    "assetTerminology" TEXT NOT NULL DEFAULT 'ครุภัณฑ์',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "AssetCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "usefulLifeYears" INTEGER NOT NULL DEFAULT 5,
    "depreciationMethod" TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
    "decliningRate" DECIMAL,
    "minCapitalizeValue" DECIMAL DEFAULT 10000,
    "salvageValuePct" DECIMAL NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isFixed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME,
    "isDemo" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL DEFAULT 'excel',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT,
    "uploadedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME
);

-- CreateTable
CREATE TABLE "LineBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lineUserId" TEXT NOT NULL,
    "lineDisplayName" TEXT,
    "reporterName" TEXT,
    "tel" TEXT,
    "employeeCode" TEXT,
    "workOrderCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rangeKey" TEXT,
    "filters" TEXT,
    "data" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'json',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" TEXT,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "source" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "createRows" INTEGER NOT NULL DEFAULT 0,
    "updateRows" INTEGER NOT NULL DEFAULT 0,
    "skipRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "durationMs" INTEGER,
    "triggeredBy" TEXT NOT NULL,
    "siteScope" TEXT,
    "errorMessage" TEXT,
    "retryOf" TEXT,
    "sourceCursor" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "p2034Count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME
);

-- CreateTable
CREATE TABLE "SyncRunItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "syncRunId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "expectedVersion" INTEGER,
    "expectedExists" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "entityId" TEXT,
    "entityType" TEXT,
    "processedAt" DATETIME,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncRunItem_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PMSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleNo" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'monthly',
    "intervalDays" INTEGER,
    "dayOfMonth" INTEGER,
    "weekday" TEXT,
    "startMonth" INTEGER,
    "deviceType" TEXT,
    "site" TEXT,
    "building" TEXT,
    "floor" TEXT,
    "department" TEXT,
    "deviceId" TEXT,
    "checklist" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startDate" TEXT,
    "lastRunDate" TEXT,
    "nextRunDate" TEXT,
    "autoCreateWO" BOOLEAN NOT NULL DEFAULT false,
    "assignedTo" TEXT,
    "createdBy" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "PMSchedule_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PMExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "scheduledDate" TEXT NOT NULL,
    "executedDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "checklistResult" TEXT,
    "remark" TEXT,
    "performedBy" TEXT,
    "images" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PMExecution_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "PMSchedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebAuthnCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "publicKey" BLOB NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "deviceType" TEXT,
    "transports" TEXT,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME,
    CONSTRAINT "WebAuthnCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeviceAccessory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parentDeviceId" TEXT NOT NULL,
    "accessoryType" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "installedDate" TEXT,
    "removedDate" TEXT,
    "remark" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeviceAccessory_parentDeviceId_fkey" FOREIGN KEY ("parentDeviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublicReporter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteCode" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT,
    "email" TEXT,
    "lineUserId" TEXT,
    "lineDisplayName" TEXT,
    "linePictureUrl" TEXT,
    "lineScopePhone" TEXT,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" DATETIME,
    "verifiedMethod" TEXT,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedReason" TEXT,
    "blockedAt" DATETIME,
    "blockedBy" TEXT,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "lastReportAt" DATETIME,
    "defaultDeviceId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PublicReporter_siteCode_fkey" FOREIGN KEY ("siteCode") REFERENCES "site_attributes" ("SiteCode") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockCountSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'STOCK_ITEM',
    "siteCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "createdBy" TEXT,
    "note" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StockCountItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetCode" TEXT,
    "expectedQty" INTEGER,
    "expectedLocation" TEXT,
    "countedQty" INTEGER,
    "countedLocation" TEXT,
    "countedBy" TEXT,
    "countedAt" DATETIME,
    "variance" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StockCountItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StockCountSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModuleFlag" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CustomReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "config" TEXT NOT NULL,
    "dataSource" TEXT NOT NULL,
    "createdBy" TEXT,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "siteCode" TEXT,
    "nodeType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastSyncAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "SyncOutbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nodeId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "baseVersion" INTEGER,
    "entityVersion" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "ackedAt" DATETIME,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME,
    CONSTRAINT "SyncOutbox_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SyncNode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "baseVersion" INTEGER,
    "cloudVersion" INTEGER NOT NULL,
    "offlineVersion" INTEGER NOT NULL,
    "cloudPayload" TEXT NOT NULL,
    "offlinePayload" TEXT NOT NULL,
    "conflictFields" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME,
    CONSTRAINT "SyncConflict_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SyncNode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_code_key" ON "Organization"("code");

-- CreateIndex
CREATE INDEX "Organization_active_idx" ON "Organization"("active");

-- CreateIndex
CREATE INDEX "LegacyReference_targetEntity_targetId_idx" ON "LegacyReference"("targetEntity", "targetId");

-- CreateIndex
CREATE INDEX "LegacyReference_organizationId_legacyCode_idx" ON "LegacyReference"("organizationId", "legacyCode");

-- CreateIndex
CREATE INDEX "LegacyReference_sourceApp_sourceSheet_idx" ON "LegacyReference"("sourceApp", "sourceSheet");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyReference_organizationId_sourceApp_sourceEntity_legacyCode_key" ON "LegacyReference"("organizationId", "sourceApp", "sourceEntity", "legacyCode");

-- CreateIndex
CREATE INDEX "SetupRun_organizationId_status_idx" ON "SetupRun"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SetupStep_status_idx" ON "SetupStep"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SetupStep_setupRunId_stepKey_key" ON "SetupStep"("setupRunId", "stepKey");

-- CreateIndex
CREATE INDEX "CustomFieldDefinition_organizationId_targetEntity_active_idx" ON "CustomFieldDefinition"("organizationId", "targetEntity", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_organizationId_targetEntity_key_key" ON "CustomFieldDefinition"("organizationId", "targetEntity", "key");

-- CreateIndex
CREATE INDEX "CustomFieldOption_fieldId_active_idx" ON "CustomFieldOption"("fieldId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldOption_fieldId_value_key" ON "CustomFieldOption"("fieldId", "value");

-- CreateIndex
CREATE INDEX "CustomFieldValue_organizationId_targetEntity_targetId_idx" ON "CustomFieldValue"("organizationId", "targetEntity", "targetId");

-- CreateIndex
CREATE INDEX "CustomFieldValue_fieldId_valueText_idx" ON "CustomFieldValue"("fieldId", "valueText");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldValue_organizationId_fieldId_targetEntity_targetId_key" ON "CustomFieldValue"("organizationId", "fieldId", "targetEntity", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_assetCode_key" ON "Device"("assetCode");

-- CreateIndex
CREATE INDEX "Device_parentDeviceId_idx" ON "Device"("parentDeviceId");

-- CreateIndex
CREATE INDEX "Device_status_idx" ON "Device"("status");

-- CreateIndex
CREATE INDEX "Device_site_idx" ON "Device"("site");

-- CreateIndex
CREATE INDEX "Device_serialNumber_idx" ON "Device"("serialNumber");

-- CreateIndex
CREATE INDEX "Device_replacedById_idx" ON "Device"("replacedById");

-- CreateIndex
CREATE INDEX "Device_deletedAt_idx" ON "Device"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeterReading_readingId_key" ON "MeterReading"("readingId");

-- CreateIndex
CREATE INDEX "MeterReading_deviceId_idx" ON "MeterReading"("deviceId");

-- CreateIndex
CREATE INDEX "MeterReading_readingMonth_idx" ON "MeterReading"("readingMonth");

-- CreateIndex
CREATE INDEX "MeterReading_isDemo_idx" ON "MeterReading"("isDemo");

-- CreateIndex
CREATE INDEX "MeterReading_deletedAt_idx" ON "MeterReading"("deletedAt");

-- CreateIndex
CREATE INDEX "MeterReading_deviceId_readingMonth_idx" ON "MeterReading"("deviceId", "readingMonth");

-- CreateIndex
CREATE INDEX "MeterReading_readingType_readingDate_idx" ON "MeterReading"("readingType", "readingDate");

-- CreateIndex
CREATE INDEX "MeterReading_readingDate_idx" ON "MeterReading"("readingDate");

-- CreateIndex
CREATE INDEX "MeterReading_deviceId_readingDate_idx" ON "MeterReading"("deviceId", "readingDate");

-- CreateIndex
CREATE INDEX "Cycle_status_idx" ON "Cycle"("status");

-- CreateIndex
CREATE INDEX "Cycle_site_idx" ON "Cycle"("site");

-- CreateIndex
CREATE INDEX "Cycle_updatedAt_idx" ON "Cycle"("updatedAt");

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
CREATE UNIQUE INDEX "WorkOrder_system_job_no_key" ON "WorkOrder"("system_job_no");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_requestId_key" ON "WorkOrder"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_lineMessageId_key" ON "WorkOrder"("lineMessageId");

-- CreateIndex
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");

-- CreateIndex
CREATE INDEX "WorkOrder_legacy_job_no_idx" ON "WorkOrder"("legacy_job_no");

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
CREATE INDEX "WorkOrder_publicReporterId_idx" ON "WorkOrder"("publicReporterId");

-- CreateIndex
CREATE INDEX "WorkOrder_deletedAt_idx" ON "WorkOrder"("deletedAt");

-- CreateIndex
CREATE INDEX "WorkOrderMessage_workOrderId_idx" ON "WorkOrderMessage"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderReview_workOrderId_idx" ON "WorkOrderReview"("workOrderId");

-- CreateIndex
CREATE INDEX "work_order_images_workOrderId_idx" ON "work_order_images"("workOrderId");

-- CreateIndex
CREATE INDEX "work_order_images_stage_idx" ON "work_order_images"("stage");

-- CreateIndex
CREATE INDEX "WorkOrderPart_workOrderId_idx" ON "WorkOrderPart"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderPart_status_idx" ON "WorkOrderPart"("status");

-- CreateIndex
CREATE INDEX "WorkOrderPart_stockItemId_idx" ON "WorkOrderPart"("stockItemId");

-- CreateIndex
CREATE INDEX "license_records_Asset_No_idx" ON "license_records"("Asset_No");

-- CreateIndex
CREATE INDEX "license_records_deviceId_idx" ON "license_records"("deviceId");

-- CreateIndex
CREATE INDEX "license_records_isActive_idx" ON "license_records"("isActive");

-- CreateIndex
CREATE INDEX "license_records_isDemo_idx" ON "license_records"("isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "site_attributes_SiteCode_key" ON "site_attributes"("SiteCode");

-- CreateIndex
CREATE INDEX "site_attributes_isDemo_idx" ON "site_attributes"("isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "Site_code_key" ON "Site"("code");

-- CreateIndex
CREATE INDEX "Site_name_idx" ON "Site"("name");

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
CREATE INDEX "StockItem_costType_idx" ON "StockItem"("costType");

-- CreateIndex
CREATE INDEX "StockItem_costModel_idx" ON "StockItem"("costModel");

-- CreateIndex
CREATE INDEX "StockItem_isDemo_idx" ON "StockItem"("isDemo");

-- CreateIndex
CREATE INDEX "StockItem_deletedAt_idx" ON "StockItem"("deletedAt");

-- CreateIndex
CREATE INDEX "StockItemRateHistory_stockItemId_idx" ON "StockItemRateHistory"("stockItemId");

-- CreateIndex
CREATE INDEX "StockItemRateHistory_effectiveFrom_idx" ON "StockItemRateHistory"("effectiveFrom");

-- CreateIndex
CREATE INDEX "StockItemRateHistory_costModel_idx" ON "StockItemRateHistory"("costModel");

-- CreateIndex
CREATE INDEX "StockTransaction_stockItemId_idx" ON "StockTransaction"("stockItemId");

-- CreateIndex
CREATE INDEX "StockTransaction_type_idx" ON "StockTransaction"("type");

-- CreateIndex
CREATE INDEX "StockTransaction_approvalStatus_idx" ON "StockTransaction"("approvalStatus");

-- CreateIndex
CREATE INDEX "StockTransaction_isDemo_idx" ON "StockTransaction"("isDemo");

-- CreateIndex
CREATE INDEX "StockTransaction_sourceKey_idx" ON "StockTransaction"("sourceKey");

-- CreateIndex
CREATE INDEX "StockTransaction_clientMutationId_idx" ON "StockTransaction"("clientMutationId");

-- CreateIndex
CREATE INDEX "StockTransaction_workOrderId_idx" ON "StockTransaction"("workOrderId");

-- CreateIndex
CREATE INDEX "StockTransaction_workOrderNo_idx" ON "StockTransaction"("workOrderNo");

-- CreateIndex
CREATE INDEX "StockTransaction_type_createdAt_idx" ON "StockTransaction"("type", "createdAt");

-- CreateIndex
CREATE INDEX "StockTransaction_stockItemId_type_createdAt_idx" ON "StockTransaction"("stockItemId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "StockTransaction_approvalStatus_createdAt_idx" ON "StockTransaction"("approvalStatus", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_isDemo_idx" ON "PurchaseOrder"("isDemo");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_stockItemId_idx" ON "PurchaseOrderItem"("stockItemId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_isDemo_idx" ON "PurchaseOrderItem"("isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isDemo_idx" ON "User"("isDemo");

-- CreateIndex
CREATE INDEX "User_googleSub_idx" ON "User"("googleSub");

-- CreateIndex
CREATE INDEX "User_appleSub_idx" ON "User"("appleSub");

-- CreateIndex
CREATE INDEX "Role_active_idx" ON "Role"("active");

-- CreateIndex
CREATE INDEX "Permission_resource_idx" ON "Permission"("resource");

-- CreateIndex
CREATE INDEX "Permission_active_idx" ON "Permission"("active");

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
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_isDemo_idx" ON "AuditLog"("isDemo");

-- CreateIndex
CREATE INDEX "NotificationLog_status_retryCount_idx" ON "NotificationLog"("status", "retryCount");

-- CreateIndex
CREATE INDEX "NotificationLog_channel_status_idx" ON "NotificationLog"("channel", "status");

-- CreateIndex
CREATE INDEX "NotificationLog_entity_entityId_idx" ON "NotificationLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeterReportAmendment_amendmentNo_key" ON "MeterReportAmendment"("amendmentNo");

-- CreateIndex
CREATE INDEX "MeterReportAmendment_cycleMonth_idx" ON "MeterReportAmendment"("cycleMonth");

-- CreateIndex
CREATE INDEX "MeterReportAmendment_deviceId_cycleMonth_idx" ON "MeterReportAmendment"("deviceId", "cycleMonth");

-- CreateIndex
CREATE INDEX "MeterReportAmendment_cycleId_idx" ON "MeterReportAmendment"("cycleId");

-- CreateIndex
CREATE INDEX "MeterReportAmendment_amendedBy_idx" ON "MeterReportAmendment"("amendedBy");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_key_key" ON "AppSetting"("key");

-- CreateIndex
CREATE INDEX "AppSetting_isDemo_idx" ON "AppSetting"("isDemo");

-- CreateIndex
CREATE INDEX "AssetNumberPattern_organizationId_siteCode_isActive_idx" ON "AssetNumberPattern"("organizationId", "siteCode", "isActive");

-- CreateIndex
CREATE INDEX "AssetNumberPattern_isActive_idx" ON "AssetNumberPattern"("isActive");

-- CreateIndex
CREATE INDEX "WoNumberPattern_organizationId_siteCode_isActive_idx" ON "WoNumberPattern"("organizationId", "siteCode", "isActive");

-- CreateIndex
CREATE INDEX "WoNumberPattern_isActive_idx" ON "WoNumberPattern"("isActive");

-- CreateIndex
CREATE INDEX "OrganizationProfile_appName_idx" ON "OrganizationProfile"("appName");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCategory_code_key" ON "AssetCategory"("code");

-- CreateIndex
CREATE INDEX "AssetCategory_code_idx" ON "AssetCategory"("code");

-- CreateIndex
CREATE INDEX "AssetCategory_active_idx" ON "AssetCategory"("active");

-- CreateIndex
CREATE INDEX "DocumentTemplate_type_idx" ON "DocumentTemplate"("type");

-- CreateIndex
CREATE INDEX "ImportJob_status_idx" ON "ImportJob"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LineBinding_lineUserId_key" ON "LineBinding"("lineUserId");

-- CreateIndex
CREATE INDEX "LineBinding_lineUserId_idx" ON "LineBinding"("lineUserId");

-- CreateIndex
CREATE INDEX "Report_type_idx" ON "Report"("type");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_email_idx" ON "PasswordResetToken"("email");

-- CreateIndex
CREATE INDEX "PasswordResetToken_token_idx" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "SyncRun_source_target_status_idx" ON "SyncRun"("source", "target", "status");

-- CreateIndex
CREATE INDEX "SyncRun_triggeredBy_idx" ON "SyncRun"("triggeredBy");

-- CreateIndex
CREATE INDEX "SyncRun_siteScope_createdAt_idx" ON "SyncRun"("siteScope", "createdAt");

-- CreateIndex
CREATE INDEX "SyncRun_status_createdAt_idx" ON "SyncRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SyncRunItem_syncRunId_action_idx" ON "SyncRunItem"("syncRunId", "action");

-- CreateIndex
CREATE INDEX "SyncRunItem_externalKey_idx" ON "SyncRunItem"("externalKey");

-- CreateIndex
CREATE INDEX "SyncRunItem_syncRunId_status_idx" ON "SyncRunItem"("syncRunId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PMSchedule_scheduleNo_key" ON "PMSchedule"("scheduleNo");

-- CreateIndex
CREATE INDEX "PMSchedule_active_nextRunDate_idx" ON "PMSchedule"("active", "nextRunDate");

-- CreateIndex
CREATE INDEX "PMSchedule_frequency_idx" ON "PMSchedule"("frequency");

-- CreateIndex
CREATE INDEX "PMSchedule_site_idx" ON "PMSchedule"("site");

-- CreateIndex
CREATE INDEX "PMSchedule_deviceType_idx" ON "PMSchedule"("deviceType");

-- CreateIndex
CREATE INDEX "PMSchedule_isDemo_idx" ON "PMSchedule"("isDemo");

-- CreateIndex
CREATE INDEX "PMSchedule_deletedAt_idx" ON "PMSchedule"("deletedAt");

-- CreateIndex
CREATE INDEX "PMExecution_scheduleId_scheduledDate_idx" ON "PMExecution"("scheduleId", "scheduledDate");

-- CreateIndex
CREATE INDEX "PMExecution_status_idx" ON "PMExecution"("status");

-- CreateIndex
CREATE INDEX "PMExecution_scheduledDate_idx" ON "PMExecution"("scheduledDate");

-- CreateIndex
CREATE INDEX "PMExecution_isDemo_idx" ON "PMExecution"("isDemo");

-- CreateIndex
CREATE INDEX "WebAuthnCredential_userId_idx" ON "WebAuthnCredential"("userId");

-- CreateIndex
CREATE INDEX "DeviceAccessory_parentDeviceId_idx" ON "DeviceAccessory"("parentDeviceId");

-- CreateIndex
CREATE INDEX "DeviceAccessory_accessoryType_idx" ON "DeviceAccessory"("accessoryType");

-- CreateIndex
CREATE INDEX "DeviceAccessory_status_idx" ON "DeviceAccessory"("status");

-- CreateIndex
CREATE INDEX "DeviceAccessory_isDemo_idx" ON "DeviceAccessory"("isDemo");

-- CreateIndex
CREATE INDEX "PublicReporter_siteCode_idx" ON "PublicReporter"("siteCode");

-- CreateIndex
CREATE INDEX "PublicReporter_phone_idx" ON "PublicReporter"("phone");

-- CreateIndex
CREATE INDEX "PublicReporter_lineUserId_idx" ON "PublicReporter"("lineUserId");

-- CreateIndex
CREATE INDEX "PublicReporter_isBlocked_idx" ON "PublicReporter"("isBlocked");

-- CreateIndex
CREATE INDEX "PublicReporter_isDemo_idx" ON "PublicReporter"("isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "PublicReporter_siteCode_phone_key" ON "PublicReporter"("siteCode", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "PublicReporter_siteCode_lineUserId_key" ON "PublicReporter"("siteCode", "lineUserId");

-- CreateIndex
CREATE INDEX "StockCountSession_scope_idx" ON "StockCountSession"("scope");

-- CreateIndex
CREATE INDEX "StockCountSession_status_idx" ON "StockCountSession"("status");

-- CreateIndex
CREATE INDEX "StockCountSession_siteCode_idx" ON "StockCountSession"("siteCode");

-- CreateIndex
CREATE INDEX "StockCountSession_isDemo_idx" ON "StockCountSession"("isDemo");

-- CreateIndex
CREATE INDEX "StockCountItem_sessionId_idx" ON "StockCountItem"("sessionId");

-- CreateIndex
CREATE INDEX "StockCountItem_targetId_idx" ON "StockCountItem"("targetId");

-- CreateIndex
CREATE INDEX "StockCountItem_status_idx" ON "StockCountItem"("status");

-- CreateIndex
CREATE INDEX "CustomReport_createdBy_idx" ON "CustomReport"("createdBy");

-- CreateIndex
CREATE INDEX "CustomReport_dataSource_idx" ON "CustomReport"("dataSource");

-- CreateIndex
CREATE INDEX "SyncNode_organizationId_status_idx" ON "SyncNode"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SyncNode_nodeType_idx" ON "SyncNode"("nodeType");

-- CreateIndex
CREATE UNIQUE INDEX "SyncOutbox_idempotencyKey_key" ON "SyncOutbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SyncOutbox_nodeId_status_createdAt_idx" ON "SyncOutbox"("nodeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SyncOutbox_organizationId_entityType_entityId_idx" ON "SyncOutbox"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "SyncOutbox_idempotencyKey_idx" ON "SyncOutbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SyncConflict_organizationId_status_createdAt_idx" ON "SyncConflict"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SyncConflict_nodeId_entityType_entityId_idx" ON "SyncConflict"("nodeId", "entityType", "entityId");

