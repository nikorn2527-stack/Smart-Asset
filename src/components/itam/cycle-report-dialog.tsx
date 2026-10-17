'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  BarChart3,
  Download,
  Gauge,
  AlertTriangle,
  CheckCircle2,
  Package,
  TrendingUp,
  ChevronRight,
  ChevronDown,
  Inbox,
  FileWarning,
  RotateCcw,
} from 'lucide-react'
import { downloadCsv, dateStamp } from '@/lib/csv'
import { useAuthStore } from '@/store/auth-store'
import { useLang } from '@/store/i18n-store'
import { bearerHeaders } from '@/lib/http-headers'

interface ReportCycle {
  id: string
  name: string
  startDate: string
  endDate: string
  status: string
  daysRemaining: number
}
interface ReportSummary {
  totalReadings: number
  totalSheets: number
  avgDelta: number
  deviceCount: number
  unreadCount: number
}
interface ReportReading {
  id: string
  date: string
  reading: number
  prevReading: number
  delta: number
  remark: string | null
}
interface ReportDevice {
  deviceId: string
  assetCode: string
  name: string
  brand: string
  model: string
  site: string
  type: string
  readings: ReportReading[]
  firstReading: number | null
  lastReading: number | null
  totalDelta: number
  readingCount: number
}
interface ReportAnomaly {
  readingId: string
  deviceId: string
  assetCode: string
  deviceName: string
  date: string
  reading: number
  prevReading: number
  delta: number
  remark: string | null
  type: 'RESET' | 'HIGH_DELTA'
}
interface ReportData {
  cycle: ReportCycle
  summary: ReportSummary
  devices: ReportDevice[]
  anomalies: ReportAnomaly[]
}

/** Lightweight count-up — eases from 0 → target on mount/value change. */
function useCountUp(target: number, duration = 500) {
  const [display, setDisplay] = React.useState(0)
  const { lang } = useLang()
  const rafRef = React.useRef<number | null>(null)
  const startRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    startRef.current = null
    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts
      const t = Math.min(1, (ts - startRef.current) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(target * eased))
      if (t < 1) rafRef.current = window.requestAnimationFrame(step)
      else setDisplay(target)
    }
    rafRef.current = window.requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
    }
  }, [target, duration])
  return display
}

function statusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case 'active':
      return {
        label: 'กำลังดำเนินการ',
        className:
          'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
      }
    case 'ended':
      return {
        label: 'จบรอบ',
        className:
          'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
      }
    case 'cancelled':
      return {
        label: 'ยกเลิก',
        className:
          'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300',
      }
    default:
      return { label: status, className: '' }
  }
}

