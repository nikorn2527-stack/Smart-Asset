/**
 * pattern-selector.ts — Pattern selection logic ตาม section 8.2
 *
 * ระบบเลือก Pattern ตามลำดับ:
 *   1. Organization + Site (most specific)
 *   2. Organization only
 *   3. Global Default (organizationId = null)
 *
 * Usage:
 *   const pattern = await selectAssetPattern({ organizationId, siteCode })
 *   const nextCode = generateNextCode(pattern)
 */

import { db } from './db'

export interface PatternSelectionResult {
  pattern: {
    id: string
    name: string
    pattern: string
    defaultPrefix: string | null
    seqPadding: number
    seqStart: number
  } | null
  /** Which scope matched: 'org+site' | 'org' | 'global' | 'none' */
  matchedScope: 'org+site' | 'org' | 'global' | 'none'
}

/**
 * Select the most specific active AssetNumberPattern for a given scope.
 *
 * Priority:
 *   1. organizationId + siteCode match
 *   2. organizationId match (siteCode = null)
 *   3. organizationId = null (global default)
 */
export async function selectAssetPattern(params: {
  organizationId: string
  siteCode?: string | null
}): Promise<PatternSelectionResult> {
  const { organizationId, siteCode } = params

  // 1. Try org + site
  if (siteCode) {
    const orgSitePattern = await db.assetNumberPattern.findFirst({
      where: {
        organizationId,
        siteCode,
        isActive: true,
      },
    })
    if (orgSitePattern) {
      return {
        pattern: orgSitePattern,
        matchedScope: 'org+site',
      }
    }
  }

  // 2. Try org only (siteCode = null)
  const orgPattern = await db.assetNumberPattern.findFirst({
    where: {
      organizationId,
      siteCode: null,
      isActive: true,
    },
  })
  if (orgPattern) {
    return {
      pattern: orgPattern,
      matchedScope: 'org',
    }
  }

  // 3. Try global default (organizationId = null)
  const globalPattern = await db.assetNumberPattern.findFirst({
    where: {
      organizationId: null,
      isActive: true,
    },
  })
  if (globalPattern) {
    return {
      pattern: globalPattern,
      matchedScope: 'global',
    }
  }

  return { pattern: null, matchedScope: 'none' }
}

/**
 * Select the most specific active WoNumberPattern for a given scope.
 * Same priority logic as selectAssetPattern.
 */
export async function selectWoPattern(params: {
  organizationId: string
  siteCode?: string | null
}): Promise<PatternSelectionResult> {
  const { organizationId, siteCode } = params

  if (siteCode) {
    const orgSitePattern = await db.woNumberPattern.findFirst({
      where: {
        organizationId,
        siteCode,
        isActive: true,
      },
    })
    if (orgSitePattern) {
      return {
        pattern: orgSitePattern,
        matchedScope: 'org+site',
      }
    }
  }

  const orgPattern = await db.woNumberPattern.findFirst({
    where: {
      organizationId,
      siteCode: null,
      isActive: true,
    },
  })
  if (orgPattern) {
    return {
      pattern: orgPattern,
      matchedScope: 'org',
    }
  }

  const globalPattern = await db.woNumberPattern.findFirst({
    where: {
      organizationId: null,
      isActive: true,
    },
  })
  if (globalPattern) {
    return {
      pattern: globalPattern,
      matchedScope: 'global',
    }
  }

  return { pattern: null, matchedScope: 'none' }
}

/**
 * Generate the next code from a pattern + sequence number.
 *
 * Supports placeholders:
 *   {prefix}    → defaultPrefix
 *   {seq:N}     → sequence padded to N digits
 *   {year:4}    → 4-digit year
 *   {month:2}   → 2-digit month
 *   {dept:4}    → department code (first 4 chars)
 *
 * Examples:
 *   "{prefix}-{seq:5}" with prefix="AST" seq=1 → "AST-00001"
 *   "WO-{year:4}-{seq:5}" with seq=1 → "WO-2026-00001"
 */
export function generateCode(
  pattern: string,
  params: {
    seq: number
    prefix?: string | null
    year?: number
    month?: number
    dept?: string | null
  },
): string {
  const { seq, prefix, year, month, dept } = params
  let result = pattern

  // {prefix}
  if (prefix) {
    result = result.replace('{prefix}', prefix)
  }

  // {seq:N}
  result = result.replace(/\{seq:(\d+)\}/g, (_, paddingStr) => {
    const padding = parseInt(paddingStr, 10)
    return String(seq).padStart(padding, '0')
  })

  // {year:4}
  const yr = year ?? new Date().getFullYear()
  result = result.replace(/\{year:(\d+)\}/g, (_, digits) => {
    return String(yr).slice(-parseInt(digits, 10)).padStart(parseInt(digits, 10), '0')
  })

  // {month:2}
  const mo = month ?? (new Date().getMonth() + 1)
  result = result.replace(/\{month:(\d+)\}/g, (_, digits) => {
    return String(mo).slice(-parseInt(digits, 10)).padStart(parseInt(digits, 10), '0')
  })

  // {dept:4}
  if (dept) {
    result = result.replace(/\{dept:(\d+)\}/g, (_, digits) => {
      return dept.slice(0, parseInt(digits, 10)).padStart(parseInt(digits, 10), ' ').toUpperCase()
    })
  }

  return result
}
