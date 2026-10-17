import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { withRetryOnUnique } from '@/lib/retry-unique'
import { demoTag, demoFilter } from '@/lib/demo-mode'
import { isNumericShortQuery } from '@/lib/suffix-search'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/** Parse a Float; returns null when missing/invalid. */
function optFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, n)
}

/** Parse an Int; returns 0 when missing/invalid. */
function optInt(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.round(n)
}

/**
 * Generate the next sequential product code: STK-NNNN.
 * Finds existing codes matching STK-\d+, takes the max, +1.
 */
async function nextProductCode(): Promise<string> {
  // Use findFirst with orderBy desc — only fetch 1 row instead of all STK-* rows
  const latest = await db.stockItem.findFirst({
    where: { productCode: { startsWith: 'STK-' } },
    orderBy: { productCode: 'desc' },
    select: { productCode: true },
  })
  let max = 0
  if (latest) {
    const m = /^STK-(\d+)$/.exec(latest.productCode)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n)) max = n
    }
  }
  return `STK-${String(max + 1).padStart(4, '0')}`
}

export async function GET(req: NextRequest) {
  // ── Phase 4.3: Module availability gate ──
  const moduleCheck = await moduleUnavailableResponse('stock')
  if (moduleCheck) return moduleCheck

  const auth = await requireAuth(req, 'STOCK_VIEW')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim() ?? ''
    const category = searchParams.get('category')?.trim() ?? ''
    const lowStock = searchParams.get('lowStock') ?? ''
    const activeOnly = (searchParams.get('activeOnly') ?? '1') === '1'
    const page = Math.max(1, optInt(searchParams.get('page'), 1))
    const pageSize = Math.max(
      1,
      Math.min(100, optInt(searchParams.get('pageSize'), 50)),
    )

    const where: Record<string, unknown> = { ...demoFilter(auth.user) }
    if (activeOnly) where.active = true
    if (category) where.category = category
    if (search) {
      // SUFFIX-AWARE (SEARCH-FIX): for short numeric queries, productCode
      // matches by SUFFIX (operators read product codes off boxes/stickers).
      const isShort = isNumericShortQuery(search)
      const codeOp = isShort ? { endsWith: search } : { contains: search }
      where.OR = [
        { productCode: codeOp },
        { productName: { contains: search } },
        { brand: { contains: search } },
        { model: { contains: search } },
        { compatibleDevices: { contains: search } },
      ]
    }

    const [total, items] = await Promise.all([
      db.stockItem.count({ where }),
      db.stockItem.findMany({
        where,
        orderBy: [
          { category: 'asc' },
          { productCode: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    // Apply the low-stock rule (quantity <= minQuantity AND minQuantity > 0).
    // Bug DATA-05 fix: previously counted items with minQuantity=0 (no reorder point set)
    // as "low stock" — inflating the count by 1 vs the actual list shown.
    let filtered = items
    if (lowStock === '1') {
      filtered = items.filter((it) => it.minQuantity > 0 && it.quantity <= it.minQuantity)
    }

    // ---- Stats (computed on the full active set, ignoring pagination) ----
    // Bug fix: stats must also apply demoFilter so demo users see only demo stock counts
    const statsWhere: Record<string, unknown> = { ...demoFilter(auth.user) }
    if (activeOnly) statsWhere.active = true
    const allActive = await db.stockItem.findMany({
      where: statsWhere,
      select: {
        quantity: true,
        unitCost: true,
        minQuantity: true,
        createdAt: true,
      },
    })
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const stats = {
      total: allActive.length,
      // Bug DATA-05 fix: only count items that actually need reordering (minQuantity > 0)
      lowStock: allActive.filter((it) => it.minQuantity > 0 && it.quantity <= it.minQuantity).length,
      // StockItem.unitCost is a Prisma `Decimal` — coerce before multiplying,
      // otherwise the reduce mixes DecimalJs instances into a `number` sum.
      totalValue: allActive.reduce(
        (sum, it) => sum + Number(it.unitCost ?? 0) * it.quantity,
        0,
      ),
      thisMonth: allActive.filter((it) => it.createdAt >= monthStart).length,
    }

    return NextResponse.json({
      data: filtered,
      pagination: {
        page,
        pageSize,
        total: lowStock === '1' ? filtered.length : total,
        totalPages: Math.max(
          1,
          Math.ceil((lowStock === '1' ? filtered.length : total) / pageSize),
        ),
      },
      stats,
    })
  } catch (err) {
    console.error('GET /api/stock-items', err)
    return NextResponse.json(
      { error: 'Failed to fetch stock items' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  // ── Phase 4.3: Module availability gate ──
  const moduleCheck = await moduleUnavailableResponse('stock')
  if (moduleCheck) return moduleCheck

  const auth = await requireAuth(req, 'STOCK_IN')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const body = await req.json()
    if (!body.productName || typeof body.productName !== 'string') {
      return NextResponse.json(
        { error: 'Missing required field: productName' },
        { status: 400 },
      )
    }

    const userSuppliedCode = body.productCode
      ? String(body.productCode).trim()
      : null

    // ── Build the create payload (shared by both paths) ──────────────────
    const buildCreateData = (productCode: string) => ({
      productCode,
      productName: String(body.productName).trim(),
      category: body.category ? String(body.category).trim() : null,
      brand: body.brand ? String(body.brand).trim() : null,
      model: body.model ? String(body.model).trim() : null,
      unit: body.unit ? String(body.unit).trim() : 'ชิ้น',
      quantity: optInt(body.quantity, 0),
      minQuantity: optInt(body.minQuantity, 0),
      maxQuantity: optInt(body.maxQuantity, 0),
      unitCost: optFloat(body.unitCost),
      location: body.location ? String(body.location).trim() : null,
      site: body.site ? String(body.site).trim() : null,
      compatibleDevices: body.compatibleDevices
        ? String(body.compatibleDevices).trim()
        : null,
      remark: body.remark ? String(body.remark).trim() : null,
      active: body.active !== undefined ? Boolean(body.active) : true,
      // WO-PARTS-FLOW Level 2+: cost model + expected usage + rates
      costModel: body.costModel ? String(body.costModel).trim() : null,
      expectedDevicesPerUnit: optInt(body.expectedDevicesPerUnit, 0) || null,
      expectedHoursPerUnit: optInt(body.expectedHoursPerUnit, 0) || null,
      expectedPagesPerUnit: optInt(body.expectedPagesPerUnit, 0) || null,
      ratePerPage: optFloat(body.ratePerPage),
      ratePerHour: optFloat(body.ratePerHour),
      ratePerMonth: optFloat(body.ratePerMonth),
      ratePerDevice: optFloat(body.ratePerDevice),
      ...demoTag(auth.user), // FIX-025: tag demo data for safe cleanup
    })

    let created: Awaited<ReturnType<typeof db.stockItem.create>>
    if (userSuppliedCode) {
      // User-supplied path — pre-check uniqueness for a clearer 400 error.
      // No retry: the same code would fail again on P2002.
      const existing = await db.stockItem.findUnique({
        where: { productCode: userSuppliedCode },
        select: { id: true },
      })
      if (existing) {
        return NextResponse.json(
          { error: `รหัสสินค้า ${userSuppliedCode} มีอยู่แล้ว` },
          { status: 400 },
        )
      }
      created = await db.stockItem.create({ data: buildCreateData(userSuppliedCode) })
    } else {
      // Auto-generated path — wrap with retry-on-P2002: re-generate the
      // sequence number on each attempt so concurrent inserts that both
      // compute the same `STK-NNNN` resolve cleanly (one wins, the other
      // retries with the next code).
      created = await withRetryOnUnique(async () => {
        const productCode = await nextProductCode()
        return db.stockItem.create({ data: buildCreateData(productCode) })
      })
    }

    await logAudit(
      'CREATE',
      'StockItem',
      created.id,
      `เพิ่มสินค้า ${created.productCode} (${created.productName})`,
      {
        productCode: created.productCode,
        productName: created.productName,
        category: created.category,
        quantity: created.quantity,
      },
      auth.user.email, // FIX-026: actor
    )

    return NextResponse.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/stock-items', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to create stock item') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
