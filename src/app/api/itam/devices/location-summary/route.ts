import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * GET /api/itam/devices/location-summary
 *
 * Returns the SET of floors and departments that have at least one Device
 * at the given site + building. Used by the Add/Edit Device form to
 * HIGHLIGHT (green) which floors/departments actually exist at a location,
 * so the user doesn't accidentally pick a wrong one — while still allowing
 * them to pick others (in case a department moved to this floor).
 *
 * Query params:
 *   site      — required, site code (e.g. UDH)
 *   building  — required, building name (e.g. "ตึกผู้ป่วยนอก (OPD)")
 *
 * Response: {
 *   floors:       string[],  // distinct floors with devices at site+building
 *   departments:  string[],  // distinct departments with devices at site+building
 *   floorCounts:  Record<string, number>,  // floor → device count
 *   departmentCounts: Record<string, number>, // department → device count
 * }
 *
 * NOTE: Device.site stores Thai site name (not code). We resolve the site
 * code → Thai name via SiteAttribute before querying.
 */
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { searchParams } = new URL(req.url)
    const siteCode = (searchParams.get('site') ?? '').trim()
    const building = (searchParams.get('building') ?? '').trim()

    if (!siteCode || !building) {
      return NextResponse.json(
        { error: 'Missing required params: site, building' },
        { status: 400 },
      )
    }

    // Resolve site code → Thai site name (Device.site stores Thai name).
    const sa = await db.siteAttribute.findUnique({
      where: { SiteCode: siteCode.toUpperCase() },
      select: { SiteName: true },
    })
    const siteName = sa?.SiteName ?? siteCode

    // Query devices at this site + building — group by floor + department + location.
    const rows = await db.device.findMany({
      where: {
        site: siteName,
        building: building,
      },
      select: { floor: true, department: true, location: true },
    })

    const floorSet = new Set<string>()
    const deptSet = new Set<string>()
    const locSet = new Set<string>()
    const floorCounts: Record<string, number> = {}
    const departmentCounts: Record<string, number> = {}
    const locationCounts: Record<string, number> = {}

    for (const r of rows) {
      if (r.floor) {
        floorSet.add(r.floor)
        floorCounts[r.floor] = (floorCounts[r.floor] ?? 0) + 1
      }
      if (r.department) {
        deptSet.add(r.department)
        departmentCounts[r.department] = (departmentCounts[r.department] ?? 0) + 1
      }
      if (r.location) {
        locSet.add(r.location)
        locationCounts[r.location] = (locationCounts[r.location] ?? 0) + 1
      }
    }

    return NextResponse.json({
      floors: Array.from(floorSet).sort(),
      departments: Array.from(deptSet).sort(),
      locations: Array.from(locSet).sort(),
      floorCounts,
      departmentCounts,
      locationCounts,
      total: rows.length,
    })
  } catch (err) {
    console.error('GET /api/itam/devices/location-summary', err)
    return NextResponse.json(
      { error: 'Failed to fetch location summary' },
      { status: 500 },
    )
  }
}
