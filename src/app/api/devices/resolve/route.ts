import { NextRequest, NextResponse } from 'next/server'
import { qrAccess } from '@/lib/qr-access'
import { resolveDeviceQrIdentity } from '@/lib/qr-identity'

export async function GET(req: NextRequest) {
  const access = await qrAccess(req)
  if (!access.ok) return access.response
  const identifier = new URL(req.url).searchParams.get('shortId')?.trim()
  if (!identifier || identifier.length > 128) return NextResponse.json({ error: 'Invalid QR identifier' }, { status: 400 })
  const device = await resolveDeviceQrIdentity(identifier, access.scope, true)
  if (!device || !access.ctx.canAtSite(device.site, 'VIEW_DEVICES')) return NextResponse.json({ notFound: true }, { status: 404 })
  return NextResponse.json({ deviceId: device.id, assetCode: device.assetCode, name: device.name, brand: device.brand, model: device.model, status: device.status }, { headers: { 'Cache-Control': 'no-store' } })
}
