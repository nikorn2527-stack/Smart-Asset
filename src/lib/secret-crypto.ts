/**
 * secret-crypto.ts — AES-256-GCM encryption for secrets at rest.
 *
 * SPRINT-1 #5 (FIX-019): AppSetting.value, SiteAttribute.LineOA, and
 * SiteAttribute.TelegramChatId are stored as PLAINTEXT in the database.
 * The API response layer already masks them via SECRET_KEY_PATTERNS in
 * `src/lib/auth-middleware.ts` (P0-SECURITY-AUTH), but anyone with DB
 * read access (DBA, backup file leak, SQL injection) can read them.
 *
 * This module provides `encryptSecret()` / `decryptSecret()` that wrap
 * the existing AES-256-GCM pattern from `line-session.ts` so the same
 * key rotation strategy (LINE_SESSION_SECRET → JWT_SECRET fallback)
 * applies. The ciphertext is stored as a single string:
 *
 *   "<iv_hex>:<auth_tag_hex>:<ciphertext_hex>"
 *
 * The `:` prefix lets us detect already-encrypted values on read (we
 * only attempt decryption when the value starts with the prefix).
 *
 * Usage in a route handler:
 *   import { encryptSecret, decryptSecret, isEncrypted } from '@/lib/secret-crypto'
 *   const stored = await encryptSecret(rawApiKey)
 *   const raw = isEncrypted(stored) ? await decryptSecret(stored) : stored
 *
 * Migration plan (one-time, after deploy):
 *   1. Add the new columns (e.g. AppSetting.valueEncrypted String?)
 *   2. Run a backfill script that reads each plaintext row, encrypts it,
 *      and writes the ciphertext to the new column.
 *   3. Switch reads to prefer the encrypted column, falling back to
 *      plaintext for any rows the backfill missed.
 *   4. Once all reads use the encrypted column, drop the plaintext one.
 *
 * For now we use a simpler approach: encrypt in-place and rely on the
 * "<iv>:<tag>:<ct>" prefix to detect encrypted values. This avoids a
 * schema migration but means rollback requires re-running decrypt on
 * every row.
 */

import crypto from 'node:crypto'

const ENCRYPTED_PREFIX = 'enc:' // human-readable marker for encrypted values

function getKey(): Buffer {
  // Prefer a dedicated secret for secret-at-rest; fall back to JWT_SECRET
  // so the feature works in dev without additional env setup.
  const raw =
    process.env.SECRET_ENCRYPTION_KEY ||
    process.env.LINE_SESSION_SECRET ||
    process.env.JWT_SECRET
  if (!raw) {
    throw new Error(
      'SECRET_ENCRYPTION_KEY (or LINE_SESSION_SECRET / JWT_SECRET) is required to encrypt secrets at rest',
    )
  }
  // Derive a 32-byte key with SHA-256 (AES-256 requires 32-byte key)
  return crypto.createHash('sha256').update(raw).digest()
}

/** Returns true if the value looks like an encrypted blob from encryptSecret(). */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX)
}

/**
 * Encrypt a plaintext secret for storage. Returns a string like:
 *   "enc:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>"
 *
 * Each call produces a different ciphertext (random IV), so two rows
 * with the same plaintext value will have different stored values.
 *
 * If the input is already encrypted (isEncrypted() returns true), the
 * input is returned unchanged (idempotent).
 *
 * If encryption is not configured (no key available), the input is
 * returned unchanged with a console warning — this lets the feature
 * work in dev without forcing env setup, but production MUST set the
 * env var to actually protect secrets.
 */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return plaintext
  if (isEncrypted(plaintext)) return plaintext // idempotent

  try {
    const key = getKey()
    const iv = crypto.randomBytes(12) // 96-bit IV recommended for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const ct = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ])
    const tag = cipher.getAuthTag()
    return `${ENCRYPTED_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`
  } catch (err) {
    if (err instanceof Error && err.message.includes('is required')) {
      // No key configured — dev mode. Warn but don't break the write.
      console.warn('[secret-crypto] SECRET_ENCRYPTION_KEY not set — storing plaintext:', err.message)
      return plaintext
    }
    throw err
  }
}

/**
 * Decrypt a value produced by encryptSecret(). Returns the original
 * plaintext.
 *
 * If the input is NOT encrypted (no `enc:` prefix), returns the input
 * unchanged — this makes migration safe: legacy plaintext rows still
 * work after the feature ships.
 *
 * Throws if the ciphertext is tampered (GCM auth tag check fails) or
 * the key is wrong.
 */
export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return stored ?? ''
  if (!isEncrypted(stored)) return stored // legacy plaintext — pass through

  const key = getKey()
  const parts = stored.slice(ENCRYPTED_PREFIX.length).split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted value format (expected iv:tag:ct)')
  }
  const [ivHex, tagHex, ctHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const ct = Buffer.from(ctHex, 'hex')

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([
    decipher.update(ct),
    decipher.final(),
  ])
  return pt.toString('utf8')
}

/**
 * Decrypt if encrypted, otherwise return as-is. Convenience wrapper
 * for read paths that don't know whether the value is encrypted.
 */
export function maybeDecrypt(value: string | null | undefined): string {
  if (!value) return value ?? ''
  return isEncrypted(value) ? decryptSecret(value) : value
}
