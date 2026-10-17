// ============================================================
// Shared types & helpers for the Visual Template Editor
// (Task ID: VISUAL-TEMPLATE-EDITOR)
// ============================================================
// These types are used by:
//   • src/components/itam/template-editor.tsx (the WYSIWYG canvas)
//   • src/app/api/templates/[id]/render/route.ts (server-side render)
//   • src/components/itam/template-print-dialog.tsx (print preview)
//
// All measurements in this module are stored in **millimetres (mm)**
// internally. The display layer converts to px at runtime using
// MM_TO_PX (≈ 3.7795 px per mm at 96 DPI).
// ============================================================

export const MM_TO_PX = 3.7795275591

/** Convert millimetres → pixels (rounded to 2 decimals). */
export function mmToPx(mm: number): number {
  return Math.round(mm * MM_TO_PX * 100) / 100
}

/** Convert pixels → millimetres (rounded to 2 decimals). */
export function pxToMm(px: number): number {
  return Math.round((px / MM_TO_PX) * 100) / 100
}

/** Snap a mm value to the nearest 1 mm grid (used for drag snap). */
export function snapMm(mm: number, grid = 1): number {
  return Math.round(mm / grid) * grid
}

// ───────────────────────────────────────────────
// Paper sizes
// ───────────────────────────────────────────────

export type PaperSizeKey = 'A4' | 'A4L' | 'A5' | 'Letter'

export interface PaperSpec {
  key: PaperSizeKey
  label: string
  width: number // mm
  height: number // mm
}

export const PAPER_SIZES: Record<PaperSizeKey, PaperSpec> = {
  A4: { key: 'A4', label: 'A4 (210 × 297 มม.)', width: 210, height: 297 },
  A4L: { key: 'A4L', label: 'A4 แนวนอน (297 × 210 มม.)', width: 297, height: 210 },
  A5: { key: 'A5', label: 'A5 (148 × 210 มม.)', width: 148, height: 210 },
  Letter: { key: 'Letter', label: 'Letter (216 × 279 มม.)', width: 216, height: 279 },
}

export const PAPER_SIZE_OPTIONS: PaperSpec[] = Object.values(PAPER_SIZES)

// ───────────────────────────────────────────────
// Element types
// ───────────────────────────────────────────────

export type ElementType =
  | 'text'
  | 'image'
  | 'qr'
  | 'table'
  | 'rectangle'
  | 'line'

export type FontAlign = 'left' | 'center' | 'right'
export type FontWeight = 'normal' | 'bold'
export type LineDirection = 'horizontal' | 'vertical'
export type TableDataSource =
  | 'work-order-items'
  | 'stock-transactions'
  | 'devices'
  | 'custom'

export interface TableColumn {
  id: string
  /** Header label (also editable inline). */
  label: string
  /** Width in mm. */
  width: number
  /** Variable key for this column when rendering, e.g. {productName}. */
  field?: string
}

export interface BaseElement {
  id: string
  type: ElementType
  /** Position from paper's top-left in mm. */
  x: number
  y: number
  /** Size in mm. */
  w: number
  h: number
  /** Optional rotation in degrees (future use). */
  rotation?: number
}

export interface TextElement extends BaseElement {
  type: 'text'
  content: string // supports {variable} placeholders
  fontSize: number // px
  fontWeight: FontWeight
  color: string // hex
  align: FontAlign
  lineHeight?: number // multiplier, default 1.3
  italic?: boolean
  underline?: boolean
}

export interface ImageElement extends BaseElement {
  type: 'image'
  src: string // URL or data:base64
  opacity: number // 0..1
  fit: 'contain' | 'cover' | 'fill'
}

export interface QrElement extends BaseElement {
  type: 'qr'
  content: string // supports {variable} placeholders
  fgColor: string
  bgColor: string
}

