/**
 * glossary.ts — สารบัญคำศัพท์มาตรฐานสำหรับ ITAM
 *
 * หลักการ:
 *   - แอปเป็นสากล (generic) — ไม่อ้างอิงองค์กร/หน่วยงานเฉพาะ
 *   - ไม่ใช้คำว่า "โรงพยาบาล", "โรงงาน", "โรงเรียน" ฯลฯ เป็น default
 *   - ใช้คำกลาง: "องค์กร", "หน่วยงาน", "สาขา"
 *   - ผู้ใช้สามารถตั้งชื่อองค์กรของตัวเองได้ผ่าน OrgProfile
 *
 * วิธีใช้:
 *   import { GLOSSARY, getTerm } from '@/lib/glossary'
 *
 *   // ใน UI:
 *   <label>{GLOSSARY.ORG_NAME}</label>  // → "ชื่อองค์กร"
 *   <label>{GLOSSARY.SITE}</label>      // → "สาขา"
 *
 *   // ในกรณีต้องการ dynamic (ตาม industryType):
 *   getTerm('orgUnit', 'hospital')  // → "แผนก" (hospital)
 *   getTerm('orgUnit', 'factory')   // → "แผนก" (factory)
 *   getTerm('orgUnit', 'general')   // → "แผนก"
 *
 *   // Status labels:
 *   GLOSSARY.STATUS.active   // → "ใช้งาน"
 *   GLOSSARY.STATUS.inactive // → "ไม่ใช้งาน"
 */

/**
 * คำศัพท์หลักของระบบ — ใช้แทน hardcoded strings
 * ปรับที่นี่ที่เดียว → เปลี่ยนทั้งระบบ
 */
export const GLOSSARY = {
  // ── องค์กร (generic — ไม่อ้างอิงประเภทองค์กร) ──
  ORG_NAME: 'ชื่อองค์กร',           // แทน "ชื่อโรงพยาบาล"
  ORG_SHORT: 'องค์กร',              // แทน "โรงพยาบาล"/"บริษัท"
  ORG_UNIT: 'หน่วยงาน',             // แทน "แผนก"/"ฝ่าย" (generic)
  ORG_DEPARTMENT: 'แผนก',           // หน่วยย่อยของหน่วยงาน
  ORG_FULL: 'องค์กร',               // ชื่อเต็ม generic

  // ── สาขา/ที่ตั้ง ──
  SITE: 'สาขา',                    // แทน "โรงพยาบาล"/"โรงงาน" ในบริบทที่ตั้ง
  SITE_CODE: 'รหัสสาขา',
  SITE_NAME: 'ชื่อสาขา',

  // ── อุปกรณ์ ──
  DEVICE: 'อุปกรณ์',               // แทน "ครุภัณฑ์" (คำวิชาการ)
  ASSET: 'ทรัพย์สิน',               // ในบริบทการเงิน
  ASSET_CODE: 'รหัสอุปกรณ์',        // แทน "เลขครุภัณฑ์"
  DEVICE_TYPE: 'ประเภทอุปกรณ์',
  DEVICE_STATUS: 'สถานะอุปกรณ์',

  // ── สถานะ (status labels — generic) ──
  STATUS: {
    active: 'ใช้งาน',               // แทน "Active"
    inactive: 'ไม่ใช้งาน',           // แทน "Inactive"
    spare: 'สำรอง',                 // แทน "Spare"
    repair: 'ส่งซ่อม',               // แทน "Repair"
    disposed: 'ตัดจำหน่าย',         // แทน "Disposed"
    pending: 'รอดำเนินการ',          // แทน "Pending"
    in_progress: 'กำลังดำเนินการ',  // แทน "In Progress"
    completed: 'เสร็จสิ้น',         // แทน "Completed"
    cancelled: 'ยกเลิก',            // แทน "Cancelled"
    waiting_parts: 'รออะไหล่',       // แทน "Waiting Parts"
  },

  // ── ผู้ใช้ ──
  USER: 'ผู้ใช้',
  ROLE: 'บทบาท',
  ADMIN: 'ผู้ดูแลระบบ',
  STAFF: 'เจ้าหน้าที่',
  VIEWER: 'ผู้ดูแล',

  // ── มิเตอร์/การใช้งาน ──
  METER_READING: 'การจดมิเตอร์',
  METER_BW: 'มิเตอร์ขาวดำ',
  METER_COLOR: 'มิเตอร์สี',
  PAGES_BW: 'จำนวนแผ่น (ขาวดำ)',
  PAGES_COLOR: 'จำนวนแผ่น (สี)',

  // ── ใบงาน ──
  WORK_ORDER: 'ใบงาน',
  WO_NUMBER: 'เลขที่ใบงาน',
  WO_SUBJECT: 'หัวข้อ',
  WO_REPORTER: 'ผู้แจ้ง',
  WO_TECHNICIAN: 'ผู้ดำเนินการ',
  WO_PRIORITY: 'ความสำคัญ',

  // ── สต็อก ──
  STOCK: 'คลังสต็อก',
  STOCK_ITEM: 'รายการสต็อก',
  STOCK_IN: 'รับเข้า',
  STOCK_OUT: 'เบิกออก',
  STOCK_LOW: 'ใกล้หมด',

  // ── การตั้งค่า ──
  SETTINGS: 'ตั้งค่าระบบ',
  STICKER: 'สติกเกอร์',
  TEMPLATE: 'เทมเพลต',
  EXPORT: 'ส่งออก',
  IMPORT: 'นำเข้า',
} as const

