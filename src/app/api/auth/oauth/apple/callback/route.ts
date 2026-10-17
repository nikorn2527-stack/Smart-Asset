import { NextRequest, NextResponse } from 'next/server'
import { createSign } from 'node:crypto'
import { db } from '@/lib/db'
import { ciEquals } from '@/lib/prisma-filters'
import { createToken, toAuthUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/auth/oauth/apple/callback
 *
 * Apple uses `response_mode=form_post` so the callback comes as POST
 * with form-urlencoded body containing `code`, `state`, and (first-time
 * only) `user` JSON with name/email.
 *
 * Flow:
 *   1. Verify `state` matches the cookie set in the init route (anti-CSRF).
 *   2. Generate Apple client_secret JWT (requires Team ID, Key ID, Private Key).
 *   3. Exchange `code` for an access_token + id_token at Apple's token endpoint.
 *   4. Decode the id_token (JWT) to extract email, sub.
 *   5. Look up the user by email in the User table.
 *      - Existing user → issue ITAM JWT → redirect to /?oauth=success
 *      - Not found     → create a new user with active=false (pending approval)
 *                       → store the Apple sub in lineUserId for future linking
 *                       → redirect to /?oauth=pending
 *
 * Required env/settings:
 *   oauth_apple_client_id      — Services ID (e.g. com.yourapp.signin)
 *   oauth_apple_team_id        — 10-character Team ID from Apple Developer
 *   oauth_apple_key_id         — Key ID from Apple Developer (Keys section)
 *   oauth_apple_private_key    — Private key (PEM format, downloaded from Apple)
 */

interface AppleTokenResponse {
  access_token?: string
  id_token?: string
  refresh_token?: string
  error?: string
  error_description?: string
}

interface AppleIdToken {
  iss?: string
  sub?: string  // Apple's stable user identifier
  aud?: string
  email?: string
  email_verified?: string | boolean
  is_private_email?: string | boolean
  nonce_supported?: boolean
}

function decodeJwtPayload(jwt: string): AppleIdToken | null {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(json) as AppleIdToken
  } catch {
    return null
  }
}

/**
 * Generate Apple client_secret JWT.
 * Apple requires a JWT signed with the private key from Apple Developer.
 *
 * Header: { alg: 'ES256', kid: <Key ID> }
 * Payload: { iss: <Team ID>, iat, exp, aud: 'https://appleid.apple.com', sub: <Services ID> }
 */
