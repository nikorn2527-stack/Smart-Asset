import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * PATCH /api/devices/[id]/accessories/[accessoryId] — update an accessory.
 * DELETE /api/devices/[id]/accessories/[accessoryId] — delete an accessory.
 *
 * P1 FIX (AUDIT-FINDINGS-FIX-018): previously PATCH and DELETE silently
 * mutated DeviceAccessory rows with no audit trail. Now both write an
 * audit log entry after success (fire-and-forget — never blocks the
 * mutation).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accessoryId: string }> },
) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'DEVICE_EDIT')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id, accessoryId } = await params
  const body = await req.json().catch(() => ({}))

  // Capture only the fields being changed so the audit detail is meaningful.
  const changes: Record<string, unknown> = {}
  if (body.accessoryType !== undefined) changes.accessoryType = body.accessoryType
  if (body.brand !== undefined) changes.brand = body.brand
  if (body.model !== undefined) changes.model = body.model
  if (body.serialNumber !== undefined) changes.serialNumber = body.serialNumber
  if (body.status !== undefined) changes.status = body.status
  if (body.installedDate !== undefined) changes.installedDate = body.installedDate
  if (body.remark !== undefined) changes.remark = body.remark

  const updated = await db.deviceAccessory.update({
    where: { id: accessoryId },
    data: {
      accessoryType: body.accessoryType,
      brand: body.brand,
      model: body.model,
      serialNumber: body.serialNumber,
      status: body.status,
      installedDate: body.installedDate,
      remark: body.remark,
    },
  })

  // P1 FIX (AUDIT-FINDINGS-FIX-018): audit-log the accessory update.
  await logAudit(
    'UPDATE',
    'DeviceAccessory',
    accessoryId,
    `แก้ไขอุปกรณ์ต่อพ่วง ${updated.accessoryType ?? accessoryId} ของอุปกรณ์ ${id}`,
    { parentDeviceId: id, changes },
    auth.user.email,
  ).catch(() => {
    // best-effort; never block the mutation
  })

  return NextResponse.json({ accessory: updated })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accessoryId: string }> },
) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'DEVICE_EDIT')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id, accessoryId } = await params

  // Capture the existing row before deletion so the audit detail records
  // what was removed (type, serial, brand, model).
  const existing = await db.deviceAccessory.findUnique({
    where: { id: accessoryId },
    select: { accessoryType: true, brand: true, model: true, serialNumber: true },
  }).catch(() => null)

  await db.deviceAccessory.delete({ where: { id: accessoryId } })

  // P1 FIX (AUDIT-FINDINGS-FIX-018): audit-log the accessory deletion.
  await logAudit(
    'DELETE',
    'DeviceAccessory',
    accessoryId,
    `ลบอุปกรณ์ต่อพ่วง ${existing?.accessoryType ?? accessoryId} ของอุปกรณ์ ${id}`,
    {
      parentDeviceId: id,
      accessoryType: existing?.accessoryType ?? null,
      brand: existing?.brand ?? null,
      model: existing?.model ?? null,
      serialNumber: existing?.serialNumber ?? null,
    },
    auth.user.email,
  ).catch(() => {
    // best-effort; never block the mutation
  })

  return NextResponse.json({ ok: true })
}
