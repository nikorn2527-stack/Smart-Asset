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
    const { bwRate, colorRate } = body as {
      bwRate?: number
      colorRate?: number
    }
    const existing = await db.siteRate.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const bw =
      typeof bwRate === 'number' && Number.isFinite(bwRate)
        ? Math.max(0, bwRate)
        : existing.bwRate
    const color =
      typeof colorRate === 'number' && Number.isFinite(colorRate)
        ? Math.max(0, colorRate)
        : existing.colorRate
    const updated = await db.siteRate.update({
      where: { id },
      data: { bwRate: bw, colorRate: color },
    })
    await logAudit(
      'UPDATE',
      'Setting',
      id,
      `แก้ไขอัตราค่ากระดาษสาขา ${existing.siteCode}: ขาวดำ ${bw}฿ / สี ${color}฿`,
      { siteCode: existing.siteCode, bwRate: bw, colorRate: color },
    )
    return NextResponse.json({ rate: updated })
  } catch (err) {
    console.error('PUT /api/site-rates/[id]', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to update rate') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const existing = await db.siteRate.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    await db.siteRate.delete({ where: { id } })
    await logAudit(
      'DELETE',
      'Setting',
      id,
      `ลบอัตราค่ากระดาษสาขา ${existing.siteCode}`,
      { siteCode: existing.siteCode },
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/site-rates/[id]', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to delete rate') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
