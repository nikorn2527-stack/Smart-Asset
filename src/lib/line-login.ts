// ============================================================
// line-login.ts — LINE Login v2.1 (Web flow) helpers
// (Task ID: PUBLIC-QR-2B-LINE-LOGIN)
// ============================================================
// PPIT (1 org) uses ONE shared LINE Login Channel. Each site has its OWN
// LINE OA (configured via SiteAttribute.LineOA). The LINE Login channel is
// separate from per-site LINE OA — its sole purpose is to identify public
// reporters (LINE userId + optional phone scope) so we can route them to
// the correct Tier 1/2/3 repair flow.
//
// Env vars (must be set in Vercel):
//   • LINE_LOGIN_CHANNEL_ID
//   • LINE_LOGIN_CHANNEL_SECRET
//   • LINE_LOGIN_REDIRECT_URI (optional — defaults to {origin}/api/auth/line/callback)
//
// This is a SEPARATE channel from the staff-facing LINE OAuth flow at
// /api/auth/oauth/line (which reads from AppSetting table). The staff flow
// creates real User accounts; this public flow only stores a 24h identity
// cookie that public QR repair endpoints can read.
// ============================================================

export const LINE_LOGIN_CONFIG = {
  /** Channel ID from LINE Developers Console (provider: ITAM, channel type: LINE Login) */
  channelId: process.env.LINE_LOGIN_CHANNEL_ID || '',
  /** Channel Secret — required for code-for-token exchange */
  channelSecret: process.env.LINE_LOGIN_CHANNEL_SECRET || '',
  /**
   * Scopes requested from the user:
   *   • profile  — displayName, pictureUrl, userId
   *   • openid   — id_token (carries sub = LINE userId)
   *   • phone    — phone number (requires LINE review before it works)
   *
   * IMPORTANT: The 'phone' scope requires explicit approval from LINE.
   * Without approval, login may still succeed but the id_token will not
   * contain phone_number, and the user will fall through to Tier 2.
   *
   * Setup steps:
   *   1. Go to LINE Developers Console → Channel → Permissions
   *   2. Request "Phone number" scope (requires 3-5 business days review)
   *   3. After approval, this scope will work automatically
   */
  scope: 'profile openid phone',
  /**
   * Redirect URI registered in LINE Developers Console.
   * Must be HTTPS in production. Override via env for non-default domains.
   */
  redirectUri:
    process.env.LINE_LOGIN_REDIRECT_URI ||
    (typeof window !== 'undefined'
      ? `${window.location.origin}/api/auth/line/callback`
      : ''),
  /** LINE authorize endpoint */
  authorizeUrl: 'https://access.line.me/oauth2/v2.1/authorize',
  /** LINE token endpoint (code → access_token + id_token) */
  tokenUrl: 'https://api.line.me/oauth2/v2.1/token',
  /** LINE profile endpoint (returns displayName, pictureUrl, userId, statusMessage) */
  profileUrl: 'https://api.line.me/v2/profile',
  /** LINE JWKS endpoint (public keys for id_token verification) */
  jwksUrl: 'https://api.line.me/oauth2/v2.1/certs',
  /** LINE verify endpoint (validates access_token + returns scope + expires_in) */
  verifyUrl: 'https://api.line.me/oauth2/v2.1/verify',
}

/** Returns true if both required env vars are configured. */
export function isLineLoginConfigured(): boolean {
  return Boolean(LINE_LOGIN_CONFIG.channelId && LINE_LOGIN_CONFIG.channelSecret)
}

/**
 * Build the LINE Login v2.1 authorize URL.
 *
 * @param state     Random anti-CSRF state (caller generates, must also store in cookie)
 * @param redirectUri Override default redirect URI (useful for tests / multiple domains)
 *
 * Example output:
 *   https://access.line.me/oauth2/v2.1/authorize
 *     ?response_type=code
 *     &client_id=1234567890
 *     &redirect_uri=https%3A%2F%2Fitam-next-js.vercel.app%2Fapi%2Fauth%2Fline%2Fcallback
 *     &state=abc123def456
 *     &scope=profile%20openid
 *     &bot_prompt=normal
 */