function generateAppleClientSecret(
  teamId: string,
  clientId: string,
  keyId: string,
  privateKey: string,
): string {
  // Note: This uses Node.js crypto (Web Crypto API doesn't support ES256 JWT signing directly)
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + 86400, // 24 hours (max 6 months)
    aud: 'https://appleid.apple.com',
    sub: clientId,
  }

  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')

  const headerB64 = b64url(header)
  const payloadB64 = b64url(payload)
  const signingInput = `${headerB64}.${payloadB64}`

  // Use Node.js crypto for ES256 signing
  // Note: Apple private keys are in PEM format
  // (createSign imported at top — QA-ROUND-2026-09-16-C lint fix; the old
  // inline require() tripped @typescript-eslint/no-require-imports.)
  const sign = createSign('RSA-SHA256')
  sign.update(signingInput)
  sign.end()

  // Clean up private key (remove headers if pasted without them)
  let key = privateKey.trim()
  if (!key.includes('-----BEGIN PRIVATE KEY-----')) {
    key = `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`
  }

  const signature = sign.sign(key)
  const signatureB64 = signature
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  return `${signingInput}.${signatureB64}`
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') || ''

  let code: string | null = null
  let state: string | null = null
  let userJson: string | null = null

  // Apple sends form-urlencoded POST
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await req.formData()
    code = formData.get('code') as string
    state = formData.get('state') as string
    userJson = formData.get('user') as string
  } else {
    // Fallback: query params (some flows)
    const url = new URL(req.url)
    code = url.searchParams.get('code')
    state = url.searchParams.get('state')
  }

  const origin = new URL(req.url).origin

  if (!code) {
    return NextResponse.redirect(`${origin}/?oauth=error&reason=no_code`)
  }

  // ── Verify state (anti-CSRF) ──
  const cookieState = req.cookies.get('apple_oauth_state')?.value
  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(`${origin}/?oauth=error&reason=state_mismatch`)
  }

  // ── Load Apple OAuth settings ──
  const rows = await db.appSetting.findMany({
    where: {
      key: {
        in: [
          'oauth_apple_client_id',
          'oauth_apple_team_id',
          'oauth_apple_key_id',
          'oauth_apple_private_key',
          'oauth_apple_redirect_url',
        ],
      },
    },
    select: { key: true, value: true },
  })
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value

  const clientId = map.oauth_apple_client_id?.trim()
  const teamId = map.oauth_apple_team_id?.trim()
  const keyId = map.oauth_apple_key_id?.trim()
  const privateKey = map.oauth_apple_private_key?.trim()

  if (!clientId || !teamId || !keyId || !privateKey) {
    return NextResponse.redirect(`${origin}/?oauth=error&reason=not_configured`)
  }

  const redirectUri =
    map.oauth_apple_redirect_url?.trim() ||
    `${origin}/api/auth/oauth/apple/callback`

  // ── Generate client_secret JWT ──
  let clientSecret: string
  try {
    clientSecret = generateAppleClientSecret(teamId, clientId, keyId, privateKey)
  } catch (err) {
    console.error('Apple client_secret generation failed:', err)
    return NextResponse.redirect(`${origin}/?oauth=error&reason=secret_gen_failed`)
  }

  // ── Exchange code for tokens ──
  let tokenRes: AppleTokenResponse
  try {
    const tokenResponse = await fetch('https://appleid.apple.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })
    tokenRes = (await tokenResponse.json()) as AppleTokenResponse
  } catch (err) {
    console.error('Apple token exchange failed:', err)
    return NextResponse.redirect(`${origin}/?oauth=error&reason=token_exchange_failed`)
  }

  if (tokenRes.error || !tokenRes.id_token) {
    console.error('Apple token error:', tokenRes.error, tokenRes.error_description)
    return NextResponse.redirect(`${origin}/?oauth=error&reason=token_error`)
  }

  // ── Decode id_token ──
  const idToken = decodeJwtPayload(tokenRes.id_token)
  if (!idToken || !idToken.email || !idToken.sub) {
    return NextResponse.redirect(`${origin}/?oauth=error&reason=invalid_id_token`)
  }

  const email = idToken.email.toLowerCase()
  const appleSub = idToken.sub

  // ── Parse user JSON (first-time login only — contains name) ──
  let userName: string | undefined
  if (userJson) {
    try {
      const userData = JSON.parse(userJson)
      const name = userData?.name
      if (name?.firstName || name?.lastName) {
        userName = [name.firstName, name.lastName].filter(Boolean).join(' ')
      }
    } catch {
      // ignore parse errors
    }
  }

  // ── Clear state cookie ──
  const clearCookie = 'apple_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'

  // ── Look up existing user by email ──
  const existing = await db.user.findFirst({
    where: { email: ciEquals(email) },
  })

  if (existing) {
    // Existing user → issue JWT → redirect to home
    await db.user.update({
      where: { id: existing.id },
      data: {
        appleSub: appleSub,
        // User.lastLoginAt is a *String* column, not DateTime — every other
        // call site writes an ISO string, so `new Date()` here would store an
        // unserializable Date and break the "last login" column in /api/users.
        lastLoginAt: new Date().toISOString(),
      },
    })

    // createToken is async — without `await`, `token` is a Promise and
    // encodeURIComponent() would put "[object Promise]" in the redirect URL,
    // silently breaking every Apple Sign-In login.
    const token = await createToken(existing)
    const redirectUrl = `${origin}/?oauth=success&token=${encodeURIComponent(token)}`
    const res = NextResponse.redirect(redirectUrl)
    res.headers.set('Set-Cookie', clearCookie)
    return res
  }

  // ── Create new user (pending approval) ──
  const newUser = await db.user.create({
    data: {
      email,
      name: userName || email.split('@')[0],
      role: 'staff',
      active: false,  // requires admin approval
      appleSub,
      passwordHash: '',
      source: 'apple_oauth',
    },
  })

  await logAudit(
    'CREATE',
    'User',
    newUser.id,
    `ลงทะเบียนผู้ใช้ใหม่ผ่าน Apple Sign In: ${email}`,
  )

  const redirectUrl = `${origin}/?oauth=pending&email=${encodeURIComponent(email)}`
  const res = NextResponse.redirect(redirectUrl)
  res.headers.set('Set-Cookie', clearCookie)
  return res
}
