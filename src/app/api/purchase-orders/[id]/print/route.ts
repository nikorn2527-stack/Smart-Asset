// ============================================================
// Purchase Order Print HTML API (Task ID: STOCK-DOCS)
// ============================================================
// GET /api/purchase-orders/[id]/print
//
// Returns a full, self-contained HTML page (text/html) ready to open
// in a new tab/window and print directly. The page contains:
//   • Header: "ใบสั่งซื้อ" + PO number + date
//   • Supplier info
//   • Items table (product code, name, qty ordered, qty received, unit price, total)
//   • Total value
//   • Signatures: ผู้สั่ง, ผู้อนุมัติ, ซัพพลายเออร์
//   • Print CSS with @page { size: A4 }
//   • Auto-triggers window.print() on load (only when opened via window.opener)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { getServerLang, type Lang } from '@/lib/server-i18n'

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

function formatThaiDate(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '—'
  try {
    return new Date(iso.length > 10 ? iso : iso + 'T00:00:00').toLocaleDateString(
      lang === 'th' ? 'th-TH' : 'en-GB',
      { day: '2-digit', month: '2-digit', year: 'numeric' },
    )
  } catch {
    return String(iso)
  }
}

function moneyNumber(value: number | { toNumber: () => number } | null | undefined): number {
  if (value == null) return 0
  return typeof value === 'number' ? value : value.toNumber()
}

