'use client'

import { toast } from 'sonner'
import type { DashboardData } from './types'
import { DASHBOARD_RANGE_OPTIONS, type DashboardRangeKey } from './types'

interface ExportArgs {
  data: DashboardData
  range: DashboardRangeKey
  orgName?: string
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatThaiDate(iso: string | null, lang: 'th' | 'en' = 'th'): string {
  if (!iso) return '—'
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

/**
 * Generates a printable PDF summary report by opening a new window with a
 * full HTML document containing print CSS and calling window.print().
 * Falls back to a toast warning if the popup is blocked.
 */
export function exportDashboardPdf({ data, range, orgName }: ExportArgs, lang: 'th' | 'en' = 'th') {
  const win = window.open('', '_blank', 'width=900,height=1200')
  if (!win) {
    toast.warning('เบราว์เซอร์บล็อกป๊อปอัป — กรุณาอนุญาตป๊อปอัปแล้วลองอีกครั้ง')
    return
  }

  const now = new Date()
  const generatedAt = now.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
  })
  const rangeOpt = DASHBOARD_RANGE_OPTIONS.find((o) => o.value === range)
  const rangeLabel = rangeOpt?.label ?? 'เดือนนี้'
  const rangeStart = data?.range?.start ?? null
  const rangeEnd = data?.range?.end ?? null

  const org = orgName?.trim() || 'องค์กร'

  const total = data?.totals?.total ?? 0
  const active = data?.totals?.active ?? 0
  const spare = data?.totals?.spare ?? 0
  const repair = data?.totals?.repair ?? 0
  const paper = data?.paperThisMonth ?? 0

  const byStatusRows = (data?.byStatus ?? [])
    .map(
      (s) => `<tr>
        <td>${escapeHtml(s.name)}</td>
        <td class="num">${(s.value ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</td>
        <td class="num">${total > 0 ? Math.round(((s.value ?? 0) / total) * 100) : 0}%</td>
      </tr>`,
    )
    .join('')

  const byTypeRows = (data?.byType ?? [])
    .map(
      (t) => `<tr>
        <td>${escapeHtml(t.name)}</td>
        <td class="num">${(t.value ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</td>
        <td class="num">${total > 0 ? Math.round(((t.value ?? 0) / total) * 100) : 0}%</td>
      </tr>`,
    )
    .join('')

