import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { getOrgScope } from '@/lib/org-scope'

// GET /api/itam/master-items?category=
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req, 'VIEW_DEVICES')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // ── Organization scope (Phase 1 multi-org) ──
    // MasterItem returns BOTH org-specific + global template rows.
    // Global rows have organizationId = null OR match the user's org.
    const orgScope = getOrgScope(auth.user)
    if (!orgScope.ok) return NextResponse.json({ error: orgScope.error.message }, { status: orgScope.error.status })

    const { searchParams } = new URL(req.url)
    const category = searchParams.get('category')?.trim() ?? ''
    const where: Record<string, unknown> = {
      OR: [
        { organizationId: orgScope.organizationId }, // org-specific
        { organizationId: null }, // global template
      ],
    }
    if (category) where.category = category
    const items = await db.masterItem.findMany({ where, orderBy: { label: 'asc' } })
    return NextResponse.json({ items })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// POST — create master item (requires MASTER_DATA_EDIT)
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req, 'MASTER_DATA_EDIT')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row

    const body = await req.json()
    if (!body.categoryKey || !body.value) {
      return NextResponse.json({ error: 'categoryKey and value required' }, { status: 400 })
    }
    const created = await db.masterItem.create({
      data: {
        category: body.categoryKey,
        code: body.code || body.value,
        label: body.value,
        // TODO: itemId / groupName / allowedSites / departmentCode columns were removed in the new schema.
        parentRef: body.parentRef || null,
        displayLabel: body.displayLabel || null,
        siteCode: body.siteCode || null,
        active: body.active ?? true,
      },
    })

    try {
      await db.auditLog.create({
        data: {
          action: 'MASTER_DATA_EDIT',
          entity: 'MasterItem',
          entityId: created.id,
          summary: `เพิ่มข้อมูลมาตรฐาน ${body.categoryKey}: ${body.value}`,
          actor: user.email,
          detail: JSON.stringify({ category: body.categoryKey, label: body.value }),
        },
      })
    } catch (err) { console.error('[route]', err) }

    return NextResponse.json({ item: created }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
