// ============================================================
// Asset Verification Session Detail (Phase 5.3 + 5.4)
// ============================================================
// GET  /api/asset-verification/[id]  — fetch session + items (+ device snapshot)
// POST /api/asset-verification/[id]  — scan a device (by QR/assetCode) → mark COUNTED
//                                       Body: { scanCode }  // assetCode or shortId
//                                              { targetId, countedLocation? }
// PUT  /api/asset-verification/[id]  — close session (status=CLOSED) + return Phase 5.4 summary
//                                       Body: { action: 'close', note? }
//
// Phase 5.4 summary (returned when closing):
//   totalCount          — number of devices in the session
//   countedCount        — devices with status=COUNTED
//   notFoundCount       — devices with status=NOT_FOUND
//   wrongLocationCount  — devices whose countedLocation != expectedLocation
//   missingValue        — sum of bookValue for NOT_FOUND devices (depreciation-aware)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { logAudit } from '@/lib/audit'
import { Prisma } from '@prisma/client'

function parseId(req: NextRequest): string {
  const url = new URL(req.url)
  const parts = url.pathname.split('/')
  return parts[parts.length - 1] ?? ''
}

/**
 * Straight-line depreciation book value (mirrors /api/devices/depreciation +
 * /api/reports/asset-register).
 */
function computeBookValue(device: {
  purchasePrice: Prisma.Decimal | null
  salvageValue: Prisma.Decimal | null
  usefulLife: number | null
  purchaseDate: string | null
}): number {
  const price = device.purchasePrice ? Number(device.purchasePrice) : null
  if (price == null || price <= 0) return 0
  const life = device.usefulLife
  if (life == null || life <= 0) return price
  const salvage = device.salvageValue ? Number(device.salvageValue) : 0
  let years = 0
  if (device.purchaseDate) {
    try {
      const iso = device.purchaseDate.length > 10
        ? device.purchaseDate
        : `${device.purchaseDate}T00:00:00`
      years = Math.max(0, (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24 * 365.25))
    } catch {
      years = 0
    }
  }
  const depreciableAmount = price - salvage
  const annualDep = depreciableAmount / life
  const accumulated = Math.min(annualDep * years, depreciableAmount)
  return Math.max(salvage, price - accumulated)
}

