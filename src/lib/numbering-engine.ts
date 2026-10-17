/**
 * Flexible Numbering Engine — ระบบสร้างเลขทะเบียน/เลขเอกสารแบบยืดหยุ่น
 *
 * รองรับรูปแบบที่ประกอบจากหลายส่วน กำหนดเองได้ไม่จำกัด เช่น
 *   {cat1:3}-{cat2:3}-{yearBE:4}-{seq:5}  → 001-201-2569-00001
 *   {prefix}-{yearBE:2}-{seq:4}           → WO-69-0001
 *   {year}{month:2}-{seq:4}                → 202609-0001
 *
 * Segments ที่รองรับ:
 *   {cat1:N}     — รหัสหมวดหมู่ใหญ่ (level 1) จาก CategoryCode (pad ศูนย์ซ้าย N หลัก)
 *   {cat2:N}     — รหัสหมวดหมู่ย่อย (level 2) เช่น ปรินเตอร์ AIO = 201
 *   {cat:N}      — รหัสหมวดหมู่ของรายการ (เหมือน cat2)
 *   {year:N}     — ปีคริสต์ศักราช (2026 / 26 เมื่อ N=2)
 *   {yearBE:N}   — ปีพุทธศักราช (2569 / 69 เมื่อ N=2)
 *   {month:2}    — เดือน 2 หลัก (01–12)
 *   {site:N}     — รหัสสาขา
 *   {dept:N}     — รหัสแผนก
 *   {type:N}     — ประเภทอุปกรณ์ (ตรงจากข้อมูล)
 *   {prefix}     — คำนำหน้าจาก scheme.prefix
 *   {seq:N}      — เลขลำดับ N หลัก (จัดสรรแบบ atomic ต่อ scope)
 *
 * เลขลำดับ ({seq}) แยกนับตาม scope (ส่วนอื่นของเลขทั้งหมด เช่น 001-201-2569)
 * และรีเซ็ตได้ตามนโยบาย (ไม่รีเซ็ต / รายปี / รายเดือน) ผ่านตาราง NumberSequence
 */

import { db } from '@/lib/db'

// ── Types ────────────────────────────────────────────────────────────────────

export interface NumberingSchemeRow {
  id: string
  docType: string
  name: string
  pattern: string
  prefix: string | null
  description: string | null
  resetPolicy: string
  isActive: boolean
}

/** บริบทสำหรับการสร้างเลข — แต่ละ docType ส่งมาต่างกัน */
export interface NumberingContext {
  /** device.type เช่น 'PRINTER' (ใช้จับคู่ CategoryCode.matchKey) */
  type?: string | null
  /** วันที่ซื้อ/วันที่สร้างเอกสาร — ปีของเลขมาจากวันนี้ (fallback = วันนี้) */
  purchaseDate?: string | Date | null
  site?: string | null
  departmentCode?: string | null
  /** รหัสหมวดหมู่ตรง ๆ (ข้ามการจับคู่ matchKey) */
  categoryCode?: string | null
}

export interface ResolvedSegments {
  /** ค่าที่ resolve แล้วของแต่ละ token เช่น { 'cat1:3': '001', ... } */
  values: Record<string, string>
  /** ส่วนของเลขที่ไม่ใช่ {seq} เช่น "001-201-2569" */
  scopeKey: string
  /** ค่า seq ถัดไป (preview ใช้ lastValue + 1) */
  seq: number
  seqPadding: number
}

// ── Token helpers ────────────────────────────────────────────────────────────

/** แยก token ทั้งหมดจาก pattern เช่น "{cat1:3}-{seq:5}" → ['cat1:3', 'seq:5'] */
export function parseTokens(pattern: string): string[] {
  const matches = pattern.match(/\{([^}]+)\}/g) || []
  return matches.map((m) => m.slice(1, -1))
}

/** เติมศูนย์ซ้ายให้ครบ N หลัก (ตัดขวาถ้าเกิน) */
function padNum(value: string | number, length: number): string {
  const str = String(value)
  if (str.length > length) return str.slice(0, length)
  return str.padStart(length, '0')
}

function padCode(value: string | null | undefined, length: number, fallback: string): string {
  const str = (value ?? '').trim()
  if (!str) return fallback.padStart(length, '0')
  // ถ้าเป็นตัวเลขล้วน → pad ศูนย์ซ้าย, ถ้าเป็นรหัสตัวอักษร → pad ขวาด้วยช่องว่างแล้ว trim
  if (/^\d+$/.test(str)) return padNum(str, length)
  return str.length >= length ? str.slice(0, length) : str.padEnd(length, ' ').trim()
}

