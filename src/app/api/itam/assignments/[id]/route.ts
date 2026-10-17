import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'

// PUT /api/itam/assignments/[id] — return device (set status=returned)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req, 'DEVICE_TRANSFER')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row
    // SPRINT-5-MUTATION-CTX-MIGRATION: use ctx.canAtSite for site-scoped perm checks.
    const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)

    const { id } = await params
    const existing = await db.assignment.findUnique({
      where: { id },
      // Assignment links to Device via `deviceId`; the asset code lives on
      // the device row (field name `assetCode`), so select it through the
      // relation.
      include: { device: { select: { site: true, assetCode: true } } },
    })
    if (!existing) return NextResponse.json({ error: 'ไม่พบการมอบหมาย' }, { status: 404 })
    if (!ctx.canAtSite(existing.device?.site, 'WO_ASSIGN')) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์คืนอุปกรณ์ในสาขานี้' }, { status: 403 })
    }

    const body = await req.json()
    const updated = await db.assignment.update({
      where: { id },
      data: {
        status: 'returned',
        actualReturnDate: body.actualReturnDate || new Date().toISOString().slice(0, 10),
        notes: body.notes ? `${body.notes}` : undefined,
      },
    })

    try {
      await db.auditLog.create({
        data: {
          action: 'RETURN',
          entity: 'DeviceAssignment',
          entityId: id,
          summary: `คืนอุปกรณ์ ${existing.device?.assetCode ?? ""}`,
          detail: JSON.stringify({ assignmentId: id, assetCode: existing.device?.assetCode }),
          actor: user.email,
        },
      })
    } catch (err) { console.error('[route]', err) }

    return NextResponse.json({ assignment: updated })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req, 'DEVICE_TRANSFER')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row
    // SPRINT-5-MUTATION-CTX-MIGRATION: use ctx.canAtSite for site-scoped perm checks.
    const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)

    const { id } = await params
    const existing = await db.assignment.findUnique({
      where: { id },
      // Assignment links to Device via `deviceId`; the asset code lives on
      // the device row (field name `assetCode`), so select it through the
      // relation.
      include: { device: { select: { site: true, assetCode: true } } },
    })
    if (!existing) return NextResponse.json({ error: 'ไม่พบการมอบหมาย' }, { status: 404 })
    if (!ctx.canAtSite(existing.device?.site, 'WO_ASSIGN')) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์ลบการมอบหมายในสาขานี้' }, { status: 403 })
    }
    await db.assignment.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
