import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createToken, toAuthUser } from '@/lib/auth'

/**
 * GET /api/auth/oauth/google/callback
 *
 * Handles the Google OAuth 2.0 callback:
 *   1. Verify `state` matches the cookie set in the init route (anti-CSRF).
 *   2. Exchange `code` for an access_token + id_token at Google's token endpoint.
 *   3. Decode the id_token (JWT) to extract email, name, sub.
 *   4. Look up the user by email in the User table.
 *      - Existing user → issue ITAM JWT → redirect to /?oauth=success
 *      - Not found     → create a new user with active=false (pending approval)
 *                       → store the Google sub in lineUserId for future linking
 *                       → redirect to /?oauth=pending
 *
 * Notes:
 *   - Requires the admin to have configured oauth_google_client_id and
 *     oauth_google_client_secret. Without them, returns a friendly error.
 *   - The redirect URI sent to Google MUST match the one used in /google/route.ts.
 */

interface GoogleTokenResponse {
  access_token?: string
  id_token?: string
  error?: string
  error_description?: string
}

interface GoogleIdToken {
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
  sub?: string
}

function decodeJwtPayload(jwt: string): GoogleIdToken | null {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    // base64url → base64 → JSON
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(json) as GoogleIdToken
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const origin = new URL(req.url).origin

  if (error) {
    return redirectToHome(origin, `oauth_error=${encodeURIComponent(error)}`)
  }
  if (!code || !state) {
    return redirectToHome(origin, 'oauth_error=missing_params')
  }

  // Anti-CSRF: state must match the cookie set by the init route.
  const cookieState = req.cookies.get('oauth_google_state')?.value
  if (!cookieState || cookieState !== state) {
    return redirectToHome(origin, 'oauth_error=state_mismatch')
  }

  try {
    const rows = await db.appSetting.findMany({
      where: {
        key: {
          in: [
            'oauth_google_client_id',
            'oauth_google_client_secret',
            'oauth_google_redirect_url',
          ],
        },
      },
      select: { key: true, value: true },
    })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.key] = r.value

    const clientId = map.oauth_google_client_id?.trim()
    const clientSecret = map.oauth_google_client_secret?.trim()
    if (!clientId || !clientSecret) {
      return redirectToHome(origin, 'oauth_error=not_configured')
    }

    const redirectUri =
      map.oauth_google_redirect_url?.trim() ||
      `${origin}/api/auth/oauth/google/callback`

    // Exchange code for tokens.
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    const tok = (await tokenRes.json()) as GoogleTokenResponse
    if (!tok.id_token) {
      console.error('google token exchange failed', tok)
      return redirectToHome(origin, 'oauth_error=token_exchange_failed')
    }

    const idTok = decodeJwtPayload(tok.id_token)
    if (!idTok?.email) {
      return redirectToHome(origin, 'oauth_error=no_email')
    }

    const email = idTok.email.toLowerCase()
    const name = idTok.name ?? null
    const googleSub = idTok.sub ?? null

    // Look up the user by email.
    let user = await db.user.findFirst({ where: { email } })
    if (user) {
      // Existing user — issue JWT, optionally link Google sub for future logins.
      if (googleSub && user.lineUserId !== `google:${googleSub}`) {
        await db.user.update({
          where: { id: user.id },
          data: {
            lineUserId: `google:${googleSub}`,
            avatarUrl: idTok.picture ?? user.avatarUrl,
            lastLoginAt: new Date().toISOString(),
          },
        })
      } else {
        await db.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date().toISOString() },
        })
      }

      if (!user.active) {
        return redirectToHome(origin, 'oauth=pending')
      }

      const token = await createToken({
        email: user.email,
        role: user.role,
        name: user.name,
        username: user.username,
        allowedSites: user.allowedSites,
      })
      const authUser = toAuthUser(user)
      // Pass token + user as a short-lived cookie so the SPA can hydrate.
      return redirectToHome(
        origin,
        `oauth=success&token=${encodeURIComponent(token)}&user=${encodeURIComponent(JSON.stringify(authUser))}`,
      )
    }

    // No existing user — create a pending account (active=false) so the admin
    // can approve them later.
    const newUser = await db.user.create({
      data: {
        email,
        name: name ?? email,
        role: 'viewer',
        active: false,
        lineUserId: googleSub ? `google:${googleSub}` : null,
        avatarUrl: idTok.picture ?? null,
      },
    })
    try {
      await db.auditLog.create({
        data: {
          action: 'OAUTH_REGISTER',
          entity: 'User',
          entityId: newUser.id,
          summary: `ลงทะเบียนผ่าน Google: ${email}`,
          detail: JSON.stringify({ provider: 'google', id: newUser.id, email }),
          actor: email,
        },
      })
    } catch (err) { console.error('[route]', err) }
    return redirectToHome(origin, 'oauth=pending')
  } catch (err) {
    console.error('GET /api/auth/oauth/google/callback', err)
    return redirectToHome(origin, 'oauth_error=exception')
  }
}

function redirectToHome(origin: string, query: string): NextResponse {
  const res = NextResponse.redirect(new URL(`/?${query}`, origin))
  res.cookies.delete('oauth_google_state')
  return res
}
