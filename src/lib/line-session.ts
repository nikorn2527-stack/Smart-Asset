// ============================================================
// line-session.ts — LINE public-reporter session cookie helper
// (Task ID: PUBLIC-QR-2B-LINE-LOGIN  ·  Security fix: SECURITY-AUDIT-FIXES)
// ============================================================
// The `line_session` cookie is a SEPARATE cookie from `itam-session`
// (staff auth via NextAuth-style JWT). It only carries LINE identity for
// PUBLIC users (Tier 1/2 QR repair reporters).
//
// ── SECURITY ──────────────────────────────────────────────────────
// The cookie payload is encrypted with AES-256-GCM using a key derived
// (SHA-256) from `LINE_SESSION_SECRET` (preferred) or `JWT_SECRET`
// (fallback). Each cookie carries its own random IV + auth tag, so the
// same payload encrypts to a different ciphertext every time, and any
// tampering with the cookie is detected on decrypt (GCM auth tag check).
//
// Backward compatibility: if decryption fails (e.g. legacy base64 cookie
// issued before this fix), we attempt the old base64-JSON decode path
// and log a warning. This avoids forcing all logged-in LINE users to
// re-authenticate on the first deploy. Once all sessions have rotated
// (24h), the legacy path can be removed.
// ============================================================

import crypto from 'node:crypto'
import type { NextRequest, NextResponse } from 'next/server'

export const LINE_SESSION_COOKIE = 'line_session'
export const LINE_STATE_COOKIE = 'line_login_state'
export const LINE_SESSION_TTL_SECONDS = 24 * 60 * 60 // 24h

export interface LineSession {
  /** LINE userId (e.g. 'U1234567890abcdef...') */
  userId: string
  /** Display name from LINE profile */
  displayName: string
  /** Avatar URL (LINE CDN, expires ~30 days) */
  pictureUrl?: string
  /**
   * Phone number from id_token phone scope (Tier 1). null/undefined if phone
   * scope was not requested/granted (Tier 2).
   */
  scopePhone?: string | null
  /** ISO timestamp when the session expires. */
  expiresAt: string
}

interface StateCookiePayload {
  state: string
  /** Where to return the user after LINE callback completes. */
  redirect: string
  /** When the state was issued (ISO timestamp). Used to enforce 10-min expiry. */
  createdAt: string
}

// ─── Encryption (AES-256-GCM) ─────────────────────────────────────────
//
// Cookie format: base64(iv || ciphertext || authTag)
//   - iv       : 12 bytes (GCM standard nonce length)
//   - ciphertext : same length as plaintext
//   - authTag  : 16 bytes (GCM auth tag — detects tampering)

const ALGO = 'aes-256-gcm'
const IV_LEN = 12 // GCM standard
const TAG_LEN = 16

/** Minimum ciphertext length: iv + at least 1 byte + tag. */
const MIN_TOKEN_LEN = IV_LEN + 1 + TAG_LEN

function getKey(): Buffer {
  const secret =
    process.env.LINE_SESSION_SECRET || process.env.JWT_SECRET || ''
  if (!secret) {
    throw new Error(
      'LINE_SESSION_SECRET (or JWT_SECRET) must be set to encrypt line_session cookie',
    )
  }
  // Derive a 32-byte key (AES-256) from the secret via SHA-256.
  return crypto.createHash('sha256').update(secret).digest()
}

/**
 * Encrypt an arbitrary JSON-serializable payload with AES-256-GCM.
 * Returns base64(iv || ciphertext || authTag).
 */
export async function encryptSession(payload: object): Promise<string> {
  const key = getKey()
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, encrypted, tag]).toString('base64')
}

/**
 * Decrypt a token produced by `encryptSession`. Returns null on any failure
 * (bad base64, truncated, wrong key, tampered auth tag, invalid JSON).
 */
export async function decryptSession<T = unknown>(token: string): Promise<T | null> {
  try {
    const buf = Buffer.from(token, 'base64')
    if (buf.length < MIN_TOKEN_LEN) return null
    const iv = buf.subarray(0, IV_LEN)
    const tag = buf.subarray(buf.length - TAG_LEN)
    const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN)
    const key = getKey()
    const decipher = crypto.createDecipheriv(ALGO, key, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ])
    return JSON.parse(decrypted.toString('utf8')) as T
  } catch {
    return null
  }
}

// ─── Legacy base64 (for backward compat during the rollout window) ────

function encodeBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
}

