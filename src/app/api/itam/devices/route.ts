import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { siteFilterForUser } from '@/lib/auth'
import { demoFilter } from '@/lib/demo-mode'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { notifyDeviceAdded } from '@/lib/notifications'
import { publishRealtimeEvent } from '@/lib/realtime'
import { parseDeviceListPagination } from '@/lib/device-list-query'
import { DEVICE_LIST_FIELDS, DEVICE_MOBILE_LIST_FIELDS } from '@/lib/devices-bounded-list'
import { demoTag } from '@/lib/demo-mode'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// GET /api/itam/devices?search=&status=&site=&type=&page=1&limit=20
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req, 'VIEW_DEVICES')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row
    // FIX-027: build authorization context for site-scoped permission checks
    // (replaces legacy canAccessSite which only checked site membership).
    const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)

    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim() ?? ''
    const status = searchParams.get('status')?.trim() ?? ''
    const site = searchParams.get('site')?.trim() ?? ''
    const deviceType = searchParams.get('type')?.trim() ?? ''
    // Exact-match assetNo filter (used by QR scanner smart-routing and quick-lookup)
    const assetNoExact = searchParams.get('assetNo')?.trim() ?? ''
    // SERIAL-FIRST (METER-LOOKUP-P0): exact-match serialNumber filter for QR
    // scanners that encode the manufacturer serial. Falls back to this when
    // assetNoExact doesn't match (called by qr-scanner.tsx).
    const serialExact = searchParams.get('serial')?.trim() ?? ''
    const { page, limit, skip } = parseDeviceListPagination(searchParams)

    const where: Record<string, unknown> = { AND: [] as unknown[] }
    // ── Site-level filter: non-admin users only see their allowedSites ──
    const siteFilter = { ...siteFilterForUser(user), ...demoFilter(user) }
    if (Object.keys(siteFilter).length) (where.AND as unknown[]).push(siteFilter)
    // If the caller explicitly asks for a site they can't access → 403
    if (site && !ctx.canAtSite(site, 'VIEW_DEVICES')) {
      return NextResponse.json({ error: `ไม่มีสิทธิ์เข้าถึงข้อมูลของสาขา: ${site}` }, { status: 403 })
    }
    if (site) (where.AND as unknown[]).push({ site })

    if (search) {
      // SUFFIX-AWARE (SEARCH-FIX): for short numeric queries (e.g. "123"),
      // match the SUFFIX of assetCode / serialNumber (operators read the
      // last digits off a sticker). For non-numeric/longer queries, use
      // contains (legacy behavior).
      const { isNumericShortQuery } = await import('@/lib/suffix-search')
      const isShort = isNumericShortQuery(search)
      ;(where.AND as unknown[]).push({
        OR: [
          isShort
            ? { assetCode: { endsWith: search } }
            : { assetCode: { contains: search } },
          isShort
            ? { serialNumber: { endsWith: search } }
            : { serialNumber: { contains: search } },
          { type: { contains: search } },
          { brand: { contains: search } },
          { model: { contains: search } },
          { department: { contains: search } },
        ],
      })
    }
    if (status) (where.AND as unknown[]).push({ status })
    if (deviceType) (where.AND as unknown[]).push({ type: { contains: deviceType } })
    // Exact-match assetNo (takes precedence over search if both are given)
    if (assetNoExact) (where.AND as unknown[]).push({ assetCode: assetNoExact })
    // SERIAL-FIRST (METER-LOOKUP-P0): exact-match serialNumber for QR fallback
    if (serialExact) (where.AND as unknown[]).push({ serialNumber: serialExact })
    // Collapse empty AND
    if (Array.isArray(where.AND) && where.AND.length === 0) delete where.AND

    const [devices, total] = await Promise.all([
      db.device.findMany({
        where,
        skip,
        take: limit,
        orderBy: { assetCode: 'asc' },
        select: {
          ...DEVICE_LIST_FIELDS,
          _count: { select: { meterReadings: true, transfers: true, assignments: true, maintenanceLogs: true } },
          meterReadings: {
            orderBy: { readingDate: 'desc' },
            take: 1,
            select: { readingMonth: true, readingDate: true },
          },
        },
      }),
      db.device.count({ where }),
    ])

    // Annotate each device with `lastReadingMonth` derived from its latest
    // MeterReading record (matches Apps Script's `lastReadingMonth` column).
    const devicesWithMeter = devices.map((d) => {
      const latest = d.meterReadings?.[0]
      const { meterReadings, ...rest } = d
      return {
        ...rest,
        lastReadingMonth: latest?.readingMonth ?? latest?.readingDate?.slice(0, 7) ?? null,
      }
    })

    return NextResponse.json({
      devices: devicesWithMeter,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('GET /api/itam/devices', err)
    return NextResponse.json({ error: 'Failed to fetch devices' }, { status: 500 })
  }
}

