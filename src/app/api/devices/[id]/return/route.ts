import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'DEVICE_TRANSFER')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const body = await req.json()
    const { actualReturnDate, notes } = body as {
      actualReturnDate?: string
      notes?: string | null
    }

    const device = await db.device.findUnique({ where: { id } })
    if (!device) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const active = await db.assignment.findFirst({
      where: { deviceId: id, status: 'active' },
    })
    if (!active) {
      return NextResponse.json(
        { error: 'ไม่พบการมอบหมายที่ active อยู่สำหรับอุปกรณ์นี้' },
        { status: 404 },
      )
    }

    const dateStr =
      actualReturnDate?.trim() || new Date().toISOString().slice(0, 10)

    const updated = await db.assignment.update({
      where: { id: active.id },
      data: {
        status: 'returned',
        actualReturnDate: dateStr,
        notes: notes
          ? (active.notes ? active.notes + '\n' : '') + String(notes).trim()
          : active.notes,
      },
    })

    await db.device.update({
      where: { id },
      data: { currentAssignee: null },
    })

    await logAudit(
      'RETURN',
      'Device',
      id,
      `คืนอุปกรณ์ ${device.assetCode} จาก ${active.assignee}`,
      {
        assignee: active.assignee,
        checkoutDate: active.checkoutDate,
        actualReturnDate: dateStr,
      },
    )

    return NextResponse.json({ assignment: updated })
  } catch (err) {
    console.error('POST /api/devices/[id]/return', err)
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to return device') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
