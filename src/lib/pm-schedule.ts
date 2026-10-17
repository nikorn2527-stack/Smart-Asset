/** PM dates are civil dates in Asia/Bangkok, independent of server/browser timezone. */
export interface PMScheduleRule {
  frequency: string
  intervalDays?: number | null
  dayOfMonth?: number | null
  weekday?: string | null
  startMonth?: number | null
  startDate?: string | null
}
const DAY = 86_400_000
const WEEKDAY_MAP: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 }
const FREQUENCIES = new Set(['daily', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly', 'custom'])
export class PMScheduleInputError extends Error {}
export function bangkokDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const value = (name: string) => parts.find(p => p.type === name)!.value
  return `${value('year')}-${value('month')}-${value('day')}`
}
function epoch(iso: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new PMScheduleInputError('วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD')
  const value = Date.parse(iso + 'T00:00:00Z')
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0,10) !== iso || Number(iso.slice(0,4)) < 1900 || Number(iso.slice(0,4)) > 2200) throw new PMScheduleInputError('วันที่ไม่ถูกต้อง (รองรับปี ค.ศ. 1900–2200)')
  return value
}
function iso(value: number): string { return new Date(value).toISOString().slice(0,10) }
export function validatePMScheduleRule(rule: PMScheduleRule): void {
  if (!FREQUENCIES.has(rule.frequency)) throw new PMScheduleInputError('กรุณาเลือกรอบ PM ที่ถูกต้อง')
  if (rule.startDate) epoch(rule.startDate)
  if (rule.intervalDays != null && (!Number.isInteger(rule.intervalDays) || rule.intervalDays < 1 || rule.intervalDays > 36500)) throw new PMScheduleInputError('จำนวนวันต้องเป็นจำนวนเต็ม 1–36500')
  if (rule.dayOfMonth != null && (!Number.isInteger(rule.dayOfMonth) || rule.dayOfMonth < 1 || rule.dayOfMonth > 31)) throw new PMScheduleInputError('วันที่ของเดือนต้องเป็นจำนวนเต็ม 1–31')
  if (rule.startMonth != null && (!Number.isInteger(rule.startMonth) || rule.startMonth < 1 || rule.startMonth > 12)) throw new PMScheduleInputError('เดือนต้องอยู่ระหว่าง 1–12')
  if (rule.weekday != null && !(rule.weekday in WEEKDAY_MAP)) throw new PMScheduleInputError('วันในสัปดาห์ไม่ถูกต้อง')
  if (rule.frequency === 'custom' && (!rule.startDate || rule.intervalDays == null)) throw new PMScheduleInputError('รอบทุก N วันต้องระบุวันเริ่มต้นและจำนวนวัน')
}
export function serializePMChecklist(input: unknown): string | null {
  if (input == null || input === '') return null
  let items: unknown = input
  if (typeof input === 'string') {
    try { items = JSON.parse(input) } catch { throw new PMScheduleInputError('รายการตรวจไม่ใช่ JSON ที่ถูกต้อง') }
  }
  if (!Array.isArray(items) || items.length > 100) throw new PMScheduleInputError('รายการตรวจต้องเป็นรายการไม่เกิน 100 ข้อ')
  const ids = new Set<string>()
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 100 || ids.has(item.id) || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 500 || typeof item.required !== 'boolean') throw new PMScheduleInputError('แต่ละข้อของรายการตรวจต้องมีรหัสไม่ซ้ำ ชื่อ และสถานะบังคับตรวจ')
    ids.add(item.id)
  }
  return JSON.stringify(items.map(item => ({ id: item.id, label: item.label.trim(), required: item.required })))
}