export async function GET(req: NextRequest) {
  const moduleCheck = await moduleUnavailableResponse('devices')
  if (moduleCheck) return moduleCheck

  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const id = parseId(req)
  try {
    const session = await db.stockCountSession.findUnique({
      where: { id },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    if (session.scope !== 'DEVICE') {
      return NextResponse.json(
        { error: 'Session is not a device verification session (scope != DEVICE)' },
        { status: 400 },
      )
    }

    // Hydrate device snapshots.
    const deviceIds = session.items.map((it) => it.targetId)
    const devices = deviceIds.length
      ? await db.device.findMany({
          where: { id: { in: deviceIds } },
          select: {
            id: true,
            assetCode: true,
            name: true,
            type: true,
            brand: true,
            model: true,
            site: true,
            building: true,
            floor: true,
            room: true,
            department: true,
            status: true,
          },
        })
      : []
    const deviceById = new Map(devices.map((d) => [d.id, d]))

    const items = session.items.map((it) => {
      const device = deviceById.get(it.targetId)
      return {
        ...it,
        target: device ?? null,
        expectedLocation: it.expectedLocation
          ?? [device?.building, device?.floor, device?.room].filter(Boolean).join(' / ')
          ?? null,
      }
    })

    return NextResponse.json({ data: { ...session, items } })
  } catch (err) {
    console.error('GET /api/asset-verification/[id]', err)
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const moduleCheck = await moduleUnavailableResponse('devices')
  if (moduleCheck) return moduleCheck

  const auth = await requireAuth(req, 'DEVICE_EDIT')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const id = parseId(req)
  try {
    const session = await db.stockCountSession.findUnique({ where: { id } })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    if (session.scope !== 'DEVICE') {
      return NextResponse.json(
        { error: 'Session is not a device verification session' },
        { status: 400 },
      )
    }
    if (session.status !== 'OPEN') {
      return NextResponse.json({ error: 'Session is not OPEN (cannot scan)' }, { status: 400 })
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const scanCode = typeof body.scanCode === 'string' ? body.scanCode.trim() : ''
    const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : ''
    const countedLocation = typeof body.countedLocation === 'string'
      ? body.countedLocation.trim()
      : null
    const note = typeof body.note === 'string' ? body.note.trim() : null

    // Resolve Device — by scanCode (assetCode) OR explicit targetId.
    // assetCode is unique; we don't fall back to shortId here (the public
    // QR scanner already does that resolution before hitting this route).
    let device: { id: string; assetCode: string; name: string; building: string | null; floor: string | null; room: string | null } | null = null
    if (scanCode) {
      device = await db.device.findUnique({
        where: { assetCode: scanCode },
        select: { id: true, assetCode: true, name: true, building: true, floor: true, room: true },
      })
    } else if (targetId) {
      device = await db.device.findUnique({
        where: { id: targetId },
        select: { id: true, assetCode: true, name: true, building: true, floor: true, room: true },
      })
    }
    if (!device) {
      return NextResponse.json({ error: 'Device not found (scanCode/targetId invalid)' }, { status: 404 })
    }

    const expectedLocation = [device.building, device.floor, device.room]
      .filter(Boolean)
      .join(' / ') || null

    // Determine if the counted location matches the expected location.
    // If countedLocation is omitted, we assume the user just scanned the
    // device in place (so it matches expected). If they explicitly entered
    // a different location, mark WRONG_LOCATION.
    const finalCountedLocation = countedLocation ?? expectedLocation
    const isWrongLocation =
      countedLocation != null && countedLocation !== '' && countedLocation !== expectedLocation

    // Upsert: if the device is already in this session, update; else insert.
    const existing = await db.stockCountItem.findFirst({
      where: { sessionId: id, targetId: device.id },
    })

    const status = isWrongLocation ? 'WRONG_LOCATION' : 'COUNTED'

    let item
    if (existing) {
      item = await db.stockCountItem.update({
        where: { id: existing.id },
        data: {
          countedLocation: finalCountedLocation,
          countedBy: auth.user.email,
          countedAt: new Date(),
          status,
          note: note ?? existing.note,
        },
      })
    } else {
      item = await db.stockCountItem.create({
        data: {
          sessionId: id,
          targetId: device.id,
          targetCode: device.assetCode,
          expectedLocation,
          countedLocation: finalCountedLocation,
          countedBy: auth.user.email,
          countedAt: new Date(),
          status,
          note,
        },
      })
    }

    return NextResponse.json({ data: item }, { status: 201 })
  } catch (err) {
    console.error('POST /api/asset-verification/[id]', err)
    return NextResponse.json({ error: 'Failed to scan device' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const moduleCheck = await moduleUnavailableResponse('devices')
  if (moduleCheck) return moduleCheck

  const auth = await requireAuth(req, 'DEVICE_EDIT')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const id = parseId(req)
  try {
    const session = await db.stockCountSession.findUnique({
      where: { id },
      include: { items: true },
    })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    if (session.scope !== 'DEVICE') {
      return NextResponse.json(
        { error: 'Session is not a device verification session' },
        { status: 400 },
      )
    }
    if (session.status !== 'OPEN') {
      return NextResponse.json({ error: 'Session already closed/cancelled' }, { status: 400 })
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = typeof body.action === 'string' ? body.action : 'close'
    if (action !== 'close') {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
    const note = typeof body.note === 'string' ? body.note.trim() : null

    // Phase 5.4: mark uncounted devices as NOT_FOUND.
    const uncounted = session.items.filter((it) => it.status === 'PENDING')
    if (uncounted.length > 0) {
      await db.stockCountItem.updateMany({
        where: { id: { in: uncounted.map((it) => it.id) } },
        data: { status: 'NOT_FOUND' },
      })
    }

    const items = await db.stockCountItem.findMany({ where: { sessionId: id } })

    const totalCount = items.length
    const countedCount = items.filter((it) => it.status === 'COUNTED').length
    const notFoundCount = items.filter((it) => it.status === 'NOT_FOUND').length
    const wrongLocationCount = items.filter((it) => it.status === 'WRONG_LOCATION').length

    // missingValue = sum of bookValue for NOT_FOUND devices (depreciation-aware).
    const notFoundDeviceIds = items
      .filter((it) => it.status === 'NOT_FOUND')
      .map((it) => it.targetId)
    let missingValue = 0
    if (notFoundDeviceIds.length > 0) {
      const missingDevices = await db.device.findMany({
        where: { id: { in: notFoundDeviceIds } },
        select: {
          id: true,
          purchasePrice: true,
          salvageValue: true,
          usefulLife: true,
          purchaseDate: true,
        },
      })
      for (const d of missingDevices) {
        missingValue += computeBookValue(d)
      }
    }
    missingValue = Math.round(missingValue * 100) / 100

    const updated = await db.stockCountSession.update({
      where: { id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        note: note ?? session.note,
      },
    })

    await logAudit(
      'UPDATE',
      'StockCountSession',
      updated.id,
      `ปิดรอบตรวจนับอุปกรณ์ "${updated.name}" — total=${totalCount}, counted=${countedCount}, notFound=${notFoundCount}, wrongLocation=${wrongLocationCount}, missingValue=${missingValue}`,
      {
        sessionId: updated.id,
        summary: { totalCount, countedCount, notFoundCount, wrongLocationCount, missingValue },
      },
      auth.user.email,
    )

    return NextResponse.json({
      data: updated,
      summary: {
        totalCount,
        countedCount,
        notFoundCount,
        wrongLocationCount,
        missingValue,
      },
    })
  } catch (err) {
    console.error('PUT /api/asset-verification/[id]', err)
    return NextResponse.json({ error: 'Failed to close session' }, { status: 500 })
  }
}
