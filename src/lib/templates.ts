// Shared template constants used by both the API routes and the UI.
// (ข้อ 5: เทมเพลตเอกสารแยกประเภทงาน)

export const TEMPLATE_TYPES = [
  'sticker',
  'pdf',
  'work-order',
  'stock-out',
  'stock-in',
  'purchase-order',
] as const

export type TemplateType = (typeof TEMPLATE_TYPES)[number]

export interface DefaultTemplateDef {
  name: string
  content: string
}

/** Default templates seeded when a type has zero templates. */
export const DEFAULT_TEMPLATES: Record<TemplateType, DefaultTemplateDef> = {
  sticker: {
    name: 'สติกเกอร์มาตรฐาน',
    content:
      '{"width":100,"height":50,"elements":[{"type":"text","content":"{assetCode}","x":5,"y":5,"fontSize":8}]}',
  },
  pdf: {
    name: 'รายงานมาตรฐาน',
    content: '{"format":"A4","orientation":"landscape"}',
  },
  'work-order': {
    name: 'ใบแจ้งซ่อมมาตรฐาน',
    content: '{"sections":["header","details","images","timeline"]}',
  },
  'stock-out': {
    name: 'ใบเบิกมาตรฐาน',
    content: '{"sections":["header","items","total","signatures"]}',
  },
  'stock-in': {
    name: 'ใบรับมาตรฐาน',
    content: '{"sections":["header","items","total","receiver"]}',
  },
  'purchase-order': {
    name: 'ใบสั่งซื้อมาตรฐาน',
    content: '{"sections":["header","supplier","items","total","approver"]}',
  },
}

/** UI metadata for each template type (icon + Thai label + description). */
export interface TemplateTypeMeta {
  value: TemplateType
  icon: string
  label: string
  description: string
}

export const TEMPLATE_TYPE_META: TemplateTypeMeta[] = [
  {
    value: 'sticker',
    icon: '🎨',
    label: 'สติกเกอร์',
    description: 'สติกเกอร์ฉลากอุปกรณ์',
  },
  {
    value: 'pdf',
    icon: '📑',
    label: 'PDF',
    description: 'เอกสาร PDF (รายงาน)',
  },
  {
    value: 'work-order',
    icon: '🔧',
    label: 'ใบแจ้งซ่อม',
    description: 'ใบงานแจ้งซ่อม',
  },
  {
    value: 'stock-out',
    icon: '📤',
    label: 'ใบเบิกออก',
    description: 'ใบเบิกสินค้า',
  },
  {
    value: 'stock-in',
    icon: '📥',
    label: 'ใบรับเข้า',
    description: 'ใบรับสินค้า',
  },
  {
    value: 'purchase-order',
    icon: '🛒',
    label: 'ใบสั่งซื้อ',
    description: 'ใบสั่งซื้อ',
  },
]

/** Validate that a string is one of the supported template types. */
export function isTemplateType(v: unknown): v is TemplateType {
  return (
    typeof v === 'string' &&
    (TEMPLATE_TYPES as readonly string[]).includes(v)
  )
}

/** Get the Thai label for a template type (falls back to the raw value). */
export function templateTypeLabel(type: string): string {
  return (
    TEMPLATE_TYPE_META.find((m) => m.value === type)?.label ?? type
  )
}
