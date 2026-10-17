// ============================================================
// GET /api/auth/line/callback
// (Task ID: PUBLIC-QR-2B-LINE-LOGIN)
// ============================================================
// Handles the LINE Login v2.1 callback for PUBLIC QR repair reporters.
//
// Flow:
//   GET /api/auth/line/callback?code=xxx&state=xxx
//   1. Verify `state` matches the value in the `line_login_state` cookie
//      (anti-CSRF). Reject on mismatch.
//   2. Exchange `code` for access_token + id_token (POST /oauth2/v2.1/token).
//   3. Fetch user profile from /v2/profile.
//   4. (Optional) Decode id_token to extract `phone_number` if the phone
//      scope was granted — marks the reporter as Tier 1 (phone-verified).
//   5. Save `line_session` HTTP-only cookie with { userId, displayName,
//      pictureUrl, scopePhone, expiresAt: now+24h }.
//   6. Read `redirect` from the state cookie, clear the state cookie, and
//      302 redirect the browser back to the original URL (e.g. /qr/d/...).
//
// Error handling:
//   • LINE returns `error` + `error_description` if the user denies consent
//     or there's a config error — we redirect to /login/line?oauth_error=...
//     so the public UI can show a friendly message.
//   • Any uncaught exception redirects to /login/line?oauth_error=exception.
//
// NOTE: This is a SEPARATE channel/cookie from staff auth (/api/auth/oauth/line).
// This public flow stores identity in a 24h `line_session` cookie that the
// public repair endpoints (POST /api/public/repairs) read to determine the
// reporter's tier (Tier 1 = LINE+phone, Tier 2 = LINE only, Tier 3 = anonymous).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import {
  LINE_LOGIN_CONFIG,
  decodeIdToken,
  exchangeLineCodeForToken,
  getLineProfile,
  isLineLoginConfigured,
  normalizeLinePhone,
} from '@/lib/line-login'
import {
  LINE_SESSION_TTL_SECONDS,
  clearLineStateCookie,
  getLineStateCookie,
  setLineSessionCookie,
  type LineSession,
} from '@/lib/line-session'

export const dynamic = 'force-dynamic'

/** Build a redirect URL to the public login page with an error query param. */
function redirectToLoginError(origin: string, code: string): NextResponse {
  const res = NextResponse.redirect(
    new URL(`/login/line?oauth_error=${encodeURIComponent(code)}`, origin),
  )
  clearLineStateCookie(res)
  return res
}

/** Build a redirect URL back to where the user started (the QR landing page). */
function redirectToOriginal(origin: string, redirect: string): NextResponse {
  // `redirect` was already sanitised in /api/auth/line/login to start with
  // '/' and not be protocol-relative — but double-check here in defence.
  const safe = redirect.startsWith('/') && !redirect.startsWith('//')
    ? redirect
    : '/'
  const res = NextResponse.redirect(new URL(safe, origin))
  clearLineStateCookie(res)
  return res
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const origin = new URL(req.url).origin

  // ── 1. Handle LINE-side errors (user denied consent, etc.) ────────
  const error = searchParams.get('error')
  if (error) {
    return redirectToLoginError(origin, error)
  }

  const code = searchParams.get('code')
  const state = searchParams.get('state')
  if (!code || !state) {
    return redirectToLoginError(origin, 'missing_params')
  }

  // ── 2. Verify state matches the cookie (anti-CSRF) ─────────────────
  const stateCookie = getLineStateCookie(req)
  if (!stateCookie || stateCookie.state !== state) {
    return redirectToLoginError(origin, 'state_mismatch')
  }

  // ── 3. Config check (env vars may have been removed between the
  //        init call and the callback — fail gracefully) ─────────────
  if (!isLineLoginConfigured()) {
    return redirectToLoginError(origin, 'not_configured')
  }

  // ── 4. Determine redirect_uri (must match the one used in authorize) ─
  const redirectUri =
    LINE_LOGIN_CONFIG.redirectUri || `${origin}/api/auth/line/callback`

  try {
    // ── 5. Exchange code for tokens ──────────────────────────────────
    const token = await exchangeLineCodeForToken(code, redirectUri)
    if (!token.access_token || token.error) {
      console.error(
        '[line/callback] token exchange failed:',
        token.error,
        token.error_description,
      )
      return redirectToLoginError(
        origin,
        token.error ? `token_${token.error}` : 'token_exchange_failed',
      )
    }

    // ── 6. Fetch user profile ────────────────────────────────────────
    const profile = await getLineProfile(token.access_token)

    // ── 7. Decode id_token to extract phone_number (Tier 1) ──────────
    //    NOTE: We decode without signature verification here because the
    //    token was obtained directly from LINE over HTTPS. For higher
    //    assurance, call `verifyIdToken(token.id_token)` which uses jose
    //    + LINE's JWKS — but that adds a JWKS fetch on every callback.
    let scopePhone: string | null = null
    if (token.id_token) {
      const idTok = decodeIdToken(token.id_token)
      if (idTok?.phone_number) {
        scopePhone = normalizeLinePhone(idTok.phone_number) ?? null
      }
    }

    // ── 8. Build + set the line_session cookie (24h expiry) ──────────
    const session: LineSession = {
      userId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl,
      scopePhone,
      expiresAt: new Date(
        Date.now() + LINE_SESSION_TTL_SECONDS * 1000,
      ).toISOString(),
    }
    const redirect = stateCookie.redirect
    const res = redirectToOriginal(origin, redirect)
    await setLineSessionCookie(res, session)
    return res
  } catch (err) {
    console.error('GET /api/auth/line/callback', err)
    return redirectToLoginError(origin, 'exception')
  }
}
