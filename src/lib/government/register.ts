/** Official register data contract. Government documents are versioned snapshots. */
export const REGISTER_FIELDS = [
  ['organization','ส่วนราชการ'],['department','หน่วยงาน'],['type','ประเภท'],['code','รหัส'],
  ['description','ลักษณะ/คุณสมบัติ'],['model','รุ่น/แบบ'],['location','สถานที่ตั้ง/หน่วยงานรับผิดชอบ'],
  ['vendor','ชื่อผู้ขาย/ผู้รับจ้าง/ผู้บริจาค'],['address','ที่อยู่'],['phone','โทร.'],['gfmis','เลขที่ GFMIS'],
  ['po','เลขที่ PO'],['serial','S/N :'],['warranty','สิ้นสุดประกัน :'],['fiscalYear','ปีงบที่ได้มา'],
  ['fund','ประเภทเงิน'],['method','วิธีการได้มา'],
] as const
export const REGISTER_COLUMNS = [
  ['date','วันเดือนปี'],['document','ที่เอกสาร'],['description','รายการ'],['quantity','จำนวนหน่วย'],
  ['unitPrice','ราคาต่อหน่วย'],['total','มูลค่ารวม'],['life','อายุใช้งาน'],['monthly','อัตราค่าเสื่อมราคา/ประจำเดือน'],
  ['annual','ค่าเสื่อมราคาประจำปี'],['accumulated','ค่าเสื่อมราคาสะสม'],['net','มูลค่าสุทธิ'],['note','หมายเหตุ'],
] as const
export type RegisterField = typeof REGISTER_FIELDS[number][0]
export type RegisterColumn = typeof REGISTER_COLUMNS[number][0]
export const MONEY_COLUMNS: readonly RegisterColumn[] = ['unitPrice','total','monthly','annual','accumulated','net']
export const NUMERIC_COLUMNS: readonly RegisterColumn[] = ['quantity','life',...MONEY_COLUMNS]
export type RegisterRow = Record<RegisterColumn,string>
export type RegisterSummary = Record<'annual'|'accumulated'|'net',string>
export interface GovernmentRegister {
  fields: Record<RegisterField,string>
  rows: RegisterRow[]
  summary: RegisterSummary
}
export interface RegisterSnapshot {
  schemaVersion: 1
  revision: number
  form: GovernmentRegister
  sourceUpdatedAt: string
  updatedAt: string
  updatedBy: string
}
export function emptyRegisterRow(): RegisterRow {
  return Object.fromEntries(REGISTER_COLUMNS.map(([key])=>[key,''])) as RegisterRow
}
export class RegisterInputError extends Error {}
const decimal = /^\d{1,12}(?:\.\d{1,4})?$/
function record(v: unknown): Record<string,unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new RegisterInputError('รูปแบบเอกสารไม่ถูกต้อง')
  return v as Record<string,unknown>
}
function field(v: unknown, label: string, numeric=false): string {
  if (typeof v !== 'string' || v.length>500) throw new RegisterInputError(`${label}: ต้องเป็นข้อความไม่เกิน 500 ตัวอักษร`)
  const value=v.trim()
  if (numeric && value && !decimal.test(value)) throw new RegisterInputError(`${label}: ใช้ตัวเลขไม่ติดลบ ไม่มีเครื่องหมายคั่นหลักพัน`)
  return value
}
export function validateRegister(input: unknown): GovernmentRegister {
  const raw=record(input),fields=record(raw.fields),summary=record(raw.summary)
  if (!Array.isArray(raw.rows) || raw.rows.length<1 || raw.rows.length>12) throw new RegisterInputError('เอกสารต้องมีรายการ 1–12 แถว')
  return {
    fields:Object.fromEntries(REGISTER_FIELDS.map(([k,l])=>[k,field(fields[k]??'',l)])) as GovernmentRegister['fields'],
    rows:raw.rows.map(v=>{const row=record(v);return Object.fromEntries(REGISTER_COLUMNS.map(([k,l])=>[k,field(row[k]??'',l,NUMERIC_COLUMNS.includes(k))])) as RegisterRow}),
    summary:Object.fromEntries(['annual','accumulated','net'].map(k=>[k,field(summary[k]??'',k,true)])) as RegisterSummary,
  }
}
export function thaiDocumentDate(value: string | null | undefined): string {
  if (!value) return ''
  const match=value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return value
  const year=Number(match[1]);const month=Number(match[2]);const day=Number(match[3])
  if(month<1||month>12||day<1||day>31)return value
  return `${day} ${['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][month-1]} ${year<2400?year+543:year}`
}
export function fiscalYear(value: string | null | undefined,startMonth: number): string {
  if(!value)return ''
  const m=value.match(/^(\d{4})-(\d{2})-\d{2}/)
  if(!m)return ''
  const year=Number(m[1]),month=Number(m[2])
  if(month<1||month>12)return ''
  const buddhist=year<2400?year+543:year
  return String(buddhist+(startMonth>1&&month>=startMonth?1:0))
}
export function registerStorageKey(organizationId: string,deviceId: string): string {
  return `government-register:v1:${encodeURIComponent(organizationId)}:${encodeURIComponent(deviceId)}`
}
export function displayRegisterValue(key: RegisterColumn,value: string): string {
  return value && MONEY_COLUMNS.includes(key)?Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):value
}

export function isGovernmentRegisterKey(key:string):boolean { return key.startsWith('government-register:') }
