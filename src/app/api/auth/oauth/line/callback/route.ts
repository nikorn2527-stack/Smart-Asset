import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createToken, toAuthUser } from '@/lib/auth'

/**
 * GET /api/auth/oauth/line/callback
 *
 * Handles the LINE Login v2.1 callback:
 *   1. Verify `state` matches the cookie set in the init route (anti-CSRF).
 *   2. Exchange `code` for an access_token + id_token at LINE's token endpoint.
 *   3. Call LINE's /v2/profile to get the user's displayName + userId.
 *   4. Look up the user by email in the User table.
 *      - Existing user → issue ITAM JWT → redirect to /?oauth=success
 *      - Not found     → create a pending user (active=false) → /?oauth=pending
 *
 * Notes:
 *   - Requires the admin to have configured oauth_line_channel_id and
 *     oauth_line_channel_secret.
 */

interface LineTokenResponse {
  access_token?: string
  id_token?: string
  token_type?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface LineProfile {
  userId?: string
  displayName?: string
  pictureUrl?: string
  statusMessage?: string
}

interface LineIdToken {
  email?: string
  name?: string
  picture?: string
  sub?: string
}

function decodeJwtPayload(jwt: string): LineIdToken | null {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(json) as LineIdToken
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

  const cookieState = req.cookies.get('oauth_line_state')?.value
  if (!cookieState || cookieState !== state) {
    return redirectToHome(origin, 'oauth_error=state_mismatch')
  }

  try {
    const rows = await db.appSetting.findMany({
      where: {
        key: {
          in: [
            'oauth_line_channel_id',
            'oauth_line_channel_secret',
            'oauth_line_redirect_url',
          ],
        },
      },
      select: { key: true, value: true },
    })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.key] = r.value

    const channelId = map.oauth_line_channel_id?.trim()
    const channelSecret = map.oauth_line_channel_secret?.trim()
    if (!channelId || !channelSecret) {
      return redirectToHome(origin, 'oauth_error=not_configured')
    }

    const redirectUri =
      map.oauth_line_redirect_url?.trim() ||
      `${origin}/api/auth/oauth/line/callback`

    // Exchange code for tokens.
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: channelId,
        client_secret: channelSecret,
      }),
    })
    const tok = (await tokenRes.json()) as LineTokenResponse
    if (!tok.access_token) {
      console.error('line token exchange failed', tok)
      return redirectToHome(origin, 'oauth_error=token_exchange_failed')
    }

    // Decode the id_token (only present if scope included openid+email).
    const idTok = tok.id_token ? decodeJwtPayload(tok.id_token) : null
    const email = idTok?.email?.toLowerCase().trim()

    // Pull the user profile from LINE.
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    })
    const profile = (await profileRes.json()) as LineProfile
    const lineUserId = profile.userId ?? idTok?.sub ?? null
    const name = profile.displayName ?? idTok?.name ?? null
    const avatar = profile.pictureUrl ?? idTok?.picture ?? null

    if (!email && !lineUserId) {
      return redirectToHome(origin, 'oauth_error=no_identity')
    }

    // Look up the user by email OR by lineUserId (so re-logins work even
    // without email scope).
    let user =
      (email
        ? await db.user.findFirst({ where: { email } })
        : null) ??
      (lineUserId
        ? await db.user.findFirst({ where: { lineUserId: `line:${lineUserId}` } })
        : null)

    if (user) {
      // Existing user — refresh lineUserId if missing + issue JWT.
      if (lineUserId && user.lineUserId !== `line:${lineUserId}`) {
        await db.user.update({
          where: { id: user.id },
          data: {
            lineUserId: `line:${lineUserId}`,
            avatarUrl: avatar ?? user.avatarUrl,
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
      return redirectToHome(
        origin,
        `oauth=success&token=${encodeURIComponent(token)}&user=${encodeURIComponent(JSON.stringify(authUser))}`,
      )
    }

    // No existing user — create a pending account.
    if (!email) {
      // LINE didn't return an email — we can't create a User without one
      // (email is unique + required). Ask the user to log in another way.
      return redirectToHome(origin, 'oauth_error=no_email')
    }
    const newUser = await db.user.create({
      data: {
        email,
        name: name ?? email,
        role: 'viewer',
        active: false,
        lineUserId: lineUserId ? `line:${lineUserId}` : null,
        avatarUrl: avatar ?? null,
      },
    })
    try {
      await db.auditLog.create({
        data: {
          action: 'OAUTH_REGISTER',
          entity: 'User',
          entityId: newUser.id,
          summary: `ลงทะเบียนผ่าน LINE: ${email}`,
          detail: JSON.stringify({ provider: 'line', id: newUser.id, email }),
          actor: email,
        },
      })
    } catch (err) { console.error('[route]', err) }
    return redirectToHome(origin, 'oauth=pending')
  } catch (err) {
    console.error('GET /api/auth/oauth/line/callback', err)
    return redirectToHome(origin, 'oauth_error=exception')
  }
}

function redirectToHome(origin: string, query: string): NextResponse {
  const res = NextResponse.redirect(new URL(`/?${query}`, origin))
  res.cookies.delete('oauth_line_state')
  return res
}