function MiniStatCard({
  title,
  value,
  unit,
  icon,
  accent,
  loading,
}: {
  title: string
  value: number
  unit?: string
  icon: React.ReactNode
  accent: string
  loading?: boolean
}) {
  const { lang } = useLang()
  const animated = useCountUp(value, 500)
  return (
    <div
      className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
    >
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: accent }}
      />
      <div className="p-3">
        <div className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-transform group-hover:scale-105"
            style={{ background: `${accent}1a`, color: accent }}
          >
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {title}
            </div>
            {loading ? (
              <Skeleton className="mt-1 h-5 w-12 dark:bg-slate-800" />
            ) : (
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-bold tabular-nums leading-tight text-slate-800 dark:text-slate-100">
                  {(animated ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                </span>
                {unit && (
                  <span className="shrink-0 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                    {unit}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function deltaBadgeClass(delta: number): string {
  if (delta < 0)
    return 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300 transition-colors hover:scale-105'
  if (delta > 20000)
    return 'border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300 transition-colors hover:scale-105'
  if (delta === 0)
    return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 transition-colors hover:scale-105'
  return 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 transition-colors hover:scale-105'
}

interface CycleReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cycleId: string | null
}

export function CycleReportDialog({
  open,
  onOpenChange,
  cycleId,
}: CycleReportDialogProps) {
  const { lang } = useLang()
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [tab, setTab] = React.useState('devices')

  // Reset expansion state whenever the dialog opens for a different cycle
  React.useEffect(() => {
    if (open) {
      setExpanded(new Set())
      setTab('devices')
    }
  }, [open, cycleId])

  const { data, isLoading, isError } = useQuery<ReportData | null>({
    queryKey: ['cycle-report', cycleId],
    queryFn: async () => {
      if (!cycleId) return null
      const res = await fetch(`/api/cycles/${cycleId}/report`, {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) throw new Error('Failed to load report')
      return res.json()
    },
    enabled: open && !!cycleId,
  })

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exportSummaryCsv() {
    if (!data) return
    const rows = data.devices.map((d) => ({
      assetCode: d.assetCode,
      name: d.name,
      brand: d.brand,
      model: d.model,
      site: d.site,
      type: d.type,
      firstReading: d.firstReading ?? '',
      lastReading: d.lastReading ?? '',
      totalDelta: d.totalDelta,
      readingCount: d.readingCount,
    }))
    if (rows.length === 0) {
      toast.error('ไม่มีข้อมูลให้ส่งออก')
      return
    }
    downloadCsv(`cycle-report-${data.cycle.name}-${dateStamp()}.csv`, rows, [
      { key: 'assetCode', label: 'รหัสอุปกรณ์' },
      { key: 'name', label: 'ชื่อ' },
      { key: 'brand', label: 'แบรนด์' },
      { key: 'model', label: 'รุ่น' },
      { key: 'site', label: 'สาขา' },
      { key: 'type', label: 'ประเภท' },
      { key: 'firstReading', label: 'ค่าเริ่มต้น' },
      { key: 'lastReading', label: 'ค่าล่าสุด' },
      { key: 'totalDelta', label: 'รวมส่วนต่าง' },
      { key: 'readingCount', label: 'จำนวนครั้งที่จด' },
    ])
    toast.success(`ส่งออก ${rows.length} เครื่องแล้ว`)
  }

  const cycle = data?.cycle
  const sb = cycle ? statusBadge(cycle.status) : null
  const summary = data?.summary
  const devices = data?.devices ?? []
  const anomalies = data?.anomalies ?? []
  const hasReadings = (summary?.totalReadings ?? 0) > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl dark:border-slate-800 dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-slate-800 dark:text-slate-100">
            <BarChart3 className="h-5 w-5 text-[#f97316]" />
            📊 รายงานรอบจดมิเตอร์
          </DialogTitle>
          <DialogDescription className="space-y-1">
            {cycle ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {cycle.name}
                  </span>
                  {sb && <Badge className={sb.className}>{sb.label}</Badge>}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  📅 {cycle.startDate} → {cycle.endDate}
                  {cycle.status === 'active' && cycle.daysRemaining > 0 && (
                    <span className="ml-2 text-[#f97316]">
                      · เหลือ {cycle.daysRemaining} วัน
                    </span>
                  )}
                </div>
              </>
            ) : (
              'ดูสรุปการจดมิเตอร์ในรอบ พร้อมความผิดปกติและส่งออก CSV'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto itam-scroll pr-1">
          {isError ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
              โหลดรายงานไม่สำเร็จ กรุณาลองอีกครั้ง
            </div>
          ) : isLoading ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 dark:bg-slate-800" />
                ))}
              </div>
              <Skeleton className="h-40 w-full dark:bg-slate-800" />
            </div>
          ) : !data || !hasReadings ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-400 dark:text-slate-500">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                <Inbox className="h-7 w-7 text-slate-300 dark:text-slate-400" />
              </div>
              <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                รอบนี้ยังไม่มีการจดมิเตอร์
              </div>
              <div className="text-xs text-slate-400 dark:text-slate-500">
                {summary && summary.unreadCount > 0
                  ? `ยังไม่ได้จดมิเตอร์ ${summary.unreadCount} เครื่องในรอบนี้`
                  : 'เริ่มจดมิเตอร์เพื่อสร้างข้อมูลรายงาน'}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary mini-stat cards */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MiniStatCard
                  title="จดแล้ว"
                  value={summary!.deviceCount}
                  unit="เครื่อง"
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  accent="#10b981"
                />
                <MiniStatCard
                  title="รวมกระดาษ"
                  value={summary!.totalSheets}
                  unit="แผ่น"
                  icon={<TrendingUp className="h-4 w-4" />}
                  accent="#f97316"
                />
                <MiniStatCard
                  title="เฉลี่ย/เครื่อง"
                  value={summary!.avgDelta}
                  unit="แผ่น"
                  icon={<Gauge className="h-4 w-4" />}
                  accent="#0d9488"
                />
                <MiniStatCard
                  title="ยังไม่จด"
                  value={summary!.unreadCount}
                  unit="เครื่อง"
                  icon={<AlertTriangle className="h-4 w-4" />}
                  accent="#f59e0b"
                />
              </div>

              <Tabs value={tab} onValueChange={setTab}>
                <div className="flex items-center justify-between gap-2">
                  <TabsList>
                    <TabsTrigger value="devices">รายการอุปกรณ์</TabsTrigger>
                    <TabsTrigger value="anomalies">
                      ความผิดปกติ
                      {anomalies.length > 0 && (
                        <Badge className="ml-1.5 border-rose-200 bg-rose-50 px-1 text-[10px] text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
                          {anomalies.length}
                        </Badge>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="summary">สรุปรายเครื่อง</TabsTrigger>
                  </TabsList>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={exportSummaryCsv}
                    className="shrink-0 focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
                  >
                    <Download className="h-3.5 w-3.5" />
                    ส่งออก CSV
                  </Button>
                </div>

                {/* Tab 1: per-device readings (expandable rows) */}
                <TabsContent value="devices" className="mt-3">
                  <div className="itam-scroll max-h-[45vh] overflow-auto rounded-md border border-slate-200 dark:border-slate-800">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                        <TableRow>
                          <TableHead className="w-8" />
                          <TableHead className="text-slate-600 dark:text-slate-300">รหัส</TableHead>
                          <TableHead className="text-slate-600 dark:text-slate-300">ชื่อ</TableHead>
                          <TableHead className="text-slate-600 dark:text-slate-300">สาขา</TableHead>
                          <TableHead className="text-right text-slate-600 dark:text-slate-300">ค่าเริ่ม</TableHead>
                          <TableHead className="text-right text-slate-600 dark:text-slate-300">ค่าล่าสุด</TableHead>
                          <TableHead className="text-right text-slate-600 dark:text-slate-300">รวม</TableHead>
                          <TableHead className="text-right text-slate-600 dark:text-slate-300">ครั้ง</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {devices.map((d) => {
                          const isOpen = expanded.has(d.deviceId)
                          return (
                            <React.Fragment key={d.deviceId}>
                              <TableRow
                                className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                                onClick={() => toggleExpand(d.deviceId)}
                              >
                                <TableCell className="text-slate-400">
                                  {isOpen ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </TableCell>
                                <TableCell className="font-mono text-xs font-medium text-slate-700 dark:text-slate-200">
                                  {d.assetCode}
                                </TableCell>
                                <TableCell className="max-w-[180px] truncate text-slate-700 dark:text-slate-200">
                                  {d.name}
                                </TableCell>
                                <TableCell className="text-slate-700 dark:text-slate-200">
                                  {d.site}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                                  {(d.firstReading ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs tabular-nums text-slate-700 dark:text-slate-200">
                                  {(d.lastReading ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Badge className={deltaBadgeClass(d.totalDelta)}>
                                    +{(d.totalDelta ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                                  {d.readingCount}
                                </TableCell>
                              </TableRow>
                              {isOpen && (
                                <TableRow className="bg-slate-50/50 dark:bg-slate-800/30">
                                  <TableCell />
                                  <TableCell colSpan={7}>
                                    <div className="space-y-1 py-1">
                                      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                                        ประวัติการจด ({d.readings.length})
                                      </div>
                                      {d.readings.map((r) => (
                                        <div
                                          key={r.id}
                                          className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                                        >
                                          <span className="w-24 shrink-0 font-mono text-slate-500 dark:text-slate-400">
                                            {r.date}
                                          </span>
                                          <span className="font-mono text-slate-600 dark:text-slate-300">
                                            {(r.prevReading ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                                          </span>
                                          <span className="text-slate-400">→</span>
                                          <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                                            {(r.reading ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                                          </span>
                                          <Badge className={deltaBadgeClass(r.delta)}>
                                            {r.delta > 0 ? '+' : ''}
                                            {(r.delta ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                                          </Badge>
                                          {r.remark && (
                                            <span className="truncate text-amber-600 dark:text-amber-400">
                                              ⚠ {r.remark}
                                            </span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </React.Fragment>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                {/* Tab 2: anomalies */}
                <TabsContent value="anomalies" className="mt-3">
                  {anomalies.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-10 text-slate-400 dark:text-slate-500">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                        <CheckCircle2 className="h-6 w-6" />
                      </div>
                      <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                        ไม่พบความผิดปกติในรอบนี้
                      </div>
                      <div className="text-xs text-slate-400 dark:text-slate-500">
                        ระบบตรวจพบค่าผิดปกติเมื่อ delta &lt; 0 (RESET) หรือ delta &gt; 20,000 แผ่น
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {anomalies.map((a) => (
                        <div
                          key={a.readingId}
                          className={
                            'flex flex-wrap items-center gap-3 rounded-md border p-3 ' +
                            (a.type === 'RESET'
                              ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
                              : 'border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30')
                          }
                        >
                          <div
                            className={
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full ' +
                              (a.type === 'RESET'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                                : 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300')
                            }
                          >
                            {a.type === 'RESET' ? (
                              <RotateCcw className="h-4 w-4" />
                            ) : (
                              <FileWarning className="h-4 w-4" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="font-semibold text-slate-700 dark:text-slate-200">
                                {a.deviceName}
                              </span>
                              <span className="font-mono text-xs text-slate-400">
                                {a.assetCode}
                              </span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                              <span className="font-mono">{a.date}</span>
                              <span>·</span>
                              <span className="font-mono">
                                {(a.prevReading ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} → {(a.reading ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                              </span>
                              <Badge className={deltaBadgeClass(a.delta)}>
                                {a.delta > 0 ? '+' : ''}
                                {(a.delta ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                              </Badge>
                              <span
                                className={
                                  'font-semibold ' +
                                  (a.type === 'RESET'
                                    ? 'text-amber-700 dark:text-amber-300'
                                    : 'text-rose-700 dark:text-rose-300')
                                }
                              >
                                {a.type === 'RESET' ? 'RESET' : 'เกิน 20,000 แผ่น'}
                              </span>
                            </div>
                            {a.remark && (
                              <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                                ⚠ {a.remark}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Tab 3: compact summary table */}
                <TabsContent value="summary" className="mt-3">
                  <div className="itam-scroll max-h-[45vh] overflow-auto rounded-md border border-slate-200 dark:border-slate-800">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                        <TableRow>
                          <TableHead className="text-slate-600 dark:text-slate-300">รหัส</TableHead>
                          <TableHead className="text-slate-600 dark:text-slate-300">ชื่อ</TableHead>
                          <TableHead className="text-slate-600 dark:text-slate-300">แบรนด์/รุ่น</TableHead>
                          <TableHead className="text-slate-600 dark:text-slate-300">สาขา</TableHead>
                          <TableHead className="text-right text-slate-600 dark:text-slate-300">รวม</TableHead>
                          <TableHead className="text-right text-slate-600 dark:text-slate-300">จด</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {devices.map((d) => (
                          <TableRow
                            key={d.deviceId}
                            className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                          >
                            <TableCell className="font-mono text-xs font-medium text-slate-700 dark:text-slate-200">
                              {d.assetCode}
                            </TableCell>
                            <TableCell className="max-w-[160px] truncate text-slate-700 dark:text-slate-200">
                              {d.name}
                            </TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-300">
                              {d.brand} {d.model}
                            </TableCell>
                            <TableCell className="text-slate-700 dark:text-slate-200">
                              {d.site}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge className={deltaBadgeClass(d.totalDelta)}>
                                +{(d.totalDelta ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                              {d.readingCount}
                            </TableCell>
                          </TableRow>
                        ))}
                        {devices.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="py-8 text-center text-slate-400 dark:text-slate-500">
                              <div className="flex flex-col items-center gap-2">
                                <Package className="h-6 w-6 text-slate-300 dark:text-slate-400" />
                                <span>ไม่มีอุปกรณ์ในรอบนี้</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
