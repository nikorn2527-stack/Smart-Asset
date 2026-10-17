'use client'

// ============================================================
// MonthlyReport — reportitemmonths (Task ID: PRINT-REPORT, PART 2)
// ============================================================
// Fetches GET /api/reports/monthly?month=YYYY-MM&site=&type=...
// and renders:
//   • Month selector + optional site filter + report-type tabs
//   • Summary cards (total WO / completed / avg rating / stock moves)
//   • Charts (status pie, priority bar, subject bar, staff bar)
//   • Tables (top items, low stock, staff performance)
//   • "PrintReport" dropdown → Dialog w/ section checkboxes
//     → opens new window w/ formatted HTML (paper usage / devices /
//       work-orders / stock / meters) — Task ID: MONTHLY-REPORT-PRINT
//   • Quick Print button (in-page) + CSV export
// ============================================================

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { motion } from 'framer-motion'
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { VisibleResponsiveContainer } from '@/components/itam/visible-responsive-container'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { useAuthStore } from '@/store/auth-store'
import { PrintTemplateSelectionDialog } from './print-template-selection-dialog'
import { CustomColumnSelector, type ColumnDef } from './custom-column-selector'
import { useT, useLang } from '@/store/i18n-store'

// Column definitions for monthly report tables
const MONTHLY_REPORT_COLUMNS: ColumnDef[] = [
  { key: 'assetCode', label: 'รหัสอุปกรณ์', default: true },
  { key: 'name', label: 'common.name', default: true },
  { key: 'brand', label: 'common.brand', default: true },
  { key: 'model', label: 'common.model', default: true },
  { key: 'serialNumber', label: 'common.serial', default: true },
  { key: 'site', label: 'common.site', default: true },
  { key: 'department', label: 'แผนก', default: false },
  { key: 'meterBw', label: 'มิเตอร์ขาว-ดำ', default: false },
  { key: 'meterColor', label: 'devices.field.last_meter_color', default: false },
  { key: 'pagesBw', label: 'แผ่นขาว-ดำ', default: false },
  { key: 'pagesColor', label: 'แผ่นสี', default: false },
  { key: 'cost', label: 'ค่าใช้จ่าย', default: false },
  { key: 'status', label: 'common.status', default: false },
]
import {  Wrench,
  CheckCircle2,
  Star,
  Package,
  TrendingUp,
  TrendingDown,
  Printer,
  Download,
  RefreshCw,
  CalendarDays,
  Building2,
  AlertTriangle,
  Users,
  Cpu,
  ChevronDown,
  FileText,
  FileSpreadsheet,
  Gauge,
  Layers,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────
type ReportType = 'work-order' | 'stock' | 'devices.unit.device' | 'all'

interface WorkOrderSummary {
  total: number
  byStatus: Record<string, number>
  byPriority: Record<string, number>
  bySubject: Array<{ subject: string; count: number }>
  avgResponseTimeMin: number | null
  avgRating: number | null
  byStaff: Array<{ name: string; count: number; completed: number }>
}

interface StockSummary {
  totalIn: number
  totalOut: number
  topItems: Array<{
    productName: string
    productCode: string | null
    quantity: number
    type: string
  }>
  lowStockItems: Array<{
    productCode: string
    productName: string
    quantity: number
    minQuantity: number
    unit: string
  }>
  totalValue: number
}

interface DeviceSummary {
  total: number
  newDevices: number
  byStatus: Record<string, number>
}

interface MonthlyReportData {
  month: string
  range: { start: string; end: string }
  generatedAt: string
  filters: { site: string | null; type: ReportType }
  workOrders: WorkOrderSummary | null
  stock: StockSummary | null
  devices: DeviceSummary | null
  meta: { avgResponseTimeLabel: string }
}

interface Site {
  id: string
  code: string
  name: string
}

// ── Print-section flags (Task ID: MONTHLY-REPORT-PRINT) ──
type PrintSectionKey =
  | 'paper'
  | 'devices'
  | 'workOrders'
  | 'stock'
  | 'meters'

type PrintSections = Record<PrintSectionKey, boolean>

interface MeterReadingRow {
  id: string
  assetCode: string | null
  deviceName: string | null
  brand: string | null
  model: string | null
  site: string | null
  readingDate: string
  readingMonth: string | null
  meterBw: number
  meterColor: number
  pagesBw: number
  pagesColor: number
  readingType: string | null
  readBy: string | null
  remark: string | null
}

interface DeviceRow {
  id: string
  assetCode: string
  name: string
  brand: string
  model: string
  type: string
  status: string
  site: string
  department: string | null
  location: string | null
  lastMeterBw: number
  lastMeterColor: number
}

// ── Constants ──────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  PENDING: 'รอดำเนินการ',
  IN_PROGRESS: 'กำลังซ่อม',
  WAITING_PARTS: 'รออะไหล่',
  COMPLETED: 'เสร็จแล้ว',
  CANCELLED: 'ยกเลิก',
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#f59e0b',
  IN_PROGRESS: '#3b82f6',
  WAITING_PARTS: '#a855f7',
  COMPLETED: '#10b981',
  CANCELLED: '#f43f5e',
}

const PRIORITY_COLORS: Record<string, string> = {
  Normal: '#94a3b8',
  Medium: '#f59e0b',
  High: '#f97316',
  Urgent: '#ef4444',
}

const STATUS_LABELS_DEV: Record<string, string> = {
  Active: 'ใช้งานอยู่',
  Repair: 'ส่งซ่อม',
  Retired: 'เกษียณ',
  Spare: 'สำรอง',
  Inactive: 'ไม่ใช้งาน',
}

const DEVICE_STATUS_COLORS: Record<string, string> = {
  Active: '#10b981',
  Repair: '#f97316',
  Retired: '#6b7280',
  Spare: '#f59e0b',
  Inactive: '#ef4444',
}

const DEVICE_TYPE_LABELS: Record<string, string> = {
  PRINTER: 'เครื่องพิมพ์',
  SCANNER: 'เครื่องสแกน',
  COMPUTER: 'คอมพิวเตอร์',
  NETWORK: 'อุปกรณ์เครือข่าย',
  OTHER: 'อื่น ๆ',
}

const READING_TYPE_LABELS: Record<string, string> = {
  MONTHLY: 'ประจำเดือน',
  INITIAL: 'เริ่มต้น',
  FINAL: 'สิ้นสุด',
  RESET: 'RESET',
  CHECKOUT: 'เช็คเอาท์',
  SEND_REPAIR: 'ส่งซ่อม',
  RETURN: 'คืนเครื่อง',
  // TRANSFER closes the meter at the location being left; TRANSFER_IN opens it
  // at the destination with the same number (pages = 0), so both branches show
  // the device without double-counting.
  TRANSFER: 'ปิดงวด (ย้ายออก)',
  TRANSFER_IN: 'เปิดงวด (ย้ายเข้า)',
}

