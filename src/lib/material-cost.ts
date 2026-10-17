/**
 * material-cost.ts — Material & Consumable Cost Calculation Engine
 *
 * Spec: upload/COST-ANALYTICS-SPEC.md (Phase 2)
 *
 * Cost types:
 *   consumable  → yieldPerPage (แผ่น/ขวด สำหรับหมึก) → ต้นทุน/แผ่น = unitCost ÷ yieldPerPage
 *   spare_part  → depreciationMethod:
 *                  straight_line → usefulLifeMonths → ต้นทุน/เดือน = unitCost ÷ usefulLifeMonths
 *                  usage_based   → usefulLifePages  → ต้นทุน/แผ่น = unitCost ÷ usefulLifePages
 *   service     → ตรงตัว unitCost × quantity
 *
 * Used by:
 *   - /api/cost-analytics/material (Phase 3 monthly report + reconciliation)
 *   - WO Detail Sheet (Phase 2 — แสดงต้นทุนรวมต่อใบงาน)
 *   - Stock OUT auto-cost save (Phase 2 — บันทึก cost/unitCost ตอนเบิก)
 *
 * IMPORTANT: B4 frozen files (retry-transaction.ts, wo-authz.ts,
 * authorization-context.ts, auth-middleware.ts, auth-shared.ts, audit.ts)
 * must NOT be modified. This file is NEW (not frozen).
 */

import type { StockItem, StockTransaction } from '@prisma/client'

// ── Types ─────────────────────────────────────────────────────────────

/**
 * Coerce a Prisma Decimal (which serializes to string over JSON) to a JS number.
 * Returns null if the value is null/undefined/NaN. This is the root-cause fix
 * for "Drum ฿30,003,000" bug where "3000"+"3000" produced string concat.
 */
function toNumber(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    // Strip non-numeric chars (commas, baht sign, whitespace) then parse
    const cleaned = v.replace(/[^0-9.\-]/g, '')
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }
  // Decimal instance from Prisma has .toNumber() — try it
  if (typeof v === 'object' && v !== null && 'toNumber' in v && typeof (v as { toNumber: unknown }).toNumber === 'function') {
    try {
      const n = (v as { toNumber: () => number }).toNumber()
      return Number.isFinite(n) ? n : null
    } catch {
      return null
    }
  }
  return null
}

export type CostType = 'consumable' | 'spare_part' | 'service'
export type DepreciationMethod = 'straight_line' | 'usage_based'

/** A stock item with the cost-relevant fields. */
export interface CostedStockItem {
  id: string
  productCode: string
  productName: string
  category: string | null
  unitCost: number | null
  costType: string | null
  yieldPerPage: number | null
  depreciationMethod: string | null
  usefulLifeMonths: number | null
  usefulLifePages: number | null
  unit: string | null
}

/** A line item in a work order's material cost summary. */
export interface MaterialCostLine {
  transactionId: string
  stockItemId: string
  productCode: string | null
  productName: string | null
  category: string | null
  costType: string | null
  quantity: number
  unitCost: number | null
  /** Total line cost = unitCost × quantity */
  lineCost: number
  /** For consumable: cost per page (= unitCost ÷ yieldPerPage) */
  costPerPage: number | null
  /** For spare_part straight_line: cost per month */
  costPerMonth: number | null
  /** For spare_part usage_based: cost per page */
  costPerPageSpare: number | null
  /** Coverage pages (consumable only) = quantity × yieldPerPage */
  coveragePages: number | null
  workOrderNo: string | null
  deviceId: string | null
  txnDate: string
}

export interface WorkOrderCostSummary {
  workOrderNo: string | null
  workOrderId: string | null
  /** Ink/consumable total = Σ(unitCost × qty) for consumable items */
  inkTotal: number
  /** Spare parts total = Σ(unitCost × qty) for spare_part items */
  sparePartTotal: number
  /** Service total = Σ(unitCost × qty) for service items */
  serviceTotal: number
  /** Grand total = ink + spare + service */
  grandTotal: number
  /** Average cost per page across all consumable items (weighted) */
  avgInkCostPerPage: number | null
  /** Total ink coverage pages (sum of quantity × yieldPerPage) */
  totalInkCoveragePages: number
  lines: MaterialCostLine[]
}

