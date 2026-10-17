#!/usr/bin/env node
/**
 * Prisma provider manager — auto-syncs schema.prisma with DATABASE_URL.
 *
 * Behavior:
 *   - Production: VERIFY ONLY. Fail closed if provider is not "postgresql".
 *   - Development: AUTO-PATCH schema.prisma so `provider` matches the
 *     DATABASE_URL scheme:
 *       • DATABASE_URL starts with "file:"   → provider = "sqlite"
 *       • DATABASE_URL starts with "postgres" → provider = "postgresql"
 *       • DATABASE_URL missing/empty          → default to "postgresql"
 *     This lets Windows users use SQLite for dev/testing without PostgreSQL
 *     installed, while production still requires PostgreSQL (verify-only).
 *
 * Exit codes:
 *   0 = provider is correct (or was auto-patched in dev)
 *   1 = provider is wrong in production (refuses to patch)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'

/**
 * Load .env into process.env BEFORE reading DATABASE_URL.
 *
 * Bug this fixes: this script runs as the `prebuild` / `postinstall` hook.
 * npm/bun do NOT load .env before lifecycle hooks, so `process.env.DATABASE_URL`
 * was always undefined here → the script fell back to its "postgresql" default
 * and either left schema.prisma pinned to the wrong provider or failed CI with
 * "CI must use PostgreSQL" even when .env pointed at SQLite.
 *
 * Parsing is intentionally minimal and matches dotenv semantics for the cases
 * we care about: `KEY=value`, optional `export ` prefix, `#` comments, blank
 * lines, optional surrounding quotes. Real process.env always wins, so an
 * explicit override (CI, docker-compose, `bun run` with env preset) is not
 * clobbered by a stale .env.
 */
function loadDotEnv() {
  if (!existsSync('.env')) return
  const raw = readFileSync('.env', 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    let value = m[2].trim()
    // Strip trailing inline comment only when the value is unquoted.
    if (!/^["']/.test(value)) value = value.split(/\s+#/)[0].trim()
    else value = value.replace(/^["']|["']$/g, '')
    if (value === '') continue
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadDotEnv()

const schemaPath = 'prisma/schema.prisma'
if (!existsSync(schemaPath)) {
  console.error('[prisma-provider] schema.prisma not found')
  process.exit(0) // non-fatal — let prisma generate handle this
}

const schema = readFileSync(schemaPath, 'utf8')
const providerMatch = schema.match(/datasource db \{\s*provider = "([^"]+)"/)
const currentProvider = providerMatch?.[1] || 'unknown'
const dbUrl = process.env.DATABASE_URL || ''
const isProduction = process.env.NODE_ENV === 'production'

/** Determine the desired provider from DATABASE_URL scheme. */
function desiredProvider(url) {
  if (!url) return 'postgresql' // default — matches committed schema
  if (url.startsWith('file:')) return 'sqlite'
  if (url.startsWith('postgres')) return 'postgresql'
  return 'postgresql'
}

const want = desiredProvider(dbUrl)

if (isProduction) {
  // Production: MUST be postgresql — fail if not, NEVER patch.
  if (currentProvider !== 'postgresql') {
    console.error(
      `[prisma-provider] FATAL: Expected "postgresql" in production, found "${currentProvider}"`,
    )
    console.error('   Fix: change prisma/schema.prisma datasource provider to "postgresql"')
    process.exit(1)
  }
  console.log('[prisma-provider] ✓ postgresql (production)')
  process.exit(0)
}

// ── Development: auto-patch if mismatched ────────────────────────────────
if (currentProvider !== want) {
  // P1-05 guard: don't auto-patch if in CI or if git working tree is clean
  // (CI should always use PostgreSQL — SQLite is dev-only)
  if (process.env.CI === 'true') {
    console.error(
      `[prisma-provider] FATAL: CI detected but provider is "${currentProvider}", expected "${want}"`,
    )
    console.error('   CI must use PostgreSQL. Set DATABASE_URL to a postgresql:// URL.')
    process.exit(1)
  }

  const patched = schema.replace(
    /(datasource db \{\s*provider = ")([^"]+)(")/,
    `$1${want}$3`,
  )
  if (patched === schema) {
    console.warn(`[prisma-provider] ⚠️ could not patch provider (regex mismatch)`)
    console.warn(`   current="${currentProvider}" desired="${want}"`)
  } else {
    writeFileSync(schemaPath, patched, 'utf8')
    console.log(
      `[prisma-provider] 🔧 auto-patched provider: "${currentProvider}" → "${want}" (dev mode)`,
    )
    console.log(`   DATABASE_URL starts with: "${dbUrl.slice(0, 20)}..."`)
  }
} else {
  console.log(`[prisma-provider] ✓ ${currentProvider} (dev)`)
}