  const topRows = (data?.topUsage ?? [])
    .filter((d) => d.value > 0)
    .slice(0, 5)
    .map(
      (d, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(d.name)}</td>
        <td>${escapeHtml(d.assetCode)}</td>
        <td class="num">${(d.value ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</td>
      </tr>`,
    )
    .join('')

  const recentRows = (data?.recentActivity ?? [])
    .slice(0, 5)
    .map(
      (a) => `<tr>
        <td>${escapeHtml(a.deviceName)}</td>
        <td>${escapeHtml(a.assetCode)}</td>
        <td class="num">${(a.reading ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</td>
        <td class="num">${a.delta > 0 ? '+' + (a.delta ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB') : '-'}</td>
        <td>${escapeHtml(a.date)}</td>
      </tr>`,
    )
    .join('')

  const statusBreakdownTotal = (data?.byStatus ?? []).reduce(
    (sum, s) => sum + s.value,
    0,
  )
  const typeBreakdownTotal = (data?.byType ?? []).reduce(
    (sum, t) => sum + t.value,
    0,
  )

  const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>รายงานภาพรวมระบบจัดการอุปกรณ์ IT — ${escapeHtml(org)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: 'Sukhumvit Set', 'Thonburi', 'Tahoma', 'Leelawadee UI', sans-serif;
    color: #1e293b;
    font-size: 12px;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .container { max-width: 100%; padding: 0; }
  .header {
    border-bottom: 3px solid #f97316;
    padding-bottom: 10px;
    margin-bottom: 18px;
    display: flex; justify-content: space-between; align-items: flex-start;
  }
  .header .org {
    font-size: 18px; font-weight: 700; color: #0f172a;
  }
  .header .subtitle {
    font-size: 13px; color: #475569; margin-top: 2px;
  }
  .header .meta {
    text-align: right; font-size: 11px; color: #64748b;
  }
  .meta .label { color: #94a3b8; }
  .accent { color: #f97316; }
  .teal { color: #0d9488; }
  h2.section {
    font-size: 13px; font-weight: 700; color: #0f172a;
    margin: 22px 0 8px;
    padding: 6px 10px;
    background: linear-gradient(90deg, #fff7ed 0%, #ffffff 100%);
    border-left: 4px solid #f97316;
    border-radius: 3px;
  }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td {
    border: 1px solid #e2e8f0;
    padding: 6px 8px;
    text-align: left;
    font-size: 11px;
    vertical-align: top;
  }
  th {
    background: #f8fafc;
    color: #475569;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.04em;
  }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:nth-child(even) td { background: #fafbfc; }
  .kpi-grid {
    display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 6px 0 4px;
  }
  .kpi {
    border: 1px solid #e2e8f0; border-top: 3px solid #f97316;
    border-radius: 4px; padding: 10px;
    background: #ffffff;
  }
  .kpi .label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
  .kpi .value { font-size: 22px; font-weight: 700; color: #0f172a; line-height: 1.1; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .kpi .unit { font-size: 11px; color: #94a3b8; margin-left: 3px; font-weight: 500; }
  .kpi.t-active { border-top-color: #10b981; }
  .kpi.t-active .value { color: #10b981; }
  .kpi.t-spare { border-top-color: #f59e0b; }
  .kpi.t-spare .value { color: #d97706; }
  .kpi.t-repair { border-top-color: #f97316; }
  .kpi.t-repair .value { color: #ea580c; }
  .kpi.t-paper { border-top-color: #0d9488; }
  .kpi.t-paper .value { color: #0d9488; }
  .footer {
    margin-top: 28px;
    padding-top: 8px;
    border-top: 1px solid #e2e8f0;
    font-size: 10px;
    color: #94a3b8;
    display: flex; justify-content: space-between;
  }
  .footer .brand { color: #f97316; font-weight: 700; letter-spacing: 0.04em; }
  .empty { color: #94a3b8; font-style: italic; padding: 8px; text-align: center; }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
    background: #fff7ed;
    color: #c2410c;
    border: 1px solid #fed7aa;
  }
  @media print {
    .no-print { display: none; }
    .header { page-break-after: avoid; }
    h2.section { page-break-after: avoid; }
    table { page-break-inside: avoid; }
  }
  .print-btn {
    position: fixed; top: 12px; right: 12px;
    background: #f97316; color: white; border: none;
    padding: 8px 16px; border-radius: 6px; cursor: pointer;
    font-size: 12px; font-weight: 600;
    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
  }
  .print-btn:hover { background: #ea580c; }
</style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">🖨 พิมพ์ / บันทึก PDF</button>
  <div class="container">
    <div class="header">
      <div>
        <div class="org">${escapeHtml(org)}</div>
        <div class="subtitle">รายงานภาพรวมระบบจัดการอุปกรณ์ IT <span class="badge">${escapeHtml(rangeLabel)}</span></div>
        ${rangeStart || rangeEnd ? `<div class="subtitle" style="font-size:11px;color:#94a3b8;">ช่วงข้อมูล: ${rangeStart ? formatThaiDate(rangeStart, lang) : '—'} → ${rangeEnd ? formatThaiDate(rangeEnd, lang) : 'ปัจจุบัน'}</div>` : ''}
      </div>
      <div class="meta">
        <div><span class="label">วันที่ออกรายงาน:</span> ${escapeHtml(generatedAt)}</div>
        <div><span class="label">ออกโดย:</span> admin@example.com</div>
      </div>
    </div>

    <h2 class="section">📊 สรุปตัวชี้วัดหลัก (KPI)</h2>
    <div class="kpi-grid">
      <div class="kpi">
        <div class="label">อุปกรณ์ทั้งหมด</div>
        <div class="value">${total.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}<span class="unit">เครื่อง</span></div>
      </div>
      <div class="kpi t-active">
        <div class="label">ใช้งานอยู่</div>
        <div class="value">${active.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}<span class="unit">เครื่อง</span></div>
      </div>
      <div class="kpi t-spare">
        <div class="label">สำรอง</div>
        <div class="value">${spare.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}<span class="unit">เครื่อง</span></div>
      </div>
      <div class="kpi t-repair">
        <div class="label">ส่งซ่อม</div>
        <div class="value">${repair.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}<span class="unit">เครื่อง</span></div>
      </div>
      <div class="kpi t-paper">
        <div class="label">กระดาษ (${escapeHtml(rangeLabel)})</div>
        <div class="value">${paper.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}<span class="unit">แผ่น</span></div>
      </div>
    </div>

    <h2 class="section">📈 สัดส่วนสถานะอุปกรณ์</h2>
    ${statusBreakdownTotal === 0 ? '<div class="empty">ยังไม่มีข้อมูลอุปกรณ์</div>' : `
    <table>
      <thead>
        <tr><th>สถานะ</th><th class="num">จำนวน</th><th class="num">สัดส่วน</th></tr>
      </thead>
      <tbody>
        ${byStatusRows || '<tr><td colspan="3" class="empty">—</td></tr>'}
      </tbody>
    </table>`}

    <h2 class="section">💻 จำนวนอุปกรณ์ตามประเภท</h2>
    ${typeBreakdownTotal === 0 ? '<div class="empty">ยังไม่มีข้อมูลประเภทอุปกรณ์</div>' : `
    <table>
      <thead>
        <tr><th>ประเภท</th><th class="num">จำนวน</th><th class="num">สัดส่วน</th></tr>
      </thead>
      <tbody>
        ${byTypeRows || '<tr><td colspan="3" class="empty">—</td></tr>'}
      </tbody>
    </table>`}

    <h2 class="section">🏆 Top 5 อุปกรณ์ตามการใช้งานกระดาษ</h2>
    ${!topRows ? '<div class="empty">ยังไม่มีข้อมูลการใช้งานกระดาษในช่วงนี้</div>' : `
    <table>
      <thead>
        <tr><th class="num" style="width:32px">#</th><th>ชื่ออุปกรณ์</th><th>รหัสสินทรัพย์</th><th class="num">แผ่น</th></tr>
      </thead>
      <tbody>
        ${topRows}
      </tbody>
    </table>`}

    <h2 class="section">🕒 กิจกรรมล่าสุด (จดมิเตอร์)</h2>
    ${!recentRows ? '<div class="empty">ยังไม่มีกิจกรรมในช่วงนี้</div>' : `
    <table>
      <thead>
        <tr><th>ชื่ออุปกรณ์</th><th>รหัส</th><th class="num">ค่ามิเตอร์</th><th class="num">เพิ่ม</th><th>วันที่</th></tr>
      </thead>
      <tbody>
        ${recentRows}
      </tbody>
    </table>`}

    <div class="footer">
      <div>
        <span class="brand">องค์กร</span> — IT Asset Management
      </div>
      <div>
        หน้า 1 · ออกรายงานเมื่อ ${escapeHtml(generatedAt)}
      </div>
    </div>
  </div>
  <script>
    // Auto-trigger print after the document finishes loading.
    window.addEventListener('load', function () {
      setTimeout(function () { try { window.print(); } catch (e) {} }, 250);
    });
  </script>
</body>
</html>`

  win.document.open()
  win.document.write(html)
  win.document.close()
  toast.success('กำลังเปิดหน้าพิมพ์รายงาน PDF...')
}
