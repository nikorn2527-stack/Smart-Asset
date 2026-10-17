import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/auth/oauth/telegram
 *
 * Returns the Telegram bot username so the login page can render the
 * Telegram Login Widget. The actual authentication happens client-side via
 * the widget — the signed data is then POSTed to /api/auth/oauth/telegram
 * for verification (TODO: future enhancement).
 *
 * For now this is a status-only endpoint that the login page uses to decide
 * whether to show the Telegram button.
 */
export async function GET(_req: NextRequest) {
  try {
    const row = await db.appSetting.findUnique({
      where: { key: 'oauth_telegram_bot_token' },
    })
    const token = row?.value?.trim()
    if (!token) {
      return NextResponse.json({ configured: false })
    }
    // Best-effort: fetch the bot's username from Telegram so the login page
    // can render the official widget. Don't fail if Telegram is unreachable.
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/getMe`,
        { cache: 'no-store' },
      )
      const j = (await res.json()) as {
        ok?: boolean
        result?: { username?: string; first_name?: string; id?: number }
      }
      if (j.ok && j.result?.username) {
        return NextResponse.json({
          configured: true,
          botUsername: j.result.username,
          botName: j.result.first_name ?? null,
        })
      }
    } catch (err) { console.error('[route]', err) }
    return NextResponse.json({ configured: true })
  } catch (err) {
    console.error('GET /api/auth/oauth/telegram', err)
    return NextResponse.json({ configured: false }, { status: 200 })
  }
}
