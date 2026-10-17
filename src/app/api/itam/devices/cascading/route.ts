import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { getAllowedSites } from '@/lib/auth'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * GET /api/itam/devices/cascading
 *
 * Returns distinct values for the next field in the location hierarchy:
 *   site → building → floor → department → location
 *
 * Query params:
 *   field    = 'building' | 'floor' | 'department' | 'location'
 *   site?    = the selected site (filters buildings/floors/etc by devices at this site)
 *   building?
 *   floor?
 *   department?
 *
 * Result: { values: string[] }
 *
 * The values are pulled from BOTH:
 *   1. Existing Device rows (distinct, ordered by usage count desc — most-common first)
 *   2. Master_Items (when field=department, additionally returns Master_Items.Department values)
 *
 * Site-level security: only values from sites the user can access are returned.
 */
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req, 'VIEW_DEVICES')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row

    const { searchParams } = new URL(req.url)
    const field = (searchParams.get('field')?.trim() ?? '') as
      | 'building'
      | 'floor'
      | 'department'
      | 'location'
    if (!['building', 'floor', 'department', 'location'].includes(field)) {
      return NextResponse.json({ error: 'Invalid field' }, { status: 400 })
    }
    const site = searchParams.get('site')?.trim() ?? ''
    const building = searchParams.get('building')?.trim() ?? ''
    const floor = searchParams.get('floor')?.trim() ?? ''
    const department = searchParams.get('department')?.trim() ?? ''

    // Site-level filter
    const userSites = getAllowedSites(user)
    const siteWhere: Record<string, unknown> = {}
    if (userSites !== 'ALL') {
      siteWhere.site = { in: userSites }
    }
    if (site) siteWhere.site = site
    if (building) siteWhere.building = building
    if (floor) siteWhere.floor = floor
    if (department) siteWhere.department = department

    // 1) Pull distinct values from existing devices — most-common first
    const rows = await db.device.findMany({
      where: {
        ...siteWhere,
        NOT: { [field]: null },
      },
      select: { [field]: true } as Record<string, true>,
    })
    const counts = new Map<string, number>()
    for (const r of rows) {
      const v = String((r as unknown as Record<string, string | null>)[field] ?? '').trim()
      if (!v) continue
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    const fromDevices = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([v]) => v)

    // 2) For department field, also include Master_Items (Department category)
    let fromMaster: string[] = []
    if (field === 'department') {
      const masterWhere: Record<string, unknown> = { category: 'Department', active: true }
      // TODO: MasterItem.allowedSites column was removed in the new schema;
      // site-level scoping for master items is no longer applied here.
      const masterItems = await db.masterItem.findMany({
        where: masterWhere,
        select: { label: true },
        orderBy: { label: 'asc' },
      })
      fromMaster = masterItems.map((m) => m.label).filter((v) => v && !counts.has(v))
    }

    // Merge, preserving order, dedup
    const merged = new Set<string>([...fromDevices, ...fromMaster])
    const values = Array.from(merged)

    return NextResponse.json({ values, counts: Object.fromEntries(counts) })
  } catch (err) {
    console.error('GET /api/itam/devices/cascading', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
