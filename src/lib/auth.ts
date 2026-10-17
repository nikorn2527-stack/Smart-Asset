/**
 * auth.ts — ITAM Authentication (server-only).
 *
 * Re-exports the pure RBAC helpers from `auth-shared.ts` and adds the
 * server-side primitives that require `node:crypto` + `jose`:
 *   • Password hashing — PBKDF2-like iterated SHA-256 (salt|password → 10 000
 *     rounds), identical algorithm to GAS `hashPassword_()` so the 5 users
 *     imported from Google Sheets can log in unchanged.
 *   • JWT (HS256, 6 h TTL) via `jose` — carries email + role + name +
 *     allowedSites. Logout = client clears token + server-side blacklist Set.
 *   • Rate limiting — 5 fails → 5-min lockout per (username + IP).
 *
 * ⚠️  Do NOT import this file from client components — use `auth-shared.ts`
 *    for pure types/constants/permission checks.
 */

import crypto from 'node:crypto'

// Lazy-load jose + bcryptjs — heavy modules that cause OOM during cold-compile
// in the 4GB sandbox when imported at module level.
let _bcrypt: typeof import('bcryptjs') | null = null
function getBcrypt(): typeof import('bcryptjs') {
  if (!_bcrypt) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _bcrypt = require('bcryptjs')
  }
  return _bcrypt!
}

let _jose: typeof import('jose') | null = null
async function getJose() {
  if (!_jose) {
    _jose = await import('jose')
  }
  return _jose
}

// Re-export everything that's safe for both server + client
export {
  type Permission,
  type Role,
  type AuthUser,
  type UserPermissionRow,
  type PermissionGroup,
  type PermissionMeta,
  ROLE_PERMISSIONS,
  ROLE_LABELS,
  PERMISSION_GROUPS,
  ALL_PERMISSION_KEYS,
  normalizeRole,
  getRolePermissions,
  getUserPermissions,
  parseCustomPermissions,
  hasPermission,
  hasResolvedPermission,
  isAdminRole,
  isSuperAdminRole,
  getAllowedSites,
  canAccessSite,
  siteFilterForUser,
  toAuthUser,
} from './auth-shared'

// ─── Password hashing (PBKDF2-like SHA-256 — identical to GAS Auth.gs) ──
const PBKDF2_ITERATIONS = 10_000

/**
 * Hash a password with salt using the GAS-compatible iterated SHA-256 scheme.
 *   raw   = `${salt}|${password}`
 *   hex₀  = sha256(raw)
 *   hexᵢ  = sha256(i%1000===0 ? `${raw}|${i}` : hexᵢ₋₁)
 *   final = hex₁₀₀₀₀
 */
export function hashPassword(password: string, salt: string, iterations = PBKDF2_ITERATIONS): string {
  const raw = `${salt ?? ''}|${password ?? ''}`
  let hex = crypto.createHash('sha256').update(raw, 'utf8').digest('hex')
  for (let i = 1; i < iterations; i++) {
    const input = i % 1000 === 0 ? `${raw}|${i}` : hex
    hex = crypto.createHash('sha256').update(input, 'utf8').digest('hex')
  }
  return hex
}

export function createPasswordSalt(): string {
  // 2 random UUIDs (no dashes) + timestamp — same shape as GAS createPasswordSalt()
  const a = crypto.randomUUID().replace(/-/g, '')
  const b = crypto.randomUUID().replace(/-/g, '')
  return `${a}${b}${Date.now()}`
}

/** Create a fresh {hash, salt} pair for a new password. */
export function hashNewPassword(password: string): { hash: string; salt: string } {
  const salt = createPasswordSalt()
  return { hash: hashPassword(password, salt, PBKDF2_ITERATIONS), salt }
}

/**
 * Verify a password against a stored hash. Tries the modern PBKDF2 (10 000
 * rounds) hash first, then the legacy single-iteration hash — matching the
 * GAS `verifyPassword_` fallback. Returns `true` on match.
 */
export function verifyPassword(
  password: string,
  storedHash: string | null,
  storedSalt: string | null,
): boolean {
  if (!storedHash || !storedSalt) return false
  const target = storedHash.trim()
  if (!target) return false
  // bcrypt (starts with $2b$ or $2a$)
  if (target.startsWith('$2b$') || target.startsWith('$2a$')) {
    try {
      return getBcrypt().compareSync(password, target)
    } catch {
      return false
    }
  }
  // Modern PBKDF2-like (10 000 rounds)
  const lowerTarget = target.toLowerCase()
  if (hashPassword(password, storedSalt, PBKDF2_ITERATIONS).toLowerCase() === lowerTarget) return true
  // Legacy single-round (GAS Auth.gs oldHash path)
  if (hashPassword(password, storedSalt, 1).toLowerCase() === lowerTarget) return true
  return false
}

