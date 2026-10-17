import { NextRequest, NextResponse } from 'next/server'
import { qrAccess } from '@/lib/qr-access'
import { resolveAccessoryQrIdentity } from '@/lib/qr-identity'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const access = await qrAccess(req)
  if (!access.ok) return access.response
  const identifier = new URL(req.url).searchParams.get('shortId')?.trim()
  if (!identifier || identifier.length > 128) return NextResponse.json({ error: 'Invalid QR identifier' }, { status: 400 })
  const accessory = await resolveAccessoryQrIdentity(identifier, access.scope)
  const parent = accessory ? await db.device.findFirst({ where: { id: accessory.parentDeviceId, ...access.scope } }) : null
  if (!accessory || !parent || !access.ctx.canAtSite(parent.site, 'VIEW_DEVICES')) return NextResponse.json({ notFound: true }, { status: 404 })
  return NextResponse.json({ accessoryId: accessory.id, parentDeviceId: accessory.parentDeviceId, accessoryType: accessory.accessoryType, brand: accessory.brand, model: accessory.model, serialNumber: accessory.serialNumber, status: accessory.status }, { headers: { 'Cache-Control': 'no-store' } })
}