export interface MonthlyInkCostItem {
  stockItemId: string
  productCode: string
  productName: string
  totalBottles: number
  unitCost: number | null
  totalCost: number
  yieldPerPage: number | null
  costPerPage: number | null
  coveragePages: number | null
}

export interface MonthlySparePartItem {
  stockItemId: string
  productCode: string
  productName: string
  totalItems: number
  unitCost: number | null
  totalCost: number
  depreciationMethod: string | null
  usefulLifeMonths: number | null
  usefulLifePages: number | null
  costPerMonth: number | null
  costPerPage: number | null
}

export interface MonthlyServiceItem {
  stockItemId: string
  productCode: string
  productName: string
  totalQuantity: number
  unitCost: number | null
  totalCost: number
}

export interface Reconciliation {
  /** แผ่นที่หมึกครอบคลุม = Σ(quantity × yieldPerPage) ของหมึกที่เบิก */
  inkCoveragePages: number
  /** แผ่นที่พิมพ์จริงจากมิเตอร์ */
  actualPrintedPages: number
  /** ส่วนต่าง (แผ่น) = inkCoveragePages - actualPrintedPages */
  difference: number
  /** ส่วนต่างเป็น % (ของ inkCoveragePages) */
  differencePercent: number
  /** ต้นทุน/แผ่นจากสต็อก = totalInkCost ÷ inkCoveragePages */
  stockCostPerPage: number | null
  /** ต้นทุน/แผ่นจากมิเตอร์ (paper rate) */
  meterCostPerPage: number | null
  /** ส่วนต่างต้นทุน/แผ่น = stockCostPerPage - meterCostPerPage */
  costPerPageDiff: number | null
}

export interface MaterialCostReport {
  month: string // YYYY-MM
  ink: {
    totalBottles: number
    totalCost: number
    avgCostPerPage: number | null
    items: MonthlyInkCostItem[]
  }
  spareParts: {
    totalItems: number
    totalCost: number
    monthlyDepreciation: number
    items: MonthlySparePartItem[]
  }
  service: {
    totalCost: number
    items: MonthlyServiceItem[]
  }
  totalCost: number
  reconciliation: Reconciliation
}

// ── Calculation primitives ───────────────────────────────────────────

/** ต้นทุนหมึกต่อแผ่น = unitCost ÷ yieldPerPage */
export function calcInkCostPerPage(
  unitCost: number | null | undefined,
  yieldPerPage: number | null | undefined,
): number | null {
  if (!unitCost || !yieldPerPage || yieldPerPage <= 0) return null
  return Math.round((unitCost / yieldPerPage) * 1000) / 1000
}

/** ต้นทุนอะไหล่ต่อเดือน (straight_line) = unitCost ÷ usefulLifeMonths */
export function calcSparePartCostPerMonth(
  unitCost: number | null | undefined,
  usefulLifeMonths: number | null | undefined,
): number | null {
  if (!unitCost || !usefulLifeMonths || usefulLifeMonths <= 0) return null
  return Math.round((unitCost / usefulLifeMonths) * 100) / 100
}

/** ต้นทุนอะไหล่ต่อแผ่น (usage_based) = unitCost ÷ usefulLifePages */
export function calcSparePartCostPerPage(
  unitCost: number | null | undefined,
  usefulLifePages: number | null | undefined,
): number | null {
  if (!unitCost || !usefulLifePages || usefulLifePages <= 0) return null
  return Math.round((unitCost / usefulLifePages) * 10000) / 10000
}

/** ต้นทุนรวม line = unitCost × quantity */
export function calcLineCost(
  unitCost: number | null | undefined,
  quantity: number,
): number {
  if (unitCost == null || quantity <= 0) return 0
  return Math.round(unitCost * quantity * 100) / 100
}

/** แผ่นที่หมึกครอบคลุม = quantity × yieldPerPage */
export function calcInkCoveragePages(
  quantity: number,
  yieldPerPage: number | null | undefined,
): number | null {
  if (!yieldPerPage || yieldPerPage <= 0 || quantity <= 0) return null
  return quantity * yieldPerPage
}

