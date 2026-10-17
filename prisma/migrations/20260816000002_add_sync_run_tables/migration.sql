-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "createRows" INTEGER NOT NULL DEFAULT 0,
    "updateRows" INTEGER NOT NULL DEFAULT 0,
    "skipRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "triggeredBy" TEXT NOT NULL,
    "siteScope" TEXT,
    "errorMessage" TEXT,
    "retryOf" TEXT,
    "sourceCursor" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "p2034Count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRunItem" (
    "id" TEXT NOT NULL,
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
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "SyncRunItem_pkey" PRIMARY KEY ("id")
);

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

-- AddForeignKey
ALTER TABLE "SyncRunItem" ADD CONSTRAINT "SyncRunItem_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
