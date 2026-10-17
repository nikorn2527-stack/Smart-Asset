import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/** Trim a string field, returning null when empty/missing. */
function optStr(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  return String(v).trim()
}

/** GET /api/devices/[id]/licenses — list licenses for a device. */
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
    const device = await db.device.findUnique({
      where: { id },
      select: { assetCode: true, name: true },
    })
    if (!device) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 })
    }
    // Schema uses PascalCase field names: Asset_No, Software, License_ID,
    // LicenseType, License_Key, Quantity, Expiry_Date, Remark
    const licenses = await db.licenseRecord.findMany({
      where: { Asset_No: device.assetCode },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ licenses })
  } catch (err) {
    console.error('GET /api/devices/[id]/licenses', err)
    return NextResponse.json(
      { error: 'Failed to fetch licenses' },
      { status: 500 },
    )
  }
}

/** POST /api/devices/[id]/licenses — add a license to this device. */
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
    const device = await db.device.findUnique({
      where: { id },
      select: { assetCode: true, name: true },
    })
    if (!device) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 })
    }
    const body = await req.json()
    if (!body.software || String(body.software).trim() === '') {
      return NextResponse.json(
        { error: 'Missing required field: software' },
        { status: 400 },
      )
    }
    const qtyRaw =
      typeof body.quantity === 'number'
        ? body.quantity
        : Number(body.quantity)
    const quantity = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1
    const created = await db.licenseRecord.create({
      data: {
        License_ID: optStr(body.licenseId),
        Asset_No: device.assetCode,
        Software: String(body.software).trim(),
        LicenseType: optStr(body.licenseType),
        License_Key: optStr(body.licenseKey),
        Quantity: quantity,
        Expiry_Date: optStr(body.expiryDate),
        Remark: optStr(body.remark),
      },
    })
    await logAudit(
      'CREATE',
      'LicenseRecord',
      created.id,
      `เพิ่ม License "${created.Software}" ให้อุปกรณ์ ${device.assetCode} (${device.name})`,
      {
        deviceId: id,
        assetCode: device.assetCode,
        software: created.Software,
        licenseId: created.License_ID,
      },
    )
    return NextResponse.json({ license: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/devices/[id]/licenses', err)
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to create license') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** DELETE /api/devices/[id]/licenses?licenseId=xxx — remove a license. */
export async function DELETE(
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
    const { searchParams } = new URL(req.url)
    const licenseId = searchParams.get('licenseId')
    if (!licenseId) {
      return NextResponse.json(
        { error: 'Missing query parameter: licenseId' },
        { status: 400 },
      )
    }
    const device = await db.device.findUnique({
      where: { id },
      select: { assetCode: true, name: true },
    })
    if (!device) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 })
    }
    const existing = await db.licenseRecord.findUnique({
      where: { id: licenseId },
    })
    if (!existing) {
      return NextResponse.json({ error: 'License not found' }, { status: 404 })
    }
    await db.licenseRecord.delete({ where: { id: licenseId } })
    await logAudit(
      'DELETE',
      'LicenseRecord',
      licenseId,
      `ลบ License "${existing.Software}" จากอุปกรณ์ ${device.assetCode} (${device.name})`,
      {
        deviceId: id,
        assetCode: device.assetCode,
        software: existing.Software,
      },
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/devices/[id]/licenses', err)
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to delete license') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * PUT /api/devices/[id]/licenses?licenseId=xxx — update an existing license.
 * Body fields (all optional): software, licenseId, licenseType, licenseKey,
 * quantity, expiryDate, remark.
 */
export async function PUT(
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
    const { searchParams } = new URL(req.url)
    const licenseId = searchParams.get('licenseId')
    if (!licenseId) {
      return NextResponse.json(
        { error: 'Missing query parameter: licenseId' },
        { status: 400 },
      )
    }
    const device = await db.device.findUnique({
      where: { id },
      select: { assetCode: true, name: true },
    })
    if (!device) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 })
    }
    const existing = await db.licenseRecord.findUnique({
      where: { id: licenseId },
    })
    if (!existing) {
      return NextResponse.json({ error: 'License not found' }, { status: 404 })
    }
    const body = await req.json()
    if (body.software !== undefined && String(body.software).trim() === '') {
      return NextResponse.json(
        { error: 'software cannot be empty' },
        { status: 400 },
      )
    }
    const qtyRaw =
      body.quantity === undefined
        ? undefined
        : typeof body.quantity === 'number'
          ? body.quantity
          : Number(body.quantity)
    const quantity =
      qtyRaw === undefined
        ? undefined
        : Number.isFinite(qtyRaw) && qtyRaw > 0
          ? qtyRaw
          : 1

    const updated = await db.licenseRecord.update({
      where: { id: licenseId },
      data: {
        License_ID:
          body.licenseId === undefined ? undefined : optStr(body.licenseId),
        Software:
          body.software === undefined ? undefined : String(body.software).trim(),
        LicenseType:
          body.licenseType === undefined ? undefined : optStr(body.licenseType),
        License_Key:
          body.licenseKey === undefined ? undefined : optStr(body.licenseKey),
        Quantity: quantity,
        Expiry_Date:
          body.expiryDate === undefined ? undefined : optStr(body.expiryDate),
        Remark: body.remark === undefined ? undefined : optStr(body.remark),
      },
    })
    await logAudit(
      'UPDATE',
      'LicenseRecord',
      licenseId,
      `แก้ไข License "${updated.Software}" ของอุปกรณ์ ${device.assetCode} (${device.name})`,
      {
        deviceId: id,
        assetCode: device.assetCode,
        software: updated.Software,
        licenseId: updated.License_ID,
      },
    )
    return NextResponse.json({ license: updated })
  } catch (err) {
    console.error('PUT /api/devices/[id]/licenses', err)
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to update license') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
