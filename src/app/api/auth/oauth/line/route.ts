import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/auth/oauth/line
 *
 * Initiates LINE Login (v2.1) by redirecting the browser to LINE's consent
 * screen. Requires the admin to configure `oauth_line_channel_id` and
 * `oauth_line_channel_secret` in Settings → OAuth/External Login.
 *
 * After consent, LINE redirects to /api/auth/oauth/line/callback?code=...&state=...
 */

const SCOPE = encodeURIComponent('profile openid email')

export async function GET(req: NextRequest) {
  try {
    const rows = await db.appSetting.findMany({
      where: {
        key: { in: ['oauth_line_channel_id', 'oauth_line_redirect_url'] },
      },
      select: { key: true, value: true },
    })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.key] = r.value

    const channelId = map.oauth_line_channel_id?.trim()
    if (!channelId) {
      return NextResponse.json(
        {
          error:
            'LINE OAuth ยังไม่ได้ตั้งค่า — ผู้ดูแลต้องกรอก Channel ID และ Channel Secret ที่หน้า Settings → OAuth/External Login',
        },
        { status: 503 },
      )
    }

    const origin = new URL(req.url).origin
    const redirectUri =
      map.oauth_line_redirect_url?.trim() ||
      `${origin}/api/auth/oauth/line/callback`

    const state = cryptoRandom()
    const url = new URL('https://access.line.me/oauth2/v2.1/authorize')
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', channelId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('scope', SCOPE)
    url.searchParams.set('state', state)
    url.searchParams.set('bot_prompt', 'normal')

    const res = NextResponse.redirect(url)
    res.cookies.set('oauth_line_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 5 * 60,
    })
    return res
  } catch (err) {
    console.error('GET /api/auth/oauth/line', err)
    return NextResponse.json({ error: 'OAuth init failed' }, { status: 500 })
  }
}

function cryptoRandom(): string {
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
