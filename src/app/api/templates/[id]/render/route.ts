// ============================================================
// Template Render API (Task ID: VISUAL-TEMPLATE-EDITOR, PART 2)
// ============================================================
// POST /api/templates/[id]/render
//
// Body: { data?: TemplateRenderData, workOrderId?: string }
//   • If workOrderId is supplied, fetch the real WO + parts and merge
//     them on top of the (optional) data override.
//   • Otherwise render with the supplied data (or a built-in sample).
//
// Returns: { html, elements, paper }
//   • html — full self-contained HTML page (print-ready) that mirrors
//     the visual editor's canvas. The HTML uses absolute positioning
//     in millimetres so it prints at the correct physical size.
//   • elements — the rendered (interpolated) element list, useful for
//     client-side preview hydration.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import {
  interpolate,
  mmToPx,
  parseContent,
  PAPER_SIZES,
  SAMPLE_DATA,
  type PaperSizeKey,
  type TableColumn,
  type TemplateContent,
  type TemplateElement,
  type TemplateRenderData,
} from '@/lib/template-editor'
import { getServerLang, serverFormatDateTime, serverFormatDate, serverFormatCurrency, type Lang } from '@/lib/server-i18n'

// ─────────────────────────────────────────────────────
// HTML escape
// ─────────────────────────────────────────────────────

function esc(input: unknown): string {
  if (input === null || input === undefined) return ''
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─────────────────────────────────────────────────────
// Status label
// ─────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'รอดำเนินการ',
  IN_PROGRESS: 'กำลังซ่อม',
  WAITING_PARTS: 'รออะไหล่',
  COMPLETED: 'เสร็จแล้ว',
  CANCELLED: 'ยกเลิก',
}

function statusLabel(s: string | undefined): string {
  if (!s) return '—'
  return STATUS_LABELS[s] ?? s
}

// All three helpers accept a Prisma `DateTime` (e.g. WorkOrder.createdAt /
// assignedAt) OR a loose string — matching the `formatThaiDateOnly` convention
// below and serverFormatDate/serverFormatDateTime in @/lib/server-i18n.
function formatDate(iso: Date | string | null | undefined, lang: Lang = 'th'): string {
  if (!iso) return '—'
  return serverFormatDateTime(iso, lang)
}

function formatDateOnly(iso: Date | string | null | undefined, lang: Lang = 'th'): string {
  if (!iso) return '—'
  return serverFormatDate(iso, lang)
}

// ─────────────────────────────────────────────────────
// CONSULTING-007: device field formatters
// ─────────────────────────────────────────────────────

/**
 * Format an ISO/loose date string as a Thai-locale date-only string.
 * Device fields like `warrantyEnd` and `purchaseDate` are stored as
 * free-form strings (the schema is `String?`), so we tolerate anything
 * Date can parse and fall back to the raw string on parse failure.
 *
 * Locale: 'th-TH' — uses Buddhist Era (B.E.) year by default. If the
 * team later wants Gregorian, change the locale to 'en-GB' here.
 */
function formatDeviceDate(iso: string | null | undefined, lang: Lang = 'th'): string {
  if (!iso) return '—'
  return serverFormatDate(iso, lang)
}

/**
 * Format a Decimal/number/string money value as "฿1,234.56".
 * The Prisma Device.purchasePrice column is `Decimal @db.Decimal(12, 2)`,
 * so the value can come back as a Prisma.Decimal, a number, or a string
 * depending on the call site. We normalise to 2 decimal places + the
 * Thai Baht symbol + thousands separators.
 */
function formatBaht(v: unknown, lang: Lang = 'th'): string {
  if (v === null || v === undefined || v === '') return '—'
  const n = typeof v === 'number' ? v : Number(String(v))
  if (!Number.isFinite(n)) return String(v)
  return serverFormatCurrency(n, lang, 'THB')
}

// ─────────────────────────────────────────────────────
// Build render data from a work order
// ─────────────────────────────────────────────────────