export function buildLineLoginUrl(state: string, redirectUri?: string): string {
  if (!isLineLoginConfigured()) {
    throw new Error(
      'LINE Login ยังไม่ได้ตั้งค่า — กรุณาตั้งค่า LINE_LOGIN_CHANNEL_ID และ LINE_LOGIN_CHANNEL_SECRET บน Vercel',
    )
  }
  const finalRedirect = redirectUri || LINE_LOGIN_CONFIG.redirectUri
  if (!finalRedirect) {
    throw new Error(
      'LINE Login redirect_uri ไม่ถูกต้อง — กรุณาตั้งค่า LINE_LOGIN_REDIRECT_URI บน Vercel',
    )
  }
  const url = new URL(LINE_LOGIN_CONFIG.authorizeUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', LINE_LOGIN_CONFIG.channelId)
  url.searchParams.set('redirect_uri', finalRedirect)
  url.searchParams.set('state', state)
  url.searchParams.set('scope', LINE_LOGIN_CONFIG.scope)
  // bot_prompt=aggressive — opens the "add LINE OA as friend" screen
  // automatically after the user logs in (if they haven't added the OA
  // linked to this LINE Login channel yet). This is critical for the
  // public QR repair flow: the WO completion notification uses LINE Push
  // API, which requires the user to have added the OA as a friend first.
  // Without this, push messages will silently fail with 401.
  url.searchParams.set('bot_prompt', 'aggressive')
  return url.toString()
}

/** LINE token response (POST /oauth2/v2.1/token with grant_type=authorization_code). */
export interface LineTokenResponse {
  access_token: string
  /** JWT containing sub (LINE userId), name, picture, and (if scope granted) phone_number */
  id_token?: string
  token_type: 'Bearer'
  /** Seconds until access_token expires (typically 30 days for LINE Login). */
  expires_in: number
  /** OAuth scopes granted — space-separated, e.g. 'profile openid' */
  scope?: string
  /** Optional refresh_token (only if refresh_token scope was requested). */
  refresh_token?: string
  /** Error fields (if exchange failed). */
  error?: string
  error_description?: string
}

/**
 * Exchange an authorization code for an access_token + id_token.
 *
 * Calls POST https://api.line.me/oauth2/v2.1/token with:
 *   grant_type=authorization_code
 *   code=<code>
 *   redirect_uri=<must match the one used in authorize URL>
 *   client_id=<channel_id>
 *   client_secret=<channel_secret>
 *
 * Throws on network failure. Caller must check `error` field on the returned
 * object for LINE-side errors.
 */
export async function exchangeLineCodeForToken(
  code: string,
  redirectUri: string,
): Promise<LineTokenResponse> {
  if (!isLineLoginConfigured()) {
    throw new Error(
      'LINE Login ยังไม่ได้ตั้งค่า — กรุณาตั้งค่า LINE_LOGIN_CHANNEL_ID และ LINE_LOGIN_CHANNEL_SECRET บน Vercel',
    )
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: LINE_LOGIN_CONFIG.channelId,
    client_secret: LINE_LOGIN_CONFIG.channelSecret,
  })
  const res = await fetch(LINE_LOGIN_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  // LINE returns 200 with error fields OR 400 with JSON error body — both parse as JSON.
  return (await res.json()) as LineTokenResponse
}

/** LINE profile (GET /v2/profile with Bearer access_token). */
export interface LineProfile {
  userId: string
  displayName: string
  pictureUrl?: string
  statusMessage?: string
}

/**
 * Fetch the user's LINE profile using an access_token.
 * Throws on non-2xx response.
 */
export async function getLineProfile(accessToken: string): Promise<LineProfile> {
  const res = await fetch(LINE_LOGIN_CONFIG.profileUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`LINE profile fetch failed: ${res.status} ${text}`)
  }
  const body = (await res.json()) as Partial<LineProfile>
  if (!body.userId || !body.displayName) {
    throw new Error('LINE profile response missing userId or displayName')
  }
  return {
    userId: body.userId,
    displayName: body.displayName,
    pictureUrl: body.pictureUrl || undefined,
    statusMessage: body.statusMessage || undefined,
  }
}

