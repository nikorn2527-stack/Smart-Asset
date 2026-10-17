import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import {
  getDocumentTemplates,
  setActiveDocumentTemplateId,
} from '@/lib/document-template-store'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

interface Params {
  params: Promise<{ id: string }>
}

// POST /api/itam/document-templates/[id]/activate — set template as active
export async function POST(req: NextRequest, { params }: Params) {
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
    await setActiveDocumentTemplateId(id)

    await logAudit(
      'DOC_TEMPLATE_ACTIVATE',
      'DocumentTemplate',
      id,
      `ตั้งเทมเพลตเอกสาร "${target.name}" เป็นเทมเพลตที่ใช้งาน`,
      { templateId: id, name: target.name },
      auth.user.email,
    )

    return NextResponse.json({ ok: true, activeId: id })
  } catch (err) {
    console.error('POST /api/itam/document-templates/[id]/activate', err)
    return NextResponse.json({ error: 'Failed to activate template' }, { status: 500 })
  }
}