/**
 * จับคู่บริบทกับ CategoryCode ของ docType นั้น
 * คืนโครงสร้างต้นไม้ เช่น { cat1: '001', cat2: '201' }
 *
 * ลำดับการจับคู่:
 *   1. ctx.categoryCode ตรง ๆ → หาแถวนั้น (code หรือ parentCode chain)
 *   2. ctx.type จับคู่แบบ case-insensitive กับ matchKey
 *   3. หาไม่เจอ → cat codes ว่าง (จะกลายเป็น 000 เมื่อ pad)
 */
export async function resolveCategory(
  docType: string,
  ctx: NumberingContext,
): Promise<{ cat1: string | null; cat2: string | null }> {
  const rows = await db.categoryCode.findMany({
    where: { docType, active: true },
    orderBy: { sortOrder: 'asc' },
  })
  if (rows.length === 0) return { cat1: null, cat2: null }

  // 1) direct code override
  let self = null as (typeof rows)[number] | null
  if (ctx.categoryCode) {
    self = rows.find((r) => r.code === ctx.categoryCode) ?? null
  }
  // 2) matchKey (case-insensitive)
  if (!self && ctx.type) {
    const needle = ctx.type.trim().toLowerCase()
    self =
      rows.find((r) => (r.matchKey ?? '').trim().toLowerCase() === needle) ?? null
  }
  if (!self) return { cat1: null, cat2: null }

  // 3) เดินขึ้นต้นไม้หาหมวดแม่
  const cat2 = self.code
  let cat1: string | null = null
  if (self.parentCode) {
    const parent = rows.find((r) => r.code === self!.parentCode)
    cat1 = parent?.code ?? null
  } else {
    // ตัวมันเองเป็นหมวดใหญ่ → cat1 = ตัวมัน, cat2 = null
    cat1 = self.code
    return { cat1, cat2: null }
  }
  return { cat1, cat2 }
}

// ── Segment resolution ──────────────────────────────────────────────────────

/**
 * Resolve pattern เต็มรูปแบบ (ยกเว้น {seq}) — คืนค่า token values + scopeKey + โครง pattern ที่มีแต่ {seq} เหลือ
 */
export async function resolvePattern(
  docType: string,
  scheme: NumberingSchemeRow,
  ctx: NumberingContext,
): Promise<{
  values: Record<string, string>
  scopeKey: string
  seqTemplate: string // pattern ที่ resolve แล้ว เหลือแต่ {seq:N} ยังไม่แทนค่า
  seqPadding: number
}> {
  const now = new Date()
  const dateFor = (() => {
    if (ctx.purchaseDate) {
      const parsed = new Date(ctx.purchaseDate)
      if (!Number.isNaN(parsed.getTime())) return parsed
    }
    return now
  })()
  const ad = dateFor.getFullYear()
  const be = ad + 543
  const month = dateFor.getMonth() + 1

  const tokens = parseTokens(scheme.pattern)
  const { cat1, cat2 } = await resolveCategory(docType, ctx)

  const values: Record<string, string> = {}
  let seqPadding = 5

  for (const tok of tokens) {
    if (values[tok] !== undefined) continue
    const [nameRaw, argRaw] = tok.split(':')
    const name = nameRaw?.trim()
    const arg = argRaw?.trim()

    if (name === 'seq') {
      seqPadding = arg ? parseInt(arg, 10) || 5 : 5
    } else if (name === 'prefix') {
      values[tok] = ((scheme.prefix ?? 'AST').trim() || 'AST')
    } else if (name === 'year') {
      const len = parseInt(arg || '4', 10)
      values[tok] = len === 2 ? String(ad).slice(-2) : String(ad)
    } else if (name === 'yearBE') {
      const len = parseInt(arg || '4', 10)
      values[tok] = len === 2 ? String(be).slice(-2) : String(be)
    } else if (name === 'month') {
      values[tok] = String(month).padStart(2, '0')
    } else if (name === 'site') {
      const len = arg ? parseInt(arg, 10) : 0
      const v = (ctx.site ?? '').trim()
      values[tok] = len ? padCode(v, len, 'GEN') : v || 'GEN'
    } else if (name === 'dept') {
      const len = arg ? parseInt(arg, 10) : 0
      const v = (ctx.departmentCode ?? '').trim()
      values[tok] = len ? padCode(v, len, 'GEN') : v || 'GEN'
    } else if (name === 'type') {
      const len = arg ? parseInt(arg, 10) : 0
      const v = (ctx.type ?? '').trim()
      values[tok] = len ? padCode(v, len, 'GEN') : v || 'GEN'
    } else if (name === 'cat1') {
      const len = arg ? parseInt(arg, 10) : 3
      values[tok] = padCode(cat1, len, '0')
    } else if (name === 'cat2' || name === 'cat') {
      const len = arg ? parseInt(arg, 10) : 3
      values[tok] = padCode(cat2 ?? cat1, len, '0')
    } else if (name === 'cat3') {
      // สงวนไว้สำหรับระดับลึกกว่านี้ในอนาคต — ตอนนี้ = 000
      const len = arg ? parseInt(arg, 10) : 3
      values[tok] = padCode(null, len, '0')
    }
  }

  // สร้าง seqTemplate: แทนที่ทุก token ที่ไม่ใช่ seq
  let seqTemplate = scheme.pattern
  for (const [tok, val] of Object.entries(values)) {
    seqTemplate = seqTemplate.split(`{${tok}}`).join(val)
  }

  // scopeKey = seqTemplate ที่ตัด separator ท้ายที่ติดกับ {seq} ออก
  // เช่น "001-201-2569-{seq:5}" → scopeKey "001-201-2569"
  let scopeKey = seqTemplate.replace(/\{seq(:\d+)?\}/g, '')
  // ตัด separator ท้ายสุด (- _ / ช่องว่าง) ที่เหลือก่อนตำแหน่ง seq
  scopeKey = scopeKey.replace(/[-_\s]+$/, '')

  return { values, scopeKey, seqTemplate, seqPadding }
}