/** Decoded id_token payload (LINE signs with RS256). */
export interface LineIdTokenPayload {
  /** Subject = LINE userId */
  sub: string
  /** Issuer = https://access.line.me */
  iss: string
  /** Audience = our channel ID */
  aud: string
  /** Expiry (Unix seconds) */
  exp: number
  /** Issued-at (Unix seconds) */
  iat: number
  /** Display name (if 'profile' scope was granted) */
  name?: string
  /** Picture URL (if 'profile' scope was granted) */
  picture?: string
  /** Email (only if 'email' scope was granted — we don't request it) */
  email?: string
  /** Phone number (only if 'phone' scope was granted — requires LINE review) */
  phone_number?: string
}

/**
 * Decode (without signature verification) the id_token JWT payload.
 *
 * This is safe in our flow because the id_token was obtained directly from
 * LINE's token endpoint over HTTPS — we are the only party that ever sees
 * this token. Signature verification is recommended for higher assurance
 * (see `verifyIdToken` below which uses jose + LINE's JWKS).
 */
export function decodeIdToken(idToken: string): LineIdTokenPayload | null {
  try {
    const parts = idToken.split('.')
    if (parts.length !== 3) return null
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = Buffer.from(padded, 'base64').toString('utf8')
    const parsed = JSON.parse(json) as LineIdTokenPayload
    if (typeof parsed.sub !== 'string' || typeof parsed.aud !== 'string') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/**
 * Verify an id_token's RS256 signature against LINE's JWKS.
 *
 * Uses `jose` (already installed). Returns the decoded payload on success,
 * or null if the signature is invalid, the token is expired, or the audience
 * doesn't match our channel ID.
 *
 * This is optional in our flow — `decodeIdToken` is sufficient for identity
 * because we received the token directly from LINE. Use this for stronger
 * assurance (e.g. if the token might have been intercepted).
 */
export async function verifyIdToken(
  idToken: string,
): Promise<LineIdTokenPayload | null> {
  try {
    // Lazy import so the jose dependency isn't pulled into bundles that only
    // need `buildLineLoginUrl` / `decodeIdToken` (e.g. client-side helpers).
    const { jwtVerify, createRemoteJWKSet } = await import('jose')
    const JWKS = createRemoteJWKSet(new URL(LINE_LOGIN_CONFIG.jwksUrl))
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: 'https://access.line.me',
      audience: LINE_LOGIN_CONFIG.channelId,
    })
    return payload as unknown as LineIdTokenPayload
  } catch (err) {
    console.error('[line-login] verifyIdToken failed:', err)
    return null
  }
}

/**
 * Convenience: extract a normalised phone number from an id_token phone_number
 * claim. LINE returns E.164 format (e.g. '+66812345678'); we strip the leading
 * '+' and leading country code if it's Thai ('66') so the value matches what
 * users type in our Tier 3 form ('0812345678').
 */
export function normalizeLinePhone(phoneNumber: string | undefined): string | undefined {
  if (!phoneNumber) return undefined
  let p = phoneNumber.trim()
  if (p.startsWith('+')) p = p.slice(1)
  // Thai numbers: LINE returns '668XXXXXXXX' — convert to '08XXXXXXXX'
  if (p.startsWith('66') && p.length === 11) {
    p = '0' + p.slice(2)
  }
  return p || undefined
}
