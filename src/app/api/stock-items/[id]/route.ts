import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'STOCK_VIEW')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const item = await db.stockItem.findUnique({
      where: { id },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
      },
    })
    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ data: item })
  } catch (err) {
    console.error('GET /api/stock-items/[id]', err)
    return NextResponse.json(
      { error: 'Failed to fetch stock item' },
      { status: 500 },
    )
  }
}

const EDITABLE_FIELDS = [
  'productCode',
  'productName',
  'category',
  'brand',
  'model',
  'unit',
  'quantity',
  'minQuantity',
  'maxQuantity',
  'unitCost',
  'location',
  'site',
  'compatibleDevices',
  'remark',
  'active',
] as const

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'STOCK_IN')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const body = await req.json()
    const before = await db.stockItem.findUnique({ where: { id } })
    if (!before) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // If productCode is being changed, ensure uniqueness.
    if (
      body.productCode !== undefined &&
      String(body.productCode).trim() !== before.productCode
    ) {
      const conflict = await db.stockItem.findUnique({
        where: { productCode: String(body.productCode).trim() },
        select: { id: true },
      })
      if (conflict && conflict.id !== id) {
        return NextResponse.json(
          { error: `รหัสสินค้า ${String(body.productCode).trim()} มีอยู่แล้ว` },
          { status: 400 },
        )
      }
    }

    const updated = await db.stockItem.update({
      where: { id },
      data: {
        productCode:
          body.productCode !== undefined
            ? String(body.productCode).trim()
            : undefined,
        productName:
          body.productName !== undefined
            ? String(body.productName).trim()
            : undefined,
        category:
          body.category !== undefined
            ? body.category
              ? String(body.category).trim()
              : null
            : undefined,
        brand:
          body.brand !== undefined
            ? body.brand
              ? String(body.brand).trim()
              : null
            : undefined,
        model:
          body.model !== undefined
            ? body.model
              ? String(body.model).trim()
              : null
            : undefined,
        unit:
          body.unit !== undefined ? String(body.unit).trim() : undefined,
        quantity:
          body.quantity !== undefined ? optInt(body.quantity, 0) : undefined,
        minQuantity:
          body.minQuantity !== undefined
            ? optInt(body.minQuantity, 0)
            : undefined,
        maxQuantity:
          body.maxQuantity !== undefined
            ? optInt(body.maxQuantity, 0)
            : undefined,
        unitCost:
          body.unitCost !== undefined ? optFloat(body.unitCost) : undefined,
        // WO-PARTS-FLOW Level 2+: cost model + expected usage + rates
        costModel:
          body.costModel !== undefined
            ? body.costModel
              ? String(body.costModel).trim()
              : null
            : undefined,
        expectedDevicesPerUnit:
          body.expectedDevicesPerUnit !== undefined
            ? optInt(body.expectedDevicesPerUnit, 0) || null
            : undefined,
        expectedHoursPerUnit:
          body.expectedHoursPerUnit !== undefined
            ? optInt(body.expectedHoursPerUnit, 0) || null
            : undefined,
        expectedPagesPerUnit:
          body.expectedPagesPerUnit !== undefined
            ? optInt(body.expectedPagesPerUnit, 0) || null
            : undefined,
        ratePerPage:
          body.ratePerPage !== undefined ? optFloat(body.ratePerPage) : undefined,
        ratePerHour:
          body.ratePerHour !== undefined ? optFloat(body.ratePerHour) : undefined,
        ratePerMonth:
          body.ratePerMonth !== undefined ? optFloat(body.ratePerMonth) : undefined,
        ratePerDevice:
          body.ratePerDevice !== undefined ? optFloat(body.ratePerDevice) : undefined,
        location:
          body.location !== undefined
            ? body.location
              ? String(body.location).trim()
              : null
            : undefined,
        site:
          body.site !== undefined
            ? body.site
              ? String(body.site).trim()
              : null
            : undefined,
        compatibleDevices:
          body.compatibleDevices !== undefined
            ? body.compatibleDevices
              ? String(body.compatibleDevices).trim()
              : null
            : undefined,
        remark:
          body.remark !== undefined
            ? body.remark
              ? String(body.remark).trim()
              : null
            : undefined,
        active:
          body.active !== undefined ? Boolean(body.active) : undefined,
      },
    })

    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const k of EDITABLE_FIELDS) {
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
      'StockItem',
      id,
      `แก้ไขสินค้า ${updated.productCode} (${updated.productName})`,
      { changes },
    )

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/stock-items/[id]', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to update stock item') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'STOCK_IN')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const item = await db.stockItem.findUnique({ where: { id } })
    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    // Soft delete — keep historical transactions intact.
    const updated = await db.stockItem.update({
      where: { id },
      data: { active: false },
    })
    await logAudit(
      'DELETE',
      'StockItem',
      id,
      `ลบสินค้า ${item.productCode} (${item.productName})`,
      { softDelete: true, productCode: item.productCode },
    )
    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('DELETE /api/stock-items/[id]', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to delete stock item') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
