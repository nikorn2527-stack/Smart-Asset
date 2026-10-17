import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req, 'MASTER_DATA_EDIT')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row

    const { id } = await params
    const body = await req.json()
    const updated = await db.masterItem.update({
      where: { id },
      data: {
        label: body.value,
        // TODO: groupName / departmentCode columns were removed in the new schema.
        displayLabel: body.displayLabel,
        active: body.active,
      },
    })

    try {
      await db.auditLog.create({
        data: {
          action: 'MASTER_DATA_EDIT',
          entity: 'MasterItem',
          entityId: id,
          summary: `แก้ไขข้อมูลมาตรฐาน`,
          actor: user.email,
          detail: JSON.stringify({ id, label: body.value }),
        },
      })
    } catch (err) { console.error('[route]', err) }

    return NextResponse.json({ item: updated })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req, 'MASTER_DATA_EDIT')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row

    const { id } = await params
    await db.masterItem.delete({ where: { id } })

    try {
      await db.auditLog.create({
        data: {
          action: 'MASTER_DATA_EDIT',
          entity: 'MasterItem',
          entityId: id,
          summary: `ลบข้อมูลมาตรฐาน`,
          actor: user.email,
          detail: JSON.stringify({ id, action: 'delete' }),
        },
      })
    } catch (err) { console.error('[route]', err) }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
