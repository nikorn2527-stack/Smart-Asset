import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Reuse the same client across warm serverless invocations as well as dev HMR.
// Without production caching, each Vercel invocation can create another pool,
// exhausting Supabase session-mode connection limits under modest concurrency.
if (
  globalForPrisma.prisma &&
  !(
    (globalForPrisma.prisma as unknown as { auditLog?: unknown }).auditLog &&
    (globalForPrisma.prisma as unknown as { deviceTransfer?: unknown })
      .deviceTransfer &&
    (globalForPrisma.prisma as unknown as { siteRate?: unknown }).siteRate &&
    (globalForPrisma.prisma as unknown as { user?: unknown }).user &&
    (globalForPrisma.prisma as unknown as { assignment?: unknown }).assignment &&
    (globalForPrisma.prisma as unknown as { report?: unknown }).report &&
    (globalForPrisma.prisma as unknown as { maintenanceLog?: unknown })
      .maintenanceLog &&
    (globalForPrisma.prisma as unknown as { workOrder?: unknown }).workOrder &&
    (globalForPrisma.prisma as unknown as { workOrderMessage?: unknown })
      .workOrderMessage &&
    (globalForPrisma.prisma as unknown as { workOrderReview?: unknown })
      .workOrderReview &&
    (globalForPrisma.prisma as unknown as { stockItem?: unknown }).stockItem &&
    (globalForPrisma.prisma as unknown as { stockTransaction?: unknown })
      .stockTransaction &&
    (globalForPrisma.prisma as unknown as { purchaseOrder?: unknown })
      .purchaseOrder &&
    (globalForPrisma.prisma as unknown as { purchaseOrderItem?: unknown })
      .purchaseOrderItem &&
    (globalForPrisma.prisma as unknown as { lineBinding?: unknown })
      .lineBinding
  )
) {
  void globalForPrisma.prisma.$disconnect().catch(() => {})
  globalForPrisma.prisma = undefined
}

/**
 * Build the connection URL with explicit pool params.
 *
 * IMPORTANT — Supabase Supavisor modes (the REAL cause of "EMAXCONNSESSION"):
 *   • Session mode    (port 5432): pool_size = 15 (Free), 200 (Pro)
 *     → Each client holds a connection for the whole session → EMAXCONNSESSION
 *       errors when 15+ clients connect simultaneously.
 *   • Transaction mode (port 6543): pool_size = 200 (Free), 1000 (Pro)
 *     → Connection released after each transaction → 13× more capacity.
 *
 * We AUTO-SWITCH pooler URLs from port 5432 → 6543 to avoid the 15-connection
 * limit on Free Plan. This is transparent to the app — both ports accept the
 * same credentials.
 */
function buildPoolUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl
  let url = rawUrl

  // Auto-switch Supabase pooler from session mode (5432) → transaction mode (6543).
  // This multiplies pool capacity 13× on Free Plan (15 → 200).
  if (/\.pooler\.supabase\.com:5432(\/|\?|$)/.test(url)) {
    url = url.replace('.pooler.supabase.com:5432', '.pooler.supabase.com:6543')
  }

  const has = (k: string) => url.includes(`${k}=`)
  const extras: string[] = []
  if (!has('connection_limit')) extras.push('connection_limit=5')
  if (!has('pool_timeout')) extras.push('pool_timeout=30')
  // Enable pgbouncer=true for Supabase pooler URLs (required for transaction mode).
  const isPooler = /\.pooler\.supabase\.com/.test(url)
  if (isPooler && !has('pgbouncer')) extras.push('pgbouncer=true')
  if (extras.length === 0) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}${extras.join('&')}`
}

const datasourceUrl = buildPoolUrl(process.env.DATABASE_URL ?? '')

/** True when the active datasource is SQLite (dev sandbox / local clones). */
const isSqlite = (process.env.DATABASE_URL ?? '').startsWith('file:')

/**
 * Recursively strip `mode: "insensitive"` from a Prisma where/query args
 * object. SQLite does NOT support `mode: "insensitive"` (it's a PostgreSQL-
 * only feature) and throws `PrismaClientValidationError` when it's present.
 *
 * SQLite's default `LIKE` is already case-insensitive for ASCII, and Thai
 * text has no case distinction, so stripping `mode` is behavior-preserving
 * for our use case (search filters on asset codes, names, statuses).
 *
 * This walks the object depth-first and removes the `mode` key from any
 * object that also has `contains` / `startsWith` / `endsWith` / `equals`.
 */
function stripInsensitive<T>(node: T): T {
  if (node === null || typeof node !== 'object') return node
  // Dates, Buffers, Prisma.Decimal, etc. are objects too, but they are LEAVES:
  // Object.entries(new Date()) is [] so rebuilding them from scratch yields {},
  // which Prisma then reports as "Argument `_ref` is missing" for every
  // `gte`/`lte`/`lt`/`gt` filter. That silently broke every date-range query on
  // SQLite (monthly report, unread meters, force-close, analytics...).
  // Only plain objects and arrays carry query args worth rewriting.
  if (node instanceof Date) return node
  if (Array.isArray(node)) {
    return node.map((n) => stripInsensitive(n)) as unknown as T
  }
  const proto = Object.getPrototypeOf(node)
  if (proto !== null && proto !== Object.prototype) return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'mode' && typeof v === 'string') {
      // Drop the `mode` key entirely (works for both "insensitive" and "default").
      continue
    }
    out[k] = stripInsensitive(v)
  }
  return out as T
}

let _prisma: PrismaClient | undefined

/**
 * Lazily create the PrismaClient on first use (not at module load time). *
 * Why: Loading the Prisma engine + generated client for 20+ models (including
 * the multi-org foundation) consumes ~150MB RSS at instantiation. When a route
 * imports `db` AND heavy auth modules (jose, bcrypt, rbac) at the same time,
 * the combined cold-load memory spike exceeds the 4GB sandbox cgroup limit and
 * the process is silently OOM-killed. By deferring PrismaClient creation to
 * the first actual DB query, the memory cost is paid incrementally per route,
 * keeping the peak well under the sandbox ceiling.
 *
 * SQLite compatibility: when DATABASE_URL is `file:`, we wrap the client in a
 * `$extends` query interceptor that strips `mode: "insensitive"` from all
 * where/query args. SQLite doesn't support that mode (PostgreSQL-only), and
 * ~20 route files use it inline. The interceptor is a single-point fix that
 * makes those routes work on SQLite without editing each one.
 */
function getPrisma(): PrismaClient {
  if (_prisma) return _prisma
  if (globalForPrisma.prisma) {
    _prisma = globalForPrisma.prisma
    return _prisma
  }
  const base = new PrismaClient({
    // Pass the pool-tuned URL so Prisma's internal pool respects the limits.
    ...(datasourceUrl !== process.env.DATABASE_URL
      ? { datasources: { db: { url: datasourceUrl } } }
      : {}),
    // In production, only log errors. In development, default to ['error']
    // (was ['query'] which produced excessive I/O on every request).
    // Set PRISMA_LOG_QUERIES=1 to re-enable query logging for debugging.
    log:
      process.env.NODE_ENV === 'production'
        ? ['error']
        : process.env.PRISMA_LOG_QUERIES === '1'
          ? ['query', 'error', 'warn']
          : ['error', 'warn'],
  })
  // SQLite compatibility shim — strip `mode: "insensitive"` from all queries.
  // PostgreSQL keeps the mode (real case-insensitive search). SQLite drops it
  // (default LIKE is already case-insensitive for ASCII; Thai has no case).
  //
  // IMPORTANT: we SKIP raw SQL operations ($queryRaw, $executeRaw) because
  // their args shape is `{ query, parameters }` and stripping `query` from
  // them would break the SQL execution ("Argument `query` is missing").
  // Only strip from ORM-style operations (findMany, etc.) that use `where`.
  const extended = isSqlite
    ? base.$extends({
        query: {
          $allOperations: async (params: {
            operation: string
            args: unknown
            query: (args: unknown) => Promise<unknown>
          }) => {
            const isRaw =
              params.operation === '$queryRaw' ||
              params.operation === '$executeRaw' ||
              params.operation === '$queryRawUnsafe' ||
              params.operation === '$executeRawUnsafe' ||
              params.operation === '$queryRawTyped' ||
              params.operation === '$executeRawTyped'
            const cleaned = isRaw ? params.args : stripInsensitive(params.args)
            return params.query(cleaned)
          },
        },
      })
    : base
  _prisma = extended as unknown as PrismaClient
  globalForPrisma.prisma = _prisma
  return _prisma
}

/** Get the underlying PrismaClient (for $transaction etc.). */
export function getDbClient(): PrismaClient {
  return getPrisma()
}

/** Get the BASE PrismaClient without $extends (for $transaction). */
let _baseClient: PrismaClient | undefined
export function getBaseClient(): PrismaClient {
  if (_baseClient) return _baseClient
  _baseClient = new PrismaClient({
    ...(datasourceUrl !== process.env.DATABASE_URL
      ? { datasources: { db: { url: datasourceUrl } } }
      : {}),
    log: ['error'],
  })
  return _baseClient
}

/**
 * Lazy proxy: PrismaClient is created only on first property access, not at
 * module import time. This keeps `import { db } from '@/lib/db'` cheap and
 * defers the ~150MB Prisma engine load until the first DB query runs.
 *
 * All property accesses (db.user, db.$queryRaw, db.$transaction, etc.) are
 * transparently forwarded to the underlying PrismaClient instance. Functions
 * are bound to the real client so `this` context is preserved.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const prisma = getPrisma()
    const value = Reflect.get(prisma, prop, receiver)
    if (typeof value === 'function') {
      return value.bind(prisma)
    }
    return value
  },
}) as PrismaClient
