import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { loadAuthorizedWorkOrder } from '@/lib/wo-authz'
import QRCode from 'qrcode'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { getServerLang, type Lang } from '@/lib/server-i18n'

// ============================================================
// Print Job Sheet (Feature 6)
//   GET /api/work-orders/[id]/print-sheet
//
// Returns a self-contained HTML page (text/html) for a printable
// "job sheet" / "ใบงานช่าง" — a compact one-page summary that a
// technician can carry to site. Contains:
//   • Logo + WO number + status badge
//   • QR code linking to the public scan-to-view URL
//   • Reporter / location / subject / priority / details
//   • External info (if externalMeta present)
//   • Device info (if linked)
//   • Before / Onsite / After images (compact thumbnails)
//   • Resolution + admin note
//   • Tech signature line + reporter signature line + date
//
// The page auto-opens window.print() when opened via window.open().
// ============================================================

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
function formatThaiDateTime(iso: Date | string | null | undefined, lang: Lang): string {
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

const STATUS_BADGE_STYLES: Record<string, string> = {
  PENDING: 'background:#fef3c7;color:#92400e;border:1px solid #fde68a;',
  IN_PROGRESS: 'background:#dbeafe;color:#1e40af;border:1px solid #bfdbfe;',
  WAITING_PARTS: 'background:#ede9fe;color:#5b21b6;border:1px solid #ddd6fe;',
  COMPLETED: 'background:#d1fae5;color:#065f46;border:1px solid #a7f3d0;',
  CANCELLED: 'background:#fee2e2;color:#991b1b;border:1px solid #fecaca;',
}

function statusBadge(status: string): string {
  const label = STATUS_LABELS[status] ?? status
  const style = STATUS_BADGE_STYLES[status] ?? ''
  return `<span class="status-badge" style="${style}">${esc(label)}</span>`
}

function imgCell(label: string, src: string | null): string {
  if (src && (src.startsWith('http') || src.startsWith('data:'))) {
    return `
      <div class="img-cell">
        <div class="img-label">${esc(label)}</div>
        <img src="${esc(src)}" alt="${esc(label)}" />
      </div>`
  }
  return `
    <div class="img-cell">
      <div class="img-label">${esc(label)}</div>
      <div class="img-placeholder">ไม่มีรูป</div>
    </div>`
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
    const { searchParams } = new URL(req.url)
    // Optional: override the public base URL (defaults to current origin).
    const publicBaseUrl = searchParams.get('baseUrl')?.trim() || ''

    // Authenticate + authorize — printing a job sheet requires WO_VIEW_ALL
    // (allowOwn so the original reporter can print their own WO sheet).
    const authz = await loadAuthorizedWorkOrder(req, id, 'WO_VIEW_ALL', {
      allowOwn: true,
    })
    if (!authz.ok) {
      // For an HTML endpoint we return a small HTML error page so the
      // browser renders something sensible instead of a JSON blob.
      return new NextResponse(
        `<h1>${esc(authz.error)}</h1>`,
        {
          status: authz.status,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        },
      )
    }

    const wo = await db.workOrder.findUnique({
      where: { id: authz.wo.id },
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
            building: true,
            location: true,
          },
        },
        images: {
          // Pick the first image per stage (compact one-pager).
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!wo) {
      return new NextResponse('<h1>ไม่พบใบงาน</h1>', {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    // Generate the QR code as a data URL pointing to the public WO view.
    const publicPath = `/api/public/work-orders/${wo.id}`
    const qrTarget = publicBaseUrl
      ? `${publicBaseUrl.replace(/\/$/, '')}${publicPath}`
      : publicPath
    let qrDataUrl = ''
    try {
      qrDataUrl = await QRCode.toDataURL(qrTarget, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 220,
        color: { dark: '#0f172a', light: '#ffffff' },
      })
    } catch (err) {
      console.error('QRCode generation failed:', err)
    }

    const external = parseExternalMeta(wo.externalMeta)
    const woNumber = wo.woNumber ?? '—'

    // Pick first image per stage
    const firstByStage = (stage: string) =>
      wo.images.find((im) => im.stage === stage && im.image_data) ?? null
    const beforeImg = firstByStage('before')
    const onsiteImg = firstByStage('onsite')
    const afterImg = firstByStage('after')

    // Also fall back to legacy picBefore/picOnsite/picAfter single-image fields
    const imgBefore = beforeImg?.image_data ?? wo.picBefore ?? null
    const imgOnsite = onsiteImg?.image_data ?? wo.picOnsite ?? null
    const imgAfter = afterImg?.image_data ?? wo.picAfter ?? null

    const todayLabel = formatThaiDateTime(new Date().toISOString(), lang)

    // === Build HTML ===
    const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ใบงานช่าง ${esc(woNumber)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      font-family: 'Segoe UI', 'Thonburi', 'Tahoma', sans-serif;
      color: #1e293b; background: #f1f5f9;
    }
    body { padding: 14px; display: flex; justify-content: center; }
    .sheet {
      background: #fff;
      width: 100%;
      max-width: 190mm;
      padding: 14mm 12mm;
      border-radius: 6px;
      box-shadow: 0 4px 18px rgba(0,0,0,0.08);
    }
    .header {
      display: flex; align-items: flex-start; gap: 14px;
      padding-bottom: 10px; border-bottom: 2px solid #0f172a;
    }
    .logo {
      width: 50px; height: 50px;
      background: #f97316; color: #fff;
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 24px; font-weight: 700;
    }
    .header .title-block { flex: 1; }
    .header h1 { margin: 0; font-size: 20px; color: #0f172a; }
    .header .subtitle { font-size: 11px; color: #64748b; }
    .header .meta {
      text-align: right; font-size: 11px; color: #475569;
    }
    .header .meta .wo-num {
      font-family: 'Courier New', monospace;
      font-weight: 700; color: #0f172a; font-size: 13px;
    }
    .header .qr {
      width: 90px; height: 90px;
      border: 1px solid #e2e8f0; border-radius: 6px;
      padding: 4px; background: #fff;
    }
    .header .qr img { width: 100%; height: 100%; }
    .header .qr-cap {
      font-size: 9px; color: #64748b; text-align: center;
      margin-top: 2px;
    }

    .status-badge {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 11px;
      font-size: 11px;
      font-weight: 600;
    }
    .priority-badge {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 11px;
      font-size: 11px;
      font-weight: 600;
      background: #e2e8f0; color: #334155;
      border: 1px solid #cbd5e1;
    }

    .section { margin-top: 10px; }
    .section h2 {
      font-size: 12px;
      color: #f97316;
      border-bottom: 1.5px solid #fed7aa;
      padding-bottom: 3px;
      margin: 0 0 5px 0;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 14px;
    }
    .info-row {
      display: flex; flex-direction: column;
      padding: 3px 0;
      border-bottom: 1px dotted #e2e8f0;
    }
    .info-row .label {
      font-size: 9px; color: #64748b;
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .info-row .value {
      font-size: 12px; color: #0f172a; font-weight: 500;
    }

    .box {
      border-radius: 5px;
      padding: 7px 9px;
      margin-top: 5px;
      font-size: 11px;
    }
    .box.device { background: #f8fafc; border: 1px solid #e2e8f0; }
    .box.external { background: #f0fdfa; border: 1px solid #5eead4; }
    .box.resolution { background: #ecfdf5; border: 1px solid #6ee7b7; }
    .box.note { background: #fff7ed; border: 1px solid #fdba74; }
    .box.cancel { background: #fef2f2; border: 1px solid #fca5a5; }

    .images-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 5px;
      margin-top: 5px;
    }
    .img-cell {
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 3px;
      text-align: center;
    }
    .img-cell .img-label {
      font-size: 9px; color: #64748b;
      margin-bottom: 2px;
    }
    .img-cell img {
      max-width: 100%; height: 95px;
      object-fit: cover; border-radius: 3px;
    }
    .img-placeholder {
      height: 95px;
      display: flex; align-items: center; justify-content: center;
      color: #94a3b8; font-size: 11px;
      background: #f8fafc; border-radius: 3px;
    }

    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 14px;
      margin-top: 22px;
      padding-top: 10px;
    }
    .sign-cell { text-align: center; }
    .sign-line {
      border-top: 1px solid #0f172a;
      margin-top: 36px;
      padding-top: 3px;
      font-size: 11px; color: #475569;
    }
    .sign-date { font-size: 10px; color: #94a3b8; margin-top: 2px; }

    .footer {
      margin-top: 14px;
      padding-top: 6px;
      border-top: 1px solid #e2e8f0;
      display: flex; justify-content: space-between;
      font-size: 9px; color: #94a3b8;
    }

    .print-btn-bar {
      position: fixed; bottom: 14px; right: 14px;
      display: flex; gap: 7px; z-index: 99;
    }
    .print-btn-bar button {
      padding: 8px 14px;
      border-radius: 6px; border: none;
      background: #f97316; color: #fff;
      font-size: 13px; font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }
    .print-btn-bar button.secondary { background: #64748b; }

    @media print {
      body { background: #fff; padding: 0; }
      .sheet { box-shadow: none; border-radius: 0; padding: 0; max-width: 100%; }
      .print-btn-bar { display: none !important; }
      .section, .signatures, .images-grid { page-break-inside: avoid; }
      h2 { page-break-after: avoid; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <!-- Header -->
    <div class="header">
      <div class="logo">ซ</div>
      <div class="title-block">
        <h1>ใบงานช่าง</h1>
        <div class="subtitle">Job Sheet • ระบบจัดการสินทรัพย์</div>
      </div>
      <div class="meta">
        <div class="wo-num">${esc(woNumber)}</div>
        <div>แจ้ง: ${esc(formatThaiDateOnly(wo.createdAt, lang))}</div>
        <div>พิมพ์: ${esc(todayLabel)}</div>
        ${statusBadge(wo.status)}
      </div>
      <div>
        ${qrDataUrl ? `<div class="qr"><img src="${esc(qrDataUrl)}" alt="QR" /></div>` : ''}
        <div class="qr-cap">สแกนดูสถานะ</div>
      </div>
    </div>

    <!-- Reporter / Location -->
    <div class="section">
      <h2>ข้อมูลการแจ้ง</h2>
      <div class="info-grid">
        <div class="info-row">
          <span class="label">หัวข้อ</span>
          <span class="value">${esc(wo.subject)}</span>
        </div>
        <div class="info-row">
          <span class="label">ความเร่งด่วน</span>
          <span class="value"><span class="priority-badge">${esc(wo.priority)}</span></span>
        </div>
        <div class="info-row">
          <span class="label">อาคาร / ฝ่าย</span>
          <span class="value">${esc(wo.building ?? '—')}</span>
        </div>
        <div class="info-row">
          <span class="label">ตำแหน่ง / ห้อง</span>
          <span class="value">${esc(wo.location ?? '—')}</span>
        </div>
        <div class="info-row">
          <span class="label">ผู้แจ้ง</span>
          <span class="value">${esc(wo.reporterName ?? '—')}</span>
        </div>
        <div class="info-row">
          <span class="label">เบอร์ติดต่อ</span>
          <span class="value">${esc(wo.tel ?? '—')}</span>
        </div>
      </div>
    </div>

    ${
      wo.details
        ? `<div class="section">
      <h2>รายละเอียดปัญหา</h2>
      <div style="white-space: pre-wrap; font-size: 12px; padding: 4px 0;">${esc(wo.details)}</div>
    </div>`
        : ''
    }

    ${
      external
        ? `<div class="section">
      <h2>ข้อมูลลูกค้าภายนอก</h2>
      <div class="box external">
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
    </div>`
        : ''
    }

    ${
      wo.device
        ? `<div class="section">
      <h2>อุปกรณ์</h2>
      <div class="box device">
        <div class="info-grid">
          <div class="info-row">
            <span class="label">เลขทะเบียน</span>
            <span class="value" style="font-family: 'Courier New', monospace;">${esc(wo.device.assetCode)}</span>
          </div>
          <div class="info-row">
            <span class="label">ชื่ออุปกรณ์</span>
            <span class="value">${esc(wo.device.name)}</span>
          </div>
          <div class="info-row">
            <span class="label">ยี่ห้อ / รุ่น</span>
            <span class="value">${esc(wo.device.brand)} ${esc(wo.device.model)}</span>
          </div>
          <div class="info-row">
            <span class="label">Serial Number</span>
            <span class="value">${esc(wo.device.serialNumber ?? '—')}</span>
          </div>
        </div>
      </div>
    </div>`
        : ''
    }

    <!-- Assignment -->
    <div class="section">
      <h2>การมอบหมาย</h2>
      <div class="info-grid">
        <div class="info-row">
          <span class="label">มอบหมายให้</span>
          <span class="value">${esc(wo.assignedTo ?? '—')}</span>
        </div>
        <div class="info-row">
          <span class="label">วันที่มอบหมาย</span>
          <span class="value">${esc(formatThaiDateTime(wo.assignedAt, lang))}</span>
        </div>
      </div>
    </div>

    <!-- Images -->
    <div class="section">
      <h2>รูปภาพ (ก่อน / หน้างาน / หลัง)</h2>
      <div class="images-grid">
        ${imgCell('ก่อน', imgBefore)}
        ${imgCell('หน้างาน', imgOnsite)}
        ${imgCell('หลัง', imgAfter)}
      </div>
    </div>

    <!-- Resolution / Notes -->
    <div class="section">
      <h2>ผลการแก้ไข / หมายเหตุช่าง</h2>
      ${
        wo.resolution
          ? `<div class="box resolution">
              <strong>${esc(wo.resolutionGroup ?? '')}</strong> ${esc(wo.resolution)}
            </div>`
          : '<div class="box note">ยังไม่ได้ระบุผลการแก้ไข</div>'
      }
      ${
        wo.detailsAdmin
          ? `<div class="box note"><strong>หมายเหตุช่าง:</strong> ${esc(wo.detailsAdmin)}</div>`
          : ''
      }
      ${
        wo.status === 'CANCELLED' && wo.cancelReason
          ? `<div class="box cancel"><strong>เหตุผลการยกเลิก:</strong> ${esc(wo.cancelReason)}</div>`
          : ''
      }
    </div>

    <!-- Signatures -->
    <div class="section">
      <h2>ลายเซ็น</h2>
      <div class="signatures">
        <div class="sign-cell">
          <div class="sign-line">ผู้แจ้ง</div>
          <div class="sign-date">วันที่: ………/………/………</div>
        </div>
        <div class="sign-cell">
          <div class="sign-line">ช่างผู้ซ่อม</div>
          <div class="sign-date">วันที่: ………/………/………</div>
        </div>
        <div class="sign-cell">
          <div class="sign-line">ผู้ตรวจรับ</div>
          <div class="sign-date">วันที่: ………/………/………</div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <span>เลขใบงาน: ${esc(woNumber)}</span>
      <span>QR → /api/public/work-orders/${esc(wo.id)}</span>
      <span>พิมพ์เมื่อ ${esc(todayLabel)}</span>
    </div>
  </div>

  <div class="print-btn-bar">
    <button type="button" onclick="window.print()">🖨 พิมพ์</button>
    <button type="button" class="secondary" onclick="window.close()">ปิด</button>
  </div>
  <script>
    (function() {
      function tryPrint() {
        // Do NOT auto-print — show preview first, user clicks the print button
      }
      var imgs = document.querySelectorAll('img');
      var pending = imgs.length;
      if (pending === 0) { tryPrint(); return; }
      for (var i = 0; i < imgs.length; i++) {
        if (imgs[i].complete) {
          pending--;
          if (pending === 0) tryPrint();
        } else {
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
    console.error('GET /api/work-orders/[id]/print-sheet', err)
    return new NextResponse(
      `<h1>เกิดข้อผิดพลาด</h1><p>${esc(process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Unknown error') : 'Internal server error')}</p>`,
      {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    )
  }
}
