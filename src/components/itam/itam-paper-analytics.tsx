'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend,
} from 'recharts'
import { VisibleResponsiveContainer } from '@/components/itam/visible-responsive-container'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  RefreshCw, FileSpreadsheet, FileText, ChevronLeft, ChevronRight,
  TrendingUp, Trophy, FileBarChart, Table as TableIcon, LayoutGrid,
  Download, Activity,
} from 'lucide-react'
import { downloadCsv, dateStamp } from '@/lib/csv'
import { CustomExportDialog, type ExportColumn, type ExportFormat } from './custom-export-dialog'
import { runCustomExport } from '@/lib/custom-export'
import { canSelectSite, type DashboardRangeKey } from './types'
import { UtilizationSection } from './utilization-section'
import { useLang } from '@/store/i18n-store'
import { useAuthStore } from '@/store/auth-store'

// ============================================================
// Custom Export — Paper Analytics (Task ID: FIX-1-2-EXPORT-PRINT)
// ============================================================
const PAPER_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'month', label: 'เดือน', group: 'หลัก' },
  { key: 'site', label: 'สาขา', group: 'หลัก' },
  { key: 'device', label: 'อุปกรณ์', group: 'หลัก' },
  { key: 'bw', label: 'แผ่น BW', group: 'แผ่น' },
  { key: 'color', label: 'แผ่นสี', group: 'แผ่น' },
  { key: 'total', label: 'แผ่นรวม', group: 'แผ่น' },
  { key: 'cost', label: 'ต้นทุน', group: 'แผ่น' },
]

interface OverviewKpi {
  totalSheets: number
  totalBw: number
  totalColor: number
  curMonth: number
  lastMonth: number
  momPct: number
  avgPerMonth: number
  topDept: { name: string; sheets: number } | null
  topDevice: { assetCode: string; sheets: number; brand: string | null; model: string | null } | null
}
interface MonthlyRow { month: string; bw: number; color: number; total: number }
interface OverviewResp {
  view: 'overview'
  months: string[]
  kpi: OverviewKpi
  monthly: MonthlyRow[]
  topDept: Array<{ name: string; sheets: number }>
  topDevice: Array<{ assetCode: string; sheets: number; brand: string | null; model: string | null }>
}
interface RankingRow { name: string; bw: number; color: number; total: number; cost?: number; deviceCount: number }
/**
 * Structural shape consumed by RankingCard. Declared with named optional fields
 * rather than `Record<string, unknown>` — an index signature would make named
 * interfaces (RankingRow, the API payload types) non-assignable, since
 * interfaces receive no implicit index signature.
 */