async function buildDataFromWo(
  workOrderId: string,
  lang: Lang = 'th',
): Promise<TemplateRenderData> {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      device: {
        select: {
          id: true,
          assetCode: true,
          name: true,
          brand: true,
          model: true,
          serialNumber: true,
          site: true,
          // ── CONSULTING-007: 12 new device fields for template variables ──
          type: true,
          status: true,
          currentAssignee: true,
          warrantyEnd: true,
          purchaseDate: true,
          purchasePrice: true,
          vendor: true,
          contractNo: true,
          ip: true,
          mac: true,
          floor: true,
          room: true,
        },
      },
    },
  })
  if (!wo) return { ...SAMPLE_DATA }

  // Linked parts
  const partsWhere = wo.woNumber
    ? {
        OR: [{ workOrderNo: wo.woNumber }, { workOrderId: wo.id }],
      }
    : { workOrderId: wo.id }
  const parts = await db.stockTransaction.findMany({
    where: partsWhere,
    orderBy: [{ createdAt: 'asc' }],
    select: {
      id: true,
      txnNumber: true,
      productName: true,
      productCode: true,
      type: true,
      quantity: true,
      unit: true,
      cost: true,
      unitCost: true,
      txnDate: true,
      stockItem: {
        select: { productName: true, productCode: true, unit: true },
      },
    },
  })

  const workOrderItems = parts.map((p, idx) => ({
    no: String(idx + 1),
    productName: p.productName ?? p.stockItem?.productName ?? '—',
    quantity: String(p.quantity),
    unit: p.unit ?? p.stockItem?.unit ?? '',
    price: p.cost ? p.cost.toFixed(2) : '',
    productCode: p.productCode ?? p.stockItem?.productCode ?? '',
    txnNumber: p.txnNumber ?? '',
    type: p.type,
  }))

  const stockTransactions = parts.map((p) => ({
    txnNumber: p.txnNumber ?? '',
    productName: p.productName ?? p.stockItem?.productName ?? '—',
    productCode: p.productCode ?? p.stockItem?.productCode ?? '',
    quantity: String(p.quantity),
    unit: p.unit ?? p.stockItem?.unit ?? '',
    type: p.type,
    txnDate: formatDateOnly(p.txnDate, lang),
  }))

  const devices = wo.device
    ? [
        {
          assetCode: wo.device.assetCode,
          brand: wo.device.brand ?? '',
          model: wo.device.model ?? '',
          serial: wo.device.serialNumber ?? '',
          productName: wo.device.name ?? '',
        },
      ]
    : []

  return {
    woNumber: wo.woNumber ?? '—',
    subject: wo.subject,
    reporterName: wo.reporterName ?? '—',
    building: wo.building ?? '—',
    location: wo.location ?? '—',
    priority: wo.priority,
    status: statusLabel(wo.status),
    assignedTo: wo.assignedTo ?? '—',
    resolution: wo.resolution ?? '—',
    details: wo.details ?? '',
    tel: wo.tel ?? '—',
    date: formatDateOnly(wo.createdAt, lang),
    assetCode: wo.device?.assetCode ?? '—',
    brand: wo.device?.brand ?? '—',
    model: wo.device?.model ?? '—',
    serial: wo.device?.serialNumber ?? '—',
    productName: wo.device?.name ?? '—',
    // ── CONSULTING-007: 12 new device fields ──────────────────────────
    // All default to '—' so the template prints a clear placeholder when
    // the device row is missing the field, rather than leaving a blank
    // spot that looks like a rendering bug.
    deviceStatus: wo.device?.status ?? '—',
    deviceType: wo.device?.type ?? '—',
    currentAssignee: wo.device?.currentAssignee ?? '—',
    warrantyEnd: formatDeviceDate(wo.device?.warrantyEnd, lang),
    purchaseDate: formatDeviceDate(wo.device?.purchaseDate, lang),
    purchasePrice: formatBaht(wo.device?.purchasePrice, lang),
    vendor: wo.device?.vendor ?? '—',
    contractNo: wo.device?.contractNo ?? '—',
    ip: wo.device?.ip ?? '—',
    mac: wo.device?.mac ?? '—',
    floor: wo.device?.floor ?? '—',
    room: wo.device?.room ?? '—',
    // ── End CONSULTING-007 device fields ──────────────────────────────
    orgName: 'ระบบจัดการสินทรัพย์',
    printDate: formatDate(new Date().toISOString(), lang),
    workOrderItems,
    stockTransactions,
    devices,
    custom: [],
  }
}

// ─────────────────────────────────────────────────────
// Render an element to absolutely-positioned HTML
// ─────────────────────────────────────────────────────

