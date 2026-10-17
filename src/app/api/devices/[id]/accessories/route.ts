import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { demoTag } from '@/lib/demo-mode'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * GET /api/devices/[id]/accessories — list accessories for a device
 * POST /api/devices/[id]/accessories — add a new accessory
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const accessories = await db.deviceAccessory.findMany({
    where: { parentDeviceId: id },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ accessories })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'DEVICE_EDIT')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const accessory = await db.deviceAccessory.create({
    data: {
      parentDeviceId: id,
      accessoryType: String(body.accessoryType || 'OTHER'),
      brand: body.brand ?? null,
      model: body.model ?? null,
      serialNumber: body.serialNumber ?? null,
      status: String(body.status || 'Active'),
      installedDate: body.installedDate ?? null,
      remark: body.remark ?? null,
      ...demoTag(auth.user),
    },
  })

  return NextResponse.json({ accessory }, { status: 201 })
}
