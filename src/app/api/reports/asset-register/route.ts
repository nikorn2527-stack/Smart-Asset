// ============================================================
// Asset Register Report (Phase 3.2)
// ============================================================
// GET /api/reports/asset-register?groupBy=site|type&site=UDH&includeDisposed=0
//
// Generates a printable HTML "ทะเบียนทรัพย์สิน" (or "ทะเบียนครุภัณฑ์"
// depending on OrganizationProfile.assetTerminology) — ready to open in
// a new tab and print to PDF.
//
// The HTML includes:
//   • Header with org name + report title + print date
//   • Grouped table (by site OR by device type)
//   • Columns: assetCode, name, type, brand, model, serial, site,
//              building, floor, room, department, purchaseDate,
//              purchasePrice, usefulLife, bookValue, status
//   • Per-group subtotals + grand summary at the bottom
//     (total devices, total original value, total book value)
//
// Auth: VIEW_DASHBOARD  (matches other reports).
// Module gate: 'reports'.
//
// Returns: text/html (NOT JSON). The client opens this in a new tab
// via window.open() and calls window.print() (the page auto-opens the
// browser print dialog via a small inline script).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { db } from '@/lib/db'
import { getOrgProfile } from '@/lib/org-profile'
import { demoFilter } from '@/lib/demo-mode'
import { getServerLang, serverFormatDateTime, serverFormatDate, serverFormatNumber, type Lang } from '@/lib/server-i18n'

export const maxDuration = 60

interface AssetRow {
  id: string
  assetCode: string
  name: string
  type: string
  brand: string
  model: string
  serialNumber: string | null
  site: string
  building: string | null
  floor: string | null
  room: string | null
  department: string | null
  purchaseDate: string | null
  purchasePrice: number | null
  salvageValue: number
  usefulLife: number | null
  status: string
  // computed
  bookValue: number
  annualDepreciation: number
  yearsElapsed: number
}

function yearsBetween(purchaseDate: string | null): number {
  if (!purchaseDate) return 0
  try {
    const iso = purchaseDate.length > 10 ? purchaseDate : `${purchaseDate}T00:00:00`
    const diffMs = Date.now() - new Date(iso).getTime()
    return Math.max(0, diffMs / (1000 * 60 * 60 * 24 * 365.25))
  } catch {
    return 0
  }
}

/**
 * FIX (2026-09-17 H): `lang` ถูกอ้างถึงใน 4 จุดแต่ไม่เคยถูกประกาศ
 * (ตกค้างจากการ refactor) ทำให้ GET /api/reports/asset-register
 * พังทั้ง route ด้วย ReferenceError: lang is not defined.
 * รายงานนี้เป็นภาษาไทยล้วน (html lang="th") — จึงตั้งค่าเป็น 'th' ตายตัว
 */
const lang = 'th'