export interface TableElement extends BaseElement {
  type: 'table'
  columns: TableColumn[]
  dataSource: TableDataSource
  rowHeight: number // mm
  fontSize: number // px
  headerBg: string
  headerColor: string
  borderColor: string
  borderWidth: number // px
}

export interface RectangleElement extends BaseElement {
  type: 'rectangle'
  borderColor: string
  borderWidth: number // px
  bgColor: string // 'transparent' for none
  radius: number // px
}

export interface LineElement extends BaseElement {
  type: 'line'
  direction: LineDirection
  color: string
  thickness: number // px
}

export type TemplateElement =
  | TextElement
  | ImageElement
  | QrElement
  | TableElement
  | RectangleElement
  | LineElement

// ───────────────────────────────────────────────
// Template content (stored as JSON in DocumentTemplate.content)
// ───────────────────────────────────────────────

export interface TemplatePaper {
  size: PaperSizeKey
  orientation: 'portrait' | 'landscape'
  width: number
  height: number
  margin: number // mm
}

export interface TemplateContent {
  paper: TemplatePaper
  elements: TemplateElement[]
}

// ───────────────────────────────────────────────
// Variable catalog
// ───────────────────────────────────────────────

export interface VariableMeta {
  key: string
  label: string
  group: string
}

/** Catalog of variables supported inside text/qr/table contents. */
export const TEMPLATE_VARIABLES: VariableMeta[] = [
  // Work order
  { key: 'woNumber', label: 'เลขใบงาน', group: 'ใบงาน' },
  { key: 'subject', label: 'หัวข้อ', group: 'ใบงาน' },
  { key: 'reporterName', label: 'ผู้แจ้ง', group: 'ใบงาน' },
  { key: 'building', label: 'อาคาร/ฝ่าย', group: 'ใบงาน' },
  { key: 'location', label: 'สถานที่', group: 'ใบงาน' },
  { key: 'priority', label: 'ความเร่งด่วน', group: 'ใบงาน' },
  { key: 'status', label: 'สถานะ', group: 'ใบงาน' },
  { key: 'assignedTo', label: 'ช่างผู้รับผิดชอบ', group: 'ใบงาน' },
  { key: 'resolution', label: 'ผลการแก้ไข', group: 'ใบงาน' },
  { key: 'details', label: 'รายละเอียด', group: 'ใบงาน' },
  { key: 'tel', label: 'เบอร์โทร', group: 'ใบงาน' },
  { key: 'date', label: 'วันที่', group: 'ใบงาน' },
  // Device
  { key: 'assetCode', label: 'รหัสทรัพย์สิน', group: 'อุปกรณ์' },
  { key: 'brand', label: 'ยี่ห้อ', group: 'อุปกรณ์' },
  { key: 'model', label: 'รุ่น', group: 'อุปกรณ์' },
  { key: 'serial', label: 'S/N', group: 'อุปกรณ์' },
  { key: 'productName', label: 'ชื่อสินค้า', group: 'อุปกรณ์' },
  // ── CONSULTING-007: Device field group 1 — "ต้องมีเร็วสุด" (priority) ──
  // Keys use `device` prefix where they'd otherwise collide with work-order
  // fields (e.g. `status` is the WO status; `deviceStatus` is the device
  // status). Interpolation is case-sensitive + key-exact, so this avoids
  // ambiguity in templates that mix WO + device context.
  { key: 'deviceStatus', label: 'สถานะอุปกรณ์', group: 'อุปกรณ์' },
  { key: 'deviceType', label: 'ประเภทอุปกรณ์', group: 'อุปกรณ์' },
  { key: 'currentAssignee', label: 'ผู้ใช้งานปัจจุบัน', group: 'อุปกรณ์' },
  { key: 'warrantyEnd', label: 'วันหมดประกัน', group: 'อุปกรณ์' },
  // ── CONSULTING-007: Device field group 2 — "เอกสารครุภัณฑ์" ──
  { key: 'purchaseDate', label: 'วันที่ซื้อ', group: 'อุปกรณ์' },
  { key: 'purchasePrice', label: 'ราคาทุน', group: 'อุปกรณ์' },
  { key: 'vendor', label: 'ผู้จำหน่าย', group: 'อุปกรณ์' },
  { key: 'contractNo', label: 'เลขที่สัญญา', group: 'อุปกรณ์' },
  // ── CONSULTING-007: Device field group 3 — "IT asset label" ──
  { key: 'ip', label: 'IP Address', group: 'อุปกรณ์' },
  { key: 'mac', label: 'MAC Address', group: 'อุปกรณ์' },
  { key: 'floor', label: 'ชั้น', group: 'อุปกรณ์' },
  { key: 'room', label: 'ห้อง', group: 'อุปกรณ์' },
  // Stock
  { key: 'quantity', label: 'จำนวน', group: 'สต็อก' },
  { key: 'unit', label: 'หน่วย', group: 'สต็อก' },
  { key: 'totalPrice', label: 'ราคารวม', group: 'สต็อก' },
  // Org / misc
  { key: 'orgName', label: 'ชื่อหน่วยงาน', group: 'องค์กร' },
  { key: 'printDate', label: 'วันที่พิมพ์', group: 'องค์กร' },
]