/**
 * ประเภทสถานะที่รองรับ
 */
export type DeviceStatus = keyof typeof GLOSSARY.STATUS

/**
 * แปลง status code เป็น label ภาษาไทย
 *
 * @example
 *   statusLabel('active')    // → 'ใช้งาน'
 *   statusLabel('inactive')  // → 'ไม่ใช้งาน'
 *   statusLabel('unknown')   // → 'unknown' (fallback)
 */
export function statusLabel(status: string): string {
  return GLOSSARY.STATUS[status as DeviceStatus] ?? status
}

/**
 * Industry-specific terms (optional override).
 *
 * ถ้าผู้ใช้ตั้ง industryType ใน OrgProfile จะใช้คำเฉพาะของอุตสาหกรรมนั้น
 * ถ้าไม่ตั้ง → ใช้คำกลาง (general)
 *
 * ตอนนี้ทุกอุตสาหกรรมใช้คำกลางเหมือนกัน (สากล)
 * แต่เก็บไว้เผื่อต้องการปรับในอนาคต
 */
export const INDUSTRY_TERMS: Record<string, Record<string, string>> = {
  general: {
    orgUnit: 'หน่วยงาน',
    orgMember: 'เจ้าหน้าที่',
    site: 'สาขา',
  },
  hospital: {
    orgUnit: 'หน่วยงาน',  // เปลี่ยนจาก "แผนก" เป็น "หน่วยงาน" (สากล)
    orgMember: 'เจ้าหน้าที่',
    site: 'สาขา',
  },
  factory: {
    orgUnit: 'หน่วยงาน',  // เปลี่ยนจาก "แผนก" เป็น "หน่วยงาน" (สากล)
    orgMember: 'พนักงาน',
    site: 'สาขา',
  },
  office: {
    orgUnit: 'หน่วยงาน',
    orgMember: 'พนักงาน',
    site: 'สาขา',
  },
  school: {
    orgUnit: 'หน่วยงาน',  // เปลี่ยนจาก "แผนก" เป็น "หน่วยงาน"
    orgMember: 'บุคลากร',
    site: 'สาขา',
  },
  government: {
    orgUnit: 'หน่วยงาน',
    orgMember: 'เจ้าหน้าที่',
    site: 'สาขา',
  },
}

/**
 * ดึงคำศัพท์ตาม industryType (ถ้าไม่ระบุ → ใช้ general)
 *
 * @example
 *   getTerm('orgUnit', 'hospital')  // → 'หน่วยงาน'
 *   getTerm('orgUnit')              // → 'หน่วยงาน' (general default)
 *   getTerm('site', 'factory')      // → 'สาขา'
 */
export function getTerm(
  key: 'orgUnit' | 'orgMember' | 'site',
  industryType?: string,
): string {
  const industry = industryType ?? 'general'
  return INDUSTRY_TERMS[industry]?.[key] ?? INDUSTRY_TERMS.general[key]
}

/**
 * Industry type labels (สำหรับ dropdown).
 * เปลี่ยนจาก "โรงพยาบาล"/"โรงงาน" เป็นคำกลาง.
 */
export const INDUSTRY_LABELS: Record<string, string> = {
  general: 'ทั่วไป',
  office: 'สำนักงาน',          // แทน "โรงพยาบาล" ใน default
  corporate: 'องค์กร',         // แทน "โรงงาน" ใน default
  education: 'สถาบันการศึกษา', // แทน "สถาบันการศึกษา"
  government: 'หน่วยงานรัฐ',
  healthcare: 'สถานพยาบาล',   // generic แทน "โรงพยาบาล"
  industrial: 'อุตสาหกรรม',    // generic แทน "โรงงาน"
}

/**
 * Sticker default settings — generic (ไม่อ้างอิงองค์กรเฉพาะ)
 */
export const DEFAULT_STICKER_TEXTS = {
  orgName: 'ชื่อองค์กร',                    // แทน "โรงพยาบาลศูนย์อุดรธานี"
  footerNote: 'ห้ามนำอุปกรณ์ออกจากพื้นที่ — กรุณาติดต่อ IT หากพบปัญหา', // generic
  hotline: '000-000-0000',
  lineOALink: '@your-org',
} as const

/**
 * Asset number pattern names — generic (ไม่อ้างอิงอุตสาหกรรม)
 */
export const PATTERN_NAMES = {
  simple: 'แบบง่าย (5 หลัก)',           // แทน "แบบง่าย"
  detailed: 'แบบแยกหน่วยงาน (4-3-3-2)',  // แทน "แบบโรงพยาบาล"
  yearMonth: 'แบบปี-เดือน (4 หลัก)',
  custom: 'แบบกำหนดเอง',
} as const

/**
 * คำอธิบายรูปแบบ — generic
 */
export const PATTERN_DESCRIPTIONS = {
  simple: 'เหมาะสำหรับองค์กรขนาดเล็ก',           // แทน "โรงงาน/บริษัทเล็ก"
  detailed: 'แยกหน่วยงาน-ประเภท-ลำดับ-ปี',         // generic
  yearMonth: 'เริ่มใหม่ทุกเดือน',
  custom: 'กำหนดรูปแบบเอง',
} as const
