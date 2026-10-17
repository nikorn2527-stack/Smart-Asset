import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'

// ============================================================
// Work-Order Options API
//   GET    /api/settings/options              — list { subjects, buildings, resolutions }
//   POST   /api/settings/options              — add { type, value, group?, defaultPriority? }
//   DELETE /api/settings/options/[id]         — remove by id
//
// Storage (AppSetting JSON arrays):
//   - 'subjectOptions'     → [{ id, group, value, default_priority }]
//   - 'wo_buildings'       → [{ id, group, value }]
//   - 'resolutionOptions'  → [{ id, group, value }]
// (The legacy 'subjectOptions'/'resolutionOptions' keys are kept so the
//  existing parseSubjects/parseResolutions readers continue to work; new
//  entries include a stable `id` for safe deletion.)
// ============================================================

export interface SubjectOption {
  id?: string
  group: string
  value: string
  default_priority: string
}
export interface BuildingOption {
  id?: string
  group: string
  value: string
}
export interface ResolutionOption {
  id?: string
  group: string
  value: string
}

interface OptionsResponse {
  subjects: SubjectOption[]
  buildings: BuildingOption[]
  resolutions: ResolutionOption[]
}

const VALID_PRIORITIES = new Set(['ปกติ', 'ปานกลาง', 'สูง', 'ด่วน'])
const VALID_TYPES = new Set(['subject', 'building', 'resolution'])

// ── Default subject options (35 items across 4 groups) ──
const DEFAULT_SUBJECTS: SubjectOption[] = [
  { group: 'อาการทั่วไป', value: 'เครื่องไม่เปิด', default_priority: 'ปานกลาง' },
  { group: 'อาการทั่วไป', value: 'เครื่องค้าง / แฮงค์', default_priority: 'ปานกลาง' },
  { group: 'อาการทั่วไป', value: 'ช้าผิดปกติ', default_priority: 'ปกติ' },
  { group: 'อาการทั่วไป', value: 'เสียงดังผิดปกติ', default_priority: 'ปกติ' },
  { group: 'อาการทั่วไป', value: 'เครื่องร้อนจัด', default_priority: 'ปานกลาง' },
  { group: 'อาการทั่วไป', value: 'ไฟไม่ติด / ไม่รับไฟ', default_priority: 'สูง' },
  { group: 'อาการทั่วไป', value: 'จอไม่แสดงผล', default_priority: 'ปานกลาง' },
  { group: 'อาการทั่วไป', value: 'คีย์บอร์ด/เมาส์ไม่ทำงาน', default_priority: 'ปกติ' },
  { group: 'อาการทั่วไป', value: 'ซอฟต์แวร์ใช้งานไม่ได้', default_priority: 'ปานกลาง' },
  { group: 'อาการทั่วไป', value: 'ไวรัส / มัลแวร์', default_priority: 'สูง' },
  { group: 'อาการทั่วไป', value: 'อีเมล/Office ไม่ทำงาน', default_priority: 'ปานกลาง' },
  { group: 'อาการทั่วไป', value: 'สิทธิ์การใช้งาน/ล็อกอินไม่ได้', default_priority: 'ปานกลาง' },
  { group: 'Printer', value: 'พิมพ์ไม่ออก', default_priority: 'ปานกลาง' },
  { group: 'Printer', value: 'พิมพ์ไม่ชัด / มีลายเส้น', default_priority: 'ปกติ' },
  { group: 'Printer', value: 'กระดาษติด / แยม', default_priority: 'ปกติ' },
  { group: 'Printer', value: 'หมึกหมด / เตือนหมึก', default_priority: 'ปกติ' },
  { group: 'Printer', value: 'เครื่องพิมพ์ออฟไลน์', default_priority: 'ปานกลาง' },
  { group: 'Printer', value: 'พิมพ์ช้ามาก', default_priority: 'ปกติ' },
  { group: 'Printer', value: 'พิมพ์สีไม่ตรง / สีซีด', default_priority: 'ปกติ' },
  { group: 'Printer', value: 'ตัวเครื่องมีไฟแจ้งเตือน', default_priority: 'ปานกลาง' },
  { group: 'Printer', value: 'สแกนเนอร์ไม่ทำงาน', default_priority: 'ปานกลาง' },
  { group: 'Printer', value: 'เชื่อมต่อเครื่องพิมพ์ไม่ได้', default_priority: 'ปานกลาง' },
  { group: 'Network', value: 'อินเทอร์เน็ตไม่ติด', default_priority: 'สูง' },
  { group: 'Network', value: 'เน็ตช้า / กระตุก', default_priority: 'ปานกลาง' },
  { group: 'Network', value: 'Wi-Fi ใช้งานไม่ได้', default_priority: 'ปานกลาง' },
  { group: 'Network', value: 'เชื่อมต่อ VPN ไม่ได้', default_priority: 'ปานกลาง' },
  { group: 'Network', value: 'เครือข่ายภายในไม่เข้าถึงได้', default_priority: 'สูง' },
  { group: 'Network', value: 'IP ชนกัน / ไม่ได้รับ IP', default_priority: 'ปานกลาง' },
  { group: 'Network', value: 'สาย LAN ชำรุด', default_priority: 'ปกติ' },
  { group: 'อื่นๆ', value: 'สอบถามการใช้งาน', default_priority: 'ปกติ' },
  { group: 'อื่นๆ', value: 'ขอติดตั้งอุปกรณ์ใหม่', default_priority: 'ปกติ' },
  { group: 'อื่นๆ', value: 'ขอย้ายเครื่อง/ที่ตั้ง', default_priority: 'ปกติ' },
  { group: 'อื่นๆ', value: 'ขอข้อมูล/คู่มือ', default_priority: 'ปกติ' },
  { group: 'อื่นๆ', value: 'อื่นๆ (ระบุในรายละเอียด)', default_priority: 'ปกติ' },
]

