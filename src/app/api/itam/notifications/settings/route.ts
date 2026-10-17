import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import {
  getNotifyChannels,
  getNotifyEvents,
  saveNotifyChannels,
  saveNotifyEvents,
  sendNotification,
  type NotifyChannelConfig,
  type NotifyEventConfig,
} from '@/lib/notifications'
import { db } from '@/lib/db'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * GET /api/itam/notifications/settings
 *   Returns the current channel + event config + the raw credential keys.
 *
 * PUT /api/itam/notifications/settings
 *   Body: {
 *     channels?: NotifyChannelConfig,
 *     events?: NotifyEventConfig,
 *     notifyEmails?: string,
 *     telegramBotToken?: string,
 *     telegramChatId?: string,
 *     lineNotifyToken?: string,
 *     lineOaChannelAccessToken?: string,
 *     lineOaToUserId?: string,
 *   }
 *
 * Permission: SYSTEM_CONFIG
 */

const CRED_KEYS = [
  'notifyEmails',
  'telegramBotToken',
  'telegramChatId',
  'lineNotifyToken',
  'lineOaChannelAccessToken',
  'lineOaToUserId',
] as const

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('notifications')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req, 'SYSTEM_CONFIG')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const [channels, events] = await Promise.all([getNotifyChannels(), getNotifyEvents()])
    const creds: Record<string, string> = {}
    for (const k of CRED_KEYS) {
      const row = await db.appSetting.findUnique({ where: { key: k } })
      // Mask tokens — show only last 4 chars
      const raw = row?.value ?? ''
      if (!raw) creds[k] = ''
      else if (k === 'notifyEmails') creds[k] = raw
      else if (raw.length <= 8) creds[k] = '••••'
      else creds[k] = `••••${raw.slice(-4)}`
    }
    return NextResponse.json({ channels, events, credentials: creds })
  } catch (err) {
    console.error('GET /api/itam/notifications/settings', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('notifications')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req, 'SYSTEM_CONFIG')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await req.json()
    if (body.channels) await saveNotifyChannels(body.channels as NotifyChannelConfig)
    if (body.events) await saveNotifyEvents(body.events as NotifyEventConfig)

    // Upsert credentials (only when the body provides a non-empty value that
    // isn't the masked placeholder)
    for (const k of CRED_KEYS) {
      const v = body[k]
      if (typeof v !== 'string') continue
      if (!v.trim()) continue
      if (v.startsWith('••••')) continue // masked → don't overwrite
      await db.appSetting.upsert({
        where: { key: k },
        create: { key: k, value: v },
        update: { value: v },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('PUT /api/itam/notifications/settings', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
