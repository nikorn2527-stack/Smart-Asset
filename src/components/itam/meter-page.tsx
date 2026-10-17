'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Gauge,
  CalendarClock,
  RefreshCw,
  AlertTriangle,
  Download,
  CheckCircle2,
  ClipboardList,
} from 'lucide-react'
import type { Device, Cycle, MeterReading } from './types'
import { statusBadgeClass, statusLabel } from './types'
import { downloadCsv, dateStamp } from '@/lib/csv'
import { BulkMeterDialog } from './bulk-meter-dialog'
import { CycleManageDialog } from './cycle-manage-dialog'
import { useAppStore } from '@/store/app-store'
import { useT, useFormatDateTime, useLang } from '@/store/i18n-store'

const METER_CSV_HEADERS = [
  { key: 'date', label: 'วันที่' },
  { key: 'assetCode', label: 'รหัสอุปกรณ์' },
  { key: 'deviceName', label: 'ชื่ออุปกรณ์' },
  { key: 'brand', label: 'ยี่ห้อ' },
  { key: 'model', label: 'รุ่น' },
  { key: 'prevReading', label: 'ค่ามิเตอร์ก่อนหน้า' },
  { key: 'reading', label: 'ค่ามิเตอร์ล่าสุด' },
  { key: 'delta', label: 'ผลต่าง' },
  { key: 'remark', label: 'หมายเหตุ' },
]

interface ReminderDevice {
  id: string
  assetCode: string
  name: string
  brand: string
  model: string
  site: string
  lastMeterReading: number
  /** Latest BW meter — canonical field from API. Used for prev reading. */
  lastMeterBw?: number
  /** Latest color meter — canonical field from API. */
  lastMeterColor?: number
}
interface ReminderEntry {
  device: ReminderDevice
  lastReadingDate: string | null
  daysOverdue: number
}
interface RemindersData {
  hasActiveCycle: boolean
  cycle: { id: string; name: string; startDate: string; endDate: string; status: string } | null
  reminders: ReminderEntry[]
  totalRead: number
  totalUnread: number
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime()
  return Math.round(ms / (1000 * 60 * 60 * 24))
}