// ── Default resolution options (43 items across 5 groups) ──
const DEFAULT_RESOLUTIONS: ResolutionOption[] = [
  { group: 'ซ่อมสำเร็จ', value: 'ซ่อมสำเร็จ — ตรวจพบและแก้ไขสาเหตุ' },
  { group: 'ซ่อมสำเร็จ', value: 'แก้ไขการตั้งค่าระบบ' },
  { group: 'ซ่อมสำเร็จ', value: 'อัปเดตไดรเวอร์ / เฟิร์มแวร์' },
  { group: 'ซ่อมสำเร็จ', value: 'อัปเดตระบบปฏิบัติการ' },
  { group: 'ซ่อมสำเร็จ', value: 'ลบ/ติดตั้งซอฟต์แวร์ใหม่' },
  { group: 'ซ่อมสำเร็จ', value: 'ทำความสะอาดเครื่อง / แก้ฝุ่น' },
  { group: 'ซ่อมสำเร็จ', value: 'เคลียร์แคช / รีเซ็ตระบบ' },
  { group: 'ซ่อมสำเร็จ', value: 'เชื่อมต่อสาย / ปรับสายเคเบิล' },
  { group: 'ซ่อมสำเร็จ', value: 'รีสตาร์ทเครื่องแล้วใช้งานได้' },
  { group: 'ซ่อมสำเร็จ', value: 'ตรวจสอบพบว่าไม่มีปัญหา (No trouble found)' },
  { group: 'ซ่อมสำเร็จ', value: 'ปัญหาที่ผู้แจ้งรายงานหายไปแล้ว' },
  { group: 'ซ่อมสำเร็จ', value: 'แก้ไขสิทธิ์การเข้าถึง' },
  { group: 'ซ่อมสำเร็จ', value: 'แก้ไขการเชื่อมต่อเครือข่าย' },
  { group: 'ซ่อมสำเร็จ', value: 'แก้ไขการตั้งค่าพรินเตอร์' },
  { group: 'ซ่อมสำเร็จ', value: 'คืนค่าการตั้งค่าจากการสำรองข้อมูล' },
  { group: 'เปลี่ยนอะไหล่', value: 'เปลี่ยนหมึกพิมพ์ / โทนเนอร์' },
  { group: 'เปลี่ยนอะไหล่', value: 'เปลี่ยน Drum / Fuser' },
  { group: 'เปลี่ยนอะไหล่', value: 'เปลี่ยนฮาร์ดดิสก์ / SSD' },
  { group: 'เปลี่ยนอะไหล่', value: 'เปลี่ยนแรม (RAM)' },
  { group: 'เปลี่ยนอะไหล่', value: 'เปลี่ยนพาวเวอร์ซัพพลาย' },
  { group: 'เปลี่ยนอะไหล่', value: 'เปลี่ยนคีย์บอร์ด / เมาส์' },
  { group: 'เปลี่ยนอะไหล่', value: 'เปลี่ยนสาย / อะแดปเตอร์' },
  { group: 'เปลี่ยนอะไหล่', value: 'เปลี่ยนการ์ดเครือข่าย' },
  { group: 'เปลี่ยนอะไหล่', value: 'เปลี่ยนหัวพิมพ์ (Print head)' },
  { group: 'เปลี่ยนอะไหล่', value: 'เปลี่ยนอะไหล่อื่นๆ' },
  { group: 'ปรับแต่ง/ตั้งค่า', value: 'ตั้งค่า IP / Network ใหม่' },
  { group: 'ปรับแต่ง/ตั้งค่า', value: 'ตั้งค่าพรินเตอร์ใหม่' },
  { group: 'ปรับแต่ง/ตั้งค่า', value: 'ตั้งค่าซอฟต์แวร์ใหม่' },
  { group: 'ปรับแต่ง/ตั้งค่า', value: 'ย้ายข้อมูล / Migration' },
  { group: 'ปรับแต่ง/ตั้งค่า', value: 'ติดตั้งซอฟต์แวร์ใหม่' },
  { group: 'ปรับแต่ง/ตั้งค่า', value: 'เพิ่ม/ลดสิทธิ์ผู้ใช้' },
  { group: 'ปรับแต่ง/ตั้งค่า', value: 'ตั้งค่าการสำรองข้อมูล' },
  { group: 'ปรับแต่ง/ตั้งค่า', value: 'ตั้งค่าอุปกรณ์ใหม่ทั้งหมด' },
  { group: 'ส่งซ่อมภายนอก', value: 'ส่งซ่อมกับผู้จำหน่าย (Vendor)' },
  { group: 'ส่งซ่อมภายนอก', value: 'ส่งศูนย์บริการ' },
  { group: 'ส่งซ่อมภายนอก', value: 'เคลมประกัน / Warranty' },
  { group: 'ส่งซ่อมภายนอก', value: 'ส่งตรวจวิเคราะห์ภายนอก' },
  { group: 'ส่งซ่อมภายนอก', value: 'รออะไหล่สั่งซื้อ' },
  { group: 'อื่นๆ', value: 'ผู้แจ้งขอถอนใบงาน' },
  { group: 'อื่นๆ', value: 'ไม่สามารถทำซ่อมได้ (ทำลาย/เสียหายถาวร)' },
  { group: 'อื่นๆ', value: 'แจ้งซ่อมซ้ำ / งานซ้ำ' },
  { group: 'อื่นๆ', value: 'ไม่พบปัญหา ณ ที่ตั้ง (ตรวจสอบแล้วใช้งานได้)' },
  { group: 'อื่นๆ', value: 'อื่นๆ (ระบุในหมายเหตุ)' },
]

