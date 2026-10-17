/**
 * Compatibility facade for lifecycle reading-type derivation.
 *
 * The canonical implementation lives in meter-logic.ts and follows the
 * protected Apps Script MeterService rules. This module keeps the historical
 * `(fromStatus, toStatus)` argument order used by the parity transfer route,
 * then delegates with the canonical `(toStatus, fromStatus)` order.
 *
 * Do not add a second lifecycle mapping here. Keeping one implementation avoids
 * divergent readingType values between active and compatibility routes.
 */

import {
  getLifecycleReadingType as getCanonicalLifecycleReadingType,
  USAGE_READING_TYPES as CANONICAL_USAGE_READING_TYPES,
  BASELINE_READING_TYPES as CANONICAL_BASELINE_READING_TYPES,
  isUsageReadingType as canonicalIsUsageReadingType,
  isBaselineReadingType as canonicalIsBaselineReadingType,
  calcPagesBw as canonicalCalcPagesBw,
  calcPagesColor as canonicalCalcPagesColor,
} from '@/lib/meter-logic'

export type { ReadingType } from '@/lib/meter-logic'
import type { ReadingType } from '@/lib/meter-logic'

/**
 * Determine the readingType for a lifecycle transfer.
 *
 * This compatibility API intentionally accepts `(fromStatus, toStatus)`.
 * The canonical helper accepts `(toStatus, fromStatus)`.
 */
export function getLifecycleReadingType(
  fromStatus: string | null | undefined,
  toStatus: string | null | undefined,
): ReadingType {
  return getCanonicalLifecycleReadingType(toStatus, fromStatus)
}

export const USAGE_READING_TYPES: ReadingType[] = CANONICAL_USAGE_READING_TYPES
export const BASELINE_READING_TYPES: ReadingType[] = CANONICAL_BASELINE_READING_TYPES

export function isUsageReadingType(type: string | null | undefined): boolean {
  return canonicalIsUsageReadingType(type)
}

export function isBaselineReadingType(type: string | null | undefined): boolean {
  return canonicalIsBaselineReadingType(type)
}

export function calcPagesBw(
  meterBw: number,
  prevMeterBw: number,
  readingType: string | null | undefined,
): number {
  return canonicalCalcPagesBw(meterBw, prevMeterBw, readingType)
}

export function calcPagesColor(
  meterColor: number,
  prevMeterColor: number,
  readingType: string | null | undefined,
): number {
  return canonicalCalcPagesColor(meterColor, prevMeterColor, readingType)
}
