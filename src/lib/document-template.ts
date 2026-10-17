/**
 * document-template.ts — pure helpers for the Document/PDF Template System.
 *
 * Mirror of Apps Script DOC_TABLE_AVAILABLE_COLUMNS + renderPDFFromTemplate().
 *
 * This module is server-safe (no Node-only deps). Pure types + constants +
 * the HTML renderer live here so the client editor component can import them
 * without bundling server-only code.
 */

// ─── Types ────────────────────────────────────────────────────────────────

/**
 * Element kinds supported inside a template canvas.
 *
 * `qr` is rendered by the sticker editor (`addElement('qr')`, the QR preview
 * panel, and the canvas renderer's `el.type === 'qr'` branch) and can be
 * persisted in a saved `DocumentTemplate.elements` JSON payload. It was
 * missing here, so every `el.type === 'qr'` comparison narrowed the element
 * to `never` and the surrounding code failed to typecheck.
 */
export type DocumentElementType = 'text' | 'image' | 'rect' | 'qr'

export interface DocumentCanvas {
  /** Page width in mm (e.g. 210 portrait, 297 landscape) */
  width: number
  /** Page height in mm (e.g. 297 portrait, 210 landscape) */
  height: number
  /** Orientation — informational only; width/height are the source of truth */
  orientation: 'portrait' | 'landscape'
  /** Page margin in mm */
  margin: number
  /** Paper size label, used by the editor's paper picker */
  paper: 'A4' | 'A3' | 'Letter' | 'Legal' | 'Custom'
}

export interface DocumentElement {
  id: string
  type: DocumentElementType
  /** X position in mm (top-left origin) */
  x: number
  /** Y position in mm (top-left origin) */
  y: number
  /** Width in mm */
  width: number
  /** Height in mm */
  height: number
  /** Opacity 0–1 */
  opacity?: number
  /** Stacking order (higher = front) */
  zIndex?: number
  // Text-only props
  fontSize?: number   // pt
  fontWeight?: number // 100..900
  color?: string      // hex / css color
  align?: 'left' | 'center' | 'right'
  /** For text: content with {{variables}}. For image: src url. */
  content?: string
  // Rect-only props
  background?: string
  border?: string
  borderRadius?: number
}

export interface DocumentTableColumn {
  /** Key matching a value in AVAILABLE_TABLE_COLUMNS */
  key: string
  /** Thai label shown in the table header */
  label: string
  /** Column width in mm (sums to ~canvas.width − 2*margin) */
  width: number
  /** Right-align numeric columns */
  numeric?: boolean
}

export interface DocumentTable {
  /** Y position of the table top (mm) */
  y: number
  /** Row height in mm */
  rowHeight: number
  /** Font size in pt */
  fontSize: number
  /** Header background colour (hex) */
  headerColor: string
  /** Header text colour (hex) */
  headerTextColor: string
  /** Columns shown in the table (ordered left → right) */
  columns: DocumentTableColumn[]
}

export interface DocumentSummaryItem {
  /** Label e.g. "รวมมูลค่าสินค้า" */
  label: string
  /** Variable key (without braces) — e.g. totalCost, totalDiscount, totalVat, totalNet */
  valueKey: string
  /** Left | Right alignment */
  align: 'left' | 'right'
}

export interface DocumentFooter {
  /** Footer height in mm */
  height: number
  /** Footer content with {{variables}} (e.g. {{pageNumber}}/{{totalPages}}) */
  content: string
  /** Font size in pt */
  fontSize?: number
  /** Colour */
  color?: string
  /** Signature lines: list of signature labels (left/center/right) */
  signatures?: string[]
}

export interface DocumentTemplate {
  id: string
  name: string
  isDefault: boolean
  canvas: DocumentCanvas
  /** Header elements (title, subtitle, logo) — positioned absolutely on the page */
  elements: DocumentElement[]
  /** Table definition (positioned at table.y) */
  table: DocumentTable
  /** Summary block (printed below the last page of the table) */
  summary: DocumentSummaryItem[]
  /** Footer (printed on every page) */
  footer: DocumentFooter
}

