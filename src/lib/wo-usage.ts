/**
 * wo-usage.ts — helpers to auto-calculate usageHours + usagePages for WO parts.
 *
 * Two sources of "actual usage" data that the technician doesn't have to type:
 *
 * 1. **usageHours** — derived from WO assignment + completion timestamps.
 *    - If `assignedAt` and `workCompletedAt` are both set, usageHours = (completed - assigned) in hours.
 *    - If only `assignedAt` is set, usageHours = (now - assigned) — useful mid-repair.
 *    - If neither is set, returns null (technician enters manually).
 *
 * 2. **usagePages** — derived from the device's MeterReading delta since the
 *    last parts transaction for the same stockItem. Lets the system tell
 *    the technician "since you last swapped this toner, this device has
 *    printed 6,420 pages" so they don't have to look it up manually.
 */

import { db } from '@/lib/db'

/**
 * Calculate hours between WO assignment and completion.
 * Returns null if the timestamps are missing or invalid.
 */
export function calcWOUsageHours(wo: {
  assignedAt?: Date | string | null
  workCompletedAt?: Date | string | null
}): number | null {
  const start = wo.assignedAt ? new Date(wo.assignedAt) : null
  const end = wo.workCompletedAt ? new Date(wo.workCompletedAt) : null
  if (!start || !end) return null
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null
  if (end <= start) return null
  const ms = end.getTime() - start.getTime()
  return Math.round((ms / (1000 * 60 * 60)) * 100) / 100 // 2 decimal places
}

/**
 * Find the device for a WO. Used to look up MeterReadings.
 * Returns null if the WO has no device linked.
 */
export async function getWODevice(woId: string): Promise<string | null> {
  const wo = await db.workOrder.findUnique({
    where: { id: woId },
    select: { deviceId: true, device: { select: { assetCode: true } } },
  })
  if (!wo || !wo.deviceId || !wo.device?.assetCode) return null
  return wo.device.assetCode
}

/**
 * Find the most-recent APPROVED (or auto-approved) StockTransaction for this
 * device + stockItem, BEFORE the current WO. Returns the date of that txn
 * so we can look up the meter reading on that date.
 *
 * Use case: "since you last swapped this toner, this device printed X pages".
 * We look at the device's MeterReading on the date of the last swap, then
 * compute (current meter value) - (meter value on last swap) = pages printed.
 *
 * Returns null if no prior approved txn for this device + item exists.
 */
export async function findLastSwapDate(
  deviceId: string,
  stockItemId: string,
  currentWoId?: string,
): Promise<string | null> {
  // Prisma doesn't support `{ in: [val, null] }` directly — we need to use
  // OR to handle null values separately. APPROVED or null (immediate txn).
  const txns = await db.stockTransaction.findMany({
    where: {
      deviceId,
      stockItemId,
      type: 'OUT',
      AND: [
        {
          OR: [
            { approvalStatus: 'APPROVED' },
            { approvalStatus: null },
          ],
        },
        ...(currentWoId ? [{ NOT: { workOrderId: currentWoId } }] : []),
      ],
    },
    orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
    take: 1,
    select: { txnDate: true, createdAt: true },
  })
  if (txns.length === 0) return null
  return txns[0].txnDate
}

/**
 * Look up the device's MeterReading on or before a given date.
 * Returns the meter BW + color values as of that date.
 *
 * @param assetCode - the device's assetCode
 * @param onOrBefore - ISO date string; we look for the most recent reading
 *                    with readingDate <= this date
 */
export async function getMeterReadingOnDate(
  assetCode: string,
  onOrBefore: string,
): Promise<{ meterBw: number; meterColor: number } | null> {
  const r = await db.meterReading.findFirst({
    where: {
      assetCode,
      readingDate: { lte: onOrBefore },
      readingType: { notIn: ['FINAL', 'SEND_REPAIR'] }, // skip disposed/repaired
    },
    orderBy: [{ readingDate: 'desc' }, { id: 'desc' }],
    select: { meterBw: true, meterColor: true },
  })
  if (!r) return null
  return { meterBw: r.meterBw, meterColor: r.meterColor }
}

