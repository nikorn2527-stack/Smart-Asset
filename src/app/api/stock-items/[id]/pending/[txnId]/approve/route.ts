import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db, getBaseClient } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { notifyPartsApproved } from '@/lib/notifications'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * POST /api/stock-items/[id]/pending/[txnId]/approve
 * Approve a pending stock-out request.
 *
 * - Sets approvalStatus='APPROVED'
 * - Reduces StockItem.quantity
 * - Sets balanceAfter to the new (post-deduction) quantity
 * - Sets approver + approvedAt
 *
 * Body: { approver?: string, note?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; txnId: string }> },
) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'STOCK_APPROVE')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id, txnId } = await params
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const approverName =
      typeof body.approver === 'string' && body.approver.trim()
        ? body.approver.trim()
        : auth.user.email
    // NOTE (PART 3 — Single User System): replace the 'admin' fallback
    // with the authenticated user's email/id once NextAuth is wired in.
    const note =
      typeof body.note === 'string' && body.note.trim()
        ? body.note.trim()
        : null

    const result = await getBaseClient().$transaction(async (tx) => {
      const txn = await tx.stockTransaction.findUnique({
        where: { id: txnId },
      })
      if (!txn) {
        throw new Error('NOT_FOUND_TXN')
      }
      if (txn.stockItemId !== id) {
        throw new Error('MISMATCH')
      }
      if (txn.approvalStatus !== 'PENDING') {
        throw new Error(
          `สถานะรายการนี้ไม่ใช่ PENDING (ปัจจุบัน: ${txn.approvalStatus ?? '—'})`,
        )
      }

      const item = await tx.stockItem.findUnique({ where: { id } })
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
          where: { id },
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

      return { item: updatedItem, txn: updatedTxn }
    })

    await logAudit(
      'STOCK_PENDING_APPROVE',
      'StockItem',
      id,
      `อนุมัติคำขอเบิกออก ${result.item.productCode} จำนวน ${result.txn.quantity} ${result.item.unit} (คงเหลือ ${result.item.quantity})`,
      {
        productCode: result.item.productCode,
        quantity: result.txn.quantity,
        balanceAfter: result.item.quantity,
        txnNumber: result.txn.txnNumber,
        txnId: result.txn.id,
        approver: approverName,
        note,
      },
      undefined,
      // NF-2: pass canonical siteCode from StockItem
      result.item.site ?? null,
    )

    // ── Notification trigger (Task ID: NOTIFY-LINE) ──
    // Send 'parts_approved' to the WO assignee (if the txn is linked to a WO).
    // We look up the WO via workOrderId / workOrderNo to find assignedTo + lineUserId.
    // NOTE (PART 3): pass actor from auth context once NextAuth lands.
    try {
      const txn = result.txn
      let wo: {
        id: string
        woNumber: string | null
        assignedTo: string | null
        lineUserId: string | null
      } | null = null
      if (txn.workOrderId) {
        wo = await db.workOrder.findUnique({
          where: { id: txn.workOrderId },
          select: {
            id: true,
            woNumber: true,
            assignedTo: true,
            lineUserId: true,
          },
        })
      } else if (txn.workOrderNo) {
        wo = await db.workOrder.findUnique({
          where: { woNumber: txn.workOrderNo },
          select: {
            id: true,
            woNumber: true,
            assignedTo: true,
            lineUserId: true,
          },
        })
      }
      await notifyPartsApproved(
        {
          productName: result.item.productName,
          quantity: result.txn.quantity,
          balanceAfter: result.item.quantity,
        },
        {
          channels: ['line-oa', 'telegram'],
          actor: approverName,
          lineUserId: wo?.lineUserId ?? undefined,
          entityId: wo?.id ?? result.txn.id,
        },
      )
    } catch (e) {
      console.error('[notifications] parts_approved trigger failed:', e)
    }

    return NextResponse.json({ data: result })
  } catch (err) {
    console.error('POST /api/stock-items/[id]/pending/[txnId]/approve', err)
    if (err instanceof Error) {
      if (err.message === 'NOT_FOUND_TXN') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      if (err.message === 'NOT_FOUND_ITEM') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      if (err.message === 'MISMATCH') {
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
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to approve request') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
