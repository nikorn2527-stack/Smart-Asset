import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'

// ============================================================
// Notification Template Management API
//   GET    /api/settings/notification-templates   — list templates
//   PUT    /api/settings/notification-templates   — save entire array
//
// Stored as a JSON array in `AppSetting.key = 'notification_templates'`:
//   [{
//      id: string,
//      app: 'itam' | 'services' | 'stock' | 'all',
//      event: string,
//      channels: ('line-oa' | 'telegram' | 'email')[],
//      title: string,
//      body: string,
//      enabled: boolean,
//   }]
// ============================================================

export type NotifyTemplateApp = 'itam' | 'services' | 'stock' | 'all'
export type NotifyTemplateChannel = 'line-oa' | 'telegram' | 'email'

export interface NotificationTemplateEntry {
  id: string
  app: NotifyTemplateApp
  event: string
  channels: NotifyTemplateChannel[]
  title: string
  body: string
  enabled: boolean
}

const SETTING_KEY = 'notification_templates'

const VALID_APPS = new Set<NotifyTemplateApp>(['itam', 'services', 'stock', 'all'])
const VALID_CHANNELS = new Set<NotifyTemplateChannel>(['line-oa', 'telegram', 'email'])

function makeId(): string {
  return 'tpl_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3)
}

function parseTemplates(value: string | null | undefined): NotificationTemplateEntry[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    const out: NotificationTemplateEntry[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const app = String(item.app ?? '').toLowerCase().trim() as NotifyTemplateApp
      const event = String(item.event ?? '').trim()
      const channelsRaw = Array.isArray(item.channels) ? item.channels : []
      const channels = channelsRaw
        .map((c: unknown) => String(c).toLowerCase().trim())
        .filter((c: string) => VALID_CHANNELS.has(c as NotifyTemplateChannel)) as NotifyTemplateChannel[]
      out.push({
        id: typeof item.id === 'string' && item.id ? item.id : makeId(),
        app: VALID_APPS.has(app) ? app : 'all',
        event,
        channels,
        title: String(item.title ?? ''),
        body: String(item.body ?? ''),
        enabled: item.enabled !== false,
      })
    }
    return out
  } catch {
    return []
  }
}

// ── GET — return current templates array ──────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const row = await db.appSetting.findUnique({ where: { key: SETTING_KEY } })
    const templates = parseTemplates(row?.value)
    return NextResponse.json({ data: templates })
  } catch (err) {
    console.error('GET /api/settings/notification-templates', err)
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 })
  }
}

// ── PUT — replace the entire templates array ──────────────────
export async function PUT(req: NextRequest) {
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = (await req.json()) as { templates?: unknown }
    if (!body || !Array.isArray(body.templates)) {
      return NextResponse.json({ error: 'Body must be { templates: [...] }' }, { status: 400 })
    }

    const cleaned: NotificationTemplateEntry[] = []
    for (const item of body.templates) {
      if (!item || typeof item !== 'object') continue
      const raw = item as Record<string, unknown>
      const app = String(raw.app ?? '').toLowerCase().trim() as NotifyTemplateApp
      const event = String(raw.event ?? '').trim()
      const channelsRaw = Array.isArray(raw.channels) ? raw.channels : []
      const channels = channelsRaw
        .map((c: unknown) => String(c).toLowerCase().trim())
        .filter((c: string) => VALID_CHANNELS.has(c as NotifyTemplateChannel)) as NotifyTemplateChannel[]
      const title = String(raw.title ?? '').trim()
      const bodyText = String(raw.body ?? '').trim()
      if (!event || !title) continue // skip incomplete entries
      cleaned.push({
        id: typeof raw.id === 'string' && raw.id ? String(raw.id) : makeId(),
        app: VALID_APPS.has(app) ? app : 'all',
        event,
        channels,
        title,
        body: bodyText,
        enabled: raw.enabled !== false,
      })
    }

    await db.appSetting.upsert({
      where: { key: SETTING_KEY },
      update: { value: JSON.stringify(cleaned) },
      create: { key: SETTING_KEY, value: JSON.stringify(cleaned) },
    })

    try {
      await db.auditLog.create({
        data: {
          action: 'NOTIFY_TEMPLATES_UPDATE',
          entity: 'AppSetting',
          entityId: SETTING_KEY,
          summary: `อัปเดตเทมเพลตข้อความแจ้งเตือน (${cleaned.length} รายการ)`,
          detail: JSON.stringify({ count: cleaned.length, actor: auth.user.email }),
          actor: auth.user.email,
        },
      })
    } catch (err) { console.error('[route]', err) }

    return NextResponse.json({ data: cleaned })
  } catch (err) {
    console.error('PUT /api/settings/notification-templates', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to save templates') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
