import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { logAudit } from '@/lib/audit'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const body = await req.json()
    const before = await db.assetCategory.findUnique({ where: { id } })
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const updated = await db.assetCategory.update({
      where: { id },
      data: {
        name: body.name !== undefined ? String(body.name) : undefined,
        usefulLifeYears: body.usefulLifeYears !== undefined ? Number(body.usefulLifeYears) : undefined,
        depreciationMethod: body.depreciationMethod !== undefined ? String(body.depreciationMethod) : undefined,
        decliningRate: body.decliningRate !== undefined ? (body.decliningRate ? Number(body.decliningRate) : null) : undefined,
        minCapitalizeValue: body.minCapitalizeValue !== undefined ? (body.minCapitalizeValue ? Number(body.minCapitalizeValue) : null) : undefined,
        salvageValuePct: body.salvageValuePct !== undefined ? Number(body.salvageValuePct) : undefined,
        active: body.active !== undefined ? Boolean(body.active) : undefined,
      },
    })

    await logAudit('UPDATE', 'AssetCategory', id, `แก้ไขหมวดหมู่ ${updated.code} (${updated.name})`, { from: before, to: updated })
    return NextResponse.json({ category: updated })
  } catch (err) {
    console.error('PUT /api/settings/asset-categories/[id]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const cat = await db.assetCategory.findUnique({ where: { id } })
    if (!cat) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Don't delete — deactivate (keep history)
    await db.assetCategory.update({ where: { id }, data: { active: false } })
    await logAudit('DELETE', 'AssetCategory', id, `ปิดใช้งานหมวดหมู่ ${cat.code} (${cat.name})`, {})
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/settings/asset-categories/[id]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
