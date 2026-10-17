import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { loadAuthorizedWorkOrder } from '@/lib/wo-authz'
import { withSerializableRetry } from '@/lib/retry-transaction'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * POST /api/work-orders/[id]/parts/[txnId]/approve
 * Approve a parts request for a work order.
 *
 * - Sets approvalStatus='APPROVED'
 * - Reduces StockItem.quantity
 * - Sets balanceAfter
 *
 * Auth: requires STOCK_APPROVE at the WO's Site.
 *
 * Body: { note?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; txnId: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  // Auth: loadAuthorizedWorkOrder does the site-scoped STOCK_APPROVE check.
  // Basic auth here — wo-authz layer enforces the correct permission.
  const auth = await requireAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const { id, txnId } = await params

    // Authenticate + authorize — approving parts requires STOCK_APPROVE
    const result = await loadAuthorizedWorkOrder(req, id, 'STOCK_APPROVE')
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { wo, auth } = result

    // Approver identity comes from the authenticated session — never trust
    // a body-supplied `approver` field, which could be spoofed.
    const approverName = auth.user.email

    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const note =
      typeof body.note === 'string' && body.note.trim()
        ? body.note.trim()
        : null

    const resultTxn = await withSerializableRetry(async (tx) => {
      const txn = await tx.stockTransaction.findUnique({
        where: { id: txnId },
      })
      if (!txn) {
        throw new Error('NOT_FOUND_TXN')
      }
      // Must be linked to this work order
      const isLinked =
        txn.workOrderId === wo.id ||
        (wo.woNumber && txn.workOrderNo === wo.woNumber)
      if (!isLinked) {
        throw new Error('MISMATCH')
      }
      if (txn.approvalStatus !== 'PENDING') {
        throw new Error(
          `สถานะรายการนี้ไม่ใช่ PENDING (ปัจจุบัน: ${txn.approvalStatus ?? '—'})`,
        )
      }

      const item = await tx.stockItem.findUnique({
        where: { id: txn.stockItemId },
      })
      if (!item) {
        throw new Error('NOT_FOUND_ITEM')
      }
      if (txn.quantity > item.quantity) {
        throw new Error(
          `สต็อกไม่เพียงพอ (คงเหลือ ${item.quantity} ${item.unit} ต้องการ ${txn.quantity})`,
        )
      }

      const newBalance = item.quantity - txn.quantity

      const [updatedItem, updatedTxn] = await Promise.all([
        tx.stockItem.update({
          where: { id: item.id },
          data: { quantity: newBalance },
        }),
        tx.stockTransaction.update({
          where: { id: txnId },
          data: {
            approvalStatus: 'APPROVED',
            approver: approverName,
            approvedAt: new Date().toISOString(),
            balanceAfter: newBalance,
            remark: note
              ? (txn.remark ? txn.remark + '\n' : '') + `[อนุมัติ] ${note}`
              : txn.remark,
          },
        }),
      ])

      // Post a system message on the work order
      await tx.workOrderMessage.create({
        data: {
          workOrderId: wo.id,
          message: `อนุมัติเบิกอะไหล่: ${item.productCode} × ${txn.quantity} ${item.unit} (คงเหลือ ${newBalance})`,
          author: approverName,
          authorRole: 'system',
        },
      })

      // Check if any PENDING parts requests remain for this WO
      const remainingPending = await tx.stockTransaction.count({
        where: {
          approvalStatus: 'PENDING',
          OR: [{ workOrderId: wo.id }, { workOrderNo: wo.woNumber ?? '' }],
        },
      })

      // ── Auto-close: if all parts approved AND WO is WAITING_PARTS → auto-close ──
      // (Aligned with Apps Script syncApprovedStockOutToCompleted)
      //
      // SPRINT-2 #7 (AUDIT-API-001 #068): only auto-close if the WO has
      // an assignee. A WO with no assignedTo means no technician is
      // taking responsibility — auto-closing it would skip the
      // completion checklist (parts approval was the only gate).
      // Now we still mark parts as approved but leave the WO in
      // WAITING_PARTS + post a message telling the assigner to assign
      // someone before the WO can be completed.
      let autoClosed = false
      let autoCloseSkipped = false
      if (remainingPending === 0 && wo.status === 'WAITING_PARTS') {
        if (!wo.assignedTo) {
          // SPRINT-2 #7: don't auto-close — post a warning instead
          autoCloseSkipped = true
          await tx.workOrderMessage.create({
            data: {
              workOrderId: wo.id,
              message: '⚠️ อะไหล่ครบแล้ว แต่ยังไม่มีผู้รับผิดชอบ — กรุณามอบหมายเจ้าหน้าที่ก่อนปิดงาน',
              author: 'system-auto',
              authorRole: 'system',
            },
          })
        } else {
          const now = new Date()
          await tx.workOrder.update({
            where: { id: wo.id },
            data: {
              status: 'COMPLETED',
              workCompletedAt: now,
              closedAt: now,
            },
          })
          autoClosed = true
          // Post system message about auto-close
          await tx.workOrderMessage.create({
            data: {
              workOrderId: wo.id,
              message: '✅ ระบบปิดงานอัตโนมัติหลังอนุมัติเบิกอะไหล่ครบ',
              author: 'system-auto',
              authorRole: 'system',
            },
          })
        }
      }

      return {
        item: updatedItem,
        txn: updatedTxn,
        remainingPending,
        autoClosed,
        autoCloseSkipped, // SPRINT-2 #7: true when parts all approved but no assignee
      }
    })

    // Audit logs (non-transactional — best effort)
    try {
      await db.auditLog.create({
        data: {
          action: 'WO_PARTS_APPROVE',
          entity: 'WorkOrder',
          entityId: wo.id,
          summary: `อนุมัติเบิกอะไหล่ ${resultTxn.item.productCode} × ${resultTxn.txn.quantity} ${resultTxn.item.unit} สำหรับ ${wo.woNumber ?? wo.id}`,
          detail: JSON.stringify({
            woNumber: wo.woNumber,
            productCode: resultTxn.item.productCode,
            quantity: resultTxn.txn.quantity,
            balanceAfter: resultTxn.item.quantity,
            txnNumber: resultTxn.txn.txnNumber,
            approver: approverName,
            note,
            remainingPending: resultTxn.remainingPending,
          }),
          actor: approverName,
          // NF-2: pass canonical siteCode from WorkOrder
          siteCode: wo.siteCode ?? result.woSite,
        },
      })
    } catch (e) {
      console.error('audit log failed', e)
    }

    return NextResponse.json({
      data: {
        transaction: resultTxn.txn,
        stockItem: resultTxn.item,
        remainingPending: resultTxn.remainingPending,
        allPartsApproved: resultTxn.remainingPending === 0,
        autoClosed: resultTxn.autoClosed,
      },
    })
  } catch (err) {
    console.error('POST /api/work-orders/[id]/parts/[txnId]/approve', err)
    if (err instanceof Error) {
      if (
        err.message === 'NOT_FOUND_TXN' ||
        err.message === 'NOT_FOUND_ITEM' ||
        err.message === 'MISMATCH'
      ) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      if (
        err.message.startsWith('สถานะรายการนี้') ||
        err.message.startsWith('สต็อกไม่เพียงพอ')
      ) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
    }
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to approve parts request') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
