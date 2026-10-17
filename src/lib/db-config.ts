/**
 * db-config.ts — Database configuration abstraction
 *
 * ทำให้ระบบรองรับการเปลี่ยน Database provider โดย user สามารถ
 * ดูแลรักษาเองได้ (self-hosted PostgreSQL / MySQL / SQLite)
 *
 * การใช้งาน:
 *   1. Set DATABASE_URL ใน .env ให้ตรงกับ provider ที่ใช้
 *   2. Set DATABASE_PROVIDER (optional — auto-detect จาก URL)
 *   3. รัน `bun run db:push` เพื่อสร้าง tables
 *
 * ตัวอย่าง:
 *   # SQLite (default for dev)
 *   DATABASE_URL="file:./dev.db"
 *
 *   # PostgreSQL (production — Supabase / self-hosted)
 *   DATABASE_URL="postgresql://user:pass@host:5432/dbname"
 *
 *   # MySQL (self-hosted)
 *   DATABASE_URL="mysql://user:pass@host:3306/dbname"
 *
 * Provider auto-detection rules:
 *   - URL starts with "file:"  → sqlite
 *   - URL starts with "postgres" → postgresql
 *   - URL starts with "mysql"  → mysql
 */

export type DbProvider = 'sqlite' | 'postgresql' | 'mysql'

export interface DbConfig {
  provider: DbProvider
  url: string
  isPooled: boolean
  isSupabase: boolean
  /** Connection limit — adjust per provider */
  connectionLimit: number
  /** Pool timeout in seconds */
  poolTimeout: number
  /** Whether to enable pgbouncer (Supabase pooler only) */
  usePgBouncer: boolean
}

/**
 * Detect provider from DATABASE_URL.
 */
export function detectProvider(url: string): DbProvider {
  // Explicit env override
  const explicit = process.env.DATABASE_PROVIDER?.toLowerCase()
  if (explicit === 'sqlite' || explicit === 'postgresql' || explicit === 'mysql') {
    return explicit
  }

  // Auto-detect from URL scheme
  if (url.startsWith('file:')) return 'sqlite'
  if (url.startsWith('postgres')) return 'postgresql'
  if (url.startsWith('mysql')) return 'mysql'

  // Default fallback
  console.warn(
    '[db-config] Could not detect provider from URL, defaulting to sqlite',
  )
  return 'sqlite'
}

/**
 * Build full database configuration from environment.
 */
export function getDbConfig(): DbConfig {
  const url = process.env.DATABASE_URL ?? ''
  const provider = detectProvider(url)

  // Detect Supabase pooler URLs
  const isSupabase = url.includes('.supabase.com') || url.includes('.supabase.co')
  const isPooled = /\.pooler\.supabase\.com/.test(url)

  // Provider-specific defaults
  let connectionLimit = 5
  let poolTimeout = 30
  let usePgBouncer = false

  if (provider === 'postgresql') {
    if (isPooled) {
      // Supabase transaction mode (port 6543) — pool_size 200
      connectionLimit = 5 // keep small per-instance, rely on PgBouncer
      poolTimeout = 30
      usePgBouncer = true
    } else if (isSupabase) {
      // Supabase session mode (port 5432) — pool_size 15
      connectionLimit = 3 // very conservative
      poolTimeout = 30
    } else {
      // Self-hosted PostgreSQL — depends on user's config
      connectionLimit = 10
      poolTimeout = 30
    }
  } else if (provider === 'mysql') {
    connectionLimit = 10
    poolTimeout = 30
  } else {
    // SQLite — single connection (file-based)
    connectionLimit = 1
    poolTimeout = 5
  }

  // Allow env overrides
  if (process.env.DATABASE_CONNECTION_LIMIT) {
    connectionLimit = parseInt(process.env.DATABASE_CONNECTION_LIMIT, 10)
  }
  if (process.env.DATABASE_POOL_TIMEOUT) {
    poolTimeout = parseInt(process.env.DATABASE_POOL_TIMEOUT, 10)
  }

  return {
    provider,
    url,
    isPooled,
    isSupabase,
    connectionLimit,
    poolTimeout,
    usePgBouncer,
  }
}

/**
 * Build connection URL with pool params appended.
 * Handles Supabase auto-switch from 5432 → 6543.
 */
export function buildConnectionUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl
  const config = getDbConfig()
  let url = rawUrl

  // Auto-switch Supabase pooler: 5432 → 6543 (transaction mode)
  if (config.isSupabase && /\.pooler\.supabase\.com:5432(\/|\?|$)/.test(url)) {
    url = url.replace(
      /\.pooler\.supabase\.com:5432/,
      '.pooler.supabase.com:6543',
    )
  }

  const has = (k: string) => url.includes(`${k}=`)
  const extras: string[] = []

  // SQLite doesn't support connection_limit/pool_timeout
  if (config.provider !== 'sqlite') {
    if (!has('connection_limit')) {
      extras.push(`connection_limit=${config.connectionLimit}`)
    }
    if (!has('pool_timeout')) {
      extras.push(`pool_timeout=${config.poolTimeout}`)
    }
  }

  // PgBouncer for Supabase pooler (transaction mode)
  if (config.usePgBouncer && !has('pgbouncer')) {
    extras.push('pgbouncer=true')
  }

  if (extras.length === 0) return url

  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}${extras.join('&')}`
}

/**
 * Get provider-specific SQL syntax for common operations.
 * Use this to avoid hardcoding dialect-specific SQL.
 */
export const sqlDialect = {
  /**
   * Get current timestamp — differs per provider
   */
  now(): string {
    // Prisma's @default(now()) handles this automatically
    // Use this only for raw queries
    return "CURRENT_TIMESTAMP"
  },

  /**
   * Case-insensitive LIKE — differs per provider
   * - SQLite: ILIKE not supported, use LOWER() + LIKE
   * - PostgreSQL: ILIKE supported
   * - MySQL: LIKE is case-insensitive by default
   */
  caseInsensitiveLike(column: string, value: string): string {
    const config = getDbConfig()
    if (config.provider === 'postgresql') {
      return `${column} ILIKE ${value}`
    }
    // SQLite + MySQL — use LOWER()
    return `LOWER(${column}) LIKE LOWER(${value})`
  },

  /**
   * Boolean column value
   * - SQLite: 0/1
   * - PostgreSQL/MySQL: true/false
   */
  boolean(value: boolean): string | number {
    const config = getDbConfig()
    if (config.provider === 'sqlite') return value ? 1 : 0
    return value ? 'TRUE' : 'FALSE'
  },
}

/**
 * Print config for debugging (no secrets).
 */
export function printDbConfig(): void {
  const config = getDbConfig()
  const maskedUrl = config.url.replace(/:[^:@]+@/, ':****@')
  console.log('[db-config]', {
    provider: config.provider,
    url: maskedUrl.slice(0, 80) + (maskedUrl.length > 80 ? '...' : ''),
    isSupabase: config.isSupabase,
    isPooled: config.isPooled,
    connectionLimit: config.connectionLimit,
    poolTimeout: config.poolTimeout,
    usePgBouncer: config.usePgBouncer,
  })
}