// POST /api/itam/devices — create new device (requires DEVICE_EDIT)
export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req, 'DEVICE_EDIT')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row
    // FIX-027: build authorization context for site-scoped permission checks.
    const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)

    const body = await req.json()
    if (!body.assetNo) {
      return NextResponse.json({ error: 'assetNo is required' }, { status: 400 })
    }
    // Site access check on the new device's site — use canAtSite so a user
    // with a viewer grant at the target site (no DEVICE_EDIT) is denied.
    if (body.site && !ctx.canAtSite(body.site, 'DEVICE_EDIT')) {
      return NextResponse.json({ error: `ไม่มีสิทธิ์สร้างอุปกรณ์ในสาขา: ${body.site}` }, { status: 403 })
    }

    const created = await db.device.create({
      data: {
        assetCode: String(body.assetNo).trim(),
        name: body.name || String(body.assetNo).trim(),
        // Device.type is non-nullable in the schema. The UI and every list
        // response call it `type`; only this route expected `deviceType`, so a
        // client sending the obvious field got "Argument `type` must not be
        // null" → 500. Accept both, and fall back to OTHER (the schema's own
        // documented bucket) rather than crashing on a missing field.
        type: body.type || body.deviceType || 'OTHER',
        // brand/model/site are also non-nullable. Previously these were passed
        // straight through as null, which made device creation fail with a 500
        // whenever the form left them blank — the single most common case.
        brand: body.brand || 'UNKNOWN',
        model: body.model || 'UNKNOWN',
        serialNumber: body.serial || null,
        building: body.building || null,
        floor: body.floor || null,
        department: body.department || null,
        location: body.location || null,
        departmentCode: body.departmentCode || null,
        status: body.status || 'Active',
        // Device.site is non-nullable in the schema (branch attribution drives
        // every report), so an omitted site must not reach Prisma as null.
        site: body.site || 'UNASSIGNED',
        contractNo: body.contractNo || null,
        ip: body.ip || null,
        mac: body.mac || null,
        remoteId: body.remoteId || null,
        remark: body.remark || null,
        vendor: body.vendor || null,
        purchaseDate: body.installDate || null,
        uninstallDate: body.uninstallDate || null,
        warrantyEnd: body.warrantyEnd || null,
        deviceGroup: body.deviceGroup || null,
        costCenter: body.costCenter || null,
        meterRequired: body.meterRequired ?? false,
        meterMode: body.meterMode || null,
        assetSiteCode: body.assetSiteCode || null,
        updatedBy: user.username || user.email,
        ...demoTag(auth.user), // FIX-025: tag demo data for safe cleanup
      },
    })

    // Audit log
    try {
      await db.auditLog.create({
        data: {
          action: 'CREATE_DEVICE',
          entity: 'Device',
          entityId: created.id,
          summary: `เพิ่มอุปกรณ์ ${created.assetCode}`,
          actor: user.email, // FIX-026: actor (already present, just documented)
          detail: JSON.stringify({ assetCode: created.assetCode, site: created.site }),
        },
      })
    } catch (err) { console.error('[route]', err) }

    // Best-effort notification
    void notifyDeviceAdded(
      { assetCode: created.assetCode, brand: created.brand, model: created.model },
      user.username || user.email,
    )

    // Push SSE event — other tabs/clients refetch their device list instantly
    publishRealtimeEvent({
      type: 'device-added',
      assetNo: created.assetCode,
      site: created.site ?? null,
      payload: { deviceType: created.type, status: created.status },
    })

    return NextResponse.json({ device: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/itam/devices', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to create device') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
