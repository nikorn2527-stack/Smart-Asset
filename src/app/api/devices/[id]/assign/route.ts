import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const device = await db.device.findUnique({ where: { id } })
    if (!device) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const assignments = await db.assignment.findMany({
      where: { deviceId: id },
      orderBy: [{ checkoutDate: 'desc' }, { createdAt: 'desc' }],
    })
    return NextResponse.json({ assignments })
  } catch (err) {
    console.error('GET /api/devices/[id]/assign', err)
    return NextResponse.json(
      { error: 'Failed to fetch assignments' },
      { status: 500 },
    )
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'DEVICE_EDIT')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const body = await req.json()
    const {
      assignee,
      assigneeRole,
      department,
      checkoutDate,
      expectedReturnDate,
      notes,
    } = body as {
      assignee?: string
      assigneeRole?: string | null
      department?: string | null
      checkoutDate?: string
      expectedReturnDate?: string | null
      notes?: string | null
    }

    if (!assignee || !assignee.trim()) {
      return NextResponse.json(
        { error: 'ต้องระบุผู้รับมอบหมาย (assignee)' },
        { status: 400 },
      )
    }

    const device = await db.device.findUnique({ where: { id } })
    if (!device) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Refuse if there is already an active assignment for this device.
    const activeExisting = await db.assignment.findFirst({
      where: { deviceId: id, status: 'active' },
    })
    if (activeExisting) {
      return NextResponse.json(
        {
          error:
            'อุปกรณ์นี้มีการมอบหมายที่ยัง active อยู่ — กรุณาคืนอุปกรณ์ก่อนมอบหมายใหม่',
        },
        { status: 409 },
      )
    }

    const dateStr =
      checkoutDate?.trim() || new Date().toISOString().slice(0, 10)

    const assignment = await db.assignment.create({
      data: {
        deviceId: id,
        assignee: String(assignee).trim(),
        assigneeRole: assigneeRole ? String(assigneeRole).trim() : null,
        department: department ? String(department).trim() : null,
        checkoutDate: dateStr,
        expectedReturnDate: expectedReturnDate
          ? String(expectedReturnDate).trim()
          : null,
        notes: notes ? String(notes).trim() : null,
        status: 'active',
        actualReturnDate: null,
      },
    })

    await db.device.update({
      where: { id },
      data: { currentAssignee: String(assignee).trim() },
    })

    await logAudit(
      'ASSIGN',
      'Device',
      id,
      `มอบหมายอุปกรณ์ ${device.assetCode} ให้ ${String(assignee).trim()}`,
      {
        assignee: String(assignee).trim(),
        assigneeRole: assigneeRole ?? null,
        department: department ?? null,
        checkoutDate: dateStr,
        expectedReturnDate: expectedReturnDate ?? null,
      },
    )

    return NextResponse.json({ assignment }, { status: 201 })
  } catch (err) {
    console.error('POST /api/devices/[id]/assign', err)
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to checkout device') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
