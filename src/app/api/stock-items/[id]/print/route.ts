// ============================================================
// Stock Transaction Print HTML API (Task ID: STOCK-DOCS)
// ============================================================
// GET /api/stock-items/[id]/print?txnId=<transactionId>&type=in|out
//
// Returns a full, self-contained HTML page (text/html) ready to open
// in a new tab/window and print directly. The page contains:
//   • Header: "ใบรับสินค้า" or "ใบเบิกสินค้า" + txn number + date
//   • Info section: product code, product name, qty, unit, unit cost, total
//   • For IN: supplier (vendor), receiver, PO number
//   • For OUT: requester, department, purpose, approver
//   • Items table (groups transactions with same txnNumber for multi-item)
//   • Signatures
//   • Print CSS with @page { size: A4 }
//   • Auto-triggers window.print() on load (only when opened via window.opener)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
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

function formatThaiDateTime(iso: string | null | undefined, lang: Lang): string {
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

function formatBaht(value: number | null | undefined, lang: Lang): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `฿${value.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // I18N-04: resolve the caller's language server-side.
  const lang = getServerLang(req)

  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'STOCK_VIEW')
  if (!auth.ok) {
    return new NextResponse(
      `<h1>401 — กรุณาเข้าสู่ระบบ</h1>`,
      {
        status: auth.status,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    )
  }
  try {
    const { id: stockItemId } = await params
    const { searchParams } = new URL(req.url)
    const txnId = searchParams.get('txnId')?.trim() ?? ''
    const typeHint = (searchParams.get('type')?.trim() || '').toLowerCase()

    if (!txnId) {
      return new NextResponse(
        '<h1>ไม่พบ transaction</h1><p>กรุณาระบุ txnId ใน query string</p>',
        {
          status: 400,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        },
      )
    }

    // Fetch the primary transaction
    const txn = await db.stockTransaction.findUnique({
      where: { id: txnId },
      include: {
        stockItem: {
          select: {
            id: true,
            productCode: true,
            productName: true,
            unit: true,
            unitCost: true,
            category: true,
            brand: true,
            model: true,
            location: true,
          },
        },
      },
    })

    if (!txn) {
      return new NextResponse('<h1>ไม่พบรายการที่ต้องการพิมพ์</h1>', {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    // Sanity: ensure the transaction belongs to the stock item in the URL.
    // (If mismatched, we still allow printing since txnId is the source of truth,
    //  but log it for debugging.)
    if (txn.stockItemId !== stockItemId) {
      console.warn(
        `[stock-items/[id]/print] txn.stockItemId (${txn.stockItemId}) != URL id (${stockItemId}). Printing anyway.`,
      )
    }

    // Determine type: prefer URL hint, otherwise derive from record
    const isOut =
      typeHint === 'out' || (!typeHint && txn.type === 'OUT')
    const isAdjust = !typeHint && txn.type === 'ADJUST'
    const docType: 'IN' | 'OUT' | 'ADJUST' = isOut
      ? 'OUT'
      : isAdjust
        ? 'ADJUST'
        : 'IN'

    // Multi-item support: group all transactions with the same txnNumber
    // (excluding the primary txn which we already have). If txnNumber is null,
    // we just show the single transaction.
    let lineItems: typeof txn[] = [txn]
    if (txn.txnNumber) {
      const related = await db.stockTransaction.findMany({
        where: {
          txnNumber: txn.txnNumber,
          id: { not: txn.id },
          type: txn.type,
        },
        include: {
          stockItem: {
            select: {
              id: true,
              productCode: true,
              productName: true,
              unit: true,
              unitCost: true,
              category: true,
              brand: true,
              model: true,
              location: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      })
      lineItems = [txn, ...related]
    }

    const docTitle =
      docType === 'IN'
        ? 'ใบรับสินค้า'
        : docType === 'OUT'
          ? 'ใบเบิกสินค้า'
          : 'ใบปรับปรุงสต็อก'
    const docSubtitle =
      docType === 'IN'
        ? 'Stock Receipt Form'
        : docType === 'OUT'
          ? 'Stock Issue Form'
          : 'Stock Adjustment Form'

    const txnNumber = txn.txnNumber ?? '—'
    const today = new Date()
    const todayLabel = today.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

    // Compute grand total. `StockTransaction.cost` is a Prisma `Decimal`, so each
    // value must be coerced with Number() before summing — mixing DecimalJs
    // instances into a `number` accumulator silently produces garbage (or a
    // TypeError at runtime).
    const grandTotal = lineItems.reduce(
      (sum, t) => sum + Number(t.cost ?? 0),
      0,
    )

    // Build items table rows
    const itemRows = lineItems
      .map(
        (t, idx) => `
      <tr>
        <td style="text-align: center;">${idx + 1}</td>
        <td style="font-family: 'Courier New', monospace; font-size: 11px;">
          ${esc(t.productCode ?? t.stockItem?.productCode ?? '—')}
        </td>
        <td>
          ${esc(t.productName ?? t.stockItem?.productName ?? '—')}
          ${
            t.stockItem?.brand || t.stockItem?.model
              ? `<div style="font-size: 10px; color: #64748b;">${esc([t.stockItem?.brand, t.stockItem?.model].filter(Boolean).join(' · ') || '')}</div>`
              : ''
          }
        </td>
        <td style="text-align: right; font-weight: 600;">
          ${esc(t.quantity)}
        </td>
        <td style="text-align: center;">${esc(t.unit ?? t.stockItem?.unit ?? '—')}</td>
        <td style="text-align: right;">
          ${esc(t.unitCost !== null ? formatBaht(Number(t.unitCost), lang) : '—')}
        </td>
        <td style="text-align: right; font-weight: 600;">
          ${esc(t.cost !== null ? formatBaht(Number(t.cost), lang) : '—')}
        </td>
      </tr>
    `,
      )
      .join('')

    // Info section differs by type
    const infoSectionIn = `
      <div class="info-row">
        <span class="label">ผู้จัดจำหน่าย</span>
        <span class="value">${esc(txn.vendor ?? '—')}</span>
      </div>
      <div class="info-row">
        <span class="label">ผู้รับสินค้า</span>
        <span class="value">${esc(txn.receiver ?? txn.performedBy ?? '—')}</span>
      </div>
      <div class="info-row">
        <span class="label">เลขที่ใบสั่งซื้อ</span>
        <span class="value" style="font-family: 'Courier New', monospace;">
          ${esc(txn.purchaseOrderNo ?? '—')}
        </span>
      </div>
      <div class="info-row">
        <span class="label">คงเหลือหลังรับ</span>
        <span class="value">${esc(txn.balanceAfter)} ${esc(txn.unit ?? txn.stockItem?.unit ?? '')}</span>
      </div>
    `

    const infoSectionOut = `
      <div class="info-row">
        <span class="label">ผู้เบิก</span>
        <span class="value">${esc(txn.requester ?? txn.performedBy ?? '—')}</span>
      </div>
      <div class="info-row">
        <span class="label">แผนก</span>
        <span class="value">${esc(txn.department ?? '—')}</span>
      </div>
      <div class="info-row">
        <span class="label">วัตถุประสงค์</span>
        <span class="value">${esc(txn.purpose ?? txn.reason ?? '—')}</span>
      </div>
      <div class="info-row">
        <span class="label">ผู้อนุมัติ</span>
        <span class="value">${esc(txn.approver ?? '—')}</span>
      </div>
      <div class="info-row">
        <span class="label">วันที่อนุมัติ</span>
        <span class="value">${esc(formatThaiDateTime(txn.approvedAt, lang))}</span>
      </div>
      <div class="info-row">
        <span class="label">คงเหลือหลังเบิก</span>
        <span class="value">${esc(txn.balanceAfter)} ${esc(txn.unit ?? txn.stockItem?.unit ?? '')}</span>
      </div>
    `

    const infoSectionAdjust = `
      <div class="info-row">
        <span class="label">เหตุผลในการปรับปรุง</span>
        <span class="value">${esc(txn.reason ?? '—')}</span>
      </div>
      <div class="info-row">
        <span class="label">ดำเนินการโดย</span>
        <span class="value">${esc(txn.performedBy ?? '—')}</span>
      </div>
      <div class="info-row">
        <span class="label">คงเหลือหลังปรับ</span>
        <span class="value">${esc(txn.balanceAfter)} ${esc(txn.unit ?? txn.stockItem?.unit ?? '')}</span>
      </div>
    `

    const infoSection =
      docType === 'IN'
        ? infoSectionIn
        : docType === 'OUT'
          ? infoSectionOut
          : infoSectionAdjust

    // Signatures differ by type
    const signaturesIn = `
      <div class="sign-cell">
        <div class="sign-line">ผู้ส่งมอบ</div>
        <div class="sign-date">วันที่: ………/………/………</div>
      </div>
      <div class="sign-cell">
        <div class="sign-line">ผู้รับสินค้า</div>
        <div class="sign-date">วันที่: ………/………/………</div>
      </div>
      <div class="sign-cell">
        <div class="sign-line">ผู้ตรวจสอบ</div>
        <div class="sign-date">วันที่: ………/………/………</div>
      </div>
    `
    const signaturesOut = `
      <div class="sign-cell">
        <div class="sign-line">ผู้เบิก</div>
        <div class="sign-date">วันที่: ………/………/………</div>
      </div>
      <div class="sign-cell">
        <div class="sign-line">ผู้เบิกให้ / คลังสินค้า</div>
        <div class="sign-date">วันที่: ………/………/………</div>
      </div>
      <div class="sign-cell">
        <div class="sign-line">ผู้อนุมัติ</div>
        <div class="sign-date">วันที่: ………/………/………</div>
      </div>
    `
    const signaturesAdjust = `
      <div class="sign-cell">
        <div class="sign-line">ผู้ดำเนินการ</div>
        <div class="sign-date">วันที่: ………/………/………</div>
      </div>
      <div class="sign-cell">
        <div class="sign-line">ผู้ตรวจสอบ</div>
        <div class="sign-date">วันที่: ………/………/………</div>
      </div>
      <div class="sign-cell">
        <div class="sign-line">ผู้อนุมัติ</div>
        <div class="sign-date">วันที่: ………/………/………</div>
      </div>
    `
    const signatures =
      docType === 'IN'
        ? signaturesIn
        : docType === 'OUT'
          ? signaturesOut
          : signaturesAdjust

    const accentColor = docType === 'IN' ? '#10b981' : docType === 'OUT' ? '#f43f5e' : '#f59e0b'
    const accentBg = docType === 'IN' ? '#d1fae5' : docType === 'OUT' ? '#ffe4e6' : '#fef3c7'
    const accentBorder = docType === 'IN' ? '#6ee7b7' : docType === 'OUT' ? '#fda4af' : '#fcd34d'
    const logoChar = docType === 'IN' ? 'รับ' : docType === 'OUT' ? 'เบิก' : 'ปรับ'
    const typeLabel =
      docType === 'IN'
        ? 'รับเข้า (IN)'
        : docType === 'OUT'
          ? 'เบิกออก (OUT)'
          : 'ปรับปรุง (ADJUST)'

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(docTitle)} ${esc(txnNumber)}</title>
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
    h1 { font-size: 24px; margin-bottom: 4px; }
    h2 {
      font-size: 14px;
      color: ${accentColor};
      border-bottom: 2px solid ${accentBorder};
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
      width: 58px;
      height: 58px;
      background: ${accentColor};
      color: white;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      font-weight: bold;
    }
    .header .title-block { flex: 1; text-align: center; }
    .header .title-block h1 { font-size: 24px; }
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

    .type-badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      background: ${accentBg};
      color: ${accentColor};
      border: 1px solid ${accentBorder};
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

    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 16px;
      margin-top: 28px;
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
      background: ${accentColor};
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
      .info-grid, .signatures, table.items { page-break-inside: avoid; break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="page">
    <!-- Header -->
    <div class="header">
      <div class="logo">${esc(logoChar)}</div>
      <div class="title-block">
        <h1>${esc(docTitle)}</h1>
        <div class="subtitle">${esc(docSubtitle)} • ระบบจัดการสินค้าคงคลัง</div>
      </div>
      <div class="meta">
        <div class="doc-num">${esc(txnNumber)}</div>
        <div>วันที่ทำรายการ: ${esc(formatThaiDate(txn.txnDate, lang))}</div>
        <div>พิมพ์เมื่อ: ${esc(todayLabel)}</div>
      </div>
    </div>

    <!-- Type badge -->
    <div style="margin-top: 10px;">
      <span class="type-badge">${esc(typeLabel)}</span>
    </div>

    <!-- Info section -->
    <h2>ข้อมูลเอกสาร</h2>
    <div class="info-grid">
      ${infoSection}
      <div class="info-row">
        <span class="label">เลขที่เอกสาร</span>
        <span class="value" style="font-family: 'Courier New', monospace;">${esc(txnNumber)}</span>
      </div>
      <div class="info-row">
        <span class="label">วันที่ทำรายการ</span>
        <span class="value">${esc(formatThaiDate(txn.txnDate, lang))}</span>
      </div>
      <div class="info-row">
        <span class="label">ดำเนินการโดย</span>
        <span class="value">${esc(txn.performedBy ?? '—')}</span>
      </div>
      <div class="info-row">
        <span class="label">หมายเหตุ</span>
        <span class="value">${esc(txn.remark ?? '—')}</span>
      </div>
    </div>

    ${
      txn.workOrderNo
        ? `
      <div class="info-row" style="margin-top: 6px; padding: 6px 10px; background: #f0fdfa; border: 1px solid #5eead4; border-radius: 6px;">
        <span class="label">เลขที่ใบงานที่เกี่ยวข้อง</span>
        <span class="value" style="font-family: 'Courier New', monospace;">${esc(txn.workOrderNo)}</span>
      </div>
    `
        : ''
    }

    <!-- Items table -->
    <h2>รายการสินค้า (${lineItems.length} รายการ)</h2>
    <table class="items">
      <thead>
        <tr>
          <th style="width: 32px;">#</th>
          <th style="width: 110px;">รหัสสินค้า</th>
          <th>รายการ</th>
          <th style="width: 60px; text-align: right;">จำนวน</th>
          <th style="width: 60px;">หน่วย</th>
          <th style="width: 90px; text-align: right;">ราคา/หน่วย</th>
          <th style="width: 100px; text-align: right;">มูลค่ารวม</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="6" style="text-align: right;">มูลค่ารวมทั้งสิ้น</td>
          <td style="text-align: right;">${esc(formatBaht(grandTotal, lang))}</td>
        </tr>
      </tfoot>
    </table>

    <!-- Signatures -->
    <h2>ลายเซ็น</h2>
    <div class="signatures">
      ${signatures}
    </div>

    <!-- Footer -->
    <div class="footer">
      <span>เลขที่เอกสาร: ${esc(txnNumber)} • สินค้าคงคลัง: ${esc(txn.stockItem?.productCode ?? txn.productCode ?? '—')}</span>
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
    console.error('GET /api/stock-items/[id]/print', err)
    return new NextResponse(
      `<h1>เกิดข้อผิดพลาด</h1><p>${esc(process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Unknown error') : 'Internal server error')}</p>`,
      {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    )
  }
}
