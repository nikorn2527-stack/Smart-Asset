/**
 * src/lib/stock-calculation.ts — Single source of truth for stock availability
 *
 * Replaces the legacy pattern where 3 separate Apps Script apps each calculated
 * stock quantities independently (causing number mismatches).
 *
 * All stock-related calculations in the system MUST go through these functions.
 */

import { db, getBaseClient } from '@/lib/db'

/**
 * Get the available (free) stock for a StockItem.
 *
 * available = currentQuantity - (sum of pending OUT transactions)
 *
 * This is the SINGLE SOURCE OF TRUTH — no other code should calculate
 * available stock independently.
 *
 * @param stockItemId — the StockItem ID
 * @returns { available, current, pending } in units
 */
export async function getAvailableStock(stockItemId: string): Promise<{
  available: number
  current: number
  pending: number
}> {
  const item = await db.stockItem.findUnique({
    where: { id: stockItemId },
    select: { quantity: true, minQuantity: true },
  })
  if (!item) {
    return { available: 0, current: 0, pending: 0 }
  }

  const pendingAggregate = await db.stockTransaction.aggregate({
    where: {
      stockItemId,
      type: 'OUT',
      approvalStatus: 'PENDING',
    },
    _sum: { quantity: true },
  })

  const pending = pendingAggregate._sum.quantity ?? 0
  const available = Math.max(0, item.quantity - pending)

  return {
    available,
    current: item.quantity,
    pending,
  }
}

/**
 * Check if a requested quantity can be fulfilled from available stock.
 *
 * @returns { canFulfill, available, requested, shortfall }
 */
export async function canFulfillStockRequest(
  stockItemId: string,
  requestedQty: number,
): Promise<{
  canFulfill: boolean
  available: number
  requested: number
  shortfall: number
}> {
  const { available } = await getAvailableStock(stockItemId)
  const shortfall = Math.max(0, requestedQty - available)
  return {
    canFulfill: available >= requestedQty,
    available,
    requested: requestedQty,
    shortfall,
  }
}

/**
 * Create a stock reservation (pending OUT transaction) linked to a WorkOrder.
 *
 * This is the ONLY way to create a pending stock-out request from a WO.
 * It checks available stock and creates the pending transaction in one call.
 *
 * @returns the created StockTransaction, or throws if insufficient stock
 */
export async function reserveStockForWorkOrder(params: {
  stockItemId: string
  workOrderId: string
  quantity: number
  performedBy: string
  remark?: string
}): Promise<{ id: string; quantity: number; availableAfter: number }> {
  const { stockItemId, workOrderId, quantity, performedBy, remark } = params

  // Check availability
  const check = await canFulfillStockRequest(stockItemId, quantity)
  if (!check.canFulfill) {
    throw new Error(
      `สต็อกไม่เพียงพอ — ต้องการ ${quantity}, มี ${check.available} (ขาด ${check.shortfall})`,
    )
  }

  // Create pending OUT transaction linked to WO.
  // `txnDate` is a REQUIRED column (no default) — omitting it made every
  // reservation throw and roll back the whole stock reservation.
  const txn = await db.stockTransaction.create({
    data: {
      stockItemId,
      workOrderId,
      type: 'OUT',
      quantity,
      txnDate: new Date().toISOString().slice(0, 10),
      approvalStatus: 'PENDING',
      performedBy,
      remark: remark ?? `สำรองสต็อกสำหรับใบงาน`,
    },
  })

  // Get updated availability
  const { available: availableAfter } = await getAvailableStock(stockItemId)

  return {
    id: txn.id,
    quantity,
    availableAfter,
  }
}

/**
 * Batch reserve multiple stock items for a single WorkOrder.
 * Uses a transaction to ensure all-or-nothing.
 *
 * @returns array of created reservations
 */
export async function reserveStockBatchForWorkOrder(params: {
  workOrderId: string
  items: Array<{ stockItemId: string; quantity: number }>
  performedBy: string
}): Promise<Array<{ stockItemId: string; quantity: number; availableAfter: number; reserved: boolean }>> {
  const { workOrderId, items, performedBy } = params

  return await getBaseClient().$transaction(async (tx) => {
    const results: Array<{ stockItemId: string; quantity: number; availableAfter: number; reserved: boolean }> = []

    for (const item of items) {
      // Check availability within the transaction
      const stockItem = await tx.stockItem.findUnique({
        where: { id: item.stockItemId },
        select: { quantity: true },
      })
      if (!stockItem) {
        results.push({
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          availableAfter: 0,
          reserved: false,
        })
        continue
      }

      // Sum existing pending OUT within this transaction context
      const pending = await tx.stockTransaction.aggregate({
        where: {
          stockItemId: item.stockItemId,
          type: 'OUT',
          approvalStatus: 'PENDING',
        },
        _sum: { quantity: true },
      })
      const pendingQty = pending._sum.quantity ?? 0
      const available = Math.max(0, stockItem.quantity - pendingQty)

      if (available < item.quantity) {
        results.push({
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          availableAfter: available,
          reserved: false,
        })
        continue
      }

      // Create pending OUT transaction. `txnDate` is REQUIRED (no default) —
      // see the note on the single-item reservation above.
      await tx.stockTransaction.create({
        data: {
          stockItemId: item.stockItemId,
          workOrderId,
          type: 'OUT',
          quantity: item.quantity,
          txnDate: new Date().toISOString().slice(0, 10),
          approvalStatus: 'PENDING',
          performedBy,
          remark: `สำรองสต็อกสำหรับใบงาน`,
        },
      })

      results.push({
        stockItemId: item.stockItemId,
        quantity: item.quantity,
        availableAfter: available - item.quantity,
        reserved: true,
      })
    }

    // If any failed, throw to rollback the entire transaction
    const failures = results.filter((r) => !r.reserved)
    if (failures.length > 0) {
      throw new Error(
        `สต็อกไม่เพียงพอ ${failures.length} รายการ: ` +
        failures.map((f) => `${f.stockItemId} (ต้องการ ${f.quantity}, มี ${f.availableAfter})`).join(', '),
      )
    }

    return results
  })
}

/**
 * Release (cancel) a stock reservation when a WO is cancelled.
 *
 * Sets the approvalStatus to REJECTED so the stock becomes available again.
 */
export async function releaseStockReservation(params: {
  workOrderId: string
  reason: string
}): Promise<{ released: number }> {
  const result = await db.stockTransaction.updateMany({
    where: {
      workOrderId: params.workOrderId,
      approvalStatus: 'PENDING',
    },
    data: {
      approvalStatus: 'REJECTED',
      rejectReason: params.reason,
    },
  })
  return { released: result.count }
}