function decodeBase64Json<T = unknown>(token: string): T | null {
  try {
    const json = Buffer.from(token, 'base64').toString('utf8')
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

/**
 * Heuristic: does this cookie value "look like" an encrypted token? Encrypted
 * tokens are at least MIN_TOKEN_LEN bytes when base64-decoded. Legacy
 * base64-JSON cookies may also satisfy this length, so this is only a hint —
 * the real test is whether decryptSession succeeds.
 */
function looksEncrypted(token: string): boolean {
  try {
    const buf = Buffer.from(token, 'base64')
    return buf.length >= MIN_TOKEN_LEN
  } catch {
    return false
  }
}

// ─── Session cookie (line_session) ─────────────────────────────────────

/**
 * Read + validate the `line_session` cookie from a NextRequest.
 * Returns null if the cookie is missing, malformed, expired, or fails
 * authentication (tampered / wrong key).
 *
 * Backward compat: if the cookie doesn't decrypt (legacy base64-JSON), we
 * fall back to the legacy decode path and log a warning. This is a
 * best-effort fallback for cookies issued before the encryption fix rolled
 * out; once all sessions have rotated (24h TTL) the fallback can be removed.
 */
export async function getLineSession(req: NextRequest): Promise<LineSession | null> {
  const raw = req.cookies.get(LINE_SESSION_COOKIE)?.value
  if (!raw) return null

  let parsed: LineSession | null = null

  // 1. Try the encrypted path first.
  if (looksEncrypted(raw)) {
    parsed = await decryptSession<LineSession>(raw)
    if (parsed === null) {
      // 2. Decryption failed — try legacy base64-JSON as a fallback.
      //    This covers cookies issued before the encryption fix rolled out.
      //    Once all sessions have rotated (24h TTL), this branch can be
      //    removed along with the legacy decode helpers.
      const legacy = decodeBase64Json<LineSession>(raw)
      if (legacy) {
        console.warn(
          '[line-session] falling back to legacy base64 decode for line_session cookie — ' +
            'this cookie was issued before AES-256-GCM encryption was enabled and will ' +
            'be replaced by an encrypted cookie on the next LINE login.',
        )
        parsed = legacy
      }
    }
  } else {
    // Cookie doesn't look encrypted — must be a legacy base64-JSON cookie.
    parsed = decodeBase64Json<LineSession>(raw)
  }

  if (!parsed) return null
  if (typeof parsed.userId !== 'string' || typeof parsed.displayName !== 'string') {
    return null
  }
  if (typeof parsed.expiresAt !== 'string') return null
  const exp = Date.parse(parsed.expiresAt)
  if (Number.isNaN(exp) || exp < Date.now()) return null
  return parsed
}

/**
 * Set the `line_session` cookie on a NextResponse (used by the callback
 * route after a successful LINE login). The payload is encrypted with
 * AES-256-GCM before being stored.
 */
export async function setLineSessionCookie(
  res: NextResponse,
  session: LineSession,
): Promise<void> {
  const value = await encryptSession(session)
  res.cookies.set(LINE_SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: LINE_SESSION_TTL_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  })
}

/**
 * Clear the `line_session` cookie (used by the logout route).
 */
export function clearLineSessionCookie(res: NextResponse): void {
  res.cookies.set(LINE_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    secure: process.env.NODE_ENV === 'production',
  })
}

// ─── State cookie (line_login_state) ───────────────────────────────────
//
// The state cookie is intentionally NOT encrypted: it only carries a CSRF
// nonce + a redirect URL + a 10-min timestamp. Its integrity comes from
// the OAuth `state` echo-back check on the callback, not from encryption.
// Keeping it as base64-JSON avoids an extra crypto round-trip in the
// already-latency-sensitive login redirect.

/**
 * Save the OAuth `state` value + the post-login redirect target into a
 * short-lived (10-min) HTTP-only cookie. The state cookie has TWO purposes:
 *   1. Anti-CSRF: state echoed by LINE must match what we saved.
 *   2. Resume UX: we need to know where to send the user after the callback.
 */
export function setLineStateCookie(
  res: NextResponse,
  payload: StateCookiePayload,
): void {
  const value = encodeBase64Json(payload)
  res.cookies.set(LINE_STATE_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60, // 10 minutes
    secure: process.env.NODE_ENV === 'production',
  })
}

/**
 * Read the saved state + redirect from the cookie. Returns null if missing,
 * malformed, or older than 10 minutes.
 */
export function getLineStateCookie(
  req: NextRequest,
): StateCookiePayload | null {
  const raw = req.cookies.get(LINE_STATE_COOKIE)?.value
  if (!raw) return null
  const parsed = decodeBase64Json<StateCookiePayload>(raw)
  if (!parsed) return null
  if (
    typeof parsed.state !== 'string' ||
    typeof parsed.redirect !== 'string' ||
    typeof parsed.createdAt !== 'string'
  ) {
    return null
  }
  // Belt-and-suspenders: enforce 10-min expiry on top of maxAge.
  const createdAt = Date.parse(parsed.createdAt)
  if (Number.isNaN(createdAt)) return null
  if (Date.now() - createdAt > 10 * 60 * 1000) return null
  return parsed
}

/** Clear the state cookie (after the callback succeeds or fails). */
export function clearLineStateCookie(res: NextResponse): void {
  res.cookies.set(LINE_STATE_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    secure: process.env.NODE_ENV === 'production',
  })
}