// ── Default building options (initial seed) ──
const DEFAULT_BUILDINGS: BuildingOption[] = [
  { group: 'ทั่วไป', value: 'อาคาร 1' },
  { group: 'ทั่วไป', value: 'อาคาร 2' },
  { group: 'ทั่วไป', value: 'อาคาร 3' },
  { group: 'ทั่วไป', value: 'อาคารผู้ป่วยนอก (OPD)' },
  { group: 'ทั่วไป', value: 'อาคารผู้ป่วยใน (IPD)' },
  { group: 'ทั่วไป', value: 'ศูนย์รับบริจาคโลหิต' },
  { group: 'ฝ่าย', value: 'ฝ่ายเทคโนโลยีสารสนเทศ' },
  { group: 'ฝ่าย', value: 'ฝ่ายบัญชี' },
  { group: 'ฝ่าย', value: 'ฝ่ายการเงิน' },
  { group: 'ฝ่าย', value: 'ฝ่ายบุคคล' },
  { group: 'ฝ่าย', value: 'ฝ่ายพัสดุ' },
]

function makeId(prefix: string): string {
  return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3)
}

function withIds<T extends { id?: string }>(arr: T[], prefix: string): T[] {
  return arr.map((item, idx) =>
    item.id ? item : { ...item, id: `${prefix}_legacy_${idx}` },
  )
}