export function MeterPage() {
  const t = useT()
  const { lang } = useLang()
  const qc = useQueryClient()
  const tableRef = React.useRef<HTMLDivElement>(null)
  const [highlightUnread, setHighlightUnread] = React.useState(false)
  const [readingTarget, setReadingTarget] = React.useState<Device | null>(null)
  const [newReading, setNewReading] = React.useState('')
  const [readingDate, setReadingDate] = React.useState(todayISO())
  const [remark, setRemark] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [cycleDialogOpen, setCycleDialogOpen] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)
  const [bulkOpen, setBulkOpen] = React.useState(false)

  // Read pendingMeterAction from store on mount (e.g. 'open-cycle' from dashboard)
  const pendingMeterAction = useAppStore((s) => s.pendingMeterAction)
  const clearPendingMeterAction = useAppStore((s) => s.clearPendingMeterAction)
  React.useEffect(() => {
    if (pendingMeterAction === 'open-cycle') {
      setCycleDialogOpen(true)
      clearPendingMeterAction()
    }
  }, [pendingMeterAction, clearPendingMeterAction])

  const { data: activeCycle } = useQuery<Cycle | null>({
    queryKey: ['active-cycle'],
    queryFn: async () => {
      const res = await fetch('/api/cycles?status=active')
      if (!res.ok) return null
      const json = await res.json()
      return (json.cycles?.[0] as Cycle | undefined) ?? null
    },
  })

  const { data: devices, isLoading } = useQuery<Device[]>({
    queryKey: ['devices-meter'],
    queryFn: async () => {
      const res = await fetch('/api/devices')
      if (!res.ok) throw new Error('Failed to load devices')
      const json = await res.json()
      return (json.devices as Device[]).filter(
        (d) => d.type === 'COPIER' || d.type === 'MFP' || d.type === 'PRINTER',
      )
    },
  })

  const { data: remindersData, isLoading: remindersLoading } = useQuery<RemindersData>({
    queryKey: ['meter-reminders'],
    queryFn: async () => {
      const res = await fetch('/api/meter/reminders')
      if (!res.ok) throw new Error('Failed to load reminders')
      return res.json()
    },
  })

  const meterableDevices = devices ?? []
  // Map unread device IDs for the table badge column
  const unreadDeviceIds = React.useMemo(
    () => new Set((remindersData?.reminders ?? []).map((r) => r.device.id)),
    [remindersData],
  )

  function openReadingDialog(d: Device) {
    setReadingTarget(d)
    // BUG-METER-003 fix: prefer lastMeterBw (canonical API field) over
    // lastMeterReading (legacy alias that's often undefined → 0).
    setNewReading(String(d.lastMeterBw ?? d.lastMeterReading ?? 0))
    setReadingDate(todayISO())
    setRemark('')
  }

  function scrollToTable() {
    setHighlightUnread(true)
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // Clear highlight after a moment
    setTimeout(() => setHighlightUnread(false), 3000)
  }

  // BUG-METER-003 fix: prefer lastMeterBw (canonical API field).
  const prevReading = readingTarget?.lastMeterBw ?? readingTarget?.lastMeterReading ?? 0
  const newReadingNum = Number(newReading)
  const delta = Number.isFinite(newReadingNum) ? newReadingNum - prevReading : 0
  const isReset = newReadingNum < prevReading
  const isExceed = delta > 20000
  const needsRemark = isReset && !remark.trim()

  async function saveReading() {
    if (!readingTarget) return
    if (!Number.isFinite(newReadingNum)) {
      toast.error('PleasePendingFeeMeterasunitNo.')
      return
    }
    // BUG-METER-002 fix: explicit validation that meterBw >= lastMeterBw
    // (or a remark must be provided when it's a RESET — counter swap, drum
    // replacement, etc.). Previously only triggered toast when remark was
    // missing; now we surface a clear message explaining the constraint.
    if (isReset && needsRemark) {
      toast.error(
        `ค่าใหม่ (${newReadingNum.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}) น้อยกว่าค่าก่อนหน้า (${prevReading.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}) — โปรดระบุหมายเหตุ RESET (เช่น เปลี่ยนดรัม/ตัวนับใหม่)`,
      )
      return
    }
    if (isReset && !remark.trim()) {
      toast.error('ค่ามิเตอร์ลดลง — ต้องระบุหมายเหตุ RESET ก่อนบันทึก')
      return
    }
    try {
      setSaving(true)
      const res = await fetch('/api/meter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: readingTarget.id,
          reading: newReadingNum,
          date: readingDate,
          remark: remark.trim() || null,
          cycleId: activeCycle?.id ?? null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Save failed')
      }
      const json = await res.json()
      if (json.warning) {
        toast.warning(json.warning)
      } else {
        toast.success('บันทึกการอ่านค่ามิเตอร์เรียบร้อย')
      }
      setReadingTarget(null)
      await qc.invalidateQueries({ queryKey: ['devices-meter'] })
      await qc.invalidateQueries({ queryKey: ['dashboard'] })
      await qc.invalidateQueries({ queryKey: ['active-cycle'] })
      await qc.invalidateQueries({ queryKey: ['meter-reminders'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const remainingDays = activeCycle
    ? daysBetween(todayISO(), activeCycle.endDate)
    : null

  // Reminder progress
  const totalMeterable = (remindersData?.totalRead ?? 0) + (remindersData?.totalUnread ?? 0)
  const readCount = remindersData?.totalRead ?? 0
  const readPct = totalMeterable > 0 ? Math.round((readCount / totalMeterable) * 100) : 0

  async function exportCsv() {
    try {
      setExporting(true)
      const res = await fetch('/api/meter')
      if (!res.ok) throw new Error('Failed to export')
      const json = await res.json()
      const rows = ((json.readings ?? []) as MeterReading[]).map((r) => ({
        date: r.date,
        assetCode: r.device?.assetCode ?? '',
        deviceName: r.device?.name ?? '',
        brand: r.device?.brand ?? '',
        model: r.device?.model ?? '',
        prevReading: r.prevReading,
        reading: r.reading,
        delta: r.delta,
        remark: r.remark ?? '',
      }))
      downloadCsv(`meter-readings-${dateStamp()}.csv`, rows, METER_CSV_HEADERS)
      toast.success(`Export ${rows.length} item`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">จดมิเตอร์</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            บันทึกค่ามิเตอร์หน่วยพิมพ์ / ถ่ายเอกสาร
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setBulkOpen(true)}
            disabled={meterableDevices.length === 0}
            className="focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
          >
            <ClipboardList className="h-4 w-4" />
            จดมิเตอร์หลายเครื่อง
          </Button>
          <Button
            variant="outline"
            onClick={() => setCycleDialogOpen(true)}
            className="focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
          >
            <CalendarClock className="h-4 w-4" />
            จัดการรอบ
          </Button>
          <Button
            variant="outline"
            onClick={exportCsv}
            disabled={exporting}
            className="focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
          >
            <Download className="h-4 w-4" />
            {exporting ? 'Export...' : 'Export CSV'}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ['devices-meter'] })
              qc.invalidateQueries({ queryKey: ['meter-reminders'] })
            }}
            className="focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Cycle bento cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="relative overflow-hidden bg-gradient-to-br from-white to-slate-50 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg dark:from-slate-900 dark:to-slate-800/50 lg:col-span-2 dark:border-slate-800">
          <span
            aria-hidden
            className="pointer-events-none absolute -right-2 -top-2 text-[100px] leading-none text-slate-100 dark:text-slate-800/40 select-none"
          >
            <CalendarClock className="h-24 w-24" />
          </span>
          <CardHeader className="relative">
            <CardTitle className="flex items-center gap-2 text-base text-slate-800 dark:text-slate-100">
              <CalendarClock className="h-4 w-4 text-[#f97316]" />
              รอบจดมิเตอร์ปัจจุบัน
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            {activeCycle ? (
              <div className="space-y-2">
                <div className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                  {activeCycle.name}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                  <span>📅 {activeCycle.startDate} → {activeCycle.endDate}</span>
                  <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 transition-colors hover:scale-105 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    {activeCycle.status === 'active' ? 'blackhill' : activeCycle.status}
                  </Badge>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-1 text-sm text-slate-400 dark:text-slate-500">
                <span className="font-medium">ยังไม่มีรอบจดมิเตอร์ที่กำลังดำเนินการ</span>
                <span className="text-xs">คลิกปุ่ม &quot;จัดการรอบ&quot; เพื่อสร้างรอบใหม่</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-white to-slate-50 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg dark:from-slate-900 dark:to-slate-800/50 dark:border-slate-800">
          <span
            aria-hidden
            className="pointer-events-none absolute -right-1 -top-1 text-[80px] leading-none text-slate-100 dark:text-slate-800/40 select-none"
          >
            <Gauge className="h-20 w-20" />
          </span>
          <CardContent className="relative flex h-full flex-col items-center justify-center p-6 text-center">
            <Gauge className="mb-2 h-8 w-8 text-[#f97316]" />
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">RemainingTime</div>
            {remainingDays === null ? (
              <div className="text-sm text-slate-400 dark:text-slate-500">—</div>
            ) : (
              <>
                <div className="text-3xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
                  {remainingDays}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">days</div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Progress card — Read X/Y */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-white to-slate-50 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg dark:from-slate-900 dark:to-slate-800/50 dark:border-slate-800">
          <span
            aria-hidden
            className="pointer-events-none absolute -right-1 -top-1 text-[80px] leading-none text-slate-100 dark:text-slate-800/40 select-none"
          >
            <ClipboardList className="h-20 w-20" />
          </span>
          <CardContent className="relative flex h-full flex-col justify-center p-5">
            <div className="mb-2 flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-[#0d9488]" />
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                progressfrontCycle
              </span>
            </div>
            {remindersLoading ? (
              <Skeleton className="h-10 w-full dark:bg-slate-800" />
            ) : !remindersData?.hasActiveCycle ? (
              <p className="text-xs text-slate-400 dark:text-slate-500">
                ยังไม่มีรอบจดมิเตอร์ที่กำลังดำเนินการ
              </p>
            ) : (
              <>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
                    {readCount}
                  </span>
                  <span className="text-sm text-slate-400 dark:text-slate-500">
                    / {totalMeterable}
                  </span>
                </div>
                <Progress
                  value={readPct}
                  className="mt-2 h-2 [&>div]:bg-[#0d9488]"
                />
                <div className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                  Read {readPct}%
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Reminder banner */}
      {remindersData?.hasActiveCycle && (
        <>
          {remindersData.totalUnread > 0 ? (
            <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4 dark:border-amber-900/60 dark:from-amber-950/40 dark:to-orange-950/40 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                    ⚠️ ยังไม่ได้จด {remindersData.totalUnread} จาก {totalMeterable} เครื่องในรอบปัจจุบัน
                  </div>
                  <div className="text-xs text-amber-700 dark:text-amber-300/80">
                    รอบ: {remindersData.cycle?.name} · จดแล้ว {readCount} เครื่อง ({readPct}%)
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                onClick={scrollToTable}
                className="shrink-0 border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200 hover:text-amber-900 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/60"
              >
                Viewitem
              </Button>
            </div>
          ) : totalMeterable > 0 ? (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/40">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                  ✅ จดมิเตอร์ครบทุกเครื่องในรอบปัจจุบันแล้ว
                </div>
                <div className="text-xs text-emerald-700 dark:text-emerald-300/80">
                  ทั้งหมด {totalMeterable} เครื่อง · รอบ {remindersData.cycle?.name}
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* Devices table */}
      <Card className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900" >
        <CardHeader>
          <CardTitle className="text-base text-slate-800 dark:text-slate-100">รายการอุปกรณ์ที่ต้องจดมิเตอร์</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            ref={tableRef}
            className="itam-scroll max-h-[55vh] overflow-auto rounded-md border border-slate-200 dark:border-slate-800"
          >
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                <TableRow>
                  <TableHead className="text-slate-600 dark:text-slate-300">{t('settings.col.code')}</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-300">{t('settings.col.name')}</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-300">{t('devices.col.brand_model')}</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-300">ประเภท</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-300">สถานะ</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-300">สาขา</TableHead>
                  <TableHead className="text-right text-slate-600 dark:text-slate-300">ค่ามิเตอร์ล่าสุด</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-300">สถานะรอบ</TableHead>
                  <TableHead className="text-right text-slate-600 dark:text-slate-300">จดมิเตอร์</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell colSpan={9}>
                        <Skeleton className="h-6 w-full dark:bg-slate-800" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : meterableDevices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-12">
                      <div className="flex flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-500">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                          <Gauge className="h-7 w-7 text-slate-300 dark:text-slate-400" />
                        </div>
                        <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                          ไม่พบอุปกรณ์ที่ต้องจดมิเตอร์
                        </div>
                        <div className="text-xs text-slate-400 dark:text-slate-500">
                          ระบบจะแสดงเฉพาะเครื่องพิมพ์/ถ่ายเอกสาร/MFP ที่ยังไม่ได้จด — เพิ่มอุปกรณ์ที่หน้าจัดการอุปกรณ์
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  meterableDevices.map((d) => {
                    const unread = unreadDeviceIds.has(d.id)
                    return (
                      <TableRow
                        key={d.id}
                        className={
                          'transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50' +
                          (highlightUnread && unread
                            ? ' animate-pulse bg-amber-50 dark:bg-amber-950/30'
                            : '')
                        }
                      >
                        <TableCell className="font-mono text-xs font-medium text-slate-700 dark:text-slate-200">
                          {d.assetCode}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-slate-700 dark:text-slate-200">
                          {d.name}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300">
                          {d.brand} {d.model}
                        </TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-200">{d.type}</TableCell>
                        <TableCell>
                          <Badge className={statusBadgeClass(d.status)}>
                            {statusLabel(d.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-200">{d.site}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                          {(d.lastMeterBw ?? d.lastMeterReading ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                        </TableCell>
                        <TableCell>
                          {remindersData?.hasActiveCycle === false ? (
                            <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                          ) : unread ? (
                            <Badge className="border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              ⏳ StillNoRead
                            </Badge>
                          ) : (
                            <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              ✓ Read
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            onClick={() => openReadingDialog(d)}
                            className="bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
                          >
                            <Gauge className="h-3.5 w-3.5" />
                            จดมิเตอร์
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Reading Dialog */}
      <Dialog
        open={Boolean(readingTarget)}
        onOpenChange={(o) => !o && setReadingTarget(null)}
      >
        <DialogContent className="sm:max-w-md dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="text-slate-800 dark:text-slate-100">📈 จดมิเตอร์</DialogTitle>
            <DialogDescription>
              {readingTarget?.name} ({readingTarget?.assetCode})
            </DialogDescription>
          </DialogHeader>

          {readingTarget && (
            <div className="space-y-3">
              <div className="rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">ค่ามิเตอร์ก่อนหน้า</span>
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                    {prevReading.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  FeeMeterNew *
                </Label>
                <Input
                  type="number"
                  value={newReading}
                  onChange={(e) => setNewReading(e.target.value)}
                  className={
                    isReset ? 'border-amber-400 focus-visible:ring-amber-200' : ''
                  }
                />
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">
                    Variance:{' '}
                    <span
                      className={
                        delta < 0
                          ? 'font-semibold text-amber-600 dark:text-amber-400'
                          : delta > 20000
                            ? 'font-semibold text-rose-600 dark:text-rose-400'
                            : 'font-semibold text-emerald-600 dark:text-emerald-400'
                      }
                    >
                      {delta > 0 ? '+' : ''}
                      {delta.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} sheets
                    </span>
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  วันที่จด *
                </Label>
                <Input
                  type="date"
                  value={readingDate}
                  onChange={(e) => setReadingDate(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Remark {isReset && <span className="text-amber-600 dark:text-amber-400">* (rememberas)</span>}
                </Label>
                <Textarea
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder={
                    isReset
                      ? 'SpecifycauseResultatFeeReducedown e.g. ChangepcsSection / RESET counter'
                      : 'RemarkAddFill (IfHas)'
                  }
                  rows={2}
                />
              </div>

              {isReset && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    ค่าใหม่น้อยกว่าค่าก่อนหน้า ({delta.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}) ต้องระบุหมายเหตุเพื่อยืนยันการ RESET
                  </span>
                </div>
              )}
              {isExceed && !isReset && (
                <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    FeeAddupexceed 20,000 sheets ({delta.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}) SystemwillSaveแ่NotifytoCheck
                  </span>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReadingTarget(null)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={saveReading}
              disabled={saving || needsRemark}
              className="bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
            >
              {saving ? 'Save...' : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cycle manage dialog — single control point for all cycle operations */}
      <CycleManageDialog
        open={cycleDialogOpen}
        onOpenChange={setCycleDialogOpen}
        activeCycle={activeCycle ?? null}
      />

      {/* Bulk meter dialog */}
      <BulkMeterDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        devices={meterableDevices}
        activeCycle={activeCycle ?? null}
      />
    </div>
  )
}

// (no extra exports)
