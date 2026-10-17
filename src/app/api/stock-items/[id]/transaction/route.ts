import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireAuth } from '@/lib/auth-middleware'
import { demoTag } from '@/lib/demo-mode'
import { resolveStockTransactionIdentity } from '@/lib/stock-transaction-identity'
import { validateStockTransactionInput } from '@/lib/stock-transaction-contract'
import { withSerializableRetry } from '@/lib/retry-transaction'
import { normalizeStockSourceKey, resolveWorkOrderReference } from '@/lib/stock-work-order-resolution'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/** Parse a Float; returns null when missing/invalid. */
function optFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, n)
}

/**
 * Generate the next sequential txn number for today: STX-YYYYMMDD-NNN.
 * Counts existing transactions for today and +1.
 */
async function nextTxnNumber(txnDate: string): Promise<string> {
  const ymd = txnDate.replace(/-/g, '').slice(0, 8)
  const prefix = `STX-${ymd}-`
  const txns = await db.stockTransaction.findMany({
    where: { txnNumber: { startsWith: prefix } },
    select: { txnNumber: true },
  })
  let max = 0
  for (const t of txns) {
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


  try {
    const { id } = await params
    const body = await req.json()
    const input = validateStockTransactionInput({
      type: body.type,
      quantity: body.quantity,
      txnDate: body.txnDate,
    })
    if (!input.ok) {
      return NextResponse.json(
        {
          error: 'ข้อมูล stock transaction ไม่ถูกต้อง',
          code: input.code,
          field: input.field,
        },
        { status: 400 },
      )
    }
    const { type, quantity, txnDate } = input.value
    const requiredPermission =
      type === 'IN' ? 'STOCK_IN' : type === 'OUT' ? 'STOCK_OUT' : 'STOCK_APPROVE'
    const auth = await requireAuth(req, requiredPermission)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    const actorIdentity = resolveStockTransactionIdentity(auth.user)

    const sourceKey = normalizeStockSourceKey(body.sourceKey)
    // Atomic update of StockItem.quantity + create StockTransaction.
    const result = await withSerializableRetry(async (tx) => {
      // Retry/idempotency guard: a stable sourceKey must never apply the same
      // stock mutation twice. A reused key with different intent is rejected.
      if (sourceKey) {
        const previous = await tx.stockTransaction.findFirst({
          where: { sourceKey },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
        if (previous) {
          if (previous.stockItemId !== id || previous.type !== type || previous.quantity !== quantity) {
            throw new Error('IDEMPOTENCY_CONFLICT')
          }
          const currentItem = await tx.stockItem.findUnique({ where: { id } })
          if (!currentItem) throw new Error('NOT_FOUND')
          return { item: currentItem, txn: previous, poUpdateSummary: null, idempotent: true, workOrderResolution: null }
        }
      }

      const item = await tx.stockItem.findUnique({ where: { id } })
      if (!item) {
        throw new Error('NOT_FOUND')
      }
      if (!item.active) {
        throw new Error('INACTIVE')
      }

      let newBalance: number
      if (type === 'IN') {
        newBalance = item.quantity + quantity
      } else if (type === 'OUT') {
        if (quantity > item.quantity) {
          throw new Error(
            `สต็อกไม่เพียงพอ (คงเหลือ ${item.quantity} ${item.unit})`,
          )
        }
        newBalance = item.quantity - quantity
      } else {
        // ADJUST sets the balance to the supplied quantity.
        newBalance = quantity
      }

      const updatedItem = await tx.stockItem.update({
        where: { id },
        data: { quantity: newBalance },
      })

      const txnNumber = await (async () => {
        // We need to compute the next number inside the transaction — query
        // the DB through `tx` so we see uncommitted counts.
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
      })()

      // StockItem.unitCost is a Prisma `Decimal` — coerce before multiplying.
      const cost =
        type === 'IN'
          ? optFloat(body.cost) ??
            (item.unitCost !== null ? Number(item.unitCost) * quantity : null)
          : optFloat(body.cost)

      const workOrderResolution = await resolveWorkOrderReference(
        {
          workOrderId: body.workOrderId,
          workOrderNo: body.workOrderNo,
          legacyJobNo: body.legacyJobNo,
          systemJobNo: body.systemJobNo,
          requestId: body.requestId,
        },
        {
          byId: (value) => tx.workOrder.findUnique({ where: { id: value }, select: { id: true, woNumber: true, legacyJobNo: true, systemJobNo: true, requestId: true } }),
          byWoNumber: (value) => tx.workOrder.findUnique({ where: { woNumber: value }, select: { id: true, woNumber: true, legacyJobNo: true, systemJobNo: true, requestId: true } }),
          byLegacyJobNo: async (value) => tx.workOrder.findFirst({ where: { legacyJobNo: value }, select: { id: true, woNumber: true, legacyJobNo: true, systemJobNo: true, requestId: true } }),
          bySystemJobNo: (value) => tx.workOrder.findUnique({ where: { systemJobNo: value }, select: { id: true, woNumber: true, legacyJobNo: true, systemJobNo: true, requestId: true } }),
          byRequestId: (value) => tx.workOrder.findUnique({ where: { requestId: value }, select: { id: true, woNumber: true, legacyJobNo: true, systemJobNo: true, requestId: true } }),
        },
      )
      const quarantinedWorkOrder = workOrderResolution.status === 'quarantined'

      const txn = await tx.stockTransaction.create({
        data: {
          txnNumber,
          stockItemId: id,
          type,
          quantity,
          balanceAfter: newBalance,
          reason: body.reason ? String(body.reason).trim() : null,
          // OUT requester is always the authenticated actor; client input is ignored.
          requester: type === 'OUT'
            ? actorIdentity.requester
            : body.requester
            ? String(body.requester).trim()
            : null,
          department: body.department ? String(body.department).trim() : null,
          purpose: body.purpose ? String(body.purpose).trim() : null,
          workOrderId: workOrderResolution.status === 'resolved' ? workOrderResolution.workOrder.id : null,
          workOrderNo: workOrderResolution.status === 'resolved'
            ? workOrderResolution.canonicalWorkOrderNo
            : null,
          deviceId: body.deviceId ? String(body.deviceId) : null,
          cost,
          unitCost: item.unitCost,
          vendor: body.vendor ? String(body.vendor).trim() : null,
          receiver: body.receiver ? String(body.receiver).trim() : null,
          purchaseOrderNo: body.purchaseOrderNo
            ? String(body.purchaseOrderNo).trim()
            : null,
          txnDate,
          // Audit performer is always the authenticated account; client input is ignored.
          performedBy: actorIdentity.performedBy,
          remark: body.remark ? String(body.remark).trim() : null,
          sourceKey,
          processedFlag: workOrderResolution.status === 'resolved'
            ? 'RESOLVED'
            : workOrderResolution.status === 'quarantined'
              ? 'QUARANTINED'
              : 'UNLINKED',
          rejectReason: quarantinedWorkOrder ? workOrderResolution.reason : null,
          ...demoTag(auth.user),
        },
      })

      // ── PO Receiving (Feature 3) ──
      // When this is an IN transaction linked to a PurchaseOrder via
      // `purchaseOrderNo`, find the matching PurchaseOrderItem (by PO
      // poNumber + stockItemId) and increment quantityReceived. If the
      // whole line is fulfilled, mark it complete; if every line on the
      // PO is fulfilled, set the PO status to 'received', otherwise
      // 'partial' (when at least one line has been partially received).
      let poUpdateSummary: { poId?: string; poNumber?: string; status?: string } | null = null
      if (type === 'IN' && body.purchaseOrderNo) {
        const poNumber = String(body.purchaseOrderNo).trim()
        const po = await tx.purchaseOrder.findFirst({
          where: { poNumber },
          include: { items: true },
        })
        if (po) {
          const matchedItem = po.items.find((it) => it.stockItemId === id)
          if (matchedItem) {
            const newReceived = Math.min(
              matchedItem.quantityOrdered,
              matchedItem.quantityReceived + quantity,
            )
            await tx.purchaseOrderItem.update({
              where: { id: matchedItem.id },
              data: { quantityReceived: newReceived },
            })

            // Re-fetch all items to compute the new PO status
            const refreshedItems = await tx.purchaseOrderItem.findMany({
              where: { purchaseOrderId: po.id },
            })
            const allFulfilled = refreshedItems.every(
              (it) => it.quantityReceived >= it.quantityOrdered,
            )
            const anyReceived = refreshedItems.some(
              (it) => it.quantityReceived > 0,
            )
            const nextStatus = allFulfilled
              ? 'received'
              : anyReceived
              ? 'partial'
              : po.status === 'cancelled'
              ? 'cancelled'
              : 'open'
            await tx.purchaseOrder.update({
              where: { id: po.id },
              data: { status: nextStatus },
            })
            poUpdateSummary = {
              poId: po.id,
              poNumber: po.poNumber ?? poNumber,
              status: nextStatus,
            }
          }
        }
      }

      return { item: updatedItem, txn, poUpdateSummary, idempotent: false, workOrderResolution }
    })

    if (!result.idempotent) {
      const action =
        type === 'IN' ? 'STOCK_IN' : type === 'OUT' ? 'STOCK_OUT' : 'STOCK_ADJUST'
      const verb =
        type === 'IN'
          ? 'รับเข้า'
          : type === 'OUT'
          ? 'เบิกออก'
          : 'ปรับปรุงสต็อก'
      await logAudit(
        action,
        'StockItem',
        id,
        `${verb} ${result.item.productCode} จำนวน ${quantity} ${result.item.unit} (คงเหลือ ${result.item.quantity})`,
        {
          productCode: result.item.productCode,
          type,
          quantity,
          balanceAfter: result.item.quantity,
          txnNumber: result.txn.txnNumber,
          txnId: result.txn.id,
          reason: result.txn.reason,
          purchaseOrderNo: result.txn.purchaseOrderNo,
          poUpdate: result.poUpdateSummary,
          workOrderResolution: result.workOrderResolution,
        },
      )
    }

    return NextResponse.json(
      {
        data: {
          item: result.item,
          transaction: result.txn,
          poUpdate: result.poUpdateSummary,
          idempotent: result.idempotent,
          workOrderResolution: result.workOrderResolution,
        },
      },
      { status: result.idempotent ? 200 : 201 },
    )
  } catch (err) {
    console.error('POST /api/stock-items/[id]/transaction', err)
    if (err instanceof Error) {
      if (err.message === 'NOT_FOUND') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      if (err.message === 'INACTIVE') {
        return NextResponse.json(
          { error: 'สินค้านี้ถูกปิดใช้งานแล้ว' },
          { status: 400 },
        )
      }
      if (err.message === 'IDEMPOTENCY_CONFLICT') {
        return NextResponse.json(
          { error: 'sourceKey ถูกใช้กับรายการอื่นแล้ว — retry ต้องใช้ข้อมูลเดิมเท่านั้น' },
          { status: 409 },
        )
      }
      // Stock-insufficient and other business-rule errors.
      if (
        err.message.startsWith('สต็อกไม่เพียงพอ') ||
        err.message.startsWith('type ต้อง')
      ) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
    }
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to create transaction') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