function matches(rule: PMScheduleRule, date: number): boolean {
  if (rule.startDate && date < epoch(rule.startDate)) return false
  const d = new Date(date), month = d.getUTCMonth() + 1
  switch (rule.frequency) {
    case 'daily': return true
    case 'weekly': return d.getUTCDay() === WEEKDAY_MAP[rule.weekday ?? 'MON']
    case 'custom': return ((date - epoch(rule.startDate!)) / DAY) % rule.intervalDays! === 0
    default: {
      const cycle = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 }[rule.frequency]!
      if ((month - (rule.startMonth ?? 1) + 12) % cycle !== 0) return false
      const lastDay = new Date(Date.UTC(d.getUTCFullYear(), month, 0)).getUTCDate()
      return d.getUTCDate() === Math.min(rule.dayOfMonth ?? 1, lastDay)
    }
  }
}
/** Earliest occurrence ON OR AFTER fromDate, respecting the plan's start date. */
export function computeNextRunDate(rule: PMScheduleRule, fromDate: Date = new Date()): string {
  validatePMScheduleRule(rule)
  const from = Math.max(epoch(bangkokDate(fromDate)), rule.startDate ? epoch(rule.startDate) : -Infinity)
  if (rule.frequency === 'custom') {
    const anchor = epoch(rule.startDate!), interval = rule.intervalDays! * DAY
    return iso(anchor + Math.max(0, Math.ceil((from - anchor) / interval)) * interval)
  }
  for (let offset = 0; offset <= 366; offset++) if (matches(rule, from + offset * DAY)) return iso(from + offset * DAY)
  throw new PMScheduleInputError('ไม่สามารถหาวันนัดถัดไปได้')
}
export function generateScheduledDatesForMonth(rule: PMScheduleRule, year: number, month: number): string[] {
  validatePMScheduleRule(rule)
  if (!Number.isInteger(year) || year < 1900 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) throw new PMScheduleInputError('เดือนหรือปีไม่ถูกต้อง')
  const dates: string[] = [], days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  for (let day = 1; day <= days; day++) {
    const date = Date.UTC(year, month - 1, day)
    if (matches(rule,date)) dates.push(iso(date))
  }
  return dates
}
export function upcomingPMDates(rule: PMScheduleRule, count = 5, fromDate = new Date()): string[] {
  const dates: string[] = []
  let from = fromDate
  for (let index = 0; index < Math.min(12,count); index++) {
    const date = computeNextRunDate(rule,from)
    dates.push(date)
    from = new Date(epoch(date) + DAY)
  }
  return dates
}

export const FREQUENCY_LABELS: Record<string, string> = {
  daily: 'ทุกวัน',
  weekly: 'ทุกสัปดาห์',
  monthly: 'ทุกเดือน',
  quarterly: 'ทุกไตรมาส (3 เดือน)',
  half_yearly: 'ทุกครึ่งปี (6 เดือน)',
  yearly: 'ทุกปี',
  custom: 'กำหนดเอง',
}

export const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'ทุกวัน' },
  { value: 'weekly', label: 'ทุกสัปดาห์' },
  { value: 'monthly', label: 'ทุกเดือน' },
  { value: 'quarterly', label: 'ทุกไตรมาส (3 เดือน)' },
  { value: 'half_yearly', label: 'ทุกครึ่งปี (6 เดือน)' },
  { value: 'yearly', label: 'ทุกปี' },
  { value: 'custom', label: 'กำหนดเอง (ทุก N วัน)' },
]

export const WEEKDAY_OPTIONS = [
  { value: 'SUN', label: 'อาทิตย์' },
  { value: 'MON', label: 'จันทร์' },
  { value: 'TUE', label: 'อังคาร' },
  { value: 'WED', label: 'พุธ' },
  { value: 'THU', label: 'พฤหัส' },
  { value: 'FRI', label: 'ศุกร์' },
  { value: 'SAT', label: 'เสาร์' },
]

export const WEEKDAY_LABELS: Record<string, string> = {
  SUN: 'อาทิตย์',
  MON: 'จันทร์',
  TUE: 'อังคาร',
  WED: 'พุธ',
  THU: 'พฤหัส',
  FRI: 'ศุกร์',
  SAT: 'เสาร์',
}

/** Generate the next schedule number: PM-YYYYMM-NNN */
export async function generateScheduleNumber(
  existingCount: (prefix: string) => Promise<number>,
): Promise<string> {
  const now = new Date()
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const prefix = `PM-${ymd}-`
  const count = await existingCount(prefix)
  return `${prefix}${String(count + 1).padStart(3, '0')}`
}
