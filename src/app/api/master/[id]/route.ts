import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await req.json()
    const before = await db.masterItem.findUnique({ where: { id } })
    if (!before) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const updated = await db.masterItem.update({
      where: { id },
      data: {
        category: body.category !== undefined ? String(body.category).trim() : undefined,
        code: body.code !== undefined ? String(body.code).trim() : undefined,
        label: body.label !== undefined ? String(body.label).trim() : undefined,
        parentRef:
          body.parentRef !== undefined
            ? body.parentRef
              ? String(body.parentRef).trim()
              : null
            : undefined,
        displayLabel:
          body.displayLabel !== undefined
            ? body.displayLabel
              ? String(body.displayLabel).trim()
              : null
            : undefined,
        siteCode:
          body.siteCode !== undefined
            ? body.siteCode
              ? String(body.siteCode).trim()
              : null
            : undefined,
      },
    })
    await logAudit(
      'UPDATE',
      'MasterItem',
      id,
      `แก้ไขข้อมูลมาตรฐาน ${updated.category}: ${updated.code}`,
      { before, after: updated },
    )
    return NextResponse.json({ item: updated })
  } catch (err) {
    console.error('PUT /api/master/[id]', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to update master item') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const item = await db.masterItem.findUnique({ where: { id } })
    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    await db.masterItem.delete({ where: { id } })
    await logAudit(
      'DELETE',
      'MasterItem',
      id,
      `ลบข้อมูลมาตรฐาน ${item.category}: ${item.code} (${item.label})`,
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/master/[id]', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to delete master item') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
