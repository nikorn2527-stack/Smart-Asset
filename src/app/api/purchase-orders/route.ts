import { NextRequest, NextResponse } from 'next/server'
import { db, getBaseClient } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { withRetryOnUnique } from '@/lib/retry-unique'
import { requireAuth } from '@/lib/auth-middleware'
import { demoTag } from '@/lib/demo-mode'
import { isNumericShortQuery } from '@/lib/suffix-search'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/** Parse an Int; returns 0 when missing/invalid. */
function optInt(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.round(n)
}

/** Parse a Float; returns null when missing/invalid. */
function optFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, n)
}

/**
 * Generate the next sequential PO number for today: PO-YYYYMMDD-NNN.
 */
async function nextPoNumber(orderDate: string): Promise<string> {
  const ymd = orderDate.replace(/-/g, '').slice(0, 8)
  const prefix = `PO-${ymd}-`
  const pos = await db.purchaseOrder.findMany({
    where: { poNumber: { startsWith: prefix } },
    select: { poNumber: true },
  })
  let max = 0
  for (const p of pos) {
    if (!p.poNumber) continue
    const m = /^PO-\d{8}-(\d+)$/.exec(p.poNumber)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim() ?? ''
    const status = searchParams.get('status')?.trim() ?? ''
    const page = Math.max(1, optInt(searchParams.get('page'), 1))
    const pageSize = Math.max(
      1,
      Math.min(100, optInt(searchParams.get('pageSize'), 50)),
    )

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (search) {
      // SUFFIX-AWARE (SEARCH-FIX): for short numeric queries, poNumber matches
      // by SUFFIX (operators read PO numbers off receipts).
      const isShort = isNumericShortQuery(search)
      const poOp = isShort ? { endsWith: search } : { contains: search }
      where.OR = [
        { poNumber: poOp },
        { supplier: { contains: search } },
        { remark: { contains: search } },
      ]
    }

    const [total, items] = await Promise.all([
      db.purchaseOrder.count({ where }),
      db.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          items: {
            include: {
              stockItem: {
                select: {
                  productCode: true,
                  productName: true,
                  unit: true,
                },
              },
            },
          },
        },
      }),
    ])

    return NextResponse.json({
      data: items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    })
  } catch (err) {
    console.error('GET /api/purchase-orders', err)
    return NextResponse.json(
      { error: 'Failed to fetch purchase orders' },
      { status: 500 },
    )
  }
}

interface PoItemInput {
  stockItemId?: string
  quantityOrdered?: number
  unitPrice?: number | null
}

