import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'

// PATCH /api/numbering/schemes/[id] — แก้ไขรูปแบบ
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const body = await req.json()
    const { name, pattern, prefix, description, resetPolicy } = body
    const existing = await db.numberingScheme.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'ไม่พบรูปแบบ' }, { status: 404 })
    }
    if (pattern && !/\{seq(:\d+)?\}/.test(pattern)) {
      return NextResponse.json(
        { error: 'รูปแบบต้องมีเลขลำดับ {seq} อย่างน้อย 1 จุด' },
        { status: 400 },
      )
    }
    const updated = await db.numberingScheme.update({
      where: { id },
      data: {
        name: name ?? existing.name,
        pattern: pattern ?? existing.pattern,
        prefix: prefix === undefined ? existing.prefix : prefix || null,
        description: description === undefined ? existing.description : description || null,
        resetPolicy: resetPolicy && ['never', 'yearly', 'monthly'].includes(resetPolicy)
          ? resetPolicy
          : existing.resetPolicy,
      },
    })
    return NextResponse.json({ scheme: updated })
  } catch (err) {
    console.error('PATCH /api/numbering/schemes/[id]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// DELETE /api/numbering/schemes/[id] — ลบรูปแบบ (พร้อมเลขลำดับของมัน)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const existing = await db.numberingScheme.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'ไม่พบรูปแบบ' }, { status: 404 })
    }
    // ไม่อนุญาตให้ลบแบบที่กำลังใช้งาน
    if (existing.isActive) {
      return NextResponse.json(
        { error: 'ไม่สามารถลบรูปแบบที่กำลังใช้งาน — เปลี่ยนไปใช้รูปแบบอื่นก่อน' },
        { status: 400 },
      )
    }
    await db.numberSequence.deleteMany({ where: { schemeId: id } })
    await db.numberingScheme.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/numbering/schemes/[id]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
