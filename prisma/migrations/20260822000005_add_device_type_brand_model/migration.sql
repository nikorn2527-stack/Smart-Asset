-- ============================================================
-- Migration: add_device_type_brand_model
-- Adds cascading master data: DeviceType (1) ─< Brand (1) ─< Model (N)
-- Also adds nullable FK columns on Device (typeId / brandId / modelId).
--
-- Additive only — no destructive changes (no DROP).
-- Backward compatible: existing Device.brand / Device.model / Device.type
-- String columns are kept; the new FK columns are nullable.
-- ============================================================

-- CreateTable
CREATE TABLE IF NOT EXISTS "DeviceType" (
    "id"        TEXT                  NOT NULL,
    "name"      TEXT                  NOT NULL,
    "active"    BOOLEAN               NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3)          NOT NULL,
    CONSTRAINT "DeviceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Brand" (
    "id"        TEXT                  NOT NULL,
    "name"      TEXT                  NOT NULL,
    "typeId"    TEXT                  NOT NULL,
    "active"    BOOLEAN               NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3)          NOT NULL,
    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Model" (
    "id"        TEXT                  NOT NULL,
    "name"      TEXT                  NOT NULL,
    "brandId"   TEXT                  NOT NULL,
    "active"    BOOLEAN               NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3)          NOT NULL,
    CONSTRAINT "Model_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (DeviceType)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'DeviceType_name_key'
    ) THEN
        CREATE UNIQUE INDEX "DeviceType_name_key" ON "DeviceType"("name");
    END IF;
END$$;

-- CreateIndex (Brand)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'Brand_typeId_idx'
    ) THEN
        CREATE INDEX "Brand_typeId_idx" ON "Brand"("typeId");
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'Brand_name_typeId_key'
    ) THEN
        CREATE UNIQUE INDEX "Brand_name_typeId_key" ON "Brand"("name", "typeId");
    END IF;
END$$;

-- CreateIndex (Model)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'Model_brandId_idx'
    ) THEN
        CREATE INDEX "Model_brandId_idx" ON "Model"("brandId");
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'Model_name_brandId_key'
    ) THEN
        CREATE UNIQUE INDEX "Model_name_brandId_key" ON "Model"("name", "brandId");
    END IF;
END$$;

-- AlterTable: add nullable FK columns on Device (only if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Device' AND column_name = 'typeId'
    ) THEN
        ALTER TABLE "Device" ADD COLUMN "typeId" TEXT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Device' AND column_name = 'brandId'
    ) THEN
        ALTER TABLE "Device" ADD COLUMN "brandId" TEXT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Device' AND column_name = 'modelId'
    ) THEN
        ALTER TABLE "Device" ADD COLUMN "modelId" TEXT;
    END IF;
END$$;

-- CreateIndex on Device (only if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'Device_typeId_idx'
    ) THEN
        CREATE INDEX "Device_typeId_idx" ON "Device"("typeId");
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'Device_brandId_idx'
    ) THEN
        CREATE INDEX "Device_brandId_idx" ON "Device"("brandId");
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'Device_modelId_idx'
    ) THEN
        CREATE INDEX "Device_modelId_idx" ON "Device"("modelId");
    END IF;
END$$;

-- AddForeignKey (only if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Device_typeId_fkey'
    ) THEN
        ALTER TABLE "Device"
          ADD CONSTRAINT "Device_typeId_fkey"
          FOREIGN KEY ("typeId") REFERENCES "DeviceType"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Device_brandId_fkey'
    ) THEN
        ALTER TABLE "Device"
          ADD CONSTRAINT "Device_brandId_fkey"
          FOREIGN KEY ("brandId") REFERENCES "Brand"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Device_modelId_fkey'
    ) THEN
        ALTER TABLE "Device"
          ADD CONSTRAINT "Device_modelId_fkey"
          FOREIGN KEY ("modelId") REFERENCES "Model"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Brand_typeId_fkey'
    ) THEN
        ALTER TABLE "Brand"
          ADD CONSTRAINT "Brand_typeId_fkey"
          FOREIGN KEY ("typeId") REFERENCES "DeviceType"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Model_brandId_fkey'
    ) THEN
        ALTER TABLE "Model"
          ADD CONSTRAINT "Model_brandId_fkey"
          FOREIGN KEY ("brandId") REFERENCES "Brand"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END$$;
