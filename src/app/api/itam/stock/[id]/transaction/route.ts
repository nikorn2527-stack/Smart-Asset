import { NextRequest, NextResponse } from 'next/server'
import { db, getBaseClient } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import type { Permission } from '@/lib/auth-shared'

interface Params {
  params: Promise<{ id: string }>
}

// POST /api/itam/stock/[id]/transaction — record an IN / OUT / ADJUST
//   Body: { type, quantity, reason?, relatedAssetNo?, cost?, vendor?, remark? }
//   Returns: { transaction, item }
//
// Logic:
//   IN     → balance + quantity (reject if quantity ≤ 0)
//   OUT    → balance - quantity (reject if would go negative)
//   ADJUST → balance = quantity (sets to absolute value)
//   Everything is wrapped in getBaseClient().$transaction for atomicity.
export async function POST(req: NextRequest, { params }: Params) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req, 'DEVICE_EDIT')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row
    // SPRINT-5-MUTATION-CTX-MIGRATION: use ctx.canAtSite for site-scoped perm checks.
    const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)

    const { id } = await params
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const type = String(body.type ?? '').toUpperCase()
    if (!['IN', 'OUT', 'ADJUST'].includes(type)) {
      return NextResponse.json({ error: 'type ต้องเป็น IN, OUT หรือ ADJUST' }, { status: 400 })
    }
    const qtyRaw = Number(body.quantity)
    if (!Number.isFinite(qtyRaw)) {
      return NextResponse.json({ error: 'กรุณาระบุจำนวน' }, { status: 400 })
    }
    const quantity = Math.trunc(qtyRaw)

    // SPRINT-5-MUTATION-CTX-MIGRATION: pick the site-scoped permission that
    // matches this transaction type so a viewer (no STOCK_IN/OUT) is denied.
    //
    // NOTE: ADJUST has no dedicated permission in the RBAC vocabulary — it is
    // an admin/maintenance action. `SYSTEM_CONFIG` is the closest existing
    // grant and keeps the `canAtSite` signature (which requires a Permission).
    const txnPerm: Permission =
      type === 'IN' ? 'STOCK_IN' : type === 'OUT' ? 'STOCK_OUT' : 'SYSTEM_CONFIG'

    const result = await getBaseClient().$transaction(async (tx) => {
      const item = await tx.stockItem.findUnique({ where: { id } })
      if (!item) throw new Error('NOT_FOUND')
      if (!ctx.canAtSite(item.site, txnPerm)) throw new Error('FORBIDDEN')

      let newBalance: number
      if (type === 'IN') {
        if (quantity <= 0) throw new Error('QTY_INVALID')
        newBalance = item.quantity + quantity
      } else if (type === 'OUT') {
        if (quantity <= 0) throw new Error('QTY_INVALID')
        newBalance = item.quantity - quantity
        if (newBalance < 0) throw new Error('QTY_NEGATIVE')
      } else {
        // ADJUST — set to absolute value
        if (quantity < 0) throw new Error('QTY_INVALID')
        newBalance = quantity
      }

      // StockTransaction has no `txnId` / `relatedAssetNo` columns. The schema
      // uses `txnNumber` (the human-facing document number) and `deviceId`
      // for the related asset. Both are nullable, so a missing value is fine.
      const txnNumber = `STX-${Date.now()}`
      const txnDate = new Date().toISOString()

      const transaction = await tx.stockTransaction.create({
        data: {
          txnNumber,
          stockItemId: id,
          productCode: item.productCode,
          productName: item.productName,
          type,
          quantity,
          balanceAfter: newBalance,
          reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null,
          deviceId:
            typeof body.relatedAssetNo === 'string' && body.relatedAssetNo.trim()
              ? body.relatedAssetNo.trim()
              : null,
          cost: body.cost != null && body.cost !== '' ? Number(body.cost) : null,
          vendor: typeof body.vendor === 'string' && body.vendor.trim() ? body.vendor.trim() : null,
          txnDate,
          performedBy: user.email,
          remark: typeof body.remark === 'string' && body.remark.trim() ? body.remark.trim() : null,
        },
      })

      const updatedItem = await tx.stockItem.update({
        where: { id },
        data: { quantity: newBalance },
      })

      return { transaction, item: updatedItem }
    })

    await logAudit(
      'STOCK_TRANSACTION',
      'StockTransaction',
      result.transaction.id,
      // StockItem uses `productName` (not `name`) and has no `itemId` column;
      // StockTransaction exposes `txnNumber` (not `txnId`) and `deviceId`
      // (not `relatedAssetNo`).
      `${type === 'IN' ? 'รับเข้า' : type === 'OUT' ? 'เบิกออก' : 'ปรับปรุง'}สต็อก "${result.item.productName}" จำนวน ${type === 'ADJUST' ? '' : type === 'OUT' ? '-' : '+'}${result.transaction.quantity} (คงเหลือ ${result.transaction.balanceAfter})`,
      {
        stockItemId: id,
        itemId: id,
        txnNumber: result.transaction.txnNumber,
        type,
        quantity: result.transaction.quantity,
        balanceAfter: result.transaction.balanceAfter,
        reason: result.transaction.reason,
        relatedAssetNo: result.transaction.deviceId,
      },
      user.email,
    )

    return NextResponse.json({ transaction: result.transaction, item: result.item }, { status: 201 })
  } catch (err: unknown) {
    const msg = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : String(err)) : 'Internal server error'
    if (msg === 'NOT_FOUND') {
      return NextResponse.json({ error: 'ไม่พบสินค้า' }, { status: 404 })
    }
    if (msg === 'FORBIDDEN') {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์ทำรายการในสาขานี้' }, { status: 403 })
    }
    if (msg === 'QTY_INVALID') {
      return NextResponse.json({ error: 'จำนวนไม่ถูกต้อง' }, { status: 400 })
    }
    if (msg === 'QTY_NEGATIVE') {
      return NextResponse.json({ error: 'จำนวนเบิกออกมากกว่าคงเหลือในสต็อก' }, { status: 400 })
    }
    console.error('POST /api/itam/stock/[id]/transaction', err)
    return NextResponse.json({ error: 'Failed to record transaction' }, { status: 500 })
  }
}