function formatBaht(value: number | null | undefined, lang: Lang): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `฿${value.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

const STATUS_LABELS: Record<string, string> = {
  open: 'เปิดอยู่',
  partial: 'รับบางส่วน',
  received: 'รับครบแล้ว',
  cancelled: 'ยกเลิก',
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

  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  // P0 Security: require auth — PO print contains financial data (unitCost)
  // Support token via query param for programmatic print (e.g. window.open from staff UI)
  const auth = await requireAuth(req, 'VIEW_DASHBOARD')
  if (!auth.ok) {
    return new NextResponse(
      '<h1>กรุณาเข้าสู่ระบบ</h1><p>ต้องเข้าสู่ระบบเพื่อพิมพ์ใบสั่งซื้อ</p>',
      { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
  try {
    const { id } = await params

    const po = await db.purchaseOrder.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            stockItem: {
              select: {
                productCode: true,
                productName: true,
                unit: true,
                category: true,
                brand: true,
                model: true,
              },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    })

    if (!po) {
      return new NextResponse('<h1>ไม่พบใบสั่งซื้อ</h1>', {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    const poNumber = po.poNumber ?? '—'
    const today = new Date()
    const todayLabel = today.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

    // Compute totals
    const totalOrdered = po.items.reduce(
      (sum, it) => sum + (it.quantityOrdered ?? 0),
      0,
    )
    const totalReceived = po.items.reduce(
      (sum, it) => sum + (it.quantityReceived ?? 0),
      0,
    )
    const grandTotal =
      po.totalValue != null
        ? moneyNumber(po.totalValue)
        : po.items.reduce((sum, it) => sum + moneyNumber(it.totalValue), 0)

    // Build items table rows
    const itemRows = po.items
      .map(
        (it, idx) => {
          const code = it.stockItem?.productCode ?? '—'
          const name = it.stockItem?.productName ?? '—'
          const unit = it.stockItem?.unit ?? '—'
          const brandModel = [it.stockItem?.brand, it.stockItem?.model]
            .filter(Boolean)
            .join(' · ')
          return `
        <tr>
          <td style="text-align: center;">${idx + 1}</td>
          <td style="font-family: 'Courier New', monospace; font-size: 11px;">
            ${esc(code)}
          </td>
          <td>
            ${esc(name)}
            ${brandModel ? `<div style="font-size: 10px; color: #64748b;">${esc(brandModel)}</div>` : ''}
          </td>
          <td style="text-align: right; font-weight: 600;">${esc(it.quantityOrdered)}</td>
          <td style="text-align: right;">${esc(it.quantityReceived)}</td>
          <td style="text-align: center;">${esc(unit)}</td>
          <td style="text-align: right;">
            ${esc(it.unitPrice !== null ? formatBaht(moneyNumber(it.unitPrice), lang) : '—')}
          </td>
          <td style="text-align: right; font-weight: 600;">
            ${esc(it.totalValue !== null ? formatBaht(moneyNumber(it.totalValue), lang) : '—')}
          </td>
        </tr>
      `
        },
      )
      .join('')

    const statusBg =
      po.status === 'received'
        ? '#d1fae5'
        : po.status === 'partial'
          ? '#fef3c7'
          : po.status === 'cancelled'
            ? '#fee2e2'
            : '#e0e7ff'
    const statusColor =
      po.status === 'received'
        ? '#065f46'
        : po.status === 'partial'
          ? '#92400e'
          : po.status === 'cancelled'
            ? '#991b1b'
            : '#3730a3'

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ใบสั่งซื้อ ${esc(poNumber)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 14mm;
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
      max-width: 190mm;
      padding: 16mm 14mm;
      box-shadow: 0 4px 18px rgba(0,0,0,0.08);
      border-radius: 4px;
    }

    h1, h2, h3, h4 { color: #0f172a; margin: 0; }
    h1 { font-size: 26px; margin-bottom: 4px; }
    h2 {
      font-size: 14px;
      color: #0d9488;
      border-bottom: 2px solid #5eead4;
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
      width: 60px;
      height: 60px;
      background: #0d9488;
      color: white;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      font-weight: bold;
    }
    .header .title-block { flex: 1; text-align: center; }
    .header .title-block h1 { font-size: 26px; }
    .header .title-block .subtitle { font-size: 11px; color: #64748b; }
    .header .meta { text-align: right; font-size: 11px; color: #475569; }
    .header .meta .doc-num {
      font-family: 'Courier New', monospace;
      font-weight: bold;
      color: #0f172a;
      font-size: 14px;
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

    .status-badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      background: ${statusBg};
      color: ${statusColor};
    }

    .supplier-box {
      background: #f0fdfa;
      border: 1px solid #5eead4;
      border-radius: 6px;
      padding: 8px 10px;
      margin-top: 6px;
    }

    table.items {
      width: 100%;
      border-collapse: collapse;
      margin-top: 6px;
      font-size: 12px;
    }
    table.items th, table.items td {
      border: 1px solid #e2e8f0;
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }
    table.items th {
      background: #f1f5f9;
      font-weight: 600;
      font-size: 11px;
      color: #475569;
    }
    table.items tfoot td {
      background: #f8fafc;
      font-weight: 600;
      border-top: 2px solid #0f172a;
    }

    .total-summary {
      margin-top: 8px;
      margin-left: auto;
      width: 280px;
      font-size: 13px;
    }
    .total-summary .row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      border-bottom: 1px dotted #e2e8f0;
    }
    .total-summary .row.grand {
      font-weight: 700;
      font-size: 15px;
      color: #0d9488;
      border-bottom: 2px solid #0d9488;
      padding-top: 8px;
    }

    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 16px;
      margin-top: 32px;
      padding-top: 12px;
    }
    .sign-cell { text-align: center; }
    .sign-line {
      border-top: 1px solid #0f172a;
      margin-top: 44px;
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
      background: #0d9488;
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
      .info-grid, .signatures, table.items, .supplier-box, .total-summary { page-break-inside: avoid; break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="page">
    <!-- Header -->
    <div class="header">
      <div class="logo">PO</div>
      <div class="title-block">
        <h1>ใบสั่งซื้อ</h1>
        <div class="subtitle">Purchase Order • ระบบจัดการสินค้าคงคลัง</div>
      </div>
      <div class="meta">
        <div class="doc-num">${esc(poNumber)}</div>
        <div>วันที่สั่งซื้อ: ${esc(formatThaiDate(po.orderDate, lang))}</div>
        <div>พิมพ์เมื่อ: ${esc(todayLabel)}</div>
      </div>
    </div>

    <!-- Status badge -->
    <div style="margin-top: 10px; display: flex; gap: 8px; align-items: center;">
      <span class="status-badge">สถานะ: ${esc(statusLabel(po.status))}</span>
      <span style="font-size: 11px; color: #64748b;">จำนวนรายการ: ${esc(po.items.length)} รายการ</span>
    </div>

    <!-- Supplier info -->
    <h2>ข้อมูลผู้จัดจำหน่าย</h2>
    <div class="supplier-box">
      <div class="info-grid">
        <div class="info-row">
          <span class="label">ชื่อผู้จัดจำหน่าย</span>
          <span class="value" style="font-size: 14px; font-weight: 600;">${esc(po.supplier ?? '—')}</span>
        </div>
        <div class="info-row">
          <span class="label">เลขที่ใบสั่งซื้อ</span>
          <span class="value" style="font-family: 'Courier New', monospace;">${esc(poNumber)}</span>
        </div>
        <div class="info-row">
          <span class="label">วันที่สั่งซื้อ</span>
          <span class="value">${esc(formatThaiDate(po.orderDate, lang))}</span>
        </div>
        <div class="info-row">
          <span class="label">ผู้สั่งซื้อ</span>
          <span class="value">${esc(po.createdBy ?? '—')}</span>
        </div>
      </div>
      ${
        po.remark
          ? `<div class="info-row" style="margin-top: 6px; border-bottom: none;">
              <span class="label">หมายเหตุ</span>
              <span class="value">${esc(po.remark)}</span>
            </div>`
          : ''
      }
    </div>

    <!-- Items table -->
    <h2>รายการสินค้าที่สั่งซื้อ (${po.items.length} รายการ)</h2>
    <table class="items">
      <thead>
        <tr>
          <th style="width: 28px;">#</th>
          <th style="width: 100px;">รหัสสินค้า</th>
          <th>รายการ</th>
          <th style="width: 60px; text-align: right;">สั่งซื้อ</th>
          <th style="width: 60px; text-align: right;">รับแล้ว</th>
          <th style="width: 50px;">หน่วย</th>
          <th style="width: 90px; text-align: right;">ราคา/หน่วย</th>
          <th style="width: 100px; text-align: right;">มูลค่ารวม</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="text-align: right;">รวมทั้งสิ้น</td>
          <td style="text-align: right;">${esc(totalOrdered)}</td>
          <td style="text-align: right;">${esc(totalReceived)}</td>
          <td colspan="2"></td>
          <td style="text-align: right;">${esc(formatBaht(grandTotal, lang))}</td>
        </tr>
      </tfoot>
    </table>

    <!-- Total summary -->
    <div class="total-summary">
      <div class="row">
        <span>จำนวนรายการสั่งซื้อ:</span>
        <span>${esc(po.items.length)} รายการ</span>
      </div>
      <div class="row">
        <span>จำนวนที่สั่งซื้อรวม:</span>
        <span>${esc(totalOrdered)} หน่วย</span>
      </div>
      <div class="row">
        <span>จำนวนที่รับแล้วรวม:</span>
        <span>${esc(totalReceived)} หน่วย</span>
      </div>
      <div class="row grand">
        <span>มูลค่ารวมทั้งสิ้น:</span>
        <span>${esc(formatBaht(grandTotal, lang))}</span>
      </div>
    </div>

    <!-- Signatures -->
    <h2>ลายเซ็น</h2>
    <div class="signatures">
      <div class="sign-cell">
        <div class="sign-line">ผู้สั่งซื้อ</div>
        <div class="sign-date">วันที่: ………/………/………</div>
      </div>
      <div class="sign-cell">
        <div class="sign-line">ผู้อนุมัติ</div>
        <div class="sign-date">วันที่: ………/………/………</div>
      </div>
      <div class="sign-cell">
        <div class="sign-line">ซัพพลายเออร์ (ผู้รับสั่งซื้อ)</div>
        <div class="sign-date">วันที่: ………/………/………</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <span>เลขที่ใบสั่งซื้อ: ${esc(poNumber)} • ผู้จัดจำหน่าย: ${esc(po.supplier ?? '—')}</span>
      <span>พิมพ์เมื่อ ${esc(todayLabel)}</span>
    </div>
  </div>

  <div class="print-btn-bar">
    <button type="button" onclick="window.print()">🖨 พิมพ์</button>
    <button type="button" class="secondary" onclick="window.close()">ปิดหน้าต่าง</button>
  </div>
  <script>
    // Auto-open the print dialog after a short delay (only when opened programmatically)
    (function() {
      function tryPrint() {
        if (window.opener) {
          setTimeout(function() { window.print(); }, 400);
        }
      }
      tryPrint();
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
    console.error('GET /api/purchase-orders/[id]/print', err)
    return new NextResponse(
      `<h1>เกิดข้อผิดพลาด</h1><p>${esc(process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Unknown error') : 'Internal server error')}</p>`,
      {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    )
  }
}