// ───────────────────────────────────────────────
// Sample data (used by the Preview button)
// ───────────────────────────────────────────────

export interface TemplateRenderData {
  woNumber?: string
  subject?: string
  reporterName?: string
  building?: string
  location?: string
  priority?: string
  status?: string
  assignedTo?: string
  resolution?: string
  details?: string
  tel?: string
  date?: string
  assetCode?: string
  brand?: string
  model?: string
  serial?: string
  productName?: string
  // ── CONSULTING-007: Device fields (12 new) ─────────────────────────
  // All optional — populated by /api/templates/[id]/render when a
  // workOrderId is supplied and the WO has a linked device. For the
  // preview-only path (no WO), SAMPLE_DATA below provides placeholder
  // values so the editor preview shows realistic content.
  deviceStatus?: string
  deviceType?: string
  currentAssignee?: string
  warrantyEnd?: string // formatted Thai date string
  purchaseDate?: string // formatted Thai date string
  purchasePrice?: string // formatted "฿1,234.56" string
  vendor?: string
  contractNo?: string
  ip?: string
  mac?: string
  floor?: string
  room?: string
  // ── End CONSULTING-007 device fields ──────────────────────────────
  quantity?: string
  unit?: string
  totalPrice?: string
  orgName?: string
  printDate?: string
  // Tables
  workOrderItems?: Array<Record<string, string>>
  stockTransactions?: Array<Record<string, string>>
  devices?: Array<Record<string, string>>
  custom?: Array<Record<string, string>>
}

