/**
 * cost-model.ts — shared cost calculation + cost-model helpers.
 *
 * Supports 5 cost models:
 *   'fixed'      — one-time cost per unit (default, backward compat)
 *   'per-page'   — cost = pages × ratePerPage
 *   'per-hour'   — cost = hours × ratePerHour
 *   'monthly'    — flat monthly fee (rate per month)
 *   'per-device' — cost per device serviced (rate per device)
 *
 * The cost model is set on `StockItem.costModel`. The rate fields are:
 *   - 'fixed'      → `StockItem.unitCost`
 *   - 'per-page'   → `StockItem.ratePerPage`
 *   - 'per-hour'   → `StockItem.ratePerHour`
 *   - 'monthly'    → `StockItem.ratePerMonth`
 *   - 'per-device' → `StockItem.ratePerDevice`
 *
 * When a `StockTransaction` is created, the cost is computed from the
 * usage stats on that txn (`usageQuantity`, `usageHours`, `usagePages`,
 * `usageDevices`). For 'monthly' model, the txn's cost is just
 * `ratePerMonth` (charged once per month regardless of usage).
 *
 * The helper also extracts `defaultUsageForItem(item)` so the parts picker
 * UI can pre-fill `usageQuantity` based on the item's
 * `expectedDevicesPerUnit` / `expectedPagesPerUnit` / `expectedHoursPerUnit`.
 */

import type { Prisma } from '@prisma/client'

export type CostModel = 'fixed' | 'per-page' | 'per-hour' | 'monthly' | 'per-device'

export const COST_MODELS: CostModel[] = ['fixed', 'per-page', 'per-hour', 'monthly', 'per-device']

export const COST_MODEL_LABELS: Record<CostModel, string> = {
  'fixed': 'ราคาต่อหน่วย (คงที่)',
  'per-page': 'ราคาต่อหน้าพิมพ์',
  'per-hour': 'ราคาต่อชั่วโมง',
  'monthly': 'ราคาเหมารายเดือน',
  'per-device': 'ราคาต่อเครื่องที่บริการ',
}

export const COST_MODEL_DESCRIPTIONS: Record<CostModel, string> = {
  'fixed': 'เช่น ตลับหมึก, อะไหล่ — คิดราคาเต็มของ 1 ชิ้น',
  'per-page': 'เช่น สัญญาเช่าพิมพ์ — คิดตามจำนวนหน้าที่พิมพ์จริง',
  'per-hour': 'เช่น อุปกรณ์เช่ารายชั่วโมง — คิดตามชั่วโมงการใช้งาน',
  'monthly': 'เช่น ค่าบำรุงรักษารายเดือน — ค่าเหมาไม่นับการใช้งาน',
  'per-device': 'เช่น ค่าบริการต่อเครื่อง — คิดตามจำนวนเครื่องที่เข้ารับบริการ',
}

/**
 * Normalize a cost model string. Returns 'fixed' if null/unknown (backward compat).
 */
export function normalizeCostModel(s: string | null | undefined): CostModel {
  if (!s) return 'fixed'
  const lower = s.toLowerCase()
  if ((COST_MODELS as string[]).includes(lower)) return lower as CostModel
  return 'fixed'
}

/**
 * Pick the rate field value for the given cost model.
 */
export function getRateForModel(
  item: {
    unitCost?: Prisma.Decimal | number | null
    ratePerPage?: Prisma.Decimal | number | null
    ratePerHour?: Prisma.Decimal | number | null
    ratePerMonth?: Prisma.Decimal | number | null
    ratePerDevice?: Prisma.Decimal | number | null
  },
  model: CostModel,
): number | null {
  const toNum = (v: Prisma.Decimal | number | null | undefined): number | null => {
    if (v === null || v === undefined) return null
    if (typeof v === 'number') return v
    return Number(v)
  }
  switch (model) {
    case 'fixed': return toNum(item.unitCost)
    case 'per-page': return toNum(item.ratePerPage)
    case 'per-hour': return toNum(item.ratePerHour)
    case 'monthly': return toNum(item.ratePerMonth)
    case 'per-device': return toNum(item.ratePerDevice)
    default: return toNum(item.unitCost)
  }
}

