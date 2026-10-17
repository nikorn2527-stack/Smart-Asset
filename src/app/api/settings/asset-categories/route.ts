import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { logAudit } from '@/lib/audit'

/**
 * GET /api/settings/asset-categories
 * POST /api/settings/asset-categories
 *
 * CRUD for AssetCategory — manages depreciation policy per asset type.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, 'VIEW_DASHBOARD')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const categories = await db.assetCategory.findMany({
    orderBy: { code: 'asc' },
  })
  return NextResponse.json({ categories })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await req.json()
    const code = String(body.code || '').trim().toUpperCase()
    if (!code) return NextResponse.json({ error: 'กรุณาระบุรหัสหมวดหมู่' }, { status: 400 })

    const existing = await db.assetCategory.findUnique({ where: { code } })
    if (existing) return NextResponse.json({ error: 'รหัสซ้ำ' }, { status: 409 })

    const cat = await db.assetCategory.create({
      data: {
        code,
        name: String(body.name || code),
        usefulLifeYears: Number(body.usefulLifeYears) || 5,
        depreciationMethod: String(body.depreciationMethod || 'STRAIGHT_LINE'),
        decliningRate: body.decliningRate ? Number(body.decliningRate) : null,
        minCapitalizeValue: body.minCapitalizeValue ? Number(body.minCapitalizeValue) : 10000,
        salvageValuePct: body.salvageValuePct ? Number(body.salvageValuePct) : 0,
        active: body.active !== false,
      },
    })

    await logAudit('CREATE', 'AssetCategory', cat.id, `สร้างหมวดหมู่สินทรัพย์ ${cat.code} (${cat.name})`, { code, name: cat.name })
    return NextResponse.json({ category: cat }, { status: 201 })
  } catch (err) {
    console.error('POST /api/settings/asset-categories', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
