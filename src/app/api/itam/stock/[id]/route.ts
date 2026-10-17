import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { logAudit } from '@/lib/audit'
import { toCompatStockItem, toCompatStockTransaction } from '@/lib/stock-compat'
import { moduleUnavailableResponse } from '@/lib/module-gate'

interface Params {
  params: Promise<{ id: string }>
}

function finiteNumber(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

// GET /api/itam/stock/[id] — single item + last 10 transactions
export async function GET(req: NextRequest, { params }: Params) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req, 'VIEW_DEVICES')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row
    // SPRINT-5-MUTATION-CTX-MIGRATION: use ctx.canAtSite for site-scoped perm checks.
    const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)

    const { id } = await params
    const item = await db.stockItem.findUnique({ where: { id } })
    if (!item) return NextResponse.json({ error: 'ไม่พบสินค้า' }, { status: 404 })
    if (!ctx.canAtSite(item.site, 'STOCK_VIEW')) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์เข้าถึงสินค้าในสาขานี้' }, { status: 403 })
    }

    const transactions = await db.stockTransaction.findMany({
      where: { stockItemId: id },
      orderBy: { txnDate: 'desc' },
      take: 10,
    })

    return NextResponse.json({
      item: toCompatStockItem(item),
      transactions: transactions.map(toCompatStockTransaction),
    })
  } catch (err) {
    console.error('GET /api/itam/stock/[id]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// PUT /api/itam/stock/[id] — update item fields.
// Accepts legacy name alias; productCode remains immutable after creation.
export async function PUT(req: NextRequest, { params }: Params) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req, 'DEVICE_EDIT')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row
    // SPRINT-5-MUTATION-CTX-MIGRATION: use ctx.canAtSite for site-scoped perm checks.
    const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)

    const { id } = await params
    const existing = await db.stockItem.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'ไม่พบสินค้า' }, { status: 404 })
    // Generic item update (metadata + optional quantity change): allow either
    // STOCK_IN or STOCK_OUT at this site.
    if (!ctx.canAtSite(existing.site, 'STOCK_IN') && !ctx.canAtSite(existing.site, 'STOCK_OUT')) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์แก้ไขสินค้าในสาขานี้' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const data: Record<string, unknown> = {}
    const productName = body.productName ?? body.name
    if (typeof productName === 'string' && productName.trim()) data.productName = productName.trim()
    if (typeof body.category === 'string') data.category = body.category.trim() || null
    if (typeof body.brand === 'string') data.brand = body.brand.trim() || null
    if (typeof body.model === 'string') data.model = body.model.trim() || null
    if (typeof body.unit === 'string' && body.unit.trim()) data.unit = body.unit.trim()

    const quantity = finiteNumber(body.quantity)
    if (quantity !== undefined) {
      if (!Number.isInteger(quantity) || quantity < 0) {
        return NextResponse.json({ error: 'จำนวนคงเหลือต้องเป็นจำนวนเต็มไม่ติดลบ' }, { status: 400 })
      }
      data.quantity = quantity
    }
    const minQuantity = finiteNumber(body.minQuantity)
    if (minQuantity !== undefined) {
      if (!Number.isInteger(minQuantity) || minQuantity < 0) {
        return NextResponse.json({ error: 'จุดสั่งซื้อต้องเป็นจำนวนเต็มไม่ติดลบ' }, { status: 400 })
      }
      data.minQuantity = minQuantity
    }
    const maxQuantity = finiteNumber(body.maxQuantity)
    if (maxQuantity !== undefined) {
      if (!Number.isInteger(maxQuantity) || maxQuantity < 0) {
        return NextResponse.json({ error: 'สต็อกสูงสุดต้องเป็นจำนวนเต็มไม่ติดลบ' }, { status: 400 })
      }
      data.maxQuantity = maxQuantity
    }

    if (body.unitCost === '' || body.unitCost === null) {
      data.unitCost = null
    } else {
      const unitCost = finiteNumber(body.unitCost)
      if (unitCost !== undefined) {
        if (unitCost < 0) return NextResponse.json({ error: 'ราคาต่อหน่วยต้องไม่ติดลบ' }, { status: 400 })
        data.unitCost = unitCost
      }
    }

    if (typeof body.location === 'string') data.location = body.location.trim() || null
    if (typeof body.site === 'string') data.site = body.site.trim() || null
    if (typeof body.compatibleDevices === 'string') data.compatibleDevices = body.compatibleDevices.trim() || null
    if (typeof body.remark === 'string') data.remark = body.remark.trim() || null
    if (typeof body.active === 'boolean') data.active = body.active

    if ('quantity' in data || 'unitCost' in data) {
      const nextQuantity = Number(data.quantity ?? existing.quantity)
      const nextUnitCost = data.unitCost === null ? null : Number(data.unitCost ?? existing.unitCost ?? 0)
      data.totalValue = nextUnitCost === null ? null : nextQuantity * nextUnitCost
    }

    const updated = await db.stockItem.update({ where: { id }, data })

    await logAudit(
      'STOCK_UPDATE',
      'StockItem',
      id,
      `แก้ไขสินค้าสต๊อก "${updated.productName}"`,
      { productCode: updated.productCode, fields: Object.keys(data) },
      user.email,
    )

    return NextResponse.json({ item: toCompatStockItem(updated) })
  } catch (err) {
    console.error('PUT /api/itam/stock/[id]', err)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}

// DELETE /api/itam/stock/[id]
// Soft delete when transactions exist; hard delete otherwise.
export async function DELETE(req: NextRequest, { params }: Params) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req, 'DEVICE_EDIT')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row
    // SPRINT-5-MUTATION-CTX-MIGRATION: use ctx.canAtSite for site-scoped perm checks.
    const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)

    const { id } = await params
    const existing = await db.stockItem.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'ไม่พบสินค้า' }, { status: 404 })
    if (!ctx.canAtSite(existing.site, 'STOCK_APPROVE')) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์ลบสินค้าในสาขานี้' }, { status: 403 })
    }

    const txnCount = await db.stockTransaction.count({ where: { stockItemId: id } })
    let hard = false
    if (txnCount === 0) {
      await db.stockItem.delete({ where: { id } })
      hard = true
    } else {
      await db.stockItem.update({ where: { id }, data: { active: false } })
    }

    await logAudit(
      'STOCK_DELETE',
      'StockItem',
      id,
      hard
        ? `ลบสินค้าสต๊อก "${existing.productName}" (ลบถาวร)`
        : `ปิดใช้งานสินค้าสต๊อก "${existing.productName}" (มีรายการเข้า-ออก)`,
      { productCode: existing.productCode, productName: existing.productName, hard, txnCount },
      user.email,
    )

    return NextResponse.json({ ok: true, hard })
  } catch (err) {
    console.error('DELETE /api/itam/stock/[id]', err)
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}
