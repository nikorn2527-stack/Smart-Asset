import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { getOrgScope } from '@/lib/org-scope'
import { siteFilterForUser } from '@/lib/auth'
import { demoFilter } from '@/lib/demo-mode'
import { logAudit } from '@/lib/audit'
import { isNumericShortQuery } from '@/lib/suffix-search'
import { toCompatStockItem } from '@/lib/stock-compat'
import { withRetryOnUnique } from '@/lib/retry-unique'
import { demoTag } from '@/lib/demo-mode'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { buildAuthorizationContext } from '@/lib/authorization-context'

function finiteNumber(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// GET /api/itam/stock?category=&site=&lowStock=1&q=search
// Returns the current ITAM-DB names plus itemId/name compatibility aliases.
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req, 'VIEW_DEVICES')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row

    // SPRINT-2 #5 (AUDIT-API-001 #079): build AuthorizationContext for
    // permission-aware site scoping. The legacy siteFilterForUser only
    // checked site membership; ctx.canAtSite verifies the specific perm.
    const ctx = await buildAuthorizationContext(
      auth.user,
      auth.row.id,
      auth.row.allowedSites,
    )

    // ── Organization scope (Phase 1 multi-org) ──
    const orgScope = getOrgScope(auth.user)
    if (!orgScope.ok) return NextResponse.json({ error: orgScope.error.message }, { status: orgScope.error.status })

    const { searchParams } = new URL(req.url)
    const category = searchParams.get('category')?.trim() ?? ''
    const site = searchParams.get('site')?.trim() ?? ''
    const lowStock = searchParams.get('lowStock') === '1'
    const q = searchParams.get('q')?.trim() ?? ''

    const where: Record<string, unknown> = { AND: [{ ...orgScope.where }] }
    // DEMO ISOLATION FIX (QA-ROUND-G): demoFilter was imported but never
    // applied — demo users saw REAL stock items mixed into their list.
    ;(where.AND as unknown[]).push(demoFilter(auth.user))
    const sf = siteFilterForUser(user)
    if (Object.keys(sf).length) (where.AND as unknown[]).push(sf)
    if (site) (where.AND as unknown[]).push({ site })
    if (category) (where.AND as unknown[]).push({ category })
    if (lowStock) (where.AND as unknown[]).push({ minQuantity: { gt: 0 } })
    if (q) {
      // SUFFIX-AWARE (SEARCH-FIX): for short numeric queries, productCode
      // matches by SUFFIX (operators read product codes off boxes/stickers).
      const isShort = isNumericShortQuery(q)
      const codeOp = isShort
        ? { endsWith: q, mode: 'insensitive' as const }
        : { contains: q, mode: 'insensitive' as const }
      ;(where.AND as unknown[]).push({
        OR: [
          { productName: { contains: q, mode: 'insensitive' } },
          { productCode: codeOp },
          { brand: { contains: q, mode: 'insensitive' } },
          { model: { contains: q, mode: 'insensitive' } },
        ],
      })
    }
    if (Array.isArray(where.AND) && where.AND.length === 0) delete where.AND

    const rows = await db.stockItem.findMany({
      where,
      orderBy: [{ active: 'desc' }, { productName: 'asc' }],
    })

    const items = (lowStock ? rows.filter((row) => row.quantity <= row.minQuantity) : rows)
      .map(toCompatStockItem)

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const txnThisMonth = await db.stockTransaction.count({
      where: { txnDate: { gte: monthStart }, ...demoFilter(auth.user) },
    })

    return NextResponse.json({ items, stats: { txnThisMonth } })
  } catch (err) {
    console.error('GET /api/itam/stock', err)
    return NextResponse.json({ error: 'Failed to load stock items' }, { status: 500 })
  }
}

// POST /api/itam/stock — create a new stock item.
// Accepts both current productCode/productName and legacy itemId/name aliases.
export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req, 'DEVICE_EDIT')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const productName = optionalText(body.productName ?? body.name)
    if (!productName) {
      return NextResponse.json({ error: 'กรุณาระบุชื่อสินค้า' }, { status: 400 })
    }

    const userSuppliedCode = optionalText(body.productCode ?? body.itemId)
    const quantity = finiteNumber(body.quantity) ?? 0
    const minQuantity = finiteNumber(body.minQuantity) ?? 0
    const maxQuantity = finiteNumber(body.maxQuantity) ?? 0
    const unitCost = finiteNumber(body.unitCost)

    if (![quantity, minQuantity, maxQuantity].every(Number.isInteger) || quantity < 0 || minQuantity < 0 || maxQuantity < 0) {
      return NextResponse.json({ error: 'จำนวนสต็อกต้องเป็นจำนวนเต็มไม่ติดลบ' }, { status: 400 })
    }
    if (unitCost !== undefined && unitCost < 0) {
      return NextResponse.json({ error: 'ราคาต่อหน่วยต้องไม่ติดลบ' }, { status: 400 })
    }

    // Wrap create with retry-on-P2002: the auto-generated `STK-NNNN` code
    // uses `count() + 1` which races under concurrent inserts. On a unique
    // violation, recompute the code (the count() now reflects the row
    // inserted by the winner) and retry.
    const created = await withRetryOnUnique(async () => {
      const productCode = userSuppliedCode ??
        `STK-${String((await db.stockItem.count()) + 1).padStart(4, '0')}`
      return db.stockItem.create({
        data: {
          productCode,
          productName,
          category: optionalText(body.category),
          brand: optionalText(body.brand),
          model: optionalText(body.model),
          unit: optionalText(body.unit) ?? 'ชิ้น',
          quantity,
          minQuantity,
          maxQuantity,
          unitCost: unitCost ?? null,
          totalValue: unitCost === undefined ? null : quantity * unitCost,
          location: optionalText(body.location),
          site: optionalText(body.site),
          compatibleDevices: optionalText(body.compatibleDevices),
          remark: optionalText(body.remark),
          active: true,
          ...demoTag(auth.user), // FIX-025: tag demo data for safe cleanup
        },
      })
    })

    await logAudit(
      'STOCK_CREATE',
      'StockItem',
      created.id,
      `สร้างสินค้าสต๊อก "${created.productName}" (${created.productCode})`,
      { productCode: created.productCode, productName: created.productName, category: created.category, quantity: created.quantity },
      user.email,
    )

    return NextResponse.json({ item: toCompatStockItem(created) }, { status: 201 })
  } catch (err) {
    console.error('POST /api/itam/stock', err)
    return NextResponse.json({ error: 'Failed to create stock item' }, { status: 500 })
  }
}
