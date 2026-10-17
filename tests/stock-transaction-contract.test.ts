import { describe, expect, it } from 'vitest'
import { validateStockTransactionInput } from '@/lib/stock-transaction-contract'

describe('validateStockTransactionInput()', () => {
  it('normalizes a valid IN input without changing integer quantity', () => {
    expect(validateStockTransactionInput({
      type: ' in ',
      quantity: '2',
      txnDate: '2026-08-21',
    })).toEqual({
      ok: true,
      value: { type: 'IN', quantity: 2, txnDate: '2026-08-21' },
    })
  })

  it('rejects missing, fractional, non-finite and negative quantities', () => {
    expect(validateStockTransactionInput({ type: 'ADJUST' })).toMatchObject({
      ok: false,
      code: 'INVALID_QUANTITY',
      field: 'quantity',
    })
    expect(validateStockTransactionInput({ type: 'IN', quantity: 1.5 })).toMatchObject({
      ok: false,
      code: 'INVALID_QUANTITY',
      field: 'quantity',
    })
    expect(validateStockTransactionInput({ type: 'OUT', quantity: Number.NaN })).toMatchObject({
      ok: false,
      code: 'INVALID_QUANTITY',
      field: 'quantity',
    })
    expect(validateStockTransactionInput({ type: 'OUT', quantity: -1 })).toMatchObject({
      ok: false,
      code: 'NEGATIVE_QUANTITY',
      field: 'quantity',
    })
  })

  it('requires a positive quantity for IN/OUT but permits zero for ADJUST', () => {
    expect(validateStockTransactionInput({ type: 'IN', quantity: 0 })).toMatchObject({
      ok: false,
      code: 'NON_POSITIVE_QUANTITY',
    })
    expect(validateStockTransactionInput({ type: 'ADJUST', quantity: 0 })).toMatchObject({
      ok: true,
      value: { quantity: 0 },
    })
  })

  it('rejects unknown types and invalid dates', () => {
    expect(validateStockTransactionInput({ type: 'MOVE', quantity: 1 })).toMatchObject({
      ok: false,
      code: 'INVALID_TYPE',
    })
    expect(validateStockTransactionInput({
      type: 'IN',
      quantity: 1,
      txnDate: '2026-02-30',
    })).toMatchObject({
      ok: false,
      code: 'INVALID_DATE',
      field: 'txnDate',
    })
  })
})
