import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import {
  getStickerTemplates,
  saveStickerTemplates,
  getActiveTemplateId,
  setActiveTemplateId,
} from '@/lib/sticker-settings-store'
import {
  normalizeTemplate,
  genTemplateId,
  type StickerTemplate,
} from '@/lib/sticker-template'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// GET /api/itam/sticker/templates
//   Returns: { templates: StickerTemplate[], activeId: string|null }
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('stickers')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const [templates, activeId] = await Promise.all([
    getStickerTemplates(),
    getActiveTemplateId(),
  ])
  return NextResponse.json({ templates, activeId })
}

// POST /api/itam/sticker/templates — create a new template
//   Body: { name?: string, canvas?: {width,height}, overflow?: 'clip'|'visible', elements?: [] }
//   Returns: { template: StickerTemplate }
export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('stickers')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await req.json().catch(() => ({}))
    const templates = await getStickerTemplates()

    const newTemplate: StickerTemplate = normalizeTemplate({
      id: genTemplateId(),
      name: body.name || `เทมเพลต ${templates.length + 1}`,
      isDefault: false,
      canvas: body.canvas,
      overflow: body.overflow,
      elements: body.elements ?? [],
    })

    templates.push(newTemplate)
    await saveStickerTemplates(templates)

    // If first non-default template, auto-activate
    const activeId = await getActiveTemplateId()
    if (!activeId) {
      await setActiveTemplateId(newTemplate.id)
    }

    await logAudit(
      'STICKER_TEMPLATE_CREATE',
      'StickerTemplate',
      newTemplate.id,
      `สร้างเทมเพลตสติกเกอร์ "${newTemplate.name}"`,
      { templateId: newTemplate.id, name: newTemplate.name },
      auth.user.email,
    )

    return NextResponse.json({ template: newTemplate }, { status: 201 })
  } catch (err) {
    console.error('POST /api/itam/sticker/templates', err)
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
}
