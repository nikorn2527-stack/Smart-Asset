'use client'

// ============================================================
// ReportsHub — centerTotalReport 5 Group + ReportApprove
// ============================================================
// Task ID: REPORTS-HUB-5GROUPS
//
// Tabs:
//   1. Device       — Status/Type/Site/warranty/Feedepreciate
//   2. Meter        — Paper/FeeUsepay/unitsatStillNoRead/comparemonths
//   3. Work Order        — Status/Technician/Subject/Work 50 THB/visit
//   4. Stock         — Summary/Low/end/History/PendingApprove
//   5. Repairmaintain     — Repairperunits/FeeRepair/PartsPopular
//   6. Approve       — PendingApprove/Approve/Special/History
//
// Data source: GET /api/reports/unified?group=<group>&month=YYYY-MM&site=CODE
// ============================================================

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { motion } from 'framer-motion'
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { useAuthStore } from '@/store/auth-store'
import { CustomColumnSelector, type ColumnDef } from './custom-column-selector'
import { ReportBarChart, ReportPieChart } from './report-charts'
import {
  Cpu, Gauge, Wrench, Package, Activity, ShieldCheck,
  FileText, Download, RefreshCw, CalendarDays, Printer,
} from 'lucide-react'

// Column definitions for each report group
const REPORT_COLUMNS: Record<ReportGroup, ColumnDef[]> = {
  devices: [
    { key: 'assetCode', label: 'common.code', default: true },
    { key: 'name', label: 'common.name', default: true },
    { key: 'brand', label: 'common.brand', default: true },
    { key: 'model', label: 'common.model', default: true },
    { key: 'serialNumber', label: 'common.serial', default: true },
    { key: 'status', label: 'common.status', default: true },
    { key: 'site', label: 'common.site', default: true },
    { key: 'department', label: 'Dept', default: false },
    { key: 'warrantyEnd', label: 'warranty', default: false },
    { key: 'purchasePrice', label: 'Price', default: false },
  ],
  workorders: [
    { key: 'woNumber', label: 'เลขที่', default: true },
    { key: 'subject', label: 'Subject', default: true },
    { key: 'status', label: 'common.status', default: true },
    { key: 'priority', label: 'ความเร่งด่วน', default: true },
    { key: 'reporterName', label: 'Reporter', default: true },
    { key: 'assignedTo', label: 'ผู้รับงาน', default: false },
    { key: 'createdAt', label: 'วันที่แจ้ง', default: false },
    { key: 'closedAt', label: 'วันที่ปิด', default: false },
    { key: 'siteCode', label: 'common.site', default: false },
  ],
  meters: [
    { key: 'assetCode', label: 'common.code', default: true },
    { key: 'readingMonth', label: 'lifecycle.month_unit', default: true },
    { key: 'meterBw', label: 'Meter B&W', default: true },
    { key: 'meterColor', label: 'devices.field.last_meter_color', default: true },
    { key: 'pagesBw', label: 'sheets B&W', default: true },
    { key: 'pagesColor', label: 'sheets Color', default: true },
    { key: 'readingType', label: 'common.type', default: false },
    { key: 'readBy', label: 'ผู้จดมิเตอร์', default: false },
  ],
  stock: [
    { key: 'productCode', label: 'common.code', default: true },
    { key: 'productName', label: 'common.name', default: true },
    { key: 'quantity', label: 'Remaining', default: true },
    { key: 'minQuantity', label: 'ขั้นต่ำ', default: true },
    { key: 'unit', label: 'common.unit', default: false },
    { key: 'unitCost', label: 'Price/Unit', default: false },
    { key: 'totalValue', label: 'มูลค่ารวม', default: false },
    { key: 'site', label: 'common.site', default: false },
  ],
  maintenance: [
    { key: 'assetCode', label: 'รหัสอุปกรณ์', default: true },
    { key: 'subject', label: 'Problem', default: true },
    { key: 'status', label: 'common.status', default: true },
    { key: 'assignedTo', label: 'role.staff', default: true },
    { key: 'createdAt', label: 'วันที่รับงาน', default: false },
    { key: 'closedAt', label: 'วันที่ปิด', default: false },
  ],
  approvals: [
    { key: 'reports.unit.type', label: 'common.type', default: true },
    { key: 'status', label: 'common.status', default: true },
    { key: 'requestedBy', label: 'ผู้ขอ', default: true },
    { key: 'approvedBy', label: 'ผู้อนุมัติ', default: false },
    { key: 'createdAt', label: 'วันที่ขอ', default: false },
    { key: 'approvedAt', label: 'วันที่อนุมัติ', default: false },
  ],
}
import {
  currentMonthValue, formatMonthLabel, formatDateTime,
} from './reports/shared'
import { canSelectSite } from './types'
import { DevicesReport } from './reports/devices-report'
import { MetersReport } from './reports/meters-report'
import { WorkOrdersReport } from './reports/workorders-report'
import { StockReport } from './reports/stock-report'
import { MaintenanceReport } from './reports/maintenance-report'
import { ApprovalsReport } from './reports/approvals-report'
import { PrintTemplateSelectionDialog } from './print-template-selection-dialog'
import { useT, useLang } from '@/store/i18n-store'