export const SAMPLE_DATA: TemplateRenderData = {
  woNumber: 'WO-20260812-001',
  subject: 'เครื่องปริ้นไม่ตอบสนอง',
  reporterName: 'คุณสมหญิง ใจดี',
  building: 'อาคาร 3',
  location: 'ชั้น 4 ห้อง 401',
  priority: 'ปานกลาง',
  status: 'กำลังซ่อม',
  assignedTo: 'คุณวิชัย ช่างเทคนิค',
  resolution: 'เปลี่ยนอะไหล่สายเคเบิล',
  details: 'เครื่องปริ้นเปิดไม่ติด มีไฟเข้าแต่ไม่ตอบสนอง',
  tel: '081-234-5678',
  date: '12/08/2026',
  assetCode: 'IT-PRN-00231',
  brand: 'HP',
  model: 'LaserJet Pro M404',
  serial: 'VNB2345678',
  productName: 'เครื่องปริ้นเลเซอร์ HP',
  // ── CONSULTING-007: 12 device fields (sample values for preview) ──
  deviceStatus: 'Active',
  deviceType: 'PRINTER',
  currentAssignee: 'คุณสมชาย บัญชีการ',
  warrantyEnd: new Date('2027-08-12').toLocaleDateString('th-TH'),
  purchaseDate: new Date('2024-08-12').toLocaleDateString('th-TH'),
  purchasePrice: '฿15,500.00',
  vendor: 'บริษัท คอมเทค จำกัด',
  contractNo: 'CT-2024-00827',
  ip: '192.168.1.231',
  mac: 'A4:5E:60:8C:23:17',
  floor: '4',
  room: '401',
  // ── End CONSULTING-007 device fields ──
  quantity: '1',
  unit: 'เครื่อง',
  totalPrice: '5,500.00',
  orgName: 'ระบบจัดการสินทรัพย์',
  printDate: new Date().toLocaleString('th-TH'),
  workOrderItems: [
    {
      no: '1',
      productName: 'สาย USB Type-B',
      quantity: '1',
      unit: 'เส้น',
      price: '120.00',
    },
    {
      no: '2',
      productName: 'Fuse 5A',
      quantity: '2',
      unit: 'ชิ้น',
      price: '40.00',
    },
  ],
  stockTransactions: [
    {
      txnNumber: 'STX-20260812-003',
      productName: 'สาย USB Type-B',
      quantity: '1',
      unit: 'เส้น',
      type: 'OUT',
    },
  ],
  devices: [
    {
      assetCode: 'IT-PRN-00231',
      brand: 'HP',
      model: 'LaserJet Pro M404',
      serial: 'VNB2345678',
    },
  ],
  custom: [
    { no: '1', name: 'ตัวอย่าง 1', qty: '1' },
    { no: '2', name: 'ตัวอย่าง 2', qty: '2' },
  ],
}

// ───────────────────────────────────────────────
// Default factory helpers
// ───────────────────────────────────────────────

let _idCounter = 0
function makeId(prefix = 'el'): string {
  _idCounter += 1
  // Use a deterministic prefix + timestamp + counter to avoid clashes
  // across re-renders inside React StrictMode.
  return `${prefix}-${Date.now().toString(36)}-${_idCounter}`
}

export function newElementId(): string {
  return makeId('el')
}