// ─── JWT token management ────────────────────────────────────────────
// In production, JWT_SECRET must be set explicitly — fail closed if missing.
// In development (NODE_ENV !== 'production'), fall back to a dev-only secret
// so the sandbox/preview still works without env configuration.
const JWT_SECRET_RAW = (() => {
  const envSecret = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET
  if (envSecret) return envSecret
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET is not set in production. Refusing to start with a predictable secret.')
    throw new Error('JWT_SECRET is required in production. Set it in your environment variables.')
  }
  console.warn('WARNING: Using fallback dev JWT secret. Set JWT_SECRET in production.')
  return 'itam-dev-secret-change-me-in-production-please-32bytes'
})()
// jose expects a Uint8Array secret for HS256
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_RAW)
export const TOKEN_TTL_SECONDS = 6 * 60 * 60 // 6 hours — matches Apps Script CONFIG.AUTH_TOKEN_TTL
// SPRINT-2 #2: refresh token support. Access tokens stay at 6h for backward
// compat (legacy clients expect long TTL), but new logins also issue a
// refresh token that can be exchanged for a new access token without
// re-entering password. This is the foundation for eventually shortening
// the access token TTL to 1h.
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 days
export const REFRESH_TOKEN_TYPE = 'refresh' // tag in JWT `typ` claim

export interface ItamJWTPayload {
  email: string
  role: import('./auth-shared').Role
  name: string | null
  username: string | null
  allowedSites: string | 'ALL'
  /** 'access' (default) or 'refresh' — refresh tokens can only be used
   * to mint new access tokens via /api/auth/refresh, never for API calls. */
  typ?: 'access' | 'refresh'
  [key: string]: unknown
}

/** Issue a signed JWT carrying the user identity. */
export async function createToken(user: {
  email: string
  role: string
  name: string | null
  username: string | null
  allowedSites: string | null
}): Promise<string> {
  const { normalizeRole, isSuperAdminRole } = await import('./auth-shared')
  const role = normalizeRole(user.role)
  const payload: ItamJWTPayload = {
    email: user.email.toLowerCase(),
    role,
    name: user.name,
    username: user.username,
    allowedSites: isSuperAdminRole(role) ? 'ALL' : (user.allowedSites ?? 'ALL'),
  }
  return (async () => {
    const { SignJWT } = await getJose()
    return new SignJWT(payload as any)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.email.toLowerCase())
      .setIssuedAt()
      .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
      .sign(JWT_SECRET)
  })()
}

/** Verify a JWT and return its payload, or `null` if invalid/expired/blacklisted.
 * SPRINT-2 #2: also reject refresh tokens — they should never be used for
 * regular API calls, only exchanged at /api/auth/refresh for a new access
 * token. This prevents a refresh token leak from being directly usable. */
export async function verifyToken(token: string | null | undefined): Promise<ItamJWTPayload | null> {
  if (!token) return null
  try {
    const trimmed = token.trim()
    // Reject blacklist tokens (logout)
    if (isTokenBlacklisted(trimmed)) return null
    const { jwtVerify } = await getJose()
    const { payload } = await jwtVerify(trimmed, JWT_SECRET as any, {
      algorithms: ['HS256'],
    })
    const result = payload as ItamJWTPayload
    // SPRINT-2 #2: refresh tokens can't be used for API calls
    if (result.typ === REFRESH_TOKEN_TYPE) return null
    return result
  } catch {
    return null
  }
}

/**
 * SPRINT-2 #2: Verify a REFRESH token (only valid at /api/auth/refresh).
 * Returns the payload only if the token is a refresh token (typ='refresh').
 * Access tokens are rejected here so they can't be misused as refresh tokens.
 */
export async function verifyRefreshToken(token: string | null | undefined): Promise<ItamJWTPayload | null> {
  if (!token) return null
  try {
    const trimmed = token.trim()
    // Reject blacklist tokens (logout clears refresh tokens too)
    if (isTokenBlacklisted(trimmed)) return null
    const { jwtVerify } = await getJose()
    const { payload } = await jwtVerify(trimmed, JWT_SECRET as any, {
      algorithms: ['HS256'],
    })
    const result = payload as ItamJWTPayload
    // Only refresh tokens are valid here
    if (result.typ !== REFRESH_TOKEN_TYPE) return null
    return result
  } catch {
    return null
  }
}

/**
 * SPRINT-2 #2: Issue a refresh token (typ='refresh', 7-day TTL).
 * The token carries the same identity payload so /api/auth/refresh can
 * issue a new access token without re-loading the user from DB.
 *
 * The refresh token CAN be blacklisted (logout) just like access tokens.
 * For production with multiple server instances, the blacklist should be
 * backed by Redis/KV — currently it's in-memory (acceptable for single-
 * instance Vercel Hobby).
 */
