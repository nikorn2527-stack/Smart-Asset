import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/auth/oauth/google
 *
 * Initiates Google OAuth 2.0 login by redirecting the browser to Google's
 * consent screen. The admin must first configure `oauth_google_client_id`
 * and `oauth_google_client_secret` in Settings → OAuth/External Login.
 *
 * After consent, Google redirects the browser to /api/auth/oauth/google/callback
 * with `?code=...&state=...`.
 */

const SCOPE = encodeURIComponent([
  'openid',
  'email',
  'profile',
].join(' '))

export async function GET(req: NextRequest) {
  try {
    const rows = await db.appSetting.findMany({
      where: {
        key: {
          in: ['oauth_google_client_id', 'oauth_google_redirect_url'],
        },
      },
      select: { key: true, value: true },
    })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.key] = r.value

    const clientId = map.oauth_google_client_id?.trim()
    if (!clientId) {
      return NextResponse.json(
        {
          error:
            'Google OAuth ยังไม่ได้ตั้งค่า — ผู้ดูแลต้องกรอก Client ID และ Client Secret ที่หน้า Settings → OAuth/External Login',
        },
        { status: 503 },
      )
    }

    const origin = new URL(req.url).origin
    const redirectUri =
      map.oauth_google_redirect_url?.trim() ||
      `${origin}/api/auth/oauth/google/callback`

    // Anti-CSRF state — store in a short-lived cookie.
    const state = cryptoRandom()
    const res = NextResponse.redirect(
      new URL(
        `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${encodeURIComponent(
          clientId,
        )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${SCOPE}&state=${state}&prompt=consent`,
      ),
    )
    res.cookies.set('oauth_google_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 5 * 60,
    })
    return res
  } catch (err) {
    console.error('GET /api/auth/oauth/google', err)
    return NextResponse.json(
      { error: 'OAuth init failed' },
      { status: 500 },
    )
  }
}

function cryptoRandom(): string {
  // 16 random bytes hex — falls back to Math.random if WebCrypto is missing.
  try {
    const arr = new Uint8Array(16)
    const c = (globalThis as { crypto?: Crypto }).crypto
    if (c?.getRandomValues) {
      c.getRandomValues(arr)
      return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
    }
  } catch (err) { console.error('[route]', err) }
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}