// ── Work Order cost summary (Phase 2) ────────────────────────────────

/**
 * คำนวณต้นทุนรวมต่อใบงาน — รวมหมึก + อะไหล่ + บริการ
 * รับ transactions ของใบงานนั้น (type=OUT, workOrderId ตรง) + stockItem map
 */
export function calcWorkOrderCost(
  workOrderNo: string | null,
  workOrderId: string | null,
  transactions: Array<
    Pick<StockTransaction, 'id' | 'stockItemId' | 'productCode' | 'productName' | 'quantity' | 'unitCost' | 'cost' | 'workOrderNo' | 'deviceId' | 'txnDate'>
  >,
  stockItemMap: Map<string, CostedStockItem>,
): WorkOrderCostSummary {
  const lines: MaterialCostLine[] = []
  let inkTotal = 0
  let sparePartTotal = 0
  let serviceTotal = 0
  let totalInkCoveragePages = 0

  for (const tx of transactions) {
    const item = stockItemMap.get(tx.stockItemId)
    // Cast via toNumber() because Prisma Decimal serializes to string in JSON,
    // which causes string concat instead of numeric addition.
    const itemUnitCost = toNumber(item?.unitCost)
    const itemYieldPerPage = toNumber(item?.yieldPerPage)
    const itemUsefulLifeMonths = toNumber(item?.usefulLifeMonths)
    const itemUsefulLifePages = toNumber(item?.usefulLifePages)
    const unitCost = toNumber(tx.unitCost) ?? itemUnitCost
    const quantity = toNumber(tx.quantity) ?? 0
    const lineCost = toNumber(tx.cost) ?? calcLineCost(unitCost, quantity)
    const costType = item?.costType ?? null
    const yieldPerPage = itemYieldPerPage
    const depMethod = item?.depreciationMethod ?? null
    const lifeMonths = itemUsefulLifeMonths
    const lifePages = itemUsefulLifePages

    let costPerPage: number | null = null
    let costPerMonth: number | null = null
    let costPerPageSpare: number | null = null
    let coveragePages: number | null = null

    if (costType === 'consumable') {
      costPerPage = calcInkCostPerPage(unitCost, yieldPerPage)
      coveragePages = calcInkCoveragePages(quantity, yieldPerPage)
      if (coveragePages) totalInkCoveragePages += coveragePages
      inkTotal += lineCost
    } else if (costType === 'spare_part') {
      if (depMethod === 'straight_line') {
        costPerMonth = calcSparePartCostPerMonth(unitCost, lifeMonths)
      } else if (depMethod === 'usage_based') {
        costPerPageSpare = calcSparePartCostPerPage(unitCost, lifePages)
      }
      sparePartTotal += lineCost
    } else if (costType === 'service') {
      serviceTotal += lineCost
    } else {
      // Unknown costType — เก็บใน service bucket (fallback)
      serviceTotal += lineCost
    }

    lines.push({
      transactionId: tx.id,
      stockItemId: tx.stockItemId,
      productCode: tx.productCode ?? item?.productCode ?? null,
      productName: tx.productName ?? item?.productName ?? null,
      category: item?.category ?? null,
      costType,
      quantity,
      unitCost,
      lineCost,
      costPerPage,
      costPerMonth,
      costPerPageSpare,
      coveragePages,
      workOrderNo: tx.workOrderNo,
      deviceId: tx.deviceId,
      txnDate: tx.txnDate,
    })
  }

  // Weighted average cost per page (for ink)
  const totalInkCost = inkTotal
  const avgInkCostPerPage =
    totalInkCoveragePages > 0 && totalInkCost > 0
      ? Math.round((totalInkCost / totalInkCoveragePages) * 1000) / 1000
      : null

  return {
    workOrderNo,
    workOrderId,
    inkTotal: Math.round(inkTotal * 100) / 100,
    sparePartTotal: Math.round(sparePartTotal * 100) / 100,
    serviceTotal: Math.round(serviceTotal * 100) / 100,
    grandTotal: Math.round((inkTotal + sparePartTotal + serviceTotal) * 100) / 100,
    avgInkCostPerPage,
    totalInkCoveragePages,
    lines,
  }
}