type ReportGroup =
  | 'devices'
  | 'meters'
  | 'workorders'
  | 'stock'
  | 'maintenance'
  | 'approvals'

const GROUP_LABELS: Record<ReportGroup, string> = {
  devices: 'รายงานอุปกรณ์',
  meters: 'รายงานมิเตอร์',
  workorders: 'รายงานใบงาน',
  stock: 'รายงานสต๊อก',
  maintenance: 'รายงานซ่อมบำรุง',
  approvals: 'รายงานการอนุมัติ',
}

interface Site {
  id: string
  code: string
  name: string
}

export function ReportsHub() {
  const t = useT()
  const { lang } = useLang()
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  const [activeGroup, setActiveGroup] = React.useState<ReportGroup>('devices')
  const [month, setMonth] = React.useState(currentMonthValue())
  const [site, setSite] = React.useState<string>('all')
  const [selectedColumns, setSelectedColumns] = React.useState<string[]>([])

  // ── Site filter visibility — only show if user can select among multiple sites ──
  const authUser = useAuthStore((s) => s.user)
  const showSiteFilter = authUser ? canSelectSite(authUser) : false

  // Print template selection dialog state (Task ID: FIX-1-2-EXPORT-PRINT)
  const [printTemplateOpen, setPrintTemplateOpen] = React.useState(false)

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
    queryKey: ['sites-list'],
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

  // ── Fetch report data ──
  const params = new URLSearchParams({
    group: activeGroup,
    month,
    site,
  })

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['unified-report', activeGroup, month, site],
    queryFn: async () => {
      const res = await fetch(
        `/api/reports/unified?${params.toString()}`,
        { headers: getAuthHeaders() },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'โหลดรายงานไม่สำเร็จ')
      }
      return res.json()
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

  // ── CSV export ──
  function handleExportCSV() {
    if (!data) return
    const rows: string[] = []
    rows.push(`รายงาน,${GROUP_LABELS[activeGroup]}`)
    rows.push(`เดือน,${formatMonthLabel(month)}`)
    rows.push(`ไซต์,${site === 'all' ? 'ทุกไซต์' : site}`)
    rows.push(`สร้างเมื่อ,${new Date().toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}`)
    rows.push('')
    const flatten = (obj: unknown, prefix = '') => {
      if (obj === null || obj === undefined) return
      if (typeof obj !== 'object') {
        rows.push(`${prefix},${String(obj)}`)
        return
      }
      if (Array.isArray(obj)) {
        if (obj.length === 0) {
          rows.push(`${prefix},(empty)`)
          return
        }
        if (typeof obj[0] === 'object' && obj[0] !== null) {
          const keys = Object.keys(obj[0] as Record<string, unknown>)
          rows.push(`${prefix},`)
          rows.push(keys.join(','))
          for (const item of obj) {
            const v = item as Record<string, unknown>
            rows.push(keys.map((k) => String(v[k] ?? '')).join(','))
          }
          rows.push('')
          return
        }
        rows.push(`${prefix},${obj.join(',')}`)
        return
      }
      const o = obj as Record<string, unknown>
      for (const [k, v] of Object.entries(o)) {
        const newPrefix = prefix ? `${prefix}.${k}` : k
        flatten(v, newPrefix)
      }
    }
    flatten(data)
    const csv = '\uFEFF' + rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report-${activeGroup}-${month}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('ส่งออก CSV แล้ว')
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3 md:gap-4 md:p-4">
      {/* ── Header ── */}
      <Card className="flex-shrink-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow">
                  <FileText className="h-5 w-5" />
                </div>
                <span>ศูนย์รายงาน</span>
                <Badge
                  variant="outline"
                  className="border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300"
                >
                  5 กลุ่ม + การอนุมัติ
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1 text-xs md:text-sm">
                รายงานสรุปตามอุปกรณ์ / มิเตอร์ / ใบงาน / สต๊อก / ซ่อมบำรุง และรายงานการอนุมัติ
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
                รีเฟรช
              </Button>
              <Button
                size="sm"
                onClick={handleExportCSV}
                disabled={!data}
                className="h-10 bg-orange-500 hover:bg-orange-600"
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                ส่งออก CSV
              </Button>
              {/* Custom column selector */}
              <CustomColumnSelector
                storageKey={`reports-${activeGroup}-cols`}
                columns={REPORT_COLUMNS[activeGroup] || []}
                selected={selectedColumns}
                onChange={setSelectedColumns}
              />
              {/* Print PDF — Task ID: FIX-1-2-EXPORT-PRINT */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPrintTemplateOpen(true)}
                disabled={!data}
                className="h-10 border-[#f97316] text-[#f97316] hover:bg-[#f97316]/10 dark:border-[#fb923c] dark:text-[#fb923c]"
                title="เลือกเทมเพลตก่อนพิมพ์ PDF"
              >
                <Printer className="mr-1 h-3.5 w-3.5" />
                พิมพ์ PDF
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="rh-month" className="text-xs font-medium">
                เดือน
              </Label>
              <Input
                id="rh-month"
                type="month"
                value={month}
                onChange={(e) =>
                  setMonth(e.target.value || currentMonthValue())
                }
                className="h-10"
              />
            </div>
            {showSiteFilter && (
              <div className="space-y-1.5">
                <Label htmlFor="rh-site" className="text-xs font-medium">
                  Site
                </Label>
                <Select value={site} onValueChange={setSite}>
                  <SelectTrigger id="rh-site" className="h-10">
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
              <Label className="text-xs font-medium">ข้อมูล</Label>
              <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" />
                {data?.generatedAt
                  ? formatDateTime(data.generatedAt)
                  : t('common.loading')}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Tabs ── */}
      <Tabs
        value={activeGroup}
        onValueChange={(v) => setActiveGroup(v as ReportGroup)}
        className="flex min-h-0 flex-1 flex-col gap-3"
      >
        <TabsList className="grid h-auto w-full flex-shrink-0 grid-cols-3 gap-1 md:grid-cols-6">
          <TabsTrigger value="devices" className="flex flex-col items-center gap-0.5 py-2 text-xs md:text-sm">
            <Cpu className="h-4 w-4" />
            <span>{t('dash.heatmap.device')}</span>
          </TabsTrigger>
          <TabsTrigger value="meters" className="flex flex-col items-center gap-0.5 py-2 text-xs md:text-sm">
            <Gauge className="h-4 w-4" />
            <span>Meter</span>
          </TabsTrigger>
          <TabsTrigger value="workorders" className="flex flex-col items-center gap-0.5 py-2 text-xs md:text-sm">
            <Wrench className="h-4 w-4" />
            <span>{t('jobtype.work-order')}</span>
          </TabsTrigger>
          <TabsTrigger value="stock" className="flex flex-col items-center gap-0.5 py-2 text-xs md:text-sm">
            <Package className="h-4 w-4" />
            <span>Stock</span>
          </TabsTrigger>
          <TabsTrigger value="maintenance" className="flex flex-col items-center gap-0.5 py-2 text-xs md:text-sm">
            <Activity className="h-4 w-4" />
            <span>ซ่อมบำรุง</span>
          </TabsTrigger>
          <TabsTrigger value="approvals" className="flex flex-col items-center gap-0.5 py-2 text-xs md:text-sm">
            <ShieldCheck className="h-4 w-4" />
            <span>Approve</span>
          </TabsTrigger>
        </TabsList>

        {/* ── Content ── */}
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
            key={activeGroup}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 md:space-y-4"
          >
            {activeGroup === 'devices' && <DevicesReport data={data} isDark={isDark} />}
            {activeGroup === 'meters' && <MetersReport data={data} isDark={isDark} />}
            {activeGroup === 'workorders' && <WorkOrdersReport data={data} isDark={isDark} />}
            {activeGroup === 'stock' && <StockReport data={data} />}
            {activeGroup === 'maintenance' && <MaintenanceReport data={data} isDark={isDark} />}
            {activeGroup === 'approvals' && <ApprovalsReport data={data} />}
          </motion.div>
        )}
      </Tabs>

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
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────
function ReportSkeleton() {
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-72 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  )
}
