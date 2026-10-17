import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { siteFilterForUser } from '@/lib/auth'
import { POST as postMeterReading } from '@/app/api/itam/meter-readings/route'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { getServerLang } from '@/lib/server-i18n'

// ════════════════════════════════════════════════════════════════════════
// METER ROUTE DECISION (Phase 4.6) — DO NOT MERGE THESE ROUTES
// ════════════════════════════════════════════════════════════════════════
// There are three meter-related route trees in this codebase. They look
// redundant at first glance but serve DISTINCT purposes:
//
//   1. /api/meter/*  (this file + /api/meter/reminders)
//      Role: REMINDER + CYCLE MANAGEMENT + LEGACY-COMPAT READ/WRITE
//      • GET /api/meter            — legacy shape for old UI/export code
//      • POST /api/meter            — legacy shape; DELEGATES to the unified
//                                    /api/itam/meter-readings writer
//      • GET /api/meter/reminders   — finds meter-required devices that
//                                    haven't been read in the current cycle
//      • /api/cycles/*              — cycle open/close lifecycle
//
//   2. /api/itam/meter-readings/*  (the main CRUD surface)
//      Role: MAIN METER READING CRUD (Phase 4.3 — gated by 'meters' module)
//      • GET /api/itam/meter-readings           — list, paginated
//      • POST /api/itam/meter-readings          — create reading (with
//                                                 mode-switch detection,
//                                                 write-lock, replay dedup)
//      • /api/itam/meter-readings/unread        — cycle countdown list
//      • /api/itam/meter-readings/force-close   — admin override
//
//   3. /api/v1/meter-readings/*  (external API, v1 stable contract)
//      Role: EXTERNAL API FOR THIRD-PARTY APPS (stable v1 contract)
//      • Uses the standardized /api/v1/* response envelope
//        ({ data, pagination, meta }) and the `requireApiAuth()` helper.
//      • Built for backward-compat with external integrations; field
//        names + response shape are versioned and won't change without
//        a v2 bump.
//      • Internally reuses the same write path as #2 (via the
//        findValidPrevReading + assertMeterMonthWritable helpers), so
//        business rules stay consistent.
//
// DO NOT collapse these into one route tree. The legacy `/api/meter`
// shape is preserved for the existing UI/export code; the `/api/itam`
// tree is the primary staff surface; and `/api/v1/*` is the public,
// versioned contract for third parties.
// ════════════════════════════════════════════════════════════════════════

type MeterRow = {
  id: string
  readingId: string | null
  deviceId: string
  assetCode: string | null
  readingDate: string
  readingMonth: string | null
  meterBw: number
  meterColor: number
  pagesBw: number
  pagesColor: number
  prevMeterBw: number
  prevMeterColor: number
  readingType: string | null
  readBy: string | null
  remark: string | null
  device?: {
    id: string
    name: string
    assetCode: string
    brand: string
    model: string
  }
}

function meterRowToLegacy(row: MeterRow) {
  return {
    ...row,
    // Preserve the legacy `/api/meter` response contract for existing UI/export code.
    reading: row.meterBw,
    prevReading: row.prevMeterBw,
    date: row.readingDate,
    delta: row.pagesBw,
    cycleId: null,
  }
}