// ─── 21 available table columns (mirror of DOC_TABLE_AVAILABLE_COLUMNS) ────
export interface AvailableColumn {
  key: string
  label: string
  /** Default width in mm */
  defaultWidth: number
  /** Right-align numeric columns */
  numeric?: boolean
}

export const AVAILABLE_TABLE_COLUMNS: AvailableColumn[] = [
  { key: 'no', label: 'ลำดับ', defaultWidth: 8, numeric: true },
  { key: 'brand', label: 'ยี่ห้อ', defaultWidth: 18 },
  { key: 'model', label: 'รุ่น', defaultWidth: 22 },
  { key: 'serial', label: 'Serial', defaultWidth: 22 },
  { key: 'buildingFloor', label: 'อาคาร/ชั้น', defaultWidth: 18 },
  { key: 'building', label: 'อาคาร', defaultWidth: 14 },
  { key: 'floor', label: 'ชั้น', defaultWidth: 8 },
  { key: 'department', label: 'แผนก', defaultWidth: 18 },
  { key: 'location', label: 'ที่ตั้ง', defaultWidth: 18 },
  { key: 'site', label: 'สาขา', defaultWidth: 18 },
  { key: 'status', label: 'สถานะ', defaultWidth: 12 },
  { key: 'vendor', label: 'ผู้ขาย', defaultWidth: 18 },
  { key: 'startMeter', label: 'มิเตอร์เริ่ม', defaultWidth: 14, numeric: true },
  { key: 'endMeter', label: 'มิเตอร์สิ้นสุด', defaultWidth: 14, numeric: true },
  { key: 'pagesCurrent', label: 'แผ่นเดือนนี้', defaultWidth: 14, numeric: true },
  { key: 'pagesPrevious', label: 'แผ่นเดือนก่อน', defaultWidth: 14, numeric: true },
  { key: 'difference', label: 'ผลต่าง', defaultWidth: 12, numeric: true },
  { key: 'momPercent', label: 'MoM %', defaultWidth: 10, numeric: true },
  { key: 'bwRate', label: 'อัตรา ขาวดำ', defaultWidth: 12, numeric: true },
  { key: 'rowCost', label: 'ค่าใช้จ่าย', defaultWidth: 14, numeric: true },
  { key: 'remark', label: 'หมายเหตุ', defaultWidth: 24 },
]

// ─── 16 supported variables (mirror of Apps Script DOC variables) ──────────
export const DOCUMENT_VARIABLES: string[] = [
  '{{reportTitle}}',
  '{{month}}',
  '{{siteName}}',
  '{{contractNo}}',
  '{{contractDate}}',
  '{{pdfPageCount}}',
  '{{printedAt}}',
  '{{totalPages}}',
  '{{deviceCount}}',
  '{{totalCost}}',
  '{{sumPrevCost}}',
  '{{sumStartMeter}}',
  '{{sumEndMeter}}',
  '{{sumPrevPages}}',
  '{{sumCurrentPages}}',
  '{{pageNumber}}',
]

// ─── Sample data used by the editor Preview modal ─────────────────────────
export interface DocumentRenderRow {
  no?: number
  brand?: string
  model?: string
  serial?: string
  buildingFloor?: string
  building?: string
  floor?: string
  department?: string
  location?: string
  site?: string
  status?: string
  vendor?: string
  startMeter?: number
  endMeter?: number
  pagesCurrent?: number
  pagesPrevious?: number
  difference?: number
  momPercent?: number
  bwRate?: number
  rowCost?: number
  remark?: string
}

export interface DocumentRenderData {
  title: string
  rows: DocumentRenderRow[]
  month?: string
  siteName?: string
  contractNo?: string
  contractDate?: string
}

// ─── ID generator ────────────────────────────────────────────────────────
let _seq = 0
export function genElementId(prefix = 'doc-el'): string {
  _seq += 1
  return `${prefix}-${Date.now().toString(36)}-${_seq.toString(36)}`
}

