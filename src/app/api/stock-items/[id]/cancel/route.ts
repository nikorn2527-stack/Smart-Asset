import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db, getBaseClient } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// ============================================================
// Cancel Document Flow (Feature 4)
//   POST /api/stock-items/[id]/cancel
//   Body: { txnNumber?, reason }  →  cancel a StockTransaction (OUT)
//         { poNumber?, reason }   →  cancel a PurchaseOrder
//
// Canceling an OUT transaction:
//   1. Restore stock: StockItem.quantity += txn.quantity
//   2. Set original transaction approvalStatus = 'CANCELLED'
//   3. Create a new ADJUST transaction with remark `ยกเลิก ${txnNumber}`
//      (balanceAfter = restored quantity, so the audit trail stays clean)
//
// Canceling a PurchaseOrder:
//   1. Block if ANY PurchaseOrderItem has quantityReceived > 0
//   2. Set PurchaseOrder.status = 'cancelled'
//   3. (PurchaseOrderItem.quantityRemaining is computed on read; setting
//      status=cancelled signals the UI to no longer accept receives.)
// ============================================================

function optStr(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s || null
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

async function nextTxnNumber(tx: Parameters<Parameters<ReturnType<typeof getBaseClient>['$transaction']>[0]>[0], txnDate: string): Promise<string> {
  const ymd = txnDate.replace(/-/g, '').slice(0, 8)
  const prefix = `STX-${ymd}-`
  const existing = await tx.stockTransaction.findMany({
    where: { txnNumber: { startsWith: prefix } },
    select: { txnNumber: true },
  })
  let max = 0
  for (const t of existing) {
    if (!t.txnNumber) continue
    const m = /^STX-\d{8}-(\d+)$/.exec(t.txnNumber)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

export async function POST(
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
    const { id: stockItemId } = await params
    const body = await req.json()
    const reason = optStr(body.reason) ?? 'ยกเลิกเอกสาร'
    const txnNumber = optStr(body.txnNumber)
    const poNumber = optStr(body.poNumber)

    // ── Cancel a StockTransaction (OUT) ──
    if (txnNumber) {
      const txn = await db.stockTransaction.findFirst({
        where: { txnNumber },
        include: { stockItem: true },
      })
      if (!txn) {
        return NextResponse.json({ error: 'ไม่พบเอกสารที่ต้องการยกเลิก' }, { status: 404 })
      }
      if (txn.approvalStatus === 'CANCELLED') {
        return NextResponse.json({ error: 'เอกสารนี้ถูกยกเลิกไปแล้ว' }, { status: 400 })
      }
      // Only OUT transactions need stock restoration. IN cancellations would
      // require backing out received goods (complex — typically handled by
      // a separate adjustment), and ADJUST cancellations are no-ops.
      if (txn.type !== 'OUT') {
        return NextResponse.json(
          { error: `ยกเลิกได้เฉพาะเอกสารเบิกออก (OUT) เท่านั้น — ประเภทปัจจุบัน: ${txn.type}` },
          { status: 400 },
        )
      }
      if (txn.stockItemId !== stockItemId) {
        return NextResponse.json(
          { error: 'txnNumber ไม่ตรงกับ stockItemId ใน URL' },
          { status: 400 },
        )
      }

      const result = await getBaseClient().$transaction(async (tx) => {
        const item = await tx.stockItem.findUnique({ where: { id: stockItemId } })
        if (!item) throw new Error('NOT_FOUND')

        // Restore stock
        const newBalance = item.quantity + txn.quantity
        const updatedItem = await tx.stockItem.update({
          where: { id: stockItemId },
          data: { quantity: newBalance },
        })

        // Mark original as cancelled
        const updatedTxn = await tx.stockTransaction.update({
          where: { id: txn.id },
          data: {
            approvalStatus: 'CANCELLED',
            rejectReason: reason,
            remark: [txn.remark ?? '', `ยกเลิก: ${reason}`].filter(Boolean).join(' | '),
          },
        })

        // Create a compensating ADJUST transaction so the audit trail
        // shows the restored balance.
        const newTxnNumber = await nextTxnNumber(tx, todayISO())
        const adjustTxn = await tx.stockTransaction.create({
          data: {
            txnNumber: newTxnNumber,
            stockItemId,
            type: 'ADJUST',
            quantity: newBalance,
            balanceAfter: newBalance,
            reason: `ยกเลิก ${txnNumber}`,
            remark: `คืนสต็อกจากการยกเลิกเอกสาร ${txnNumber} — ${reason}`,
            txnDate: todayISO(),
            performedBy: optStr(body.performedBy),
            approvalStatus: 'APPROVED',
          },
        })

        return { item: updatedItem, originalTxn: updatedTxn, adjustTxn }
      })

      await logAudit(
        'STOCK_CANCEL',
        'StockTransaction',
        txn.id,
        `ยกเลิกเอกสารเบิกออก ${txnNumber} (คืนสต็อก ${txn.quantity} ${result.item.unit}, คงเหลือ ${result.item.quantity})`,
        {
          txnNumber,
          reason,
          restoredQuantity: txn.quantity,
          newBalance: result.item.quantity,
          adjustTxnNumber: result.adjustTxn.txnNumber,
        },
      )

      return NextResponse.json({
        data: {
          cancelledTxnId: result.originalTxn.id,
          adjustTxnId: result.adjustTxn.id,
          adjustTxnNumber: result.adjustTxn.txnNumber,
          newBalance: result.item.quantity,
        },
      })
    }

    // ── Cancel a PurchaseOrder ──
    if (poNumber) {
      const po = await db.purchaseOrder.findFirst({
        where: { poNumber },
        include: { items: true },
      })
      if (!po) {
        return NextResponse.json({ error: 'ไม่พบใบสั่งซื้อ' }, { status: 404 })
      }
      if (po.status === 'cancelled') {
        return NextResponse.json({ error: 'ใบสั่งซื้อนี้ถูกยกเลิกไปแล้ว' }, { status: 400 })
      }
      if (po.status === 'received') {
        return NextResponse.json(
          { error: 'ไม่สามารถยกเลิกใบสั่งซื้อที่รับครบแล้ว' },
          { status: 400 },
        )
      }
      const hasReceived = po.items.some((it) => it.quantityReceived > 0)
      if (hasReceived) {
        return NextResponse.json(
          {
            error:
              'ไม่สามารถยกเลิกได้ — มีรายการที่รับสินค้าไปแล้ว กรุณาคืนสินค้าก่อน (สร้างเอกสาร OUT)',
          },
          { status: 400 },
        )
      }

      const updated = await db.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status: 'cancelled',
          remark: [po.remark ?? '', `ยกเลิก: ${reason}`].filter(Boolean).join(' | '),
        },
      })

      await logAudit(
        'PO_CANCEL',
        'PurchaseOrder',
        po.id,
        `ยกเลิกใบสั่งซื้อ ${poNumber}`,
        { poNumber, reason, actor: optStr(body.performedBy) },
      )

      return NextResponse.json({ data: updated })
    }

    return NextResponse.json(
      { error: 'กรุณาระบุ txnNumber หรือ poNumber' },
      { status: 400 },
    )
  } catch (err) {
    console.error('POST /api/stock-items/[id]/cancel', err)
    if (err instanceof Error && err.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to cancel') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
