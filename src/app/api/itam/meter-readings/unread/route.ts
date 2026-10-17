import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { siteFilterForUser } from '@/lib/auth'
import { matchesSuffixOrContains, isNumericShortQuery } from '@/lib/suffix-search'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * GET /api/itam/meter-readings/unread
 *
 * Returns the list of devices that:
 *   • have meterRequired = true
 *   • status = 'Active'
 *   • belong to a site the caller can access (row-level security)
 *   • have NO MeterReading for the current month (readingMonth = YYYY-MM)
 *
 * Also returns the count of devices already read this month so the UI can
 * show a progress bar "จดแล้ว X / ทั้งหมด Y (เหลือ Z)".
 *
 * Query params:
 *   ?month=YYYY-MM   override "current month" (defaults to today's month)
 *   ?search=         filter the unread list by assetNo/serial/brand/model/department
 *   ?limit=          page size (default 50, max 500 — keyboard page wants a long list)
 *   ?includeRead=1   include already-read devices at the bottom (for the
 *                    keyboard page's "Recently keyed" sidebar)
 */
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('meters')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req, 'VIEW_DEVICES')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row

    const { searchParams } = new URL(req.url)
    const now = new Date()
    const month =
      searchParams.get('month')?.trim() ||
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const search = searchParams.get('search')?.trim() ?? ''
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '100', 10)))
    const includeRead = searchParams.get('includeRead') === '1'

    // Site-level filter
    const siteFilter = siteFilterForUser(user)

    // The "eligible" set = meterRequired AND Active AND site-allowed.
    const eligibleWhere: Record<string, unknown> = {
      AND: [
        { meterRequired: true },
        { status: 'Active' },
        ...(Object.keys(siteFilter).length ? [siteFilter] : []),
      ],
    }

    // All meter readings for these devices in the target month.
    // We pull just assetCode + the most recent reading per device so we can:
    //   - decide if the device is "read this month"
    //   - show the last meter value to the user (so they can compute the delta)
    const readingsThisMonth = await db.meterReading.findMany({
      where: { readingMonth: month, device: eligibleWhere },
      select: {
        assetCode: true,
        meterBw: true,
        meterColor: true,
        readingDate: true,
        readBy: true,
      },
      orderBy: { readingDate: 'desc' },
    })

    // Build a "latest reading per assetCode" map (the query above is ordered
    // desc so the first occurrence wins).
    const readMap = new Map<
      string,
      { meterBw: number; meterColor: number; readingDate: string | null; readBy: string | null }
    >()
    for (const r of readingsThisMonth) {
      if (!readMap.has(r.assetCode || '')) {
        readMap.set(r.assetCode || '', {
          meterBw: r.meterBw,
          meterColor: r.meterColor,
          readingDate: r.readingDate,
          readBy: r.readBy,
        })
      }
    }

    // We also want the LAST EVER meter reading for each device (so we can
    // prefill the prev value on the keyboard page). Pull them in a second
    // query grouped by assetCode using findMany + processing.
    const lastReadingsAll = await db.meterReading.findMany({
      where: { device: eligibleWhere },
      orderBy: { readingDate: 'desc' },
      select: {
        assetCode: true,
        meterBw: true,
        meterColor: true,
        readingDate: true,
      },
      take: 5000, // generous cap to keep memory bounded
    })
    const lastMap = new Map<
      string,
      { meterBw: number; meterColor: number; readingDate: string | null }
    >()
    for (const r of lastReadingsAll) {
      if (!lastMap.has(r.assetCode || '')) {
        lastMap.set(r.assetCode || '', {
          meterBw: r.meterBw,
          meterColor: r.meterColor,
          readingDate: r.readingDate,
        })
      }
    }

    // Total eligible (denominator for the progress bar).
    const totalEligible = await db.device.count({ where: eligibleWhere })
    const totalRead = readMap.size
    const totalUnread = Math.max(0, totalEligible - totalRead)

    // Pull all eligible devices (we'll filter in JS so we can join lastReading
    // without paying for N+1 queries).
    const devices = await db.device.findMany({
      where: eligibleWhere,
      select: {
        id: true,
        assetCode: true,
        type: true,
        brand: true,
        model: true,
        serialNumber: true,
        site: true,
        building: true,
        floor: true,
        department: true,
        departmentCode: true,
        location: true,
        meterMode: true,
        meterRequired: true,
        assetSiteCode: true,
      },
      orderBy: { assetCode: 'asc' },
    })

    // Apply search filter.
    // ── SUFFIX-AWARE SEARCH (USER-FEEDBACK, now using shared helper) ──
    // Numeric short queries (1-6 digits): match the SUFFIX of identifier
    // fields (assetCode, serialNumber, assetSiteCode). Non-numeric/longer:
    // legacy contains match everywhere.
    const filtered = search
      ? devices.filter((d) => {
          if (isNumericShortQuery(search)) {
            // Identifier fields → suffix match
            if (matchesSuffixOrContains(d.assetCode, search)) return true
            if (matchesSuffixOrContains(d.serialNumber, search)) return true
            if (matchesSuffixOrContains(d.assetSiteCode, search)) return true
            // Text fields → contains match (legacy behavior for these fields)
            const searchLower = search.toLowerCase()
            return [d.brand, d.model, d.department, d.type]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(searchLower))
          }
          // Non-numeric / long → contains everywhere.
          const searchLower = search.toLowerCase()
          return [d.assetCode, d.serialNumber, d.brand, d.model, d.department, d.type, d.assetSiteCode]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(searchLower))
        })
      : devices

    // Mark each device read/unread.
    const enriched = filtered.map((d) => {
      const read = readMap.get(d.assetCode)
      const last = lastMap.get(d.assetCode)
      return {
        ...d,
        readThisMonth: !!read,
        readAt: read?.readingDate ?? null,
        readBy: read?.readBy ?? null,
        lastMeterBw: last?.meterBw ?? 0,
        lastMeterColor: last?.meterColor ?? 0,
        lastReadingDate: last?.readingDate ?? null,
      }
    })

    // Sort: unread first (so the keyboard page can land on them), then by assetCode.
    enriched.sort((a, b) => {
      if (a.readThisMonth !== b.readThisMonth) return a.readThisMonth ? 1 : -1
      return a.assetCode.localeCompare(b.assetCode)
    })

    // Optionally trim to `limit` unread + (if includeRead) up to 20 recently-read.
    const unreadList = enriched.filter((d) => !d.readThisMonth)
    const readList = enriched.filter((d) => d.readThisMonth)
    const trimmedUnread = unreadList.slice(0, limit)
    const trimmedRead = includeRead ? readList.slice(0, 20) : []

    return NextResponse.json({
      month,
      total: totalEligible,
      read: totalRead,
      unread: totalUnread,
      devices: includeRead ? [...trimmedUnread, ...trimmedRead] : trimmedUnread,
    })
  } catch (err) {
    console.error('GET /api/itam/meter-readings/unread', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
