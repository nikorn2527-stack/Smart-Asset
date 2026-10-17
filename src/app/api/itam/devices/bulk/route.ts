import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * POST /api/itam/devices/bulk
 *
 * Bulk-edit multiple devices in a single transaction. The body contains:
 *   {
 *     assetNos: string[],          // devices to update
 *     patch: {
 *       status?, site?, building?, floor?, department?,
 *       departmentCode?, location?, deviceGroup?, costCenter?,
 *       meterRequired?, meterMode?, vendor?, contractNo?, remark?
 *     }
 *   }
 *
 * - Site access checked on each device before update
 * - Empty/null values in patch are skipped (only set fields are applied)
 * - Returns { updated: number, skipped: number, errors: [...] }
 *
 * Permission: DEVICE_EDIT
 */
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
    const assetNos: string[] = Array.isArray(body.assetNos) ? body.assetNos : []
    const patch: Record<string, unknown> = body.patch ?? {}
    if (assetNos.length === 0) {
      return NextResponse.json({ error: 'assetNos[] required' }, { status: 400 })
    }
    if (assetNos.length > 500) {
      return NextResponse.json({ error: 'Too many devices (max 500)' }, { status: 400 })
    }
    // Whitelisted patch fields
    const ALLOWED = new Set([
      'status', 'site', 'building', 'floor', 'department', 'departmentCode',
      'location', 'deviceGroup', 'costCenter', 'meterRequired', 'meterMode',
      'vendor', 'contractNo', 'remark',
    ])
    const cleanPatch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) {
      if (!ALLOWED.has(k)) continue
      if (v === null || v === undefined || v === '') continue
      cleanPatch[k] = v
    }
    if (Object.keys(cleanPatch).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // Site-access check on the patch's target site (if site is being changed)
    // Use canAtSite so a viewer at the target site (no DEVICE_EDIT) is denied.
    if (cleanPatch.site && !ctx.canAtSite(String(cleanPatch.site), 'DEVICE_EDIT')) {
      return NextResponse.json(
        { error: `ไม่มีสิทธิ์ย้ายอุปกรณ์ไปสาขา: ${cleanPatch.site}` },
        { status: 403 },
      )
    }

    let updated = 0
    let skipped = 0
    const errors: Array<{ assetNo: string; error: string }> = []
    const updatedBy = user.username || user.email

    // Fetch all target devices first (for site-access checks).
    // NOTE: the request body keeps the legacy `assetNos` key, but the Device
    // column it is matched against is `assetCode`.
    const targets = await db.device.findMany({
      where: { assetCode: { in: assetNos } },
      select: { assetCode: true, site: true },
    })
    const targetMap = new Map(targets.map((t) => [t.assetCode, t.site]))

    for (const assetNo of assetNos) {
      const site = targetMap.get(assetNo)
      if (site === undefined) {
        errors.push({ assetNo, error: 'not found' })
        skipped++
        continue
      }
      if (!ctx.canAtSite(site, 'DEVICE_EDIT')) {
        errors.push({ assetNo, error: 'no site access' })
        skipped++
        continue
      }
      try {
        await db.device.update({
          where: { assetCode: assetNo },
          data: { ...cleanPatch, updatedBy },
        })
        updated++
      } catch (err) {
        const msg = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'failed') : 'Internal server error'
        errors.push({ assetNo, error: msg })
        skipped++
      }
    }

    // Single audit entry summarizing the bulk action
    try {
      await db.auditLog.create({
        data: {
          action: 'BULK_UPDATE_DEVICES',
          entity: 'Device',
          entityId: null,
          summary: `อัปเดตอุปกรณ์หลายเครื่อง: ${updated} สำเร็จ, ${skipped} ข้าม (รวม ${assetNos.length})`,
          detail: JSON.stringify({
            count: assetNos.length,
            updated,
            skipped,
            patch: cleanPatch,
          }),
          actor: user.email,
        },
      })
    } catch (err) { console.error('[route]', err) }

    return NextResponse.json({ updated, skipped, errors, total: assetNos.length })
  } catch (err) {
    console.error('POST /api/itam/devices/bulk', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