function currentMonthValue(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function formatMonthLabel(month: string, lang: 'th' | 'en' = 'th'): string {
  try {
    const [y, m] = month.split('-')
    const d = new Date(Number(y), Number(m) - 1, 1)
    return d.toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', {
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return month
  }
}

function formatBaht(value: number | null | undefined, lang: 'th' | 'en' = 'th'): string {
  return `THB${(Number(value) || 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Escape a value for safe insertion into HTML (used by the print HTML builder). */
function escHtml(input: unknown): string {
  if (input === null || input === undefined) return ''
  const s = String(input)
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Build a self-contained printable A4 HTML report for Special (Approve).
 *
 * Task ID: SPECIALFEE-WOPATTERN-APPROVAL
 *
 * Layout:
 *   • Header — title + month + site + generated timestamp
 *   • Summary KPIs — total cases, # staff, # sites
 *   • Grouped table — by Technician (assignedTo) → Site (site)
 *   • Per-staff case count + grand total
 *
 * Page is print-friendly (A4) and reuses the same CSS pattern as the main
 * monthly print HTML.
 */
function buildSpecialFeeApprovalHTML(opts: {
  rows: Array<{
    id: string
    woNumber: string | null
    subject: string
    status: string
    assignedTo: string | null
    site: string | null
    createdAt: string
    closedAt: string | null
    isSpecialFee: boolean
  }>
  monthLabel: string
  siteLabel: string
}, lang: 'th' | 'en' = 'th'): string {
  const { rows, monthLabel, siteLabel } = opts
  const todayLabel = new Date().toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')

  const statusLabel = (s: string): string =>
    STATUS_LABELS[s] ?? s

  // Group by assignedTo (then by site within each staff member).
  const byStaff = new Map<
    string,
    Map<string, typeof rows>
  >()
  for (const r of rows) {
    const staff = r.assignedTo?.trim() || '— ยังไม่ได้มอบหมาย'
    const site = r.site?.trim() || '—'
    if (!byStaff.has(staff)) byStaff.set(staff, new Map())
    const siteMap = byStaff.get(staff)!
    if (!siteMap.has(site)) siteMap.set(site, [])
    siteMap.get(site)!.push(r)
  }

  // Sort staff by total case count desc.
  const staffEntries = Array.from(byStaff.entries())
    .map(([staff, siteMap]) => {
      const siteList = Array.from(siteMap.entries()).map(([site, list]) => ({
        site,
        list,
      }))
      const total = siteList.reduce((s, x) => s + x.list.length, 0)
      return { staff, siteList, total }
    })
    .sort((a, b) => b.total - a.total)

  const totalCases = rows.length
  const totalStaff = staffEntries.length
  const totalSites = new Set(rows.map((r) => r.site?.trim() || '—')).size

  // Build the grouped body HTML.
  const bodyHtml: string[] = []
  if (staffEntries.length === 0) {
    bodyHtml.push(
      `<div class="empty">ไม่มีรายการพิเศษ (ที่มีค่าใช้จ่าย) ในเดือนที่เลือก</div>`,
    )
  } else {
    for (const s of staffEntries) {
      bodyHtml.push(
        `<div class="block staff-group">` +
          `<h3 class="staff-h">👷 ${escHtml(s.staff)} <span class="badge-count">${s.total} รายการ</span></h3>`,
      )
      for (const sl of s.siteList) {
        bodyHtml.push(
          `<div class="site-group">` +
            `<h4 class="site-h">🏢 ไซต์: ${escHtml(sl.site)} <span class="badge-count">${sl.list.length} รายการ</span></h4>` +
            `<table class="data-table">` +
            `<thead><tr>` +
            `<th style="width:90px">เลขที่ใบงาน</th>` +
            `<th>เรื่อง</th>` +
            `<th style="width:120px">วันที่</th>` +
            `<th style="width:100px">สถานะ</th>` +
            `</tr></thead><tbody>`,
        )
        for (const r of sl.list) {
          const dateLabel = r.createdAt
            ? new Date(r.createdAt).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })
            : '—'
          bodyHtml.push(
            `<tr>` +
              `<td class="mono">${escHtml(r.woNumber ?? '—')}</td>` +
              `<td>${escHtml(r.subject)}</td>` +
              `<td>${escHtml(dateLabel)}</td>` +
              `<td><span class="status-pill">${escHtml(statusLabel(r.status))}</span></td>` +
              `</tr>`,
          )
        }
        bodyHtml.push(`</tbody></table></div>`)
      }
      bodyHtml.push(`</div>`)
    }
  }

  // Per-staff summary table (separate page-break-avoid block).
  const summaryRowsHtml =
    staffEntries.length === 0
      ? '<tr><td colspan="3" class="muted">ไม่มีข้อมูล</td></tr>'
      : staffEntries
          .map(
            (s) =>
              `<tr><td>${escHtml(s.staff)}</td>` +
              `<td style="text-align:right">${s.total}</td>` +
              `<td style="text-align:right">${Math.round((s.total / Math.max(totalCases, 1)) * 100)}%</td></tr>`,
          )
          .join('')

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8" />
<title>รายงานค่าใช้จ่ายพิเศษ (อนุมัติ) ${escHtml(monthLabel)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'IBM Plex Sans Thai', 'Sarabun', 'Segoe UI', sans-serif;
    background: #f1f5f9;
    margin: 0;
    color: #0f172a;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet {
    background: #fff;
    max-width: 800px;
    margin: 24px auto;
    padding: 32px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.08);
    border-radius: 8px;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 16px;
    border-bottom: 3px solid #f97316;
    padding-bottom: 16px;
    margin-bottom: 20px;
  }
  .logo {
    width: 48px;
    height: 48px;
    border-radius: 8px;
    background: linear-gradient(135deg, #f97316, #ea580c);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    font-weight: 700;
  }
  .title-block { flex: 1; }
  .title-block h1 {
    font-size: 20px;
    margin: 0;
    color: #0f172a;
  }
  .title-block .subtitle {
    font-size: 12px;
    color: #64748b;
    margin-top: 2px;
  }
  .meta {
    font-size: 12px;
    color: #475569;
    text-align: right;
    line-height: 1.6;
  }
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 20px;
  }
  .kpi {
    background: #fff7ed;
    border: 1px solid #fed7aa;
    border-radius: 8px;
    padding: 12px 14px;
  }
  .kpi-label {
    font-size: 11px;
    color: #c2410c;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .kpi-value {
    font-size: 24px;
    font-weight: 700;
    color: #9a3412;
    margin-top: 2px;
  }
  .kpi-unit {
    font-size: 11px;
    color: #c2410c;
  }
  h2.section-h {
    font-size: 14px;
    margin: 24px 0 12px;
    color: #0f172a;
    border-left: 4px solid #f97316;
    padding-left: 8px;
  }
  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    margin-bottom: 8px;
  }
  .data-table thead th {
    background: #f1f5f9;
    color: #475569;
    text-align: left;
    padding: 8px 10px;
    border-bottom: 2px solid #e2e8f0;
    font-weight: 600;
  }
  .data-table tbody td {
    padding: 7px 10px;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: top;
  }
  .data-table tbody tr:nth-child(even) td { background: #fafafa; }
  .mono { font-family: 'JetBrains Mono', 'Consolas', monospace; }
  .staff-group {
    margin-bottom: 18px;
    padding: 12px 14px;
    border: 1px solid #fed7aa;
    border-radius: 8px;
    background: #fffbeb;
    page-break-inside: avoid;
  }
  .staff-h {
    font-size: 14px;
    margin: 0 0 8px;
    color: #9a3412;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .site-group {
    margin-bottom: 10px;
    page-break-inside: avoid;
  }
  .site-h {
    font-size: 12px;
    margin: 8px 0 4px;
    color: #475569;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .badge-count {
    display: inline-block;
    background: #f97316;
    color: #fff;
    font-size: 10px;
    padding: 1px 8px;
    border-radius: 999px;
    font-weight: 600;
  }
  .status-pill {
    display: inline-block;
    background: #e2e8f0;
    color: #334155;
    font-size: 10px;
    padding: 1px 8px;
    border-radius: 999px;
    font-weight: 600;
  }
  .empty {
    padding: 32px;
    text-align: center;
    color: #94a3b8;
    background: #f8fafc;
    border: 1px dashed #cbd5e1;
    border-radius: 8px;
  }
  .muted { color: #94a3b8; }
  .footer {
    margin-top: 24px;
    padding-top: 12px;
    border-top: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #94a3b8;
  }
  .print-btn-bar {
    position: fixed;
    bottom: 24px;
    right: 24px;
    display: flex;
    gap: 8px;
    z-index: 10;
  }
  .print-btn-bar button {
    background: #f97316;
    color: #fff;
    border: 0;
    padding: 10px 18px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(249, 115, 22, 0.3);
  }
  .print-btn-bar button.secondary { background: #64748b; }

  @media print {
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; border-radius: 0; padding: 0; max-width: 100%; }
    .print-btn-bar { display: none !important; }
    .staff-group, .site-group { page-break-inside: avoid; }
    .data-table thead th { background: #f1f5f9 !important; }
  }
  @media (max-width: 640px) {
    .kpi-grid { grid-template-columns: repeat(2, 1fr); }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div class="logo">💰</div>
      <div class="title-block">
        <h1>รายงานค่าใช้จ่ายพิเศษ (อนุมัติ)</h1>
        <div class="subtitle">ใบงานค่าใช้จ่ายพิเศษ • ระบบบริหารจัดการสินทรัพย์ IT</div>
      </div>
      <div class="meta">
        <strong>เดือน: ${escHtml(monthLabel)}</strong><br/>
        ไซต์: ${escHtml(siteLabel)}<br/>
        พิมพ์เมื่อ: ${escHtml(todayLabel)}
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">รายการทั้งหมด</div>
        <div class="kpi-value">${totalCases}</div>
        <div class="kpi-unit">รายการ</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">จำนวนช่าง</div>
        <div class="kpi-value">${totalStaff}</div>
        <div class="kpi-unit">คน</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">จำนวนไซต์</div>
        <div class="kpi-value">${totalSites}</div>
        <div class="kpi-unit">ไซต์</div>
      </div>
    </div>

    <h2 class="section-h">รายละเอียดค่าใช้จ่ายพิเศษ แยกตามช่าง/ไซต์</h2>
    ${bodyHtml.join('')}

    <h2 class="section-h">สรุปจำนวนรายการต่อช่าง</h2>
    <table class="data-table">
      <thead>
        <tr>
          <th>ช่าง/เจ้าหน้าที่</th>
          <th style="text-align:right">จำนวนรายการ</th>
          <th style="text-align:right">% ของทั้งหมด</th>
        </tr>
      </thead>
      <tbody>${summaryRowsHtml}</tbody>
      <tfoot>
        <tr style="border-top:2px solid #f97316">
          <td style="font-weight:700">รวมทั้งหมด</td>
          <td style="text-align:right;font-weight:700">${totalCases}</td>
          <td style="text-align:right;font-weight:700">100%</td>
        </tr>
      </tfoot>
    </table>

    <div class="footer">
      <span>เอกสารสร้างโดยระบบบริหารจัดการสินทรัพย์ — พิเศษ (มีค่าใช้จ่าย)</span>
      <span>พิมพ์เมื่อ ${escHtml(todayLabel)}</span>
    </div>
  </div>

  <div class="print-btn-bar">
    <button type="button" onclick="window.print()">🖨 พิมพ์</button>
    <button type="button" class="secondary" onclick="window.close()">ปิด</button>
  </div>
</body>
</html>`
}

// ── Component ──────────────────────────────────────────
export function MonthlyReport() {
  const t = useT()
  const { lang } = useLang()
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const chartTextColor = isDark ? '#cbd5e1' : '#475569'
  const chartGridColor = isDark ? '#334155' : '#e2e8f0'

  const [month, setMonth] = React.useState(currentMonthValue())
  const [site, setSite] = React.useState<string>('all')
  const [reportType, setReportType] = React.useState<ReportType>('all')
  const [selectedColumns, setSelectedColumns] = React.useState<string[]>([])

  // ── Print dialog state (Task ID: MONTHLY-REPORT-PRINT) ──
  const [printDialogOpen, setPrintDialogOpen] = React.useState(false)
  const [printSections, setPrintSections] = React.useState<PrintSections>({
    paper: true,
    devices: false,
    workOrders: true,
    stock: true,
    meters: false,
  })
  const [printBusy, setPrintBusy] = React.useState(false)
  // ── In-page print container (Task ID: PRINT-MEDIA-QUERY-012) ──
  // HTML string injected into a hidden `.print-only` div, then
  // window.print() fires on the SAME page (no new tab/window).
  const [printHtml, setPrintHtml] = React.useState('')

  // ── Print template selection dialog state (Task ID: FIX-1-2-EXPORT-PRINT) ──
  const [printTemplateOpen, setPrintTemplateOpen] = React.useState(false)

  function getAuthHeaders(
    extra: Record<string, string> = {},
  ): Record<string, string> {
    const h: Record<string, string> = { ...extra }
    const token = useAuthStore.getState()?.token
    if (token) h['Authorization'] = `Bearer ${token}`
    return h
  }

  // ── Fetch sites for the filter ──
  const { data: sitesData } = useQuery<Site[]>({
    queryKey: ['sites-list'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/sites')
        if (!res.ok) return []
        const json = await res.json()
        return (json.sites as Site[]) ?? []
      } catch {
        return []
      }
    },
    staleTime: 60_000,
  })
  const sites: Site[] = sitesData ?? []

  // ── Fetch the report ──
  const params = new URLSearchParams({
    month,
    type: reportType,
  })
  if (site !== 'all') params.set('site', site)

  const { data, isLoading, isFetching, refetch, error } =
    useQuery<MonthlyReportData>({
      queryKey: ['monthly-report', month, site, reportType],
      queryFn: async () => {
        const res = await fetch(`/api/reports/monthly?${params.toString()}`)
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error ?? 'โหลดรายงานไม่สำเร็จ')
        }
        const json = await res.json()
        return json as MonthlyReportData
      },
      staleTime: 30_000,
    })

  React.useEffect(() => {
    if (error) {
      toast.error(
        error instanceof Error ? error.message : 'โหลดรายงานไม่สำเร็จ',
      )
    }
  }, [error])

  // ── Print ──
  function handlePrint() {
    window.print()
  }

  // ── ReportSpecial (Approve) — Task ID: SPECIALFEE-WOPATTERN-APPROVAL ──
  // Fetches all isSpecialFee=true WOs in the selected month and opens a
  // standalone printable A4 page grouped by Technician/Site.
  const [approvalBusy, setApprovalBusy] = React.useState(false)

  async function openSpecialFeeApprovalReport() {
    if (!month) {
      toast.error('กรุณาเลือกเดือน')
      return
    }
    setApprovalBusy(true)
    try {
      // Compute from/to range from the YYYY-MM month value.
      const [yStr, mStr] = month.split('-')
      const year = parseInt(yStr, 10)
      const mon = parseInt(mStr, 10)
      if (!year || !mon) {
        toast.error('รูปแบบเดือนไม่ถูกต้อง')
        return
      }
      const from = `${yStr}-${mStr}-01`
      // Last day of month
      const lastDay = new Date(year, mon, 0).getDate()
      const to = `${yStr}-${mStr}-${String(lastDay).padStart(2, '0')}`

      const url =
        `/api/v1/work-orders?specialFee=true` +
        `&from=${encodeURIComponent(from)}` +
        `&to=${encodeURIComponent(to)}` +
        `&limit=500`
      const res = await fetch(url, { headers: getAuthHeaders() })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error?.message ?? 'โหลดข้อมูลไม่สำเร็จ')
      }
      const json = await res.json()
      const rows = (json?.data ?? []) as Array<{
        id: string
        woNumber: string | null
        subject: string
        status: string
        assignedTo: string | null
        site: string | null
        createdAt: string
        closedAt: string | null
        isSpecialFee: boolean
      }>

      // Optional site filter (same UI selector as the main report).
      const filtered =
        site === 'all'
          ? rows
          : rows.filter((r) => (r.site ?? '') === site)

      const html = buildSpecialFeeApprovalHTML({
        rows: filtered,
        monthLabel: formatMonthLabel(month, lang),
        siteLabel: site === 'all' ? 'ทุกไซต์' : `ไซต์ ${site}`,
      }, lang)
      // ── Inject into hidden print container + fire window.print()
      // on the SAME page (Task ID: PRINT-MEDIA-QUERY-012). ──
      setPrintHtml(html)
      setTimeout(() => window.print(), 50)
      setTimeout(() => setPrintHtml(''), 1000)
      toast.success('กำลังเปิดหน้าพิมพ์…')
    } catch (err) {
      console.error('openSpecialFeeApprovalReport', err)
      toast.error(err instanceof Error ? err.message : 'เปิดรายงานไม่สำเร็จ')
    } finally {
      setApprovalBusy(false)
    }
  }

  // ── CSV export ──
  function handleExportCSV() {
    if (!data) return
    const rows: string[][] = []
    rows.push(['รายงานรายเดือน', formatMonthLabel(data.month, lang)])
    rows.push([t('common.site'), site === 'all' ? t('common.all') : site])
    rows.push([t('common.type'), reportType])
    rows.push(['สร้างเมื่อ', data.generatedAt ? new Date(data.generatedAt).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB') : '—'])
    rows.push([])

    if (data.workOrders) {
      rows.push(['==== ใบงาน ===='])
      rows.push([t('common.all'), String(data.workOrders.total)])
      rows.push([t('common.status'), t('common.quantity')])
      for (const [k, v] of Object.entries(data.workOrders.byStatus)) {
        rows.push([STATUS_LABELS[k] ?? k, String(v)])
      }
      rows.push(['ความเร่งด่วน', t('common.quantity')])
      for (const [k, v] of Object.entries(data.workOrders.byPriority)) {
        rows.push([k, String(v)])
      }
      rows.push(['คะแนนเฉลี่ย', String(data.workOrders.avgRating ?? '-')])
      rows.push(['เวลาตอบกลับเฉลี่ย', data.meta.avgResponseTimeLabel])
      rows.push([])
      rows.push(['หัวข้อยอดนิยม', t('common.quantity')])
      for (const s of data.workOrders.bySubject) {
        rows.push([s.subject, String(s.count)])
      }
      rows.push([])
      rows.push([t('role.staff'), 'รับ', 'เสร็จ'])
      for (const s of data.workOrders.byStaff) {
        rows.push([s.name, String(s.count), String(s.completed)])
      }
      rows.push([])
    }

    if (data.stock) {
      rows.push(['==== สต๊อก ===='])
      rows.push(['รับเข้า', String(data.stock.totalIn)])
      rows.push(['จ่ายออก', String(data.stock.totalOut)])
      rows.push(['มูลค่ารวม', formatBaht(data.stock.totalValue, lang)])
      rows.push([])
      rows.push(['รายการยอดนิยม', t('common.code'), t('common.quantity'), t('common.type')])
      for (const t of data.stock.topItems) {
        rows.push([
          t.productName,
          t.productCode ?? '',
          String(t.quantity),
          t.type,
        ])
      }
      rows.push([])
      rows.push(['รายการคงเหลือต่ำกว่าขั้นต่ำ', t('common.code'), 'คงเหลือ', 'ขั้นต่ำ', t('common.unit')])
      for (const l of data.stock.lowStockItems) {
        rows.push([
          l.productName,
          l.productCode,
          String(l.quantity),
          String(l.minQuantity),
          l.unit,
        ])
      }
      rows.push([])
    }

    if (data.devices) {
      rows.push(['==== อุปกรณ์ ===='])
      rows.push([t('common.all'), String(data.devices.total)])
      rows.push(['เพิ่มใหม่ในเดือน', String(data.devices.newDevices)])
      rows.push([t('common.status'), t('common.quantity')])
      for (const [k, v] of Object.entries(data.devices.byStatus)) {
        rows.push([STATUS_LABELS_DEV[k] ?? k, String(v)])
      }
      rows.push([])
    }

    const csv = rows
      .map((r) =>
        r
          .map((cell) => {
            const s = String(cell ?? '')
            if (s.includes(',') || s.includes('"') || s.includes('\n')) {
              return `"${s.replace(/"/g, '""')}"`
            }
            return s
          })
          .join(','),
      )
      .join('\n')
    // Prepend BOM so Excel reads Thai correctly
    const blob = new Blob(['\uFEFF' + csv], {
      type: 'text/csv;charset=utf-8;',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `monthly-report-${data.month}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('ส่งออก CSV แล้ว')
  }

  // ============================================================
  // Print report (Task ID: MONTHLY-REPORT-PRINT)
  // ============================================================

  /** Open the print dialog with sections pre-selected per report type. */
  function openPrintDialog(kind: PrintSectionKey) {
    const presets: Record<typeof kind, PrintSections> = {
      paper:       { paper: true,  devices: false, workOrders: false, stock: false, meters: true  },
      devices:     { paper: false, devices: true,  workOrders: false, stock: false, meters: false },
      workOrders:  { paper: false, devices: false, workOrders: true,  stock: false, meters: false },
      stock:       { paper: false, devices: false, workOrders: false, stock: true,  meters: false },
      meters:      { paper: false, devices: false, workOrders: false, stock: false, meters: true  },
    }
    setPrintSections(presets[kind])
    setPrintDialogOpen(true)
  }

  function togglePrintSection(key: PrintSectionKey) {
    setPrintSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  /** Fetch meter readings for the selected month from the authed endpoint. */
  async function fetchMeterReadingsForMonth(targetMonth: string): Promise<MeterReadingRow[]> {
    try {
      const url = `/api/itam/meter-readings?month=${encodeURIComponent(targetMonth)}&limit=100`
      const res = await fetch(url, { headers: getAuthHeaders() })
      if (!res.ok) return []
      const json = await res.json()
      const readings = (json?.readings ?? []) as Array<Record<string, unknown>>
      return readings.map((r) => {
        const dev = (r.device as Record<string, unknown> | null) ?? null
        // `dev` is nullable — read `brand` through a local so the narrowing
        // holds across both property accesses in the template literal.
        const devBrand = dev?.brand as string | undefined
        return {
          id: String(r.id ?? ''),
          assetCode: (r.assetCode as string) ?? dev?.assetCode ?? null,
          deviceName: devBrand ? `${devBrand} ${dev?.model ?? ''}`.trim() : null,
          brand: (dev?.brand as string) ?? null,
          model: (dev?.model as string) ?? null,
          site: (dev?.site as string) ?? null,
          readingDate: String(r.readingDate ?? ''),
          readingMonth: (r.readingMonth as string) ?? null,
          meterBw: Number(r.meterBw ?? 0),
          meterColor: Number(r.meterColor ?? 0),
          pagesBw: Number(r.pagesBw ?? 0),
          pagesColor: Number(r.pagesColor ?? 0),
          readingType: (r.readingType as string) ?? null,
          readBy: (r.readBy as string) ?? null,
          remark: (r.remark as string) ?? null,
        }
      })
    } catch {
      return []
    }
  }

  /** Fetch the full device list for the print report. */
  async function fetchDevicesForPrint(): Promise<DeviceRow[]> {
    try {
      const res = await fetch('/api/devices', { headers: getAuthHeaders() })
      if (!res.ok) return []
      const json = await res.json()
      const list = (json?.devices ?? []) as Array<Record<string, unknown>>
      return list.map((d) => ({
        id: String(d.id ?? ''),
        assetCode: String(d.assetCode ?? ''),
        name: String(d.name ?? ''),
        brand: String(d.brand ?? ''),
        model: String(d.model ?? ''),
        type: String(d.type ?? 'OTHER'),
        status: String(d.status ?? t('status.active')),
        site: String(d.site ?? ''),
        department: (d.department as string) ?? null,
        location: (d.location as string) ?? null,
        lastMeterBw: Number(d.lastMeterBw ?? 0),
        lastMeterColor: Number(d.lastMeterColor ?? 0),
      }))
    } catch {
      return []
    }
  }

  /** Build the self-contained printable HTML page (string). */
  function buildPrintHTML(opts: {
    sections: PrintSections
    report: MonthlyReportData
    meterRows: MeterReadingRow[]
    deviceRows: DeviceRow[]
    siteLabel: string
  }): string {
    const { sections, report, meterRows, deviceRows, siteLabel } = opts
    const monthLabel = formatMonthLabel(report.month, lang)
    const generatedLabel = report.generatedAt ? new Date(report.generatedAt).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB') : '—'
    const todayLabel = new Date().toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')

    // Group helpers
    //
    // NOTE: the generic is constrained to `object`, not
    // `Record<string, unknown>`. An `interface` (e.g. `DeviceRow`) has no
    // implicit index signature, so it does NOT satisfy a
    // `Record<string, unknown>` constraint — using one here made every
    // `groupCount(deviceRows, 'status')` call fail to typecheck even though
    // the runtime access is perfectly safe.
    function groupCount<T extends object>(
      rows: T[],
      key: keyof T,
    ): Array<{ key: string; count: number }> {
      const m = new Map<string, number>()
      for (const r of rows) {
        const k = String(r[key] ?? '—')
        m.set(k, (m.get(k) ?? 0) + 1)
      }
      return Array.from(m.entries())
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count)
    }

    function tableRows(rows: Array<Array<string | number>>, aligns?: Array<'l' | 'r' | 'c'>): string {
      return rows
        .map(
          (r) =>
            `<tr>${r
              .map((c, j) => {
                const a = aligns?.[j] ?? 'l'
                const style = a === 'r'
                  ? 'text-align:right;'
                  : a === 'c'
                    ? 'text-align:center;'
                    : ''
                return `<td style="${style}">${escHtml(c)}</td>`
              })
              .join('')}</tr>`,
        )
        .join('')
    }

    // ── Section: Paper Usage Summary ──
    let paperSection = ''
    if (sections.paper) {
      const totalBw = meterRows.reduce((s, r) => s + (r.pagesBw || 0), 0)
      const totalColor = meterRows.reduce((s, r) => s + (r.pagesColor || 0), 0)
      const totalPages = totalBw + totalColor
      const byDevice = new Map<string, { bw: number; color: number; name: string }>()
      for (const r of meterRows) {
        const k = r.assetCode ?? r.deviceName ?? '—'
        const prev = byDevice.get(k) ?? { bw: 0, color: 0, name: r.deviceName ?? k }
        prev.bw += r.pagesBw || 0
        prev.color += r.pagesColor || 0
        byDevice.set(k, prev)
      }
      const deviceRowsHtml = Array.from(byDevice.entries())
        .sort((a, b) => (b[1].bw + b[1].color) - (a[1].bw + a[1].color))
        .slice(0, 20)
        .map(([k, v]) =>
          `<tr><td>${escHtml(k)}</td><td>${escHtml(v.name)}</td><td style="text-align:right">${v.bw.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</td><td style="text-align:right">${v.color.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</td><td style="text-align:right"><strong>${(v.bw + v.color).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</strong></td></tr>`,
        )
        .join('')

      paperSection = `
        <section class="block">
          <h2>① รายงานสรุปการใช้กระดาษ</h2>
          <div class="kpi-grid">
            <div class="kpi"><div class="kpi-label">กระดาษขาว-ดำ</div><div class="kpi-value">${totalBw.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</div><div class="kpi-unit">แผ่น</div></div>
            <div class="kpi"><div class="kpi-label">กระดาษสี</div><div class="kpi-value">${totalColor.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</div><div class="kpi-unit">แผ่น</div></div>
            <div class="kpi"><div class="kpi-label">รวมทั้งหมด</div><div class="kpi-value accent">${totalPages.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</div><div class="kpi-unit">แผ่น</div></div>
            <div class="kpi"><div class="kpi-label">จำนวนเครื่องที่จดมิเตอร์</div><div class="kpi-value">${meterRows.length}</div><div class="kpi-unit">เครื่อง</div></div>
          </div>
          ${deviceRowsHtml ? `
            <table class="data-table">
              <thead><tr><th>รหัสอุปกรณ์</th><th>อุปกรณ์</th><th style="text-align:right">ขาว-ดำ (แผ่น)</th><th style="text-align:right">สี (แผ่น)</th><th style="text-align:right">รวม</th></tr></thead>
              <tbody>${deviceRowsHtml}</tbody>
            </table>` : '<p class="muted">ไม่มีข้อมูลจดมิเตอร์ในเดือนที่เลือก</p>'}
        </section>`
    }

    // ── Section: Device Status ──
    let deviceSection = ''
    if (sections.devices) {
      const byStatus = groupCount(deviceRows, 'status')
      // groupCount() indexes rows by an object KEY, so pass the raw field name
      // ('type'). Passing t('reports.unit.type') resolved to the localized word
      // (e.g. "ประเภท"), which matched no property and collapsed every device
      // into a single bogus group.
      const byType = groupCount(deviceRows, 'type')
      const bySite = groupCount(deviceRows, 'site')
      const total = deviceRows.length

      const statusRows = tableRows(
        byStatus.map((r) => [
          STATUS_LABELS_DEV[r.key] ?? r.key,
          r.count,
          total > 0 ? `${Math.round((r.count / total) * 100)}%` : '0%',
        ]),
        ['l', 'r', 'r'],
      )
      const typeRows = tableRows(
        byType.map((r) => [
          DEVICE_TYPE_LABELS[r.key] ?? r.key,
          r.count,
          total > 0 ? `${Math.round((r.count / total) * 100)}%` : '0%',
        ]),
        ['l', 'r', 'r'],
      )
      const siteRowsHtml = tableRows(
        bySite.map((r) => [r.key, r.count, total > 0 ? `${Math.round((r.count / total) * 100)}%` : '0%']),
        ['l', 'r', 'r'],
      )

      const newDevices = report.devices?.newDevices ?? 0
      deviceSection = `
        <section class="block">
          <h2>② รายงานสถานะอุปกรณ์</h2>
          <div class="kpi-grid">
            <div class="kpi"><div class="kpi-label">อุปกรณ์ทั้งหมด</div><div class="kpi-value">${total}</div><div class="kpi-unit">เครื่อง</div></div>
            <div class="kpi"><div class="kpi-label">เพิ่มใหม่ในเดือน</div><div class="kpi-value accent">${newDevices}</div><div class="kpi-unit">เครื่อง</div></div>
            <div class="kpi"><div class="kpi-label">สถานะที่พบ</div><div class="kpi-value">${byStatus.length}</div><div class="kpi-unit">ประเภท</div></div>
            <div class="kpi"><div class="kpi-label">ไซต์ที่พบ</div><div class="kpi-value">${bySite.length}</div><div class="kpi-unit">ไซต์</div></div>
          </div>
          <div class="two-col">
            <div>
              <h3 class="sub-h">ตามสถานะ</h3>
              <table class="data-table">
                <thead><tr><th>สถานะ</th><th style="text-align:right">จำนวน</th><th style="text-align:right">%</th></tr></thead>
                <tbody>${statusRows || '<tr><td colspan="3" class="muted">ไม่มีข้อมูล</td></tr>'}</tbody>
              </table>
            </div>
            <div>
              <h3 class="sub-h">ตามประเภท</h3>
              <table class="data-table">
                <thead><tr><th>ประเภท</th><th style="text-align:right">จำนวน</th><th style="text-align:right">%</th></tr></thead>
                <tbody>${typeRows || '<tr><td colspan="3" class="muted">ไม่มีข้อมูล</td></tr>'}</tbody>
              </table>
            </div>
          </div>
          <h3 class="sub-h">ตามไซต์</h3>
          <table class="data-table">
            <thead><tr><th>ไซต์</th><th style="text-align:right">จำนวน</th><th style="text-align:right">%</th></tr></thead>
            <tbody>${siteRowsHtml || '<tr><td colspan="3" class="muted">ไม่มีข้อมูล</td></tr>'}</tbody>
          </table>
        </section>`
    }

    // ── Section: Work Orders ──
    let woSection = ''
    if (sections.workOrders && report.workOrders) {
      const wo = report.workOrders
      const statusRows = tableRows(
        Object.entries(wo.byStatus).map(([k, v]) => [STATUS_LABELS[k] ?? k, v]),
        ['l', 'r'],
      )
      const priorityRows = tableRows(
        Object.entries(wo.byPriority).map(([k, v]) => [k, v]),
        ['l', 'r'],
      )
      const staffRows = tableRows(
        wo.byStaff.map((s) => [
          s.name,
          s.count,
          s.completed,
          s.count > 0 ? `${Math.round((s.completed / s.count) * 100)}%` : '0%',
        ]),
        ['l', 'r', 'r', 'r'],
      )
      const subjectRows = tableRows(
        wo.bySubject.slice(0, 15).map((s) => [s.subject, s.count]),
        ['l', 'r'],
      )
      woSection = `
        <section class="block">
          <h2>③ รายงานใบแจ้งซ่อม</h2>
          <div class="kpi-grid">
            <div class="kpi"><div class="kpi-label">ใบงานทั้งหมด</div><div class="kpi-value">${wo.total}</div><div class="kpi-unit">ใบ</div></div>
            <div class="kpi"><div class="kpi-label">เสร็จสิ้น</div><div class="kpi-value accent">${wo.byStatus.COMPLETED ?? 0}</div><div class="kpi-unit">ใบ</div></div>
            <div class="kpi"><div class="kpi-label">คะแนนเฉลี่ย</div><div class="kpi-value">${wo.avgRating !== null ? wo.avgRating.toFixed(2) : '—'}</div><div class="kpi-unit">ดาว</div></div>
            <div class="kpi"><div class="kpi-label">เวลาตอบกลับเฉลี่ย</div><div class="kpi-value" style="font-size:18px">${escHtml(report.meta.avgResponseTimeLabel)}</div><div class="kpi-unit">แจ้ง → มอบหมาย</div></div>
          </div>
          <div class="two-col">
            <div>
              <h3 class="sub-h">ตามสถานะ</h3>
              <table class="data-table">
                <thead><tr><th>สถานะ</th><th style="text-align:right">จำนวน</th></tr></thead>
                <tbody>${statusRows || '<tr><td colspan="2" class="muted">ไม่มีข้อมูล</td></tr>'}</tbody>
              </table>
            </div>
            <div>
              <h3 class="sub-h">ตามความเร่งด่วน</h3>
              <table class="data-table">
                <thead><tr><th>ความเร่งด่วน</th><th style="text-align:right">จำนวน</th></tr></thead>
                <tbody>${priorityRows || '<tr><td colspan="2" class="muted">ไม่มีข้อมูล</td></tr>'}</tbody>
              </table>
            </div>
          </div>
          <h3 class="sub-h">ผลงานช่าง</h3>
          <table class="data-table">
            <thead><tr><th>ช่าง/เจ้าหน้าที่</th><th style="text-align:right">รับ</th><th style="text-align:right">เสร็จ</th><th style="text-align:right">% เสร็จ</th></tr></thead>
            <tbody>${staffRows || '<tr><td colspan="4" class="muted">ไม่มีข้อมูล</td></tr>'}</tbody>
          </table>
          <h3 class="sub-h">หัวข้อยอดนิยม (Top 15)</h3>
          <table class="data-table">
            <thead><tr><th>หัวข้อ</th><th style="text-align:right">จำนวน</th></tr></thead>
            <tbody>${subjectRows || '<tr><td colspan="2" class="muted">ไม่มีข้อมูล</td></tr>'}</tbody>
          </table>
        </section>`
    }

    // ── Section: Stock ──
    let stockSection = ''
    if (sections.stock && report.stock) {
      const st = report.stock
      const topRows = tableRows(
        st.topItems.slice(0, 20).map((t) => [
          t.productName,
          t.productCode ?? '—',
          t.type === 'IN' ? 'รับเข้า' : t.type === 'OUT' ? 'จ่ายออก' : t.type === 'ADJUST' ? 'ปรับปรุง' : t.type,
          t.quantity,
        ]),
        ['l', 'l', 'c', 'r'],
      )
      const lowRows = tableRows(
        st.lowStockItems.map((l) => [
          l.productName,
          l.productCode,
          l.quantity,
          l.minQuantity,
          l.unit,
        ]),
        ['l', 'l', 'r', 'r', 'c'],
      )
      stockSection = `
        <section class="block">
          <h2>④ รายงานสต๊อก</h2>
          <div class="kpi-grid">
            <div class="kpi"><div class="kpi-label">รับเข้า</div><div class="kpi-value accent">${st.totalIn}</div><div class="kpi-unit">หน่วย</div></div>
            <div class="kpi"><div class="kpi-label">จ่ายออก</div><div class="kpi-value">${st.totalOut}</div><div class="kpi-unit">หน่วย</div></div>
            <div class="kpi"><div class="kpi-label">มูลค่ารวม</div><div class="kpi-value" style="font-size:18px">${escHtml(formatBaht(st.totalValue, lang))}</div><div class="kpi-unit">บาท</div></div>
            <div class="kpi"><div class="kpi-label">คงเหลือต่ำกว่าขั้นต่ำ</div><div class="kpi-value" style="color:#ef4444">${st.lowStockItems.length}</div><div class="kpi-unit">รายการ</div></div>
          </div>
          <h3 class="sub-h">รายการสต๊อกยอดนิยม (Top 20)</h3>
          <table class="data-table">
            <thead><tr><th>สินค้า</th><th>รหัส</th><th style="text-align:center">ประเภท</th><th style="text-align:right">จำนวน</th></tr></thead>
            <tbody>${topRows || '<tr><td colspan="4" class="muted">ไม่มีรายการ</td></tr>'}</tbody>
          </table>
          <h3 class="sub-h">รายการคงเหลือต่ำกว่าขั้นต่ำ</h3>
          <table class="data-table">
            <thead><tr><th>สินค้า</th><th>รหัส</th><th style="text-align:right">คงเหลือ</th><th style="text-align:right">ขั้นต่ำ</th><th style="text-align:center">หน่วย</th></tr></thead>
            <tbody>${lowRows || '<tr><td colspan="5" class="muted">ไม่มีรายการ — ยอดเยี่ยม!</td></tr>'}</tbody>
          </table>
        </section>`
    }

    // ── Section: Meter Readings ──
    let meterSection = ''
    if (sections.meters) {
      const meterRowsHtml = meterRows
        .slice(0, 200)
        .map((r) => {
          const dateLabel = r.readingDate
            ? new Date(r.readingDate).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB')
            : '—'
          const typeLabel = r.readingType
            ? (READING_TYPE_LABELS[r.readingType] ?? r.readingType)
            : '—'
          return `<tr>
            <td>${escHtml(r.assetCode ?? '—')}</td>
            <td>${escHtml(r.deviceName ?? '—')}</td>
            <td>${escHtml(r.site ?? '—')}</td>
            <td>${escHtml(dateLabel)}</td>
            <td style="text-align:right">${(r.meterBw ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</td>
            <td style="text-align:right">${(r.meterColor ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</td>
            <td style="text-align:right"><strong>${((r.pagesBw ?? 0) + (r.pagesColor ?? 0)).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</strong></td>
            <td style="text-align:center">${escHtml(typeLabel)}</td>
            <td>${escHtml(r.readBy ?? '—')}</td>
          </tr>`
        })
        .join('')
      const totalBw = meterRows.reduce((s, r) => s + (r.pagesBw || 0), 0)
      const totalColor = meterRows.reduce((s, r) => s + (r.pagesColor || 0), 0)
      meterSection = `
        <section class="block">
          <h2>⑤ รายงานมิเตอร์</h2>
          <div class="kpi-grid">
            <div class="kpi"><div class="kpi-label">จำนวนรายการจดมิเตอร์</div><div class="kpi-value">${meterRows.length}</div><div class="kpi-unit">รายการ</div></div>
            <div class="kpi"><div class="kpi-label">กระดาษขาว-ดำรวม</div><div class="kpi-value">${totalBw.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</div><div class="kpi-unit">แผ่น</div></div>
            <div class="kpi"><div class="kpi-label">กระดาษสีรวม</div><div class="kpi-value">${totalColor.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</div><div class="kpi-unit">แผ่น</div></div>
            <div class="kpi"><div class="kpi-label">รวมทั้งหมด</div><div class="kpi-value accent">${(totalBw + totalColor).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</div><div class="kpi-unit">แผ่น</div></div>
          </div>
          <table class="data-table">
            <thead><tr>
              <th>รหัสอุปกรณ์</th><th>อุปกรณ์</th><th>ไซต์</th><th>วันที่จด</th>
              <th style="text-align:right">มิเตอร์ขาว-ดำ</th>
              <th style="text-align:right">มิเตอร์สี</th>
              <th style="text-align:right">แผ่นที่ใช้</th>
              <th style="text-align:center">ประเภท</th>
              <th>ผู้จดมิเตอร์</th>
            </tr></thead>
            <tbody>${meterRowsHtml || '<tr><td colspan="9" class="muted">ไม่มีข้อมูลมิเตอร์ในเดือนที่เลือก</td></tr>'}</tbody>
          </table>
        </section>`
    }

    return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>รายงานรายเดือน ${escHtml(monthLabel)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: 'Segoe UI', 'Thonburi', 'Tahoma', sans-serif;
    color: #1e293b; background: #f1f5f9;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  body { padding: 16px; display: flex; justify-content: center; }
  .sheet {
    background: #fff; width: 100%; max-width: 210mm;
    padding: 14mm 12mm; border-radius: 8px;
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
    font-size: 24px; font-weight: 700; flex-shrink: 0;
  }
  .header .title-block { flex: 1; }
  .header h1 { margin: 0; font-size: 20px; color: #0f172a; }
  .header .subtitle { font-size: 11px; color: #64748b; margin-top: 2px; }
  .header .meta { text-align: right; font-size: 11px; color: #475569; line-height: 1.55; }
  .header .meta strong { color: #0f172a; font-size: 12px; }

  .block { margin-top: 14px; page-break-inside: avoid; }
  .block h2 {
    font-size: 14px; color: #0f172a;
    border-left: 4px solid #f97316;
    padding: 4px 0 4px 10px; margin: 0 0 8px 0;
    background: #fff7ed; border-radius: 0 4px 4px 0;
  }
  .sub-h {
    font-size: 12px; color: #475569; font-weight: 600;
    margin: 12px 0 4px 0;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .kpi-grid {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 8px; margin: 8px 0;
  }
  .kpi {
    background: #f8fafc; border: 1px solid #e2e8f0;
    border-radius: 6px; padding: 8px 10px;
  }
  .kpi-label {
    font-size: 10px; color: #64748b;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .kpi-value { font-size: 22px; font-weight: 700; color: #0f172a; line-height: 1.2; }
  .kpi-value.accent { color: #f97316; }
  .kpi-unit { font-size: 10px; color: #94a3b8; margin-top: 2px; }

  .two-col {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .data-table {
    width: 100%; border-collapse: collapse;
    font-size: 11px; margin-top: 4px;
  }
  .data-table thead th {
    background: #f1f5f9; color: #475569;
    text-align: left; padding: 6px 8px;
    border: 1px solid #e2e8f0; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.03em; font-size: 10px;
  }
  .data-table tbody td {
    padding: 5px 8px; border: 1px solid #e2e8f0;
    vertical-align: top;
  }
  .data-table tbody tr:nth-child(even) td { background: #fafbfc; }
  .muted { color: #94a3b8; font-style: italic; text-align: center; padding: 8px !important; }

  .footer {
    margin-top: 18px; padding-top: 8px;
    border-top: 1px solid #e2e8f0;
    display: flex; justify-content: space-between;
    font-size: 10px; color: #94a3b8;
  }

  .print-btn-bar {
    position: fixed; bottom: 16px; right: 16px;
    display: flex; gap: 8px; z-index: 99;
  }
  .print-btn-bar button {
    padding: 9px 16px; border-radius: 6px; border: none;
    background: #f97316; color: #fff;
    font-size: 13px; font-weight: 600; cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  }
  .print-btn-bar button.secondary { background: #64748b; }

  @media print {
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; border-radius: 0; padding: 0; max-width: 100%; }
    .print-btn-bar { display: none !important; }
    .block { page-break-inside: avoid; }
    h2 { page-break-after: avoid; }
    .data-table thead th { background: #f1f5f9 !important; }
  }
  @media (max-width: 640px) {
    .kpi-grid { grid-template-columns: repeat(2, 1fr); }
    .two-col { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div class="logo"></div>
      <div class="title-block">
        <h1>รายงานรายเดือน</h1>
        <div class="subtitle">รายงานประจำเดือน • ระบบบริหารจัดการสินทรัพย์ IT</div>
      </div>
      <div class="meta">
        <strong>เดือน: ${escHtml(monthLabel)}</strong><br/>
        ไซต์: ${escHtml(siteLabel)}<br/>
        สร้างเมื่อ: ${escHtml(generatedLabel)}
      </div>
    </div>

    ${paperSection}
    ${deviceSection}
    ${woSection}
    ${stockSection}
    ${meterSection}

    <div class="footer">
      <span>เอกสารสร้างโดยระบบบริหารจัดการสินทรัพย์</span>
      <span>พิมพ์เมื่อ ${escHtml(todayLabel)}</span>
    </div>
  </div>

  <div class="print-btn-bar">
    <button type="button" onclick="window.print()">🖨 พิมพ์</button>
    <button type="button" class="secondary" onclick="window.close()">ปิด</button>
  </div>
</body>
</html>`
  }

  /** Open the generated print HTML in a new window. */
  async function handlePrintReport() {
    if (!data) {
      toast.error('ยังไม่มีข้อมูลรายงาน กรุณารอให้โหลดเสร็จก่อน')
      return
    }
    const hasAny = Object.values(printSections).some(Boolean)
    if (!hasAny) {
      toast.error('กรุณาเลือกอย่างน้อย 1 ส่วนที่จะพิมพ์')
      return
    }
    setPrintBusy(true)
    try {
      let meterRows: MeterReadingRow[] = []
      let deviceRows: DeviceRow[] = []
      if (printSections.paper || printSections.meters) {
        meterRows = await fetchMeterReadingsForMonth(data.month)
      }
      if (printSections.devices) {
        deviceRows = await fetchDevicesForPrint()
      }
      const siteLabel = site === 'all' ? 'ทุกไซต์' : `ไซต์ ${site}`
      const html = buildPrintHTML({
        sections: printSections,
        report: data,
        meterRows,
        deviceRows,
        siteLabel,
      })
      // ── Inject into hidden print container + fire window.print()
      // on the SAME page (Task ID: PRINT-MEDIA-QUERY-012). ──
      setPrintHtml(html)
      setTimeout(() => window.print(), 50)
      setTimeout(() => setPrintHtml(''), 1000)
      setPrintDialogOpen(false)
      toast.success('กำลังเปิดหน้าพิมพ์…')
    } catch (err) {
      console.error('handlePrintReport', err)
      toast.error('เปิดหน้าพิมพ์ไม่สำเร็จ')
    } finally {
      setPrintBusy(false)
    }
  }

  const wo = data?.workOrders ?? null
  const stock = data?.stock ?? null
  const devices = data?.devices ?? null

  return (
    <div className="print-area flex h-full flex-col gap-4 p-4 md:p-6">
      {/* === Header / Controls === */}
      <Card className="print-hide flex-shrink-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <CalendarDays className="h-5 w-5 text-orange-500" />
                รายงานรายเดือน
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                สรุปผลการปฏิบัติงานรายเดือน — ใบงาน สต๊อก และอุปกรณ์
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => refetch()}
                disabled={isFetching}
                className="h-8"
              >
                <RefreshCw
                  className={`mr-1 h-3.5 w-3.5 ${
                    isFetching ? 'animate-spin' : ''
                  }`}
                />
                Refresh
              </Button>

              {/* PrintReport — Task ID: MONTHLY-REPORT-PRINT */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    disabled={!data}
                    className="h-8 bg-orange-500 hover:bg-orange-600"
                  >
                    <Printer className="mr-1 h-3.5 w-3.5" />
                    พิมพ์รายงาน
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-64"
                >
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    เลือกประเภทรายงานที่จะพิมพ์
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => openPrintDialog('paper')}
                    className="cursor-pointer gap-2"
                  >
                    <FileText className="h-4 w-4 text-orange-500" />
                    <div className="flex flex-col">
                      <span>รายงานสรุปการใช้กระดาษ</span>
                      <span className="text-[10px] text-muted-foreground">
                        สรุปจำนวนที่พิมพ์รายเดือน
                      </span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => openPrintDialog('devices')}
                    className="cursor-pointer gap-2"
                  >
                    <Layers className="h-4 w-4 text-indigo-500" />
                    <div className="flex flex-col">
                      <span>รายงานสถานะอุปกรณ์</span>
                      <span className="text-[10px] text-muted-foreground">
                        ตามสถานะ/ประเภท/ไซต์
                      </span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => openPrintDialog('workOrders')}
                    className="cursor-pointer gap-2"
                  >
                    <Wrench className="h-4 w-4 text-amber-500" />
                    <div className="flex flex-col">
                      <span>รายงานใบแจ้งซ่อม</span>
                      <span className="text-[10px] text-muted-foreground">
                        สถานะ/ความเร่งด่วน/ช่าง
                      </span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => openPrintDialog('stock')}
                    className="cursor-pointer gap-2"
                  >
                    <Package className="h-4 w-4 text-emerald-500" />
                    <div className="flex flex-col">
                      <span>รายงานสต๊อก</span>
                      <span className="text-[10px] text-muted-foreground">
                        ระดับสต๊อก + เตือนคงเหลือต่ำกว่าขั้นต่ำ
                      </span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => openPrintDialog('meters')}
                    className="cursor-pointer gap-2"
                  >
                    <Gauge className="h-4 w-4 text-cyan-500" />
                    <div className="flex flex-col">
                      <span>รายงานมิเตอร์</span>
                      <span className="text-[10px] text-muted-foreground">
                        การจดมิเตอร์ของเดือน
                      </span>
                    </div>
                  </DropdownMenuItem>
                  {/* ReportSpecial (Approve) — Task ID: SPECIALFEE-WOPATTERN-APPROVAL */}
                  <DropdownMenuItem
                    onSelect={() => openSpecialFeeApprovalReport()}
                    disabled={approvalBusy}
                    className="cursor-pointer gap-2"
                  >
                    <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-200">
                      💰
                    </Badge>
                    <div className="flex flex-col">
                      <span>รายงานค่าใช้จ่ายพิเศษ (อนุมัติ)</span>
                      <span className="text-[10px] text-muted-foreground">
                        เฉพาะใบงานที่มีค่าใช้จ่าย — แยกตามช่าง/ไซต์
                      </span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => handleExportCSV()}
                    className="cursor-pointer gap-2"
                  >
                    <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                    <div className="flex flex-col">
                      <span>ส่งออก CSV</span>
                      <span className="text-[10px] text-muted-foreground">
                        ดาวน์โหลดข้อมูลรายงานปัจจุบัน
                      </span>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                size="sm"
                variant="outline"
                onClick={handlePrint}
                disabled={!data}
                className="h-8"
                title="พิมพ์หน้าปัจจุบันทันที"
              >
                <Printer className="mr-1 h-3.5 w-3.5" />
                พิมพ์หน้านี้
              </Button>
              {/* PrintwithTemplate — Task ID: FIX-1-2-EXPORT-PRINT */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPrintTemplateOpen(true)}
                disabled={!data}
                className="h-8 border-[#f97316] text-[#f97316] hover:bg-[#f97316]/10 dark:border-[#fb923c] dark:text-[#fb923c]"
                title="เลือกเทมเพลตก่อนพิมพ์"
              >
                <Printer className="mr-1 h-3.5 w-3.5" />
                พิมพ์ด้วยเทมเพลต
              </Button>
              <Button
                size="sm"
                onClick={handleExportCSV}
                disabled={!data}
                className="h-8 bg-orange-500 hover:bg-orange-600"
                title="ส่งออก CSV"
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                CSV
              </Button>
              <CustomColumnSelector
                storageKey="monthly-report-cols"
                columns={MONTHLY_REPORT_COLUMNS}
                selected={selectedColumns}
                onChange={setSelectedColumns}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="mr-month" className="text-xs">
                เดือน
              </Label>
              <Input
                id="mr-month"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value || currentMonthValue())}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mr-site" className="text-xs">
                ไซต์ (ไม่บังคับ)
              </Label>
              <Select value={site} onValueChange={setSite}>
                <SelectTrigger id="mr-site" className="h-9">
                  <SelectValue placeholder="ทุกไซต์" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทุกไซต์</SelectItem>
                  {sites.map((s) => (
                    <SelectItem key={s.id} value={s.code}>
                      {s.name} ({s.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">ประเภทรายงาน</Label>
              <Tabs
                value={reportType}
                onValueChange={(v) => setReportType(v as ReportType)}
              >
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="all">ทั้งหมด</TabsTrigger>
                  <TabsTrigger value="work-order">ใบงาน</TabsTrigger>
                  <TabsTrigger value="stock">สต๊อก</TabsTrigger>
                  <TabsTrigger value="devices">อุปกรณ์</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
          {data && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="gap-1">
                <CalendarDays className="h-3 w-3" />
                {formatMonthLabel(data.month, lang)}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <Building2 className="h-3 w-3" />
                {site === 'all' ? 'ทุกไซต์' : `ไซต์ ${site}`}
              </Badge>
              <span className="text-[11px]">
                สร้างเมื่อ {data.generatedAt ? new Date(data.generatedAt).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB') : '—'}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ReportSkeleton />
        </div>
      ) : !data ? (
        <Card className="min-h-0 flex-1">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            ไม่สามารถโหลดรายงานได้
          </CardContent>
        </Card>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto"
        >
          {/* === Summary cards === */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {wo && (
              <>
                <SummaryCard
                  title="ใบงานทั้งหมด"
                  value={String(wo.total)}
                  icon={<Wrench className="h-5 w-5" />}
                  accent="#f97316"
                  hint={`เดือน ${formatMonthLabel(data.month, lang)}`}
                />
                <SummaryCard
                  title="เสร็จสิ้น"
                  value={String(wo.byStatus.COMPLETED ?? 0)}
                  icon={<CheckCircle2 className="h-5 w-5" />}
                  accent="#10b981"
                  hint={`${
                    wo.total > 0
                      ? Math.round(
                          ((wo.byStatus.COMPLETED ?? 0) / wo.total) * 100,
                        )
                      : 0
                  }% ของทั้งหมด`}
                />
                <SummaryCard
                  title="คะแนนเฉลี่ย"
                  value={wo.avgRating !== null ? wo.avgRating.toFixed(2) : '—'}
                  icon={<Star className="h-5 w-5" />}
                  accent="#f59e0b"
                  hint="จากการรีวิว"
                />
                <SummaryCard
                  title="เวลาตอบกลับเฉลี่ย"
                  value={data.meta.avgResponseTimeLabel}
                  icon={<RefreshCw className="h-5 w-5" />}
                  accent="#3b82f6"
                  hint="แจ้ง → มอบหมาย"
                />
              </>
            )}
            {stock && (
              <>
                <SummaryCard
                  title="รับเข้า"
                  value={String(stock.totalIn)}
                  icon={<TrendingUp className="h-5 w-5" />}
                  accent="#10b981"
                  hint="หน่วยรวม"
                />
                <SummaryCard
                  title="จ่ายออก"
                  value={String(stock.totalOut)}
                  icon={<TrendingDown className="h-5 w-5" />}
                  accent="#ef4444"
                  hint="หน่วยรวม"
                />
                <SummaryCard
                  title="มูลค่าสต๊อก"
                  value={formatBaht(stock.totalValue, lang)}
                  icon={<Package className="h-5 w-5" />}
                  accent="#0d9488"
                  hint="รวมทุกไซต์ที่เลือก"
                />
                <SummaryCard
                  title="คงเหลือต่ำกว่าขั้นต่ำ"
                  value={String(stock.lowStockItems.length)}
                  icon={<AlertTriangle className="h-5 w-5" />}
                  accent="#f59e0b"
                  hint="ต่ำกว่าขั้นต่ำ"
                />
              </>
            )}
            {devices && (
              <>
                <SummaryCard
                  title="อุปกรณ์ทั้งหมด"
                  value={String(devices.total)}
                  icon={<Cpu className="h-5 w-5" />}
                  accent="#6366f1"
                  hint="ในระบบ"
                />
                <SummaryCard
                  title="เพิ่มใหม่"
                  value={String(devices.newDevices)}
                  icon={<TrendingUp className="h-5 w-5" />}
                  accent="#10b981"
                  hint={`เดือน ${formatMonthLabel(data.month, lang)}`}
                />
              </>
            )}
          </div>

          {/* === Work Order charts === */}
          {wo && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Card className="print-break-avoid shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    ใบงานตามสถานะ
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64 w-full">
                    <VisibleResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={Object.entries(wo.byStatus)
                            .filter(([, v]) => v > 0)
                            .map(([k, v]) => ({
                              name: STATUS_LABELS[k] ?? k,
                              value: v,
                              key: k,
                            }))}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          label={(entry: { name?: string; value?: number }) =>
                            `${entry.name ?? ''}: ${entry.value ?? 0}`
                          }
                          labelLine={false}
                        >
                          {Object.entries(wo.byStatus)
                            .filter(([, v]) => v > 0)
                            .map(([k]) => (
                              <Cell
                                key={k}
                                fill={STATUS_COLORS[k] ?? '#94a3b8'}
                              />
                            ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: isDark ? '#1e293b' : '#fff',
                            border: `1px solid ${chartGridColor}`,
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                        />
                      </PieChart>
                    </VisibleResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className="print-break-avoid shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    ใบงานตามความเร่งด่วน
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64 w-full">
                    <VisibleResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={Object.entries(wo.byPriority).map(
                          ([k, v]) => ({ name: k, value: v, key: k }),
                        )}
                        margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke={chartGridColor}
                        />
                        <XAxis
                          dataKey="name"
                          tick={{ fill: chartTextColor, fontSize: 12 }}
                        />
                        <YAxis
                          tick={{ fill: chartTextColor, fontSize: 12 }}
                          allowDecimals={false}
                        />
                        <Tooltip
                          cursor={{ fill: isDark ? '#1e293b66' : '#f1f5f9' }}
                          contentStyle={{
                            backgroundColor: isDark ? '#1e293b' : '#fff',
                            border: `1px solid ${chartGridColor}`,
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                        />
                        <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                          {Object.entries(wo.byPriority).map(([k]) => (
                            <Cell
                              key={k}
                              fill={PRIORITY_COLORS[k] ?? '#94a3b8'}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </VisibleResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className="print-break-avoid shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    หัวข้อยอดนิยม (Top 10)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {wo.bySubject.length === 0 ? (
                    <EmptyHint label="ไม่มีข้อมูลหัวข้อในเดือนที่เลือก" />
                  ) : (
                    <div className="h-64 w-full">
                      <VisibleResponsiveContainer width="100%" height="100%">
                        <BarChart
                          layout="vertical"
                          data={wo.bySubject}
                          margin={{
                            top: 8,
                            right: 16,
                            left: 0,
                            bottom: 8,
                          }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke={chartGridColor}
                            horizontal={false}
                          />
                          <XAxis
                            type="number"
                            tick={{ fill: chartTextColor, fontSize: 12 }}
                            allowDecimals={false}
                          />
                          <YAxis
                            type="category"
                            dataKey="subject"
                            tick={{ fill: chartTextColor, fontSize: 11 }}
                            width={120}
                            tickFormatter={(s: string) =>
                              s.length > 16 ? s.slice(0, 16) + '…' : s
                            }
                          />
                          <Tooltip
                            cursor={{ fill: isDark ? '#1e293b66' : '#f1f5f9' }}
                            contentStyle={{
                              backgroundColor: isDark ? '#1e293b' : '#fff',
                              border: `1px solid ${chartGridColor}`,
                              borderRadius: 8,
                              fontSize: 12,
                            }}
                          />
                          <Bar
                            dataKey="count"
                            fill="#f97316"
                            radius={[0, 6, 6, 0]}
                          />
                        </BarChart>
                      </VisibleResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="print-break-avoid shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    ผลงานช่าง (รับ / เสร็จ)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {wo.byStaff.length === 0 ? (
                    <EmptyHint label="ไม่มีข้อมูลการมอบหมายในเดือนที่เลือก" />
                  ) : (
                    <div className="h-64 w-full">
                      <VisibleResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={wo.byStaff.slice(0, 10)}
                          margin={{
                            top: 8,
                            right: 16,
                            left: 0,
                            bottom: 8,
                          }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke={chartGridColor}
                          />
                          <XAxis
                            dataKey="name"
                            tick={{ fill: chartTextColor, fontSize: 10 }}
                            tickFormatter={(s: string) =>
                              s.length > 10 ? s.slice(0, 10) + '…' : s
                            }
                          />
                          <YAxis
                            tick={{ fill: chartTextColor, fontSize: 12 }}
                            allowDecimals={false}
                          />
                          <Tooltip
                            cursor={{ fill: isDark ? '#1e293b66' : '#f1f5f9' }}
                            contentStyle={{
                              backgroundColor: isDark ? '#1e293b' : '#fff',
                              border: `1px solid ${chartGridColor}`,
                              borderRadius: 8,
                              fontSize: 12,
                            }}
                          />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                          <Bar
                            dataKey="count"
                            name="รับ"
                            fill="#3b82f6"
                            radius={[6, 6, 0, 0]}
                          />
                          <Bar
                            dataKey="completed"
                            name="เสร็จ"
                            fill="#10b981"
                            radius={[6, 6, 0, 0]}
                          />
                        </BarChart>
                      </VisibleResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* === Staff performance table === */}
          {wo && wo.byStaff.length > 0 && (
            <Card className="print-break-avoid shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4 text-orange-500" />
                  ตารางผลงานช่าง
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-80 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-muted">
                      <TableRow>
                        <TableHead>{t('role.staff')}</TableHead>
                        <TableHead className="text-right">รับ</TableHead>
                        <TableHead className="text-right">เสร็จ</TableHead>
                        <TableHead className="text-right">
                          % เสร็จ
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {wo.byStaff.map((s) => (
                        <TableRow key={s.name}>
                          <TableCell className="font-medium">
                            {s.name}
                          </TableCell>
                          <TableCell className="text-right">
                            {s.count}
                          </TableCell>
                          <TableCell className="text-right text-emerald-600 dark:text-emerald-400">
                            {s.completed}
                          </TableCell>
                          <TableCell className="text-right">
                            {s.count > 0
                              ? Math.round((s.completed / s.count) * 100)
                              : 0}
                            %
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* === Stock tables === */}
          {stock && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Card className="print-break-avoid shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    รายการสต๊อกยอดนิยม (รายเดือน)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {stock.topItems.length === 0 ? (
                    <EmptyHint label="ยังไม่มีความเคลื่อนไหวในเดือนที่เลือก" />
                  ) : (
                    <div className="max-h-80 overflow-y-auto rounded-md border">
                      <Table>
                        <TableHeader className="sticky top-0 bg-muted">
                          <TableRow>
                            <TableHead>สินค้า</TableHead>
                            <TableHead>รหัส</TableHead>
                            <TableHead>ประเภท</TableHead>
                            <TableHead className="text-right">จำนวน</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {stock.topItems.map((t, idx) => (
                            <TableRow key={`${t.productCode ?? ''}-${idx}`}>
                              <TableCell className="font-medium">
                                {t.productName}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {t.productCode ?? '—'}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={
                                    t.type === 'IN'
                                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                      : t.type === 'OUT'
                                        ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                        : ''
                                  }
                                >
                                  {t.type === 'IN'
                                    ? 'รับเข้า'
                                    : t.type === 'OUT'
                                      ? 'จ่ายออก'
                                      : t.type === 'ADJUST'
                                        ? 'ปรับปรุง'
                                        : t.type}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-semibold">
                                {t.quantity}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="print-break-avoid shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    รายการคงเหลือต่ำกว่าขั้นต่ำ
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {stock.lowStockItems.length === 0 ? (
                    <EmptyHint label="ไม่มีรายการต่ำกว่าขั้นต่ำ — ยอดเยี่ยม!" />
                  ) : (
                    <div className="max-h-80 overflow-y-auto rounded-md border">
                      <Table>
                        <TableHeader className="sticky top-0 bg-muted">
                          <TableRow>
                            <TableHead>สินค้า</TableHead>
                            <TableHead>รหัส</TableHead>
                            <TableHead className="text-right">คงเหลือ</TableHead>
                            <TableHead className="text-right">ขั้นต่ำ</TableHead>
                            <TableHead>หน่วย</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {stock.lowStockItems.map((l) => (
                            <TableRow key={l.productCode}>
                              <TableCell className="font-medium">
                                {l.productName}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {l.productCode}
                              </TableCell>
                              <TableCell className="text-right font-semibold text-rose-600 dark:text-rose-400">
                                {l.quantity}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {l.minQuantity}
                              </TableCell>
                              <TableCell className="text-xs">
                                {l.unit}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* === Devices status table === */}
          {devices && Object.keys(devices.byStatus).length > 0 && (
            <Card className="print-break-avoid shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Cpu className="h-4 w-4 text-indigo-500" />
                  สรุปอุปกรณ์ตามสถานะ
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="h-56 w-full">
                    <VisibleResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={Object.entries(devices.byStatus).map(
                            ([k, v]) => ({
                              name: STATUS_LABELS_DEV[k] ?? k,
                              value: v,
                              key: k,
                            }),
                          )}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={70}
                          label={(entry: { name?: string; value?: number }) =>
                            `${entry.name ?? ''}: ${entry.value ?? 0}`
                          }
                          labelLine={false}
                        >
                          {Object.entries(devices.byStatus).map(([k]) => (
                            <Cell
                              key={k}
                              fill={DEVICE_STATUS_COLORS[k] ?? '#94a3b8'}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: isDark ? '#1e293b' : '#fff',
                            border: `1px solid ${chartGridColor}`,
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                        />
                      </PieChart>
                    </VisibleResponsiveContainer>
                  </div>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('settings.col.status')}</TableHead>
                          <TableHead className="text-right">จำนวน</TableHead>
                          <TableHead className="text-right">
                            % ของทั้งหมด
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(devices.byStatus).map(([k, v]) => (
                          <TableRow key={k}>
                            <TableCell>
                              <span className="flex items-center gap-2">
                                <span
                                  className="inline-block h-2.5 w-2.5 rounded-full"
                                  style={{
                                    backgroundColor:
                                      DEVICE_STATUS_COLORS[k] ?? '#94a3b8',
                                  }}
                                />
                                {STATUS_LABELS_DEV[k] ?? k}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {v}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              {devices.total > 0
                                ? Math.round((v / devices.total) * 100)
                                : 0}
                              %
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Footer note (print) */}
          <div className="print-only px-1 py-2 text-center text-[11px] text-muted-foreground">
            รายงานสร้างโดยระบบบริหารจัดการสินทรัพย์ •{' '}
            {new Date().toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
          </div>
        </motion.div>
      )}

      {/* === Print CSS (scoped) === */}
      <style jsx global>{`
        @media print {
          /* Hide everything outside the report */
          body * {
            visibility: hidden;
          }
          /* Show only the report area */
          .print-area,
          .print-area * {
            visibility: visible;
          }
          /* Hide controls that shouldn't print */
          .print-hide {
            display: none !important;
          }
          /* Show print-only elements */
          .print-only {
            display: block !important;
          }
          /* Reset positioning for print */
          .print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          /* Avoid breaking sections across pages */
          .print-break-avoid {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          /* Card shadow off, lighter borders */
          .print-break-avoid,
          [data-slot='card'] {
            box-shadow: none !important;
            border: 1px solid #e2e8f0 !important;
          }
        }
        /* Print-only is hidden on screen */
        .print-only {
          display: none;
        }
      `}</style>

      {/* === Print Report Dialog (Task ID: MONTHLY-REPORT-PRINT) === */}
      <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5 text-orange-500" />
              พิมพ์รายงาน
            </DialogTitle>
            <DialogDescription>
              เลือกส่วนที่ต้องการรวมในรายงาน กด “พิมพ์” เพื่อเปิดหน้าพิมพ์
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {data && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">เดือน:</span>
                  <span className="font-medium">
                    {formatMonthLabel(data.month, lang)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-muted-foreground">ไซต์:</span>
                  <span className="font-medium">
                    {site === 'all' ? 'ทุกไซต์' : `ไซต์ ${site}`}
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <PrintSectionCheckbox
                checked={printSections.paper}
                onToggle={() => togglePrintSection('paper')}
                icon={<FileText className="h-4 w-4 text-orange-500" />}
                title="รายงานสรุปการใช้กระดาษ"
                desc="จำนวนพิมพ์ขาว-ดำ/สี รวมและแยกตามเครื่อง (Top 20)"
              />
              <PrintSectionCheckbox
                checked={printSections.devices}
                onToggle={() => togglePrintSection('devices')}
                icon={<Layers className="h-4 w-4 text-indigo-500" />}
                title="รายงานสถานะอุปกรณ์"
                desc="ตามสถานะ/ประเภท/ไซต์"
              />
              <PrintSectionCheckbox
                checked={printSections.workOrders}
                onToggle={() => togglePrintSection('workOrders')}
                icon={<Wrench className="h-4 w-4 text-amber-500" />}
                title="รายงานใบแจ้งซ่อม"
                desc="สถานะ/ความเร่งด่วน/ผลงานช่าง/หัวข้อ"
              />
              <PrintSectionCheckbox
                checked={printSections.stock}
                onToggle={() => togglePrintSection('stock')}
                icon={<Package className="h-4 w-4 text-emerald-500" />}
                title="รายงานสต๊อก"
                desc="รายการยอดนิยม + คงเหลือต่ำกว่าขั้นต่ำ"
              />
              <PrintSectionCheckbox
                checked={printSections.meters}
                onToggle={() => togglePrintSection('meters')}
                icon={<Gauge className="h-4 w-4 text-cyan-500" />}
                title="รายงานมิเตอร์"
                desc="รายการจดมิเตอร์ทั้งหมดของเดือน"
              />
            </div>

            {!Object.values(printSections).some(Boolean) && (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
                ⚠ กรุณาเลือกอย่างน้อย 1 ส่วนที่จะพิมพ์
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPrintDialogOpen(false)}
              disabled={printBusy}
            >
              ยกเลิก
            </Button>
            <Button
              size="sm"
              onClick={handlePrintReport}
              disabled={printBusy || !Object.values(printSections).some(Boolean)}
              className="bg-orange-500 hover:bg-orange-600"
            >
              {printBusy ? (
                <>
                  <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />
                  กำลังเตรียม…
                </>
              ) : (
                <>
                  <Printer className="mr-1 h-3.5 w-3.5" />
                  พิมพ์
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print Template Selection Dialog — Task ID: FIX-1-2-EXPORT-PRINT */}
      <PrintTemplateSelectionDialog
        open={printTemplateOpen}
        onOpenChange={setPrintTemplateOpen}
        templateType="work-order"
        actionLabel="พิมพ์"
        onSelect={(template) => {
          toast.success(`เลือกเทมเพลต: ${template.name}`)
          if (typeof window !== 'undefined') window.print()
        }}
      />

      {/* ── Hidden print container (Task ID: PRINT-MEDIA-QUERY-012) ──
           Injects the generated report HTML and is revealed only in
           @media print via the global `.print-only` rule in globals.css. */}
      {printHtml && (
        <div
          className="print-only"
          dangerouslySetInnerHTML={{ __html: printHtml }}
          aria-hidden
        />
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────

function SummaryCard({
  title,
  value,
  icon,
  accent,
  hint,
}: {
  title: string
  value: string
  icon: React.ReactNode
  accent: string
  hint?: string
}) {
  return (
    <Card className="print-break-avoid overflow-hidden shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${accent}1a`, color: accent }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-medium text-muted-foreground">
            {title}
          </div>
          <div className="truncate text-lg font-bold">{value}</div>
          {hint && (
            <div className="truncate text-[10px] text-muted-foreground">
              {hint}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
      {label}
    </div>
  )
}

function PrintSectionCheckbox({
  checked,
  onToggle,
  icon,
  title,
  desc,
}: {
  checked: boolean
  onToggle: () => void
  icon: React.ReactNode
  title: string
  desc: string
}) {
  return (
    <label
      htmlFor={`ps-${title}`}
      className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
        checked
          ? 'border-orange-400 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/40'
          : 'border-border hover:bg-muted/40'
      }`}
    >
      <Checkbox
        id={`ps-${title}`}
        checked={checked}
        onCheckedChange={onToggle}
        className="mt-0.5"
      />
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-[11px] text-muted-foreground">{desc}</div>
        </div>
      </div>
    </label>
  )
}

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-72 w-full" />
        ))}
      </div>
    </div>
  )
}
