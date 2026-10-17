/**
 * webauthn.ts — WebAuthn / Passkey helpers (server-side).
 *
 * รองรับล็อกอินด้วยPasskey/ใบหน้า — Touch ID, Face ID, Windows Hello,
 * Android fingerprint, hardware security keys.
 *
 * rpID = current host (works on localhost + production domain).
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from '@simplewebauthn/server'
import type { AuthenticatorTransport } from '@simplewebauthn/server'

export interface WebAuthnConfig {
  rpName: string
  rpID: string
  origin: string
}

/**
 * Normalize the `WebAuthnCredential.transports` DB column into the
 * `AuthenticatorTransport[]` shape @simplewebauthn expects.
 *
 * The column stores a comma-separated String (SQLite has no array type),
 * e.g. `"internal,hybrid"` or `null`. Unrecognized values are dropped so a
 * hand-edited row can't crash verification with an invalid enum value.
 */
export function parseTransports(raw: string | null | undefined): AuthenticatorTransport[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t): t is AuthenticatorTransport =>
      ['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card', 'cable'].includes(
        t as AuthenticatorTransport,
      ),
    )
}

/** Inverse of {@link parseTransports} — for persisting to the DB column. */
export function serializeTransports(list: AuthenticatorTransport[] | null | undefined): string | null {
  if (!list || list.length === 0) return null
  return list.join(',')
}

export function getWebAuthnConfig(req: Request): WebAuthnConfig {
  const host = req.headers.get('host') || 'localhost:3000'
  const protocol = req.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  const rpID = host.split(':')[0]
  const origin = `${protocol}://${host}`
  return { rpName: 'IT Asset Management', rpID, origin }
}

export async function beginRegistration(opts: {
  userId: string
  userEmail: string
  userName: string
  /**
   * Credentials already registered for this user.
   *
   * `transports` is the raw DB column: a comma-separated String (e.g.
   * `"internal,hybrid"`), NOT an array — see `WebAuthnCredential.transports`
   * in prisma/schema.prisma. Passing an array would throw
   * `TypeError: transports.split is not a function` at runtime.
   */
  existingCredentials: Array<{ id: string; transports?: string | null }>
  config: WebAuthnConfig
}) {
  const { userId, userEmail, userName, existingCredentials, config } = opts
  const userID = new TextEncoder().encode(userId)
  return await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userID,
    userName: userEmail,
    userDisplayName: userName,
    attestationType: 'none',
    excludeCredentials: existingCredentials.map((c) => ({
      id: c.id,
      type: 'public-key' as const,
      transports: parseTransports(c.transports),
    })),
    authenticatorSelection: {
      // Don't force 'platform' — allow BOTH platform (Touch ID/Face ID/
      // Windows Hello) AND cross-platform (USB security key, Bluetooth
      // phone). This fixes the bug where users without a platform
      // authenticator couldn't register at all.
      // authenticatorAttachment: 'platform',  ← removed (too restrictive)
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    supportedAlgorithmIDs: [-7, -257],
  })
}

export async function finishRegistration(opts: {
  body: unknown
  expectedChallenge: string
  config: WebAuthnConfig
}): Promise<VerifiedRegistrationResponse> {
  return await verifyRegistrationResponse({
    response: opts.body as Parameters<typeof verifyRegistrationResponse>[0]['response'],
    expectedChallenge: opts.expectedChallenge,
    expectedOrigin: opts.config.origin,
    expectedRPID: opts.config.rpID,
    requireUserVerification: false,
  })
}

export async function beginAuthentication(opts: {
  config: WebAuthnConfig
  /**
   * `transports` is the raw comma-separated DB column (or null) — see
   * {@link parseTransports}.
   */
  allowedCredentials?: Array<{ id: string; transports?: string | null }>
}) {
  return await generateAuthenticationOptions({
    rpID: opts.config.rpID,
    allowCredentials: opts.allowedCredentials?.map((c) => ({
      id: c.id,
      type: 'public-key' as const,
      transports: parseTransports(c.transports),
    })),
    userVerification: 'preferred',
  })
}

export async function finishAuthentication(opts: {
  body: unknown
  expectedChallenge: string
  config: WebAuthnConfig
  credential: { id: string; publicKey: Uint8Array; counter: number; transports?: string[] }
}): Promise<VerifiedAuthenticationResponse> {
  return await verifyAuthenticationResponse({
    response: opts.body as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
    expectedChallenge: opts.expectedChallenge,
    expectedOrigin: opts.config.origin,
    expectedRPID: opts.config.rpID,
    credential: {
      id: opts.credential.id,
      // Re-wrap into a fresh ArrayBuffer-backed view. Prisma hands back a
      // `Buffer` whose backing store is `ArrayBufferLike`; the library
      // requires `Uint8Array<ArrayBuffer>`, and TS rejects the wider type
      // even though the data is identical at runtime.
      publicKey: new Uint8Array(opts.credential.publicKey),
      counter: opts.credential.counter,
      ...(opts.credential.transports
        ? { transports: opts.credential.transports }
        : {}),
    },
    requireUserVerification: false,
  })
}
