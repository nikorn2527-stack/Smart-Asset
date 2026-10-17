import { NextRequest, NextResponse } from 'next/server'
import {
  sendNotification,
  type NotificationChannel,
  type NotificationTemplate,
} from '@/lib/notifications'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * POST /api/notifications/send
 *
 * Trigger a notification to one or more channels (line-oa, telegram, email).
 * Body shape mirrors NotificationData:
 *   {
 *     template: NotificationTemplate,
 *     channels: NotificationChannel[],
 *     data: Record<string, any>,
 *     lineUserId?: string,
 *     telegramChatId?: string,
 *     email?: string,
 *     actor?: string,
 *     entityId?: string,
 *     entity?: string,
 *   }
 *
 * SECURITY (P0):
 *   This endpoint was previously unauthenticated — anyone could send
 *   notifications (spam, fake audit actor, etc.). Now requires ADMIN
 *   permission. The `actor` field is taken from the auth context, NOT
 *   from the request body, so callers can't impersonate other users.
 *
 * Returns: { ok: true }
 */
const VALID_CHANNELS = new Set<NotificationChannel>([
  'line-oa',
  'telegram',
  'email',
])

const VALID_TEMPLATES = new Set<NotificationTemplate>([
  'wo_created',
  'wo_assigned',
  'wo_completed',
  'wo_cancelled',
  'wo_message',
  'parts_requested',
  'parts_approved',
  'stock_low',
  'stock_out',
  'meter_reminder',
])

export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('notifications')
  if (unavailable) return unavailable


  // ── P0 Security: require ADMIN permission ──
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  // Authenticated actor — overrides any `actor` field in the body to
  // prevent impersonation.
  const authActor = auth.row.email || auth.row.username || 'unknown'

  try {
    const body = await req.json()
    const {
      template,
      channels,
      data,
      lineUserId,
      telegramChatId,
      email,
      // `actor` from body is intentionally ignored — we use authActor above
      entityId,
      entity,
    } = body as Record<string, unknown>

    if (typeof template !== 'string' || !VALID_TEMPLATES.has(template as NotificationTemplate)) {
      return NextResponse.json(
        { error: 'invalid or missing template' },
        { status: 400 },
      )
    }
    if (!Array.isArray(channels) || channels.length === 0) {
      return NextResponse.json(
        { error: 'channels must be a non-empty array' },
        { status: 400 },
      )
    }
    for (const c of channels) {
      if (typeof c !== 'string' || !VALID_CHANNELS.has(c as NotificationChannel)) {
        return NextResponse.json(
          { error: `invalid channel: ${String(c)}` },
          { status: 400 },
        )
      }
    }
    if (!data || typeof data !== 'object') {
      return NextResponse.json(
        { error: 'data must be an object' },
        { status: 400 },
      )
    }

    await sendNotification({
      template: template as NotificationTemplate,
      channels: channels as NotificationChannel[],
      data: data as Record<string, unknown>,
      lineUserId: typeof lineUserId === 'string' ? lineUserId : undefined,
      telegramChatId:
        typeof telegramChatId === 'string' ? telegramChatId : undefined,
      email: typeof email === 'string' ? email : undefined,
      actor: authActor, // override body.actor with authenticated identity
      entityId: typeof entityId === 'string' ? entityId : undefined,
      entity: typeof entity === 'string' ? entity : undefined,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('POST /api/notifications/send', err)
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to send notification') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
