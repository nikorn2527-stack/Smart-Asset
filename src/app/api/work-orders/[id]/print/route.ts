// ============================================================
// Work Order Print HTML API (Task ID: PRINT-REPORT, PART 1)
// ============================================================
// GET /api/work-orders/[id]/print?paper=a4-portrait|a4-landscape|a5-portrait
//
// Returns a full, self-contained HTML page (text/html) ready to open
// in a new tab/window and print directly. The page contains:
//   • Header (Logo + "ใบแจ้งซ่อม" + WO number + date)
//   • Info section (reporter, phone, building, location, subject, etc.)
//   • Device section (if linked)
//   • External section (if externalMeta)
//   • Assignment section
//   • Work section (resolution, admin note, completion date)
//   • Parts section (linked stock transactions)
//   • Images section (before / onsite / after)
//   • Signatures section
//   • Footer (print date + WO number)
//
// Print CSS sets @page size based on the `paper` query param.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { loadAuthorizedWorkOrder } from '@/lib/wo-authz'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { getServerLang, type Lang } from '@/lib/server-i18n'

type PaperKey = 'a4-portrait' | 'a4-landscape' | 'a5-portrait' | 'ticket-80' | 'ticket-58'

const PAPER_SIZES: Record<
  PaperKey,
  { size: string; landscape: boolean; maxWidth: string }
> = {
  'a4-portrait': { size: 'A4 portrait', landscape: false, maxWidth: '190mm' },
  'a4-landscape': {
    size: 'A4 landscape',
    landscape: true,
    maxWidth: '277mm',
  },
  'a5-portrait': { size: 'A5 portrait', landscape: false, maxWidth: '130mm' },
  'ticket-80': { size: '80mm auto', landscape: false, maxWidth: '72mm' },
  'ticket-58': { size: '58mm auto', landscape: false, maxWidth: '52mm' },
}

function esc(input: unknown): string {
  if (input === null || input === undefined) return ''
  const s = String(input)
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Accepts a Prisma `DateTime` (e.g. WorkOrder.assignedAt) or an ISO string —
// same convention as formatThaiDateOnly below.
function formatDate(iso: Date | string | null | undefined, lang: Lang): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return String(iso)
  }
}

/** Accepts a Prisma `DateTime` (e.g. WorkOrder.createdAt) or an ISO string. */
function formatThaiDateOnly(iso: Date | string | null | undefined, lang: Lang): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return String(iso)
  }
}

interface ExternalMetaShape {
  clientName?: string
  place?: string
  contactPhone?: string
  serials?: string[]
}

function parseExternalMeta(raw: string | null): ExternalMetaShape | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return null
    return obj as ExternalMetaShape
  } catch {
    return null
  }
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'รอดำเนินการ',
  IN_PROGRESS: 'กำลังซ่อม',
  WAITING_PARTS: 'รออะไหล่',
  COMPLETED: 'เสร็จแล้ว',
  CANCELLED: 'ยกเลิก',
}

