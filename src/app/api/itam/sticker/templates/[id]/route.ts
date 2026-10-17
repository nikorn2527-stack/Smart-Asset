import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import {
  getStickerTemplates,
  saveStickerTemplates,
  getActiveTemplateId,
} from '@/lib/sticker-settings-store'
import {
  normalizeTemplate,
  type StickerTemplate,
} from '@/lib/sticker-template'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

interface Params {
  params: Promise<{ id: string }>
}

// PUT /api/itam/sticker/templates/[id] — update template (name, canvas, overflow, elements)
//   Default template can be edited but cannot be deleted (handled in DELETE).
export async function PUT(req: NextRequest, { params }: Params) {
  const unavailable = await moduleUnavailableResponse('stickers')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const templates = await getStickerTemplates()
    const idx = templates.findIndex((t) => t.id === id)
    if (idx < 0) {
      return NextResponse.json({ error: 'ไม่พบเทมเพลต' }, { status: 404 })
    }
    const existing = templates[idx]

    const updated: StickerTemplate = normalizeTemplate({
      id: existing.id,
      name: body.name ?? existing.name,
      isDefault: existing.isDefault, // cannot change default flag via PUT
      canvas: body.canvas ?? existing.canvas,
      overflow: body.overflow ?? existing.overflow,
      elements: body.elements ?? existing.elements,
    })

    templates[idx] = updated
    await saveStickerTemplates(templates)

    await logAudit(
      'STICKER_TEMPLATE_UPDATE',
      'StickerTemplate',
      updated.id,
      `แก้ไขเทมเพลตสติกเกอร์ "${updated.name}"`,
      { templateId: updated.id, name: updated.name },
      auth.user.email,
    )

    return NextResponse.json({ template: updated })
  } catch (err) {
    console.error('PUT /api/itam/sticker/templates/[id]', err)
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
  }
}

// DELETE /api/itam/sticker/templates/[id]
//   Cannot delete default template or currently-active template.
export async function DELETE(req: NextRequest, { params }: Params) {
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
    if (target.isDefault) {
      return NextResponse.json(
        { error: 'ไม่สามารถลบเทมเพลตเริ่มต้นได้' },
        { status: 400 },
      )
    }
    const activeId = await getActiveTemplateId()
    if (activeId === id) {
      return NextResponse.json(
        { error: 'ไม่สามารถลบเทมเพลตที่กำลังใช้งานอยู่ได้ — กรุณาเปลี่ยนเทมเพลตที่ใช้ก่อน' },
        { status: 400 },
      )
    }
    const remaining = templates.filter((t) => t.id !== id)
    await saveStickerTemplates(remaining)

    await logAudit(
      'STICKER_TEMPLATE_DELETE',
      'StickerTemplate',
      id,
      `ลบเทมเพลตสติกเกอร์ "${target.name}"`,
      { templateId: id, name: target.name },
      auth.user.email,
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/itam/sticker/templates/[id]', err)
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 })
  }
}
