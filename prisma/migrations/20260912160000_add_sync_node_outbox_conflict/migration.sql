-- CreateTable: SyncNode (Phase 1 → Phase 2 Offline Sync foundation)
CREATE TABLE "SyncNode" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteCode" TEXT,
    "nodeType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SyncNode_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "SyncNode_organizationId_status_idx" ON "SyncNode"("organizationId", "status");
CREATE INDEX "SyncNode_nodeType_idx" ON "SyncNode"("nodeType");

-- CreateTable: SyncOutbox
CREATE TABLE "SyncOutbox" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "ackedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "SyncOutbox_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "SyncOutbox_idempotencyKey_key" ON "SyncOutbox"("idempotencyKey");
CREATE INDEX "SyncOutbox_nodeId_status_createdAt_idx" ON "SyncOutbox"("nodeId", "status", "createdAt");
CREATE INDEX "SyncOutbox_organizationId_entityType_entityId_idx" ON "SyncOutbox"("organizationId", "entityType", "entityId");
CREATE INDEX "SyncOutbox_idempotencyKey_idx" ON "SyncOutbox"("idempotencyKey");

-- AddForeignKey: SyncOutbox.nodeId → SyncNode.id (CASCADE on node delete)
ALTER TABLE "SyncOutbox" ADD CONSTRAINT "SyncOutbox_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SyncNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: SyncConflict
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL,
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
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "SyncConflict_organizationId_status_createdAt_idx" ON "SyncConflict"("organizationId", "status", "createdAt");
CREATE INDEX "SyncConflict_nodeId_entityType_entityId_idx" ON "SyncConflict"("nodeId", "entityType", "entityId");

-- AddForeignKey: SyncConflict.nodeId → SyncNode.id (CASCADE on node delete)
ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SyncNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
