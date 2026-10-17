/**
 * GET /api/templates — list templates (optionally filtered by type)
 * POST /api/templates — create a new template
 *
 * Milestone 2 (Templates): refactored to thin adapter — no @/lib/db imports.
 * All DB access goes through templatesService → templatesRepository.
 */
import { NextRequest, NextResponse } from 'next/server'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { requireAuth } from '@/lib/auth-middleware'
import { isTemplateType } from '@/lib/templates'
import { templatesService } from '@/modules/templates'

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('templates')
  if (unavailable) return unavailable

  const auth = await requireAuth(req, 'TEMPLATES_MANAGE')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(req.url)
    const typeParam = searchParams.get('type')?.trim() ?? ''

    if (typeParam && !isTemplateType(typeParam)) {
      return NextResponse.json(
        { error: `ประเภทเทมเพลตไม่ถูกต้อง: ${typeParam}` },
        { status: 400 },
      )
    }

    const templates = await templatesService.list(typeParam || undefined)
    return NextResponse.json({ templates })
  } catch (err) {
    console.error('GET /api/templates', err)
    return NextResponse.json(
      { error: 'Failed to fetch templates' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('templates')
  if (unavailable) return unavailable

  const auth = await requireAuth(req, 'TEMPLATES_MANAGE')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await req.json()

    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json(
        { error: 'กรุณาระบุชื่อเทมเพลต (name)' },
        { status: 400 },
      )
    }
    if (!isTemplateType(body.type)) {
      return NextResponse.json(
        { error: 'ประเภทเทมเพลตไม่ถูกต้อง (type)' },
        { status: 400 },
      )
    }
    if (body.content === undefined || body.content === null) {
      return NextResponse.json(
        { error: 'กรุณาระบุเนื้อหาเทมเพลต (content)' },
        { status: 400 },
      )
    }

    const content =
      typeof body.content === 'string'
        ? body.content
        : JSON.stringify(body.content)

    const created = await templatesService.create({
      name: String(body.name).trim(),
      type: body.type,
      category: body.category?.trim() || null,
      content,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
      isDefault: body.isDefault === true,
    })

    return NextResponse.json({ template: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/templates', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to create template') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
