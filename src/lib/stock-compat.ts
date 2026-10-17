import type { StockItem, StockTransaction } from '@prisma/client'

/**
 * Keep the legacy stock UI contract while exposing the current ITAM-DB names.
 * `productCode`/`productName` are canonical; `itemId`/`name` are compatibility aliases.
 */
export function toCompatStockItem(item: StockItem) {
  return {
    ...item,
    itemId: item.productCode,
    name: item.productName,
  }
}

/**
 * `txnNumber` is canonical in ITAM-DB; `txnId` remains for legacy consumers.
 */
export function toCompatStockTransaction(transaction: StockTransaction) {
  return {
    ...transaction,
    txnId: transaction.txnNumber,
  }
}