interface RankingCardRow {
  name?: string
  bw?: number
  color?: number
  total?: number
  cost?: number
  deviceCount?: number
}
interface DeviceRow {
  assetCode: string; brand: string | null; model: string | null; site: string | null
  department: string | null; bw: number; color: number; total: number; cost?: number
}
interface RankingResp {
  view: 'ranking'
  months: string[]
  departments: RankingRow[]
  buildingFloors: RankingRow[]
  devices: DeviceRow[]
}
interface Compare3Resp {
  view: 'compare3'
  months: string[]
  rows: Array<{
    assetCode: string
    brand: string | null
    model: string | null
    site: string | null
    department: string | null
    months: Record<string, { bw: number; color: number; cost: number }>
    totals: number[]
    total: number
    cost: number
  }>
}
interface DetailRow {
  assetCode: string
  brand: string | null
  model: string | null
  site: string | null
  building: string | null
  floor: string | null
  department: string | null
  departmentCode: string | null
  type: string | null
  bw: number
  color: number
  total: number
  monthCount: number
}
interface DetailResp {
  view: 'detail'
  months: string[]
  rows: DetailRow[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

function currentMonthStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthsAgoStr(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function ItamPaperAnalytics() {
  const { theme } = useTheme()
  const { lang } = useLang()
  const isDark = theme === 'dark'

  const [tab, setTab] = React.useState<'overview' | 'ranking' | 'compare3' | 'detail' | 'utilization'>('overview')
  // Utilization tab has its own range selector (month/30d/quarter/all) —
  // separate from the monthStart/monthEnd window used by the other tabs.
  const [utilRange, setUtilRange] = React.useState<DashboardRangeKey>('quarter')
  const [monthStart, setMonthStart] = React.useState(monthsAgoStr(5))
  const [monthEnd, setMonthEnd] = React.useState(currentMonthStr())
  const [site, setSite] = React.useState('')
  const [building, setBuilding] = React.useState('')
  const [department, setDepartment] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [limit] = React.useState(20)

  // ── Site filter visibility — only show if user can select among multiple sites ──
  const authUser = useAuthStore((s) => s.user)
  const showSiteFilter = authUser ? canSelectSite(authUser) : false

  // Custom export dialog state (Task ID: FIX-1-2-EXPORT-PRINT)
  const [customExportOpen, setCustomExportOpen] = React.useState(false)

  // Sites list for filter + per-site paper rates (CONSULTING-007)
  // The rate map is keyed by BOTH siteName and siteCode so lookups work
  // regardless of which form Device.site stores (imports vary).
  const [sites, setSites] = React.useState<string[]>([])
  const siteRates = React.useRef<Map<string, { bw: number; color: number }>>(new Map())
  React.useEffect(() => {
    fetch('/api/itam/sites')
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((j: { sites: Array<{ siteName: string | null; siteCode?: string | null; paperRateBw?: number | null; paperRateColor?: number | null }> }) => {
        setSites(j.sites.map((s) => s.siteName).filter((s): s is string => !!s))
        const rates = new Map<string, { bw: number; color: number }>()
        for (const s of j.sites) {
          const bw = s.paperRateBw ?? 0.5
          const color = s.paperRateColor ?? 2.0
          if (s.siteName) rates.set(s.siteName, { bw, color })
          if (s.siteCode) rates.set(s.siteCode, { bw, color })
        }
        siteRates.current = rates
      })
      .catch(() => setSites([]))
  }, [])

  const baseParams = React.useMemo(() => {
    const p = new URLSearchParams()
    p.set('monthStart', monthStart)
    p.set('monthEnd', monthEnd)
    if (site) p.set('site', site)
    if (building) p.set('building', building)
    if (department) p.set('department', department)
    return p
  }, [monthStart, monthEnd, site, building, department])

  // Overview query (always fetched — used by overview tab + KPI strip)
  const overviewQuery = useQuery<OverviewResp>({
    queryKey: ['itam-paper-overview', baseParams.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/itam/paper-analytics?view=overview&${baseParams}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  // Ranking query
  const rankingQuery = useQuery<RankingResp>({
    queryKey: ['itam-paper-ranking', baseParams.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/itam/paper-analytics?view=ranking&${baseParams}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: tab === 'ranking',
  })

  // Compare3 query
  const compareQuery = useQuery<Compare3Resp>({
    queryKey: ['itam-paper-compare3', baseParams.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/itam/paper-analytics?view=compare3&${baseParams}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: tab === 'compare3',
  })

  // Detail query
  const detailQuery = useQuery<DetailResp>({
    queryKey: ['itam-paper-detail', baseParams.toString(), page, limit],
    queryFn: async () => {
      const p = new URLSearchParams(baseParams)
      p.set('page', String(page))
      p.set('limit', String(limit))
      const res = await fetch(`/api/itam/paper-analytics?view=detail&${p}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: tab === 'detail',
  })

  // Reset page when filters change
  React.useEffect(() => { setPage(1) }, [monthStart, monthEnd, site, building, department])

  const tooltipStyle: React.CSSProperties = {
    background: isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)',
    border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
    borderRadius: '8px',
    fontSize: '12px',
    color: isDark ? '#f1f5f9' : '#1e293b',
    padding: '8px 12px',
  }
  const gridColor = isDark ? '#1e293b' : '#e2e8f0'
  const axisColor = '#64748b'

  // ── Exports ────────────────────────────────────────────────────────────
  function exportCsvFromRows(rows: Record<string, unknown>[], filename: string, headers?: Array<{ key: string; label: string }>) {
    if (rows.length === 0) { toast.error('ไม่มีข้อมูลส่งออก'); return }
    downloadCsv(filename, rows, headers)
    toast.success(`ส่งออก ${rows.length} แถว`)
  }

  function exportPdfOverview() {
    const data = overviewQuery.data
    if (!data) { toast.error('ยังโหลดข้อมูลไม่เสร็จ'); return }
    const win = window.open('', '_blank', 'width=900,height=1200')
    if (!win) { toast.warning('เบราว์เซอร์บล็อกป๊อปอัป'); return }
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c))
    const generatedAt = new Date().toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'long', timeStyle: 'short' })
    const k = data.kpi
    const kpiHtml = `
      <div class="kpi-grid">
        <div class="kpi"><div class="label">แผ่นรวม</div><div class="value">${(k.totalSheets ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</div></div>
        <div class="kpi t-bw"><div class="label">ขาวดำ</div><div class="value">${(k.totalBw ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</div></div>
        <div class="kpi t-color"><div class="label">สี</div><div class="value">${(k.totalColor ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</div></div>
        <div class="kpi t-cur"><div class="label">เดือนล่าสุด</div><div class="value">${(k.curMonth ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</div></div>
        <div class="kpi t-mom"><div class="label">MoM</div><div class="value">${(k.momPct ?? 0) > 0 ? '+' : ''}${k.momPct ?? 0}%</div></div>
        <div class="kpi t-avg"><div class="label">เฉลี่ย/เดือน</div><div class="value">${(k.avgPerMonth ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</div></div>
      </div>`
    const monthlyHtml = data.monthly.map((m) => `<tr><td>${esc(m.month)}</td><td class="num">${(m.bw ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</td><td class="num">${(m.color ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</td><td class="num">${(m.total ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</td></tr>`).join('')
    const topDeptHtml = data.topDept.map((d, i) => `<tr><td>${i + 1}</td><td>${esc(d.name)}</td><td class="num">${(d.sheets ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</td></tr>`).join('')
    const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ITAM Paper Analytics Report</title>
<style>
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; font-family: 'Sukhumvit Set', 'Thonburi', 'Tahoma', sans-serif; color: #1e293b; font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.header { border-bottom: 3px solid #f97316; padding-bottom: 10px; margin-bottom: 14px; display: flex; justify-content: space-between; }
.header .org { font-size: 18px; font-weight: 700; color: #0f172a; }
.header .subtitle { font-size: 12px; color: #475569; margin-top: 2px; }
.header .meta { text-align: right; font-size: 11px; color: #64748b; }
h2.section { font-size: 13px; font-weight: 700; color: #0f172a; margin: 18px 0 6px; padding: 6px 10px; background: linear-gradient(90deg, #fff7ed 0%, #ffffff 100%); border-left: 4px solid #f97316; border-radius: 3px; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
th { background: #f97316; color: white; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr:nth-child(even) td { background: #fafbfc; }
.kpi-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin: 6px 0 4px; }
.kpi { border: 1px solid #e2e8f0; border-top: 3px solid #f97316; border-radius: 4px; padding: 10px; background: #ffffff; }
.kpi .label { font-size: 10px; color: #64748b; text-transform: uppercase; }
.kpi .value { font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 4px; font-variant-numeric: tabular-nums; }
.kpi.t-bw { border-top-color: #0d9488; } .kpi.t-bw .value { color: #0d9488; }
.kpi.t-color { border-top-color: #f59e0b; } .kpi.t-color .value { color: #d97706; }
.kpi.t-cur { border-top-color: #10b981; } .kpi.t-cur .value { color: #10b981; }
.kpi.t-mom { border-top-color: #ef4444; } .kpi.t-mom .value { color: #ef4444; }
.kpi.t-avg { border-top-color: #6366f1; } .kpi.t-avg .value { color: #6366f1; }
.print-btn { position: fixed; top: 12px; right: 12px; background: #f97316; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; }
.print-btn:hover { background: #ea580c; }
@media print { .no-print { display: none; } }
</style></head><body>
<button class="print-btn no-print" onclick="window.print()">🖨 พิมพ์ / บันทึก PDF</button>
<button class="close-btn no-print" onclick="window.close()" style="position:fixed;top:12px;right:100px;background:#64748b;color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">✕ ปิด</button>
<div class="header"><div><div class="org">องค์กร</div><div class="subtitle">ITAM Paper Analytics Report</div></div><div class="meta"><div>วันที่ออกรายงาน: ${esc(generatedAt)}</div><div>ช่วงเดือน: ${esc(monthStart)} → ${esc(monthEnd)}</div></div></div>
<h2 class="section">📊 ตัวชี้วัดหลัก</h2>
${kpiHtml}
<h2 class="section">📈 การใช้กระดาษรายเดือน</h2>
<table><thead><tr><th>เดือน</th><th class="num">ขาวดำ</th><th class="num">สี</th><th class="num">รวม</th></tr></thead><tbody>${monthlyHtml}</tbody></table>
<h2 class="section">🏆 5 แผนกใช้กระดาษสูงสุด</h2>
<table><thead><tr><th>#</th><th>แผนก</th><th class="num">แผ่น</th></tr></thead><tbody>${topDeptHtml}</tbody></table>
<script>window.addEventListener('load', function () { setTimeout(function () { try { window.print(); } catch (e) {} }, 250); }); window.addEventListener('keydown', function(e) { if (e.key === 'Escape') { window.close(); } });</script>
</body></html>`
    win.document.open()
    win.document.write(html)
    win.document.close()
    toast.success('กำลังเปิดหน้าพิมพ์ PDF...')
  }

  function exportExcelFromRows(rows: Record<string, unknown>[], headers: Array<{ key: string; label: string }>, filename: string) {
    if (rows.length === 0) { toast.error('ไม่มีข้อมูลส่งออก'); return }
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c))
    const headHtml = headers.map((h) => `<th style="background:#f97316;color:#fff;padding:6px;border:1px solid #ddd;font-weight:600">${esc(h.label)}</th>`).join('')
    const bodyHtml = rows.map((r) => {
      const cells = headers.map((h) => `<td style="padding:5px;border:1px solid #e2e8f0;mso-number-format:'\\@'">${esc((r as Record<string, unknown>)[h.key] ?? '')}</td>`).join('')
      return `<tr>${cells}</tr>`
    }).join('')
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"></head><body><table style="border-collapse:collapse;font-family:'Tahoma',sans-serif;font-size:11px"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></body></html>`
    const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`ส่งออก Excel ${rows.length} แถว`)
  }

  // ── Custom Export handler ── (Task ID: FIX-1-2-EXPORT-PRINT, CONSULTING-007)
  // Fetches the FULL detail view (all rows for the current filter, ignoring
  // the in-page pagination) and maps each row to the column keys.
  // • เดือน: shown as the month range that was filtered
  // • ต้นทุน: per-site rates from SiteAttribute (PaperRateBW / PaperRateColor —
  //   single source of truth, configurable in ตั้งค่าระบบ → จัดการสาขา).
  //   Falls back to the schema defaults (0.5 / 2.0) when a site has no rate.
  const handleCustomExport = React.useCallback(
    async (columns: ExportColumn[], format: ExportFormat) => {
      const p = new URLSearchParams(baseParams)
      p.set('page', '1')
      p.set('limit', '10000')
      const res = await fetch(`/api/itam/paper-analytics?view=detail&${p}`)
      if (!res.ok) throw new Error('โหลดข้อมูลกระดาษไม่สำเร็จ')
      const json: DetailResp = await res.json()
      const allRows = json.rows ?? []
      if (allRows.length === 0) {
        toast.warning('ไม่มีข้อมูลการใช้กระดาษในช่วงที่เลือกให้ส่งออก')
        return
      }
      const monthLabel = monthStart === monthEnd ? monthStart : `${monthStart} - ${monthEnd}`
      const rows: Record<string, unknown>[] = allRows.map((r) => {
        const bw = r.bw ?? 0
        const color = r.color ?? 0
        // CONSULTING-007: per-site paper rates from SiteAttribute instead of
        // the old hardcoded bw*0.5 + color*3.0 placeholder.
        const rate = siteRates.current.get(r.site ?? '') ?? { bw: 0.5, color: 2.0 }
        const cost = bw * rate.bw + color * rate.color
        return {
          month: monthLabel,
          site: r.site ?? '',
          device: `${r.brand ?? ''} ${r.model ?? ''}`.trim() || r.assetCode,
          bw,
          color,
          total: r.total ?? (bw + color),
          cost: cost.toFixed(2),
        }
      })
      runCustomExport(columns, format, rows, 'paper-analytics', 'รายงานการใช้กระดาษ')
      toast.success(`ส่งออก ${rows.length} รายการ`)
    },
    [baseParams, monthStart, monthEnd],
  )

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">ITAM กระดาษ</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            วิเคราะห์การใช้กระดาษรายเดือน · รายแผนก / อาคาร-ชั้น / เครื่องพิมพ์ · เปรียบเทียบ 3 เดือน
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" type="button" onClick={async () => { await overviewQuery.refetch(); toast.success('รีเฟรชข้อมูลเรียบร้อย') }} className="dark:bg-slate-800 dark:border-slate-700">
            <RefreshCw className={`h-4 w-4 ${overviewQuery.isFetching ? 'animate-spin' : ''}`} /> รีเฟรช
          </Button>
          <Button variant="outline" size="sm" type="button" onClick={exportPdfOverview} className="dark:bg-slate-800 dark:border-slate-700">
            <FileText className="h-4 w-4" /> PDF
          </Button>
          {/* ส่งออก (custom) — Task ID: FIX-1-2-EXPORT-PRINT */}
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => setCustomExportOpen(true)}
            className="border-[#f97316] text-[#f97316] hover:bg-[#f97316]/10 dark:border-[#fb923c] dark:text-[#fb923c]"
          >
            <Download className="h-4 w-4" /> ส่งออก
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <Card className="flex-shrink-0 border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="p-3 sm:p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label className="text-xs">เดือนเริ่ม</Label>
              <Input type="month" id="paper-monthStart" name="monthStart" value={monthStart} onChange={(e) => setMonthStart(e.target.value || monthsAgoStr(5))} className="dark:bg-slate-800 dark:border-slate-700" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">เดือนสิ้นสุด</Label>
              <Input type="month" id="paper-monthEnd" name="monthEnd" value={monthEnd} onChange={(e) => setMonthEnd(e.target.value || currentMonthStr())} className="dark:bg-slate-800 dark:border-slate-700" />
            </div>
            {showSiteFilter && (
              <div className="space-y-1.5">
                <Label className="text-xs">สาขา</Label>
                <Select value={site || '__all'} onValueChange={(v) => setSite(v === '__all' ? '' : v)}>
                  <SelectTrigger className="dark:bg-slate-800 dark:border-slate-700"><SelectValue placeholder="ทุกสาขา" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">ทุกสาขา</SelectItem>
                    {sites.length === 0 && (
                      <SelectItem value="__none__" disabled>— ยังไม่มีสาขาในระบบ —</SelectItem>
                    )}
                    {sites.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">อาคาร</Label>
              <Input value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="ทุกอาคาร" className="dark:bg-slate-800 dark:border-slate-700" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">แผนก</Label>
              <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="ทุกแผนก" className="dark:bg-slate-800 dark:border-slate-700" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SPRINT-3 #10: Smart Insight banner — surfaces the most important
          finding at the top so managers see it without picking a tab.
          Currently shows total sheets + a hint to drill down. */}
      {overviewQuery.data && (
        <div className="flex-shrink-0 rounded-md border border-[#f97316]/30 bg-gradient-to-r from-[#f97316]/5 to-amber-50 p-3 dark:border-[#f97316]/40 dark:from-[#f97316]/10 dark:to-amber-950/20">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xl">💡</span>
              <div>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  เดือนนี้ใช้กระดาษ {(overviewQuery.data.kpi.totalSheets ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  ขาวดำ {(overviewQuery.data.kpi.totalBw ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} · สี {(overviewQuery.data.kpi.totalColor ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setTab('ranking')}
              className="rounded-md bg-[#f97316] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#ea580c]"
            >
              ดูจัดอันดับ →
            </button>
          </div>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex min-h-0 flex-1 flex-col gap-4">
        <TabsList className="grid w-full flex-shrink-0 grid-cols-2 sm:grid-cols-5">
          <TabsTrigger value="overview" className="gap-1" onClick={() => setTab("overview")}><LayoutGrid className="h-3.5 w-3.5" /> ภาพรวม</TabsTrigger>
          <TabsTrigger value="ranking" className="gap-1" onClick={() => setTab("ranking")}><Trophy className="h-3.5 w-3.5" /> จัดอันดับ</TabsTrigger>
          <TabsTrigger value="compare3" className="gap-1" onClick={() => setTab("compare3")}><TrendingUp className="h-3.5 w-3.5" /> 3 เดือน</TabsTrigger>
          <TabsTrigger value="detail" className="gap-1" onClick={() => setTab("detail")}><TableIcon className="h-3.5 w-3.5" /> รายละเอียด</TabsTrigger>
          <TabsTrigger value="utilization" className="gap-1" onClick={() => setTab("utilization")}><Activity className="h-3.5 w-3.5" /> การใช้งาน</TabsTrigger>
        </TabsList>

        {/* ───────────────────────────────────────────────────────────────── */}
        {/* OVERVIEW */}
        {/* ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-0 min-h-0 flex-1 space-y-4 overflow-y-auto">
          {overviewQuery.isLoading ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-md" />)}
            </div>
          ) : overviewQuery.data ? (
            <>
              {/* KPI cards */}
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
                <KpiCard title="แผ่นรวม" value={overviewQuery.data.kpi.totalSheets} accent="#0f172a" icon={<FileBarChart className="h-5 w-5" />} />
                <KpiCard title="ขาวดำ" value={overviewQuery.data.kpi.totalBw} accent="#0d9488" icon={<FileBarChart className="h-5 w-5" />} />
                <KpiCard title="สี" value={overviewQuery.data.kpi.totalColor} accent="#f59e0b" icon={<FileBarChart className="h-5 w-5" />} />
                <KpiCard title="เดือนล่าสุด" value={overviewQuery.data.kpi.curMonth} accent="#10b981" icon={<TrendingUp className="h-5 w-5" />} />
                <KpiCard title="MoM" value={overviewQuery.data.kpi.momPct} suffix="%" accent={overviewQuery.data.kpi.momPct >= 0 ? '#ef4444' : '#10b981'} icon={<TrendingUp className="h-5 w-5" />} />
                <KpiCard title="เฉลี่ย/เดือน" value={overviewQuery.data.kpi.avgPerMonth} accent="#6366f1" icon={<TrendingUp className="h-5 w-5" />} />
              </div>

              {/* Monthly bar chart */}
              <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <CardHeader>
                  <CardTitle className="text-base">การใช้กระดาษรายเดือน (ขาวดำ vs สี)</CardTitle>
                  <p className="text-xs text-slate-500 dark:text-slate-400">คลิกที่แท่งเพื่อดูรายละเอียดเพิ่มเติม</p>
                </CardHeader>
                <CardContent>
                  <div className="h-72 w-full">
                    <VisibleResponsiveContainer width="100%" height="100%">
                      <BarChart data={overviewQuery.data.monthly} margin={{ top: 12, right: 8, left: -10, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                        <XAxis dataKey="month" tick={{ fill: axisColor, fontSize: 11 }} />
                        <YAxis tick={{ fill: axisColor, fontSize: 11 }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`} />
                        <ReTooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [(Number(v) || 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB'), n === 'bw' ? 'ขาวดำ' : n === 'color' ? 'สี' : 'รวม']} />
                        <Legend formatter={(v: string) => v === 'bw' ? 'ขาวดำ' : v === 'color' ? 'สี' : v} />
                        <Bar dataKey="bw" name="bw" stackId="a" fill="#0d9488" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="color" name="color" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </VisibleResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Top department + Top device */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><Trophy className="h-4 w-4 text-[#f97316]" /> 5 แผนกใช้กระดาษสูงสุด</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {overviewQuery.data.topDept.length === 0 ? (
                        <div className="py-6 text-center text-sm text-slate-400">ไม่มีข้อมูล</div>
                      ) : overviewQuery.data.topDept.map((d, i) => {
                        const max = overviewQuery.data?.topDept[0]?.sheets ?? 1
                        const pct = Math.max(2, (d.sheets / max) * 100)
                        return (
                          <div key={d.name}>
                            <div className="mb-1 flex justify-between text-xs">
                              <span className="font-medium text-slate-700 dark:text-slate-200">
                                {i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}.`} {d.name}
                              </span>
                              <span className="font-semibold tabular-nums text-slate-600 dark:text-slate-300">{(d.sheets ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                              <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }} className="h-full rounded bg-gradient-to-r from-orange-400 to-orange-600" />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
                <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><FileBarChart className="h-4 w-4 text-[#0d9488]" /> 5 เครื่องพิมพ์ใช้กระดาษสูงสุด</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {overviewQuery.data.topDevice.length === 0 ? (
                        <div className="py-6 text-center text-sm text-slate-400">ไม่มีข้อมูล</div>
                      ) : overviewQuery.data.topDevice.map((d, i) => {
                        const max = overviewQuery.data?.topDevice[0]?.sheets ?? 1
                        const pct = Math.max(2, (d.sheets / max) * 100)
                        return (
                          <div key={d.assetCode}>
                            <div className="mb-1 flex justify-between text-xs">
                              <span className="font-medium text-slate-700 dark:text-slate-200">
                                {i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}.`} <span className="font-mono">{d.assetCode}</span>
                                <span className="ml-1 text-slate-400">{d.brand} {d.model}</span>
                              </span>
                              <span className="font-semibold tabular-nums text-slate-600 dark:text-slate-300">{(d.sheets ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                              <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }} className="h-full rounded bg-gradient-to-r from-teal-400 to-teal-600" />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          ) : (
            <div className="py-8 text-center text-sm text-rose-500">โหลดข้อมูลไม่สำเร็จ</div>
          )}
        </TabsContent>

        {/* ───────────────────────────────────────────────────────────────── */}
        {/* RANKING */}
        {/* ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="ranking" className="mt-0 min-h-0 flex-1 space-y-4 overflow-y-auto">
          {rankingQuery.isLoading ? (
            <Skeleton className="h-96 w-full rounded-md" />
          ) : rankingQuery.data ? (
            <>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => exportCsvFromRows(rankingQuery.data!.departments.map((d) => ({ name: d.name, bw: d.bw, color: d.color, total: d.total, cost: d.cost ?? 0, deviceCount: d.deviceCount })), `paper-ranking-dept-${dateStamp()}.csv`, [{ key: 'name', label: 'แผนก' }, { key: 'bw', label: 'ขาวดำ' }, { key: 'color', label: 'สี' }, { key: 'total', label: 'รวม' }, { key: 'cost', label: 'ต้นทุน (฿)' }, { key: 'deviceCount', label: 'จำนวนเครื่อง' }])}>
                  <FileSpreadsheet className="h-3.5 w-3.5" /> CSV แผนก
                </Button>
                <Button variant="outline" size="sm" onClick={() => exportExcelFromRows(rankingQuery.data!.devices.map((d) => ({ assetCode: d.assetCode, brand: d.brand ?? '', model: d.model ?? '', site: d.site ?? '', department: d.department ?? '', bw: d.bw, color: d.color, total: d.total, cost: d.cost ?? 0 })), [{ key: 'assetCode', label: 'รหัส' }, { key: 'brand', label: 'แบรนด์' }, { key: 'model', label: 'รุ่น' }, { key: 'site', label: 'สาขา' }, { key: 'department', label: 'แผนก' }, { key: 'bw', label: 'ขาวดำ' }, { key: 'color', label: 'สี' }, { key: 'total', label: 'รวม' }, { key: 'cost', label: 'ต้นทุน (฿)' }], `paper-ranking-devices-${dateStamp()}.xls`)}>
                  <FileSpreadsheet className="h-3.5 w-3.5" /> Excel เครื่อง
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <RankingCard title="10 แผนกใช้กระดาษสูงสุด" rows={rankingQuery.data.departments} accent="#f97316" nameKey="name" />
                <RankingCard title="10 อาคาร-ชั้น ใช้กระดาษสูงสุด" rows={rankingQuery.data.buildingFloors} accent="#0d9488" nameKey="name" />
                <RankingCard title="10 เครื่องพิมพ์ใช้กระดาษสูงสุด" rows={rankingQuery.data.devices.map((d) => ({ name: `${d.assetCode} · ${d.brand ?? ''} ${d.model ?? ''}`.trim(), bw: d.bw, color: d.color, total: d.total, cost: d.cost, deviceCount: 1 }))} accent="#f59e0b" nameKey="name" />
              </div>
            </>
          ) : (
            <div className="py-8 text-center text-sm text-rose-500">โหลดข้อมูลไม่สำเร็จ</div>
          )}
        </TabsContent>

        {/* ───────────────────────────────────────────────────────────────── */}
        {/* COMPARE 3 MONTHS */}
        {/* ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="compare3" className="mt-0 min-h-0 flex-1 space-y-4 overflow-y-auto">
          {compareQuery.isLoading ? (
            <Skeleton className="h-96 w-full rounded-md" />
          ) : compareQuery.data ? (
            <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">เปรียบเทียบการใช้กระดาษ 3 เดือนล่าสุด</CardTitle>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    เดือน: {compareQuery.data.months.join(' · ')} — เรียงตามแผ่นรวมสูง → ต่ำ · ต้นทุนคำนวณจากอัตราค่ากระดาษรายสาขา
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    const d = compareQuery.data!
                    exportCsvFromRows(d.rows.map((r) => ({
                      assetNo: r.assetCode,
                      brand: r.brand ?? '',
                      model: r.model ?? '',
                      site: r.site ?? '',
                      department: r.department ?? '',
                      ...Object.fromEntries(d.months.map((m) => [m, r.months[m] ? (r.months[m].bw + r.months[m].color) : 0])),
                      total: r.total,
                      cost: (r.cost ?? 0).toFixed(2),
                    })), `paper-compare3-${dateStamp()}.csv`, [
                      { key: 'assetNo', label: 'รหัส' }, { key: 'brand', label: 'แบรนด์' }, { key: 'model', label: 'รุ่น' },
                      { key: 'site', label: 'สาขา' }, { key: 'department', label: 'แผนก' },
                      ...d.months.map((m) => ({ key: m, label: m })),
                      { key: 'total', label: 'รวม 3 เดือน' }, { key: 'cost', label: 'ต้นทุน (฿)' },
                    ])
                  }}
                >
                  <Download className="mr-1 h-3.5 w-3.5" /> CSV
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="itam-scroll max-h-[70vh] overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                      <TableRow>
                        <TableHead className="w-16">รหัส</TableHead>
                        <TableHead>เครื่อง</TableHead>
                        <TableHead>สาขา</TableHead>
                        <TableHead>แผนก</TableHead>
                        {compareQuery.data.months.map((m) => (
                          <TableHead key={m} className="text-right">{m}</TableHead>
                        ))}
                        <TableHead className="text-right">รวม 3 เดือน</TableHead>
                        <TableHead className="text-right">ต้นทุน (฿)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {compareQuery.data.rows.length === 0 ? (
                        <TableRow><TableCell colSpan={7 + compareQuery.data.months.length} className="py-8 text-center text-slate-400">ไม่มีข้อมูล</TableCell></TableRow>
                      ) : compareQuery.data.rows.map((r) => (
                        <TableRow key={r.assetCode} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <TableCell className="font-mono text-xs">{r.assetCode}</TableCell>
                          <TableCell className="text-xs">{r.brand} {r.model}</TableCell>
                          <TableCell className="text-xs">{r.site || '—'}</TableCell>
                          <TableCell className="text-xs">{r.department || '—'}</TableCell>
                          {r.totals.map((t, i) => {
                            const m = compareQuery.data!.months[i]
                            const detail = r.months[m]
                            const isMax = t === Math.max(...r.totals)
                            return (
                              <TableCell key={m} className={`text-right tabular-nums text-xs ${isMax ? 'font-semibold text-[#f97316]' : ''}`}>
                                {t > 0 ? (t ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB') : '—'}
                                {detail && ((detail.bw ?? 0) > 0 || (detail.color ?? 0) > 0) && (
                                  <div className="text-[10px] text-slate-400">
                                    {(detail.bw ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}BW / {(detail.color ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}สี
                                    {(detail.cost ?? 0) > 0 && (
                                      <span className="text-emerald-600 dark:text-emerald-400"> · ฿{(detail.cost ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { maximumFractionDigits: 2 })}</span>
                                    )}
                                  </div>
                                )}
                              </TableCell>
                            )
                          })}
                          <TableCell className="text-right tabular-nums text-xs font-bold text-slate-700 dark:text-slate-200">
                            {(r.total ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                            {(r.cost ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { maximumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                      ))}
                      {compareQuery.data.rows.length > 0 && (
                        <TableRow className="sticky bottom-0 z-10 bg-slate-100/95 font-semibold backdrop-blur-sm dark:bg-slate-900/95">
                          <TableCell colSpan={4} className="text-xs text-slate-600 dark:text-slate-300">รวมทั้งหมด ({compareQuery.data.rows.length} เครื่อง)</TableCell>
                          {compareQuery.data.months.map((m) => {
                            const sum = compareQuery.data!.rows.reduce((a, r) => a + ((r.months[m]?.bw ?? 0) + (r.months[m]?.color ?? 0)), 0)
                            return (
                              <TableCell key={m} className="text-right tabular-nums text-xs text-slate-600 dark:text-slate-300">
                                {sum.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                              </TableCell>
                            )
                          })}
                          <TableCell className="text-right tabular-nums text-xs text-slate-700 dark:text-slate-200">
                            {compareQuery.data.rows.reduce((a, r) => a + (r.total ?? 0), 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs text-emerald-700 dark:text-emerald-400">
                            ฿{compareQuery.data.rows.reduce((a, r) => a + (r.cost ?? 0), 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { maximumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="py-8 text-center text-sm text-rose-500">โหลดข้อมูลไม่สำเร็จ</div>
          )}
        </TabsContent>

        {/* ───────────────────────────────────────────────────────────────── */}
        {/* DETAIL */}
        {/* ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="detail" className="mt-0 min-h-0 flex-1 space-y-4 overflow-y-auto">
          {detailQuery.isLoading ? (
            <Skeleton className="h-96 w-full rounded-md" />
          ) : detailQuery.data ? (
            <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                  รายละเอียดการใช้กระดาษ
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {(detailQuery.data.pagination.total ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} เครื่อง · {detailQuery.data.months.length} เดือน
                  </span>
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => exportCsvFromRows(detailQuery.data!.rows.map((r) => ({
                  assetNo: r.assetCode, brand: r.brand ?? '', model: r.model ?? '', site: r.site ?? '',
                  building: r.building ?? '', floor: r.floor ?? '', department: r.department ?? '',
                  bw: r.bw, color: r.color, total: r.total, monthCount: r.monthCount,
                  cost: (() => {
                    const rate = siteRates.current.get(r.site ?? '') ?? { bw: 0.5, color: 2.0 }
                    return (r.bw * rate.bw + r.color * rate.color).toFixed(2)
                  })(),
                })), `paper-detail-${dateStamp()}.csv`, [
                  { key: 'assetNo', label: 'รหัส' }, { key: 'brand', label: 'แบรนด์' }, { key: 'model', label: 'รุ่น' },
                  { key: 'site', label: 'สาขา' }, { key: 'building', label: 'อาคาร' }, { key: 'floor', label: 'ชั้น' },
                  { key: 'department', label: 'แผนก' }, { key: 'bw', label: 'ขาวดำ' }, { key: 'color', label: 'สี' },
                  { key: 'total', label: 'รวม' }, { key: 'monthCount', label: 'จำนวนเดือนที่จด' },
                  { key: 'cost', label: 'ต้นทุน (฿)' },
                ])}>
                  <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="itam-scroll max-h-[65vh] overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                      <TableRow>
                        <TableHead className="w-16">รหัส</TableHead>
                        <TableHead>เครื่อง</TableHead>
                        <TableHead>สาขา</TableHead>
                        <TableHead>อาคาร</TableHead>
                        <TableHead>ชั้น</TableHead>
                        <TableHead>แผนก</TableHead>
                        <TableHead className="text-right">ขาวดำ</TableHead>
                        <TableHead className="text-right">สี</TableHead>
                        <TableHead className="text-right">รวม</TableHead>
                        <TableHead className="text-right">ต้นทุน (฿)</TableHead>
                        <TableHead className="text-right">เดือนที่จด</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailQuery.data.rows.length === 0 ? (
                        <TableRow><TableCell colSpan={11} className="py-8 text-center text-slate-400">ไม่มีข้อมูล</TableCell></TableRow>
                      ) : (
                        <>
                        {(() => {
                          // Footer totals row (computed once, rendered last)
                          const rows = detailQuery.data!.rows
                          const sumBw = rows.reduce((s, r) => s + (r.bw ?? 0), 0)
                          const sumColor = rows.reduce((s, r) => s + (r.color ?? 0), 0)
                          const sumTotal = rows.reduce((s, r) => s + (r.total ?? 0), 0)
                          const sumCost = rows.reduce((s, r) => {
                            const rate = siteRates.current.get(r.site ?? '') ?? { bw: 0.5, color: 2.0 }
                            return s + (r.bw ?? 0) * rate.bw + (r.color ?? 0) * rate.color
                          }, 0)
                          const n = lang === 'th' ? 'th-TH' : 'en-GB'
                          const totalRow = (
                            <TableRow className="sticky bottom-0 z-10 bg-slate-100/95 font-semibold backdrop-blur-sm dark:bg-slate-900/95">
                              <TableCell colSpan={6} className="text-xs text-slate-500 dark:text-slate-400">รวมทั้งหมด ({rows.length} เครื่อง)</TableCell>
                              <TableCell className="text-right tabular-nums text-xs">{sumBw.toLocaleString(n)}</TableCell>
                              <TableCell className="text-right tabular-nums text-xs">{sumColor.toLocaleString(n)}</TableCell>
                              <TableCell className="text-right tabular-nums text-xs text-[#f97316]">{sumTotal.toLocaleString(n)}</TableCell>
                              <TableCell className="text-right tabular-nums text-xs text-emerald-600 dark:text-emerald-400">{sumCost.toLocaleString(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                              <TableCell />
                            </TableRow>
                          )
                          const bodyRows = rows.map((r) => (
                        <TableRow key={r.assetCode} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" title={`ดูรายละเอียด ${r.assetCode}`}>
                          <TableCell className="font-mono text-xs">{r.assetCode}</TableCell>
                          <TableCell className="text-xs">
                            <div className="font-medium text-slate-700 dark:text-slate-200">{r.brand} {r.model}</div>
                            {r.type && <div className="text-[10px] text-slate-400">{r.type}</div>}
                          </TableCell>
                          <TableCell className="text-xs">{r.site || '—'}</TableCell>
                          <TableCell className="text-xs">{r.building || '—'}</TableCell>
                          <TableCell className="text-xs">{r.floor || '—'}</TableCell>
                          <TableCell className="text-xs">{r.department || '—'}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{(r.bw ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{(r.color ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs font-semibold text-[#f97316]">{(r.total ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs text-emerald-600 dark:text-emerald-400" title={`อัตรา: ${siteRates.current.get(r.site ?? '')?.bw ?? 0.5}/${siteRates.current.get(r.site ?? '')?.color ?? 2.0} ฿/แผ่น`}>
                            {(() => {
                              const rate = siteRates.current.get(r.site ?? '') ?? { bw: 0.5, color: 2.0 }
                              return (r.bw * rate.bw + r.color * rate.color).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            })()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs">
                            <Badge variant="outline" className="font-mono text-[10px]">{r.monthCount}/{detailQuery.data!.months.length}</Badge>
                          </TableCell>
                        </TableRow>
                          ))
                          return <>{bodyRows}{totalRow}</>
                        })()}
                        </>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="py-8 text-center text-sm text-rose-500">โหลดข้อมูลไม่สำเร็จ</div>
          )}
          {detailQuery.data && detailQuery.data.pagination.totalPages > 1 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-slate-500">
                หน้า {page} / {detailQuery.data.pagination.totalPages} ({(detailQuery.data.pagination.total ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} รายการ)
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="dark:bg-slate-800 dark:border-slate-700">
                  <ChevronLeft className="h-4 w-4" /> ก่อนหน้า
                </Button>
                <Button size="sm" variant="outline" disabled={page >= detailQuery.data.pagination.totalPages} onClick={() => setPage((p) => p + 1)} className="dark:bg-slate-800 dark:border-slate-700">
                  ถัดไป <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ───────────────────────────────────────────────────────────────── */}
        {/* UTILIZATION — device usage heatmap (was orphaned in the dead
            paper-analytics-page; now wired into the live tabbed module) */}
        {/* ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="utilization" className="mt-0 min-h-0 flex-1 space-y-4 overflow-y-auto">
          <UtilizationSection range={utilRange} onRangeChange={setUtilRange} />
        </TabsContent>
      </Tabs>

      {/* Custom Export Dialog — Task ID: FIX-1-2-EXPORT-PRINT */}
      <CustomExportDialog
        open={customExportOpen}
        onOpenChange={setCustomExportOpen}
        availableColumns={PAPER_EXPORT_COLUMNS}
        onExport={handleCustomExport}
        storageKey="itam-paper-export-cols"
        totalRows={detailQuery.data?.pagination.total ?? overviewQuery.data?.kpi.totalSheets ?? 0}
      />
    </div>
  )
}

// ─── KPI Card (local, simpler than dashboard's count-up variant) ────────
function KpiCard({
  title, value, suffix, accent, icon,
}: {
  title: string; value: number; suffix?: string; accent: string; icon: React.ReactNode
}) {
  const { lang } = useLang()
  return (
    <Card className="relative overflow-hidden shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: `${accent}1a`, color: accent }}>
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{title}</div>
            <div className="text-xl font-bold tabular-nums text-slate-800 dark:text-slate-100 sm:text-2xl">
              {(Number(value) || 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}{suffix}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Ranking card ────────────────────────────────────────────────────────
function RankingCard({
  title, rows, accent, nameKey,
}: {
  title: string
  rows: ReadonlyArray<RankingCardRow>
  accent: string
  nameKey: string
}) {
  const { lang } = useLang()
  const max = rows.length > 0 ? Number(rows[0].total ?? 0) : 1
  return (
    <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
      <CardHeader>
        <CardTitle className="text-sm" style={{ color: accent }}>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="itam-scroll max-h-80 space-y-2 overflow-y-auto">
          {rows.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-400">ไม่มีข้อมูล</div>
          ) : rows.map((r, i) => {
            const total = Number(r.total ?? 0)
            const pct = Math.max(2, (total / max) * 100)
            const cost = r.cost == null ? null : Number(r.cost)
            return (
              <div key={i}>
                <div className="mb-1 flex justify-between gap-2 text-xs">
                  <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                    {i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}.`} {String((r as Record<string, unknown>)[nameKey] ?? r.name ?? '')}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-1.5">
                    {cost != null && (
                      <span
                        className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
                        title="ต้นทุนโดยประมาณ (อัตรารายสาขา)"
                      >
                        ฿{cost.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { maximumFractionDigits: 0 })}
                      </span>
                    )}
                    <span className="font-semibold tabular-nums text-slate-600 dark:text-slate-300">{(Number(total) || 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }} className="h-full rounded" style={{ background: accent }} />
                </div>
                <div className="mt-0.5 flex justify-between text-[10px] text-slate-400">
                  <span>BW {Number(r.bw ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</span>
                  <span>สี {Number(r.color ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</span>
                  <span>{Number(r.deviceCount ?? 0)} เครื่อง</span>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