function renderElement(
  el: TemplateElement,
  data: TemplateRenderData,
): string {
  const leftMm = el.x
  const topMm = el.y
  const widthMm = el.w
  const heightMm = el.h

  const baseStyle = `position:absolute;left:${leftMm}mm;top:${topMm}mm;width:${widthMm}mm;min-height:${heightMm}mm;`

  switch (el.type) {
    case 'text': {
      const text = interpolate(esc(el.content), data)
      const fontStyle = el.italic ? 'italic' : 'normal'
      const textDecoration = el.underline ? 'underline' : 'none'
      const lineHeight = el.lineHeight ?? 1.3
      return `<div style="${baseStyle}font-size:${el.fontSize}px;font-weight:${el.fontWeight};color:${el.color};text-align:${el.align};font-style:${fontStyle};text-decoration:${textDecoration};line-height:${lineHeight};white-space:pre-wrap;word-break:break-word;overflow:hidden;">${text}</div>`
    }
    case 'image': {
      if (!el.src) {
        return `<div style="${baseStyle}border:1px dashed #cbd5e1;background:#f8fafc;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px;">ไม่มีรูป</div>`
      }
      const objectFit =
        el.fit === 'cover' ? 'cover' : el.fit === 'fill' ? 'fill' : 'contain'
      return `<div style="${baseStyle}overflow:hidden;"><img src="${esc(el.src)}" alt="" style="width:100%;height:100%;object-fit:${objectFit};opacity:${el.opacity};display:block;" /></div>`
    }
    case 'qr': {
      const content = interpolate(el.content, data)
      const sizePx = mmToPx(Math.min(el.w, el.h))
      const url = `https://api.qrserver.com/v1/create-qr-code/?size=${Math.round(
        sizePx,
      )}x${Math.round(sizePx)}&data=${encodeURIComponent(content)}&color=${el.fgColor.replace(
        '#',
        '',
      )}&bgcolor=${el.bgColor.replace('#', '')}`
      return `<div style="${baseStyle}overflow:hidden;display:flex;align-items:center;justify-content:center;background:${el.bgColor};"><img src="${esc(url)}" alt="QR" style="width:100%;height:100%;display:block;" /></div>`
    }
    case 'rectangle': {
      const bg = el.bgColor === 'transparent' ? 'transparent' : el.bgColor
      return `<div style="${baseStyle}border:${el.borderWidth}px solid ${el.borderColor};background:${bg};border-radius:${el.radius}px;"></div>`
    }
    case 'line': {
      const t = el.thickness
      if (el.direction === 'vertical') {
        return `<div style="position:absolute;left:${leftMm}mm;top:${topMm}mm;width:${t}px;height:${heightMm}mm;background:${el.color};"></div>`
      }
      return `<div style="position:absolute;left:${leftMm}mm;top:${topMm}mm;width:${widthMm}mm;height:${t}px;background:${el.color};"></div>`
    }
    case 'table': {
      const rows = pickRows(el.dataSource, data)
      return renderTable(el, rows, baseStyle)
    }
    default: {
      const _t: never = el
      void _t
      return ''
    }
  }
}

function pickRows(
  dataSource: string,
  data: TemplateRenderData,
): Array<Record<string, string>> {
  switch (dataSource) {
    case 'work-order-items':
      return data.workOrderItems ?? []
    case 'stock-transactions':
      return data.stockTransactions ?? []
    case 'devices':
      return data.devices ?? []
    case 'custom':
      return data.custom ?? []
    default:
      return []
  }
}

function renderTable(
  el: Extract<TemplateElement, { type: 'table' }>,
  rows: Array<Record<string, string>>,
  baseStyle: string,
): string {
  const cols: TableColumn[] = el.columns
  const totalWidthMm = cols.reduce((s, c) => s + c.width, 0)
  const rowsHtml = rows.length
    ? rows
        .map(
          (r) =>
            `<tr>${cols
              .map((c) => {
                const val = c.field && c.field in r ? r[c.field] ?? '' : ''
                return `<td style="border:${el.borderWidth}px solid ${el.borderColor};padding:3px 5px;font-size:${el.fontSize}px;height:${el.rowHeight}mm;vertical-align:middle;">${esc(val)}</td>`
              })
              .join('')}</tr>`,
        )
        .join('')
    : `<tr><td style="border:${el.borderWidth}px solid ${el.borderColor};padding:6px;text-align:center;color:#94a3b8;font-size:${el.fontSize}px;" colspan="${cols.length}">ไม่มีข้อมูล</td></tr>`

  const headHtml = cols
    .map(
      (c) =>
        `<th style="border:${el.borderWidth}px solid ${el.borderColor};background:${el.headerBg};color:${el.headerColor};padding:3px 5px;font-size:${el.fontSize}px;font-weight:600;text-align:left;width:${c.width}mm;">${esc(c.label)}</th>`,
    )
    .join('')

  return `<div style="${baseStyle}overflow:hidden;"><table style="border-collapse:collapse;table-layout:fixed;width:${totalWidthMm}mm;font-family:inherit;"><thead><tr>${headHtml}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`
}

