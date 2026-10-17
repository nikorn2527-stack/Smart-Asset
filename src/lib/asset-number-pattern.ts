/**
 * Asset Number Generator — ข้อ 4: เลขทะเบียนกำหนดเองได้
 *
 * รองรับรูปแบบต่างๆ:
 *   {prefix}-{seq:5}                    → ASSET-00001
 *   {dept:4}-{type:3}-{seq:3}-{year:2}  → ACC-PRT-001-26
 *   {year:4}{month:2}-{seq:4}           → 202608-0001
 *   {prefix}-{dept:3}-{seq:4}           → IT-ACC-0001
 *
 * Segments ที่รองรับ:
 *   {prefix}     — คำนำหน้า (กำหนดใน pattern.defaultPrefix)
 *   {seq:N}      — เลขลำดับ N หลัก (เติมศูนย์)
 *   {year:2|4}   — ปี (2 หรือ 4 หลัก)
 *   {month:2}    — เดือน (2 หลัก)
 *   {dept:N}     — รหัสแผนก N หลัก (จาก device.departmentCode)
 *   {type:N}     — รหัสประเภท N หลัก (จาก device.type)
 *   {site:N}     — รหัสสาขา N หลัก
 */

import { db } from '@/lib/db'

export interface AssetNumberPattern {
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
 * Example: "{prefix}-{dept:4}-{seq:3}-{year:2}" → ['prefix', 'dept:4', 'seq:3', 'year:2']
 */
function parseSegments(pattern: string): string[] {
  const matches = pattern.match(/\{([^}]+)\}/g) || []
  return matches.map((m) => m.slice(1, -1)) // remove { }
}

/**
 * Pad a value to N characters (left-pad with zeros for numbers, right-truncate for strings).
 */
function padValue(value: string | number, length: number): string {
  const str = String(value)
  if (str.length >= length) return str.slice(0, length)
  // If numeric, left-pad with zeros; if string, left-pad with spaces
  if (/^\d+$/.test(str)) {
    return str.padStart(length, '0')
  }
  return str.padEnd(length, ' ').trim()
}

/**
 * Generate the next asset number based on the active pattern.
 *
 * @param context — device data for filling in dept/type/site segments
 * @returns the generated asset number, or null if no active pattern
 */
export async function generateAssetNumber(context?: {
  departmentCode?: string | null
  type?: string | null
  site?: string | null
}): Promise<string | null> {
  const pattern = await db.assetNumberPattern.findFirst({
    where: { isActive: true },
  })
  if (!pattern) return null

  const segments = parseSegments(pattern.pattern)
  const now = new Date()

  // Count existing devices for sequence calculation
  const deviceCount = await db.device.count()
  const seq = pattern.seqStart + deviceCount

  let result = pattern.pattern

  for (const seg of segments) {
    let replacement = ''

    if (seg === 'prefix') {
      replacement = pattern.defaultPrefix || 'AST'
    } else if (seg.startsWith('seq:')) {
      const padLen = parseInt(seg.split(':')[1] || String(pattern.seqPadding), 10)
      replacement = padValue(seq, padLen)
    } else if (seg.startsWith('year:')) {
      const yearLen = parseInt(seg.split(':')[1] || '4', 10)
      const year = yearLen === 2 ? String(now.getFullYear()).slice(-2) : String(now.getFullYear())
      replacement = year
    } else if (seg === 'month:2') {
      replacement = String(now.getMonth() + 1).padStart(2, '0')
    } else if (seg.startsWith('dept:')) {
      const padLen = parseInt(seg.split(':')[1] || '4', 10)
      replacement = padValue(context?.departmentCode || 'GEN', padLen)
    } else if (seg.startsWith('type:')) {
      const padLen = parseInt(seg.split(':')[1] || '3', 10)
      replacement = padValue(context?.type || 'GEN', padLen)
    } else if (seg.startsWith('site:')) {
      const padLen = parseInt(seg.split(':')[1] || '3', 10)
      replacement = padValue(context?.site || 'GEN', padLen)
    }

    result = result.replace(`{${seg}}`, replacement)
  }

  return result
}

/**
 * Get the active pattern (or null if none).
 */
export async function getActivePattern(): Promise<AssetNumberPattern | null> {
  const row = await db.assetNumberPattern.findFirst({
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
 * Set a pattern as active (deactivate all others).
 */
export async function setActivePattern(patternId: string): Promise<void> {
  // SPRINT-4 #3 (AUDIT-DB-RUNTIME S-P1-17): wrap in transaction so
  // concurrent activate calls can't leave multiple patterns active.
  // Previously two concurrent POST /activate calls could both pass the
  // deactivate-many step before either set isActive=true, leaving 2
  // active patterns — which then caused next-asset-code to return
  // inconsistent results.
  const { getBaseClient } = await import('@/lib/db')
  await getBaseClient().$transaction(async (tx) => {
    // Deactivate all other patterns first
    await tx.assetNumberPattern.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    })
    // Then activate the requested one
    await tx.assetNumberPattern.update({
      where: { id: patternId },
      data: { isActive: true },
    })
  })
}

/**
 * Create default patterns if none exist.
 */
export async function ensureDefaultPatterns(): Promise<void> {
  const count = await db.assetNumberPattern.count()
  if (count > 0) return

  await db.assetNumberPattern.createMany({
    data: [
      {
        name: 'แบบง่าย (5 หลัก)',
        pattern: '{prefix}-{seq:5}',
        description: 'ASSET-00001 (เหมาะสำหรับองค์กรขนาดเล็ก)',
        isActive: true,
        defaultPrefix: 'ASSET',
        seqPadding: 5,
        seqStart: 1,
      },
      {
        name: 'แบบแยกหน่วยงาน (4-3-3-2)',
        pattern: '{dept:4}-{type:3}-{seq:3}-{year:2}',
        description: 'ACC-PRT-001-26 (แยกหน่วยงาน-ประเภท-ลำดับ-ปี)',
        isActive: false,
        defaultPrefix: null,
        seqPadding: 3,
        seqStart: 1,
      },
      {
        name: 'แบบปี-เดือน (4 หลัก)',
        pattern: '{year:4}{month:2}-{seq:4}',
        description: '202608-0001 (เริ่มใหม่ทุกเดือน)',
        isActive: false,
        defaultPrefix: null,
        seqPadding: 4,
        seqStart: 1,
      },
    ],
  })
}
