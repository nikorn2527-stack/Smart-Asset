import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import {
  getStickerTemplates,
  setActiveTemplateId,
} from '@/lib/sticker-settings-store'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

interface Params {
  params: Promise<{ id: string }>
}

// POST /api/itam/sticker/templates/[id]/activate — set template as active
export async function POST(req: NextRequest, { params }: Params) {
  const unavailable = await moduleUnavailableResponse('stickers')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const templates = await getStickerTemplates()
    const target = templates.find((t) => t.id === id)
    if (!target) {
      return NextResponse.json({ error: 'ไม่พบเทมเพลต' }, { status: 404 })
    }
    await setActiveTemplateId(id)

    await logAudit(
      'STICKER_TEMPLATE_ACTIVATE',
      'StickerTemplate',
      id,
      `ตั้งเทมเพลตสติกเกอร์ "${target.name}" เป็นเทมเพลตที่ใช้งาน`,
      { templateId: id, name: target.name },
      auth.user.email,
    )

    return NextResponse.json({ ok: true, activeId: id })
  } catch (err) {
    console.error('POST /api/itam/sticker/templates/[id]/activate', err)
    return NextResponse.json({ error: 'Failed to activate template' }, { status: 500 })
  }
}