function parseSubjects(value: string | null | undefined): SubjectOption[] {
  if (!value) return withIds(DEFAULT_SUBJECTS, 'subj')
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return withIds(DEFAULT_SUBJECTS, 'subj')
    const out: SubjectOption[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const group = String(item.group ?? '').trim()
      if (group && typeof item.value === 'string') {
        const dp = String(item.default_priority ?? 'ปกติ').trim()
        out.push({
          id: typeof item.id === 'string' ? item.id : undefined,
          group,
          value: String(item.value).trim(),
          default_priority: VALID_PRIORITIES.has(dp) ? dp : 'ปกติ',
        })
      } else if (group && Array.isArray(item.options)) {
        for (const opt of item.options) {
          if (!opt || typeof opt.value !== 'string') continue
          const dp = String(opt.default_priority ?? 'ปกติ').trim()
          out.push({
            id: typeof opt.id === 'string' ? opt.id : undefined,
            group,
            value: String(opt.value).trim(),
            default_priority: VALID_PRIORITIES.has(dp) ? dp : 'ปกติ',
          })
        }
      }
    }
    if (out.length === 0) return withIds(DEFAULT_SUBJECTS, 'subj')
    return withIds(out, 'subj')
  } catch {
    return withIds(DEFAULT_SUBJECTS, 'subj')
  }
}

function parseBuildings(value: string | null | undefined): BuildingOption[] {
  if (!value) return withIds(DEFAULT_BUILDINGS, 'bld')
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return withIds(DEFAULT_BUILDINGS, 'bld')
    const out: BuildingOption[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const group = String(item.group ?? '').trim() || 'ทั่วไป'
      if (typeof item.value === 'string' && item.value.trim()) {
        out.push({
          id: typeof item.id === 'string' ? item.id : undefined,
          group,
          value: String(item.value).trim(),
        })
      }
    }
    if (out.length === 0) return withIds(DEFAULT_BUILDINGS, 'bld')
    return withIds(out, 'bld')
  } catch {
    return withIds(DEFAULT_BUILDINGS, 'bld')
  }
}

function parseResolutions(value: string | null | undefined): ResolutionOption[] {
  if (!value) return withIds(DEFAULT_RESOLUTIONS, 'res')
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return withIds(DEFAULT_RESOLUTIONS, 'res')
    const out: ResolutionOption[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const group = String(item.group ?? '').trim()
      if (group && typeof item.value === 'string') {
        out.push({
          id: typeof item.id === 'string' ? item.id : undefined,
          group,
          value: String(item.value).trim(),
        })
      } else if (group && Array.isArray(item.options)) {
        for (const opt of item.options) {
          if (!opt || typeof opt.value !== 'string') continue
          out.push({
            id: typeof opt.id === 'string' ? opt.id : undefined,
            group,
            value: String(opt.value).trim(),
          })
        }
      }
    }
    if (out.length === 0) return withIds(DEFAULT_RESOLUTIONS, 'res')
    return withIds(out, 'res')
  } catch {
    return withIds(DEFAULT_RESOLUTIONS, 'res')
  }
}

function serializeSubjects(arr: SubjectOption[]): string {
  return JSON.stringify(arr.map(({ id, ...rest }) => (id ? { id, ...rest } : rest)))
}
function serializeBuildings(arr: BuildingOption[]): string {
  return JSON.stringify(arr.map(({ id, ...rest }) => (id ? { id, ...rest } : rest)))
}
function serializeResolutions(arr: ResolutionOption[]): string {
  return JSON.stringify(arr.map(({ id, ...rest }) => (id ? { id, ...rest } : rest)))
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const [subjRow, bldRow, resRow] = await Promise.all([
      db.appSetting.findUnique({ where: { key: 'subjectOptions' } }),
      db.appSetting.findUnique({ where: { key: 'wo_buildings' } }),
      db.appSetting.findUnique({ where: { key: 'resolutionOptions' } }),
    ])

    const subjects = parseSubjects(subjRow?.value)
    const buildings = parseBuildings(bldRow?.value)
    const resolutions = parseResolutions(resRow?.value)

    const body: OptionsResponse = { subjects, buildings, resolutions }
    return NextResponse.json(body)
  } catch (err) {
    console.error('GET /api/settings/options', err)
    return NextResponse.json(
      {
        error: 'Failed to load options',
        subjects: withIds(DEFAULT_SUBJECTS, 'subj'),
        buildings: withIds(DEFAULT_BUILDINGS, 'bld'),
        resolutions: withIds(DEFAULT_RESOLUTIONS, 'res'),
      } as OptionsResponse & { error: string },
      { status: 500 },
    )
  }
}