// ─────────────────────────────────────────────────────
// Build full HTML page
// ─────────────────────────────────────────────────────

function buildFullHtml(
  content: TemplateContent,
  data: TemplateRenderData,
  lang: Lang = 'th',
): string {
  const paper = content.paper
  const paperKey = (paper.size as PaperSizeKey) || 'A4'
  const spec = PAPER_SIZES[paperKey] ?? PAPER_SIZES.A4
  const widthMm = paper.width || spec.width
  const heightMm = paper.height || spec.height
  const margin = paper.margin ?? 10

  const elementsHtml = content.elements
    .map((el) => renderElement(el, data))
    .join('\n      ')

  const pageOrientation = widthMm > heightMm ? 'landscape' : 'portrait'
  const pageAtRule =
    widthMm === 210 && heightMm === 297
      ? `A4 ${pageOrientation}`
      : widthMm === 297 && heightMm === 210
        ? `A4 ${pageOrientation}`
        : widthMm === 148 && heightMm === 210
          ? `A5 ${pageOrientation}`
          : widthMm === 216 && heightMm === 279
            ? `Letter ${pageOrientation}`
            : `${widthMm}mm ${heightMm}mm ${pageOrientation}`

  const today = serverFormatDateTime(new Date().toISOString(), lang)

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>เทมเพลตเอกสาร</title>
  <style>
    @page { size: ${pageAtRule}; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      font-family: 'Segoe UI', 'Thonburi', 'Tahoma', sans-serif;
      color: #1e293b; background: #f1f5f9;
    }
    body { padding: 16px; display: flex; justify-content: center; }
    .page {
      position: relative;
      background: #ffffff;
      width: ${widthMm}mm;
      height: ${heightMm}mm;
      box-shadow: 0 4px 18px rgba(0,0,0,0.08);
      overflow: hidden;
    }
    .margin-guide {
      position: absolute;
      left: ${margin}mm; top: ${margin}mm;
      right: ${margin}mm; bottom: ${margin}mm;
      border: 1px dashed transparent;
      pointer-events: none;
    }
    .toolbar {
      position: fixed; bottom: 16px; right: 16px;
      display: flex; gap: 8px; z-index: 99;
    }
    .toolbar button {
      padding: 8px 14px; border-radius: 6px; border: none;
      background: #f97316; color: white; font-size: 13px;
      font-weight: 600; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }
    .toolbar button.secondary { background: #64748b; }
    .meta-bar {
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      background: rgba(15,23,42,0.85); color: #fff; font-size: 11px;
      padding: 4px 12px; border-radius: 999px; z-index: 99;
    }
    @media print {
      body { background: white; padding: 0; }
      .page { box-shadow: none; }
      .toolbar, .meta-bar { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="meta-bar">เทมเพลตพรีวิว • ${esc(today)}</div>
  <div class="page">
    <div class="margin-guide"></div>
      ${elementsHtml}
  </div>
  <div class="toolbar">
    <button type="button" onclick="window.print()">🖨 พิมพ์</button>
    <button type="button" class="secondary" onclick="window.close()">ปิด</button>
  </div>
  <script>
    (function() {
      if (window.opener) {
        setTimeout(function() { window.print(); }, 400);
      }
    })();
  </script>
</body>
</html>`
}

// ─────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('templates')
  if (unavailable) return unavailable

  // Milestone 2: Security baseline — require TEMPLATES_MANAGE
  const auth = await requireAuth(req, 'TEMPLATES_MANAGE')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params
    const template = await db.documentTemplate.findUnique({
      where: { id },
    })
    if (!template) {
      return NextResponse.json({ error: 'ไม่พบเทมเพลต' }, { status: 404 })
    }

    let body: { data?: TemplateRenderData; workOrderId?: string } = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }

    const lang = getServerLang(req)
    let data: TemplateRenderData
    if (body.workOrderId) {
      data = await buildDataFromWo(body.workOrderId, lang)
      // Merge in any explicit overrides
      if (body.data) {
        data = { ...data, ...body.data }
      }
    } else {
      data = { ...SAMPLE_DATA, ...(body.data ?? {}) }
    }

    const content = parseContent(template.content)
    const html = buildFullHtml(content, data, lang)

    return NextResponse.json({
      html,
      elements: content.elements,
      paper: content.paper,
    })
  } catch (err) {
    console.error('POST /api/templates/[id]/render', err)
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'เรนเดอร์เทมเพลตไม่สำเร็จ') : 'Internal server error',
      },
      { status: 500 },
    )
  }
}
