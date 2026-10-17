import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  // P0 Security: require auth — PO contains unitCost (financial data)
  const auth = await requireAuth(_req, 'VIEW_DASHBOARD')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const po = await db.purchaseOrder.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            stockItem: {
              select: {
                id: true,
                productCode: true,
                productName: true,
                unit: true,
                unitCost: true,
              },
            },
          },
        },
      },
    })
    if (!po) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ data: po })
  } catch (err) {
    console.error('GET /api/purchase-orders/[id]', err)
    return NextResponse.json(
      { error: 'Failed to fetch purchase order' },
      { status: 500 },
    )
  }
}

const VALID_STATUSES = new Set(['open', 'partial', 'received', 'cancelled'])

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  // P0 Security: require auth — PUT modifies PO status/financial data
  const auth = await requireAuth(req, 'STOCK_APPROVE')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const body = await req.json()
    const before = await db.purchaseOrder.findUnique({ where: { id } })
    if (!before) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const nextStatus = body.status !== undefined ? String(body.status).trim() : undefined
    if (nextStatus && !VALID_STATUSES.has(nextStatus)) {
      return NextResponse.json(
        { error: 'status ต้องเป็น open | partial | received | cancelled' },
        { status: 400 },
      )
    }

    const updated = await db.purchaseOrder.update({
      where: { id },
      data: {
        status: nextStatus ?? undefined,
        supplier:
          body.supplier !== undefined
            ? body.supplier
              ? String(body.supplier).trim()
              : null
            : undefined,
        remark:
          body.remark !== undefined
            ? body.remark
              ? String(body.remark).trim()
              : null
            : undefined,
        orderDate:
          body.orderDate !== undefined
            ? String(body.orderDate).trim()
            : undefined,
        totalValue:
          body.totalValue !== undefined
            ? Number(body.totalValue) || 0
            : undefined,
      },
    })

    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const k of ['status', 'supplier', 'remark', 'orderDate', 'totalValue'] as const) {
      if (body[k] !== undefined) {
        const from = before[k as keyof typeof before]
        const to = updated[k as keyof typeof updated]
        if (String(from ?? '') !== String(to ?? '')) {
          changes[k] = { from, to }
        }
      }
    }

    await logAudit(
      'UPDATE',
      'PurchaseOrder',
      id,
      `แก้ไขใบสั่งซื้อ ${updated.poNumber ?? ''} (สถานะ: ${updated.status})`,
      { changes },
    )

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/purchase-orders/[id]', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to update purchase order') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