function statusLabel(s: string): string {
  return STATUS_LABELS[s] ?? s
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // I18N-04: resolve the caller's language server-side.
  const lang = getServerLang(req)

  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'WO_VIEW_ALL')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const { id } = await params

    // ── Authentication + Site-scoped authorization ──
    // Task ID: RESIDUAL-BLOCKERS-ROUND-4 — replaces the previous
    // `can('WO_VIEW_ALL')` (union) + separate `canAccessSite(woSite)`
    // check. The union `can()` lets a UDH=admin print NKP WOs (because
    // WO_VIEW_ALL appears in the union even though the user's NKP role
    // is viewer). `loadAuthorizedWorkOrder` uses `canAtSite(woSite,
    // 'WO_VIEW_ALL')` internally — which checks ONLY the role at the
    // WO's Site — closing the mixed-role escalation.
    // allowOwn:true lets a reporter print their own WO even without
    // a Site-scoped view permission (WO_VIEW_OWN).
    const result = await loadAuthorizedWorkOrder(req, id, 'WO_VIEW_ALL', {
      allowOwn: true,
    })
    if (!result.ok) {
      // Respect the status from loadAuthorizedWorkOrder:
      //   • 401 → caller is not authenticated (should log in first). Returning
      //     404 here would hide the fact that authentication is required, so
      //     the client could never recover. 401 is the correct HTTP contract
      //     for "you must authenticate" — see RFC 7235.
      //   • 404 → authenticated caller without access (or WO truly missing).
      //     404 (not 403) avoids revealing WO existence to unauthorized users.
      // This matches the pattern used by print-sheet/route.ts (status: result.status).
      const html =
        result.status === 401
          ? '<h1>กรุณาเข้าสู่ระบบ</h1><p>ต้องเข้าสู่ระบบเพื่อพิมพ์ใบงาน</p>'
          : '<h1>ไม่พบใบงาน</h1>'
      return new NextResponse(html, {
        status: result.status,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    const { searchParams } = new URL(req.url)
    const paperParam = (searchParams.get('paper')?.trim() ||
      'a4-portrait') as PaperKey
    const paper = PAPER_SIZES[paperParam] ?? PAPER_SIZES['a4-portrait']

    // ── Load Organization Profile (logo + appName) ──
    // Used in the print header to show the org's logo image (if uploaded)
    // instead of the default orange circle placeholder.
    let orgProfile: { appName?: string; logoUrl?: string | null } | null = null
    try {
      const orgSetting = await db.appSetting.findFirst({
        where: { key: 'orgProfile' },
      })
      if (orgSetting?.value) {
        orgProfile = JSON.parse(orgSetting.value)
      }
    } catch {
      // Ignore — use defaults
    }
    const orgName = orgProfile?.appName || 'ระบบจัดการสินทรัพย์'
    const orgLogo = orgProfile?.logoUrl || ''
    const logoIsImage = orgLogo && (orgLogo.startsWith('http') || orgLogo.startsWith('data:image/'))
    const logoHtml = logoIsImage
      ? `<img src="${esc(orgLogo)}" alt="${esc(orgName)}" style="width:56px;height:56px;object-fit:contain;border-radius:8px;" />`
      : orgLogo
        ? `<div class="logo">${esc(orgLogo)}</div>` // emoji logo
        : `<div class="logo">${esc(orgName.charAt(0))}</div>` // first letter fallback

    // Re-fetch the WO with the full include set required for HTML
    // rendering. `loadAuthorizedWorkOrder` returned the WO with only
    // the device.id/site/assetCode/name fields selected; the print
    // template also needs brand/model/serialNumber.
    const wo = await db.workOrder.findUnique({
      where: { id: result.wo.id },
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
          },
        },
      },
    })

    if (!wo) {
      return new NextResponse('<h1>ไม่พบใบงาน</h1>', {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

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
        approvalStatus: true,
        remark: true,
        txnDate: true,
        stockItem: {
          select: { productName: true, productCode: true, unit: true },
        },
      },
    })

    const external = parseExternalMeta(wo.externalMeta)
    const woNumber = wo.woNumber ?? '—'
    const today = new Date()
    const todayLabel = today.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

    // Build images
    const imgBefore =
      wo.picBefore &&
      (wo.picBefore.startsWith('http') || wo.picBefore.startsWith('data:'))
        ? wo.picBefore
        : null
    const imgOnsite =
      wo.picOnsite &&
      (wo.picOnsite.startsWith('http') || wo.picOnsite.startsWith('data:'))
        ? wo.picOnsite
        : null
    const imgAfter =
      wo.picAfter &&
      (wo.picAfter.startsWith('http') || wo.picAfter.startsWith('data:'))
        ? wo.picAfter
        : null

    const hasImages = Boolean(imgBefore || imgOnsite || imgAfter)

    // === Build HTML ===
    const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ใบแจ้งซ่อม ${esc(woNumber)}</title>
  <style>
    @page {
      size: ${paper.size};
      margin: 12mm;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      font-family: 'Segoe UI', 'Thonburi', 'Tahoma', sans-serif;
      color: #1e293b;
      background: #f1f5f9;
    }
    body {
      padding: 16px;
      display: flex;
      justify-content: center;
    }
    .page {
      background: #ffffff;
      width: 100%;
      max-width: ${paper.maxWidth};
      padding: 18mm 14mm;
      box-shadow: 0 4px 18px rgba(0,0,0,0.08);
      border-radius: 4px;
    }
    /* A5 is smaller — tighten typography */
    .a5 .page { padding: 12mm 10mm; font-size: 12px; }
    .a5 h1 { font-size: 18px; }
    .a5 h2 { font-size: 13px; }
    .a5 .info-grid { grid-template-columns: 1fr; }
    .a5 .signatures { grid-template-columns: 1fr; }

    h1, h2, h3, h4 { color: #0f172a; margin: 0; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    h2 {
      font-size: 14px;
      color: #f97316;
      border-bottom: 2px solid #fed7aa;
      padding-bottom: 4px;
      margin: 14px 0 8px 0;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 10px;
      border-bottom: 2px solid #0f172a;
    }
    .header .logo {
      width: 56px;
      height: 56px;
      background: #f97316;
      color: white;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      font-weight: bold;
    }
    .header .title-block { flex: 1; text-align: center; }
    .header .title-block h1 { font-size: 22px; }
    .header .title-block .subtitle { font-size: 11px; color: #64748b; }
    .header .meta { text-align: right; font-size: 11px; color: #475569; }
    .header .meta .wo-num {
      font-family: 'Courier New', monospace;
      font-weight: bold;
      color: #0f172a;
      font-size: 13px;
    }

    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 16px;
      margin-top: 6px;
    }
    .info-row {
      display: flex;
      flex-direction: column;
      padding: 4px 0;
      border-bottom: 1px dotted #e2e8f0;
    }
    .info-row .label {
      font-size: 10px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .info-row .value {
      font-size: 13px;
      color: #0f172a;
      font-weight: 500;
    }
    .a5 .info-row .label { font-size: 9px; }
    .a5 .info-row .value { font-size: 12px; }

    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fde68a;
    }
    .priority-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
      background: #e2e8f0;
      color: #334155;
      border: 1px solid #cbd5e1;
    }

    .external-box {
      background: #f0fdfa;
      border: 1px solid #5eead4;
      border-radius: 6px;
      padding: 8px 10px;
      margin-top: 6px;
    }

    .device-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 10px;
      margin-top: 6px;
    }

    .resolution-box {
      background: #ecfdf5;
      border: 1px solid #6ee7b7;
      border-radius: 6px;
      padding: 8px 10px;
      margin-top: 6px;
    }
    .note-box {
      background: #fff7ed;
      border: 1px solid #fdba74;
      border-radius: 6px;
      padding: 8px 10px;
      margin-top: 6px;
    }
    .cancel-box {
      background: #fef2f2;
      border: 1px solid #fca5a5;
      border-radius: 6px;
      padding: 8px 10px;
      margin-top: 6px;
    }

    table.parts {
      width: 100%;
      border-collapse: collapse;
      margin-top: 6px;
      font-size: 12px;
    }
    .a5 table.parts { font-size: 11px; }
    table.parts th, table.parts td {
      border: 1px solid #e2e8f0;
      padding: 5px 7px;
      text-align: left;
    }
    table.parts th {
      background: #f1f5f9;
      font-weight: 600;
      font-size: 11px;
      color: #475569;
    }
    .parts-empty {
      text-align: center;
      font-size: 11px;
      color: #94a3b8;
      padding: 8px;
      border: 1px dashed #cbd5e1;
      border-radius: 4px;
    }

    .images-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      margin-top: 6px;
    }
    .a5 .images-grid { grid-template-columns: 1fr 1fr 1fr; gap: 4px; }
    .image-cell {
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 4px;
      text-align: center;
    }
    .image-cell .label {
      font-size: 10px;
      color: #64748b;
      margin-bottom: 2px;
    }
    .image-cell img {
      max-width: 100%;
      height: 120px;
      object-fit: cover;
      border-radius: 3px;
    }
    .a5 .image-cell img { height: 80px; }

    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 16px;
      margin-top: 24px;
      padding-top: 12px;
    }
    .sign-cell { text-align: center; }
    .sign-line {
      border-top: 1px solid #0f172a;
      margin-top: 40px;
      padding-top: 4px;
      font-size: 11px;
      color: #475569;
    }
    .sign-date {
      font-size: 10px;
      color: #94a3b8;
      margin-top: 2px;
    }

    .footer {
      margin-top: 18px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: #94a3b8;
    }

    .print-btn-bar {
      position: fixed;
      bottom: 16px;
      right: 16px;
      display: flex;
      gap: 8px;
      z-index: 99;
    }
    .print-btn-bar button {
      padding: 8px 14px;
      border-radius: 6px;
      border: none;
      background: #f97316;
      color: white;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }
    .print-btn-bar button.secondary {
      background: #64748b;
    }

    @media print {
      body { background: white; padding: 0; }
      .page {
        box-shadow: none;
        border-radius: 0;
        padding: 0;
        max-width: 100%;
      }
      .print-btn-bar { display: none !important; }
      h2 { page-break-after: avoid; break-after: avoid; }
      .info-grid, .device-box, .external-box, .resolution-box, .note-box,
      .cancel-box, .signatures, table.parts, .images-grid {
        page-break-inside: avoid;
        break-inside: avoid;
      }
    }

    /* ── Ticket / Thermal printer styles (80mm / 58mm) ── */
    body.ticket {
      padding: 4px;
    }
    body.ticket .page {
      padding: 4mm 2mm;
      font-size: 11px;
      line-height: 1.4;
    }
    body.ticket .header {
      flex-direction: column;
      gap: 4px;
      padding-bottom: 6px;
      margin-bottom: 6px;
      border-bottom: 1px dashed #94a3b8;
    }
    body.ticket .header .logo {
      display: none; /* hide circle logo — save ink on thermal */
    }
    body.ticket .header .title-block h1 {
      font-size: 16px;
      text-align: center;
    }
    body.ticket .header .subtitle {
      display: none;
    }
    body.ticket .header .meta {
      text-align: center;
      font-size: 10px;
    }
    body.ticket .header .meta .wo-num {
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 2px;
    }
    body.ticket h2 {
      font-size: 11px;
      margin: 6px 0 3px;
      padding-bottom: 2px;
      border-bottom: 1px dashed #cbd5e1;
    }
    body.ticket .info-row {
      flex-direction: row;
      gap: 4px;
      font-size: 10px;
      padding: 1px 0;
    }
    body.ticket .info-row .label {
      min-width: 60px;
      font-weight: 600;
    }
    body.ticket .device-box,
    body.ticket .external-box,
    body.ticket .resolution-box,
    body.ticket .note-box,
    body.ticket .cancel-box {
      padding: 4px;
      font-size: 10px;
    }
    body.ticket .signatures {
      flex-direction: column;
      gap: 8px;
      margin-top: 8px;
    }
    body.ticket .sign-line {
      padding-top: 4px;
    }
    body.ticket table.parts {
      font-size: 10px;
    }
    body.ticket table.parts th,
    body.ticket table.parts td {
      padding: 2px 4px;
    }
    body.ticket .images-grid {
      grid-template-columns: 1fr; /* stack images vertically on narrow paper */
    }
    body.ticket .images-grid img {
      max-width: 60mm;
    }
    body.ticket .print-btn-bar { display: none; }
    body.ticket .footer {
      font-size: 9px;
      margin-top: 6px;
      padding-top: 4px;
      border-top: 1px dashed #94a3b8;
      text-align: center;
    }
  </style>