// ── Monthly cost aggregation (Phase 3) ───────────────────────────────

/**
 * คำนวณต้นทุนวัสดุรายเดือน — รับ transactions ทั้งเดือน (type=OUT)
 * คืน ink + spareParts + service breakdown + reconciliation data
 *
 * @param monthOutTxns — transactions ในเดือนนั้นที่ type=OUT
 * @param stockItemMap — id → CostedStockItem map (สำหรับ lookup costType/yield)
 * @param actualPrintedPages — แผ่นที่พิมพ์จริงจากมิเตอร์ในเดือนนั้น
 * @param meterCostPerPage — paper rate (฿/แผ่น) เฉลี่ยจากมิเตอร์
 */
export function calcMonthlyMaterialCost(
  monthOutTxns: Array<
    Pick<StockTransaction, 'id' | 'stockItemId' | 'productCode' | 'productName' | 'quantity' | 'unitCost' | 'cost'>
  >,
  stockItemMap: Map<string, CostedStockItem>,
  actualPrintedPages: number,
  meterCostPerPage: number | null,
  month: string,
): MaterialCostReport {
  // Aggregate by stockItemId for each cost type bucket
  const inkByItem = new Map<string, MonthlyInkCostItem>()
  const spareByItem = new Map<string, MonthlySparePartItem>()
  const serviceByItem = new Map<string, MonthlyServiceItem>()

  for (const tx of monthOutTxns) {
    const item = stockItemMap.get(tx.stockItemId)
    // Cast via toNumber() because Prisma Decimal serializes to string in JSON.
    const itemUnitCost = toNumber(item?.unitCost)
    const itemYieldPerPage = toNumber(item?.yieldPerPage)
    const itemUsefulLifeMonths = toNumber(item?.usefulLifeMonths)
    const itemUsefulLifePages = toNumber(item?.usefulLifePages)
    const unitCost = toNumber(tx.unitCost) ?? itemUnitCost
    const quantity = toNumber(tx.quantity) ?? 0
    const lineCost = toNumber(tx.cost) ?? calcLineCost(unitCost, quantity)
    const costType = item?.costType ?? null

    if (costType === 'consumable') {
      const key = tx.stockItemId
      const cur = inkByItem.get(key) ?? {
        stockItemId: tx.stockItemId,
        productCode: tx.productCode ?? item?.productCode ?? '',
        productName: tx.productName ?? item?.productName ?? '',
        totalBottles: 0,
        unitCost,
        totalCost: 0,
        yieldPerPage: itemYieldPerPage,
        costPerPage: calcInkCostPerPage(unitCost, itemYieldPerPage),
        coveragePages: null,
      }
      cur.totalBottles += quantity
      cur.totalCost = Math.round((cur.totalCost + lineCost) * 100) / 100
      inkByItem.set(key, cur)
    } else if (costType === 'spare_part') {
      const key = tx.stockItemId
      const cur = spareByItem.get(key) ?? {
        stockItemId: tx.stockItemId,
        productCode: tx.productCode ?? item?.productCode ?? '',
        productName: tx.productName ?? item?.productName ?? '',
        totalItems: 0,
        unitCost,
        totalCost: 0,
        depreciationMethod: item?.depreciationMethod ?? null,
        usefulLifeMonths: itemUsefulLifeMonths,
        usefulLifePages: itemUsefulLifePages,
        costPerMonth:
          item?.depreciationMethod === 'straight_line'
            ? calcSparePartCostPerMonth(unitCost, itemUsefulLifeMonths)
            : null,
        costPerPage:
          item?.depreciationMethod === 'usage_based'
            ? calcSparePartCostPerPage(unitCost, itemUsefulLifePages)
            : null,
      }
      cur.totalItems += quantity
      cur.totalCost = Math.round((cur.totalCost + lineCost) * 100) / 100
      spareByItem.set(key, cur)
    } else if (costType === 'service') {
      const key = tx.stockItemId
      const cur = serviceByItem.get(key) ?? {
        stockItemId: tx.stockItemId,
        productCode: tx.productCode ?? item?.productCode ?? '',
        productName: tx.productName ?? item?.productName ?? '',
        totalQuantity: 0,
        unitCost,
        totalCost: 0,
      }
      cur.totalQuantity += quantity
      cur.totalCost = Math.round((cur.totalCost + lineCost) * 100) / 100
      serviceByItem.set(key, cur)
    }
  }

  const inkItems = Array.from(inkByItem.values())
  const spareItems = Array.from(spareByItem.values())
  const serviceItems = Array.from(serviceByItem.values())

  // Compute coveragePages for each ink item
  for (const it of inkItems) {
    it.coveragePages = it.yieldPerPage ? it.totalBottles * it.yieldPerPage : null
  }

  const inkTotalBottles = inkItems.reduce((s, i) => s + i.totalBottles, 0)
  const inkTotalCost = Math.round(
    inkItems.reduce((s, i) => s + i.totalCost, 0) * 100,
  ) / 100
  const inkCoveragePages = inkItems.reduce(
    (s, i) => s + (i.coveragePages ?? 0),
    0,
  )
  const avgInkCostPerPage =
    inkCoveragePages > 0 && inkTotalCost > 0
      ? Math.round((inkTotalCost / inkCoveragePages) * 1000) / 1000
      : null

  const spareTotalItems = spareItems.reduce((s, i) => s + i.totalItems, 0)
  const spareTotalCost = Math.round(
    spareItems.reduce((s, i) => s + i.totalCost, 0) * 100,
  ) / 100
  const spareMonthlyDepreciation = Math.round(
    spareItems.reduce((s, i) => s + (i.costPerMonth ?? 0), 0) * 100,
  ) / 100

  const serviceTotalCost = Math.round(
    serviceItems.reduce((s, i) => s + i.totalCost, 0) * 100,
  ) / 100

  const totalCost = Math.round(
    (inkTotalCost + spareTotalCost + serviceTotalCost) * 100,
  ) / 100

  // Reconciliation
  const difference = inkCoveragePages - actualPrintedPages
  const differencePercent =
    inkCoveragePages > 0
      ? Math.round((difference / inkCoveragePages) * 1000) / 10
      : 0
  const stockCostPerPage =
    inkCoveragePages > 0 && inkTotalCost > 0
      ? Math.round((inkTotalCost / inkCoveragePages) * 1000) / 1000
      : null
  const costPerPageDiff =
    stockCostPerPage != null && meterCostPerPage != null
      ? Math.round((stockCostPerPage - meterCostPerPage) * 1000) / 1000
      : null

  return {
    month,
    ink: {
      totalBottles: inkTotalBottles,
      totalCost: inkTotalCost,
      avgCostPerPage: avgInkCostPerPage,
      items: inkItems.sort((a, b) => b.totalCost - a.totalCost),
    },
    spareParts: {
      totalItems: spareTotalItems,
      totalCost: spareTotalCost,
      monthlyDepreciation: spareMonthlyDepreciation,
      items: spareItems.sort((a, b) => b.totalCost - a.totalCost),
    },
    service: {
      totalCost: serviceTotalCost,
      items: serviceItems.sort((a, b) => b.totalCost - a.totalCost),
    },
    totalCost,
    reconciliation: {
      inkCoveragePages,
      actualPrintedPages,
      difference,
      differencePercent,
      stockCostPerPage,
      meterCostPerPage,
      costPerPageDiff,
    },
  }
}

// ── Helpers to build maps from Prisma results ────────────────────────

/** Build a stockItem lookup map keyed by id (for fast O(1) lookup in calc functions). */
export function buildStockItemMap(
  items: StockItem[],
): Map<string, CostedStockItem> {
  const m = new Map<string, CostedStockItem>()
  for (const it of items) {
    m.set(it.id, {
      id: it.id,
      productCode: it.productCode,
      productName: it.productName,
      category: it.category,
      unitCost: it.unitCost == null ? null : Number(it.unitCost),
      costType: it.costType,
      yieldPerPage: it.yieldPerPage,
      depreciationMethod: it.depreciationMethod,
      usefulLifeMonths: it.usefulLifeMonths,
      usefulLifePages: it.usefulLifePages,
      unit: it.unit,
    })
  }
  return m
}
