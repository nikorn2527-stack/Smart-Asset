#!/usr/bin/env node
/**
 * Switch this working copy between SQLite (fast local dev) and the Dockerised
 * PostgreSQL 16 (production-shaped integration testing).
 *
 * Usage:
 *   node scripts/use-db.mjs sqlite      → DATABASE_URL=file:./db/custom.db
 *   node scripts/use-db.mjs pg          → DATABASE_URL=postgresql://itam_app:...
 *   node scripts/use-db.mjs             → show current mode
 *
 * What it deliberately does NOT do:
 *   • touch schema.prisma directly — that is set-prisma-provider.mjs's job, and
 *     it now reads .env itself, so it will follow whatever we write here.
 *   • migrate data between engines. The 2,378 devices live in db/custom.db and
 *     stay there; the PostgreSQL database starts EMPTY and is meant for
 *     throwaway integration tests (fresh schema + fixtures each run).
 *
 * So: switching to `pg` gives you a clean production-shaped database, not a
 * copy of your SQLite data. Use `sqlite` to see real data.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'

const ENV = '.env'
const PG_POOLER =
  // Must match POSTGRES_PASSWORD in docker-compose.yml. Keep these in sync —
  // a mismatch surfaces only as `P1000 Authentication failed` at db-push time.
  'postgresql://itam_app:change_me_in_production@localhost:5432/itam?schema=public'
const SQLITE_URL = 'file:./db/custom.db'

/**
 * Prisma's `directUrl` must be present or every command fails with P1012
 * "Environment variable not found", regardless of provider. SQLite has no
 * pooler, so there DIRECT_DATABASE_URL simply mirrors DATABASE_URL.
 *
 * For Supabase the two differ: DATABASE_URL is the Transaction pooler
 * (port 6543) used by the serverless runtime, DIRECT_DATABASE_URL is the
 * direct endpoint (port 5432) used by `prisma migrate` — PgBouncer in
 * transaction mode cannot keep DDL inside a single transaction.
 */
function directUrlFor(mode) {
  return mode === 'pg'
    ? process.env.DIRECT_DATABASE_URL || ''
    : mode === 'sqlite'
      ? SQLITE_URL
      : ''
}

const mode = (process.argv[2] || '').toLowerCase()

function currentUrl() {
  if (!existsSync(ENV)) return '(no .env)'
  const m = readFileSync(ENV, 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.+)$/m)
  return m ? m[1].trim() : '(unset)'
}

if (!mode) {
  const url = currentUrl()
  const which = url.startsWith('file:') ? 'sqlite' : url.startsWith('postgres') ? 'pg' : 'unknown'
  console.log(`[use-db] current mode: ${which}`)
  console.log(`[use-db] DATABASE_URL=${url}`)
  process.exit(0)
}

if (mode !== 'sqlite' && mode !== 'pg') {
  console.error(`[use-db] Unknown mode "${mode}". Use: sqlite | pg`)
  process.exit(1)
}

const want = mode === 'pg' ? PG_POOLER : SQLITE_URL
// Local Docker PostgreSQL has no pooler, so direct == pooled here. The split
// only matters for Supabase, and that value is supplied via the environment.
const wantDirect = mode === 'pg' ? PG_POOLER : SQLITE_URL

if (!existsSync(ENV)) {
  console.error(`[use-db] ${ENV} not found — nothing to switch.`)
  process.exit(1)
}

let text = readFileSync(ENV, 'utf8')
const before = text

// Collapse the file down to ONE active DATABASE_URL and ONE DIRECT_DATABASE_URL.
//
// A naive per-line replace is wrong here: .env documents BOTH modes with several
// DATABASE_URL lines (commented examples included), so a regex that injects per
// match produces N copies and silently leaves the wrong one in charge. Instead:
//   1. drop every existing line for either variable (commented or not)
//   2. insert a single active pair at the position of the first one
//   3. leave all other settings (JWT_SECRET, etc.) untouched.
const isTarget = (l) => /^\s*#?\s*(DIRECT_)?DATABASE_URL\s*=/.test(l)
const lines = text.split(/\r?\n/)
const firstIdx = lines.findIndex(isTarget)
const kept = lines.filter((l) => !isTarget(l))

const marker = [
  '# ── Active database (managed by scripts/use-db.mjs) ──',
  '#   switch to PostgreSQL : node scripts/use-db.mjs pg',
  '#   switch to SQLite    : node scripts/use-db.mjs sqlite',
  `#   directUrl is required by prisma/schema.prisma; omit it and every Prisma`,
  `#   command fails with P1012. Under Supabase these differ (pooler vs direct).`,
  `DATABASE_URL=${want}`,
  `DIRECT_DATABASE_URL=${wantDirect}`,
]
const at = firstIdx === -1 ? kept.length : Math.min(firstIdx, kept.length)
kept.splice(at, 0, ...marker)

text = kept.join('\n')

if (text === before) {
  console.log(`[use-db] already ${mode} — no change`)
  process.exit(0)
}

writeFileSync(ENV, text, 'utf8')
console.log(`[use-db] ✓ switched to ${mode}`)
console.log(`[use-db]   DATABASE_URL=${want}`)
console.log(`[use-db]   DIRECT_DATABASE_URL=${wantDirect}`)
if (mode === 'pg') {
  console.log('[use-db]   Next: npx prisma db push && npx prisma generate')
  console.log('[use-db]   The pg database is EMPTY — SQLite data is not copied.')
} else {
  console.log('[use-db]   Next: npx prisma generate')
}