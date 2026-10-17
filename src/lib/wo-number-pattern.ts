/**
 * WoNumberPattern — รูปแบบเลขใบงาน (เหมือน AssetNumberPattern)
 *
 * รองรับรูปแบบต่างๆ:
 *   {prefix}{seq:4}      → PPIT0001 (ไม่มี dash — ตรงกับข้อมูลเดิม)
 *   {prefix}-{seq:4}     → PPIT-0001
 *   {prefix}-{year:2}-{seq:4} → PPIT-26-0001
 *
 * Segments ที่รองรับ:
 *   {prefix}     — คำนำหน้า (defaultPrefix)
 *   {seq:N}      — เลขลำดับ N หลัก (เติมศูนย์)
 *   {year:2|4}   — ปี (2 หรือ 4 หลัก)
 *   {month:2}    — เดือน (2 หลัก)
 */

import { db } from '@/lib/db'

export interface WoPattern {
  id: string
  name: string
  pattern: string
  description: string | null
  isActive: boolean
  defaultPrefix: string | null
  seqPadding: number
  seqStart: number
}

/**
 * Parse a pattern string and extract segment definitions.
 * Example: "{prefix}-{seq:4}" → ['prefix', 'seq:4']
 */
function parseSegments(pattern: string): string[] {
  const matches = pattern.match(/\{([^}]+)\}/g) || []
  return matches.map((m) => m.slice(1, -1)) // remove { }
}

/**
 * Pad a numeric value to N digits (left-pad with zeros).
 */
function padSeq(value: number, length: number): string {
  return String(value).padStart(length, '0')
}

/**
 * Resolve the next sequence number for a given pattern by scanning the
 * WorkOrder table for existing woNumbers that match the pattern's prefix
 * portion (everything before the first `{seq:...}` segment).
 *
 * Returns the next sequence value (starting from `seqStart` if no matches).
 */
async function resolveNextSeq(pattern: WoPattern): Promise<number> {
  const segments = parseSegments(pattern.pattern)
  const seqIdx = segments.findIndex((s) => s.startsWith('seq:'))
  if (seqIdx === -1) return pattern.seqStart

  // Build the literal prefix that precedes the {seq} segment so we can
  // query WorkOrder.woNumber startsWith that literal.
  let literalPrefix = ''
  for (let i = 0; i < seqIdx; i++) {
    const seg = segments[i]
    if (seg === 'prefix') {
      literalPrefix += pattern.defaultPrefix || 'PPIT'
    } else if (seg.startsWith('year:')) {
      const yearLen = parseInt(seg.split(':')[1] || '4', 10)
      const now = new Date()
      literalPrefix +=
        yearLen === 2 ? String(now.getFullYear()).slice(-2) : String(now.getFullYear())
    } else if (seg === 'month:2') {
      literalPrefix += String(new Date().getMonth() + 1).padStart(2, '0')
    } else {
      // Unknown segment — leave as-is literal text in the pattern (rare)
      literalPrefix += ''
    }
  }

  // Also collect any literal text between segments (e.g. the dash in
  // "{prefix}-{seq:4}"). We rebuild it from the raw pattern string by
  // stripping known segment tokens up to the seq segment.
  let rawUpToSeq = pattern.pattern
  const seqTokenMatch = pattern.pattern.match(/\{seq:\d+\}/)
  if (seqTokenMatch && seqTokenMatch.index !== undefined) {
    rawUpToSeq = pattern.pattern.slice(0, seqTokenMatch.index)
  }
  // Replace tokens in rawUpToSeq with their resolved values so the
  // startsWith filter matches real woNumbers.
  let resolvedPrefix = rawUpToSeq
  for (const seg of segments.slice(0, seqIdx)) {
    let repl = ''
    if (seg === 'prefix') {
      repl = pattern.defaultPrefix || 'PPIT'
    } else if (seg.startsWith('year:')) {
      const yearLen = parseInt(seg.split(':')[1] || '4', 10)
      repl =
        yearLen === 2
          ? String(new Date().getFullYear()).slice(-2)
          : String(new Date().getFullYear())
    } else if (seg === 'month:2') {
      repl = String(new Date().getMonth() + 1).padStart(2, '0')
    }
    resolvedPrefix = resolvedPrefix.replace(`{${seg}}`, repl)
  }
  if (!resolvedPrefix) resolvedPrefix = literalPrefix

  // Scan WO table for woNumbers starting with resolvedPrefix
  const existing = await db.workOrder.findMany({
    where: { woNumber: { startsWith: resolvedPrefix } },
    select: { woNumber: true },
  })
  let maxSeq = pattern.seqStart - 1
  for (const row of existing) {
    if (!row.woNumber) continue
    const tail = row.woNumber.slice(resolvedPrefix.length)
    const m = tail.match(/^(\d+)/)
    if (m) {
      const n = parseInt(m[1], 10)
      if (!Number.isNaN(n) && n > maxSeq) maxSeq = n
    }
  }
  // Also scan the `id` column (legacy PPIT data uses id = woNumber)
  const existingIds = await db.workOrder.findMany({
    where: { id: { startsWith: resolvedPrefix } },
    select: { id: true },
  })
  for (const row of existingIds) {
    const tail = row.id.slice(resolvedPrefix.length)
    const m = tail.match(/^(\d+)/)
    if (m) {
      const n = parseInt(m[1], 10)
      if (!Number.isNaN(n) && n > maxSeq) maxSeq = n
    }
  }
  return maxSeq + 1
}