export function makeDefaultContent(
  paperKey: PaperSizeKey = 'A4',
  type = 'work-order',
): TemplateContent {
  const paper = PAPER_SIZES[paperKey]
  const basePaper: TemplatePaper = {
    size: paper.key,
    orientation: paper.width > paper.height ? 'landscape' : 'portrait',
    width: paper.width,
    height: paper.height,
    margin: 10,
  }

  // Default layouts differ by template type
  if (type === 'sticker') {
    const stickerPaper: PaperSpec = { key: 'A4', label: '', width: 100, height: 50 }
    return {
      paper: {
        size: 'A4',
        orientation: 'portrait',
        width: stickerPaper.width,
        height: stickerPaper.height,
        margin: 4,
      },
      elements: [
        {
          id: newElementId(),
          type: 'text',
          x: 5,
          y: 5,
          w: 90,
          h: 8,
          content: '{assetCode}',
          fontSize: 14,
          fontWeight: 'bold',
          color: '#000000',
          align: 'center',
        },
        {
          id: newElementId(),
          type: 'qr',
          x: 35,
          y: 14,
          w: 30,
          h: 30,
          content: '{assetCode}',
          fgColor: '#000000',
          bgColor: '#ffffff',
        },
      ],
    }
  }

  // work-order / pdf / stock-* / purchase-order: A4 layout with header + table
  return {
    paper: basePaper,
    elements: [
      // Header title
      {
        id: newElementId(),
        type: 'text',
        x: 20,
        y: 12,
        w: 170,
        h: 12,
        content: type === 'work-order' ? 'ใบแจ้งซ่อม {woNumber}' : 'เอกสาร',
        fontSize: 20,
        fontWeight: 'bold',
        color: '#0f172a',
        align: 'center',
      },
      // QR top-right
      {
        id: newElementId(),
        type: 'qr',
        x: 175,
        y: 5,
        w: 30,
        h: 30,
        content: '{woNumber}',
        fgColor: '#000000',
        bgColor: '#ffffff',
      },
      // Reporter info (left column)
      {
        id: newElementId(),
        type: 'text',
        x: 15,
        y: 35,
        w: 90,
        h: 6,
        content: 'ผู้แจ้ง: {reporterName}',
        fontSize: 12,
        fontWeight: 'normal',
        color: '#1e293b',
        align: 'left',
      },
      {
        id: newElementId(),
        type: 'text',
        x: 15,
        y: 42,
        w: 90,
        h: 6,
        content: 'เบอร์โทร: {tel}',
        fontSize: 12,
        fontWeight: 'normal',
        color: '#1e293b',
        align: 'left',
      },
      {
        id: newElementId(),
        type: 'text',
        x: 15,
        y: 49,
        w: 90,
        h: 6,
        content: 'สถานที่: {building} {location}',
        fontSize: 12,
        fontWeight: 'normal',
        color: '#1e293b',
        align: 'left',
      },
      // Subject info (right column)
      {
        id: newElementId(),
        type: 'text',
        x: 110,
        y: 35,
        w: 60,
        h: 6,
        content: 'เลขใบงาน: {woNumber}',
        fontSize: 12,
        fontWeight: 'normal',
        color: '#1e293b',
        align: 'left',
      },
      {
        id: newElementId(),
        type: 'text',
        x: 110,
        y: 42,
        w: 60,
        h: 6,
        content: 'วันที่: {date}',
        fontSize: 12,
        fontWeight: 'normal',
        color: '#1e293b',
        align: 'left',
      },
      {
        id: newElementId(),
        type: 'text',
        x: 110,
        y: 49,
        w: 60,
        h: 6,
        content: 'สถานะ: {status}',
        fontSize: 12,
        fontWeight: 'normal',
        color: '#1e293b',
        align: 'left',
      },
      // Separator line
      {
        id: newElementId(),
        type: 'line',
        x: 15,
        y: 60,
        w: 180,
        h: 0.5,
        direction: 'horizontal',
        color: '#cbd5e1',
        thickness: 1,
      },
      // Subject heading
      {
        id: newElementId(),
        type: 'text',
        x: 15,
        y: 65,
        w: 180,
        h: 6,
        content: 'หัวข้อ: {subject}',
        fontSize: 13,
        fontWeight: 'bold',
        color: '#0f172a',
        align: 'left',
      },
      // Details
      {
        id: newElementId(),
        type: 'text',
        x: 15,
        y: 75,
        w: 180,
        h: 20,
        content: '{details}',
        fontSize: 11,
        fontWeight: 'normal',
        color: '#334155',
        align: 'left',
        lineHeight: 1.4,
      },
      // Items table
      {
        id: newElementId(),
        type: 'table',
        x: 15,
        y: 110,
        w: 180,
        h: 60,
        columns: [
          { id: 'c1', label: 'ลำดับ', width: 20, field: 'no' },
          { id: 'c2', label: 'รายการ', width: 90, field: 'productName' },
          { id: 'c3', label: 'จำนวน', width: 30, field: 'quantity' },
          { id: 'c4', label: 'หน่วย', width: 25, field: 'unit' },
          { id: 'c5', label: 'ราคา', width: 35, field: 'price' },
        ],
        dataSource: 'work-order-items',
        rowHeight: 7,
        fontSize: 11,
        headerBg: '#f1f5f9',
        headerColor: '#475569',
        borderColor: '#e2e8f0',
        borderWidth: 1,
      },
      // Footer
      {
        id: newElementId(),
        type: 'text',
        x: 15,
        y: 280,
        w: 180,
        h: 6,
        content: 'พิมพ์เมื่อ {printDate} | {orgName}',
        fontSize: 9,
        fontWeight: 'normal',
        color: '#94a3b8',
        align: 'center',
      },
    ],
  }
}