export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  // FIX-025 + FIX-026: require auth so we can tag demo data and record
  // the actor in the audit log. The frontend already attaches a Bearer
  // token to all /api/purchase-orders requests (see stock/shared.ts
  // getAuthHeaders), so this is a no-op for legitimate callers — only
  // previously-anonymous external calls are rejected.
  const auth = await requireAuth(req, 'STOCK_APPROVE')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const body = await req.json()
    if (!body.orderDate || typeof body.orderDate !== 'string') {
      return NextResponse.json(
        { error: 'Missing required field: orderDate' },
        { status: 400 },
      )
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json(
        { error: 'ต้องระบุอย่างน้อย 1 รายการสินค้า' },
        { status: 400 },
      )
    }

    const orderDate = String(body.orderDate).trim()
    const userSuppliedPoNumber = body.poNumber
      ? String(body.poNumber).trim()
      : null

    // Validate item references and compute totals.
    const itemInputs: PoItemInput[] = body.items as PoItemInput[]
    for (let i = 0; i < itemInputs.length; i++) {
      const it = itemInputs[i]
      if (!it.stockItemId) {
        return NextResponse.json(
          { error: `รายการที่ ${i + 1}: ต้องระบุ stockItemId` },
          { status: 400 },
        )
      }
      if (!Number.isFinite(Number(it.quantityOrdered)) || Number(it.quantityOrdered) <= 0) {
        return NextResponse.json(
          { error: `รายการที่ ${i + 1}: จำนวนสั่งซื้อต้องมากกว่า 0` },
          { status: 400 },
        )
      }
    }

    // Verify all stock items exist in one round-trip.
    const stockItemIds = Array.from(
      new Set(itemInputs.map((i) => String(i.stockItemId))),
    )
    const found = await db.stockItem.findMany({
      where: { id: { in: stockItemIds } },
      select: { id: true },
    })
    const foundIds = new Set(found.map((f) => f.id))
    const missing = stockItemIds.filter((id) => !foundIds.has(id))
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `ไม่พบสินค้าบางรายการ: ${missing.join(', ')}` },
        { status: 400 },
      )
    }

    // ── Build a function that runs the create transaction with a given
    //    poNumber (shared by both user-supplied and auto-generated paths).
    const runTransaction = (poNumber: string) =>
      getBaseClient().$transaction(async (tx) => {
        const po = await tx.purchaseOrder.create({
          data: {
            poNumber,
            orderDate,
            supplier: body.supplier ? String(body.supplier).trim() : null,
            status: body.status ? String(body.status).trim() : 'open',
            createdBy: body.createdBy ? String(body.createdBy).trim() : null,
            remark: body.remark ? String(body.remark).trim() : null,
            ...demoTag(auth.user), // FIX-025: tag demo data for safe cleanup
          },
        })

        let totalValue = 0
        const itemRows: Array<Awaited<ReturnType<typeof tx.purchaseOrderItem.create>>> = []
        for (const it of itemInputs) {
          const qtyOrdered = optInt(it.quantityOrdered, 0)
          const unitPrice = optFloat(it.unitPrice)
          const lineTotal = unitPrice !== null ? unitPrice * qtyOrdered : null
          if (lineTotal !== null) totalValue += lineTotal
          const row = await tx.purchaseOrderItem.create({
            data: {
              purchaseOrderId: po.id,
              stockItemId: String(it.stockItemId),
              quantityOrdered: qtyOrdered,
              quantityReceived: 0,
              unitPrice,
              totalValue: lineTotal,
            },
          })
          itemRows.push(row)
        }

        const updatedPo = await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { totalValue },
        })

        return { po: updatedPo, items: itemRows }
      })

    let created: Awaited<ReturnType<typeof runTransaction>>
    if (userSuppliedPoNumber) {
      // User-supplied path — pre-check for a clearer 400. No retry:
      // the same code would fail again on P2002.
      // NOTE: poNumber is NOT a unique column (see schema), so we use
      // findFirst instead of findUnique.
      const existing = await db.purchaseOrder.findFirst({
        where: { poNumber: userSuppliedPoNumber },
        select: { id: true },
      })
      if (existing) {
        return NextResponse.json(
          { error: `รหัสใบสั่งซื้อ ${userSuppliedPoNumber} มีอยู่แล้ว` },
          { status: 400 },
        )
      }
      created = await runTransaction(userSuppliedPoNumber)
    } else {
      // FIX-024: Auto-generated path — wrap with retry-on-P2002.
      // Re-generate poNumber on each attempt; the winner's row is now
      // visible to nextPoNumber's max-seq lookup, so the next call gets
      // a new (non-conflicting) sequence number.
      // NOTE: poNumber is not a unique column, so P2002 will not actually
      // fire today — but this guard is defensive: if a unique index is
      // added later, the retry kicks in automatically.
      created = await withRetryOnUnique(async () => {
        const freshPoNumber = await nextPoNumber(orderDate)
        return runTransaction(freshPoNumber)
      })
    }
    await logAudit(
      'CREATE',
      'PurchaseOrder',
      created.po.id,
      `สร้างใบสั่งซื้อ ${created.po.poNumber ?? ''} (${created.items.length} รายการ, มูลค่า ${created.po.totalValue ?? 0})`,
      {
        poNumber: created.po.poNumber,
        supplier: created.po.supplier,
        totalValue: created.po.totalValue,
        itemCount: created.items.length,
      },
      auth.user.email, // FIX-026: actor
    )

    return NextResponse.json({ data: created.po }, { status: 201 })
  } catch (err) {
    console.error('POST /api/purchase-orders', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to create purchase order') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
