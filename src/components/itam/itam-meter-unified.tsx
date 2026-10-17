'use client'

/**
 * ItamMeterUnified — frontReadMeterTotal (1 front 2 mode)
 *
 * UserrequesttoTotalReadMeteras 1 front Noseparate — atthusTotal:
 *   1. mode "ReadMeter" (Keyboard) — inputfast Print-Enter-PostponeAuto
 *   2. mode "HistoryMeter" — View/EditReadbackAfter
 *
 * Use Tabs sideonswitch mode — both modesShare query cache goodtogether (invalidate both fresh)
 *
 * sideonHas CycleCountdownBar — ShowCycleReadMeterCurrent + countdownAfterto deadline
 * + progressfront (Read X/Y units) + buttonManageCycle
 */

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PenLine, History, CalendarClock, Plus, AlertTriangle, RotateCcw, Download } from 'lucide-react'
import { ItamMeterKeyboard } from './itam-meter-keyboard'
import { ItamMeter } from './itam-meter'
import { CycleManageDialog } from './cycle-manage-dialog'
import { CustomExportDialog, type ExportColumn, type ExportFormat } from './custom-export-dialog'
import { runCustomExport } from '@/lib/custom-export'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Cycle } from './types'
import { formatMonthThai } from './types'
import { useT, useLang } from '@/store/i18n-store'

// ============================================================
// Custom Export — Meter page (Task ID: FIX-1-2-EXPORT-PRINT)
// ============================================================
const METER_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'assetCode', label: 'รหัสอุปกรณ์', group: 'อุปกรณ์' },
  { key: 'deviceName', label: 'ชื่ออุปกรณ์', group: 'อุปกรณ์' },
  { key: 'site', label: 'สาขา', group: 'อุปกรณ์' },
  { key: 'prevMeter', label: 'มิเตอร์ก่อนหน้า', group: 'มิเตอร์' },
  { key: 'lastMeter', label: 'มิเตอร์ล่าสุด', group: 'มิเตอร์' },
  { key: 'pagesBw', label: 'แผ่นขาวดำ', group: 'มิเตอร์' },
  { key: 'pagesColor', label: 'แผ่นสี', group: 'มิเตอร์' },
  { key: 'readingDate', label: 'วันที่จด', group: 'มิเตอร์' },
  { key: 'remark', label: 'หมายเหตุ', group: 'มิเตอร์' },
]

