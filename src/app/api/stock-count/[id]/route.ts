// ============================================================
// Stock Count Session Detail (Phase 5.2 + 5.4)
// ============================================================
// GET  /api/stock-count/[id]   — fetch session + items (+ target snapshot)
// POST /api/stock-count/[id]   — add an item (scan/enter counted qty)
//                                 Body: { targetId, countedQty?, note? }
//                                       OR { scanCode } — resolve by productCode
// PUT  /api/stock-count/[id]    — close session (status=CLOSED) + return Phase 5.4 summary
//                                 Body: { action: 'close', note? }
//
// Phase 5.4 summary (returned when closing):
//   totalCount          — number of items in the session
//   countedCount        — items with status=COUNTED
//   notFoundCount       — items with status=NOT_FOUND
//   wrongLocationCount  — always 0 for stock (location concept is device-only)
//   varianceValue       — sum of |counted - expected| × unitCost
//                         (negative variance counts the same — it's the
//                         absolute difference, not signed)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { logAudit } from '@/lib/audit'

function parseId(req: NextRequest): string {
  const url = new URL(req.url)
  const parts = url.pathname.split('/')
  return parts[parts.length - 1] ?? ''
}

export async function GET(req: NextRequest) {
  const moduleCheck = await moduleUnavailableResponse('stock')
  if (moduleCheck) return moduleCheck

  const auth = await requireAuth(req, 'STOCK_VIEW')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const id = parseId(req)
  try {
    const session = await db.stockCountSession.findUnique({
      where: { id },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Hydrate target snapshots (StockItem) for STOCK_ITEM scope.
    const stockIds = session.items
      .filter((it) => session.scope === 'STOCK_ITEM')
      .map((it) => it.targetId)
    const stocks = stockIds.length
      ? await db.stockItem.findMany({
          where: { id: { in: stockIds } },
          select: {
            id: true,
            productCode: true,
            productName: true,
            category: true,
            brand: true,
            model: true,
            unit: true,
            quantity: true,
            unitCost: true,
            site: true,
            location: true,
          },
        })
      : []
    const stockById = new Map(stocks.map((s) => [s.id, s]))

    const items = session.items.map((it) => {
      const stock = stockById.get(it.targetId)
      return {
        ...it,
        target: stock ?? null,
        // Snapshot expected values from when the item was added (so a
        // subsequent stock movement doesn't change the comparison baseline).
        expectedQty: it.expectedQty ?? stock?.quantity ?? 0,
        expectedLocation: it.expectedLocation ?? stock?.location ?? null,
      }
    })

    return NextResponse.json({ data: { ...session, items } })
  } catch (err) {
    console.error('GET /api/stock-count/[id]', err)
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const moduleCheck = await moduleUnavailableResponse('stock')
  if (moduleCheck) return moduleCheck

  const auth = await requireAuth(req, 'STOCK_IN')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const id = parseId(req)
  try {
    const session = await db.stockCountSession.findUnique({ where: { id } })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    if (session.status !== 'OPEN') {
      return NextResponse.json({ error: 'Session is not OPEN (cannot add items)' }, { status: 400 })
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const scanCode = typeof body.scanCode === 'string' ? body.scanCode.trim() : ''
    const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : ''
    const countedQty =
      typeof body.countedQty === 'number' ? body.countedQty
      : typeof body.countedQty === 'string' && body.countedQty !== '' ? Number(body.countedQty)
      : null
    const note = typeof body.note === 'string' ? body.note.trim() : null

    // Resolve target StockItem — by scanCode (productCode) OR explicit targetId.
    //
    // The type is inferred from Prisma (no manual annotation + `as typeof stock`).
    // The hand-written annotation declared `unitCost` as a `{ toNumber() }`
    // structural type, which made TypeScript's control-flow analysis narrow the
    // variable to `never` after the `if (!stock)` guard, so every later
    // `stock.*` access errored with "Property 'x' does not exist on type
    // 'never'". `unitCost` is not read from this binding anyway.
    const stockSelect = {
      id: true,
      productCode: true,
      productName: true,
      quantity: true,
      location: true,
    } as const
    let stock: {
      id: string
      productCode: string
      productName: string
      quantity: number
      location: string | null
    } | null = null
    if (scanCode) {
      stock = await db.stockItem.findUnique({
        where: { productCode: scanCode },
        select: stockSelect,
      })
    } else if (targetId) {
      stock = await db.stockItem.findUnique({
        where: { id: targetId },
        select: stockSelect,
      })
    }
    if (!stock) {
      return NextResponse.json({ error: 'Stock item not found (scanCode/targetId invalid)' }, { status: 404 })
    }

    // Upsert: if the same targetId is already in this session, update countedQty;
    // otherwise insert a new row.
    const existing = await db.stockCountItem.findFirst({
      where: { sessionId: id, targetId: stock.id },
    })

    const expectedQty = stock.quantity
    const variance = countedQty != null && Number.isFinite(countedQty) ? countedQty - expectedQty : null
    const status =
      countedQty == null ? 'PENDING'
      : variance === 0 ? 'COUNTED'
      : 'COUNTED' // mismatch in qty is still COUNTED (variance recorded)

    let item: typeof existing
    if (existing) {
      item = await db.stockCountItem.update({
        where: { id: existing.id },
        data: {
          countedQty: countedQty ?? existing.countedQty,
          countedBy: auth.user.email,
          countedAt: new Date(),
          variance,
          status,
          note: note ?? existing.note,
        },
      })
    } else {
      item = await db.stockCountItem.create({
        data: {
          sessionId: id,
          targetId: stock.id,
          targetCode: stock.productCode,
          expectedQty,
          expectedLocation: stock.location,
          countedQty: countedQty ?? null,
          countedBy: auth.user.email,
          countedAt: countedQty != null ? new Date() : null,
          variance,
          status,
          note,
        },
      })
    }

    return NextResponse.json({ data: item }, { status: 201 })
  } catch (err) {
    console.error('POST /api/stock-count/[id]', err)
    return NextResponse.json({ error: 'Failed to add stock count item' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const moduleCheck = await moduleUnavailableResponse('stock')
  if (moduleCheck) return moduleCheck

  const auth = await requireAuth(req, 'STOCK_IN')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const id = parseId(req)
  try {
    const session = await db.stockCountSession.findUnique({
      where: { id },
      include: { items: true },
    })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    if (session.status !== 'OPEN') {
      return NextResponse.json({ error: 'Session already closed/cancelled' }, { status: 400 })
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = typeof body.action === 'string' ? body.action : 'close'
    if (action !== 'close') {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
    const note = typeof body.note === 'string' ? body.note.trim() : null

    // ── Phase 5.4: compute summary ──
    // Items not yet counted (status=PENDING) are marked NOT_FOUND on close
    // (you can't count what you didn't find).
    const uncounted = session.items.filter((it) => it.status === 'PENDING')
    if (uncounted.length > 0) {
      await db.stockCountItem.updateMany({
        where: { id: { in: uncounted.map((it) => it.id) } },
        data: { status: 'NOT_FOUND' },
      })
    }

    // Re-fetch with updated statuses for summary calc.
    const items = await db.stockCountItem.findMany({
      where: { sessionId: id },
      include: {
        // No relation defined — we resolve StockItem manually below.
      },
    })

    const totalCount = items.length
    const countedCount = items.filter((it) => it.status === 'COUNTED').length
    const notFoundCount = items.filter((it) => it.status === 'NOT_FOUND').length
    // For stock scope, "wrong location" doesn't apply (devices only).
    const wrongLocationCount = 0

    // varianceValue = sum of |variance × unitCost|
    // StockItem.unitCost is required to compute this; missing unitCost = 0.
    const stockIds = items.map((it) => it.targetId)
    const stocks = stockIds.length
      ? await db.stockItem.findMany({
          where: { id: { in: stockIds } },
          select: { id: true, unitCost: true },
        })
      : []
    const unitCostById = new Map(
      stocks.map((s) => [s.id, s.unitCost ? Number(s.unitCost) : 0]),
    )
    let varianceValue = 0
    for (const it of items) {
      if (it.variance == null) continue
      const unitCost = unitCostById.get(it.targetId) ?? 0
      varianceValue += Math.abs(it.variance) * unitCost
    }
    varianceValue = Math.round(varianceValue * 100) / 100

    // Close the session.
    const updated = await db.stockCountSession.update({
      where: { id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        note: note ?? session.note,
      },
    })

    await logAudit(
      'UPDATE',
      'StockCountSession',
      updated.id,
      `ปิดรอบนับสต็อก "${updated.name}" — total=${totalCount}, counted=${countedCount}, notFound=${notFoundCount}, varianceValue=${varianceValue}`,
      { sessionId: updated.id, summary: { totalCount, countedCount, notFoundCount, wrongLocationCount, varianceValue } },
      auth.user.email,
    )

    return NextResponse.json({
      data: updated,
      summary: {
        totalCount,
        countedCount,
        notFoundCount,
        wrongLocationCount,
        varianceValue,
      },
    })
  } catch (err) {
    console.error('PUT /api/stock-count/[id]', err)
    return NextResponse.json({ error: 'Failed to close session' }, { status: 500 })
  }
}
