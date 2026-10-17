import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import {
  getDocumentTemplates,
  saveDocumentTemplates,
  getActiveDocumentTemplateId,
  setActiveDocumentTemplateId,
  getDocumentTemplateEnabled,
  setDocumentTemplateEnabled,
} from '@/lib/document-template-store'
import {
  normalizeTemplate,
  genTemplateId,
  buildDefaultDocumentTemplate,
  type DocumentTemplate,
} from '@/lib/document-template'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// GET /api/itam/document-templates
//   Returns: { templates: DocumentTemplate[], activeId: string|null, enabled: boolean }
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('templates')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const [templates, activeId, enabled] = await Promise.all([
    getDocumentTemplates(),
    getActiveDocumentTemplateId(),
    getDocumentTemplateEnabled(),
  ])
  return NextResponse.json({ templates, activeId, enabled })
}

// POST /api/itam/document-templates — create a new template
//   Body (variant A): { name?, canvas?, elements?, table?, summary?, footer?, enabled? }
//   Body (variant B): { enabled: boolean } — only toggles the enabled flag
//                     (no template is created). Used by the editor's Switch.
//   Returns: { template: DocumentTemplate } (variant A) or { ok: true, enabled } (variant B)
export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('templates')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>

    // ── Variant B: only toggling the enabled flag (no template creation) ──
    // Detected when the body contains ONLY `enabled` and no template-shape fields.
    if (
      typeof body.enabled === 'boolean' &&
      !('name' in body) &&
      !('canvas' in body) &&
      !('elements' in body) &&
      !('table' in body) &&
      !('summary' in body) &&
      !('footer' in body)
    ) {
      await setDocumentTemplateEnabled(body.enabled)
      await logAudit(
        'DOC_TEMPLATE_TOGGLE_ENABLED',
        'DocumentTemplate',
        null,
        body.enabled
          ? 'เปิดใช้งานเทมเพลตเอกสาร PDF'
          : 'ปิดใช้งานเทมเพลตเอกสาร PDF',
        { enabled: body.enabled },
        auth.user.email,
      )
      return NextResponse.json({ ok: true, enabled: body.enabled })
    }

    const templates = await getDocumentTemplates()

    // If body is empty/missing, use the default template as the new template's
    // starting point (so users get a sensible starting layout).
    const baseTemplate = (templates[0] ?? buildDefaultDocumentTemplate())
    const newTemplate: DocumentTemplate = normalizeTemplate({
      id: genTemplateId(),
      name: typeof body.name === 'string' ? body.name : `เทมเพลตเอกสาร ${templates.length + 1}`,
      isDefault: false,
      canvas: body.canvas ?? baseTemplate.canvas,
      elements: body.elements ?? baseTemplate.elements,
      table: body.table ?? baseTemplate.table,
      summary: body.summary ?? baseTemplate.summary,
      footer: body.footer ?? baseTemplate.footer,
    })

    templates.push(newTemplate)
    await saveDocumentTemplates(templates)

    // If first non-default template, auto-activate
    const activeId = await getActiveDocumentTemplateId()
    if (!activeId) {
      await setActiveDocumentTemplateId(newTemplate.id)
    }
    // If enabled flag was provided alongside the new template, persist it
    if (typeof body.enabled === 'boolean') {
      await setDocumentTemplateEnabled(body.enabled)
    }

    await logAudit(
      'DOC_TEMPLATE_CREATE',
      'DocumentTemplate',
      newTemplate.id,
      `สร้างเทมเพลตเอกสาร "${newTemplate.name}"`,
      { templateId: newTemplate.id, name: newTemplate.name },
      auth.user.email,
    )

    return NextResponse.json({ template: newTemplate }, { status: 201 })
  } catch (err) {
    console.error('POST /api/itam/document-templates', err)
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
}