/** Make a brand-new empty element of the given type. */
export function makeElement(
  type: ElementType,
  paper: TemplatePaper,
): TemplateElement {
  const id = newElementId()
  // Default position near the top-left of the safe area
  const x = paper.margin
  const y = paper.margin

  switch (type) {
    case 'text':
      return {
        id,
        type: 'text',
        x,
        y,
        w: 80,
        h: 8,
        content: 'ข้อความใหม่',
        fontSize: 14,
        fontWeight: 'normal',
        color: '#000000',
        align: 'left',
        lineHeight: 1.3,
      }
    case 'image':
      return {
        id,
        type: 'image',
        x,
        y,
        w: 50,
        h: 50,
        src: '',
        opacity: 1,
        fit: 'contain',
      }
    case 'qr':
      return {
        id,
        type: 'qr',
        x,
        y,
        w: 30,
        h: 30,
        content: '{woNumber}',
        fgColor: '#000000',
        bgColor: '#ffffff',
      }
    case 'table':
      return {
        id,
        type: 'table',
        x,
        y,
        w: 160,
        h: 40,
        columns: [
          { id: 'c1', label: 'ลำดับ', width: 20, field: 'no' },
          { id: 'c2', label: 'รายการ', width: 80, field: 'productName' },
          { id: 'c3', label: 'จำนวน', width: 30, field: 'quantity' },
          { id: 'c4', label: 'หน่วย', width: 30, field: 'unit' },
        ],
        dataSource: 'work-order-items',
        rowHeight: 7,
        fontSize: 11,
        headerBg: '#f1f5f9',
        headerColor: '#475569',
        borderColor: '#e2e8f0',
        borderWidth: 1,
      }
    case 'rectangle':
      return {
        id,
        type: 'rectangle',
        x,
        y,
        w: 60,
        h: 30,
        borderColor: '#0f172a',
        borderWidth: 1,
        bgColor: 'transparent',
        radius: 0,
      }
    case 'line':
      return {
        id,
        type: 'line',
        x,
        y,
        w: 80,
        h: 0.5,
        direction: 'horizontal',
        color: '#0f172a',
        thickness: 1,
      }
    default: {
      // exhaustive guard
      const _t: never = type
      throw new Error(`Unknown element type: ${String(_t)}`)
    }
  }
}

// ───────────────────────────────────────────────
// Variable interpolation
// ───────────────────────────────────────────────

/** Replace {variable} placeholders with data values. */
export function interpolate(
  template: string,
  data: TemplateRenderData,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (key in data) {
      const v = (data as Record<string, unknown>)[key]
      if (v === undefined || v === null) return ''
      return String(v)
    }
    // leave unknown variables as-is (useful for editing)
    return match
  })
}

// ───────────────────────────────────────────────
// Serialization helpers
// ───────────────────────────────────────────────

/** Parse a template content string. Falls back to a default if invalid. */
export function parseContent(raw: string | null | undefined): TemplateContent {
  if (!raw) return makeDefaultContent('A4', 'work-order')
  try {
    const parsed = JSON.parse(raw) as Partial<TemplateContent>
    if (!parsed.paper || !Array.isArray(parsed.elements)) {
      return makeDefaultContent('A4', 'work-order')
    }
    // Ensure paper has all required fields
    const paperKey = (parsed.paper.size as PaperSizeKey) || 'A4'
    const spec = PAPER_SIZES[paperKey] ?? PAPER_SIZES.A4
    return {
      paper: {
        size: spec.key,
        orientation: parsed.paper.orientation ?? 'portrait',
        width: parsed.paper.width ?? spec.width,
        height: parsed.paper.height ?? spec.height,
        margin: parsed.paper.margin ?? 10,
      },
      elements: parsed.elements as TemplateElement[],
    }
  } catch {
    return makeDefaultContent('A4', 'work-order')
  }
}

export function serializeContent(content: TemplateContent): string {
  return JSON.stringify(content)
}