/**
 * Generate the next woNumber based on the active pattern.
 * Searches the WO table for existing woNumbers matching the pattern's prefix
 * and returns MAX+1. Uniqueness is double-checked before returning.
 *
 * @returns the generated woNumber, or null if no candidate could be produced.
 */
export async function generateWoNumberFromPattern(
  pattern: WoPattern,
): Promise<string | null> {
  const segments = parseSegments(pattern.pattern)
  const seqIdx = segments.findIndex((s) => s.startsWith('seq:'))
  if (seqIdx === -1) {
    // No {seq} segment — cannot generate a unique sequence. Bail out so
    // the caller falls back to the legacy generator.
    return null
  }

  const seqLen = parseInt(
    segments[seqIdx].split(':')[1] || String(pattern.seqPadding),
    10,
  )
  const nextSeq = await resolveNextSeq(pattern)

  // Try up to 5 candidate sequence numbers in case of collisions.
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidateSeq = nextSeq + attempt
    let result = pattern.pattern
    const now = new Date()
    let filledAll = true

    for (const seg of segments) {
      let replacement = ''
      if (seg === 'prefix') {
        replacement = pattern.defaultPrefix || 'PPIT'
      } else if (seg.startsWith('seq:')) {
        replacement = padSeq(candidateSeq, seqLen)
      } else if (seg.startsWith('year:')) {
        const yearLen = parseInt(seg.split(':')[1] || '4', 10)
        replacement =
          yearLen === 2
            ? String(now.getFullYear()).slice(-2)
            : String(now.getFullYear())
      } else if (seg === 'month:2') {
        replacement = String(now.getMonth() + 1).padStart(2, '0')
      } else {
        filledAll = false
        break
      }
      result = result.replace(`{${seg}}`, replacement)
    }
    if (!filledAll) return null

    // Verify uniqueness — check both id and woNumber columns
    const exists = await db.workOrder.findFirst({
      where: {
        OR: [{ id: result }, { woNumber: result }],
      },
      select: { id: true },
    })
    if (!exists) return result
  }
  return null
}

/**
 * Get the active WoNumberPattern (or null if none).
 */
export async function getActiveWoPattern(): Promise<WoPattern | null> {
  const row = await db.woNumberPattern.findFirst({
    where: { isActive: true },
  })
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    pattern: row.pattern,
    description: row.description,
    isActive: row.isActive,
    defaultPrefix: row.defaultPrefix,
    seqPadding: row.seqPadding,
    seqStart: row.seqStart,
  }
}

/**
 * Set a WoNumberPattern as active (deactivate all others).
 */
export async function setActiveWoPattern(patternId: string): Promise<void> {
  // SPRINT-4 #3 (AUDIT-DB-RUNTIME S-P1-17): wrap in transaction to prevent
  // concurrent activate calls from leaving multiple active patterns.
  const { getBaseClient } = await import('@/lib/db')
  await getBaseClient().$transaction(async (tx) => {
    await tx.woNumberPattern.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    })
    await tx.woNumberPattern.update({
      where: { id: patternId },
      data: { isActive: true },
    })
  })
}

/**
 * Create default WoNumberPatterns if none exist.
 * Default = PPIT pattern (no dash) — matches original Apps Script data.
 */
export async function ensureDefaultWoPatterns(): Promise<void> {
  const count = await db.woNumberPattern.count()
  if (count > 0) return

  await db.woNumberPattern.createMany({
    data: [
      {
        name: 'PPIT (ไม่มี dash)',
        pattern: '{prefix}{seq:4}',
        description: 'PPIT0001 — ตรงกับข้อมูลเดิม (Apps Script)',
        isActive: true,
        defaultPrefix: 'PPIT',
        seqPadding: 4,
        seqStart: 1,
      },
      {
        name: 'PPIT (มี dash)',
        pattern: '{prefix}-{seq:4}',
        description: 'PPIT-0001 — แยก prefix กับเลขลำดับด้วยขีดกลาง',
        isActive: false,
        defaultPrefix: 'PPIT',
        seqPadding: 4,
        seqStart: 1,
      },
    ],
  })
}