/**
 * Calculate the cost of a StockTransaction based on its cost model + usage stats.
 *
 *   - 'fixed'      → unitCost × usageQuantity (or qty if usage is null)
 *   - 'per-page'   → ratePerPage × usagePages (or yieldPerPage as fallback)
 *   - 'per-hour'   → ratePerHour × usageHours
 *   - 'monthly'    → ratePerMonth (charged once, regardless of usage)
 *   - 'per-device' → ratePerDevice × usageDevices (default 1)
 *
 * Returns null if no rate is configured (caller should leave cost null).
 */
export function calculateCost(
  item: {
    costModel?: string | null
    unitCost?: Prisma.Decimal | number | null
    ratePerPage?: Prisma.Decimal | number | null
    ratePerHour?: Prisma.Decimal | number | null
    ratePerMonth?: Prisma.Decimal | number | null
    ratePerDevice?: Prisma.Decimal | number | null
  },
  usage: {
    quantity?: number | null
    usageQuantity?: number | null
    usageHours?: number | null
    usagePages?: number | null
    usageDevices?: number | null
  },
): number | null {
  const model = normalizeCostModel(item.costModel)
  const rate = getRateForModel(item, model)
  if (rate === null) return null

  const usageQty = usage.usageQuantity ?? usage.quantity ?? 1

  switch (model) {
    case 'fixed':
      return Number((rate * usageQty).toFixed(2))
    case 'per-page': {
      const pages = usage.usagePages ?? 0
      if (pages <= 0) return null  // need page count
      return Number((rate * pages).toFixed(2))
    }
    case 'per-hour': {
      const hours = usage.usageHours ?? 0
      if (hours <= 0) return null  // need hours
      return Number((rate * hours).toFixed(2))
    }
    case 'monthly':
      // Flat fee, charged once per txn.
      return Number(rate.toFixed(2))
    case 'per-device': {
      const devices = usage.usageDevices ?? 1
      return Number((rate * devices).toFixed(2))
    }
    default:
      return null
  }
}

/**
 * Compute default usageQuantity + usageUnit + usageHours + usagePages for a
 * stock item, based on its `expectedDevicesPerUnit` / `expectedHoursPerUnit`
 * / `expectedPagesPerUnit`. Used by the parts picker UI to pre-fill values.
 *
 * Defaults:
 *   - If `expectedDevicesPerUnit > 0` → usageQuantity = 1 / expectedDevicesPerUnit
 *     (e.g. ink bottle that fills 3 devices → 0.333).
 *   - If `expectedHoursPerUnit > 0` → usageHours = expectedHoursPerUnit (full
 *     charge), usageQuantity = 1.
 *   - If `expectedPagesPerUnit > 0` → usagePages = expectedPagesPerUnit,
 *     usageQuantity = 1.
 *   - Else (no expected values) → usageQuantity = 1 (1:1).
 */
export function defaultUsageForItem(
  item: {
    expectedDevicesPerUnit?: number | null
    expectedHoursPerUnit?: number | null
    expectedPagesPerUnit?: number | null
    category?: string | null
  },
): {
  usageQuantity: number
  usageUnit: string
  usageHours: number | null
  usagePages: number | null
} {
  const ed = item.expectedDevicesPerUnit ?? 0
  const eh = item.expectedHoursPerUnit ?? 0
  const ep = item.expectedPagesPerUnit ?? 0

  if (ed > 0) {
    return {
      usageQuantity: Math.round((1 / ed) * 1000) / 1000,
      usageUnit: 'fraction',
      usageHours: null,
      usagePages: null,
    }
  }
  if (eh > 0) {
    return {
      usageQuantity: 1,
      usageUnit: 'unit',
      usageHours: eh,
      usagePages: null,
    }
  }
  if (ep > 0) {
    return {
      usageQuantity: 1,
      usageUnit: 'unit',
      usageHours: null,
      usagePages: ep,
    }
  }
  // Fallback: use category-based default (legacy behavior).
  const cat = (item.category ?? '').toUpperCase()
  if (cat.includes('INK') || cat.includes('TONER') || cat.includes('BOTTLE')) {
    return { usageQuantity: 0.333, usageUnit: 'bottle', usageHours: null, usagePages: null }
  }
  if (cat.includes('CARTRIDGE') || cat.includes('DRUM')) {
    return { usageQuantity: 1, usageUnit: 'cartridge', usageHours: null, usagePages: null }
  }
  return { usageQuantity: 1, usageUnit: 'unit', usageHours: null, usagePages: null }
}
