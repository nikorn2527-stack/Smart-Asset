'use client'

/**
 * MaterialCostReport — ReportCostMaterialandofConsumable
 *
 * Spec: upload/COST-ANALYTICS-SPEC.md (Phase 3)
 *
 * ShowCostitemmonthsBy:
 *   1. InkPrint (consumable) — bottles, Cost, Cost/sheets (from yieldPerPage)
 *   2. Parts (spare_part) — pcs, Cost, Feedepreciation permonths/sheets
 *   3. service (service) — Costexact
 *   4. Reconciliation — compareCostInk(Stock) vs FeePaper(Meter)
 *
 * Data source: GET /api/cost-analytics/material?month=YYYY-MM&site=all
 *
 * Task ID: COST-ANALYTICS-PHASE3
 */

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from 'sonner'
import { useAuthStore } from '@/store/auth-store'
import { canSelectSite } from './types'
import { CustomColumnSelector, type ColumnDef } from './custom-column-selector'
import { ReportBarChart, ReportPieChart } from './report-charts'
import { useT, useLang, useI18nStore } from '@/store/i18n-store'

// Column definitions for material cost report
const COST_REPORT_COLUMNS: ColumnDef[] = [
  { key: 'productCode', label: 'รหัส', default: true },
  { key: 'productName', label: 'ชื่อสินค้า', default: true },
  { key: 'category', label: 'หมวดหมู่', default: true },
  { key: 'quantity', label: 'จำนวน', default: true },
  { key: 'unit', label: 'หน่วย', default: false },
  { key: 'unitCost', label: 'ราคา/หน่วย', default: true },
  { key: 'totalCost', label: 'มูลค่ารวม', default: true },
  { key: 'site', label: 'ไซต์', default: false },
  { key: 'costType', label: 'ประเภทต้นทุน', default: false },
]
import {  Droplet,
  Wrench,
  Briefcase,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  Download,
  CalendarDays,
  Coins,
  Calculator,
  ArrowLeftRight,
} from 'lucide-react'

// ── Types (mirror API response from src/lib/material-cost.ts) ─────────

interface MonthlyInkCostItem {
  stockItemId: string
  productCode: string
  productName: string
  totalBottles: number
  unitCost: number | null
  totalCost: number
  yieldPerPage: number | null
  costPerPage: number | null
  coveragePages: number | null
}

interface MonthlySparePartItem {
  stockItemId: string
  productCode: string
  productName: string
  totalItems: number
  unitCost: number | null
  totalCost: number
  depreciationMethod: string | null
  usefulLifeMonths: number | null
  usefulLifePages: number | null
  costPerMonth: number | null
  costPerPage: number | null
}

interface MonthlyServiceItem {
  stockItemId: string
  productCode: string
  productName: string
  totalQuantity: number
  unitCost: number | null
  totalCost: number
}

interface Reconciliation {
  inkCoveragePages: number
  actualPrintedPages: number
  difference: number
  differencePercent: number
  stockCostPerPage: number | null
  meterCostPerPage: number | null
  costPerPageDiff: number | null
}

interface MaterialCostReportData {
  month: string
  ink: {
    totalBottles: number
    totalCost: number
    avgCostPerPage: number | null
    items: MonthlyInkCostItem[]
  }
  spareParts: {
    totalItems: number
    totalCost: number
    monthlyDepreciation: number
    items: MonthlySparePartItem[]
  }
  service: {
    totalCost: number
    items: MonthlyServiceItem[]
  }
  totalCost: number
  reconciliation: Reconciliation
}