</head>
<body class="${paperParam === 'a5-portrait' ? 'a5' : ''} ${paperParam === 'ticket-80' || paperParam === 'ticket-58' ? 'ticket' : ''}">
  <div class="page">
    <!-- Header -->
    <div class="header">
      ${logoHtml}
      <div class="title-block">
        <h1>${esc(orgName)}</h1>
        <div class="subtitle">ใบแจ้งซ่อม • Work Order Form</div>
      </div>
      <div class="meta">
        <div class="wo-num">${esc(woNumber)}</div>
        <div>วันที่แจ้ง: ${esc(formatThaiDateOnly(wo.createdAt, lang))}</div>
        <div>พิมพ์เมื่อ: ${esc(todayLabel)}</div>
      </div>
    </div>

    <!-- Info section -->
    <h2>ข้อมูลการแจ้ง</h2>
    <div class="info-grid">
      <div class="info-row">
        <span class="label">ผู้แจ้ง</span>
        <span class="value">${esc(wo.reporterName ?? '—')}</span>
      </div>
      <div class="info-row">
        <span class="label">เบอร์โทร</span>
        <span class="value">${esc(wo.tel ?? '—')}</span>
      </div>
      <div class="info-row">
        <span class="label">อาคาร / ฝ่าย</span>
        <span class="value">${esc(wo.building ?? '—')}</span>
      </div>
      <div class="info-row">
        <span class="label">สถานที่</span>
        <span class="value">${esc(wo.location ?? '—')}</span>
      </div>
      <div class="info-row">
        <span class="label">หัวข้อ</span>
        <span class="value">${esc(wo.subject)}</span>
      </div>
      <div class="info-row">
        <span class="label">ความเร่งด่วน</span>
        <span class="value">
          <span class="priority-badge">${esc(wo.priority)}</span>
        </span>
      </div>
      <div class="info-row">
        <span class="label">สถานะ</span>
        <span class="value">
          <span class="status-badge">${esc(statusLabel(wo.status))}</span>
        </span>
      </div>
      <div class="info-row">
        <span class="label">รหัสพนักงาน</span>
        <span class="value">${esc(wo.employeeCode ?? '—')}</span>
      </div>
    </div>

    ${
      wo.details
        ? `
    <h2>รายละเอียดปัญหา</h2>
    <div style="white-space: pre-wrap; font-size: 13px; padding: 6px 0;">${esc(wo.details)}</div>
    `
        : ''
    }

    ${
      external
        ? `
    <h2>ข้อมูลลูกค้าภายนอก</h2>
    <div class="external-box">
      <div class="info-grid">
        <div class="info-row">
          <span class="label">ลูกค้า</span>
          <span class="value">${esc(external.clientName ?? '—')}</span>
        </div>
        <div class="info-row">
          <span class="label">สถานที่</span>
          <span class="value">${esc(external.place ?? '—')}</span>
        </div>
        <div class="info-row">
          <span class="label">เบอร์ติดต่อ</span>
          <span class="value">${esc(external.contactPhone ?? '—')}</span>
        </div>
        <div class="info-row">
          <span class="label">S/N</span>
          <span class="value">${esc((external.serials ?? []).join(', ') || '—')}</span>
        </div>
      </div>
    </div>
    `
        : ''
    }

    ${
      wo.device
        ? `
    <h2>ข้อมูลอุปกรณ์</h2>
    <div class="device-box">
      <div class="info-grid">
        <div class="info-row">
          <span class="label">เลขทะเบียน</span>
          <span class="value" style="font-family: 'Courier New', monospace;">${esc(wo.device.assetCode)}</span>
        </div>
        <div class="info-row">
          <span class="label">ยี่ห้อ / รุ่น</span>
          <span class="value">${esc(wo.device.brand)} ${esc(wo.device.model)}</span>
        </div>
        <div class="info-row">
          <span class="label">Serial Number</span>
          <span class="value">${esc(wo.device.serialNumber ?? '—')}</span>
        </div>
        <div class="info-row">
          <span class="label">สาขา</span>
          <span class="value">${esc(wo.device.site)}</span>
        </div>
      </div>
    </div>
    `
        : ''
    }

    <!-- Assignment -->
    <h2>การมอบหมาย</h2>
    <div class="info-grid">
      <div class="info-row">
        <span class="label">มอบหมายให้</span>
        <span class="value">${esc(wo.assignedTo ?? '—')}</span>
      </div>
      <div class="info-row">
        <span class="label">มอบหมายโดย</span>
        <span class="value">${esc(wo.assignedBy ?? '—')}</span>
      </div>
      <div class="info-row">
        <span class="label">วันที่มอบหมาย</span>
        <span class="value">${esc(formatDate(wo.assignedAt, lang))}</span>
      </div>
      <div class="info-row">
        <span class="label">วันที่เสร็จ</span>
        <span class="value">${esc(formatDate(wo.workCompletedAt, lang))}</span>
      </div>
    </div>
    ${
      wo.assignmentNote
        ? `<div class="note-box"><strong>หมายเหตุการมอบหมาย:</strong> ${esc(wo.assignmentNote)}</div>`
        : ''
    }

    <!-- Work section -->
    <h2>ผลการแก้ไข</h2>
    ${
      wo.resolution
        ? `<div class="resolution-box"><strong>${esc(wo.resolutionGroup ?? '')}</strong> ${esc(wo.resolution)}</div>`
        : '<div class="parts-empty">ยังไม่ได้ระบุผลการแก้ไข</div>'
    }
    ${
      wo.detailsAdmin
        ? `<div class="note-box"><strong>หมายเหตุช่าง:</strong> ${esc(wo.detailsAdmin)}</div>`
        : ''
    }
    ${
      wo.status === 'CANCELLED' && wo.cancelReason
        ? `<div class="cancel-box"><strong>เหตุผลการยกเลิก:</strong> ${esc(wo.cancelReason)}</div>`
        : ''
    }

    <!-- Parts -->
    <h2>รายการเบิกอะไหล่ (${parts.length})</h2>
    ${
      parts.length === 0
        ? '<div class="parts-empty">ไม่มีรายการเบิกอะไหล่สำหรับใบงานนี้</div>'
        : `
      <table class="parts">
        <thead>
          <tr>
            <th>เลขที่</th>
            <th>รหัส</th>
            <th>รายการ</th>
            <th>จำนวน</th>
            <th>สถานะ</th>
            <th>วันที่</th>
          </tr>
        </thead>
        <tbody>
          ${parts
            .map(
              (p) => `
            <tr>
              <td style="font-family: monospace; font-size: 11px;">${esc(p.txnNumber ?? '—')}</td>
              <td style="font-family: monospace; font-size: 11px;">${esc(p.productCode ?? p.stockItem?.productCode ?? '—')}</td>
              <td>${esc(p.productName ?? p.stockItem?.productName ?? '—')}</td>
              <td style="text-align: right;">${esc(p.quantity)} ${esc(p.unit ?? '')}</td>
              <td>${esc(p.approvalStatus ?? 'APPROVED')}</td>
              <td style="font-size: 11px;">${esc(formatThaiDateOnly(p.txnDate, lang))}</td>
            </tr>
          `,
            )
            .join('')}
        </tbody>
      </table>
    `
    }

    <!-- Images -->
    ${
      hasImages
        ? `
      <h2>รูปภาพ</h2>
      <div class="images-grid">
        <div class="image-cell">
          <div class="label">ก่อน</div>
          ${imgBefore ? `<img src="${esc(imgBefore)}" alt="ก่อน" />` : '<div style="height:120px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px;">ไม่มีรูป</div>'}
        </div>
        <div class="image-cell">
          <div class="label">หน้างาน</div>
          ${imgOnsite ? `<img src="${esc(imgOnsite)}" alt="หน้างาน" />` : '<div style="height:120px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px;">ไม่มีรูป</div>'}
        </div>
        <div class="image-cell">
          <div class="label">หลัง</div>
          ${imgAfter ? `<img src="${esc(imgAfter)}" alt="หลัง" />` : '<div style="height:120px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px;">ไม่มีรูป</div>'}
        </div>
      </div>
    `
        : ''
    }

    <!-- Signatures -->
    <h2>ลายเซ็น</h2>
    <div class="signatures">
      <div class="sign-cell">
        <div class="sign-line">ผู้แจ้ง</div>
        <div class="sign-date">วันที่: ……………/……………/……………</div>
      </div>
      <div class="sign-cell">
        <div class="sign-line">ช่างผู้ซ่อม</div>
        <div class="sign-date">วันที่: ……………/……………/……………</div>
      </div>
      <div class="sign-cell">
        <div class="sign-line">ผู้อนุมัติ</div>
        <div class="sign-date">วันที่: ……………/……………/……………</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <span>เลขใบงาน: ${esc(woNumber)}</span>
      <span>พิมพ์เมื่อ ${esc(todayLabel)}</span>
    </div>
  </div>

  <div class="print-btn-bar">
    <button type="button" onclick="window.print()">🖨 พิมพ์</button>
    <button type="button" class="secondary" onclick="window.close()">ปิดหน้าต่าง</button>
  </div>
  <script>
    // Auto-open the print dialog after a short delay (lets images load)
    (function() {
      var imgs = document.querySelectorAll('img');
      var pending = imgs.length;
      function tryPrint() {
        // Only auto-trigger if this tab was opened programmatically
        if (window.opener) {
          setTimeout(function() { window.print(); }, 400);
        }
      }
      if (pending === 0) {
        tryPrint();
      } else {
        for (var i = 0; i < imgs.length; i++) {
          imgs[i].addEventListener('load', function() {
            pending--;
            if (pending === 0) tryPrint();
          });
          imgs[i].addEventListener('error', function() {
            pending--;
            if (pending === 0) tryPrint();
          });
        }
      }
    })();
  </script>
</body>
</html>`

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (err) {
    console.error('GET /api/work-orders/[id]/print', err)
    return new NextResponse(
      `<h1>เกิดข้อผิดพลาด</h1><p>${esc(process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Unknown error') : 'Internal server error')}</p>`,
      {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    )
  }
}
