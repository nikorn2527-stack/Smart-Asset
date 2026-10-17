/**
 * GET /api/templates/[id] — get single template
 * PUT /api/templates/[id] — update template
 * DELETE /api/templates/[id] — delete template (blocks default deletion)
 *
 * Milestone 2 (Templates): refactored to thin adapter — no @/lib/db imports.
 */
import { NextRequest, NextResponse } from 'next/server'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { requireAuth } from '@/lib/auth-middleware'
import { isTemplateType } from '@/lib/templates'
import { templatesService } from '@/modules/templates'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('templates')
  if (unavailable) return unavailable

  const auth = await requireAuth(req, 'TEMPLATES_MANAGE')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params
    const template = await templatesService.getDetail(id)
    if (!template) {
      return NextResponse.json({ error: 'ไม่พบเทมเพลต' }, { status: 404 })
    }
    return NextResponse.json({ template })
  } catch (err) {
    console.error('GET /api/templates/[id]', err)
    return NextResponse.json(
      { error: 'Failed to fetch template' },
      { status: 500 },
    )
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('templates')
  if (unavailable) return unavailable

  const auth = await requireAuth(req, 'TEMPLATES_MANAGE')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params
    const body = await req.json()

    if (body.type !== undefined && !isTemplateType(body.type)) {
      return NextResponse.json(
        { error: 'ประเภทเทมเพลตไม่ถูกต้อง (type)' },
        { status: 400 },
      )
    }
    if (body.name !== undefined && !String(body.name).trim()) {
      return NextResponse.json(
        { error: 'ชื่อเทมเพลตต้องไม่ว่าง' },
        { status: 400 },
      )
    }

    const contentUpdate =
      body.content !== undefined
        ? typeof body.content === 'string'
          ? body.content
          : JSON.stringify(body.content)
        : undefined

    const updated = await templatesService.update(id, {
      name: body.name !== undefined ? String(body.name).trim() : undefined,
      type: body.type,
      category: body.category !== undefined ? (body.category?.trim() || null) : undefined,
      content: contentUpdate,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
      isDefault: body.isDefault !== undefined ? Boolean(body.isDefault) : undefined,
    })

    return NextResponse.json({ template: updated })
  } catch (err) {
    console.error('PUT /api/templates/[id]', err)
    if (err instanceof Error && err.message === 'ไม่พบเทมเพลต') {
      return NextResponse.json({ error: 'ไม่พบเทมเพลต' }, { status: 404 })
    }
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to update template') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('templates')
  if (unavailable) return unavailable

  const auth = await requireAuth(req, 'TEMPLATES_MANAGE')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params
    const result = await templatesService.remove(id)

    if (!result.template && !result.blocked) {
      return NextResponse.json({ error: 'ไม่พบเทมเพลต' }, { status: 404 })
    }
    if (result.blocked) {
      return NextResponse.json(
        {
          error:
            'ไม่สามารถลบเทมเพลตเริ่มต้นได้ — กรุณายกเลิกการตั้งเป็นค่าเริ่มต้นก่อน หรือตั้งเทมเพลตอื่นเป็นค่าเริ่มต้นแทน',
        },
        { status: 400 },
      )
    }

    return NextResponse.json({ success: true, id })
  } catch (err) {
    console.error('DELETE /api/templates/[id]', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to delete template') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
