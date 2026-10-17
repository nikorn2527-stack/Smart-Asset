/**
 * check-schema-drift.ts — Detect schema drift between Prisma schema and DB.
 *
 * Checks:
 *   1. All models in schema.prisma exist as tables in DB
 *   2. All columns in schema exist in DB
 *   3. All DB tables have corresponding Prisma models
 *
 * Exit codes:
 *   0 = no drift (in sync)
 *   1 = drift detected (prints differences)
 *   2 = error (couldn't connect to DB)
 *
 * Usage:
 *   bun run scripts/check-schema-drift.ts
 *
 * In CI:
 *   bun run scripts/check-schema-drift.ts || exit 1
 */

import { db } from '../src/lib/db'

interface ColumnInfo {
  table_name: string
  column_name: string
  data_type: string
  is_nullable: string
}

async function main() {
  console.log('🔍 Schema Drift Detector')
  console.log('─'.repeat(50))

  try {
    // Get all tables in public schema
    const tables = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `
    const dbTableNames = tables.map((t) => t.table_name)
    console.log(`DB tables: ${dbTableNames.length}`)

    // Get all columns for each table
    const columns = await db.$queryRaw<ColumnInfo[]>`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `

    // Group columns by table
    const dbColumnsByTable = new Map<string, string[]>()
    for (const col of columns) {
      const existing = dbColumnsByTable.get(col.table_name) ?? []
      existing.push(col.column_name)
      dbColumnsByTable.set(col.table_name, existing)
    }

    // Parse schema.prisma to get model names + fields
    const schemaPath = 'prisma/schema.prisma'
    const { readFileSync } = await import('node:fs')
    const schema = readFileSync(schemaPath, 'utf8')

    const prismaModels = new Map<string, string[]>()
    let currentModel = ''
    for (const line of schema.split('\n')) {
      const modelMatch = line.match(/^model\s+(\w+)\s*\{/)
      if (modelMatch) {
        currentModel = modelMatch[1]
        prismaModels.set(currentModel, [])
        continue
      }
      if (currentModel && line.includes('}')) {
        currentModel = ''
        continue
      }
      if (currentModel) {
        // Match field declarations: fieldName Type @...
        // Skip relation fields (Type starts with capital + is a model name)
        // Skip comments, decorators (@@), and relation lines
        const fieldMatch = line.match(/^\s+(\w+)\s+/)
        if (
          fieldMatch &&
          !fieldMatch[1].startsWith('//') &&
          !fieldMatch[1].startsWith('@') &&
          // Skip relation fields — they don't have DB columns
          // Relations are detected by: Type starts with capital + no scalar type
          // Scalar types: String, Int, Float, Boolean, DateTime, Json, BigInt, Decimal, Bytes
          !isRelationField(line)
        ) {
          prismaModels.get(currentModel)?.push(fieldMatch[1])
        }
      }
    }

    console.log(`Prisma models: ${prismaModels.size}`)
    console.log('─'.repeat(50))

    // Convert Prisma model names to expected table names
    // Prisma uses camelCase model → snake_case table by default, but
    // we use @@map or keep camelCase. Check both.
    const prismaTableNames = Array.from(prismaModels.keys())

    let driftFound = false
    const drifts: string[] = []

    // Check 1: Tables in DB but not in schema (orphan tables)
    for (const dbTable of dbTableNames) {
      if (!prismaTableNames.includes(dbTable) && !prismaTableNames.includes(toCamelCase(dbTable))) {
        drifts.push(`⚠️  Table "${dbTable}" exists in DB but not in schema.prisma (orphan table)`)
        driftFound = true
      }
    }

    // Check 2: Models in schema but not in DB (missing tables)
    for (const model of prismaTableNames) {
      if (!dbTableNames.includes(model) && !dbTableNames.includes(toSnakeCase(model))) {
        drifts.push(`❌ Model "${model}" exists in schema.prisma but table not found in DB`)
        driftFound = true
      }
    }

    // Check 3: Column drift for tables that exist in both
    for (const model of prismaTableNames) {
      const tableName = dbTableNames.includes(model) ? model : toSnakeCase(model)
      if (!dbTableNames.includes(tableName)) continue

      const schemaFields = prismaModels.get(model) ?? []
      const dbColumns = dbColumnsByTable.get(tableName) ?? []

      // Fields in schema but not in DB
      for (const field of schemaFields) {
        const dbColName = dbColumns.includes(field) ? field : toSnakeCase(field)
        if (!dbColumns.includes(dbColName)) {
          drifts.push(`❌ ${model}.${field} exists in schema but not in DB table "${tableName}"`)
          driftFound = true
        }
      }

      // Columns in DB but not in schema (extra columns)
      for (const col of dbColumns) {
        const schemaFieldName = schemaFields.includes(col) ? col : toCamelCase(col)
        if (!schemaFields.includes(schemaFieldName)) {
          drifts.push(`⚠️  ${tableName}.${col} exists in DB but not in schema (extra column)`)
          driftFound = true
        }
      }
    }

    if (driftFound) {
      console.log('')
      console.log('❌ Schema drift detected!')
      console.log('─'.repeat(50))
      for (const d of drifts) console.log(d)
      console.log('─'.repeat(50))
      console.log(`Total issues: ${drifts.length}`)
      console.log('')
      console.log('To fix: run `bash scripts/safe-migrate.sh`')
      await db.$disconnect()
      process.exit(1)
    } else {
      console.log('')
      console.log('✓ Schema is in sync with database')
      console.log(`  Tables: ${prismaTableNames.length} models, ${dbTableNames.length} DB tables`)
      await db.$disconnect()
      process.exit(0)
    }
  } catch (err) {
    console.error('❌ Failed to check schema drift:', err)
    await db.$disconnect()
    process.exit(2)
  }
}

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

const SCALAR_TYPES = new Set([
  'String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'BigInt', 'Decimal', 'Bytes',
])

/** Check if a Prisma field is a relation (not a scalar column). */
function isRelationField(line: string): boolean {
  // Relation fields look like: fieldName Type? or fieldName Type[]
  // where Type is a model name (not a scalar)
  const match = line.match(/^\s+\w+\s+(\w+)/)
  if (!match) return false
  const type = match[1]
  // Scalar types → column in DB
  // Model names → relation (no column, just FK)
  if (SCALAR_TYPES.has(type)) return false
  // Optional scalar (e.g. String?) — already covered above
  return true // Not a scalar → relation
}

main()