function buildMeterWhere(
  deviceId: string,
  user: Parameters<typeof siteFilterForUser>[0],
): Prisma.MeterReadingWhereInput {
  const where: Prisma.MeterReadingWhereInput = {}
  if (deviceId) where.deviceId = deviceId

  const siteFilter = siteFilterForUser(user)
  if (Object.keys(siteFilter).length > 0) {
    where.device = siteFilter
  }
  return where
}

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('meters')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req, 'VIEW_DEVICES')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { searchParams } = new URL(req.url)
    const deviceId = searchParams.get('deviceId')?.trim() ?? ''
    const aggregate = searchParams.get('aggregate')?.trim() ?? ''
    const where = buildMeterWhere(deviceId, auth.row)

    if (aggregate === 'monthly') {
      const groups = await db.meterReading.groupBy({
        by: ['readingMonth'],
        where: { ...where, readingMonth: { not: null } },
        _sum: { pagesBw: true, pagesColor: true },
      })
      const monthly = groups
        .filter((group): group is typeof group & { readingMonth: string } => Boolean(group.readingMonth))
        .map((group) => ({
          month: group.readingMonth,
          value: (group._sum.pagesBw ?? 0) + (group._sum.pagesColor ?? 0),
        }))
        .sort((a, b) => a.month.localeCompare(b.month))
      return NextResponse.json({ monthly })
    }

    if (aggregate === 'byDevice') {
      const groups = await db.meterReading.groupBy({
        by: ['deviceId'],
        where,
        _sum: { pagesBw: true, pagesColor: true },
      })
      const deviceIds = groups.map((group) => group.deviceId)
      const devices = deviceIds.length
        ? await db.device.findMany({
            where: { id: { in: deviceIds } },
            select: { id: true, name: true, assetCode: true },
          })
        : []
      const valueByDevice = new Map(
        groups.map((group) => [
          group.deviceId,
          (group._sum.pagesBw ?? 0) + (group._sum.pagesColor ?? 0),
        ]),
      )
      const byDevice = devices
        .map((device) => ({
          id: device.id,
          name: device.name,
          assetCode: device.assetCode,
          value: valueByDevice.get(device.id) ?? 0,
        }))
        .sort((a, b) => b.value - a.value)
      return NextResponse.json({ byDevice })
    }

    const cycleId = searchParams.get('cycleId')?.trim() ?? ''
    // `cycleId` was part of the old compatibility contract, but it is not a
    // column in the ITAM-DB MeterReading model. Ignore it rather than querying
    // a non-existent Prisma field; cycle locking is handled by the unified API.
    void cycleId

    const readings = await db.meterReading.findMany({
      where,
      orderBy: [{ readingDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        device: { select: { id: true, name: true, assetCode: true, brand: true, model: true } },
      },
      take: 500,
    })
    return NextResponse.json({ readings: readings.map((row) => meterRowToLegacy(row as MeterRow)) })
  } catch (err) {
    console.error('GET /api/meter', err)
    return NextResponse.json({ error: 'Failed to fetch meter readings' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('meters')
  if (unavailable) return unavailable

  // I18N-04: resolve the caller's language server-side for the meter warning text.
  const lang = getServerLang(req)


  try {
    const auth = await requireAuth(req, 'METER_WRITE')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await req.json() as Record<string, unknown>
    const requestedDeviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : ''
    const requestedAssetCode = typeof body.assetCode === 'string'
      ? body.assetCode.trim()
      : typeof body.assetNo === 'string'
        ? body.assetNo.trim()
        : ''
    const device = requestedDeviceId
      ? await db.device.findUnique({ where: { id: requestedDeviceId } })
      : requestedAssetCode
        ? await db.device.findUnique({ where: { assetCode: requestedAssetCode } })
        : null

    if (!device) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 })
    }

    const legacyReading = body.reading ?? body.meterBw
    const meterBw = Number(legacyReading)
    if (!Number.isFinite(meterBw)) {
      return NextResponse.json({ error: 'reading must be a number' }, { status: 400 })
    }

    const date = typeof body.date === 'string' ? body.date.trim() : ''
    const readingDate = typeof body.readingDate === 'string' ? body.readingDate.trim() : date
    const remark = typeof body.remark === 'string' ? body.remark.trim() : ''
    const previousDeviceReading = device.lastMeterBw ?? 0
    const isLegacyReset = meterBw < previousDeviceReading

    const delegatedBody = {
      ...body,
      assetCode: device.assetCode,
      meterBw,
      meterColor: Number(body.meterColor ?? 0),
      readingDate: readingDate || undefined,
      readingMonth: typeof body.readingMonth === 'string'
        ? body.readingMonth
        : readingDate
          ? readingDate.slice(0, 7)
          : undefined,
      remark: remark || null,
      // The old UI already validates a reset remark before posting. Preserve
      // that behavior while letting the unified API remain the single writer.
      confirmReset: body.confirmReset === true || (isLegacyReset && Boolean(remark)),
    }

    const forwardedHeaders = new Headers(req.headers)
    forwardedHeaders.delete('content-length')
    const forwardedRequest = new NextRequest(req.url, {
      method: 'POST',
      headers: forwardedHeaders,
      body: JSON.stringify(delegatedBody),
    })
    const response = await postMeterReading(forwardedRequest)
    const payload = await response.json() as Record<string, unknown>

    if (response.status >= 400 || !payload.reading || typeof payload.reading !== 'object') {
      return NextResponse.json(payload, { status: response.status })
    }

    const saved = payload.reading as MeterRow
    const warning = saved.pagesBw + saved.pagesColor > 20000
      ? `ค่าเพิ่มขึ้น ${(saved.pagesBw + saved.pagesColor).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น (เกิน 20,000 แผ่น) กรุณาตรวจสอบ`
      : null

    return NextResponse.json(
      {
        ...payload,
        reading: meterRowToLegacy(saved),
        warning,
      },
      { status: response.status },
    )
  } catch (err) {
    console.error('POST /api/meter', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to save reading') : 'Internal server error' },
      { status: 500 },
    )
  }
}