function formatThaiDate(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso.length > 10 ? iso : `${iso}T00:00:00`)
    if (Number.isNaN(d.getTime())) return iso
    // Thai Buddhist year + dd/mm/YYYY format
    return d.toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function formatCurrency(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '-'
  return n.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function escHtml(s: string | null | undefined): string {
  if (!s) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Calculate straight-line depreciation per device.
 * Mirrors the logic in /api/devices/depreciation/route.ts (Phase 1 calc).
 */
function computeBookValue(row: {
  purchasePrice: number | null
  salvageValue: number
  usefulLife: number | null
  purchaseDate: string | null
}): { bookValue: number; annualDepreciation: number; yearsElapsed: number } {
  const price = row.purchasePrice
  if (price == null || price <= 0) {
    return { bookValue: 0, annualDepreciation: 0, yearsElapsed: 0 }
  }
  const life = row.usefulLife
  if (life == null || life <= 0) {
    // No useful life → can't depreciate; book value = purchase price
    return { bookValue: price, annualDepreciation: 0, yearsElapsed: 0 }
  }
  const salvage = row.salvageValue || 0
  const years = yearsBetween(row.purchaseDate)
  const depreciableAmount = price - salvage
  const annualDep = depreciableAmount / life
  const accumulated = Math.min(annualDep * years, depreciableAmount)
  const bookValue = Math.max(salvage, price - accumulated)
  return {
    bookValue: Math.round(bookValue * 100) / 100,
    annualDepreciation: Math.round(annualDep * 100) / 100,
    yearsElapsed: Math.round(years * 100) / 100,
  }
}

export async function GET(req: NextRequest) {
  // ── Module gate ──
  const moduleCheck = await moduleUnavailableResponse('reports')
  if (moduleCheck) return moduleCheck

  // ── Auth: VIEW_DASHBOARD ──
  const auth = await requireAuth(req, 'VIEW_DASHBOARD')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(req.url)
    const groupBy = (searchParams.get('groupBy')?.trim() || 'site') as 'site' | 'type'
    const siteParam = searchParams.get('site')?.trim() ?? ''
    const includeDisposed = searchParams.get('includeDisposed') === '1'

    // ── Load org profile (for title + org name) ──
    const profile = await getOrgProfile()
    const orgName = profile.appName
    // assetTerminology drives the title: "ทะเบียนครุภัณฑ์" vs "ทะเบียนทรัพย์สิน"
    const terminology = profile.assetTerminology || 'ครุภัณฑ์'
    const title = `ทะเบียน${terminology}`

    // ── Fetch devices (with financial fields) ──
    // Excludes Disposed/Retired by default; ?includeDisposed=1 includes them.
    const where: Record<string, unknown> = { ...demoFilter(auth.user) }
    if (!includeDisposed) {
      where.status = { notIn: ['Disposed', 'Retired'] }
    }
    if (siteParam) {
      where.site = siteParam
    }

    // SPRINT-1 #9 (DEV-HANDOVER B-06): cap export at 500 records to avoid
    // Vercel Hobby 10s timeout (Pro is 60s). If the dataset is larger,
    // ask the user to filter by site or status to narrow down. Full
    // export of 2,378+ devices would take ~15s of PDF generation.
    const MAX_EXPORT_RECORDS = 500
    const totalCount = await db.device.count({ where })
    if (totalCount > MAX_EXPORT_RECORDS) {
      return NextResponse.json(
        {
          error: `ข้อมูล ${totalCount} รายการ เกินกว่าขีดจำกัดการ export (${MAX_EXPORT_RECORDS}) กรุณากรองตามสาขาหรือสถานะเพื่อลดจำนวน`,
          code: 'EXPORT_TOO_LARGE',
          count: totalCount,
          max: MAX_EXPORT_RECORDS,
        },
        { status: 413 },
      )
    }

    const devices = await db.device.findMany({
      where,
      select: {
        id: true,
        assetCode: true,
        name: true,
        type: true,
        brand: true,
        model: true,
        serialNumber: true,
        site: true,
        building: true,
        floor: true,
        room: true,
        department: true,
        purchaseDate: true,
        purchasePrice: true,
        salvageValue: true,
        usefulLife: true,
        status: true,
      },
      orderBy: [{ site: 'asc' }, { assetCode: 'asc' }],
    })

    // ── Compute book values + map to AssetRow ──
    const rows: AssetRow[] = devices.map((d) => {
      const price = d.purchasePrice ? Number(d.purchasePrice) : null
      const salvage = d.salvageValue ? Number(d.salvageValue) : 0
      const life = d.usefulLife ?? null
      const { bookValue, annualDepreciation, yearsElapsed } = computeBookValue({
        purchasePrice: price,
        salvageValue: salvage,
        usefulLife: life,
        purchaseDate: d.purchaseDate,
      })
      return {
        id: d.id,
        assetCode: d.assetCode,
        name: d.name,
        type: d.type,
        brand: d.brand,
        model: d.model,
        serialNumber: d.serialNumber,
        site: d.site,
        building: d.building,
        floor: d.floor,
        room: d.room,
        department: d.department,
        purchaseDate: d.purchaseDate,
        purchasePrice: price,
        salvageValue: salvage,
        usefulLife: life,
        status: d.status,
        bookValue,
        annualDepreciation,
        yearsElapsed,
      }
    })

    // ── Group rows ──
    const groups = new Map<string, AssetRow[]>()
    for (const r of rows) {
      const key = groupBy === 'type' ? r.type || 'ไม่ระบุ' : r.site || 'ไม่ระบุสาขา'
      const arr = groups.get(key) ?? []
      arr.push(r)
      groups.set(key, arr)
    }

    // ── Summary ──
    const totalDevices = rows.length
    const totalOriginal = rows.reduce((s, r) => s + (r.purchasePrice ?? 0), 0)
    const totalBookValue = rows.reduce((s, r) => s + r.bookValue, 0)

    // ── Build HTML ──
    const printDate = new Date().toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
      dateStyle: 'long',
      timeStyle: 'short',
    })

    const groupSections: string[] = []
    for (const [groupName, groupRows] of groups.entries()) {
      const groupOriginal = groupRows.reduce((s, r) => s + (r.purchasePrice ?? 0), 0)
      const groupBookValue = groupRows.reduce((s, r) => s + r.bookValue, 0)
      const rowCount = groupRows.length

      const rowsHtml = groupRows
        .map((r, idx) => {
          return `
          <tr>
            <td class="num">${idx + 1}</td>
            <td class="code">${escHtml(r.assetCode)}</td>
            <td>${escHtml(r.name)}</td>
            <td>${escHtml(r.type)}</td>
            <td>${escHtml(r.brand)}</td>
            <td>${escHtml(r.model)}</td>
            <td class="mono">${escHtml(r.serialNumber)}</td>
            <td>${escHtml(r.site)}</td>
            <td>${escHtml(r.building)}</td>
            <td>${escHtml(r.floor)}</td>
            <td>${escHtml(r.room)}</td>
            <td>${escHtml(r.department)}</td>
            <td class="date">${r.purchaseDate ? formatThaiDate(r.purchaseDate) : '-'}</td>
            <td class="num">${r.purchasePrice != null ? formatCurrency(r.purchasePrice) : '-'}</td>
            <td class="num">${r.usefulLife != null ? `${r.usefulLife} ปี` : '-'}</td>
            <td class="num">${formatCurrency(r.bookValue)}</td>
            <td class="status">${escHtml(r.status)}</td>
          </tr>`
        })
        .join('')

      const subtotalRow = `
        <tr class="subtotal">
          <td colspan="13" class="subtotal-label">
            รวม${groupBy === 'type' ? 'ประเภท' : 'สาขา'}: ${escHtml(groupName)} (${rowCount} รายการ)
          </td>
          <td class="num">${formatCurrency(groupOriginal)}</td>
          <td></td>
          <td class="num">${formatCurrency(groupBookValue)}</td>
          <td></td>
        </tr>`

      groupSections.push(`
        <section class="group">
          <h2>${groupBy === 'type' ? 'ประเภท' : 'สาขา'}: ${escHtml(groupName)}</h2>
          <table>
            <thead>
              <tr>
                <th class="num">ลำดับ</th>
                <th class="code">รหัสทรัพย์สิน</th>
                <th>ชื่อ</th>
                <th>ประเภท</th>
                <th>ยี่ห้อ</th>
                <th>รุ่น</th>
                <th>Serial No.</th>
                <th>สาขา</th>
                <th>อาคาร</th>
                <th>ชั้น</th>
                <th>ห้อง</th>
                <th>แผนก</th>
                <th>วันที่ซื้อ</th>
                <th>ราคาทุน</th>
                <th>อายุใช้งาน</th>
                <th>มูลค่าตามบัญชี</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
              ${subtotalRow}
            </tbody>
          </table>
        </section>`)
    }

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escHtml(title)} — ${escHtml(orgName)}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 12mm 10mm;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; font-family: 'Sarabun', 'TH Sarabun PSK', 'Tahoma', sans-serif; color: #1f2937; }
    body { padding: 16px; font-size: 11px; }
    header.report-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      border-bottom: 2px solid #f97316; padding-bottom: 8px; margin-bottom: 12px;
      gap: 16px;
    }
    header.report-header .org { font-size: 16px; font-weight: 700; color: #0f172a; }
    header.report-header .title { font-size: 20px; font-weight: 700; color: #c2410c; margin-top: 4px; }
    header.report-header .meta { font-size: 10px; color: #64748b; text-align: right; }
    h2 {
      font-size: 13px; color: #c2410c; margin: 18px 0 6px;
      border-left: 4px solid #f97316; padding-left: 8px;
    }
    table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
    th, td { border: 1px solid #d1d5db; padding: 3px 5px; font-size: 10px; vertical-align: top; }
    th { background: #fff7ed; color: #9a3412; text-align: left; font-weight: 600; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    td.code, th.code { font-family: 'Courier New', monospace; font-size: 9.5px; white-space: nowrap; }
    td.mono { font-family: 'Courier New', monospace; font-size: 9.5px; }
    td.date, th.date { white-space: nowrap; }
    td.status, th.status { font-size: 9.5px; text-align: center; }
    tr.subtotal { background: #fef3c7; font-weight: 600; }
    tr.subtotal td.subtotal-label { text-align: right; color: #92400e; font-size: 10.5px; }
    tr:nth-child(even) td { background: #fafafa; }
    tr.subtotal td { background: #fef3c7 !important; }
    footer.summary {
      margin-top: 18px; padding: 12px 16px; background: #fff7ed;
      border: 1px solid #fdba74; border-radius: 6px;
    }
    footer.summary h3 { margin: 0 0 6px; font-size: 13px; color: #9a3412; }
    footer.summary .grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
    }
    footer.summary .stat { padding: 6px 8px; background: #fff; border-radius: 4px; }
    footer.summary .label { font-size: 10px; color: #64748b; }
    footer.summary .value { font-size: 14px; font-weight: 700; color: #c2410c; }
    footer.report-footer {
      margin-top: 16px; text-align: center; font-size: 9px; color: #94a3b8;
      border-top: 1px solid #e5e7eb; padding-top: 6px;
    }
    .empty { padding: 30px; text-align: center; color: #94a3b8; font-size: 12px; }
    @media print {
      body { padding: 0; }
      h2 { page-break-after: avoid; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; }
      footer.summary { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <header class="report-header">
    <div>
      <div class="org">${escHtml(orgName)}</div>
      <div class="title">${escHtml(title)}</div>
    </div>
    <div class="meta">
      <div>พิมพ์เมื่อ: ${escHtml(printDate)}</div>
      <div>จัดกลุ่มตาม: ${groupBy === 'type' ? 'ประเภทอุปกรณ์' : 'สาขา'}</div>
      ${siteParam ? `<div>สาขา: ${escHtml(siteParam)}</div>` : ''}
      <div>รวมทั้งหมด: ${totalDevices} รายการ</div>
    </div>
  </header>

  ${groups.size === 0
    ? '<div class="empty">ไม่พบข้อมูลทรัพย์สินตามเงื่อนไขที่เลือก</div>'
    : groupSections.join('')}

  <footer class="summary">
    <h3>สรุปยอดรวม</h3>
    <div class="grid">
      <div class="stat">
        <div class="label">จำนวนทรัพย์สินทั้งหมด</div>
        <div class="value">${totalDevices.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} รายการ</div>
      </div>
      <div class="stat">
        <div class="label">มูลค่าทุนรวม (Original Value)</div>
        <div class="value">${formatCurrency(totalOriginal)}</div>
      </div>
      <div class="stat">
        <div class="label">มูลค่าตามบัญชีรวม (Book Value)</div>
        <div class="value">${formatCurrency(totalBookValue)}</div>
      </div>
    </div>
  </footer>

  <footer class="report-footer">
    รายงานสร้างโดย ${escHtml(orgName)} | ${escHtml(title)} | ${escHtml(printDate)}
  </footer>

  <script>
    // Auto-open the print dialog once the page has loaded.
    // The user can cancel and inspect the HTML first; closing the print
    // dialog leaves the HTML page open for re-printing.
    window.addEventListener('load', function () {
      try { window.print(); } catch (e) { /* no-op */ }
    });
  </script>
</body>
</html>`

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    })
  } catch (err) {
    console.error('GET /api/reports/asset-register', err)
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to generate asset register report',
      },
      { status: 500 },
    )
  }
}
