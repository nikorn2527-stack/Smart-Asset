import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import {
  getDocumentTemplates,
  getActiveDocumentTemplateId,
} from '@/lib/document-template-store'
import {
  renderPDFFromTemplate,
  normalizeTemplate,
  type DocumentRenderData,
  type DocumentTemplate,
} from '@/lib/document-template'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// POST /api/itam/document-templates/render
//   Body: { templateId?: string, data: DocumentRenderData }
//   Returns: { html, totalPages, summary, template }
export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('templates')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'EXPORT_PRINT')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await req.json().catch(() => ({})) as {
      templateId?: string
      data?: DocumentRenderData
    }
    if (!body.data || typeof body.data !== 'object') {
      return NextResponse.json({ error: 'data is required' }, { status: 400 })
    }
    if (!Array.isArray(body.data.rows)) {
      return NextResponse.json({ error: 'data.rows must be an array' }, { status: 400 })
    }

    // Resolve template: explicit id → active → first available
    const [templates, activeId] = await Promise.all([
      getDocumentTemplates(),
      getActiveDocumentTemplateId(),
    ])
    let template: DocumentTemplate | undefined
    if (body.templateId) {
      const found = templates.find((t) => t.id === body.templateId)
      if (found) template = found
    }
    if (!template && activeId) {
      template = templates.find((t) => t.id === activeId)
    }
    if (!template) {
      template = templates[0]
    }
    if (!template) {
      return NextResponse.json({ error: 'ไม่มีเทมเพลตเอกสารในระบบ' }, { status: 500 })
    }

    const data: DocumentRenderData = {
      title: String(body.data.title ?? 'รายงานเอกสาร'),
      rows: body.data.rows,
      month: body.data.month,
      siteName: body.data.siteName,
      contractNo: body.data.contractNo,
      contractDate: body.data.contractDate,
    }

    const { html, totalPages, summary } = renderPDFFromTemplate(template, data)

    await logAudit(
      'DOC_TEMPLATE_RENDER',
      'DocumentTemplate',
      template.id,
      `เรนเดอร์ PDF ด้วยเทมเพลต "${template.name}" (${data.rows.length} แถว · ${totalPages} หน้า)`,
      {
        templateId: template.id,
        templateName: template.name,
        rowCount: data.rows.length,
        totalPages,
        summaryTotalCost: summary.totalCost,
      },
      auth.user.email,
    )

    return NextResponse.json({
      html,
      totalPages,
      summary,
      template: normalizeTemplate(template),
    })
  } catch (err) {
    console.error('POST /api/itam/document-templates/render', err)
    return NextResponse.json({ error: 'Failed to render document' }, { status: 500 })
  }
}
