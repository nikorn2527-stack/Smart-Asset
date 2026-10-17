/**
 * device-lookup.ts — shared device-lookup helper.
 *
 * Design principle (user requirement):
 *   • Search and meter reading should use **Serial Number as the primary key**
 *     (because that's what's physically printed on the device and what the
 *     operator can scan from a manufacturer QR sticker).
 *   • `assetCode` is the **permanent internal sequence number** ("เลขสินทรัพย์รวม
 *     ห้ามแก้ไข") — never changes even when the device moves sites. It remains
 *     the canonical unique key in the DB.
 *
 * `findDeviceByCode()` accepts an arbitrary identifier (assetCode OR serial)
 * and returns the device if found. It tries assetCode first (DB unique lookup)
 * then falls back to serialNumber (findFirst because serial is not unique in
 * the schema — duplicate serials are a data-quality issue but the code must
 * handle them gracefully).
 *
 * Extracted from the LINE webhook's `findDeviceByCode()` pattern
 * (`src/app/api/line/webhook/route.ts:201-234`) and made canonical here so all
 * write paths can share the same dual-lookup logic.
 */

import { db } from '@/lib/db'

export interface DeviceLookupResult {
  /** The matched device (full row). */
  device: Awaited<ReturnType<typeof db.device.findUnique>> & object
  /** Which key the device was matched by. Useful for UI feedback + audit. */
  matchedBy: 'assetCode' | 'serialNumber'
  /**
   * If multiple devices share the same serialNumber, this is set to `true`
   * so the caller can warn the user (ambiguous match). The returned device
   * is the most-recently-updated one (deterministic ordering).
   */
  ambiguous: boolean
}

/**
 * Find a device by an arbitrary identifier. Tries assetCode first (exact,
 * unique), then falls back to serialNumber (case-insensitive, findFirst).
 *
 * @param identifier — assetCode or serialNumber (raw user input).
 * @returns `null` if not found. Otherwise `{ device, matchedBy, ambiguous }`.
 */
export async function findDeviceByCode(
  identifier: string,
): Promise<DeviceLookupResult | null> {
  const code = (identifier ?? '').trim()
  if (!code) return null

  // 1. Exact assetCode lookup — DB unique constraint guarantees 0 or 1 row.
  const byAssetCode = await db.device.findUnique({
    where: { assetCode: code },
  })
  if (byAssetCode) {
    return { device: byAssetCode, matchedBy: 'assetCode', ambiguous: false }
  }

  // 2. Fallback to serialNumber (not unique — findFirst may be ambiguous).
  //    Order by updatedAt desc so the most-recently-active device wins in
  //    a duplicate-serial situation. This is a deterministic tiebreaker.
  const matching = await db.device.findMany({
    where: { serialNumber: code },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
  })
  if (matching.length === 0) return null
  return {
    device: matching[0],
    matchedBy: 'serialNumber',
    ambiguous: matching.length > 1,
  }
}

/**
 * Variant for cases where the caller already knows the identifier type
 * (e.g. QR scanner explicitly encodes one or the other). Avoids the
 * serialNumber fallback when the caller knows it's an assetCode.
 */
export async function findDeviceByAssetCode(
  assetCode: string,
): Promise<Awaited<ReturnType<typeof db.device.findUnique>>> {
  const code = (assetCode ?? '').trim()
  if (!code) return null
  return db.device.findUnique({ where: { assetCode: code } })
}

/**
 * Find a device by serial number only. Returns the most-recently-updated
 * device if there are duplicates. Useful for import flows where the CSV
 * column is explicitly the manufacturer serial.
 */
export async function findDeviceBySerial(
  serialNumber: string,
): Promise<DeviceLookupResult | null> {
  const code = (serialNumber ?? '').trim()
  if (!code) return null

  const matching = await db.device.findMany({
    where: { serialNumber: code },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
  })
  if (matching.length === 0) return null
  return {
    device: matching[0],
    matchedBy: 'serialNumber',
    ambiguous: matching.length > 1,
  }
}