/**
 * Look up the device's MOST RECENT meter reading (any type except FINAL/SEND_REPAIR).
 * Used as the "current" value for delta calculation.
 */
export async function getLatestMeterReading(
  assetCode: string,
): Promise<{ meterBw: number; meterColor: number } | null> {
  const r = await db.meterReading.findFirst({
    where: {
      assetCode,
      readingType: { notIn: ['FINAL', 'SEND_REPAIR'] },
    },
    orderBy: [{ readingDate: 'desc' }, { id: 'desc' }],
    select: { meterBw: true, meterColor: true },
  })
  if (!r) return null
  return { meterBw: r.meterBw, meterColor: r.meterColor }
}

/**
 * Compute the page count delta between (last swap date) and (now) for a
 * device + stockItem. Returns null if either reading is unavailable.
 *
 * @returns { pagesBw, pagesColor, lastSwapDate } | null
 */
export async function calcPagesSinceLastSwap(
  woId: string,
  deviceId: string,
  assetCode: string,
  stockItemId: string,
): Promise<{
  pagesBw: number
  pagesColor: number
  lastSwapDate: string | null
} | null> {
  // Find the last swap date for this device + item
  const lastSwapDate = await findLastSwapDate(deviceId, stockItemId, woId)
  if (!lastSwapDate) return null

  // Look up the meter reading on the last swap date (the "start" point)
  const startReading = await getMeterReadingOnDate(assetCode, lastSwapDate)
  if (!startReading) return null

  // Look up the current/latest meter reading (the "end" point)
  const endReading = await getLatestMeterReading(assetCode)
  if (!endReading) return null

  // Delta = current - start
  const pagesBw = Math.max(0, endReading.meterBw - startReading.meterBw)
  const pagesColor = Math.max(0, endReading.meterColor - startReading.meterColor)

  return { pagesBw, pagesColor, lastSwapDate }
}

/**
 * Master helper: given a WO + a list of stockItems being requested, compute
 * suggested usageHours + usagePages for each item.
 *
 * Returns a map of stockItemId → { suggestedHours, suggestedPagesBw, suggestedPagesColor }.
 * Used by the parts picker UI to pre-fill the optional usageHours + usagePages inputs.
 */
export async function suggestUsageForWoParts(
  woId: string,
  stockItemIds: string[],
): Promise<
  Record<
    string,
    {
      suggestedHours: number | null
      suggestedPagesBw: number | null
      suggestedPagesColor: number | null
      lastSwapDate: string | null
    }
  >
> {
  const result: Record<string, {
    suggestedHours: number | null
    suggestedPagesBw: number | null
    suggestedPagesColor: number | null
    lastSwapDate: string | null
  }> = {}

  // 1. Get WO timestamps → suggestedHours (same for all items in this WO)
  const wo = await db.workOrder.findUnique({
    where: { id: woId },
    select: { assignedAt: true, workCompletedAt: true, deviceId: true, device: { select: { assetCode: true, id: true } } },
  })
  const suggestedHours = wo ? calcWOUsageHours(wo) : null

  // 2. For each stockItem, compute pages since last swap (requires device)
  const deviceId = wo?.deviceId ?? wo?.device?.id ?? null
  const assetCode = wo?.device?.assetCode ?? null

  for (const itemId of stockItemIds) {
    if (deviceId && assetCode) {
      const swapInfo = await calcPagesSinceLastSwap(woId, deviceId, assetCode, itemId)
      result[itemId] = {
        suggestedHours,
        suggestedPagesBw: swapInfo?.pagesBw ?? null,
        suggestedPagesColor: swapInfo?.pagesColor ?? null,
        lastSwapDate: swapInfo?.lastSwapDate ?? null,
      }
    } else {
      result[itemId] = {
        suggestedHours,
        suggestedPagesBw: null,
        suggestedPagesColor: null,
        lastSwapDate: null,
      }
    }
  }

  return result
}
