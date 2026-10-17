import pg from 'pg'

// ── Environment Guard ──
const SUPA = process.env.SUPABASE_DATABASE_URL
if (!SUPA) {
  console.error('❌ SUPABASE_DATABASE_URL env var is required.')
  console.error('   Set it via: export SUPABASE_DATABASE_URL="postgresql://..."')
  process.exit(1)
}

// ALTER TABLE statements — additive only, no data loss
const MIGRATIONS: Array<{ name: string; sql: string; table?: string }> = [
  // Add organizationId to business tables (nullable for legacy data)
  {
    name: 'add_organizationId_to_Device',
    table: 'Device',
    sql: 'ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "organizationId" TEXT',
  },
  {
    name: 'add_legacyAssetCode_to_Device',
    sql: 'ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "legacyAssetCode" TEXT, ADD COLUMN IF NOT EXISTS "legacySourceApp" TEXT, ADD COLUMN IF NOT EXISTS "legacySourceKey" TEXT',
  },
  {
    name: 'add_organizationId_to_WorkOrder',
    sql: 'ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "organizationId" TEXT, ADD COLUMN IF NOT EXISTS "legacySourceApp" TEXT, ADD COLUMN IF NOT EXISTS "legacySourceKey" TEXT',
  },
  {
    name: 'add_organizationId_to_StockItem',
    sql: 'ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "organizationId" TEXT, ADD COLUMN IF NOT EXISTS "legacyProductCode" TEXT, ADD COLUMN IF NOT EXISTS "legacySourceApp" TEXT, ADD COLUMN IF NOT EXISTS "legacySourceKey" TEXT',
  },
  {
    name: 'add_organizationId_to_MasterItem',
    sql: 'ALTER TABLE "MasterItem" ADD COLUMN IF NOT EXISTS "organizationId" TEXT',
  },
  {
    name: 'add_organizationId_to_User',
    sql: 'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "organizationId" TEXT',
  },
  {
    name: 'add_organizationId_to_AssetNumberPattern',
    sql: 'ALTER TABLE "AssetNumberPattern" ADD COLUMN IF NOT EXISTS "organizationId" TEXT, ADD COLUMN IF NOT EXISTS "siteCode" TEXT',
  },
  {
    name: 'add_organizationId_to_WoNumberPattern',
    sql: 'ALTER TABLE "WoNumberPattern" ADD COLUMN IF NOT EXISTS "organizationId" TEXT, ADD COLUMN IF NOT EXISTS "siteCode" TEXT',
  },
  // Create new models
  {
    name: 'create_Organization_table',
    sql: `CREATE TABLE IF NOT EXISTS "Organization" (
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
    )`,
  },
  {
    name: 'create_LegacyReference_table',
    sql: `CREATE TABLE IF NOT EXISTS "LegacyReference" (
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
    )`,
  },
  {
    name: 'create_LegacyReference_indexes',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "LegacyReference_org_app_entity_code_key"
      ON "LegacyReference"("organizationId", "sourceApp", "sourceEntity", "legacyCode");
      CREATE INDEX IF NOT EXISTS "LegacyReference_target_idx" ON "LegacyReference"("targetEntity", "targetId");
      CREATE INDEX IF NOT EXISTS "LegacyReference_org_legacy_idx" ON "LegacyReference"("organizationId", "legacyCode")`,
  },
  {
    name: 'create_SetupRun_table',
    sql: `CREATE TABLE IF NOT EXISTS "SetupRun" (
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
    CREATE INDEX IF NOT EXISTS "SetupRun_org_status_idx" ON "SetupRun"("organizationId", "status")`,
  },
  {
    name: 'create_SetupStep_table',
    sql: `CREATE TABLE IF NOT EXISTS "SetupStep" (
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
    CREATE INDEX IF NOT EXISTS "SetupStep_status_idx" ON "SetupStep"("status")`,
  },
  {
    name: 'create_CustomFieldDefinition_table',
    sql: `CREATE TABLE IF NOT EXISTS "CustomFieldDefinition" (
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
      ON "CustomFieldDefinition"("organizationId", "targetEntity", "active")`,
  },
  {
    name: 'create_CustomFieldOption_table',
    sql: `CREATE TABLE IF NOT EXISTS "CustomFieldOption" (
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
    CREATE INDEX IF NOT EXISTS "CustomFieldOption_field_active_idx" ON "CustomFieldOption"("fieldId", "active")`,
  },
  {
    name: 'create_CustomFieldValue_table',
    sql: `CREATE TABLE IF NOT EXISTS "CustomFieldValue" (
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
      ON "CustomFieldValue"("organizationId", "targetEntity", "targetId")`,
  },
]

async function main() {
  const c = new pg.Client({ connectionString: SUPA, connectionTimeoutMillis: 30000 })
  await c.connect()
  console.log('✓ Connected to Supabase')
  console.log(`Running ${MIGRATIONS.length} migrations...`)
  console.log('')

  let ok = 0, failed = 0
  for (const m of MIGRATIONS) {
    try {
      await c.query(m.sql)
      console.log(`  ✓ ${m.name}`)
      ok++
    } catch (e: any) {
      console.error(`  ✗ ${m.name}: ${e.message.slice(0, 100)}`)
      failed++
    }
  }

  console.log('')
  console.log(`✓ ${ok} migrations OK, ${failed} failed`)
  await c.end()
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
