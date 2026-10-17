/**
 * /api/master — unified master-data API.
 *
 * GET (cascading lookups via `?type=…`):
 *   ?type=device-types
 *   ?type=brands&typeId=X
 *   ?type=models&brandId=X
 *   ?type=buildings&site=UDH                       (site-scoped)
 *   ?type=floors&site=UDH&building=X              (site-scoped)
 *   ?type=departments&site=UDH&building=X&floor=Y (site-scoped)
 *   ?type=locations&site=UDH                       (site-scoped)
 *   ?type=device-groups                           (global)
 *   ?type=statuses                                (global)
 *
 * GET (legacy MasterItem lookup via `?category=…`):
 *   ?category=Brand|Type|Model|Department|Status|DeviceGroup|Site|Building|Floor
 *   → returns { items: MasterItem[] }
 *
 * GET (no params) → returns all MasterItem rows (legacy).
 *
 * POST (legacy — used by MasterDataModal): create a MasterItem row.
 *
 * Authentication: requireAuth (Bearer token).
 * Site scoping:
 *   - device-types, brands, models, device-groups, statuses → NOT scoped (global).
 *   - buildings, floors, departments, locations → scoped to user's allowedSites
 *     unless the explicit `site` query param is set (then validated against scope).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { logAudit } from '@/lib/audit'
import { parseAllowedSites, normalizeSiteCode } from '@/lib/site-scope'
import { buildAuthorizationContext } from '@/lib/authorization-context'

// Cache master data for 5 minutes — it changes infrequently.
// This reduces DB load significantly since the device form, sidebar,
// and multiple pages all fetch master data on every load.
export const revalidate = 300

// ─────────────────────────────────────────────────────────────
// GET handler
// ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    // SPRINT-2 #5 (AUDIT-API-001 #081): build AuthorizationContext so
    // site-scoped queries (buildings, floors, departments) verify the
    // user has VIEW_DEVICES at that specific site, not just membership.
    const ctx = await buildAuthorizationContext(
      auth.user,
      auth.row.id,
      auth.row.allowedSites,
    )

    const { searchParams } = new URL(req.url)
    const type = (searchParams.get('type') ?? '').trim()
    const category = (searchParams.get('category') ?? '').trim()
    const site = normalizeSiteCode(searchParams.get('site'))
    const typeId = (searchParams.get('typeId') ?? '').trim() || null
    const brandId = (searchParams.get('brandId') ?? '').trim() || null
    const building = (searchParams.get('building') ?? '').trim() || null
    const floor = (searchParams.get('floor') ?? '').trim() || null
    const groupCode = (searchParams.get('groupCode') ?? '').trim() || null

    // ── Legacy path: `?category=…` or no `type` ──
    // Returns all MasterItem rows matching the optional category filter.
    if (!type) {
      const where: Record<string, unknown> = {}
      if (category) where.category = category
      const items = await db.masterItem.findMany({
        where,
        orderBy: [{ category: 'asc' }, { code: 'asc' }],
      })
      return NextResponse.json({ items })
    }

    // ── Compute the user's site scope (for site-scoped queries) ──
    const parsed = parseAllowedSites(auth.user.allowedSites)
    const isAllSites = parsed.isAll

    /** Resolve the effective site code: explicit `?site=` wins, but must be
     *  inside the user's scope (unless superadmin/ALL). */
    function resolveSite(): string | null {
      if (site) {
        if (!isAllSites && !parsed.codes.includes(site)) {
          return '__FORBIDDEN__' // signal 403
        }
        return site
      }
      // No explicit site param → return null (caller decides what to do)
      return null
    }

    switch (type) {
      case 'device-types': {
        // Pull distinct DeviceType values from DeviceClassification MasterItem rows.
        const rows = await db.masterItem.findMany({
          where: { category: 'DeviceClassification', active: true },
          select: { deviceType: true },
        })
        const types = new Set<string>()
        for (const r of rows) {
          if (r.deviceType) types.add(r.deviceType)
        }
        const items = Array.from(types).sort().map((name) => ({ name, active: true }))
        return NextResponse.json({ items, type })
      }

      case 'brands': {
        // Pull distinct Brand values from DeviceClassification MasterItem rows.
        // Optional typeId filter is the DeviceType name.
        const rows = await db.masterItem.findMany({
          where: { category: 'DeviceClassification', active: true },
          select: { brand: true, deviceType: true },
        })
        const brandSet = new Set<string>()
        for (const r of rows) {
          if (r.brand) {
            if (!typeId || r.deviceType === typeId) {
              brandSet.add(r.brand)
            }
          }
        }
        const items = Array.from(brandSet).sort().map((name) => ({ name, active: true }))
        return NextResponse.json({ items, type })
      }

      case 'models': {
        // Pull Model values from DeviceClassification MasterItem rows.
        // Optional brandId filter is the Brand name.
        const rows = await db.masterItem.findMany({
          where: { category: 'DeviceClassification', active: true },
          select: { model: true, brand: true, deviceType: true },
        })
        const models: Array<{ name: string; brand?: string; deviceType?: string }> = []
        for (const r of rows) {
          if (r.model) {
            if (!brandId || r.brand === brandId) {
              models.push({ name: r.model, brand: r.brand ?? undefined, deviceType: r.deviceType ?? undefined })
            }
          }
        }
        return NextResponse.json({ items: models, type })
      }

      case 'repair-groups': {
        // Pull from MasterItem category='RepairGroup'
        const items = await db.masterItem.findMany({
          where: { category: 'RepairGroup' },
          orderBy: { code: 'asc' },
          select: { id: true, code: true, label: true, displayLabel: true, active: true },
        })
        const formatted = items.map((i) => ({
          code: i.code,
          label: i.label,
          active: i.active,
        }))
        return NextResponse.json({ items: formatted, type })
      }

      case 'repair-problems': {
        // Pull from MasterItem category='RepairRequest'
        // Optional groupCode filter (matches parentRef field)
        const where: Record<string, unknown> = { category: 'RepairRequest' }
        if (groupCode) {
          where.parentRef = groupCode
        }
        const items = await db.masterItem.findMany({
          where,
          orderBy: [{ parentRef: 'asc' }, { code: 'asc' }],
          select: { id: true, code: true, label: true, parentRef: true, displayLabel: true, active: true },
        })
        const formatted = items.map((i) => ({
          code: i.code,
          label: i.label,
          groupCode: i.parentRef,
          active: i.active,
        }))
        return NextResponse.json({ items: formatted, type })
      }

      case 'repair-resolutions': {
        // Pull from MasterItem category='RepairResolution'
        // Optional groupCode filter (matches parentRef field)
        const where: Record<string, unknown> = { category: 'RepairResolution' }
        if (groupCode) {
          where.parentRef = groupCode
        }
        const items = await db.masterItem.findMany({
          where,
          orderBy: [{ parentRef: 'asc' }, { code: 'asc' }],
          select: { id: true, code: true, label: true, parentRef: true, displayLabel: true, active: true },
        })
        const formatted = items.map((i) => ({
          code: i.code,
          label: i.label,
          groupCode: i.parentRef,
          active: i.active,
        }))
        return NextResponse.json({ items: formatted, type })
      }

      case 'buildings': {
        // Pull from MasterItem(category='Building') instead of Device table.
        // Device.site stores Thai text (e.g. "ชื่อสาขา (e.g. สำนักงานใหญ่)") not site codes (e.g. "UDH").
        // MasterItem has siteCode field that matches site codes.
        const effectiveSite = resolveSite()
        if (effectiveSite === '__FORBIDDEN__') {
          return NextResponse.json(
            { error: 'Site out of scope' },
            { status: 403 },
          )
        }
        const where: Record<string, unknown> = { category: 'Building', active: true }
        if (effectiveSite) {
          where.OR = [{ siteCode: effectiveSite }, { siteCode: 'ALL' }]
        }
        const rows = await db.masterItem.findMany({
          where,
          select: { label: true },
          orderBy: { label: 'asc' },
        })
        const items = rows.map((r) => r.label).filter(Boolean)
        return NextResponse.json({ items, type })
      }

      case 'floors': {
        // Pull from MasterItem(category='Floor') — floors are global (not site-scoped).
        const rows = await db.masterItem.findMany({
          where: { category: 'Floor', active: true },
          select: { label: true },
          orderBy: { label: 'asc' },
        })
        const items = rows.map((r) => r.label).filter(Boolean)
        return NextResponse.json({ items, type })
      }

      case 'departments': {
        // Pull from MasterItem(category='Department') with optional parentRef filter (Affiliation).
        const where: Record<string, unknown> = { category: 'Department', active: true }
        if (building) {
          // 'building' param is actually used as parentRef (Affiliation code) for filtering
          where.parentRef = building
        }
        const rows = await db.masterItem.findMany({
          where,
          select: { label: true, code: true },
          orderBy: { label: 'asc' },
        })
        const items = rows.map((r) => r.label).filter(Boolean)
        return NextResponse.json({ items, type })
      }

      case 'locations': {
        const effectiveSite = resolveSite()
        if (effectiveSite === '__FORBIDDEN__') {
          return NextResponse.json(
            { error: 'Site out of scope' },
            { status: 403 },
          )
        }
        const whereSite: Record<string, unknown> = {}
        if (effectiveSite) {
          whereSite.site = effectiveSite
        } else if (!isAllSites) {
          whereSite.site = { in: parsed.codes }
        }
        const rows = await db.device.findMany({
          where: {
            ...whereSite,
            NOT: { OR: [{ location: null }, { location: '' }] },
          },
          distinct: ['location'],
          select: { location: true },
          orderBy: { location: 'asc' },
        })
        const items = rows
          .map((r) => r.location)
          .filter((l): l is string => Boolean(l))
        return NextResponse.json({ items, type })
      }

      case 'device-groups': {
        const rows = await db.device.findMany({
          where: {
            NOT: { OR: [{ deviceGroup: null }, { deviceGroup: '' }] },
          },
          distinct: ['deviceGroup'],
          select: { deviceGroup: true },
          orderBy: { deviceGroup: 'asc' },
        })
        const items = rows
          .map((r) => r.deviceGroup)
          .filter((g): g is string => Boolean(g))
        return NextResponse.json({ items, type })
      }

      case 'statuses': {
        const rows = await db.device.findMany({
          where: {
            NOT: { status: '' },
          },
          distinct: ['status'],
          select: { status: true },
          orderBy: { status: 'asc' },
        })
        const items = rows
          .map((r) => r.status)
          .filter((s): s is string => Boolean(s))
        return NextResponse.json({ items, type })
      }

      default:
        return NextResponse.json(
          { error: `Unknown type: ${type || '(empty)'}` },
          { status: 400 },
        )
    }
  } catch (err) {
    console.error('GET /api/master', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to fetch master') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────
// POST handler — legacy MasterItem create (used by MasterDataModal)
// Preserved for backward compatibility.
// ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, 'MASTER_DATA_EDIT')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const body = await req.json()
    if (!body.category || !body.code || !body.label) {
      return NextResponse.json(
        { error: 'Missing required fields: category, code, label' },
        { status: 400 },
      )
    }
    const created = await db.masterItem.create({
      data: {
        category: String(body.category).trim(),
        code: String(body.code).trim(),
        label: String(body.label).trim(),
        parentRef: body.parentRef ? String(body.parentRef).trim() : null,
        displayLabel: body.displayLabel ? String(body.displayLabel).trim() : null,
        siteCode: body.siteCode ? String(body.siteCode).trim() : null,
      },
    })
    await logAudit(
      'CREATE',
      'MasterItem',
      created.id,
      `เพิ่มข้อมูลมาตรฐาน ${created.category}: ${created.code} (${created.label})`,
      { category: created.category, code: created.code, label: created.label },
    )
    return NextResponse.json({ item: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/master', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to create master item') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