interface Site {
  id: string
  code: string
  name: string
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatBaht(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  // (QA-ROUND-2026-09-16-C) — same scoping bug as formatInt/formatMonthLabel
  // below; reads lang from the store instead of the undefined bare variable.
  return 'THB' + n.toLocaleString((useI18nStore.getState().lang) === 'th' ? 'th-TH' : 'en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// BUGFIX (QA-ROUND-2026-09-16-C): these helpers are module-level (outside the
// component), so the old `lang === 'th'` reads referenced an undefined
// variable → ReferenceError: lang is not defined → whole module crashed.
// Read the current language from the zustand store instead — getState()
// is the designed way to read store state outside React components/hook scope.
function currentLang(): 'th' | 'en' {
  return useI18nStore.getState().lang
}

function formatInt(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  return n.toLocaleString(currentLang() === 'th' ? 'th-TH' : 'en-GB')
}

function formatMonthLabel(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return month
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString(currentLang() === 'th' ? 'th-TH' : 'en-GB', { month: 'long', year: 'numeric' })
}

function currentMonthValue(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function depreciationLabel(method: string | null | undefined): string {
  if (!method) return '—'
  if (method === 'straight_line') return 'เสื่อมราคาตามเวลา'
  if (method === 'usage_based') return 'เสื่อมราคาตามการใช้งาน'
  return method
}

// ── Component ─────────────────────────────────────────────────────────

export function MaterialCostReport() {
  const t = useT()
  const { lang } = useLang()
  const [month, setMonth] = React.useState(currentMonthValue())
  const [site, setSite] = React.useState<string>('all')
  const [selectedColumns, setSelectedColumns] = React.useState<string[]>([])

  // ── Site filter visibility — only show if user can select among multiple sites ──
  const authUser = useAuthStore((s) => s.user)
  const showSiteFilter = authUser ? canSelectSite(authUser) : false

  function getAuthHeaders(
    extra: Record<string, string> = {},
  ): Record<string, string> {
    const h: Record<string, string> = { ...extra }
    const token = useAuthStore.getState()?.token
    if (token) h['Authorization'] = `Bearer ${token}`
    return h
  }

  // ── Fetch sites ──
  const { data: sitesData } = useQuery<Site[]>({
    queryKey: ['sites-list-mcr'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/sites', { headers: getAuthHeaders() })
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

  // ── Fetch material cost report ──
  const params = new URLSearchParams({ month, site })
  const { data, isLoading, isFetching, error, refetch } = useQuery<MaterialCostReportData>({
    queryKey: ['material-cost-report', month, site],
    queryFn: async () => {
      const res = await fetch(
        `/api/cost-analytics/material?${params.toString()}`,
        { headers: getAuthHeaders() },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'โหลดรายงานต้นทุนไม่สำเร็จ')
      }
      return res.json()
    },
    staleTime: 30_000,
  })

  React.useEffect(() => {
    if (error) {
      toast.error(
        error instanceof Error ? error.message : 'โหลดรายงานต้นทุนไม่สำเร็จ',
      )
    }
  }, [error])

  // ── CSV export ──
  function handleExportCSV() {
    if (!data) return
    const rows: string[] = []
    rows.push(`รายงาน,ต้นทุนวัสดุและของใช้สิ้นเปลือง`)
    rows.push(`เดือน,${formatMonthLabel(month)}`)
    rows.push(`ไซต์,${site === 'all' ? 'ทุกไซต์' : site}`)
    rows.push(`สร้างเมื่อ,${new Date().toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}`)
    rows.push('')
    rows.push(`[หมึกพิมพ์]`)
    rows.push(`รหัสสินค้า,ชื่อสินค้า,จำนวน(ขวด),ราคา/ขวด,ต้นทุนรวม,แผ่น/ขวด,ต้นทุน/แผ่น,แผ่นต่อรอบ`)
    for (const it of data.ink.items) {
      rows.push([
        it.productCode,
        `"${it.productName}"`,
        it.totalBottles,
        it.unitCost ?? '',
        it.totalCost,
        it.yieldPerPage ?? '',
        it.costPerPage ?? '',
        it.coveragePages ?? '',
      ].join(','))
    }
    rows.push(`รวมหมึก,,${data.ink.totalBottles},,${data.ink.totalCost},,${data.ink.avgCostPerPage ?? ''},`)
    rows.push('')
    rows.push(`[อะไหล่]`)
    rows.push(`รหัสสินค้า,ชื่อสินค้า,จำนวน(ชิ้น),ราคา/ชิ้น,ต้นทุนรวม,วิธีคำนวณ,อายุ(เดือน),อายุ(แผ่น),ต้นทุน/เดือน,ต้นทุน/แผ่น`)
    for (const it of data.spareParts.items) {
      rows.push([
        it.productCode,
        `"${it.productName}"`,
        it.totalItems,
        it.unitCost ?? '',
        it.totalCost,
        depreciationLabel(it.depreciationMethod),
        it.usefulLifeMonths ?? '',
        it.usefulLifePages ?? '',
        it.costPerMonth ?? '',
        it.costPerPage ?? '',
      ].join(','))
    }
    rows.push(`รวมอะไหล่,,${data.spareParts.totalItems},,${data.spareParts.totalCost},,,,${data.spareParts.monthlyDepreciation},`)
    rows.push('')
    rows.push(`[บริการ]`)
    rows.push(`รหัสสินค้า,ชื่อสินค้า,จำนวน,ราคา,ต้นทุนรวม`)
    for (const it of data.service.items) {
      rows.push([
        it.productCode,
        `"${it.productName}"`,
        it.totalQuantity,
        it.unitCost ?? '',
        it.totalCost,
      ].join(','))
    }
    rows.push(`รวมบริการ,,,,${data.service.totalCost}`)
    rows.push('')
    rows.push(`[สรุป]`)
    rows.push(`ต้นทุนรวมทั้งหมด,${data.totalCost}`)
    rows.push(`หมึก,${data.ink.totalCost} (${data.totalCost > 0 ? Math.round(data.ink.totalCost / data.totalCost * 100) : 0}%)`)
    rows.push(`อะไหล่,${data.spareParts.totalCost} (${data.totalCost > 0 ? Math.round(data.spareParts.totalCost / data.totalCost * 100) : 0}%)`)
    rows.push(`บริการ,${data.service.totalCost} (${data.totalCost > 0 ? Math.round(data.service.totalCost / data.totalCost * 100) : 0}%)`)
    rows.push('')
    rows.push(`[การกระทบยอด]`)
    rows.push(`แผ่นที่หมึกครอบคลุม,${data.reconciliation.inkCoveragePages}`)
    rows.push(`แผ่นที่พิมพ์จริง,${data.reconciliation.actualPrintedPages}`)
    rows.push(`ผลต่าง,${data.reconciliation.difference} (${data.reconciliation.differencePercent}%)`)
    rows.push(`ต้นทุน/แผ่น (สต๊อก),${data.reconciliation.stockCostPerPage ?? ''}`)
    rows.push(`ต้นทุน/แผ่น (มิเตอร์),${data.reconciliation.meterCostPerPage ?? ''}`)
    rows.push(`ผลต่าง/แผ่น,${data.reconciliation.costPerPageDiff ?? ''}`)

    const csv = '\uFEFF' + rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `material-cost-${month}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('ส่งออก CSV แล้ว')
  }

  const inkPercent = data && data.totalCost > 0 ? Math.round((data.ink.totalCost / data.totalCost) * 100) : 0
  const sparePercent = data && data.totalCost > 0 ? Math.round((data.spareParts.totalCost / data.totalCost) * 100) : 0
  const servicePercent = data && data.totalCost > 0 ? Math.round((data.service.totalCost / data.totalCost) * 100) : 0
  // Adjust to sum to 100
  const totalPercent = inkPercent + sparePercent + servicePercent
  const inkPct = totalPercent > 0 ? inkPercent : 0
  const sparePct = totalPercent > 0 ? sparePercent : 0
  const servicePct = totalPercent > 0 ? (100 - inkPct - sparePct) : 0

  // Reconciliation severity
  const diffPct = data?.reconciliation.differencePercent ?? 0
  const diffSeverity =
    Math.abs(diffPct) <= 10 ? 'ok' :
    Math.abs(diffPct) <= 20 ? 'warn' : 'danger'

  return (
    <div className="flex h-full flex-col gap-3 p-3 md:gap-4 md:p-4">
      {/* ── Header ── */}
      {/* ── Header — STICKY: stays visible while scrolling cost report ── */}
      <Card className="sticky top-0 z-20 -mx-3 flex-shrink-0 shadow-sm md:-mx-4">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow">
                  <Calculator className="h-5 w-5" />
                </div>
                <span>ต้นทุนวัสดุและของใช้สิ้นเปลือง</span>
                <Badge
                  variant="outline"
                  className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                >
                  Material Cost
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1 text-xs md:text-sm">
                ต้นทุนหมึก + อะไหล่ + บริการ รายเดือน พร้อมการกระทบยอด (Reconciliation)
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => refetch()}
                disabled={isFetching}
                className="h-10"
              >
                <RefreshCw
                  className={`mr-1 h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`}
                />
                Refresh
              </Button>
              <Button
                size="sm"
                onClick={handleExportCSV}
                disabled={!data}
                className="h-10 bg-emerald-600 hover:bg-emerald-700"
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                CSV
              </Button>
              <CustomColumnSelector
                storageKey="material-cost-cols"
                columns={COST_REPORT_COLUMNS}
                selected={selectedColumns}
                onChange={setSelectedColumns}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="mcr-month" className="text-xs font-medium">
                เดือน
              </Label>
              <Input
                id="mcr-month"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value || currentMonthValue())}
                className="h-10"
              />
            </div>
            {showSiteFilter && (
              <div className="space-y-1.5">
                <Label htmlFor="mcr-site" className="text-xs font-medium">
                  Site
                </Label>
                <Select value={site} onValueChange={setSite}>
                  <SelectTrigger id="mcr-site" className="h-10">
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
            )}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">เดือนที่เลือก</Label>
              <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" />
                {formatMonthLabel(month)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <ReportSkeleton />
      ) : !data ? (
        <Card className="min-h-0 flex-1">
          <CardContent className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <span>ไม่สามารถโหลดรายงานได้</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="mt-2"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              ลองใหม่
            </Button>
          </CardContent>
        </Card>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 md:space-y-4"
        >
          {/* ── Summary KPI cards ── */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard
              label="ต้นทุนรวมทั้งเดือน"
              value={formatBaht(data.totalCost)}
              icon={<Coins className="h-5 w-5" />}
              accent="#0d9488"
              subtitle={formatMonthLabel(month)}
            />
            <KpiCard
              label="หมึกพิมพ์"
              value={formatBaht(data.ink.totalCost)}
              icon={<Droplet className="h-5 w-5" />}
              accent="#f97316"
              subtitle={`${formatInt(data.ink.totalBottles)} ขวด · ${inkPct}%`}
            />
            <KpiCard
              label="อะไหล่"
              value={formatBaht(data.spareParts.totalCost)}
              icon={<Wrench className="h-5 w-5" />}
              accent="#8b5cf6"
              subtitle={`${formatInt(data.spareParts.totalItems)} ชิ้น · ${sparePct}%`}
            />
            <KpiCard
              label="บริการ"
              value={formatBaht(data.service.totalCost)}
              icon={<Briefcase className="h-5 w-5" />}
              accent="#14b8a6"
              subtitle={`${servicePct}%`}
            />
          </div>

          {/* ── Cost composition bar ── */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <TrendingUp className="h-4 w-4 text-[#f97316]" />
                สัดส่วนต้นทุนแยกประเภท
                <span className="ml-1 text-xs font-normal text-slate-400">
                  (รวม {formatBaht(data.totalCost)})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex h-6 w-full overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
                {inkPct > 0 && (
                  <div
                    className="flex items-center justify-center text-[10px] font-semibold text-white"
                    style={{ width: `${inkPct}%`, background: '#f97316' }}
                    title={`หมึก ${inkPct}%`}
                  >
                    {inkPct >= 8 ? `${inkPct}%` : ''}
                  </div>
                )}
                {sparePct > 0 && (
                  <div
                    className="flex items-center justify-center text-[10px] font-semibold text-white"
                    style={{ width: `${sparePct}%`, background: '#8b5cf6' }}
                    title={`อะไหล่ ${sparePct}%`}
                  >
                    {sparePct >= 8 ? `${sparePct}%` : ''}
                  </div>
                )}
                {servicePct > 0 && (
                  <div
                    className="flex items-center justify-center text-[10px] font-semibold text-white"
                    style={{ width: `${servicePct}%`, background: '#14b8a6' }}
                    title={`บริการ ${servicePct}%`}
                  >
                    {servicePct >= 8 ? `${servicePct}%` : ''}
                  </div>
                )}
                {data.totalCost === 0 && (
                  <div className="flex h-full w-full items-center justify-center text-[11px] text-slate-400">
                    ไม่มีข้อมูลต้นทุนในเดือนที่เลือก
                  </div>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
                <Legend color="#f97316" label="หมึก" value={formatBaht(data.ink.totalCost)} />
                <Legend color="#8b5cf6" label="อะไหล่" value={formatBaht(data.spareParts.totalCost)} />
                <Legend color="#14b8a6" label="บริการ" value={formatBaht(data.service.totalCost)} />
              </div>
            </CardContent>
          </Card>

          {/* ── Ink table ── */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Droplet className="h-4 w-4 text-[#f97316]" />
                หมึกพิมพ์ (Consumable)
                <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300">
                  {data.ink.items.length} รายการ · {formatInt(data.ink.totalBottles)} ขวด
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="itam-scroll max-h-[40vh] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm dark:bg-slate-900/95">
                    <TableRow className="text-xs">
                      <TableHead className="w-[30%]">รายการ</TableHead>
                      <TableHead className="text-right">{t('common.quantity')}</TableHead>
                      <TableHead className="text-right">ราคา/ขวด</TableHead>
                      <TableHead className="text-right">ต้นทุนรวม</TableHead>
                      <TableHead className="text-right">แผ่น/ขวด</TableHead>
                      <TableHead className="text-right">ต้นทุน/แผ่น</TableHead>
                      <TableHead className="text-right">แผ่นต่อรอบ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.ink.items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-xs text-slate-400">
                          ยังไม่มีการเบิกหมึกในเดือนที่เลือก
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.ink.items.map((it) => (
                        <TableRow key={it.stockItemId} className="text-xs">
                          <TableCell>
                            <div className="font-medium text-slate-700 dark:text-slate-200">{it.productName}</div>
                            <div className="font-mono text-[10px] text-slate-400">{it.productCode}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatInt(it.totalBottles)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatBaht(it.unitCost)}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums text-[#f97316]">{formatBaht(it.totalCost)}</TableCell>
                          <TableCell className="text-right tabular-nums">{it.yieldPerPage ? formatInt(it.yieldPerPage) : '—'}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {it.costPerPage != null ? (
                              <span className="font-medium text-emerald-700 dark:text-emerald-400">{formatBaht(it.costPerPage)}</span>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-slate-500">{it.coveragePages ? formatInt(it.coveragePages) : '—'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                  {data.ink.items.length > 0 && (
                    <tfoot className="sticky bottom-0 bg-slate-50/95 backdrop-blur-sm dark:bg-slate-900/95">
                      <tr className="border-t-2 border-slate-200 text-xs font-semibold dark:border-slate-700">
                        <td className="px-3 py-2">รวมหมึก</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatInt(data.ink.totalBottles)}</td>
                        <td></td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#f97316]">{formatBaht(data.ink.totalCost)}</td>
                        <td colSpan={2} className="px-3 py-2 text-right text-slate-500">
                          เฉลี่ย {data.ink.avgCostPerPage != null ? formatBaht(data.ink.avgCostPerPage) : '—'}/แผ่น
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                          {formatInt(data.reconciliation.inkCoveragePages)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* ── Spare parts table ── */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Wrench className="h-4 w-4 text-violet-500" />
                อะไหล่ (Spare Parts)
                <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300">
                  {data.spareParts.items.length} รายการ · {formatInt(data.spareParts.totalItems)} ชิ้น
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="itam-scroll max-h-[40vh] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm dark:bg-slate-900/95">
                    <TableRow className="text-xs">
                      <TableHead className="w-[28%]">รายการ</TableHead>
                      <TableHead className="text-right">{t('common.quantity')}</TableHead>
                      <TableHead className="text-right">ราคา/ชิ้น</TableHead>
                      <TableHead className="text-right">ต้นทุนรวม</TableHead>
                      <TableHead>วิธีคำนวณ</TableHead>
                      <TableHead className="text-right">อายุการใช้งาน</TableHead>
                      <TableHead className="text-right">ต้นทุน/เดือน</TableHead>
                      <TableHead className="text-right">ต้นทุน/แผ่น</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.spareParts.items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-xs text-slate-400">
                          ยังไม่มีการเบิกอะไหล่ในเดือนที่เลือก
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.spareParts.items.map((it) => (
                        <TableRow key={it.stockItemId} className="text-xs">
                          <TableCell>
                            <div className="font-medium text-slate-700 dark:text-slate-200">{it.productName}</div>
                            <div className="font-mono text-[10px] text-slate-400">{it.productCode}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatInt(it.totalItems)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatBaht(it.unitCost)}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums text-violet-600 dark:text-violet-400">{formatBaht(it.totalCost)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">
                              {depreciationLabel(it.depreciationMethod)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-slate-500">
                            {it.usefulLifeMonths ? `${it.usefulLifeMonths} เดือน` : ''}
                            {it.usefulLifePages ? `${formatInt(it.usefulLifePages)} แผ่น` : ''}
                            {!it.usefulLifeMonths && !it.usefulLifePages ? '—' : ''}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {it.costPerMonth != null ? (
                              <span className="font-medium text-amber-700 dark:text-amber-400">{formatBaht(it.costPerMonth)}</span>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {it.costPerPage != null ? (
                              <span className="font-medium text-emerald-700 dark:text-emerald-400">{formatBaht(it.costPerPage)}</span>
                            ) : '—'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                  {data.spareParts.items.length > 0 && (
                    <tfoot className="sticky bottom-0 bg-slate-50/95 backdrop-blur-sm dark:bg-slate-900/95">
                      <tr className="border-t-2 border-slate-200 text-xs font-semibold dark:border-slate-700">
                        <td className="px-3 py-2">รวมอะไหล่</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatInt(data.spareParts.totalItems)}</td>
                        <td></td>
                        <td className="px-3 py-2 text-right tabular-nums text-violet-600 dark:text-violet-400">{formatBaht(data.spareParts.totalCost)}</td>
                        <td colSpan={3} className="px-3 py-2 text-right text-slate-500">
                          ค่าเสื่อมราคารวม/เดือน
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-amber-700 dark:text-amber-400">
                          {formatBaht(data.spareParts.monthlyDepreciation)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* ── Service table ── */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Briefcase className="h-4 w-4 text-teal-500" />
                รายการบริการ (Service)
                <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300">
                  {data.service.items.length} รายการ
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="itam-scroll max-h-[30vh] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm dark:bg-slate-900/95">
                    <TableRow className="text-xs">
                      <TableHead className="w-[40%]">รายการ</TableHead>
                      <TableHead className="text-right">{t('common.quantity')}</TableHead>
                      <TableHead className="text-right">ราคา</TableHead>
                      <TableHead className="text-right">ต้นทุนรวม</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.service.items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-8 text-center text-xs text-slate-400">
                          ยังไม่มีการเบิกรายการบริการในเดือนที่เลือก
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.service.items.map((it) => (
                        <TableRow key={it.stockItemId} className="text-xs">
                          <TableCell>
                            <div className="font-medium text-slate-700 dark:text-slate-200">{it.productName}</div>
                            <div className="font-mono text-[10px] text-slate-400">{it.productCode}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatInt(it.totalQuantity)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatBaht(it.unitCost)}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums text-teal-600 dark:text-teal-400">{formatBaht(it.totalCost)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                  {data.service.items.length > 0 && (
                    <tfoot className="sticky bottom-0 bg-slate-50/95 backdrop-blur-sm dark:bg-slate-900/95">
                      <tr className="border-t-2 border-slate-200 text-xs font-semibold dark:border-slate-700">
                        <td className="px-3 py-2">รวมบริการ</td>
                        <td colSpan={2}></td>
                        <td className="px-3 py-2 text-right tabular-nums text-teal-600 dark:text-teal-400">{formatBaht(data.service.totalCost)}</td>
                      </tr>
                    </tfoot>
                  )}
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* ── Reconciliation ── */}
          <Card className={`shadow-sm border-l-4 ${
            diffSeverity === 'ok' ? 'border-l-emerald-400' :
            diffSeverity === 'warn' ? 'border-l-amber-400' : 'border-l-rose-400'
          }`}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ArrowLeftRight className={`h-4 w-4 ${
                  diffSeverity === 'ok' ? 'text-emerald-500' :
                  diffSeverity === 'warn' ? 'text-amber-500' : 'text-rose-500'
                }`} />
                การกระทบยอด (Reconciliation)
                <Badge
                  variant="outline"
                  className={
                    diffSeverity === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' :
                    diffSeverity === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300' :
                    'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300'
                  }
                >
                  {diffSeverity === 'ok' ? '✓ ปกติ' : diffSeverity === 'warn' ? '⚠ ตรวจสอบ' : '⚠ สูง'}
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                เปรียบเทียบต้นทุนหมึก (จากสต๊อก) กับค่ากระดาษ (จากมิเตอร์) — ผลต่าง 10-20% ถือว่าปกติ
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <ReconcilBox
                  label="แผ่นที่หมึกครอบคลุม"
                  value={formatInt(data.reconciliation.inkCoveragePages)}
                  unit="แผ่น"
                  hint="Σ(quantity × yieldPerPage)"
                  accent="#f97316"
                />
                <ReconcilBox
                  label="แผ่นที่พิมพ์จริง"
                  value={formatInt(data.reconciliation.actualPrintedPages)}
                  unit="แผ่น"
                  hint="จากการจดมิเตอร์ในเดือนที่เลือก"
                  accent="#0d9488"
                />
                <ReconcilBox
                  label="ผลต่าง"
                  value={formatInt(data.reconciliation.difference)}
                  unit={`(${data.reconciliation.differencePercent}%)`}
                  hint={
                    diffSeverity === 'ok' ? 'ปกติ' :
                    diffSeverity === 'warn' ? 'ตรวจสอบ' :
                    'สูง'
                  }
                  accent={
                    diffSeverity === 'ok' ? '#10b981' :
                    diffSeverity === 'warn' ? '#f59e0b' : '#f43f5e'
                  }
                />
                <ReconcilBox
                  label="ผลต่าง/แผ่น"
                  value={data.reconciliation.costPerPageDiff != null ? formatBaht(data.reconciliation.costPerPageDiff) : '—'}
                  unit="บาท/แผ่น"
                  hint={`สต๊อก ${data.reconciliation.stockCostPerPage != null ? formatBaht(data.reconciliation.stockCostPerPage) : '—'} กับมิเตอร์ ${data.reconciliation.meterCostPerPage != null ? formatBaht(data.reconciliation.meterCostPerPage) : '—'}`}
                  accent="#6366f1"
                />
              </div>

              {Math.abs(data.reconciliation.differencePercent) > 20 && (
                <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 dark:border-rose-800 dark:bg-rose-950/40">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500 mt-0.5" />
                    <div className="text-xs text-rose-700 dark:text-rose-300">
                      <strong>ผลต่างเกิน 20%</strong> — สาเหตุที่เป็นไปได้:
                      <ul className="mt-1 ml-4 list-disc space-y-0.5">
                        <li>หมึกสี/ผงหมึก/ค่าเสื่อม — ตรวจสอบการเบิกที่ยังไม่ได้ใช้พิมพ์</li>
                        <li>อัตราค่ากระดาษยังไม่รวมต้นทุนหมึก (ใช้ค่ากระดาษเป็นค่าประมาณ)</li>
                        <li>มิเตอร์ไม่ตรงกัน (ค่าย้อนหลัง/เศษที่ไม่ได้บันทึกให้ถูกต้อง)</li>
                        <li>ตั้งค่า yieldPerPage ผิด (ตรวจสอบสเปกขวดหมึกอีกครั้ง)</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-3 rounded-md bg-slate-50 p-3 dark:bg-slate-800/40">
                <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <TrendingDown className="h-4 w-4 shrink-0 text-slate-400 mt-0.5" />
                  <div>
                    <strong>คำแนะนำ:</strong> ใช้ต้นทุนจากสต๊อกเป็นหลัก (แม่นยำกว่า) — อัตราค่ากระดาษใช้เรียกเก็บตามไซต์ (สำหรับออกบิล)
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  accent,
  subtitle,
}: {
  label: string
  value: string
  icon: React.ReactNode
  accent: string
  subtitle?: string
}) {
  return (
    <Card className="relative overflow-hidden shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: accent }}
      />
      <CardContent className="flex items-center gap-3 p-3 sm:p-4">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-105"
          style={{ background: `${accent}1a`, color: accent }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">
            {label}
          </div>
          <div className="truncate text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100 sm:text-xl">
            {value}
          </div>
          {subtitle && (
            <div className="truncate text-[10px] text-slate-400 dark:text-slate-500">
              {subtitle}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={{ background: color }}
      />
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  )
}

function ReconcilBox({
  label,
  value,
  unit,
  hint,
  accent,
}: {
  label: string
  value: string
  unit: string
  hint: string
  accent: string
}) {
  return (
    <div
      className="rounded-md border-l-2 bg-white p-3 shadow-sm dark:bg-slate-900"
      style={{ borderColor: accent }}
    >
      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">
          {value}
        </span>
        <span className="text-[10px] text-slate-400">{unit}</span>
      </div>
      <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
        {hint}
      </div>
    </div>
  )
}

function ReportSkeleton() {
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-20 w-full rounded-lg" />
      <Skeleton className="h-72 w-full rounded-lg" />
      <Skeleton className="h-72 w-full rounded-lg" />
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  )
}
