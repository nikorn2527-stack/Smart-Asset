import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import {
  getDocumentTemplates,
  saveDocumentTemplates,
  getActiveDocumentTemplateId,
} from '@/lib/document-template-store'
import {
  normalizeTemplate,
  type DocumentTemplate,
} from '@/lib/document-template'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

interface Params {
  params: Promise<{ id: string }>
}

// PUT /api/itam/document-templates/[id] — update template
//   Default template can be edited but cannot be deleted (handled in DELETE).
export async function PUT(req: NextRequest, { params }: Params) {
  const unavailable = await moduleUnavailableResponse('templates')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const templates = await getDocumentTemplates()
    const idx = templates.findIndex((t) => t.id === id)
    if (idx < 0) {
      return NextResponse.json({ error: 'ไม่พบเทมเพลต' }, { status: 404 })
    }
    const existing = templates[idx]

    const updated: DocumentTemplate = normalizeTemplate({
      id: existing.id,
      name: typeof body.name === 'string' ? body.name : existing.name,
      isDefault: existing.isDefault,
      canvas: body.canvas ?? existing.canvas,
      elements: body.elements ?? existing.elements,
      table: body.table ?? existing.table,
      summary: body.summary ?? existing.summary,
      footer: body.footer ?? existing.footer,
    })

    templates[idx] = updated
    await saveDocumentTemplates(templates)

    await logAudit(
      'DOC_TEMPLATE_UPDATE',
      'DocumentTemplate',
      updated.id,
      `แก้ไขเทมเพลตเอกสาร "${updated.name}"`,
      { templateId: updated.id, name: updated.name },
      auth.user.email,
    )

    return NextResponse.json({ template: updated })
  } catch (err) {
    console.error('PUT /api/itam/document-templates/[id]', err)
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
  }
}

// DELETE /api/itam/document-templates/[id]
//   Cannot delete default template or currently-active template.
export async function DELETE(req: NextRequest, { params }: Params) {
  const unavailable = await moduleUnavailableResponse('templates')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const templates = await getDocumentTemplates()
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
    const activeId = await getActiveDocumentTemplateId()
    if (activeId === id) {
      return NextResponse.json(
        { error: 'ไม่สามารถลบเทมเพลตที่กำลังใช้งานอยู่ได้ — กรุณาเปลี่ยนเทมเพลตที่ใช้ก่อน' },
        { status: 400 },
      )
    }
    const remaining = templates.filter((t) => t.id !== id)
    await saveDocumentTemplates(remaining)

    await logAudit(
      'DOC_TEMPLATE_DELETE',
      'DocumentTemplate',
      id,
      `ลบเทมเพลตเอกสาร "${target.name}"`,
      { templateId: id, name: target.name },
      auth.user.email,
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/itam/document-templates/[id]', err)
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 })
  }
}
