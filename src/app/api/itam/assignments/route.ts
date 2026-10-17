import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { siteFilterForUser } from '@/lib/auth'
import { buildAuthorizationContext } from '@/lib/authorization-context'

// GET /api/itam/assignments?assetNo=&status=
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req, 'VIEW_DEVICES')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row

    const { searchParams } = new URL(req.url)
    const assetNo = searchParams.get('assetNo')?.trim() ?? ''
    const status = searchParams.get('status')?.trim() ?? ''
    const where: Record<string, unknown> = { AND: [] as unknown[] }
    if (assetNo) (where.AND as unknown[]).push({ assetNo })
    if (status) (where.AND as unknown[]).push({ status })

    // Site-level filter via device relation
    const sf = siteFilterForUser(user)
    if (Object.keys(sf).length) (where.AND as unknown[]).push({ device: sf })
    if (Array.isArray(where.AND) && where.AND.length === 0) delete where.AND

    const assignments = await db.assignment.findMany({
      where,
      orderBy: { checkoutDate: 'desc' },
      // Assignment has no `assetNo` column — it links to Device via `deviceId`,
      // so the asset code must be selected through the relation (Device's
      // field is `assetCode`, not `assetNo`).
      include: { device: { select: { assetCode: true, brand: true, model: true, site: true } } },
    })
    return NextResponse.json({ assignments })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// POST — checkout device (requires DEVICE_TRANSFER)
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req, 'DEVICE_TRANSFER')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row
    // SPRINT-5-MUTATION-CTX-MIGRATION: use ctx.canAtSite for site-scoped perm checks.
    const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)

    const body = await req.json()
    // NOTE: the request body keeps the legacy `assetNo` key for backward
    // compatibility with existing clients, but it is resolved against
    // `Device.assetCode` (the canonical column name).
    const assetNo = body.assetNo as string | undefined
    if (!assetNo || !body.assignee || !body.checkoutDate) {
      return NextResponse.json({ error: 'assetNo, assignee, checkoutDate required' }, { status: 400 })
    }
    // Site access check
    const device = await db.device.findUnique({ where: { assetCode: assetNo } })
    if (!device) return NextResponse.json({ error: 'Device not found' }, { status: 404 })
    if (!ctx.canAtSite(device.site, 'WO_ASSIGN')) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์มอบหมายอุปกรณ์ในสาขานี้' }, { status: 403 })
    }

    // Assignment references the device by `deviceId`, not by asset code.
    const existing = await db.assignment.findFirst({
      where: { deviceId: device.id, status: 'active' },
    })
    if (existing) {
      return NextResponse.json({ error: 'อุปกรณ์นี้ถูกมอบหมายแล้ว' }, { status: 409 })
    }
    const created = await db.assignment.create({
      data: {
        deviceId: device.id,
        assignee: body.assignee,
        assigneeRole: body.assigneeRole || null,
        department: body.department || null,
        checkoutDate: body.checkoutDate,
        expectedReturnDate: body.expectedReturnDate || null,
        status: 'active',
        notes: body.notes || null,
      },
    })

    try {
      await db.auditLog.create({
        data: {
          action: 'ASSIGN',
          entity: 'DeviceAssignment',
          entityId: created.id,
          summary: `มอบหมาย ${assetNo} ให้ ${body.assignee}`,
          detail: JSON.stringify({ assetNo, deviceId: device.id, assignee: body.assignee }),
          actor: user.email,
        },
      })
    } catch (err) { console.error('[route]', err) }

    return NextResponse.json({ assignment: created }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