// ============================================================
// POST /api/settings/options
// Body: { type: 'subject'|'building'|'resolution', value, group?, defaultPriority? }
// ============================================================
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, 'MASTER_DATA_EDIT')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await req.json()
    const type = String(body.type ?? '').toLowerCase().trim()
    if (!VALID_TYPES.has(type)) {
      return NextResponse.json(
        { error: "type ต้องเป็น 'subject' | 'building' | 'resolution'" },
        { status: 400 },
      )
    }
    const value = String(body.value ?? '').trim()
    if (!value) {
      return NextResponse.json({ error: 'กรุณาระบุ value' }, { status: 400 })
    }
    const group = String(body.group ?? '').trim() || (type === 'building' ? 'ทั่วไป' : 'อื่นๆ')
    const defaultPriority = VALID_PRIORITIES.has(String(body.defaultPriority ?? '').trim())
      ? String(body.defaultPriority).trim()
      : 'ปกติ'

    if (type === 'subject') {
      const existing = parseSubjects(
        (await db.appSetting.findUnique({ where: { key: 'subjectOptions' } }))?.value,
      )
      if (existing.some((s) => s.value === value && s.group === group)) {
        return NextResponse.json({ error: 'มีหัวข้อนี้อยู่แล้ว' }, { status: 409 })
      }
      const entry: SubjectOption = { id: makeId('subj'), group, value, default_priority: defaultPriority }
      const next = [...existing, entry]
      await db.appSetting.upsert({
        where: { key: 'subjectOptions' },
        update: { value: serializeSubjects(next) },
        create: { key: 'subjectOptions', value: serializeSubjects(next) },
      })
      try {
        await db.auditLog.create({
          data: {
            action: 'WO_OPTIONS_ADD',
            entity: 'AppSetting',
            entityId: entry.id,
            summary: `เพิ่มหัวข้อปัญหา "${value}" (${group})`,
            detail: JSON.stringify({ type, entry, actor: auth.user.email }),
            actor: auth.user.email,
          },
        })
      } catch (err) { console.error('[route]', err) }
      return NextResponse.json({ data: entry }, { status: 201 })
    }

    if (type === 'building') {
      const existing = parseBuildings(
        (await db.appSetting.findUnique({ where: { key: 'wo_buildings' } }))?.value,
      )
      if (existing.some((b) => b.value === value)) {
        return NextResponse.json({ error: 'มีอาคาร/ฝ่ายนี้อยู่แล้ว' }, { status: 409 })
      }
      const entry: BuildingOption = { id: makeId('bld'), group, value }
      const next = [...existing, entry]
      await db.appSetting.upsert({
        where: { key: 'wo_buildings' },
        update: { value: serializeBuildings(next) },
        create: { key: 'wo_buildings', value: serializeBuildings(next) },
      })
      try {
        await db.auditLog.create({
          data: {
            action: 'WO_OPTIONS_ADD',
            entity: 'AppSetting',
            entityId: entry.id,
            summary: `เพิ่มอาคาร/ฝ่าย "${value}" (${group})`,
            detail: JSON.stringify({ type, entry, actor: auth.user.email }),
            actor: auth.user.email,
          },
        })
      } catch (err) { console.error('[route]', err) }
      return NextResponse.json({ data: entry }, { status: 201 })
    }

    // resolution
    const existing = parseResolutions(
      (await db.appSetting.findUnique({ where: { key: 'resolutionOptions' } }))?.value,
    )
    if (existing.some((r) => r.value === value && r.group === group)) {
      return NextResponse.json({ error: 'มีผลการแก้ไขนี้อยู่แล้ว' }, { status: 409 })
    }
    const entry: ResolutionOption = { id: makeId('res'), group, value }
    const next = [...existing, entry]
    await db.appSetting.upsert({
      where: { key: 'resolutionOptions' },
      update: { value: serializeResolutions(next) },
      create: { key: 'resolutionOptions', value: serializeResolutions(next) },
    })
    try {
      await db.auditLog.create({
        data: {
          action: 'WO_OPTIONS_ADD',
          entity: 'AppSetting',
          entityId: entry.id,
          summary: `เพิ่มผลการแก้ไข "${value}" (${group})`,
          detail: JSON.stringify({ type, entry, actor: auth.user.email }),
          actor: auth.user.email,
        },
      })
    } catch (err) { console.error('[route]', err) }
    return NextResponse.json({ data: entry }, { status: 201 })
  } catch (err) {
    console.error('POST /api/settings/options', err)
    return NextResponse.json({ error: 'Failed to add option' }, { status: 500 })
  }
}