export function genTemplateId(): string {
  return `doc-tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ─── Build the default document template (matches the user's example) ─────
export function buildDefaultDocumentTemplate(): DocumentTemplate {
  const elements: DocumentElement[] = [
    // Title — "รายการผลิตภัณฑ์และบริการจ้างเหมา"
    {
      id: genElementId(),
      type: 'text',
      x: 10, y: 8, width: 200, height: 10,
      content: '{{reportTitle}}',
      fontSize: 16, fontWeight: 800, color: '#0f172a', align: 'left',
      zIndex: 1,
    },
    // Subtitle — "ประจำปี งบประมาณ 2569"
    {
      id: genElementId(),
      type: 'text',
      x: 10, y: 19, width: 200, height: 6,
      content: 'ประจำปี งบประมาณ 2569',
      fontSize: 11, fontWeight: 600, color: '#475569', align: 'left',
      zIndex: 1,
    },
    // Site + Month info
    {
      id: genElementId(),
      type: 'text',
      x: 10, y: 26, width: 200, height: 5,
      content: 'สาขา: {{siteName}}   ·   เดือน: {{month}}   ·   เลขที่สัญญา: {{contractNo}}',
      fontSize: 9, fontWeight: 500, color: '#64748b', align: 'left',
      zIndex: 1,
    },
    // Section header — "รายการสินค้า"
    {
      id: genElementId(),
      type: 'text',
      x: 10, y: 33, width: 100, height: 5,
      content: 'รายการสินค้า',
      fontSize: 10, fontWeight: 700, color: '#f97316', align: 'left',
      zIndex: 1,
    },
    // Orange divider under the section header
    {
      id: genElementId(),
      type: 'rect',
      x: 10, y: 38, width: 277, height: 0.6,
      background: '#f97316',
      zIndex: 0,
    },
  ]

  // Default 13 columns — matching the user's example image
  const table: DocumentTable = {
    y: 40,
    rowHeight: 7,
    fontSize: 9,
    headerColor: '#f97316',
    headerTextColor: '#ffffff',
    columns: [
      { key: 'no', label: 'ลำดับ', width: 10, numeric: true },
      { key: 'brand', label: 'ยี่ห้อ', width: 18 },
      { key: 'model', label: 'รุ่น', width: 22 },
      { key: 'serial', label: 'Serial', width: 22 },
      { key: 'remark', label: 'รายการ', width: 30 },
      { key: 'pagesCurrent', label: 'จำนวน', width: 14, numeric: true },
      { key: 'bwRate', label: 'หน่วยนับ', width: 12 },
      { key: 'startMeter', label: 'ราคาต่อหน่วย', width: 16, numeric: true },
      { key: 'rowCost', label: 'ราคารวม', width: 16, numeric: true },
      { key: 'momPercent', label: 'ส่วนลด มูลค่าเพิ่ม', width: 16, numeric: true },
      { key: 'difference', label: 'ส่วนลด ไม่มีภาษี', width: 16, numeric: true },
      { key: 'endMeter', label: 'มูลค่าสุทธิ', width: 16, numeric: true },
      { key: 'pagesPrevious', label: 'ส่วนลด(%)', width: 14, numeric: true },
    ],
  }

  const summary: DocumentSummaryItem[] = [
    { label: 'รวมมูลค่าสินค้า', valueKey: 'totalCost', align: 'right' },
    { label: 'รวมส่วนลด', valueKey: 'totalDiscount', align: 'right' },
    { label: 'รวมภาษีมูลค่าเพิ่ม', valueKey: 'totalVat', align: 'right' },
    { label: 'รวมเงินสุทธิ', valueKey: 'totalNet', align: 'right' },
  ]

  const footer: DocumentFooter = {
    height: 18,
    content: 'หน้า {{pageNumber}}/{{totalPages}}   ·   พิมพ์เมื่อ {{printedAt}}',
    fontSize: 8,
    color: '#94a3b8',
    signatures: ['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ'],
  }

  return {
    id: 'doc-tpl-default',
    name: 'เทมเพลตเอกสารเริ่มต้น (Default)',
    isDefault: true,
    canvas: {
      width: 297,
      height: 210,
      orientation: 'landscape',
      margin: 10,
      paper: 'A4',
    },
    elements,
    table,
    summary,
    footer,
  }
}

// ─── Variable substitution ────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatNumber(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return ''
  // Show integers without decimals, decimals with 2 places
  if (Number.isInteger(n)) return n.toLocaleString('en-US')
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export interface DocumentVariableValues {
  reportTitle?: string
  month?: string
  siteName?: string
  contractNo?: string
  contractDate?: string
  pdfPageCount?: string
  printedAt?: string
  totalPages?: string
  deviceCount?: string
  totalCost?: string
  sumPrevCost?: string
  sumStartMeter?: string
  sumEndMeter?: string
  sumPrevPages?: string
  sumCurrentPages?: string
  pageNumber?: string
  // Computed summary values (from rows)
  totalDiscount?: string
  totalVat?: string
  totalNet?: string
}

export function substituteVariables(text: string, v: DocumentVariableValues): string {
  const map: Record<string, string> = {
    '{{reportTitle}}': v.reportTitle ?? '',
    '{{month}}': v.month ?? '',
    '{{siteName}}': v.siteName ?? '',
    '{{contractNo}}': v.contractNo ?? '',
    '{{contractDate}}': v.contractDate ?? '',
    '{{pdfPageCount}}': v.pdfPageCount ?? '',
    '{{printedAt}}': v.printedAt ?? '',
    '{{totalPages}}': v.totalPages ?? '',
    '{{deviceCount}}': v.deviceCount ?? '',
    '{{totalCost}}': v.totalCost ?? '',
    '{{sumPrevCost}}': v.sumPrevCost ?? '',
    '{{sumStartMeter}}': v.sumStartMeter ?? '',
    '{{sumEndMeter}}': v.sumEndMeter ?? '',
    '{{sumPrevPages}}': v.sumPrevPages ?? '',
    '{{sumCurrentPages}}': v.sumCurrentPages ?? '',
    '{{pageNumber}}': v.pageNumber ?? '',
    '{{totalDiscount}}': v.totalDiscount ?? '',
    '{{totalVat}}': v.totalVat ?? '',
    '{{totalNet}}': v.totalNet ?? '',
  }
  let out = text
  for (const [k, val] of Object.entries(map)) {
    out = out.split(k).join(val)
  }
  return out
}

// ─── Render a single header element to HTML ──────────────────────────────
function renderElement(el: DocumentElement, v: DocumentVariableValues): string {
  const opacity = el.opacity ?? 1
  const zIndex = el.zIndex ?? 0
  const baseStyle = [
    `left:${el.x}mm`,
    `top:${el.y}mm`,
    `width:${el.width}mm`,
    `height:${el.height}mm`,
    `opacity:${opacity}`,
    `z-index:${zIndex}`,
    'position:absolute',
  ].join(';')

  if (el.type === 'text') {
    const raw = el.content ?? ''
    const substituted = substituteVariables(raw, v)
    const fontSize = el.fontSize ?? 10
    const fontWeight = el.fontWeight ?? 500
    const color = el.color ?? '#1e293b'
    const align = el.align ?? 'left'
    return `<div style="${baseStyle};font-size:${fontSize}pt;font-weight:${fontWeight};color:${color};text-align:${align};overflow:hidden;line-height:1.2;white-space:pre-wrap;word-break:break-word">${escapeHtml(substituted)}</div>`
  }

  if (el.type === 'rect') {
    const bg = el.background ?? 'transparent'
    const border = el.border ?? 'none'
    const radius = el.borderRadius ?? 0
    return `<div style="${baseStyle};background:${bg};border:${border};border-radius:${radius}mm"></div>`
  }

  if (el.type === 'image') {
    const src = el.content ?? ''
    if (!src) {
      return `<div style="${baseStyle};background:#f1f5f9;border:1px dashed #cbd5e1;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:8pt">(image)</div>`
    }
    return `<img src="${escapeHtml(src)}" alt="" style="${baseStyle};object-fit:contain" />`
  }

  return ''
}

// ─── Calculate rows-per-page based on canvas geometry ────────────────────
export function calcRowsPerPage(template: DocumentTemplate): number {
  const { canvas, table, footer } = template
  const usableHeight = canvas.height - canvas.margin * 2
  // table.y is measured from the page top (within the printable area starting at margin)
  // The effective table area = usableHeight - (table.y - margin) - footer.height
  const tableTopOffset = Math.max(0, table.y - canvas.margin)
  const availableForRows = usableHeight - tableTopOffset - footer.height
  if (availableForRows <= 0) return 1
  const rows = Math.floor(availableForRows / table.rowHeight)
  return Math.max(1, rows)
}

// ─── Calculate summary values from rows ───────────────────────────────────
export function calcSummary(rows: DocumentRenderRow[]): {
  totalCost: number
  totalDiscount: number
  totalVat: number
  totalNet: number
  sumStartMeter: number
  sumEndMeter: number
  sumPrevPages: number
  sumCurrentPages: number
} {
  let totalCost = 0
  let totalDiscount = 0
  let sumStartMeter = 0
  let sumEndMeter = 0
  let sumPrevPages = 0
  let sumCurrentPages = 0
  for (const r of rows) {
    if (typeof r.rowCost === 'number') totalCost += r.rowCost
    if (typeof r.difference === 'number') totalDiscount += r.difference
    if (typeof r.startMeter === 'number') sumStartMeter += r.startMeter
    if (typeof r.endMeter === 'number') sumEndMeter += r.endMeter
    if (typeof r.pagesPrevious === 'number') sumPrevPages += r.pagesPrevious
    if (typeof r.pagesCurrent === 'number') sumCurrentPages += r.pagesCurrent
  }
  // VAT 7% on (cost - discount)
  const totalVat = (totalCost - totalDiscount) * 0.07
  const totalNet = totalCost - totalDiscount + totalVat
  return {
    totalCost,
    totalDiscount,
    totalVat,
    totalNet,
    sumStartMeter,
    sumEndMeter,
    sumPrevPages,
    sumCurrentPages,
  }
}

// ─── Render full standalone HTML for window.print() ───────────────────────
export interface RenderResult {
  html: string
  totalPages: number
  summary: ReturnType<typeof calcSummary>
}

export function renderPDFFromTemplate(
  template: DocumentTemplate,
  data: DocumentRenderData,
  lang: 'th' | 'en' = 'th',
): RenderResult {
  const { canvas, table, footer, elements } = template

  // ── Compute summary from rows ───────────────────────────────────────────
  const summary = calcSummary(data.rows)

  // ── Pagination ──────────────────────────────────────────────────────────
  const rowsPerPage = calcRowsPerPage(template)
  const totalRows = data.rows.length
  const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage))

  // ── Build variable values for header elements + footer ──────────────────
  // BUGFIX (QA-ROUND-2026-09-16-C): `lang` was referenced but never defined
  // in this module → ReferenceError on every render. Now an explicit optional
  // parameter (defaults to 'th', matching the hardcoded <html lang="th">).
  const printedAt = new Date().toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
  })
  const baseVars: DocumentVariableValues = {
    reportTitle: data.title,
    month: data.month ?? '',
    siteName: data.siteName ?? '',
    contractNo: data.contractNo ?? '',
    contractDate: data.contractDate ?? '',
    printedAt,
    totalPages: String(totalPages),
    deviceCount: String(totalRows),
    totalCost: formatNumber(summary.totalCost),
    sumPrevCost: formatNumber(summary.totalCost * 0.9),
    sumStartMeter: formatNumber(summary.sumStartMeter),
    sumEndMeter: formatNumber(summary.sumEndMeter),
    sumPrevPages: formatNumber(summary.sumPrevPages),
    sumCurrentPages: formatNumber(summary.sumCurrentPages),
    totalDiscount: formatNumber(summary.totalDiscount),
    totalVat: formatNumber(summary.totalVat),
    totalNet: formatNumber(summary.totalNet),
  }

  // ── Header HTML (shared across all pages) ───────────────────────────────
  const headerHtml = [...elements]
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    .map((el) => renderElement(el, baseVars))
    .filter(Boolean)
    .join('\n')

  // ── Table column widths (mm) ────────────────────────────────────────────
  const colWidths = table.columns.map((c) => c.width)
  const tableWidth = colWidths.reduce((a, b) => a + b, 0)

  // ── Build per-page HTML ─────────────────────────────────────────────────
  const pages: string[] = []
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const startIdx = (pageNum - 1) * rowsPerPage
    const endIdx = Math.min(startIdx + rowsPerPage, totalRows)
    const pageRows = data.rows.slice(startIdx, endIdx)

    // Page-scoped variables (pageNumber + pdfPageCount)
    const pageVars: DocumentVariableValues = {
      ...baseVars,
      pageNumber: String(pageNum),
      pdfPageCount: `${pageNum}/${totalPages}`,
    }

    // Header
    const headerWithPageNum = [...elements]
      .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
      .map((el) => renderElement(el, pageVars))
      .filter(Boolean)
      .join('\n')

    // Table header
    const thead = table.columns
      .map((c) => {
        const align = c.numeric ? 'right' : 'left'
        return `<th style="width:${c.width}mm;background:${table.headerColor};color:${table.headerTextColor};padding:3px 4px;text-align:${align};font-size:${table.fontSize - 1}pt;font-weight:600;border:1px solid #e2e8f0">${escapeHtml(c.label)}</th>`
      })
      .join('')

    // Table rows
    const tbody = pageRows
      .map((r, i) => {
        const cells = table.columns
          .map((c) => {
            const align = c.numeric ? 'right' : 'left'
            const v = (r as Record<string, unknown>)[c.key]
            const text = c.numeric
              ? formatNumber(typeof v === 'number' ? v : undefined)
              : escapeHtml(String(v ?? ''))
            return `<td style="width:${c.width}mm;padding:2px 4px;text-align:${align};font-size:${table.fontSize}pt;border:1px solid #e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${text}</td>`
          })
          .join('')
        const no = startIdx + i + 1
        // Replace the 'no' column value automatically
        const rowWithNo = cells.replace(
          /(<td[^>]*>)(?:\d+)?<\/td>/,
          `$1${no}</td>`,
        )
        const bg = i % 2 === 1 ? 'background:#fafbfc;' : ''
        return `<tr style="${bg}">${rowWithNo}</tr>`
      })
      .join('')

    // Summary block (only on last page)
    let summaryHtml = ''
    if (pageNum === totalPages && template.summary.length > 0) {
      const rows = template.summary
        .map((s) => {
          const val = s.valueKey === 'totalCost'
            ? formatNumber(summary.totalCost)
            : s.valueKey === 'totalDiscount'
              ? formatNumber(summary.totalDiscount)
              : s.valueKey === 'totalVat'
                ? formatNumber(summary.totalVat)
                : s.valueKey === 'totalNet'
                  ? formatNumber(summary.totalNet)
                  : ''
          const align = s.align === 'right' ? 'right' : 'left'
          return `<div style="display:flex;justify-content:flex-end;gap:8px;font-size:${table.fontSize}pt;padding:2px 0">
              <span style="min-width:140px;text-align:right;color:#475569">${escapeHtml(s.label)}</span>
              <span style="min-width:100px;text-align:${align};font-weight:600;color:#0f172a">${val}</span>
            </div>`
        })
        .join('')
      summaryHtml = `<div style="margin-top:6mm;padding:3mm 0;border-top:1px solid #cbd5e1">${rows}</div>`
    }

    // Footer
    const footerText = substituteVariables(footer.content, pageVars)
    const sigHtml = (footer.signatures ?? [])
      .map((s) => {
        return `<div style="flex:1;text-align:center">
            <div style="margin-top:6mm;border-top:1px solid #475569;padding-top:1mm;font-size:${footer.fontSize ?? 8}pt;color:#475569">${escapeHtml(s)}</div>
          </div>`
      })
      .join('')
    const footerHtml = `<div style="position:absolute;left:${canvas.margin}mm;right:${canvas.margin}mm;bottom:${canvas.margin}mm;height:${footer.height}mm">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;font-size:${footer.fontSize ?? 8}pt;color:${footer.color ?? '#94a3b8'};border-top:1px solid #e2e8f0;padding-top:1mm">
          <div>${escapeHtml(footerText)}</div>
          <div>องค์กร — IT Asset Management</div>
        </div>
        <div style="display:flex;gap:8mm;margin-top:1mm">${sigHtml}</div>
      </div>`

    const pageHtml = `<section class="doc-page" style="position:relative;width:${canvas.width}mm;height:${canvas.height}mm;page-break-after:${pageNum < totalPages ? 'always' : 'auto'};overflow:hidden;background:#ffffff">
        ${headerWithPageNum}
        <div style="position:absolute;left:${canvas.margin}mm;top:${table.y}mm;width:${tableWidth}mm">
          <table style="border-collapse:collapse;width:${tableWidth}mm;table-layout:fixed">
            <thead><tr>${thead}</tr></thead>
            <tbody>${tbody}</tbody>
          </table>
          ${summaryHtml}
        </div>
        ${footerHtml}
      </section>`
    pages.push(pageHtml)
  }

  // Suppress the unused-variable warning for headerHtml (kept for future single-page optimization)
  void headerHtml

  // ── Wrap in standalone HTML document ────────────────────────────────────
  const orientation = canvas.orientation
  const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(data.title || 'ITAM Document')}</title>
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: "Sukhumvit Set","Noto Sans Thai","Tahoma","Segoe UI",sans-serif;
    color: #1e293b;
    background: #ffffff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @page {
    size: ${canvas.paper === 'Custom' ? `${canvas.width}mm ${canvas.height}mm` : `${canvas.paper} ${orientation}`};
    margin: 0;
  }
  .doc-page { box-shadow: 0 2px 10px rgba(0,0,0,0.06); }
  @media screen {
    body { background: #e2e8f0; padding: 16px; }
    .doc-page { margin: 0 auto 12px; }
  }
  @media print {
    body { background: #ffffff; padding: 0; }
    .doc-page { box-shadow: none; margin: 0; }
  }
  .print-btn {
    position: fixed; top: 12px; right: 12px;
    background: #f97316; color: white; border: none;
    padding: 8px 16px; border-radius: 6px;
    cursor: pointer; font-size: 12px; font-weight: 600;
    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
    z-index: 999;
  }
  .print-btn:hover { background: #ea580c; }
  @media print { .print-btn { display: none; } }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨 พิมพ์ / บันทึก PDF</button>
  ${pages.join('\n')}
  <script>
    (function () {
      if (document.readyState === 'complete') doPrint();
      else window.addEventListener('load', doPrint);
      function doPrint() {
        setTimeout(function () { try { window.focus(); window.print(); } catch (e) {} }, 300);
      }
    })();
  </script>
</body>
</html>`

  return { html, totalPages, summary }
}

// ─── Normalize an incoming template object (defensive parsing) ────────────
export function normalizeTemplate(input: unknown): DocumentTemplate {
  const obj = (input ?? {}) as Partial<DocumentTemplate>
  const canvas = (obj.canvas ?? {}) as Partial<DocumentCanvas>
  const orientation: 'portrait' | 'landscape' =
    canvas.orientation === 'portrait' ? 'portrait' : 'landscape'

  return {
    id: String(obj.id ?? genTemplateId()),
    name: String(obj.name ?? 'เทมเพลตเอกสารใหม่').slice(0, 100),
    isDefault: !!obj.isDefault,
    canvas: {
      width: Number(canvas.width) > 0 ? Number(canvas.width) : 297,
      height: Number(canvas.height) > 0 ? Number(canvas.height) : 210,
      orientation,
      margin: Number(canvas.margin) >= 0 ? Number(canvas.margin) : 10,
      paper: ['A4', 'A3', 'Letter', 'Legal', 'Custom'].includes(canvas.paper as string)
        ? (canvas.paper as DocumentCanvas['paper'])
        : 'A4',
    },
    elements: Array.isArray(obj.elements) ? obj.elements.map(normalizeElement) : [],
    table: normalizeTable(obj.table),
    summary: Array.isArray(obj.summary) ? obj.summary.map(normalizeSummaryItem) : [],
    footer: normalizeFooter(obj.footer),
  }
}

export function normalizeElement(input: unknown): DocumentElement {
  const el = (input ?? {}) as Partial<DocumentElement>
  return {
    id: String(el.id ?? genElementId()),
    type: (['text', 'image', 'rect'].includes(el.type as string)
      ? (el.type as DocumentElementType)
      : 'text'),
    x: Number(el.x) || 0,
    y: Number(el.y) || 0,
    width: Number(el.width) || 10,
    height: Number(el.height) || 4,
    opacity: typeof el.opacity === 'number' ? Math.min(1, Math.max(0, el.opacity)) : 1,
    zIndex: typeof el.zIndex === 'number' ? el.zIndex : 0,
    fontSize: typeof el.fontSize === 'number' ? el.fontSize : 10,
    fontWeight: typeof el.fontWeight === 'number' ? el.fontWeight : 500,
    color: typeof el.color === 'string' ? el.color : '#1e293b',
    align: (['left', 'center', 'right'].includes(el.align as string)
      ? (el.align as 'left' | 'center' | 'right')
      : 'left'),
    content: typeof el.content === 'string' ? el.content : '',
    background: typeof el.background === 'string' ? el.background : '',
    border: typeof el.border === 'string' ? el.border : '',
    borderRadius: typeof el.borderRadius === 'number' ? el.borderRadius : 0,
  }
}

export function normalizeTable(input: unknown): DocumentTable {
  const t = (input ?? {}) as Partial<DocumentTable>
  return {
    y: Number(t.y) >= 0 ? Number(t.y) : 40,
    rowHeight: Number(t.rowHeight) > 0 ? Number(t.rowHeight) : 7,
    fontSize: Number(t.fontSize) > 0 ? Number(t.fontSize) : 9,
    headerColor: typeof t.headerColor === 'string' ? t.headerColor : '#f97316',
    headerTextColor: typeof t.headerTextColor === 'string' ? t.headerTextColor : '#ffffff',
    columns: Array.isArray(t.columns) ? t.columns.map(normalizeColumn) : [],
  }
}

export function normalizeColumn(input: unknown): DocumentTableColumn {
  const c = (input ?? {}) as Partial<DocumentTableColumn>
  return {
    key: String(c.key ?? 'no'),
    label: String(c.label ?? '').slice(0, 50),
    width: Number(c.width) > 0 ? Number(c.width) : 14,
    numeric: !!c.numeric,
  }
}

export function normalizeSummaryItem(input: unknown): DocumentSummaryItem {
  const s = (input ?? {}) as Partial<DocumentSummaryItem>
  return {
    label: String(s.label ?? '').slice(0, 100),
    valueKey: String(s.valueKey ?? 'totalCost').slice(0, 50),
    align: s.align === 'left' ? 'left' : 'right',
  }
}

export function normalizeFooter(input: unknown): DocumentFooter {
  const f = (input ?? {}) as Partial<DocumentFooter>
  return {
    height: Number(f.height) >= 0 ? Number(f.height) : 18,
    content: typeof f.content === 'string' ? f.content : 'หน้า {{pageNumber}}/{{totalPages}}',
    fontSize: typeof f.fontSize === 'number' ? f.fontSize : 8,
    color: typeof f.color === 'string' ? f.color : '#94a3b8',
    signatures: Array.isArray(f.signatures) ? f.signatures.map(String) : [],
  }
}

// ─── Paper size presets ──────────────────────────────────────────────────
export interface DocPaperPreset {
  label: string
  paper: DocumentCanvas['paper']
  width: number
  height: number
  orientation: 'portrait' | 'landscape'
}

export const DOC_PAPER_PRESETS: DocPaperPreset[] = [
  { label: 'A4 Landscape (297×210)', paper: 'A4', width: 297, height: 210, orientation: 'landscape' },
  { label: 'A4 Portrait (210×297)', paper: 'A4', width: 210, height: 297, orientation: 'portrait' },
  { label: 'A3 Landscape (420×297)', paper: 'A3', width: 420, height: 297, orientation: 'landscape' },
  { label: 'A3 Portrait (297×420)', paper: 'A3', width: 297, height: 420, orientation: 'portrait' },
  { label: 'Letter Landscape (279×216)', paper: 'Letter', width: 279, height: 216, orientation: 'landscape' },
  { label: 'Letter Portrait (216×279)', paper: 'Letter', width: 216, height: 279, orientation: 'portrait' },
  { label: 'Legal Landscape (356×216)', paper: 'Legal', width: 356, height: 216, orientation: 'landscape' },
  { label: 'Legal Portrait (216×356)', paper: 'Legal', width: 216, height: 356, orientation: 'portrait' },
]

// ─── Check whether an element exceeds the canvas bounds ──────────────────
export function elementExceedsBounds(el: DocumentElement, canvas: DocumentCanvas): boolean {
  return (
    el.x < canvas.margin - 0.01 ||
    el.y < 0 ||
    el.x + el.width > canvas.width - canvas.margin + 0.01 ||
    el.y + el.height > canvas.height - 0.01
  )
}
