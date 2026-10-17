export type StockTransactionType = 'IN' | 'OUT' | 'ADJUST'

export interface StockTransactionInput {
  type?: unknown
  quantity?: unknown
  txnDate?: unknown
}

export interface NormalizedStockTransactionInput {
  type: StockTransactionType
  quantity: number
  txnDate: string
}

export type StockTransactionValidation =
  | { ok: true; value: NormalizedStockTransactionInput }
  | {
      ok: false
      code: 'INVALID_TYPE' | 'INVALID_QUANTITY' | 'NEGATIVE_QUANTITY' | 'NON_POSITIVE_QUANTITY' | 'INVALID_DATE'
      field: 'type' | 'quantity' | 'txnDate'
    }

const TYPE_SET = new Set<StockTransactionType>(['IN', 'OUT', 'ADJUST'])
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function validIsoDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function parseQuantity(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(parsed) && Number.isFinite(parsed) ? parsed : null
}

/** Validate stock transaction input without accessing Prisma or auth state. */
export function validateStockTransactionInput(
  input: StockTransactionInput,
  defaultTxnDate = new Date().toISOString().slice(0, 10),
): StockTransactionValidation {
  const type = typeof input.type === 'string' ? input.type.trim().toUpperCase() : ''
  if (!TYPE_SET.has(type as StockTransactionType)) {
    return { ok: false, code: 'INVALID_TYPE', field: 'type' }
  }

  const quantity = parseQuantity(input.quantity)
  if (quantity === null) {
    return { ok: false, code: 'INVALID_QUANTITY', field: 'quantity' }
  }
  if (quantity < 0) {
    return { ok: false, code: 'NEGATIVE_QUANTITY', field: 'quantity' }
  }
  if ((type === 'IN' || type === 'OUT') && quantity === 0) {
    return { ok: false, code: 'NON_POSITIVE_QUANTITY', field: 'quantity' }
  }

  const txnDate = input.txnDate === undefined || input.txnDate === null || input.txnDate === ''
    ? defaultTxnDate
    : typeof input.txnDate === 'string'
      ? input.txnDate.trim()
      : ''
  if (!validIsoDate(txnDate)) {
    return { ok: false, code: 'INVALID_DATE', field: 'txnDate' }
  }

  return {
    ok: true,
    value: {
      type: type as StockTransactionType,
      quantity,
      txnDate,
    },
  }
}
