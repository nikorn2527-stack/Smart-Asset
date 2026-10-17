import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { previewNextNumber } from '@/lib/numbering-engine'

/**
 * GET /api/devices/next-asset-code
 *
 * พรีวิวเลขทะเบียนถัดไป (ไม่กินเลข):
 *   1) ถ้ามี NumberingScheme (device) ที่ active → ใช้ Flexible Numbering Engine
 *      รองรับ query: type, site, purchaseDate, departmentCode, categoryCode
 *      เช่น /api/devices/next-asset-code?type=PRINTER&purchaseDate=2026-09-17
 *      → 001-201-2569-00001
 *   2) มิฉะนั้น fallback เป็นเลขลำดับเดิม (MAX integer assetCode + 1)
 *
 * Response: { code: string, engine?: 'numbering' | 'legacy', ... }
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

    // ── 1) Flexible Numbering Engine (ถ้ามี scheme ที่ active) ──
    const numberingCode = await previewNextNumber('device', {
      type: searchParams.get('type'),
      site: searchParams.get('site'),
      purchaseDate: searchParams.get('purchaseDate'),
      departmentCode: searchParams.get('departmentCode'),
      categoryCode: searchParams.get('categoryCode'),
    })
    if (numberingCode) {
      return NextResponse.json({
        code: numberingCode,
        engine: 'numbering',
      })
    }

    // ── 2) Legacy: MAX(integerAssetCode) + 1 ──
    // Fetch every assetCode in the Device table and find the max integer.
    // We avoid a raw SQL CAST because some codes are non-numeric and would
    // throw. Client-side parsing is O(N) but N is bounded (~3k devices).
    const rows = await db.device.findMany({
      select: { assetCode: true },
    })
    let max = 0
    for (const r of rows) {
      const v = parseInt(String(r.assetCode ?? '').trim(), 10)
      if (Number.isFinite(v) && v > max) max = v
    }
    const next = max + 1

    const prefix = (searchParams.get('prefix') ?? '').trim()
    const code = prefix
      ? `${prefix}${String(next).padStart(4, '0')}`
      : String(next)

    return NextResponse.json({
      code,
      next,
      max,
      prefix: prefix || null,
      engine: 'legacy',
    })
  } catch (err) {
    console.error('GET /api/devices/next-asset-code', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to compute next asset code') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