/** แทนค่า seq ลงใน seqTemplate */
function insertSeq(seqTemplate: string, seq: number, seqPadding: number): string {
  return seqTemplate.replace(/\{seq(:\d+)?\}/g, (_, _arg) =>
    String(seq).padStart(seqPadding, '0'),
  )
}

// ── Scheme management ───────────────────────────────────────────────────────

export async function getActiveScheme(docType: string): Promise<NumberingSchemeRow | null> {
  const row = await db.numberingScheme.findFirst({
    where: { docType, isActive: true },
  })
  if (!row) return null
  return {
    id: row.id,
    docType: row.docType,
    name: row.name,
    pattern: row.pattern,
    prefix: row.prefix,
    description: row.description,
    resetPolicy: row.resetPolicy,
    isActive: row.isActive,
  }
}

/** สร้าง scheme เริ่มต้นของ docType ถ้ายังไม่มี */
export async function ensureDefaultSchemes(docType: string): Promise<void> {
  const count = await db.numberingScheme.count({ where: { docType } })
  if (count > 0) return

  if (docType === 'device') {
    await db.numberingScheme.createMany({
      data: [
        {
          docType,
          name: 'หมวดหมู่–หมวดย่อย–ปี พ.ศ.–ลำดับ',
          pattern: '{cat1:3}-{cat2:3}-{yearBE:4}-{seq:5}',
          description: '001-201-2569-00001 (หมวดใหญ่-หมวดย่อย-ปีพ.ศ.-เลขลำดับ แยกนับต่อหมวดและปี)',
          resetPolicy: 'yearly',
          isActive: true,
        },
        {
          docType,
          name: 'แบบเรียบง่าย (คำนำหน้า-ลำดับ)',
          pattern: '{prefix}-{seq:5}',
          prefix: 'ASSET',
          description: 'ASSET-00001 (เลขลำดับเดี่ยว นับต่อเนื่อง)',
          resetPolicy: 'never',
          isActive: false,
        },
      ],
    })
  } else if (docType === 'work-order') {
    await db.numberingScheme.createMany({
      data: [
        {
          docType,
          name: 'คำนำหน้า–ปี พ.ศ.–ลำดับ',
          pattern: '{prefix}-{yearBE:2}-{seq:4}',
          prefix: 'WO',
          description: 'WO-69-0001 (รีเซ็ตลำดับรายปี)',
          resetPolicy: 'yearly',
          isActive: false,
        },
      ],
    })
  }
}

// ── Sequence allocation (atomic) ─────────────────────────────────────────────

function periodFor(resetPolicy: string, dateFor: Date): string {
  if (resetPolicy === 'yearly') return String(dateFor.getFullYear())
  if (resetPolicy === 'monthly') return `${dateFor.getFullYear()}-${String(dateFor.getMonth() + 1).padStart(2, '0')}`
  return ''
}

/**
 * จัดสรรเลขลำดับถัดไปแบบ atomic
 * upsert + increment ภายใน transaction — SQLite เขียนทีละคนจึงปลอดภัย
 * มี retry เผื่อชนกัน (unique constraint หรือ write lock)
 */
export async function allocateSeq(
  scheme: NumberingSchemeRow,
  scopeKey: string,
  dateFor: Date,
): Promise<number> {
  const period = periodFor(scheme.resetPolicy, dateFor)
  const SEQ_START = 1

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const row = await db.$transaction(async (tx) => {
        const existing = await tx.numberSequence.findUnique({
          where: {
            schemeId_scopeKey_period: { schemeId: scheme.id, scopeKey, period },
          },
        })
        if (!existing) {
          const created = await tx.numberSequence.create({
            data: { schemeId: scheme.id, scopeKey, period, lastValue: SEQ_START },
          })
          return created.lastValue
        }
        const updated = await tx.numberSequence.update({
          where: { id: existing.id },
          data: { lastValue: { increment: 1 } },
        })
        return updated.lastValue
      })
      return row
    } catch (err) {
      const code = (err as { code?: string })?.code
      if (code === 'P2002' && attempt < 3) {
        // แถวถูกสร้างพร้อมกัน — ลองใหม่ (ครั้งหน้าจะเข้า path update)
        await new Promise((r) => setTimeout(r, 25 * (attempt + 1)))
        continue
      }
      throw err
    }
  }
  throw new Error('allocateSeq: exhausted retries')
}