export async function createRefreshToken(user: {
  email: string
  role: string
  name: string | null
  username: string | null
  allowedSites: string | null
}): Promise<string> {
  const { normalizeRole, isSuperAdminRole } = await import('./auth-shared')
  const role = normalizeRole(user.role)
  const payload: ItamJWTPayload = {
    email: user.email.toLowerCase(),
    role,
    name: user.name,
    username: user.username,
    allowedSites: isSuperAdminRole(role) ? 'ALL' : (user.allowedSites ?? 'ALL'),
    typ: REFRESH_TOKEN_TYPE,
  }
  return (async () => {
    const { SignJWT } = await getJose()
    return new SignJWT(payload as any)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.email.toLowerCase())
      .setIssuedAt()
      .setExpirationTime(`${REFRESH_TOKEN_TTL_SECONDS}s`)
      .sign(JWT_SECRET)
  })()
}

// ─── Token blacklist (logout) — in-memory Map with per-token expiry ───
// Tokens are stored with their expiration timestamp so they can be safely
// pruned only after their natural JWT exp has passed (TTL = 6 hours).
// This prevents the previous bug where the entire Set was cleared every
// 10 minutes, allowing logged-out tokens to become valid again.
interface BlacklistEntry {
  token: string
  expiresAt: number // ms epoch — derived from JWT exp
}
const _blacklist = new Map<string, BlacklistEntry>()
let _lastPrune = Date.now()
const PRUNE_INTERVAL_MS = 10 * 60 * 1000 // prune scan every 10 min (NOT clear)

export function blacklistToken(token: string): void {
  const t = token.trim()
  if (!t) return
  // Try to decode exp from the JWT payload (middle base64 segment).
  // If decoding fails, default to 6 hours from now (TOKEN_TTL_SECONDS).
  let expiresAt = Date.now() + TOKEN_TTL_SECONDS * 1000
  try {
    const parts = t.split('.')
    if (parts.length === 3) {
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8'),
      ) as { exp?: number }
      if (payload.exp) {
        expiresAt = payload.exp * 1000
      }
    }
  } catch {
    // keep default
  }
  _blacklist.set(t, { token: t, expiresAt })
  // Prune expired entries every 10 minutes — only removes tokens past their exp
  if (Date.now() - _lastPrune > PRUNE_INTERVAL_MS) {
    const now = Date.now()
    for (const [key, entry] of _blacklist) {
      if (entry.expiresAt <= now) {
        _blacklist.delete(key)
      }
    }
    _lastPrune = now
  }
}

export function isTokenBlacklisted(token: string): boolean {
  const t = token.trim()
  if (!t) return false
  const entry = _blacklist.get(t)
  if (!entry) return false
  // If the entry has expired, remove it lazily and return false
  if (entry.expiresAt <= Date.now()) {
    _blacklist.delete(t)
    return false
  }
  return true
}

// ─── Rate limiting (login) — 5 fails → 5 min lockout per username+IP ─
interface RateBucket {
  failures: number
  firstFailureAt: number
  lockedUntil: number // 0 = not locked
}
const _rateLimit = new Map<string, RateBucket>()
export const RATE_LIMIT_MAX_ATTEMPTS = 5
export const RATE_LIMIT_LOCKOUT_MS = 5 * 60 * 1000 // 5 minutes

/** Check the rate-limit bucket for `key`. Returns `{ allowed, retryAfterMs }`. */
export function checkLoginRateLimit(key: string): { allowed: boolean; retryAfterMs: number; attempts: number } {
  const k = String(key ?? '').toLowerCase().trim()
  const bucket = _rateLimit.get(k)
  if (!bucket) return { allowed: true, retryAfterMs: 0, attempts: 0 }
  // Expired lockout — reset
  if (bucket.lockedUntil && Date.now() > bucket.lockedUntil) {
    _rateLimit.delete(k)
    return { allowed: true, retryAfterMs: 0, attempts: 0 }
  }
  if (bucket.lockedUntil) {
    return { allowed: false, retryAfterMs: bucket.lockedUntil - Date.now(), attempts: bucket.failures }
  }
  return { allowed: true, retryAfterMs: 0, attempts: bucket.failures }
}

/** Record a failed login attempt; locks the bucket if MAX_ATTEMPTS reached. */
export function recordLoginFailure(key: string): { locked: boolean; retryAfterMs: number } {
  const k = String(key ?? '').toLowerCase().trim()
  const now = Date.now()
  let bucket = _rateLimit.get(k)
  if (!bucket) {
    bucket = { failures: 0, firstFailureAt: now, lockedUntil: 0 }
    _rateLimit.set(k, bucket)
  }
  bucket.failures += 1
  if (bucket.failures >= RATE_LIMIT_MAX_ATTEMPTS && !bucket.lockedUntil) {
    bucket.lockedUntil = now + RATE_LIMIT_LOCKOUT_MS
    return { locked: true, retryAfterMs: RATE_LIMIT_LOCKOUT_MS }
  }
  return { locked: false, retryAfterMs: 0 }
}

/** Clear the rate-limit bucket after a successful login. */
export function clearLoginRateLimit(key: string): void {
  _rateLimit.delete(String(key ?? '').toLowerCase().trim())
}
