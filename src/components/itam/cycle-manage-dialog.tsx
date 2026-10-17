'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import {
  CalendarClock,
  Plus,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Trash2,
  History,
  ChevronDown,
  ChevronRight,
  Gauge,
  BarChart3,
  Sparkles,
  ArrowRight,
} from 'lucide-react'
import type { Cycle } from './types'
import { CycleReportDialog } from './cycle-report-dialog'
import { useLang } from '@/store/i18n-store'
import { useAuthStore } from '@/store/auth-store'
import { bearerHeaders } from '@/lib/http-headers'

const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
]

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function buildTemplateName(date = new Date()): string {
  return `รอบจดมิเตอร์ ${THAI_MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24))
}

interface CycleWithStats extends Cycle {
  readingCount?: number
  totalSheets?: number
}

function statusBadge(status: string): { className: string; label: string; icon: React.ReactNode } {
  switch (status) {
    case 'active':
      return {
        className: 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
        label: 'กำลังดำเนินการ',
        icon: <Gauge className="h-3 w-3" />,
      }
    case 'ended':
      return {
        className: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
        label: 'จบรอบ',
        icon: <CheckCircle2 className="h-3 w-3" />,
      }
    case 'cancelled':
      return {
        className: 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300',
        label: 'ยกเลิก',
        icon: <XCircle className="h-3 w-3" />,
      }
    default:
      return {
        className: 'border-slate-200 bg-slate-50 text-slate-600',
        label: status,
        icon: null,
      }
  }
}

interface CycleManageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeCycle: Cycle | null
}

export function CycleManageDialog({ open, onOpenChange, activeCycle }: CycleManageDialogProps) {
  const { lang } = useLang()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = React.useState(false)
  const [cycleName, setCycleName] = React.useState('')
  const [cycleStart, setCycleStart] = React.useState(todayISO())
  const [cycleEnd, setCycleEnd] = React.useState(todayISO())
  const [cycleSite, setCycleSite] = React.useState<string>('ALL')
  const [creating, setCreating] = React.useState(false)
  const [actionTarget, setActionTarget] = React.useState<{ cycle: Cycle; action: 'end' | 'cancel' | 'reopen' | 'delete' } | null>(null)
  const [acting, setActing] = React.useState(false)
  const [reportCycleId, setReportCycleId] = React.useState<string | null>(null)
  // Auto-create next cycle suggestion state
  const [suggestNext, setSuggestNext] = React.useState<{ endedCycleName: string; nextName: string; nextStart: string; nextEnd: string; durationDays: number; site: string } | null>(null)
  const [creatingNext, setCreatingNext] = React.useState(false)

  // Fetch app settings (for cycleTemplate.autoCreate + durationDays)
  const { data: settingsMap } = useQuery<Record<string, string>>({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings', {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) return {}
      const json = await res.json()
      return (json.settings as Record<string, string>) ?? {}
    },
    staleTime: 30_000,
  })
  const cycleTemplateAutoCreate = settingsMap?.['cycleTemplate.autoCreate'] === 'true'
  const cycleTemplateDurationDays = Math.min(
    90,
    Math.max(7, Number(settingsMap?.['cycleTemplate.durationDays'] ?? '30') || 30),
  )

  // Fetch ALL cycles (with stats) for the history list
  const { data: allCycles, isLoading } = useQuery<CycleWithStats[]>({
    queryKey: ['all-cycles'],
    queryFn: async () => {
      const res = await fetch('/api/cycles', {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) throw new Error('Failed to load cycles')
      const json = await res.json()
      return (json.cycles as Cycle[]) ?? []
    },
    enabled: open,
  })

  // Fetch reading counts per cycle for past cycles
  const { data: cycleStats } = useQuery<Record<string, { count: number; sheets: number }>>({
    queryKey: ['cycle-stats'],
    queryFn: async () => {
      const cycles = allCycles ?? []
      const stats: Record<string, { count: number; sheets: number }> = {}
      await Promise.all(
        cycles.map(async (c) => {
          try {
            const res = await fetch(`/api/cycles/${c.id}`, {
              headers: bearerHeaders(useAuthStore.getState()?.token),
            })
            if (res.ok) {
              const j = await res.json()
              stats[c.id] = { count: j.readingCount ?? 0, sheets: j.totalSheets ?? 0 }
            }
          } catch {
            // ignore
          }
        }),
      )
      return stats
    },
    enabled: open && !!allCycles && allCycles.length > 0,
  })

  React.useEffect(() => {
    if (open) {
      setShowCreate(false)
      setCycleName('')
      setCycleStart(todayISO())
      setCycleEnd(todayISO())
      setCycleSite('ALL')
    }
  }, [open])

  // Fetch sites from SiteAttribute (4 rows: UDH, NKP, MECUD, PPIT)
  const { data: sites } = useQuery<{ code: string; name: string }[]>({
    queryKey: ['sites'],
    queryFn: async () => {
      const res = await fetch('/api/sites', {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) return []
      const json = await res.json()
      return (json.sites ?? []) as { code: string; name: string }[]
    },
    enabled: open,
  })

  async function createCycle() {
    if (!cycleName || !cycleStart || !cycleEnd) {
      toast.error('กรุณากรอกชื่อรอบและวันที่ให้ครบ')
      return
    }
    if (new Date(cycleEnd) < new Date(cycleStart)) {
      toast.error('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม')
      return
    }
    try {
      setCreating(true)
      const res = await fetch('/api/cycles', {
        method: 'POST',
        headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name: cycleName,
          startDate: cycleStart,
          endDate: cycleEnd,
          status: 'active',
          site: cycleSite === 'ALL' ? null : cycleSite,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'สร้างรอบไม่สำเร็จ')
      }
      toast.success('สร้างรอบจดมิเตอร์ใหม่แล้ว')
      setShowCreate(false)
      setCycleName('')
      setCycleSite('ALL')
      await qc.invalidateQueries({ queryKey: ['active-cycle'] })
      await qc.invalidateQueries({ queryKey: ['all-cycles'] })
      await qc.invalidateQueries({ queryKey: ['meter-reminders'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'สร้างรอบไม่สำเร็จ')
    } finally {
      setCreating(false)
    }
  }

  async function performAction() {
    if (!actionTarget) return
    const { cycle, action } = actionTarget
    let endedCycleName: string | null = null
    try {
      setActing(true)
      if (action === 'delete') {
        const res = await fetch(`/api/cycles/${cycle.id}`, { method: 'DELETE', headers: bearerHeaders(useAuthStore.getState()?.token) })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error ?? 'ลบไม่สำเร็จ')
        }
        toast.success(`ลบรอบ "${cycle.name}" แล้ว`)
      } else {
        const statusMap = { end: 'ended', cancel: 'cancelled', reopen: 'active' }
        const res = await fetch(`/api/cycles/${cycle.id}`, {
          method: 'PUT',
          headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ status: statusMap[action] }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error ?? 'ดำเนินการไม่สำเร็จ')
        }
        const msgMap = { end: 'จบรอบ', cancel: 'ยกเลิกรอบ', reopen: 'เปิดใช้งานรอบ' }
        toast.success(`${msgMap[action]} "${cycle.name}" แล้ว`)
        if (action === 'end') endedCycleName = cycle.name
      }
      setActionTarget(null)
      await qc.invalidateQueries({ queryKey: ['active-cycle'] })
      await qc.invalidateQueries({ queryKey: ['all-cycles'] })
      await qc.invalidateQueries({ queryKey: ['meter-reminders'] })
      await qc.invalidateQueries({ queryKey: ['cycle-stats'] })
      await qc.invalidateQueries({ queryKey: ['notifications'] })

      // If we just ended a cycle and auto-create is enabled, suggest the next cycle.
      if (endedCycleName && cycleTemplateAutoCreate) {
        const today = todayISO()
        const nextName = buildTemplateName()
        const nextEnd = addDaysISO(today, cycleTemplateDurationDays)
        setSuggestNext({
          endedCycleName,
          nextName,
          nextStart: today,
          nextEnd,
          durationDays: cycleTemplateDurationDays,
          site: cycle.site ?? 'ALL',
        })
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ดำเนินการไม่สำเร็จ')
    } finally {
      setActing(false)
    }
  }

  async function createNextCycleFromTemplate() {
    if (!suggestNext) return
    try {
      setCreatingNext(true)
      const res = await fetch('/api/cycles', {
        method: 'POST',
        headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name: suggestNext.nextName,
          startDate: suggestNext.nextStart,
          endDate: suggestNext.nextEnd,
          status: 'active',
          site: suggestNext.site === 'ALL' ? null : suggestNext.site,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'สร้างรอบไม่สำเร็จ')
      }
      toast.success(`สร้างรอบใหม่ "${suggestNext.nextName}" แล้ว`)
      setSuggestNext(null)
      await qc.invalidateQueries({ queryKey: ['active-cycle'] })
      await qc.invalidateQueries({ queryKey: ['all-cycles'] })
      await qc.invalidateQueries({ queryKey: ['meter-reminders'] })
      await qc.invalidateQueries({ queryKey: ['notifications'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'สร้างรอบไม่สำเร็จ')
    } finally {
      setCreatingNext(false)
    }
  }

  const sortedCycles = React.useMemo(() => {
    const list = allCycles ?? []
    // Active first, then by startDate desc
    return [...list].sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1
      if (a.status !== 'active' && b.status === 'active') return 1
      return new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    })
  }, [allCycles])

  const actionText: Record<string, { title: string; desc: string; btn: string; danger: boolean }> = {
    end: {
      title: 'จบรอบจดมิเตอร์',
      desc: 'รอบนี้จะถูกทำเครื่องหมายว่าจบแล้ว การจดมิเตอร์ครั้งถัดไปจะต้องสร้างรอบใหม่',
      btn: 'จบรอบ',
      danger: false,
    },
    cancel: {
      title: 'ยกเลิกรอบจดมิเตอร์',
      desc: 'รอบนี้จะถูกยกเลิก ข้อมูลการจดมิเตอร์ที่บันทึกแล้วจะยังคงอยู่',
      btn: 'ยกเลิกรอบ',
      danger: true,
    },
    reopen: {
      title: 'เปิดใช้งานรอบอีกครั้ง',
      desc: 'รอบนี้จะกลับสู่สถานะกำลังดำเนินการ (รอบอื่นที่ active จะถูกจบอัตโนมัติ)',
      btn: 'เปิดใช้งาน',
      danger: false,
    },
    delete: {
      title: 'ลบรอบจดมิเตอร์',
      desc: 'ลบรอบนี้ออกจากระบบ (ลบได้เฉพาะรอบที่ไม่ active และไม่มีการจดมิเตอร์)',
      btn: 'ลบรอบ',
      danger: true,
    },
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <CalendarClock className="h-5 w-5 text-[#f97316]" />
              จัดการรอบจดมิเตอร์
            </DialogTitle>
            <DialogDescription>
              ควบคุมรอบจดมิเตอร์ทั้งหมดจากจุดเดียว — สร้าง จบ ยกเลิก และดูประวัติ
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[65vh] space-y-4 overflow-y-auto itam-scroll pr-1">
            {/* Active cycle highlight */}
            {activeCycle && (
              <div className="rounded-lg border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 dark:border-emerald-800 dark:from-emerald-950/40 dark:to-slate-900">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    รอบปัจจุบัน
                  </span>
                  <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    กำลังดำเนินการ
                  </Badge>
                </div>
                <div className="text-base font-bold text-slate-800 dark:text-slate-100">
                  {activeCycle.name}
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <span>📅 {activeCycle.startDate} → {activeCycle.endDate}</span>
                  {activeCycle.site ? (
                    <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      🏢 {activeCycle.site}
                    </Badge>
                  ) : (
                    <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      🌐 ทุกสาขา
                    </Badge>
                  )}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  เหลือเวลา {daysBetween(todayISO(), activeCycle.endDate)} วัน
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setActionTarget({ cycle: activeCycle, action: 'end' })}
                    className="h-8 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950"
                  >
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                    จบรอบ
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setActionTarget({ cycle: activeCycle, action: 'cancel' })}
                    className="h-8 border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950"
                  >
                    <XCircle className="mr-1 h-3.5 w-3.5" />
                    ยกเลิก
                  </Button>
                </div>
              </div>
            )}

            {/* Create new cycle (collapsible) */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowCreate(!showCreate)}
                className="flex w-full items-center justify-between p-3 text-left"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <Plus className="h-4 w-4 text-[#f97316]" />
                  สร้างรอบใหม่
                </span>
                {showCreate ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
              </button>
              {showCreate && (
                <div className="space-y-3 border-t border-slate-200 p-3 dark:border-slate-800">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">ชื่อรอบ *</Label>
                    <Input
                      value={cycleName}
                      onChange={(e) => setCycleName(e.target.value)}
                      placeholder="เช่น รอบจดมิเตอร์ ก.ย. 2026"
                      className="dark:bg-slate-800 dark:border-slate-700"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">สาขา *</Label>
                    <Select value={cycleSite} onValueChange={setCycleSite}>
                      <SelectTrigger className="dark:bg-slate-800 dark:border-slate-700">
                        <SelectValue placeholder="เลือกสาขา" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">🌐 ทุกสาขา (Global)</SelectItem>
                        {(sites ?? []).map((s) => (
                          <SelectItem key={s.code} value={s.code}>
                            {s.code} — {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      แต่ละสาขาสามารถมีรอบจดมิเตอร์ของตัวเองพร้อมกันได้ — เลือก "ทุกสาขา" สำหรับรอบรวม
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">วันเริ่ม *</Label>
                      <Input type="date" value={cycleStart} onChange={(e) => setCycleStart(e.target.value)} className="dark:bg-slate-800 dark:border-slate-700" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">วันสิ้นสุด *</Label>
                      <Input type="date" value={cycleEnd} onChange={(e) => setCycleEnd(e.target.value)} className="dark:bg-slate-800 dark:border-slate-700" />
                    </div>
                  </div>
                  {activeCycle && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      ⚠️ รอบปัจจุบัน "{activeCycle.name}" {activeCycle.site ? `@ ${activeCycle.site}` : '(ทุกสาขา)'} จะถูกจบอัตโนมัติเมื่อสร้างรอบใหม่{cycleSite === 'ALL' ? 'ทุกสาขา' : ` @ ${cycleSite}`}
                    </p>
                  )}
                  <Button
                    onClick={createCycle}
                    disabled={creating}
                    className="w-full bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316]"
                  >
                    {creating ? 'กำลังสร้าง...' : 'สร้างรอบ'}
                  </Button>
                </div>
              )}
            </div>

            {/* Cycle history */}
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <History className="h-4 w-4 text-slate-400" />
                ประวัติรอบจดมิเตอร์ ({sortedCycles.length})
              </div>
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-16 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
                  ))}
                </div>
              ) : sortedCycles.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
                  ยังไม่มีรอบจดมิเตอร์
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedCycles.map((c) => {
                    const sb = statusBadge(c.status)
                    const stats = cycleStats?.[c.id]
                    const isActive = c.status === 'active'
                    return (
                      <div
                        key={c.id}
                        className="rounded-md border border-slate-200 bg-white p-3 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/50"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                                {c.name}
                              </span>
                              <Badge className={`shrink-0 ${sb.className}`}>
                                {sb.icon}
                                <span className="ml-1">{sb.label}</span>
                              </Badge>
                              {c.site ? (
                                <Badge className="shrink-0 border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                  🏢 {c.site}
                                </Badge>
                              ) : (
                                <Badge className="shrink-0 border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500">
                                  🌐 ทุกสาขา
                                </Badge>
                              )}
                            </div>
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              📅 {c.startDate} → {c.endDate}
                              <span className="ml-2 text-slate-400 dark:text-slate-500">
                                ({daysBetween(c.startDate, c.endDate) + 1} วัน)
                              </span>
                            </div>
                            {stats && stats.count > 0 && (
                              <div className="mt-0.5 text-xs text-slate-400">
                                จดมิเตอร์ {stats.count} ครั้ง · {stats.sheets.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setReportCycleId(c.id)}
                              className="h-7 px-2 text-xs text-[#f97316] hover:bg-[#f97316]/10 dark:text-[#fb923c] dark:hover:bg-[#f97316]/20"
                              title="ดูรายงานรอบ"
                            >
                              <BarChart3 className="h-3 w-3" />
                            </Button>
                            {!isActive && c.status !== 'active' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setActionTarget({ cycle: c, action: 'reopen' })}
                                className="h-7 px-2 text-xs text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
                                title="เปิดใช้งานอีกครั้ง"
                              >
                                <RotateCcw className="h-3 w-3" />
                              </Button>
                            )}
                            {isActive && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setActionTarget({ cycle: c, action: 'end' })}
                                  className="h-7 px-2 text-xs text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                                  title="จบรอบ"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setActionTarget({ cycle: c, action: 'cancel' })}
                                  className="h-7 px-2 text-xs text-rose-500 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950"
                                  title="ยกเลิก"
                                >
                                  <XCircle className="h-3 w-3" />
                                </Button>
                              </>
                            )}
                            {!isActive && (!stats || stats.count === 0) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setActionTarget({ cycle: c, action: 'delete' })}
                                className="h-7 px-2 text-xs text-rose-500 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950"
                                title="ลบรอบ"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm action dialog */}
      <AlertDialog open={!!actionTarget} onOpenChange={(o) => !o && setActionTarget(null)}>
        <AlertDialogContent className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-800 dark:text-slate-100">
              {actionTarget ? actionText[actionTarget.action].title : ''}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500 dark:text-slate-400">
              {actionTarget ? (
                <>
                  {actionText[actionTarget.action].desc}
                  <br />
                  <span className="mt-1 inline-block font-medium text-slate-700 dark:text-slate-200">
                    รอบ: {actionTarget.cycle.name}
                  </span>
                </>
              ) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                void performAction()
              }}
              disabled={acting}
              className={
                actionTarget?.action === 'cancel' || actionTarget?.action === 'delete'
                  ? 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-2 focus-visible:ring-rose-500'
                  : 'bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316]'
              }
            >
              {acting ? 'กำลังดำเนินการ...' : actionTarget ? actionText[actionTarget.action].btn : 'ตกลง'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cycle report dialog */}
      <CycleReportDialog
        open={!!reportCycleId}
        onOpenChange={(o) => !o && setReportCycleId(null)}
        cycleId={reportCycleId}
      />

      {/* Auto-create next cycle suggestion dialog */}
      <Dialog open={!!suggestNext} onOpenChange={(o) => !o && setSuggestNext(null)}>
        <DialogContent className="sm:max-w-md dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <Sparkles className="h-5 w-5 text-[#f97316]" />
              สร้างรอบใหม่อัตโนมัติ
            </DialogTitle>
            <DialogDescription className="text-slate-500 dark:text-slate-400">
              ระบบพร้อมสร้างรอบจดมิเตอร์ใหม่ให้คุณตามเทมเพลตที่ตั้งไว้
            </DialogDescription>
          </DialogHeader>

          {/* Ended cycle success banner */}
          <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-3 dark:border-emerald-800 dark:from-emerald-950/40 dark:to-slate-900">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                จบรอบเรียบร้อย
              </div>
              <div className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                {suggestNext?.endedCycleName}
              </div>
            </div>
          </div>

          {/* Next cycle preview */}
          <div className="rounded-lg border border-[#f97316]/30 bg-gradient-to-br from-orange-50 to-white p-4 dark:border-[#f97316]/40 dark:from-slate-900 dark:to-slate-800/60">
            <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#f97316] dark:text-[#fb923c]">
              <CalendarClock className="h-3.5 w-3.5" />
              รอบใหม่ที่จะสร้าง
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500 dark:text-slate-400">ชื่อรอบ</span>
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {suggestNext?.nextName}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500 dark:text-slate-400">วันเริ่ม</span>
                <span className="font-mono font-medium text-slate-800 dark:text-slate-100">
                  {suggestNext?.nextStart}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500 dark:text-slate-400">วันสิ้นสุด</span>
                <span className="font-mono font-medium text-slate-800 dark:text-slate-100">
                  {suggestNext?.nextEnd}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-[#f97316]/20 pt-2 dark:border-[#f97316]/30">
                <span className="text-slate-500 dark:text-slate-400">ระยะเวลารอบ</span>
                <Badge className="border-[#f97316]/30 bg-[#f97316]/10 text-[#f97316] dark:border-[#fb923c]/30 dark:bg-[#fb923c]/10 dark:text-[#fb923c]">
                  {suggestNext?.durationDays} วัน
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setSuggestNext(null)}
              disabled={creatingNext}
              className="flex-1 focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              ภายหลัง
            </Button>
            <Button
              onClick={createNextCycleFromTemplate}
              disabled={creatingNext}
              className="flex-1 bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
            >
              {creatingNext ? (
                'กำลังสร้าง...'
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  สร้างรอบใหม่
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