// ============================================================
// CycleCountdownBar — sticky bar at top of meter page
// ============================================================
interface CycleRemindersData {
  hasActiveCycle: boolean
  cycle: {
    id: string
    name: string
    startDate: string
    endDate: string
    status: string
  } | null
  totalRead: number
  totalUnread: number
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function defaultCycleName(date = new Date()): string {
  const monthLabel = formatMonthThai(date.toISOString().slice(0, 7))
  return `รอบจดมิเตอร์ ${monthLabel}`
}

function useNowTick(intervalMs = 60_000): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

function CycleCountdownBar({
  cycle,
  totalRead,
  totalUnread,
  onManage,
  onCreate,
}: {
  cycle: CycleRemindersData['cycle']
  totalRead: number
  totalUnread: number
  onManage: () => void
  onCreate: () => void
}) {
  const { lang } = useLang()
  // Tick every 60s normally; every 30s on deadline day so the
  // hours/minutes countdown stays fresh (Phase 2).
  const todayStr0 = new Date().toISOString().slice(0, 10)
  const isDeadlinePhase0 = cycle ? todayStr0 === cycle.endDate : false
  const now = useNowTick(isDeadlinePhase0 ? 30_000 : 60_000)
  if (!cycle) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-800 dark:bg-amber-950/30 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              ยังไม่มีรอบจดมิเตอร์ที่กำลังดำเนินการ
            </div>
            <div className="text-xs text-amber-700/80 dark:text-amber-300/80">
              คลิก &quot;สร้างรอบใหม่&quot; เพื่อกำหนดวันเริ่มต้นและวันจดมิเตอร์
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onManage} className="dark:bg-slate-800 dark:border-slate-700">
            <CalendarClock className="h-3.5 w-3.5" />
            จัดการรอบ
          </Button>
          <Button size="sm" onClick={onCreate} className="bg-[#f97316] text-white hover:bg-[#ea580c]">
            <Plus className="h-3.5 w-3.5" />
            สร้างรอบใหม่
          </Button>
        </div>
      </div>
    )
  }

  // ── Three-phase countdown ──
  // Phase 'pending' (before start): "more X days todaysStartReadMeter" — count to startDate
  //   blue: waiting to start
  // Phase 'active' (between start and end): "more X days toSetReadMeter" — count to endDate
  //   green  : > 7 days remaining
  //   orange : 3-7 days remaining
  //   red    : < 3 days remaining
  // Phase 'deadline' (deadline day): "⚠️ toSetReadMeter! Remaining X hr." (red, pulsing)
  // Phase 'overdue' (past end): "justSet X days" (red, pulsing)

  // Use Bangkok timezone (UTC+7) for all date calculations
  const bangkokNow = new Date(now + 7 * 60 * 60 * 1000)
  const todayStr = bangkokNow.toISOString().slice(0, 10)
  const startDate = cycle.startDate
  const endDate = cycle.endDate

  const todayDate = new Date(todayStr + 'T00:00:00')
  const startDateObj = new Date(startDate + 'T00:00:00')
  const endDateObj = new Date(endDate + 'T00:00:00')

  // Days until start (before cycle starts)
  const startDiffMs = startDateObj.getTime() - todayDate.getTime()
  const daysUntilStart = Math.round(startDiffMs / (1000 * 60 * 60 * 24))

  // Days until end (after cycle starts)
  const endDiffMs = endDateObj.getTime() - todayDate.getTime()
  const daysUntilEnd = Math.round(endDiffMs / (1000 * 60 * 60 * 24)) + 1 // include end date

  // Determine phase
  const isPending = daysUntilStart > 0  // today is before startDate
  const isOverdue = daysUntilEnd < 0     // today is after endDate
  const isDeadlineDay = daysUntilEnd === 0 // today is endDate
  const isActive = !isPending && !isOverdue && !isDeadlineDay // between start and end

  const phase: 'pending' | 'active' | 'deadline' | 'overdue' =
    isPending ? 'pending' : isOverdue ? 'overdue' : isDeadlineDay ? 'deadline' : 'active'

  // For hours/minutes on deadline day, use Bangkok time end-of-day
  const deadlineEndOfDay = new Date(endDate + 'T23:59:59+07:00')
  const diffMs = deadlineEndOfDay.getTime() - now
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

  const total = totalRead + totalUnread
  const pct = total > 0 ? Math.round((totalRead / total) * 100) : 0

  // Days overdue
  const overdueDays = isOverdue
    ? Math.floor((now - deadlineEndOfDay.getTime()) / (1000 * 60 * 60 * 24)) + 1
    : 0

  // Color + text mapping per phase
  let colorClass: string
  let textClass: string
  let barClass: string
  let countdownText: string
  let pulsing = false

  if (phase === 'pending') {
    // Before start — waiting
    colorClass = 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40'
    textClass = 'text-sky-700 dark:text-sky-300'
    barClass = 'bg-sky-500'
    countdownText = `อีก ${daysUntilStart} วันจะเริ่มจดมิเตอร์`
  } else if (phase === 'overdue') {
    // Past deadline
    colorClass = 'border-rose-400 bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40'
    textClass = 'text-rose-800 dark:text-rose-300'
    barClass = 'bg-rose-600'
    pulsing = true
    countdownText = `เกินกำหนด ${overdueDays} วัน`
  } else if (phase === 'deadline') {
    // Phase 2 — deadline day (countdown hours)
    colorClass = 'border-rose-400 bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40'
    textClass = 'text-rose-800 dark:text-rose-300'
    barClass = 'bg-rose-600'
    pulsing = true
    countdownText =
      diffMs > 0
        ? `⚠️ ถึงเวลาจดมิเตอร์! เหลือ ${diffHours} ชม. ${diffMinutes} นาที`
        : `⚠️ ถึงเวลาจดมิเตอร์! ปิดรอบแล้ว`
  } else if (daysUntilEnd < 3) {
    // Phase 1 — red zone (< 3 days)
    colorClass = 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40'
    textClass = 'text-rose-700 dark:text-rose-300'
    barClass = 'bg-rose-500'
    countdownText = `อีก ${daysUntilEnd} วัน ${diffHours} ชม. ถึงกำหนดจดมิเตอร์`
  } else if (daysUntilEnd < 7) {
    // Phase 1 — orange zone (3-7 days)
    colorClass = 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40'
    textClass = 'text-amber-700 dark:text-amber-300'
    barClass = 'bg-amber-500'
    countdownText = `อีก ${daysUntilEnd} วัน ${diffHours} ชม. ถึงกำหนดจดมิเตอร์`
  } else {
    // Phase 1 — green zone (> 7 days)
    colorClass = 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40'
    textClass = 'text-emerald-700 dark:text-emerald-300'
    barClass = 'bg-emerald-500'
    countdownText = `อีก ${daysUntilEnd} วันถึงกำหนดจดมิเตอร์`
  }

  return (
    <div className={`rounded-lg border p-3 ${colorClass}${pulsing ? ' itam-deadline-pulse' : ''}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/80 dark:bg-slate-900/70">
            <CalendarClock className={`h-5 w-5 ${textClass}`} />
          </div>
          <div className="min-w-0">
            <div className={`text-sm font-bold ${textClass}`}>
              🔄 {cycle.name}
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-300">
              📅 {cycle.startDate} → {cycle.endDate}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`text-right text-sm font-bold leading-tight ${textClass}`}>
            {countdownText}
          </div>
          <Button size="sm" variant="outline" onClick={onManage} className="dark:bg-slate-800 dark:border-slate-700">
            <CalendarClock className="h-3.5 w-3.5" />
            ManageCycle
          </Button>
        </div>
      </div>
      {/* Progress bar */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-medium text-slate-700 dark:text-slate-200">
            Read <span className="text-[#f97316]">{totalRead.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</span>
            <span className="mx-1 text-slate-400">/</span>
            All {total.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} units
          </span>
          <span className="text-slate-500 dark:text-slate-400">
            (Remaining <span className="font-medium text-slate-700 dark:text-slate-200">{totalUnread.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</span>)
            · {pct}%
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div
            className={`h-full rounded-full transition-all duration-300 ${barClass}`}
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </div>
      </div>
    </div>
  )
}

// ============================================================
// QuickCreateCycleDialog — quick cycle creation without leaving meter page
// ============================================================
function QuickCreateCycleDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: () => void
}) {
  const qc = useQueryClient()
  const [name, setName] = React.useState(defaultCycleName())
  const [startDate, setStartDate] = React.useState(todayISO())
  const [endDate, setEndDate] = React.useState(addDaysISO(todayISO(), 30))
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setName(defaultCycleName())
      setStartDate(todayISO())
      setEndDate(addDaysISO(todayISO(), 30))
    }
  }, [open])

  async function create() {
    if (!name.trim() || !startDate || !endDate) {
      toast.error('กรุณากรอกชื่อรอบและวันที่ให้ครบ')
      return
    }
    if (new Date(endDate) < new Date(startDate)) {
      toast.error('วันกำหนดจดต้องไม่ก่อนวันเริ่ม')
      return
    }
    try {
      setSaving(true)
      const res = await fetch('/api/cycles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          startDate,
          endDate,
          status: 'active',
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'สร้างรอบไม่สำเร็จ')
      }
      toast.success('สร้างรอบจดมิเตอร์ใหม่เรียบร้อย')
      onOpenChange(false)
      await qc.invalidateQueries({ queryKey: ['active-cycle'] })
      await qc.invalidateQueries({ queryKey: ['meter-reminders'] })
      await qc.invalidateQueries({ queryKey: ['itam-meter-keyboard'] })
      onCreated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'สร้างรอบไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle>สร้างรอบจดมิเตอร์ใหม่</DialogTitle>
          <DialogDescription>
            กำหนดชื่อรอบ + วันเริ่มต้น + วันกำหนดจดมิเตอร์ (deadline)
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">ชื่อรอบ *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น รอบจดมิเตอร์ สิงหาคม 2568"
              className="dark:bg-slate-800 dark:border-slate-700"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">วันเริ่มต้น *</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">วันกำหนดจด (Deadline) *</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            ⏰ Distancefirst: Show <span className="font-medium">&quot;more X days toSetReadMeter&quot;</span> (counttotodaysSet)<br />
            ⚠️ Distance 2: enoughtodaysSet → Show <span className="font-medium">&quot;toSetReadMeter!&quot;</span> with countdownAfterashr — ColorredIfRemaining &lt; 3 days, ColororangeIfRemaining &lt; 7 days
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={create} disabled={saving} className="bg-[#f97316] text-white hover:bg-[#ea580c]">
            {saving ? 'Create...' : 'สร้างรอบ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// Main unified component
// ============================================================
export function ItamMeterUnified() {
  const t = useT()
  const { lang } = useLang()
  const qc = useQueryClient()
  const [mode, setMode] = React.useState<'entry' | 'history'>('entry')
  const [cycleDialogOpen, setCycleDialogOpen] = React.useState(false)
  const [quickCreateOpen, setQuickCreateOpen] = React.useState(false)
  // Custom export dialog state (Task ID: FIX-1-2-EXPORT-PRINT)
  const [customExportOpen, setCustomExportOpen] = React.useState(false)
  const [exportTotalRows, setExportTotalRows] = React.useState(0)

  // Fetch active cycle (lightweight — used by both countdown bar + manage dialog)
  const { data: activeCycle } = useQuery<Cycle | null>({
    queryKey: ['active-cycle'],
    queryFn: async () => {
      const res = await fetch('/api/cycles?status=active')
      if (!res.ok) return null
      const json = await res.json()
      return (json.cycles?.[0] as Cycle | undefined) ?? null
    },
    staleTime: 30_000,
  })

  // Fetch cycle progress (read/unread counts) — same endpoint as MeterPage
  const { data: remindersData, refetch: refetchReminders } = useQuery<CycleRemindersData>({
    queryKey: ['meter-reminders'],
    queryFn: async () => {
      const res = await fetch('/api/meter/reminders')
      if (!res.ok) throw new Error('Failed to load reminders')
      return res.json()
    },
    staleTime: 30_000,
  })

  const cycle = activeCycle
    ? {
        id: activeCycle.id,
        name: activeCycle.name,
        startDate: activeCycle.startDate,
        endDate: activeCycle.endDate,
        status: activeCycle.status,
      }
    : remindersData?.cycle ?? null
  const totalRead = remindersData?.totalRead ?? 0
  const totalUnread = remindersData?.totalUnread ?? 0

  // When a new cycle is created, refresh everything
  const handleCreated = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['active-cycle'] })
    void qc.invalidateQueries({ queryKey: ['meter-reminders'] })
    void refetchReminders()
  }, [qc, refetchReminders])

  // ── Custom Export handler ──
  // Fetches ALL meter readings (paginated) and builds rows keyed by the
  // column `key` so runCustomExport can map them.
  const handleCustomExport = React.useCallback(
    async (columns: ExportColumn[], format: ExportFormat) => {
      // Read all readings — fetch up to 10k rows in pages of 500.
      const all: Array<{
        assetCode: string
        readingDate: string | null
        meterBw: number
        meterColor: number
        pagesBw: number
        pagesColor: number
        prevMeterBw: number
        remark: string | null
        device?: { assetCode: string; brand: string | null; model: string | null; site: string | null } | null
      }> = []
      let page = 1
      const pageSize = 500
      let totalPages = 1
      while (page <= totalPages) {
        const res = await fetch(`/api/itam/meter-readings?page=${page}&limit=${pageSize}`)
        if (!res.ok) throw new Error('โหลดข้อมูลมิเตอร์ไม่สำเร็จ')
        const json: {
          readings: typeof all
          pagination: { totalPages: number; total: number }
        } = await res.json()
        all.push(...json.readings)
        totalPages = json.pagination.totalPages
        if (json.readings.length < pageSize) break
        page += 1
      }
      setExportTotalRows(all.length)
      if (all.length === 0) {
        toast.warning('ไม่มีข้อมูลมิเตอร์ให้ส่งออก')
        return
      }
      const rows: Record<string, unknown>[] = all.map((r) => ({
        assetCode: r.assetCode ?? '',
        deviceName: r.device ? `${r.device.brand ?? ''} ${r.device.model ?? ''}`.trim() : '',
        site: r.device?.site ?? '',
        prevMeter: r.prevMeterBw ?? 0,
        lastMeter: r.meterBw ?? 0,
        pagesBw: r.pagesBw ?? 0,
        pagesColor: r.pagesColor ?? 0,
        readingDate: r.readingDate ?? '',
        remark: r.remark ?? '',
      }))
      runCustomExport(columns, format, rows, 'meter-readings', 'รายงานจดมิเตอร์')
      toast.success(`ส่งออก ${rows.length} รายการ`)
    },
    [],
  )

  return (
    <div className="flex h-full flex-col p-3 md:p-4">
      {/* Countdown bar — FIXED, never scrolls away */}
      <div className="mb-2 flex-shrink-0">
        <CycleCountdownBar
          cycle={cycle}
          totalRead={totalRead}
          totalUnread={totalUnread}
          onManage={() => setCycleDialogOpen(true)}
          onCreate={() => setQuickCreateOpen(true)}
        />
      </div>

      {/* Action bar — Export (Task ID: FIX-1-2-EXPORT-PRINT) */}
      <div className="mb-2 flex flex-shrink-0 items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCustomExportOpen(true)}
          className="dark:bg-slate-800 dark:border-slate-700"
        >
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
      </div>

      <Tabs value={mode} onValueChange={(v) => setMode(v as 'entry' | 'history')} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="grid w-full max-w-md grid-cols-2 flex-shrink-0">
          <TabsTrigger value="entry" className="gap-1.5">
            <PenLine className="h-4 w-4" />
            จดมิเตอร์
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-4 w-4" />
            ประวัติมิเตอร์
          </TabsTrigger>
        </TabsList>
        <TabsContent value="entry" className="mt-2 min-h-0 flex-1 overflow-hidden">
          <ItamMeterKeyboard />
        </TabsContent>
        <TabsContent value="history" className="mt-2 min-h-0 flex-1 overflow-hidden">
          <ItamMeter />
        </TabsContent>
      </Tabs>

      {/* Cycle management dialogs */}
      <CycleManageDialog
        open={cycleDialogOpen}
        onOpenChange={setCycleDialogOpen}
        activeCycle={activeCycle ?? null}
      />
      <QuickCreateCycleDialog
        open={quickCreateOpen}
        onOpenChange={setQuickCreateOpen}
        onCreated={handleCreated}
      />

      {/* Custom Export Dialog (Task ID: FIX-1-2-EXPORT-PRINT) */}
      <CustomExportDialog
        open={customExportOpen}
        onOpenChange={setCustomExportOpen}
        availableColumns={METER_EXPORT_COLUMNS}
        onExport={handleCustomExport}
        storageKey="itam-meter-export-cols"
        totalRows={exportTotalRows}
      />
    </div>
  )
}
