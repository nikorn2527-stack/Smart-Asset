import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { siteFilterForUser } from '@/lib/auth'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// ════════════════════════════════════════════════════════════════════════
// METER ROUTE DECISION (Phase 4.6) — see /api/meter/route.ts header.
// This file is the REMINDER branch of the legacy `/api/meter/*` tree:
//   • GET /api/meter/reminders  — finds meter-required devices that have
//     NOT been read in the currently active cycle (countdown list).
//
// It is intentionally kept separate from the main CRUD surface at
// /api/itam/meter-readings/* and from the v1 external API at
// /api/v1/meter-readings/*. DO NOT merge — different concerns, different
// response shapes.
// ════════════════════════════════════════════════════════════════════════

/**
 * Meter reminders endpoint.
 *
 * Finds meter-required devices (`Device.meterRequired = true`) that have NOT
 * been read in the currently active cycle.
 *
 * NOTE: Schema field renames applied to match the actual PostgreSQL DB:
 *   - `Device.assetCode`       (was assetNo)
 *   - `Device.type`             (was deviceType)
 *   - `Device.name`             (now a stored field; was brand+model)
 *   - `Device.purchaseDate`     (was installDate)
 *   - `MeterReading.assetCode`  (was assetNo)
 *   - `MeterReading.readingDate` (was date)
 *   - cycleId is not stored on MeterReading; associate via the cycle's
 *     [startDate, endDate] window.
 *
 * The response preserves the legacy shape used by both `meter-page.tsx` and
 * `dashboard-page.tsx` (`hasActiveCycle`, `cycle`, `reminders`,
 * `totalRead`, `totalUnread`) AND adds the spec's `count` field for
 * convenience.
 */

interface ReminderDevice {
  id: string
  assetCode: string
  name: string
  type: string | null
  brand: string | null
  model: string | null
  site: string | null
  lastMeterReading: number
}

interface ReminderEntry {
  device: ReminderDevice
  lastReadingDate: string | null
  daysOverdue: number
}

/** Build a display name from brand + model (falls back to assetCode). */
function deviceName(d: {
  brand: string | null
  model: string | null
  assetCode: string
}): string {
  if (d.brand && d.model) return `${d.brand} ${d.model}`.trim()
  if (d.brand) return d.brand
  if (d.model) return d.model
  return d.assetCode
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/
const MAX_REMINDER_DEVICES = 10_000

function daysBetween(a: string, b: string): number {
  const aD = new Date(a.slice(0, 10) + 'T00:00:00')
  const bD = new Date(b.slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(aD.getTime()) || Number.isNaN(bD.getTime())) return 0
  return Math.round((bD.getTime() - aD.getTime()) / (1000 * 60 * 60 * 24))
}

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('meters')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req, 'VIEW_DEVICES')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row
    // 1. Find the active cycle (legacy cycles use status 'active'; new V5
    //    cycles may use 'OPEN'). Match both so we work regardless of which
    //    UI created the cycle. Order by startDate desc so the most recent
    //    wins if there are somehow two.
    const activeCycle = await db.cycle.findFirst({
      where: { status: { in: ['active', 'OPEN'] } },
      orderBy: { startDate: 'desc' },
    })

    if (!activeCycle) {
      return NextResponse.json({
        hasActiveCycle: false,
        cycle: null,
        reminders: [],
        totalRead: 0,
        totalUnread: 0,
        count: 0,
      })
    }

    // 2. Find meter-required devices only inside the authenticated user's
    //    site scope. The cap prevents an accidental unbounded reminder query.
    const deviceWhere: Record<string, unknown> = { meterRequired: true }
    const siteFilter = siteFilterForUser(user)
    if (Object.keys(siteFilter).length) {
      Object.assign(deviceWhere, siteFilter)
    }
    const devices = await db.device.findMany({
      where: deviceWhere,
      take: MAX_REMINDER_DEVICES,
      orderBy: { assetCode: 'asc' },
      select: {
        id: true,
        assetCode: true,
        type: true,
        brand: true,
        model: true,
        site: true,
        purchaseDate: true,
        updatedAt: true,
      },
    })

    // 3. Restrict readings to the device set and aggregate in PostgreSQL.
    //    This avoids loading every reading in the cycle into Node memory.
    const assetCodes = devices.map((device) => device.assetCode)
    const readings = assetCodes.length === 0
      ? []
      : await db.meterReading.groupBy({
          by: ['assetCode'],
          where: {
            assetCode: { in: assetCodes },
            readingDate: {
              gte: activeCycle.startDate,
              lte: activeCycle.endDate,
            },
          },
          _max: { readingDate: true },
        })

    const readAssetMap = new Map<string, string>()
    for (const reading of readings) {
      if (reading.assetCode && reading._max.readingDate) {
        readAssetMap.set(reading.assetCode, reading._max.readingDate)
      }
    }

    // 4. Build reminders: every meter-required device that does NOT appear
    //    in `readAssetMap` is "unread this cycle".
    const todayISO = new Date().toISOString().slice(0, 10)
    const reminders: ReminderEntry[] = devices
      .filter((d) => !readAssetMap.has(d.assetCode))
      .map((d) => {
        // Reference date for "days overdue": use the cycle's start date if
        // known (the cycle has been open since then) — fall back to the
        // device's purchaseDate / updatedAt. This matches the spirit of the
        // original route (which used createdAt) while being cycle-aware.
        const referenceDate =
          (activeCycle.startDate && DATE_RE.test(activeCycle.startDate)
            ? activeCycle.startDate.slice(0, 10)
            : null) ??
          (d.purchaseDate && DATE_RE.test(d.purchaseDate)
            ? d.purchaseDate!.slice(0, 10)
            : null) ??
          d.updatedAt.toISOString().slice(0, 10)

        const daysOverdue = Math.max(0, daysBetween(referenceDate, todayISO))
        return {
          device: {
            id: d.id,
            assetCode: d.assetCode,
            name: deviceName(d),
            type: d.type,
            brand: d.brand,
            model: d.model,
            site: d.site,
            // `lastMeterReading` is not a stored field; we expose the latest
            // reading's meter value here if we had it, but the frontend only
            // uses this for display in the meter table (which already has
            // its own device list with `lastMeterReading` from /api/devices).
            // 0 is safe.
            lastMeterReading: 0,
          },
          lastReadingDate: null,
          daysOverdue,
        }
      })

    const totalRead = devices.length - reminders.length
    const totalUnread = reminders.length

    return NextResponse.json({
      hasActiveCycle: true,
      cycle: {
        id: activeCycle.id,
        name: activeCycle.name,
        startDate: activeCycle.startDate,
        endDate: activeCycle.endDate,
        status: activeCycle.status,
      },
      reminders,
      totalRead,
      totalUnread,
      // Spec-shape convenience field.
      count: totalUnread,
    })
  } catch (err) {
    console.error('GET /api/meter/reminders', err)
    return NextResponse.json(
      { error: 'Failed to fetch meter reminders' },
      { status: 500 },
    )
  }
}
