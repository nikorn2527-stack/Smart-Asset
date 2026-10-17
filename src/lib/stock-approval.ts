import { db, getBaseClient } from '@/lib/db'
import { logAudit } from '@/lib/audit'

export type PendingAction = 'approve' | 'reject'

export interface PendingBatchInput {
  txnId: string
  action: PendingAction
  note?: string | null
  reason?: string | null
}

export interface PendingBatchResult {
  txnId: string
  action: PendingAction
  status: 'APPROVED' | 'REJECTED'
  productCode: string | null
  quantity: number
  balanceAfter: number
  txnNumber: string | null
}

export interface PendingBatchFailure {
  txnId: string
  action: PendingAction
  error: string
}

export class PendingBatchError extends Error {
  failures: PendingBatchFailure[]

  constructor(failures: PendingBatchFailure[]) {
    super('PENDING_BATCH_INVALID')
    this.name = 'PendingBatchError'
    this.failures = failures
  }
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text || null
}

/**
 * Apply a mixed batch of pending approvals/rejections atomically.
 * If one row is invalid or stock is insufficient, the entire transaction is
 * rolled back and the caller receives a per-row failure report.
 */
export async function processPendingBatch(
  inputs: PendingBatchInput[],
  actor: string,
): Promise<PendingBatchResult[]> {
  const uniqueInputs: PendingBatchInput[] = []
  const failures: PendingBatchFailure[] = []
  const seen = new Set<string>()

  for (const input of inputs) {
    const txnId = cleanText(input.txnId)
    if (!txnId) {
      failures.push({ txnId: '', action: input.action, error: 'txnId is required' })
      continue
    }
    if (input.action !== 'approve' && input.action !== 'reject') {
      failures.push({ txnId, action: input.action, error: 'action must be approve or reject' })
      continue
    }
    if (seen.has(txnId)) {
      failures.push({ txnId, action: input.action, error: 'รายการซ้ำใน batch เดียวกัน' })
      continue
    }
    seen.add(txnId)
    uniqueInputs.push({
      txnId,
      action: input.action,
      note: cleanText(input.note),
      reason: cleanText(input.reason),
    })
  }

  if (failures.length > 0) throw new PendingBatchError(failures)

  const results = await getBaseClient().$transaction(async (tx) => {
    const txResults: PendingBatchResult[] = []
    const txFailures: PendingBatchFailure[] = []

    for (const input of uniqueInputs) {
      const txn = await tx.stockTransaction.findUnique({
        where: { id: input.txnId },
        include: {
          stockItem: {
            select: {
              productCode: true,
              productName: true,
              unit: true,
              quantity: true,
            },
          },
        },
      })

      if (!txn) {
        txFailures.push({ txnId: input.txnId, action: input.action, error: 'ไม่พบรายการ' })
        continue
      }
      if (txn.approvalStatus !== 'PENDING') {
        txFailures.push({
          txnId: input.txnId,
          action: input.action,
          error: `สถานะไม่ใช่ PENDING (${txn.approvalStatus ?? '—'})`,
        })
        continue
      }

      if (input.action === 'approve') {
        if (txn.quantity > txn.stockItem.quantity) {
          txFailures.push({
            txnId: input.txnId,
            action: input.action,
            error: `สต็อกไม่เพียงพอ (คงเหลือ ${txn.stockItem.quantity} ${txn.stockItem.unit ?? ''} ต้องการ ${txn.quantity})`,
          })
          continue
        }

        const balanceAfter = txn.stockItem.quantity - txn.quantity
        await tx.stockItem.update({
          where: { id: txn.stockItemId },
          data: { quantity: balanceAfter },
        })
        await tx.stockTransaction.update({
          where: { id: txn.id },
          data: {
            approvalStatus: 'APPROVED',
            approver: actor,
            approvedAt: new Date().toISOString(),
            balanceAfter,
            remark: input.note
              ? `${txn.remark ? `${txn.remark}\n` : ''}[อนุมัติ] ${input.note}`
              : txn.remark,
          },
        })

        txResults.push({
          txnId: txn.id,
          action: input.action,
          status: 'APPROVED',
          productCode: txn.productCode,
          quantity: txn.quantity,
          balanceAfter,
          txnNumber: txn.txnNumber,
        })
      } else {
        await tx.stockTransaction.update({
          where: { id: txn.id },
          data: {
            approvalStatus: 'REJECTED',
            approver: actor,
            approvedAt: new Date().toISOString(),
            rejectReason: input.reason,
          },
        })

        txResults.push({
          txnId: txn.id,
          action: input.action,
          status: 'REJECTED',
          productCode: txn.productCode,
          quantity: txn.quantity,
          balanceAfter: txn.stockItem.quantity,
          txnNumber: txn.txnNumber,
        })
      }
    }

    if (txFailures.length > 0) throw new PendingBatchError(txFailures)
    return txResults
  })

  for (const result of results) {
    const actionLabel = result.action === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ'
    await logAudit(
      result.action === 'approve' ? 'STOCK_PENDING_APPROVE' : 'STOCK_PENDING_REJECT',
      'StockTransaction',
      result.txnId,
      `${actionLabel}คำขอเบิกออก ${result.productCode ?? ''} จำนวน ${result.quantity} (batch)`,
      {
        txnId: result.txnId,
        txnNumber: result.txnNumber,
        productCode: result.productCode,
        quantity: result.quantity,
        balanceAfter: result.balanceAfter,
        actor,
        batch: true,
      },
    )
  }

  return results
}