/**
 * ดูเลขถัดไป "โดยไม่กินเลข" (สำหรับ preview ใน UI)
 */
export async function peekNextSeq(
  scheme: NumberingSchemeRow,
  scopeKey: string,
  dateFor: Date,
): Promise<number> {
  const period = periodFor(scheme.resetPolicy, dateFor)
  const row = await db.numberSequence.findUnique({
    where: { schemeId_scopeKey_period: { schemeId: scheme.id, scopeKey, period } },
  })
  return (row?.lastValue ?? 0) + 1
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * สร้างเลขถัดไปจาก scheme ที่ active ของ docType (จัดสรรเลขจริง)
 * คืน null ถ้าไม่มี scheme ที่ active
 */
export async function allocateNextNumber(
  docType: string,
  ctx: NumberingContext,
): Promise<string | null> {
  const scheme = await getActiveScheme(docType)
  if (!scheme) return null

  const { scopeKey, seqTemplate, seqPadding } = await resolvePattern(docType, scheme, ctx)
  const dateFor = ctx.purchaseDate ? safeDate(ctx.purchaseDate) : new Date()
  const seq = await allocateSeq(scheme, scopeKey, dateFor)
  return insertSeq(seqTemplate, seq, seqPadding)
}

/**
 * พรีวิวเลขถัดไปโดยไม่กินเลข (แสดงใน UI)
 */
export async function previewNextNumber(
  docType: string,
  ctx: NumberingContext,
  schemeOverride?: NumberingSchemeRow,
): Promise<string | null> {
  const scheme = schemeOverride ?? (await getActiveScheme(docType))
  if (!scheme) return null

  const { scopeKey, seqTemplate, seqPadding } = await resolvePattern(docType, scheme, ctx)
  const dateFor = ctx.purchaseDate ? safeDate(ctx.purchaseDate) : new Date()
  const seq = await peekNextSeq(scheme, scopeKey, dateFor)
  return insertSeq(seqTemplate, seq, seqPadding)
}

function safeDate(d: string | Date): Date {
  const parsed = new Date(d)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

// ── Token catalog (สำหรับ UI builder) ───────────────────────────────────────

export interface TokenDoc {
  token: string
  label: string
  desc: string
  example: string
}

export const TOKEN_CATALOG: TokenDoc[] = [
  { token: '{cat1:3}', label: 'รหัสหมวดใหญ่', desc: 'รหัสหมวดหมู่ระดับ 1 จากตารางหมวดหมู่', example: '001' },
  { token: '{cat2:3}', label: 'รหัสหมวดย่อย', desc: 'รหัสหมวดหมู่ระดับ 2 เช่น ปรินเตอร์ AIO', example: '201' },
  { token: '{cat:3}', label: 'รหัสหมวดของรายการ', desc: 'หมวดหมู่ที่จับคู่กับรายการนี้ (เหมือน cat2)', example: '201' },
  { token: '{yearBE:4}', label: 'ปี พ.ศ.', desc: 'ปีพุทธศักราชจากวันที่ซื้อ', example: '2569' },
  { token: '{yearBE:2}', label: 'ปี พ.ศ. (2 หลัก)', desc: 'เช่น 69', example: '69' },
  { token: '{year:4}', label: 'ปี ค.ศ.', desc: 'ปีคริสต์ศักราชจากวันที่ซื้อ', example: '2026' },
  { token: '{month:2}', label: 'เดือน', desc: 'เดือนจากวันที่ซื้อ (01–12)', example: '09' },
  { token: '{site}', label: 'รหัสสาขา', desc: 'สาขาที่ลงทะเบียน', example: 'UDH' },
  { token: '{dept:4}', label: 'รหัสแผนก', desc: 'รหัสแผนกผู้ใช้งาน', example: 'ACC' },
  { token: '{type}', label: 'ประเภทอุปกรณ์', desc: 'ประเภทตรงจากข้อมูลอุปกรณ์', example: 'PRINTER' },
  { token: '{prefix}', label: 'คำนำหน้า', desc: 'กำหนดเองในช่องคำนำหน้า', example: 'ASSET' },
  { token: '{seq:5}', label: 'เลขลำดับ', desc: 'นับต่อเนื่องต่อ scope (เติมศูนย์ N หลัก)', example: '00001' },
]
