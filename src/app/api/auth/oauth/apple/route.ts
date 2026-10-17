import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/auth/oauth/apple
 *
 * Initiates Apple "Sign In with Apple" by redirecting the browser to
 * Apple's authorization endpoint. The admin must first configure
 * `oauth_apple_client_id` (Services ID), `oauth_apple_team_id`,
 * `oauth_apple_key_id`, and `oauth_apple_private_key` in Settings →
 * OAuth/External Login.
 *
 * After consent, Apple redirects the browser to /api/auth/oauth/apple/callback
 * with `?code=...&state=...`.
 *
 * Apple Sign In docs:
 *   https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_rest_api
 */

const SCOPE = encodeURIComponent('name email')

export async function GET(req: NextRequest) {
  try {
    const rows = await db.appSetting.findMany({
      where: {
        key: {
          in: [
            'oauth_apple_client_id',
            'oauth_apple_redirect_url',
          ],
        },
      },
      select: { key: true, value: true },
    })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.key] = r.value

    const clientId = map.oauth_apple_client_id?.trim()
    if (!clientId) {
      return NextResponse.json(
        {
          error:
            'Apple Sign In ยังไม่ได้ตั้งค่า — ผู้ดูแลต้องกรอก Services ID, Team ID, Key ID และ Private Key ที่หน้า Settings → OAuth/External Login',
        },
        { status: 503 },
      )
    }

    const origin = new URL(req.url).origin
    const redirectUri =
      map.oauth_apple_redirect_url?.trim() ||
      `${origin}/api/auth/oauth/apple/callback`

    // Anti-CSRF state — store in a short-lived cookie.
    const state = crypto.randomUUID()
    const stateCookie = `apple_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`

    const authUrl = `https://appleid.apple.com/auth/authorize?response_type=code&client_id=${encodeURIComponent(
      clientId,
    )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${SCOPE}&state=${state}&response_mode=form_post`

    const res = NextResponse.redirect(authUrl)
    res.headers.set('Set-Cookie', stateCookie)
    return res
  } catch (err) {
    console.error('GET /api/auth/oauth/apple', err)
    return NextResponse.json(
      { error: 'เกิดข้อผิดพลาดในการเริ่ม Apple Sign In' },
      { status: 500 },
    )
  }
}
