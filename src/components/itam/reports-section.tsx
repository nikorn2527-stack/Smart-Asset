'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import {
  LayoutDashboard,
  Gauge,
  History,
  Activity,
  Plus,
  Eye,
  Download,
  Trash2,
  FileText,
  Inbox,
  Loader2,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT, useFormatDateTime, useLang, getCurrentLang, localeFor, getTranslator } from '@/store/i18n-store'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type {
  ReportListItem,
  ReportType,
  ReportDetail,
} from './types'
import {
  DASHBOARD_RANGE_OPTIONS,
  reportTypeLabel,
  relativeTime,
  formatBaht,
  formatThaiDate,
} from './types'
import { downloadCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'

const TYPE_ICON_MAP: Record<
  ReportType,
  { icon: React.ReactNode; accent: string; badgeClass: string }
> = {
  dashboard_summary: {
    icon: <LayoutDashboard className="h-4 w-4" />,
    accent: '#0d9488',
    badgeClass:
      'border-teal-300 bg-teal-100 text-teal-800 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300',
  },
  cycle: {
    icon: <Gauge className="h-4 w-4" />,
    accent: '#f97316',
    badgeClass:
      'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300',
  },
  audit: {
    icon: <History className="h-4 w-4" />,
    accent: '#6366f1',
    badgeClass:
      'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  utilization: {
    icon: <Activity className="h-4 w-4" />,
    accent: '#10b981',
    badgeClass:
      'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  },
}

const REPORT_TYPE_SELECT_OPTIONS: {
  value: ReportType
  label: string
}[] = [
  { value: 'dashboard_summary', label: 'Summary' },
  { value: 'cycle', label: 'Meter Cycle' },
  { value: 'audit', label: 'Audit Log' },
  { value: 'utilization', label: 'Device Usage' },
]

function defaultTitle(type: ReportType, rangeLabel: string): string {
  return `${reportTypeLabel(type)} — ${rangeLabel} (${new Date().toLocaleDateString(localeFor(getCurrentLang()))})`
}

export function ReportsSection() {
  const t = useT()
  const { lang } = useLang()
  const formatDateTime = useFormatDateTime()
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [viewId, setViewId] = React.useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<ReportListItem | null>(
    null,
  )
  const [creating, setCreating] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  const [type, setType] = React.useState<ReportType>('dashboard_summary')
  const [rangeKey, setRangeKey] = React.useState<string>('month')
  const [title, setTitle] = React.useState('')

  const { data: reports, isLoading } = useQuery<ReportListItem[]>({
    queryKey: ['reports'],
    queryFn: async () => {
      const res = await fetch('/api/reports?limit=20')
      if (!res.ok) throw new Error('Failed to fetch reports')
      const json = await res.json()
      return (json.reports ?? []) as ReportListItem[]
    },
    staleTime: 30_000,
  })

  const { data: viewReport, isLoading: viewLoading } = useQuery<
    ReportDetail | null
  >({
    queryKey: ['report', viewId],
    queryFn: async () => {
      if (!viewId) return null
      const res = await fetch(`/api/reports/${viewId}`)
      if (!res.ok) return null
      const json = await res.json()
      return json.report as ReportDetail
    },
    enabled: Boolean(viewId),
  })

  // Sync default title when type/range changes (only when title is empty or matches the default for previous type)
  React.useEffect(() => {
    if (!createOpen) return
    const rangeLabel =
      DASHBOARD_RANGE_OPTIONS.find((o) => o.value === rangeKey)?.label ??
      t('reports.range.this_month')
    const newDefault = defaultTitle(type, rangeLabel)
    // Update if user hasn't customized
    setTitle((prev) => {
      if (!prev) return newDefault
      // Heuristic: if the previous title contains '—' and ends with date pattern, replace with new default
      const prevMatched =
        prev.includes('—') && /\(\d{1,2}\/\d{1,2}\/\d{2,4}\)$/.test(prev)
      if (prevMatched) return newDefault
      return prev
    })
  }, [type, rangeKey, createOpen])

  function openCreate() {
    setType('dashboard_summary')
    setRangeKey('month')
    const rangeLabel =
      DASHBOARD_RANGE_OPTIONS.find((o) => o.value === 'month')?.label ??
      t('reports.range.this_month')
    setTitle(defaultTitle('dashboard_summary', rangeLabel))
    setCreateOpen(true)
  }

  async function createReport() {
    try {
      setCreating(true)
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, rangeKey, title: title.trim() || undefined }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Failed to create report')
      }
      toast.success(t('reports.created'))
      setCreateOpen(false)
      await qc.invalidateQueries({ queryKey: ['reports'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create report')
    } finally {
      setCreating(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      const res = await fetch(`/api/reports/${deleteTarget.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Failed to delete report')
      }
      toast.success(t('reports.deleted'))
      setDeleteTarget(null)
      await qc.invalidateQueries({ queryKey: ['reports'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete report')
    } finally {
      setDeleting(false)
    }
  }

  function downloadCsv_(r: ReportListItem) {
    // Need to fetch full data first
    fetch(`/api/reports/${r.id}`)
      .then((res) => res.json())
      .then((json) => {
        const detail = json.report as ReportDetail
        const data = detail.data as Record<string, unknown> | null
        if (!data) {
          toast.error(t('reports.no_data_in_report'))
          return
        }
        // Flatten the report data: try common shapes
        let rows: Record<string, unknown>[] = []
        if (Array.isArray(data)) {
          rows = data as Record<string, unknown>[]
        } else if (Array.isArray((data as { devices?: unknown }).devices)) {
          rows = (data as { devices: Record<string, unknown>[] }).devices
        } else if (Array.isArray((data as { logs?: unknown }).logs)) {
          rows = (data as { logs: Record<string, unknown>[] }).logs
        } else if (Array.isArray((data as { byDevice?: unknown }).byDevice)) {
          rows = (data as { byDevice: Record<string, unknown>[] }).byDevice
        } else if (Array.isArray((data as { recentReadings?: unknown }).recentReadings)) {
          rows = (data as { recentReadings: Record<string, unknown>[] }).recentReadings
        } else {
          // Single object — emit a 1-row summary
          rows = [data as Record<string, unknown>]
        }
        const safeName = r.title.replace(/[^\u0E00-\u0E7Fa-zA-Z0-9-]+/g, '_').slice(0, 60)
        downloadCsv(`report-${safeName}.csv`, rows)
        toast.success(`${t('reports.download')} CSV`)
      })
      .catch(() => toast.error(`${t('reports.download')} CSV ${t('reports.create_failed')}`))
  }

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base text-slate-800 dark:text-slate-100">
          <FileText className="h-4 w-4 text-[#f97316]" />
          📋 {t('reports.section.title')}
          <span className="ml-2 text-xs font-normal text-slate-400 dark:text-slate-500">
            {t('reports.section.subtitle')}
          </span>
        </CardTitle>
        <Button
          size="sm"
          onClick={openCreate}
          className="shrink-0 bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
        >
          <Plus className="h-4 w-4" />
          {t('reports.create_new')}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full dark:bg-slate-800" />
            ))}
          </div>
        ) : (reports ?? []).length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-slate-400 dark:text-slate-500">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
              <Inbox className="h-6 w-6 text-slate-300 dark:text-slate-400" />
            </div>
            <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">
              {t('reports.empty')}
            </div>
            <div className="text-xs text-slate-400 dark:text-slate-500">
              {t('reports.create_first_hint')}
            </div>
            <Button
              size="sm"
              onClick={openCreate}
              className="mt-2 bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
            >
              <Plus className="h-4 w-4" />
              {t('reports.create_first')}
            </Button>
          </div>
        ) : (
          <div className="itam-scroll max-h-[40vh] space-y-2 overflow-y-auto pr-1">
            {(reports ?? []).map((r, idx) => {
              const meta =
                TYPE_ICON_MAP[r.type as ReportType] ?? TYPE_ICON_MAP.audit
              return (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.18,
                    delay: Math.min(0.04 * idx, 0.3),
                    ease: 'easeOut',
                  }}
                  className="group flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
                    style={{ background: `${meta.accent}1a`, color: meta.accent }}
                  >
                    {meta.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                      {r.title}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                      <Badge
                        className={cn(
                          'px-1.5 py-0 text-[10px] font-medium',
                          meta.badgeClass,
                        )}
                      >
                        {reportTypeLabel(r.type)}
                      </Badge>
                      {r.rangeKey && (
                        <span>
                          {DASHBOARD_RANGE_OPTIONS.find(
                            (o) => o.value === r.rangeKey,
                          )?.label ?? r.rangeKey}
                        </span>
                      )}
                      <span>·</span>
                      <span title={r.createdAt}>
                        {relativeTime(r.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setViewId(r.id)}
                      aria-label="{t('reports.view')}"
                      title="{t('reports.view')}"
                      className="h-8 w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => downloadCsv_(r)}
                      aria-label="{t('reports.download')} CSV"
                      title="{t('reports.download')} CSV"
                      className="h-8 w-8 text-[#0d9488] hover:bg-teal-50 dark:text-[#14b8a6] dark:hover:bg-teal-950/40"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setDeleteTarget(r)}
                      aria-label="{t('reports.delete')}"
                      title="{t('reports.delete')}"
                      className="h-8 w-8 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}

        {/* Create Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="sm:max-w-md dark:border-slate-800 dark:bg-slate-900">
            <DialogHeader>
              <DialogTitle className="text-slate-800 dark:text-slate-100">
                {t('reports.create_new')}
              </DialogTitle>
              <DialogDescription>
                {t('reports.dialog.subtitle')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t('reports.col.type')}
                </Label>
                <Select
                  value={type}
                  onValueChange={(v) => setType(v as ReportType)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REPORT_TYPE_SELECT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t('reports.col.range')}
                </Label>
                <Select value={rangeKey} onValueChange={setRangeKey}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DASHBOARD_RANGE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t('reports.col.name')}
                </Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="{t('reports.dialog.name_placeholder')}..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
              >
                {t('reports.cancel')}
              </Button>
              <Button
                onClick={createReport}
                disabled={creating}
                className="bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
              >
                {creating ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 h-4 w-4" />
                )}
                {creating ? `${t('reports.creating')}...` : t('common.save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* View Dialog */}
        <Dialog
          open={Boolean(viewId)}
          onOpenChange={(o) => !o && setViewId(null)}
        >
          <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl dark:border-slate-800 dark:bg-slate-900">
            <DialogHeader>
              <DialogTitle className="text-slate-800 dark:text-slate-100">
                {viewReport?.title ?? t('reports.section.title')}
              </DialogTitle>
              <DialogDescription>
                {viewReport
                  ? `${t('reports.col.type')}: ${reportTypeLabel(viewReport.type)} · ${t('reports.col.created_at')} ${formatDateTime(
                      viewReport.createdAt.slice(0, 10),
                    )}`
                  : `${t('reports.loading')}...`}
              </DialogDescription>
            </DialogHeader>
            <div className="py-2">
              {viewLoading ? (
                <Skeleton className="h-72 w-full dark:bg-slate-800" />
              ) : viewReport ? (
                <ReportDataView report={viewReport} />
              ) : (
                <div className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                  {t('reports.not_found')}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete confirm */}
        <AlertDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
        >
          <AlertDialogContent className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-slate-800 dark:text-slate-100">
                {t('reports.confirm_delete_title')}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('reports.confirm_delete_msg')}{' '}
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {deleteTarget?.title}
                </span>{' '}
                
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>{t('reports.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault() // prevent Radix auto-close before async completes
                  void confirmDelete()
                }}
                disabled={deleting}
                className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
              >
                {deleting ? `${t('reports.deleting')}...` : t('reports.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

/** Pretty-print the various report types in the view dialog. */
function ReportDataView({ report }: { report: ReportDetail }) {
  const t = useT()
  const { lang } = useLang()
  const data = report.data as
    | {
        type?: string
        generatedAt?: string
        range?: { label?: string; start?: string | null; end?: string | null }
        summary?: Record<string, unknown>
        totals?: Record<string, unknown>
        byStatus?: Array<{ name: string; value: number }>
        byType?: Array<{ name: string; value: number }>
        // Produced by the dashboard_summary report builder (see
        // src/modules/reports/*) and rendered in the summary card grid below.
        paperThisMonth?: number
        // Row identity is `assetCode` — there is no `id` on these rows.
        topUsage?: Array<{ name: string; assetCode: string; value: number }>
        recentActivity?: Array<Record<string, unknown>>
        cycles?: Array<Record<string, unknown>>
        readingCount?: number
        totalSheets?: number
        byDevice?: Array<Record<string, unknown>>
        recentReadings?: Array<Record<string, unknown>>
        totalCount?: number
        byAction?: Array<{ action: string; count: number }>
        byEntity?: Array<{ entity: string; count: number }>
        logs?: Array<Record<string, unknown>>
        deviceCount?: number
        usedDeviceCount?: number
        devices?: Array<Record<string, unknown>>
      }
    | null

  if (!data) {
    return (
      <div className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
        {t('reports.no_data_in_this')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header — print friendly */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50/60 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/40">
        <Badge className="border-[#f97316]/30 bg-[#f97316]/10 text-[#f97316]">
          {reportTypeLabel(report.type)}
        </Badge>
        {report.rangeKey && (
          <span className="text-slate-500 dark:text-slate-400">
            {t('reports.col.range')}:{' '}
            {DASHBOARD_RANGE_OPTIONS.find((o) => o.value === report.rangeKey)
              ?.label ?? report.rangeKey}
          </span>
        )}
        {data.range?.start && (
          <span className="font-mono text-slate-500 dark:text-slate-400">
            {data.range.start}
            {data.range.end ? ` → ${data.range.end}` : ''}
          </span>
        )}
        {data.generatedAt && (
          <span className="text-slate-400 dark:text-slate-500">
            · {t('reports.col.created_at')} {new Date(data.generatedAt).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
          </span>
        )}
      </div>

      {/* Summary cards */}
      {data.summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(data.summary).map(([k, v]) => (
            <div
              key={k}
              className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {summaryLabel(k)}
              </div>
              <div className="mt-0.5 text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
                {formatSummaryValue(k, v)}
              </div>
            </div>
          ))}
        </div>
      )}

      {data.totals && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(data.totals).map(([k, v]) => (
            <div
              key={k}
              className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {summaryLabel(k)}
              </div>
              <div className="mt-0.5 text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
                {String(v ?? 0)}
              </div>
            </div>
          ))}
          {typeof data.paperThisMonth === 'number' && (
            <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {t('reports.type.paper')}
              </div>
              <div className="mt-0.5 text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
                {data.paperThisMonth.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} ${t('reports.unit.sheet')}
              </div>
            </div>
          )}
        </div>
      )}

      {typeof data.totalSheets === 'number' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {typeof data.readingCount === 'number' && (
            <StatBox label={t('reports.summary.meter_count')} value={String(data.readingCount)} />
          )}
          <StatBox
            label={t('reports.summary.paper_total')}
            value={`${data.totalSheets.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} ${t('reports.unit.sheet')}`}
          />
          {typeof data.deviceCount === 'number' && (
            <StatBox label={t('reports.summary.total_devices')} value={String(data.deviceCount)} />
          )}
          {typeof data.usedDeviceCount === 'number' && (
            <StatBox
              label={t('reports.summary.active_devices')}
              value={String(data.usedDeviceCount)}
            />
          )}
          {typeof data.totalCount === 'number' && (
            <StatBox label={`${t('reports.unit.count')} log ${t('reports.range.all')}`} value={String(data.totalCount)} />
          )}
        </div>
      )}

      {/* byStatus / byType */}
      {data.byStatus && data.byStatus.length > 0 && (
        <SubSection title={t('reports.summary.by_status')}>
          <div className="flex flex-wrap gap-2">
            {data.byStatus.map((s) => (
              <Badge
                key={s.name}
                className="border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                {s.name}: {s.value}
              </Badge>
            ))}
          </div>
        </SubSection>
      )}
      {data.byType && data.byType.length > 0 && (
        <SubSection title={t('reports.summary.by_type')}>
          <div className="flex flex-wrap gap-2">
            {data.byType.map((s) => (
              <Badge
                key={s.name}
                className="border-teal-300 bg-teal-100 text-teal-800 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300"
              >
                {s.name}: {s.value}
              </Badge>
            ))}
          </div>
        </SubSection>
      )}
      {data.byAction && data.byAction.length > 0 && (
        <SubSection title={t('reports.summary.by_activity')}>
          <div className="flex flex-wrap gap-2">
            {data.byAction.map((s) => (
              <Badge
                key={s.action}
                className="border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
              >
                {s.action}: {s.count}
              </Badge>
            ))}
          </div>
        </SubSection>
      )}
      {data.byEntity && data.byEntity.length > 0 && (
        <SubSection title={`${t('reports.summary.by_status_label')} entity`}>
          <div className="flex flex-wrap gap-2">
            {data.byEntity.map((s) => (
              <Badge
                key={s.entity}
                className="border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                {s.entity}: {s.count}
              </Badge>
            ))}
          </div>
        </SubSection>
      )}

      {/* Top usage list */}
      {data.topUsage && data.topUsage.length > 0 && (
        <SubSection title={t('reports.summary.top_devices')}>
          <ol className="space-y-1">
            {data.topUsage.slice(0, 10).map((d, i) => (
              <li
                key={`${d.assetCode}-${i}`}
                className="flex items-center justify-between rounded border border-slate-100 bg-slate-50/60 px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-800/40"
              >
                <span className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#f97316] text-[10px] font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="text-slate-700 dark:text-slate-200">
                    {String(d.name ?? '-')}
                  </span>
                  <span className="font-mono text-slate-400 dark:text-slate-500">
                    {String(d.assetCode ?? '')}
                  </span>
                </span>
                <span className="tabular-nums font-medium text-[#f97316]">
                  {Number(d.value ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} ${t('reports.unit.sheet')}
                </span>
              </li>
            ))}
          </ol>
        </SubSection>
      )}

      {/* recentActivity / logs / byDevice / devices / recentReadings */}
      {data.recentActivity && data.recentActivity.length > 0 && (
        <SubSection title={t('reports.summary.recent_activity')}>
          <SimpleRows
            rows={data.recentActivity.slice(0, 12)}
            columns={['deviceName', 'assetCode', 'reading', 'delta', 'date']}
          />
        </SubSection>
      )}
      {data.byDevice && data.byDevice.length > 0 && (
        <SubSection title={t('reports.summary.device_usage')}>
          <SimpleRows
            rows={data.byDevice.slice(0, 12)}
            columns={['assetCode', 'name', 'site', 'delta', 'count']}
          />
        </SubSection>
      )}
      {data.recentReadings && data.recentReadings.length > 0 && (
        <SubSection title={t('reports.type.meter')}>
          <SimpleRows
            rows={data.recentReadings.slice(0, 12)}
            columns={['date', 'assetCode', 'deviceName', 'reading', 'delta']}
          />
        </SubSection>
      )}
      {data.devices && data.devices.length > 0 && (
        <SubSection title={t('reports.type.devices')}>
          <SimpleRows
            rows={data.devices.slice(0, 12)}
            columns={[
              'assetCode',
              'name',
              'site',
              'status',
              'lastMeterReading',
              'sheets',
            ]}
          />
        </SubSection>
      )}
      {data.logs && data.logs.length > 0 && (
        <SubSection title="Audit log">
          <SimpleRows
            rows={data.logs.slice(0, 15)}
            columns={['createdAt', 'action', 'entity', 'summary']}
          />
        </SubSection>
      )}
      {data.cycles && data.cycles.length > 0 && (
        <SubSection title={t('reports.summary.cycle')}>
          <SimpleRows
            rows={data.cycles.slice(0, 10)}
            columns={['name', 'startDate', 'endDate', 'status']}
          />
        </SubSection>
      )}
    </div>
  )
}

function summaryLabel(k: string): string {
  // Module-scope helper (no hooks allowed) → bind a translator imperatively.
  const t = getTranslator()
  switch (k) {
    case 'total':
      return t('reports.range.all')
    case 'active':
      return t('reports.summary.active')
    case 'spare':
      return t('reports.summary.spare')
    case 'repair':
      return t('reports.summary.repair')
    case 'paperThisMonth':
      return t('reports.type.paper')
    case 'totalValue':
      return t('reports.summary.total_value')
    case 'totalOriginal':
      return t('reports.summary.original_value')
    case 'totalDepreciated':
      return t('reports.summary.acc_dep')
    case 'fullyDepreciatedCount':
      return t('reports.summary.expired')
    case 'avgDepreciationPercent':
      return t('reports.summary.avg_dep')
    case 'deviceCount':
      return t('reports.summary.total_devices')
    default:
      return k
  }
}

function formatSummaryValue(k: string, v: unknown): string {
  if (typeof v !== 'number') return String(v ?? '-')
  if (
    k === 'totalValue' ||
    k === 'totalOriginal' ||
    k === 'totalDepreciated'
  ) {
    return formatBaht(v)
  }
  if (k === 'avgDepreciationPercent') return `${v}%`
  return v.toLocaleString(localeFor(getCurrentLang()))
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
        {value}
      </div>
    </div>
  )
}

function SubSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">
        {title}
      </div>
      {children}
    </div>
  )
}

function SimpleRows({
  rows,
  columns,
}: {
  rows: Record<string, unknown>[]
  columns: string[]
}) {
  return (
    <div className="itam-scroll max-h-72 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
          <tr className="text-left text-slate-500 dark:text-slate-400">
            {columns.map((c) => (
              <th key={c} className="px-2 py-1.5 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={String(r.id ?? i)}
              className="border-t border-slate-100 dark:border-slate-800"
            >
              {columns.map((c) => (
                <td
                  key={c}
                  className="px-2 py-1.5 text-slate-700 dark:text-slate-200"
                >
                  {String(r[c] ?? '-')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
