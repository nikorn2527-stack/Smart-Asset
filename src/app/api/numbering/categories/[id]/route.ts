import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'

// PATCH /api/numbering/categories/[id] — แก้ไขหมวดหมู่
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const body = await req.json()
    const { code, label, parentCode, matchKey, active, sortOrder } = body
    const existing = await db.categoryCode.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'ไม่พบหมวดหมู่' }, { status: 404 })
    }
    // ถ้าเปลี่ยน code — ต้องไม่ชนกับที่มีอยู่ และอัปเดตลูกๆ ให้ด้วย
    const newCode = code ?? existing.code
    if (newCode !== existing.code) {
      const dup = await db.categoryCode.findUnique({
        where: { docType_code: { docType: existing.docType, code: newCode } },
      })
      if (dup && dup.id !== id) {
        return NextResponse.json(
          { error: `รหัส ${newCode} ถูกใช้แล้ว` },
          { status: 400 },
        )
      }
      await db.categoryCode.updateMany({
        where: { docType: existing.docType, parentCode: existing.code },
        data: { parentCode: newCode },
      })
    }
    const updated = await db.categoryCode.update({
      where: { id },
      data: {
        code: newCode,
        label: label ?? existing.label,
        parentCode: parentCode === undefined ? existing.parentCode : parentCode || null,
        matchKey: matchKey === undefined ? existing.matchKey : matchKey || null,
        active: active === undefined ? existing.active : !!active,
        sortOrder: sortOrder === undefined ? existing.sortOrder : Number(sortOrder) || 0,
      },
    })
    return NextResponse.json({ category: updated })
  } catch (err) {
    console.error('PATCH /api/numbering/categories/[id]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// DELETE /api/numbering/categories/[id] — ลบหมวดหมู่ (ลูกๆ จะถูกยกเป็นหมวดใหญ่)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const existing = await db.categoryCode.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'ไม่พบหมวดหมู่' }, { status: 404 })
    }
    // ลูกที่อ้างอยู่ → ยกเป็นหมวดใหญ่ (parentCode = null)
    await db.categoryCode.updateMany({
      where: { docType: existing.docType, parentCode: existing.code },
      data: { parentCode: null },
    })
    await db.categoryCode.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/numbering/categories/[id]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
