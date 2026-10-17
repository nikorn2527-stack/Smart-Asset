/**
 * public-subjects.ts — Static fallback of problem categories for the
 * public repair form.
 *
 * The staff mobile repair form fetches categories from
 * `/api/settings/options` (which requires `VIEW_DEVICES` auth). Public
 * users can't call that endpoint, so we ship a static default list —
 * identical to `DEFAULT_SUBJECTS` in
 * `src/app/api/settings/options/route.ts` — so the public form can show
 * a meaningful multi-select without any auth.
 *
 * Site admins can still customise their subject list via the staff UI
 * (`AppSetting.subjectOptions`); the public form just won't see those
 * edits — it always shows the canonical defaults below. This is a
 * trade-off favouring simplicity + no-auth over per-site customisation
 * (which would require a separate `/api/public/options` endpoint).
 */

import type { SubjectOption } from '@/components/itam/problem-category-selector'

export const PUBLIC_DEFAULT_SUBJECTS: SubjectOption[] = [
  // ── อาการทั่วไป ──
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
  // ── Printer ──
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
  // ── Network ──
  { group: 'Network', value: 'อินเทอร์เน็ตไม่ติด', default_priority: 'สูง' },
  { group: 'Network', value: 'เน็ตช้า / กระตุก', default_priority: 'ปานกลาง' },
  { group: 'Network', value: 'Wi-Fi ใช้งานไม่ได้', default_priority: 'ปานกลาง' },
  { group: 'Network', value: 'เชื่อมต่อ VPN ไม่ได้', default_priority: 'ปานกลาง' },
  { group: 'Network', value: 'เครือข่ายภายในไม่เข้าถึงได้', default_priority: 'สูง' },
  { group: 'Network', value: 'IP ชนกัน / ไม่ได้รับ IP', default_priority: 'ปานกลาง' },
  { group: 'Network', value: 'สาย LAN ชำรุด', default_priority: 'ปกติ' },
  // ── อื่นๆ ──
  { group: 'อื่นๆ', value: 'สอบถามการใช้งาน', default_priority: 'ปกติ' },
  { group: 'อื่นๆ', value: 'ขอติดตั้งอุปกรณ์ใหม่', default_priority: 'ปกติ' },
  { group: 'อื่นๆ', value: 'ขอย้ายเครื่อง/ที่ตั้ง', default_priority: 'ปกติ' },
  { group: 'อื่นๆ', value: 'ขอข้อมูล/คู่มือ', default_priority: 'ปกติ' },
  { group: 'อื่นๆ', value: 'อื่นๆ (ระบุในรายละเอียด)', default_priority: 'ปกติ' },
]

/**
 * Build the categories array expected by `<ProblemCategorySelector>` from
 * a list of `SubjectOption`s.
 *
 * Each subject becomes a category with `{ id, label, group }`.
 * IDs are synthesised as `${group}::${value}` so they're stable across
 * re-renders (categories are identified by `label` for the multi-select
 * state, but React needs a stable `key`).
 */
export function buildCategoriesFromSubjects(
  subjects: SubjectOption[],
): { id: string; label: string; group?: string }[] {
  return subjects.map((s) => ({
    id: `${s.group ?? 'อื่นๆ'}::${s.value}`,
    label: s.value,
    group: s.group,
  }))
}
