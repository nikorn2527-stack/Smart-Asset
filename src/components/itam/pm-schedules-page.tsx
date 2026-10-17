'use client'

/**
 * PMSchedulesPage — ตารางงานบำรุงรักษาเชิงป้องกัน (Preventive Maintenance)
 *
 * Phase 3: List + Create/Edit form
 *
 * Features:
 *   - List all PM schedules (active + inactive)
 *   - Filter by active / site / deviceType / search
 *   - Create new schedule (dialog)
 *   - Edit existing schedule
 *   - Soft-delete (set active=false)
 *   - Show nextRunDate + lastRunDate + execution count
 *
 * Future phases:
 *   - Calendar view (Phase 4)
 *   - Execution form with checklist (Phase 5)
 *   - Auto-create WO (Phase 6)
 */

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  CalendarClock, Plus, RefreshCw, Search, Pencil, Trash2, Power,
  Calendar, CheckCircle2, Clock, AlertCircle, Wrench, ChevronLeft, ChevronRight,
  Camera, X, Save,
} from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useAuthStore } from '@/store/auth-store'
import { useT, useLang, useI18nStore } from '@/store/i18n-store'
import { canSelectSite } from './types'
import {
  FREQUENCY_OPTIONS, FREQUENCY_LABELS, WEEKDAY_OPTIONS, WEEKDAY_LABELS, bangkokDate, upcomingPMDates,
} from '@/lib/pm-schedule'

// ── Types ────────────────────────────────────────────────────────────

interface PMSchedule {
  id: string
  scheduleNo: string | null
  title: string
  description: string | null
  frequency: string
  intervalDays: number | null
  dayOfMonth: number | null
  weekday: string | null
  startMonth: number | null
  deviceType: string | null
  site: string | null
  deviceId: string | null
  checklist: string | null
  active: boolean
  startDate: string | null
  lastRunDate: string | null
  nextRunDate: string | null
  autoCreateWO: boolean
  assignedTo: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  device?: {
    id: string
    assetCode: string
    name: string
    type: string
    site: string
  } | null
  _count?: { executions: number }
}

interface Site {
  id: string
  code: string
  name: string
}

interface ChecklistItem {
  id: string
  label: string
  required: boolean
}

// ── PM Execution row (Phase 5 history) ──
interface PMExecutionRow {
  id: string
  scheduleId: string
  workOrderId: string | null
  scheduledDate: string
  executedDate: string | null
  status: string
  checklistResult: string | null
  remark: string | null
  performedBy: string | null
  images: string | null
  createdAt: string
  schedule?: {
    id: string
    scheduleNo: string | null
    title: string
    frequency: string
    deviceType: string | null
    site: string | null
    assignedTo: string | null
    checklist: string | null
    device?: { id: string; assetCode: string; name: string; type: string; site: string } | null
  } | null
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Format a date string with locale-aware formatting.
 *  Uses the global i18n store to determine TH (พ.ศ.) or EN (ค.ศ.). */
function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso)
    if (isNaN(d.getTime())) return iso
    // Read lang from the global store (works at module level without hooks)
    const lang = useI18nStore.getState().lang
    const locale = lang === 'th' ? 'th-TH' : 'en-GB'
    const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }
    if (lang === 'th') opts.calendar = 'buddhist'
    return d.toLocaleDateString(locale, opts)
  } catch {
    return iso
  }
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  try {
    const target = new Date(`${iso}T00:00:00`)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const diff = target.getTime() - today.getTime()
    return Math.round(diff / (1000 * 60 * 60 * 24))
  } catch {
    return null
  }
}

function todayISO(): string {
  return bangkokDate()
}

const DEVICE_TYPES = ['PRINTER', 'COPIER', 'MFP', 'SCANNER', 'COMPUTER', 'NETWORK', 'OTHER']

const DEVICE_TYPE_LABELS: Record<string, string> = {
  PRINTER: 'เครื่องพิมพ์',
  COPIER: 'เครื่องถ่ายเอกสาร',
  MFP: 'เครื่องพิมพ์มัลติฟังก์ชัน',
  SCANNER: 'เครื่องสแกน',
  COMPUTER: 'คอมพิวเตอร์',
  NETWORK: 'อุปกรณ์เครือข่าย',
  OTHER: 'อื่น ๆ',
}

// ── Form state ───────────────────────────────────────────────────────

interface FormState {
  title: string
  description: string
  frequency: string
  intervalDays: string
  dayOfMonth: string
  weekday: string
  startMonth: string
  deviceType: string
  site: string
  building: string
  floor: string
  department: string
  deviceId: string
  startDate: string
  autoCreateWO: boolean
  assignedTo: string
  checklist: ChecklistItem[]
}

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  frequency: 'monthly',
  intervalDays: '',
  dayOfMonth: '1',
  weekday: 'MON',
  startMonth: '1',
  deviceType: '',
  site: '',
  building: '',
  floor: '',
  department: '',
  deviceId: '',
  startDate: todayISO(),
  autoCreateWO: false,
  assignedTo: '',
  checklist: [],
}

function PMSchedulePreview({ form }: { form: FormState }) {
  let dates: string[] = [], error = ''
  try {
    dates = upcomingPMDates({ frequency: form.frequency, intervalDays: form.intervalDays ? Number(form.intervalDays) : null, dayOfMonth: form.dayOfMonth ? Number(form.dayOfMonth) : null, weekday: form.weekday || null, startMonth: form.startMonth ? Number(form.startMonth) : null, startDate: form.startDate || null })
  } catch (cause) { error = cause instanceof Error ? cause.message : 'กรุณาตรวจรอบ PM' }
  return <div className="rounded-md border bg-slate-50 p-3 text-xs dark:bg-slate-900" aria-live="polite">
    <p className="font-semibold">วันนัด 5 ครั้งถัดไป</p>
    {error ? <p className="mt-2 text-red-600" role="status">{error}</p> : <ol className="mt-2 flex flex-wrap gap-2">{dates.map(date => <li className="rounded border bg-background px-2 py-1" key={date}>{formatDate(date)}</li>)}</ol>}
    <p className="mt-2 text-muted-foreground">นับจากวันเริ่มแผนตามเวลาไทย หากเดือนนั้นไม่มีวันที่เลือก จะนัดวันสุดท้ายของเดือน</p>
  </div>
}

// ── Component ────────────────────────────────────────────────────────

export function PMSchedulesPage() {
  const qc = useQueryClient()
  const t = useT()
  const { lang } = useLang()
  const [search, setSearch] = React.useState('')
  const [activeFilter, setActiveFilter] = React.useState<'all' | 'active' | 'inactive'>('all')
  const [siteFilter, setSiteFilter] = React.useState<string>('all')

  // ── Site filter visibility — only show if user can select among multiple sites ──
  const authUser = useAuthStore((s) => s.user)
  const showSiteFilter = authUser ? canSelectSite(authUser) : false

  const [formOpen, setFormOpen] = React.useState(false)
  const [editTarget, setEditTarget] = React.useState<PMSchedule | null>(null)
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = React.useState<PMSchedule | null>(null)

  function getAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra }
    const token = useAuthStore.getState()?.token
    if (token) h['Authorization'] = `Bearer ${token}`
    return h
  }

  async function authFetch<T>(url: string, init?: RequestInit): Promise<T> {
    const headers = getAuthHeaders(init?.headers as Record<string, string> | undefined)
    const res = await fetch(url, { ...init, headers })
    const json = (await res.json().catch(() => ({}))) as { error?: string } & T
    if (!res.ok) {
      throw new Error(json?.error || `Request failed (${res.status})`)
    }
    return json as T
  }

  // ── Fetch sites ──
  const { data: sitesData } = useQuery<Site[]>({
    queryKey: ['sites-pm'],
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
  const sites = sitesData ?? []

  // ── Fetch ALL active devices for the current site scope (single fetch) ──
  // Replaces the previous 3 separate `distinct=…` fetches that had three bugs:
  //   1) `pageSize=500` was ignored — the route only reads `limit` (default 100).
  //   2) the response field is `devices`, not `data` — so the old `.data ?? []`
  //      fallback made every dropdown render EMPTY (only the placeholder showed).
  //   3) no `status` param — pulled ALL statuses instead of Active-only as the
  //      user explicitly asked ("OnlyStatusatActive").
  // Now we fetch up to 500 active devices ONCE and derive building / floor /
  // department lists + per-option counts entirely client-side, so cascading
  // (select Building → Floor list narrows → Department list narrows) is instant
  // and we can show "(N units)" next to each option.
  const { data: activeDevicesData } = useQuery<{
    devices: Array<{
      building: string | null
      floor: string | null
      department: string | null
      type: string | null
    }>
  }>({
    queryKey: ['pm-active-devices', siteFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '500', status: t('status.active') })
      if (siteFilter !== 'all') params.set('site', siteFilter)
      const res = await fetch(`/api/devices?${params}`, { headers: getAuthHeaders() })
      if (!res.ok) return { devices: [] }
      return res.json()
    },
    staleTime: 60_000,
  })

  const allActive = activeDevicesData?.devices ?? []

  // Buildings (all, within current site scope) + active device count per building.
  const masterBuilding = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of allActive) {
      if (d.building) counts.set(d.building, (counts.get(d.building) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'th'))
      .map(([code, count]) => ({ code, label: code, count }))
  }, [allActive])

  // Floors (cascading: filtered by selected building) + active device count per floor.
  const masterFloor = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of allActive) {
      if (!d.floor) continue
      if (form.building && d.building !== form.building) continue
      counts.set(d.floor, (counts.get(d.floor) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => {
        const na = Number(a)
        const nb = Number(b)
        if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb
        return a.localeCompare(b, 'th')
      })
      .map(([code, count]) => ({ code, label: code, count }))
  }, [allActive, form.building])

  // Departments (cascading: filtered by selected building + floor) + active device count.
  const masterDepartment = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of allActive) {
      if (!d.department) continue
      if (form.building && d.building !== form.building) continue
      if (form.floor && d.floor !== form.floor) continue
      counts.set(d.department, (counts.get(d.department) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'th'))
      .map(([code, count]) => ({ code, label: code, count }))
  }, [allActive, form.building, form.floor])

  // Active device counts per type — used to annotate the device-type dropdown.
  const deviceTypeCounts = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of allActive) {
      if (!d.type) continue
      counts.set(d.type, (counts.get(d.type) ?? 0) + 1)
    }
    return counts
  }, [allActive])

  // Estimated active device count matching the WHOLE current form selection.
  // Shown in the "เป้าหมายปัจจุบัน" summary so the user knows roughly how many
  // machines the schedule will cover.
  const targetDeviceCount = React.useMemo(() => {
    return allActive.filter((d) => {
      if (form.deviceType && d.type !== form.deviceType) return false
      if (form.building && d.building !== form.building) return false
      if (form.floor && d.floor !== form.floor) return false
      if (form.department && d.department !== form.department) return false
      return true
    }).length
  }, [allActive, form.deviceType, form.building, form.floor, form.department])

  // ── Fetch schedules ──
  const params = new URLSearchParams()
  if (activeFilter === 'active') params.set('active', 'true')
  if (activeFilter === 'inactive') params.set('active', 'false')
  if (siteFilter !== 'all') params.set('site', siteFilter)
  if (search) params.set('search', search)

  const { data, isLoading, isFetching, refetch } = useQuery<{ data: PMSchedule[] }>({
    queryKey: ['pm-schedules', activeFilter, siteFilter, search],
    queryFn: () => authFetch(`/api/pm/schedules?${params.toString()}`),
    staleTime: 30_000,
  })
  const schedules = data?.data ?? []

  // ── Mutations ──
  const upsertMutation = useMutation({
    mutationFn: async (input: { id?: string; data: FormState }) => {
      const payload = {
        title: input.data.title.trim(),
        description: input.data.description.trim() || null,
        frequency: input.data.frequency,
        intervalDays: input.data.intervalDays === '' ? null : Number(input.data.intervalDays),
        dayOfMonth: input.data.dayOfMonth === '' ? null : Number(input.data.dayOfMonth),
        weekday: input.data.weekday || null,
        startMonth: input.data.startMonth === '' ? null : Number(input.data.startMonth),
        deviceType: input.data.deviceType || null,
        site: input.data.site || null,
        building: input.data.building || null,
        floor: input.data.floor || null,
        department: input.data.department || null,
        deviceId: input.data.deviceId || null,
        checklist: input.data.checklist.length > 0 ? input.data.checklist : null,
        startDate: input.data.startDate || null,
        autoCreateWO: input.data.autoCreateWO,
        assignedTo: input.data.assignedTo.trim() || null,
      }
      if (input.id) {
        return authFetch<{ data: PMSchedule }>(`/api/pm/schedules/${input.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return authFetch<{ data: PMSchedule }>(`/api/pm/schedules`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      })
    },
    onSuccess: (_json, vars) => {
      toast.success(vars.id ? 'แก้ไขผัง PM เรียบร้อย' : 'สร้างผัง PM เรียบร้อย')
      qc.invalidateQueries({ queryKey: ['pm-schedules'] })
      setFormOpen(false)
      setEditTarget(null)
      setForm(EMPTY_FORM)
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      authFetch(`/api/pm/schedules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('ปิดใช้งานผัง PM เรียบร้อย')
      qc.invalidateQueries({ queryKey: ['pm-schedules'] })
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    },
  })

  // ── Handlers ──
  function openCreate() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setFormOpen(true)
  }

  function openEdit(s: PMSchedule) {
    setEditTarget(s)
    let parsedChecklist: ChecklistItem[] = []
    try {
      if (s.checklist) {
        parsedChecklist = JSON.parse(s.checklist) as ChecklistItem[]
      }
    } catch {
      parsedChecklist = []
    }
    setForm({
      title: s.title,
      description: s.description ?? '',
      frequency: s.frequency,
      intervalDays: s.intervalDays == null ? '' : String(s.intervalDays),
      dayOfMonth: s.dayOfMonth == null ? '' : String(s.dayOfMonth),
      weekday: s.weekday ?? 'MON',
      startMonth: s.startMonth == null ? '' : String(s.startMonth),
      deviceType: s.deviceType ?? '',
      site: s.site ?? '',
      building: (s as PMSchedule & { building?: string | null }).building ?? '',
      floor: (s as PMSchedule & { floor?: string | null }).floor ?? '',
      department: (s as PMSchedule & { department?: string | null }).department ?? '',
      deviceId: s.deviceId ?? '',
      startDate: s.startDate ?? todayISO(),
      autoCreateWO: s.autoCreateWO,
      assignedTo: s.assignedTo ?? '',
      checklist: parsedChecklist,
    })
    setFormOpen(true)
  }

  function submitForm() {
    if (!form.title.trim()) {
      toast.error('กรุณาระบุชื่องาน')
      return
    }
    if (!form.site && !form.deviceId) { toast.error('กรุณาเลือกสาขาของแผน PM'); return }
    try { upcomingPMDates({ frequency: form.frequency, intervalDays: form.intervalDays ? Number(form.intervalDays) : null, dayOfMonth: Number(form.dayOfMonth), weekday: form.weekday, startMonth: Number(form.startMonth), startDate: form.startDate || null }, 1) }
    catch (error) { toast.error(error instanceof Error ? error.message : 'กรุณาตรวจรอบ PM'); return }
    upsertMutation.mutate({ id: editTarget?.id, data: form })
  }

  function addChecklistItem() {
    setForm((f) => ({
      ...f,
      checklist: [
        ...f.checklist,
        { id: `c${Date.now()}`, label: '', required: false },
      ],
    }))
  }
  function updateChecklistItem(idx: number, key: 'label' | 'required', value: string | boolean) {
    setForm((f) => ({
      ...f,
      checklist: f.checklist.map((c, i) => (i === idx ? { ...c, [key]: value } : c)),
    }))
  }
  function removeChecklistItem(idx: number) {
    setForm((f) => ({
      ...f,
      checklist: f.checklist.filter((_, i) => i !== idx),
    }))
  }

  // ── Stats ──
  const stats = React.useMemo(() => {
    const active = schedules.filter((s) => s.active).length
    const dueSoon = schedules.filter((s) => {
      if (!s.active || !s.nextRunDate) return false
      const days = daysUntil(s.nextRunDate)
      return days != null && days <= 7 && days >= -3
    }).length
    const overdue = schedules.filter((s) => {
      if (!s.active || !s.nextRunDate) return false
      const days = daysUntil(s.nextRunDate)
      return days != null && days < 0
    }).length
    return { total: schedules.length, active, dueSoon, overdue }
  }, [schedules])

  // ── Tab state (Phase 4: Calendar + Phase 5: History) ──
  const [activeTab, setActiveTabState] = React.useState<'schedules' | 'calendar' | 'history'>('schedules')
  const setActiveTab = React.useCallback((v: 'schedules' | 'calendar' | 'history') => {
    setActiveTabState(v)
  }, [])
  // Calendar state
  const [calMonth, setCalMonth] = React.useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  // Execution dialog state (Phase 5)
  const [execTarget, setExecTarget] = React.useState<{
    scheduleId: string
    scheduleNo: string | null
    title: string
    scheduledDate: string
    executionId: string | null
    checklist: ChecklistItem[]
  } | null>(null)

  // ── Calendar query (Phase 4) ──
  const { data: calData, isLoading: calLoading, isFetching: calFetching, refetch: calRefetch } = useQuery<{
    month: string
    schedules: number
    total: number
    completed: number
    pending: number
    byDate: Record<string, Array<{
      executionId: string | null
      scheduleId: string
      scheduleNo: string | null
      title: string
      frequency: string
      deviceType: string | null
      site: string | null
      deviceId: string | null
      deviceName: string | null
      deviceAssetCode: string | null
      assignedTo: string | null
      status: string
      scheduledDate: string
      executedDate: string | null
    }>>
    dates: string[]
  }>({
    queryKey: ['pm-calendar', calMonth, siteFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ month: calMonth })
      if (siteFilter !== 'all') params.set('site', siteFilter)
      const res = await fetch(`/api/pm/calendar?${params.toString()}`, { headers: getAuthHeaders() })
      if (!res.ok) throw new Error('Failed to load calendar')
      return res.json()
    },
    enabled: activeTab === 'calendar',
    staleTime: 30_000,
  })

  // ── History query (Phase 5) ──
  const { data: histData, isLoading: histLoading, refetch: histRefetch } = useQuery<{ data: PMExecutionRow[] }>({
    queryKey: ['pm-executions-history', siteFilter],
    queryFn: async () => {
      const res = await fetch(`/api/pm/executions?limit=100`, { headers: getAuthHeaders() })
      if (!res.ok) throw new Error('Failed to load history')
      return res.json()
    },
    enabled: activeTab === 'history',
    staleTime: 30_000,
  })

  // ── Calendar navigation ──
  function prevMonth() {
    const [y, m] = calMonth.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    setCalMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  function nextMonth() {
    const [y, m] = calMonth.split('-').map(Number)
    const d = new Date(y, m, 1)
    setCalMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  function formatMonthLabel(m: string): string {
    const [y, mo] = m.split('-').map(Number)
    const locale = lang === 'th' ? 'th-TH' : 'en-GB'
    const opts: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' }
    if (lang === 'th') opts.calendar = 'buddhist'
    return new Date(y, mo - 1, 1).toLocaleDateString(locale, opts)
  }

  // ── Render ──
  return (
    <div className="flex h-full flex-col gap-3 p-3 md:gap-4 md:p-4">
      {/* ── Header ── */}
      {/* ── Header — STICKY: stays visible while scrolling PM content ── */}
      <Card className="sticky top-0 z-20 -mx-3 flex-shrink-0 shadow-sm md:-mx-4">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow">
                  <CalendarClock className="h-5 w-5" />
                </div>
                <span>งานบำรุงรักษา</span>
                <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300">
                  PM (Preventive)
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1 text-xs md:text-sm">
                วางแผนตรวจบำรุงรักษาครุภัณฑ์ตามรอบ พร้อมผู้รับผิดชอบและประวัติงาน
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
                <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
                รีเฟรช
              </Button>
              <Button
                size="sm"
                onClick={openCreate}
                className="h-10 bg-violet-600 hover:bg-violet-700"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                สร้างผัง PM
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="แผนทั้งหมด" value={stats.total} icon={<CalendarClock className="h-4 w-4" />} accent="#6366f1" />
            <StatCard label="เปิดใช้งาน" value={stats.active} icon={<Power className="h-4 w-4" />} accent="#10b981" />
            <StatCard label="ใกล้ถึงกำหนด" value={stats.dueSoon} icon={<Clock className="h-4 w-4" />} accent="#f59e0b" />
            <StatCard label="เกินกำหนด" value={stats.overdue} icon={<AlertCircle className="h-4 w-4" />} accent="#f43f5e" />
          </div>

          {/* Filter bar */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="pm-search" className="text-xs font-medium">{t('control.search')}</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="pm-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ชื่อตาราง / รหัส / คำอธิบาย"
                  className="h-9 pl-8 text-xs"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pm-active" className="text-xs font-medium">{t('settings.col.status')}</Label>
              <Select value={activeFilter} onValueChange={(v) => setActiveFilter(v as 'all' | 'active' | 'inactive')}>
                <SelectTrigger id="pm-active" className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทั้งหมด</SelectItem>
                  <SelectItem value="active">ใช้งาน</SelectItem>
                  <SelectItem value="inactive">ปิดใช้งาน</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {showSiteFilter && (
              <div className="space-y-1.5">
                <Label htmlFor="pm-site" className="text-xs font-medium">Site</Label>
                <Select value={siteFilter} onValueChange={setSiteFilter}>
                  <SelectTrigger id="pm-site" className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">ทุกสาขา</SelectItem>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.code}>
                        {s.name} ({s.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Tabs (Phase 4: Calendar + Phase 5: History) ── */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'schedules' | 'calendar' | 'history')}
        className="flex min-h-0 flex-1 flex-col gap-3"
      >
        <TabsList className="grid h-auto w-full grid-cols-3 gap-1">
          <TabsTrigger value="schedules" className="flex flex-col items-center gap-0.5 py-2 text-xs md:text-sm">
            <CalendarClock className="h-4 w-4" />
            <span>ตารางงาน</span>
          </TabsTrigger>
          <TabsTrigger value="calendar" className="flex flex-col items-center gap-0.5 py-2 text-xs md:text-sm">
            <Calendar className="h-4 w-4" />
            <span>ปฏิทิน</span>
          </TabsTrigger>
          <TabsTrigger value="history" className="flex flex-col items-center gap-0.5 py-2 text-xs md:text-sm">
            <CheckCircle2 className="h-4 w-4" />
            <span>{t('devices.row.history')}</span>
          </TabsTrigger>
        </TabsList>

        {/* ── Schedules tab ── */}
        <TabsContent value="schedules" className="min-h-0 flex-1">
      {/* ── Schedule list ── */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <Card className="min-h-0 flex-1">
          <CardContent className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <CalendarClock className="h-12 w-12 text-muted-foreground/40" />
            <div className="text-sm font-medium text-muted-foreground">ยังไม่มีผัง PM</div>
            <p className="max-w-md text-xs text-muted-foreground/70">
              คลิกปุ่ม &quot;สร้างผัง PM&quot; เพื่อเพิ่มตารางบำรุงรักษาตามรอบเวลา
              เช่น ทำความสะอาดหน่วยพิมพ์ทุกเดือน ตรวจเช็คอะไหล่ทุกไตรมาส
            </p>
            <Button size="sm" onClick={openCreate} className="mt-3 bg-violet-600 hover:bg-violet-700">
              <Plus className="mr-1 h-3.5 w-3.5" />
              สร้างตารางแรก
            </Button>
          </CardContent>
        </Card>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="min-h-0 flex-1 overflow-y-auto pr-1"
        >
          <Card className="shadow-sm">
            <CardContent className="p-0">
              <div className="itam-scroll max-h-[60vh] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm dark:bg-slate-900/95">
                    <TableRow className="text-xs">
                      <TableHead className="w-[25%]">ตารางงาน</TableHead>
                      <TableHead>ความถี่</TableHead>
                      <TableHead>เป้าหมาย</TableHead>
                      <TableHead className="text-right">ครั้งถัดไป</TableHead>
                      <TableHead className="text-right">ครั้งล่าสุด</TableHead>
                      <TableHead className="text-right">{t('devices.row.history')}</TableHead>
                      <TableHead className="text-right">{t('settings.col.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schedules.map((s) => {
                      const nextDays = daysUntil(s.nextRunDate)
                      const isOverdue = nextDays != null && nextDays < 0
                      const isDueSoon = nextDays != null && nextDays >= 0 && nextDays <= 7
                      return (
                        <TableRow key={s.id} className="text-xs">
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {!s.active && (
                                <Badge variant="outline" className="border-slate-300 bg-slate-100 text-[9px] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                                  Close
                                </Badge>
                              )}
                              <div className="min-w-0">
                                <div className="truncate font-medium text-slate-700 dark:text-slate-200">{s.title}</div>
                                <div className="font-mono text-[10px] text-slate-400">{s.scheduleNo}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">
                              {FREQUENCY_LABELS[s.frequency] ?? s.frequency}
                            </Badge>
                            {s.frequency === 'custom' && s.intervalDays && (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                ({s.intervalDays} days)
                              </span>
                            )}
                            {s.frequency === 'monthly' && s.dayOfMonth && (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                (Date {s.dayOfMonth})
                              </span>
                            )}
                            {s.frequency === 'weekly' && s.weekday && (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                ({WEEKDAY_LABELS[s.weekday] ?? s.weekday})
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-0.5">
                              {s.device ? (
                                <span className="truncate text-[11px]">
                                  {s.device.assetCode} · {s.device.name}
                                </span>
                              ) : s.deviceType ? (
                                <span className="text-[11px]">
                                  {DEVICE_TYPE_LABELS[s.deviceType] ?? s.deviceType}
                                </span>
                              ) : (
                                <span className="text-[11px] text-muted-foreground">ทุกอุปกรณ์</span>
                              )}
                              {s.site && (
                                <span className="text-[10px] text-muted-foreground">สาขา: {s.site}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {s.nextRunDate ? (
                              <div className="flex flex-col items-end">
                                <span className={`text-[11px] font-medium ${
                                  isOverdue ? 'text-rose-600 dark:text-rose-400' :
                                  isDueSoon ? 'text-amber-600 dark:text-amber-400' :
                                  'text-slate-600 dark:text-slate-300'
                                }`}>
                                  {formatDate(s.nextRunDate)}
                                </span>
                                {nextDays != null && (
                                  <span className="text-[10px] text-muted-foreground">
                                    {isOverdue ? `just ${Math.abs(nextDays)} days` : `more ${nextDays} days`}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-[11px] text-muted-foreground">
                            {formatDate(s.lastRunDate)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className="text-[10px]">
                              {s._count?.executions ?? 0} times
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openEdit(s)}
                                className="h-7 w-7 p-0"
                                aria-label={t('settings.edit')}
                                title={t('settings.edit')}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              {s.active && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setDeleteTarget(s)}
                                  className="h-7 w-7 p-0 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                  aria-label="ปิดใช้งาน"
                                  title="ปิดใช้งาน"
                                >
                                  <Power className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
        </TabsContent>

        {/* ── Calendar tab (Phase 4) ── */}
        <TabsContent value="calendar" className="min-h-0 flex-1">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={prevMonth} className="h-8 w-8 p-0" aria-label="เดือนก่อนหน้า">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm font-semibold">{formatMonthLabel(calMonth)}</span>
                  <Button size="sm" variant="outline" onClick={nextMonth} className="h-8 w-8 p-0" aria-label="เดือนถัดไป">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const now = new Date()
                      setCalMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
                    }}
                    className="h-8 px-2 text-xs"
                  >
                    days
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => calRefetch()}
                  disabled={calFetching}
                  className="h-8"
                >
                  <RefreshCw className={`mr-1 h-3.5 w-3.5 ${calFetching ? 'animate-spin' : ''}`} />
                  รีเฟรช
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {calLoading ? (
                <Skeleton className="h-96 w-full rounded-lg" />
              ) : !calData || calData.total === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <Calendar className="h-12 w-12 text-muted-foreground/40" />
                  <div className="text-sm font-medium text-muted-foreground">
                    ไม่มี PM ในเดือน {formatMonthLabel(calMonth)}
                  </div>
                  <p className="max-w-md text-xs text-muted-foreground/70">
                    สร้างผัง PM ในแท็บ &quot;ตารางงาน&quot; เพื่อแสดงในปฏิทิน
                  </p>
                </div>
              ) : (
                <>
                  {/* Summary bar */}
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300">
                      Total {calData.total} item
                    </Badge>
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      Done {calData.completed}
                    </Badge>
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      PendingDo {calData.pending}
                    </Badge>
                  </div>
                  {/* Calendar grid */}
                  <div className="grid grid-cols-7 gap-1">
                    {/* Weekday headers — locale-aware (TH: อา จ อ พ พฤ ศ ส / EN: Sun Mon Tue Wed Thu Fri Sat) */}
                    {(lang === 'th'
                      ? ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
                      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
                    ).map((d, i) => (
                      <div key={i} className="rounded-md bg-slate-100 py-1.5 text-center text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {d}
                      </div>
                    ))}
                    {/* Days */}
                    {(() => {
                      const [y, m] = calMonth.split('-').map(Number)
                      const firstDay = new Date(y, m - 1, 1).getDay()
                      const daysInMonth = new Date(y, m, 0).getDate()
                      const cells: React.ReactNode[] = []
                      // Empty cells before the 1st
                      for (let i = 0; i < firstDay; i++) {
                        cells.push(<div key={`empty-${i}`} className="min-h-[80px] rounded-md border border-dashed border-slate-100 dark:border-slate-800" />)
                      }
                      // Day cells
                      for (let day = 1; day <= daysInMonth; day++) {
                        const dateStr = `${calMonth}-${String(day).padStart(2, '0')}`
                        const dayPMs = calData.byDate[dateStr] ?? []
                        const today = new Date().toISOString().slice(0, 10)
                        const isToday = dateStr === today
                        cells.push(
                          <div
                            key={day}
                            className={`min-h-[80px] rounded-md border p-1 text-[10px] ${
                              isToday
                                ? 'border-violet-300 bg-violet-50/50 dark:border-violet-700 dark:bg-violet-950/20'
                                : 'border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            <div className={`mb-1 text-right font-medium ${isToday ? 'text-violet-600 dark:text-violet-400' : 'text-slate-500 dark:text-slate-400'}`}>
                              {day}
                            </div>
                            <div className="space-y-0.5">
                              {dayPMs.map((pm, idx) => {
                                const isCompleted = pm.status === 'COMPLETED'
                                const isOverdue = pm.status === 'PENDING' && new Date(dateStr) < new Date(today)
                                return (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() => {
                                      // Find the schedule to get checklist
                                      const sched = schedules.find((s) => s.id === pm.scheduleId)
                                      let checklist: ChecklistItem[] = []
                                      try {
                                        if (sched?.checklist) {
                                          checklist = JSON.parse(sched.checklist)
                                        }
                                      } catch (err) { console.error('[pm-schedules-page]', err) }
                                      setExecTarget({
                                        scheduleId: pm.scheduleId,
                                        scheduleNo: pm.scheduleNo,
                                        title: pm.title,
                                        scheduledDate: pm.scheduledDate,
                                        executionId: pm.executionId,
                                        checklist,
                                      })
                                    }}
                                    className={`block w-full truncate rounded px-1 py-0.5 text-left text-[9px] transition hover:opacity-80 ${
                                      isCompleted
                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                        : isOverdue
                                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                                        : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                                    }`}
                                    title={`${pm.title} — ${pm.status}`}
                                  >
                                    {isCompleted ? '✓ ' : isOverdue ? '! ' : ''}
                                    {pm.deviceAssetCode ?? pm.title.slice(0, 12)}
                                  </button>
                                )
                              })}
                            </div>
                          </div>,
                        )
                      }
                      return cells
                    })()}
                  </div>
                  {/* Legend */}
                  <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-100 dark:bg-emerald-950/40" />
                      Done
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-100 dark:bg-amber-950/40" />
                      PendingDo
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-100 dark:bg-rose-950/40" />
                      justSet
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── History tab (Phase 5) ── */}
        <TabsContent value="history" className="min-h-0 flex-1">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-sm">ประวัติการทำ PM</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => histRefetch()}
                  className="h-8"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {histLoading ? (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full rounded-lg" />
                  ))}
                </div>
              ) : !histData?.data || histData.data.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <CheckCircle2 className="h-12 w-12 text-muted-foreground/40" />
                  <div className="text-sm font-medium text-muted-foreground">ยังไม่มีประวัติการทำ PM</div>
                  <p className="text-xs text-muted-foreground/70">
                    ไปที่แท็บ &quot;ปฏิทิน&quot; แล้วคลิก PM ในวันที่ต้องดำเนินการ
                  </p>
                </div>
              ) : (
                <div className="itam-scroll max-h-[60vh] overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm dark:bg-slate-900/95">
                      <TableRow className="text-xs">
                        <TableHead>ผัง PM</TableHead>
                        <TableHead>วันที่ตั้ง</TableHead>
                        <TableHead>วันที่ทำจริง</TableHead>
                        <TableHead>{t('settings.col.status')}</TableHead>
                        <TableHead>ผู้ปฏิบัติงาน</TableHead>
                        <TableHead className="text-right">{t('settings.col.actions')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {histData.data.map((exec) => {
                        const sched = exec.schedule
                        let parsedChecklist: ChecklistItem[] = []
                        try {
                          if (sched?.checklist) {
                            parsedChecklist = JSON.parse(sched.checklist)
                          }
                        } catch (err) { console.error('[pm-schedules-page]', err) }
                        return (
                          <TableRow key={exec.id} className="text-xs">
                            <TableCell>
                              <div className="font-medium text-slate-700 dark:text-slate-200">
                                {sched?.title ?? '—'}
                              </div>
                              <div className="font-mono text-[10px] text-slate-400">
                                {sched?.scheduleNo ?? '—'}
                              </div>
                            </TableCell>
                            <TableCell className="text-[11px]">{formatDate(exec.scheduledDate)}</TableCell>
                            <TableCell className="text-[11px]">{formatDate(exec.executedDate)}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${
                                  exec.status === 'COMPLETED'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                    : exec.status === 'PENDING'
                                    ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                    : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                }`}
                              >
                                {exec.status === 'COMPLETED' ? 'Done' : exec.status === 'PENDING' ? 'PendingDo' : exec.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-[11px] text-muted-foreground">{exec.performedBy ?? '—'}</TableCell>
                            <TableCell className="text-right">
                              {exec.status !== 'COMPLETED' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setExecTarget({
                                      scheduleId: exec.scheduleId,
                                      scheduleNo: sched?.scheduleNo ?? null,
                                      title: sched?.title ?? '',
                                      scheduledDate: exec.scheduledDate,
                                      executionId: exec.id,
                                      checklist: parsedChecklist,
                                    })
                                  }}
                                  className="h-7 border-emerald-300 px-2 text-[11px] text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                                >
                                  <CheckCircle2 className="mr-1 h-3 w-3" />
                                  Do PM
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Execution dialog (Phase 5) ── */}
      <PMExecutionDialog
        target={execTarget}
        onClose={() => setExecTarget(null)}
        onComplete={async (result) => {
          try {
            let execId = result.executionId
            // Create execution if it doesn't exist
            if (!execId) {
              const createRes = await fetch(`/api/pm/executions`, {
                method: 'POST',
                headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                  scheduleId: result.scheduleId,
                  scheduledDate: result.scheduledDate,
                }),
              })
              if (!createRes.ok) throw new Error('Failed to create execution')
              const created = await createRes.json()
              execId = created.data.id
            }
            // Complete it
            const res = await fetch(`/api/pm/executions/${execId}/complete`, {
              method: 'POST',
              headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({
                checklistResult: result.checklistResult,
                remark: result.remark,
                performedBy: result.performedBy,
                images: result.images,
              }),
            })
            if (!res.ok) {
              const j = await res.json().catch(() => ({}))
              throw new Error(j.error ?? 'Failed to complete PM')
            }
            toast.success('บันทึกผลการทำ PM เรียบร้อย')
            setExecTarget(null)
            qc.invalidateQueries({ queryKey: ['pm-calendar'] })
            qc.invalidateQueries({ queryKey: ['pm-executions-history'] })
            qc.invalidateQueries({ queryKey: ['pm-schedules'] })
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
          }
        }}
      />

      {/* ── Create/Edit dialog ── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-violet-600" />
              {editTarget ? 'แก้ไขผัง PM' : 'สร้างผัง PM'}
            </DialogTitle>
            <DialogDescription>
              {editTarget ? `รหัส: ${editTarget.scheduleNo}` : 'กำหนดตารางบำรุงรักษาตามรอบเวลา'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="pm-title">ชื่องาน <span className="text-rose-500">*</span></Label>
              <Input
                id="pm-title"
                placeholder="เช่น บำรุงรักษาหน่วยพิมพ์รายเดือน"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="pm-desc">รายละเอียด</Label>
              <Textarea
                id="pm-desc"
                rows={2}
                placeholder="(ไม่บังคับ) อธิบายขอบเขตงาน"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            {/* Frequency */}
            <div className="rounded-md border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-800 dark:bg-violet-950/20">
              <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                รอบการบำรุงรักษา
              </Label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pm-freq" className="text-xs">รอบการบำรุงรักษา</Label>
                  <Select
                    value={form.frequency}
                    onValueChange={(v) => setForm((f) => ({ ...f, frequency: v }))}
                  >
                    <SelectTrigger id="pm-freq" className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FREQUENCY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {form.frequency === 'custom' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="pm-interval" className="text-xs">ทำซ้ำทุกกี่วัน</Label>
                    <Input
                      id="pm-interval"
                      type="number"
                      min="1"
                      value={form.intervalDays}
                      onChange={(e) => setForm((f) => ({ ...f, intervalDays: e.target.value }))}
                      placeholder="เช่น 45"
                      className="h-9 text-xs"
                    />
                  </div>
                )}
                {(form.frequency === 'monthly' || form.frequency === 'quarterly' || form.frequency === 'half_yearly' || form.frequency === 'yearly') && (
                  <div className="space-y-1.5">
                    <Label htmlFor="pm-day" className="text-xs">วันที่ของเดือน (1–31)</Label>
                    <Input
                      id="pm-day"
                      type="number"
                      min="1"
                      max="31"
                      value={form.dayOfMonth}
                      onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: e.target.value }))}
                      className="h-9 text-xs"
                    />
                  </div>
                )}
                {form.frequency === 'weekly' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="pm-weekday" className="text-xs">วันในสัปดาห์</Label>
                    <Select
                      value={form.weekday}
                      onValueChange={(v) => setForm((f) => ({ ...f, weekday: v }))}
                    >
                      <SelectTrigger id="pm-weekday" className="h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEEKDAY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(form.frequency === 'quarterly' || form.frequency === 'half_yearly' || form.frequency === 'yearly') && (
                  <div className="space-y-1.5">
                    <Label htmlFor="pm-startmonth" className="text-xs">เดือนเริ่มรอบ</Label>
                    <Select
                      value={form.startMonth}
                      onValueChange={(v) => setForm((f) => ({ ...f, startMonth: v }))}
                    >
                      <SelectTrigger id="pm-startmonth" className="h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 12 }).map((_, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)}>
                            {new Date(2024, i, 1).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', { month: 'long' })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="mt-2 space-y-1.5">
                <Label htmlFor="pm-start" className="text-xs">วันที่เริ่มแผน</Label>
                <Input
                  id="pm-start"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <PMSchedulePreview form={form} />

            {/* Target */}
            <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                กลุ่มเป้าหมาย — เลือกได้หลายประเภท
              </Label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pm-dtype" className="text-xs">ประเภทอุปกรณ์</Label>
                  <Select
                    value={form.deviceType || '__none__'}
                    onValueChange={(v) => setForm((f) => ({ ...f, deviceType: v === '__none__' ? '' : v }))}
                  >
                    <SelectTrigger id="pm-dtype" className="h-9 text-xs">
                      <SelectValue placeholder="ทุกประเภท" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">ทุกประเภท</SelectItem>
                      {DEVICE_TYPES.map((t) => {
                        const cnt = deviceTypeCounts.get(t) ?? 0
                        return (
                          <SelectItem key={t} value={t}>
                            {DEVICE_TYPE_LABELS[t] ?? t}{' '}
                            <span className="ml-1 text-[10px] text-slate-400">({cnt} เครื่อง)</span>
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pm-sitesel" className="text-xs">สาขา</Label>
                  <Select
                    value={form.site || '__none__'}
                    onValueChange={(v) => setForm((f) => ({
                      ...f,
                      site: v === '__none__' ? '' : v,
                      building: '', floor: '', department: '',
                    }))}
                  >
                    <SelectTrigger id="pm-sitesel" className="h-9 text-xs">
                      <SelectValue placeholder="เลือกสาขา" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">เลือกสาขา</SelectItem>
                      {sites.map((s) => (
                        <SelectItem key={s.id} value={s.code}>
                          {s.name} ({s.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* ── SelectTypeGroupAddFill ── */}
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <Label className="text-xs text-slate-500">เลือกกลุ่มเป้าหมายเพื่อเติมอัตโนมัติ (ไม่บังคับ)</Label>
                <div className="flex flex-wrap gap-2">
                  {/* All devices */}
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, deviceType: '', deviceId: '' }))}
                    className={`rounded-md border px-2.5 py-1 text-[11px] transition ${
                      !form.deviceType && !form.site && !form.deviceId
                        ? 'border-violet-400 bg-violet-100 text-violet-700 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-violet-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    📋 ทุกอุปกรณ์
                  </button>
                  {/* By type — PRINTER */}
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, deviceType: 'PRINTER', deviceId: '' }))}
                    className={`rounded-md border px-2.5 py-1 text-[11px] transition ${
                      form.deviceType === 'PRINTER'
                        ? 'border-orange-400 bg-orange-100 text-orange-700 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-300'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-orange-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    🖨️ เครื่องพิมพ์
                  </button>
                  {/* By type — COPIER */}
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, deviceType: 'COPIER', deviceId: '' }))}
                    className={`rounded-md border px-2.5 py-1 text-[11px] transition ${
                      form.deviceType === 'COPIER'
                        ? 'border-teal-400 bg-teal-100 text-teal-700 dark:border-teal-700 dark:bg-teal-950 dark:text-teal-300'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    📄 เครื่องถ่ายเอกสาร
                  </button>
                  {/* By type — MFP */}
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, deviceType: 'MFP', deviceId: '' }))}
                    className={`rounded-md border px-2.5 py-1 text-[11px] transition ${
                      form.deviceType === 'MFP'
                        ? 'border-amber-400 bg-amber-100 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-amber-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    🖨️📋 มัลติฟังก์ชัน
                  </button>
                  {/* By type — COMPUTER */}
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, deviceType: 'COMPUTER', deviceId: '' }))}
                    className={`rounded-md border px-2.5 py-1 text-[11px] transition ${
                      form.deviceType === 'COMPUTER'
                        ? 'border-blue-400 bg-blue-100 text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    💻 คอมพิวเตอร์
                  </button>
                  {/* By type — NETWORK */}
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, deviceType: 'NETWORK', deviceId: '' }))}
                    className={`rounded-md border px-2.5 py-1 text-[11px] transition ${
                      form.deviceType === 'NETWORK'
                        ? 'border-cyan-400 bg-cyan-100 text-cyan-700 dark:border-cyan-700 dark:bg-cyan-950 dark:text-cyan-300'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-cyan-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    🌐 อุปกรณ์เครือข่าย
                  </button>
                </div>

                {/* Quick site selection */}
                {sites.length > 0 && (
                  <div className="mt-2">
                    <Label className="text-xs text-slate-500">เลือกสาขาเร่งด่วน:</Label>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, site: '' }))}
                        className={`rounded border px-1.5 py-0.5 text-[10px] transition ${
                          !form.site
                            ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300'
                            : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-violet-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        ทุกสาขา
                      </button>
                      {sites.slice(0, 8).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, site: s.code }))}
                          className={`rounded border px-1.5 py-0.5 text-[10px] transition ${
                            form.site === s.code
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {s.code}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── building / Floor / Dept (Chip Selector) ── */}
                <div className="mt-2 space-y-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                  <Label className="text-xs text-slate-500">กรองตามตำแหน่ง (ไม่บังคับ)</Label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {/* Building */}
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-400">อาคาร</Label>
                      <Select
                        value={form.building || '__none__'}
                        onValueChange={(v) => setForm((f) => ({
                          ...f,
                          building: v === '__none__' ? '' : v,
                          floor: '', department: '',
                        }))}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="ทุกอาคาร" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">ทุกอาคาร</SelectItem>
                          {masterBuilding.map((b) => (
                            <SelectItem key={b.code} value={b.label}>
                              {b.label}{' '}
                              <span className="ml-1 text-[10px] text-slate-400">({b.count} เครื่อง)</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* Floor */}
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-400">ชั้น</Label>
                      <Select
                        value={form.floor || '__none__'}
                        onValueChange={(v) => setForm((f) => ({
                          ...f,
                          floor: v === '__none__' ? '' : v,
                          department: '',
                        }))}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="ทุกชั้น" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">ทุกชั้น</SelectItem>
                          {masterFloor.map((fl) => (
                            <SelectItem key={fl.code} value={fl.label}>
                              {fl.label}{' '}
                              <span className="ml-1 text-[10px] text-slate-400">({fl.count} เครื่อง)</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* Department */}
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-400">แผนก</Label>
                      <Select
                        value={form.department || '__none__'}
                        onValueChange={(v) => setForm((f) => ({ ...f, department: v === '__none__' ? '' : v }))}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="ทุกแผนก" />
                        </SelectTrigger>
                        <SelectContent className="max-h-60">
                          <SelectItem value="__none__">ทุกแผนก</SelectItem>
                          {masterDepartment.map((d) => (
                            <SelectItem key={d.code} value={d.label}>
                              {d.label}{' '}
                              <span className="ml-1 text-[10px] text-slate-400">({d.count} เครื่อง)</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Current selection summary */}
                <div className="rounded-md bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600 dark:bg-slate-800/40 dark:text-slate-300">
                  <strong>เป้าหมายปัจจุบัน:</strong>{' '}
                  {form.deviceType ? DEVICE_TYPE_LABELS[form.deviceType] ?? form.deviceType : 'ทุกประเภท'}
                  {form.site ? ` · สาขา ${form.site}` : ' · ทุกสาขา'}
                  {form.building ? ` · อาคาร ${form.building}` : ''}
                  {form.floor ? ` · ชั้น ${form.floor}` : ''}
                  {form.department ? ` · แผนก ${form.department}` : ''}
                  <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                    {' '}· ครุภัณฑ์ที่เปิดใช้งานประมาณ {targetDeviceCount} รายการ
                  </span>
                </div>
              </div>
            </div>

            {/* Assignment + auto-WO */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pm-assign" className="text-xs">ผู้รับผิดชอบดูแล</Label>
                <Input
                  id="pm-assign"
                  placeholder="ชื่อ/อีเมล (ไม่บังคับ)"
                  value={form.assignedTo}
                  onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))}
                  className="h-9 text-xs"
                />
              </div>
              <div className="flex items-end gap-2">
                <label className="flex cursor-not-allowed items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-xs opacity-60">
                  <Switch
                    checked={false}
                    disabled
                  />
                  <span className="text-muted-foreground">
                    สร้างใบสั่งซ่อมอัตโนมัติเมื่อถึงเวลา
                    <span className="ml-1 text-[10px] text-amber-600">(ยังไม่เปิดใช้งาน)</span>
                  </span>
                </label>
              </div>
            </div>

            {/* Checklist */}
            <div className="rounded-md border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-800 dark:bg-emerald-950/20">
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  รายการตรวจบำรุงรักษา
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addChecklistItem}
                  className="h-7 border-emerald-300 px-2 text-[11px] text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                >
                  <Plus className="mr-1 h-3 w-3" />
                  เพิ่มรายการ
                </Button>
              </div>
              {form.checklist.length === 0 ? (
                <p className="rounded-md border border-dashed p-2 text-center text-[11px] text-muted-foreground">
                  ยังไม่มีรายการตรวจสอบ — เพิ่มเพื่อกำหนดขั้นตอนในการทำ PM
                </p>
              ) : (
                <div className="space-y-1.5">
                  {form.checklist.map((c, idx) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 rounded-md border bg-background p-2 text-xs"
                    >
                      <Input
                        value={c.label}
                        onChange={(e) => updateChecklistItem(idx, 'label', e.target.value)}
                        placeholder="เช่น ตรวจสอบระดับน้ำหมึก"
                        className="h-7 flex-1 text-xs"
                      />
                      <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={c.required}
                          onChange={(e) => updateChecklistItem(idx, 'required', e.target.checked)}
                          className="h-3.5 w-3.5 accent-emerald-600"
                        />
                        บังคับตรวจ
                      </label>
                      <button
                        type="button"
                        onClick={() => removeChecklistItem(idx)}
                        className="shrink-0 rounded p-0.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        aria-label="ลบรายการ"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={upsertMutation.isPending}>
              ยกเลิก
            </Button>
            <Button
              onClick={submitForm}
              disabled={upsertMutation.isPending || !form.title.trim()}
              className="bg-violet-600 hover:bg-violet-700"
            >
              {upsertMutation.isPending ? (
                <><RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" /> กำลังบันทึก...</>
              ) : (
                <><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> {editTarget ? t('common.save') : 'สร้างแผน'}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete (deactivate) confirm ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ปิดใช้งานผัง PM</AlertDialogTitle>
            <AlertDialogDescription>
              ยืนยันปิดใช้งาน &quot;{deleteTarget?.title}&quot; ({deleteTarget?.scheduleNo})?
              ระบบจะไม่สร้าง PM รอบใหม่อีก แต่ประวัติการทำ PM ยังคงอยู่
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                if (deleteTarget) {
                  deleteMutation.mutate(deleteTarget.id, {
                    onSuccess: () => setDeleteTarget(null),
                  })
                }
              }}
              className="bg-rose-600 hover:bg-rose-700"
            >
              ปิดใช้งาน
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string
  value: number
  icon: React.ReactNode
  accent: string
}) {
  return (
    <Card className="relative overflow-hidden shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />
      <CardContent className="flex items-center gap-3 p-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `${accent}1a`, color: accent }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-muted-foreground">{label}</div>
          <div className="text-xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
            {value}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================
// PMExecutionDialog — formDo PM (Phase 5)
// checklist + downName + captureimageMainbase
// ============================================================

interface PMExecTarget {
  scheduleId: string
  scheduleNo: string | null
  title: string
  scheduledDate: string
  executionId: string | null
  checklist: ChecklistItem[]
}

interface PMExecResult {
  scheduleId: string
  scheduledDate: string
  executionId: string | null
  checklistResult: Array<{ id: string; label: string; done: boolean; note?: string }>
  remark: string
  performedBy: string
  images: string[]
}

function PMExecutionDialog({
  target,
  onClose,
  onComplete,
}: {
  target: PMExecTarget | null
  onClose: () => void
  onComplete: (result: PMExecResult) => Promise<void>
}) {
  const [checklistResult, setChecklistResult] = React.useState<
    Array<{ id: string; label: string; done: boolean; note: string }>
  >([])
  const [remark, setRemark] = React.useState('')
  const [performedBy, setPerformedBy] = React.useState('')
  const [images, setImages] = React.useState<string[]>([])
  const [saving, setSaving] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Reset state when target changes
  React.useEffect(() => {
    if (target) {
      setChecklistResult(
        target.checklist.map((c) => ({
          id: c.id,
          label: c.label,
          done: false,
          note: '',
        })),
      )
      setRemark('')
      setImages([])
      setSaving(false)
    }
  }, [target])

  if (!target) return null

  // `target` is a mutable binding (a prop), so TypeScript cannot carry the
  // null-narrowing above into `handleSubmit` (a hoisted function declaration).
  // Capture the narrowed value in a local const so the submit handler can use
  // it without re-checking.
  const execTarget = target

  function toggleChecklist(idx: number) {
    setChecklistResult((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, done: !c.done } : c)),
    )
  }
  function updateNote(idx: number, note: string) {
    setChecklistResult((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, note } : c)),
    )
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files) return
    const newImages: string[] = []
    for (const file of Array.from(files)) {
      // Compress: resize to max 1280px, JPEG quality 0.7
      const dataUrl = await compressImage(file, 1280, 0.7)
      newImages.push(dataUrl)
    }
    setImages((prev) => [...prev, ...newImages])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function compressImage(file: File, maxSize: number, quality: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const img = new Image()
        img.onload = () => {
          let { width, height } = img
          if (width > height && width > maxSize) {
            height = Math.round((height * maxSize) / width)
            width = maxSize
          } else if (height > maxSize) {
            width = Math.round((width * maxSize) / height)
            height = maxSize
          }
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            reject(new Error('Canvas not supported'))
            return
          }
          ctx.drawImage(img, 0, 0, width, height)
          resolve(canvas.toDataURL('image/jpeg', quality))
        }
        img.onerror = reject
        img.src = e.target?.result as string
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function handleSubmit() {
    // Validate required checklist items
    const requiredMissing = execTarget.checklist.filter(
      (item) => item.required && !checklistResult.find((r) => r.id === item.id && r.done),
    )
    if (requiredMissing.length > 0) {
      toast.error(`StillDoitemrequiredNocomplete: ${requiredMissing.map((i) => i.label).join(', ')}`)
      return
    }
    setSaving(true)
    try {
      await onComplete({
        scheduleId: execTarget.scheduleId,
        scheduledDate: execTarget.scheduledDate,
        executionId: execTarget.executionId,
        checklistResult,
        remark,
        performedBy: performedBy.trim() || 'admin',
        images,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            Do PM
          </DialogTitle>
          <DialogDescription>
            {target.scheduleNo} — {target.title} · Set: {formatDate(target.scheduledDate)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Checklist */}
          {checklistResult.length > 0 && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-800 dark:bg-emerald-950/20">
              <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                itemCheck
              </Label>
              <div className="space-y-2">
                {checklistResult.map((item, idx) => {
                  const schedItem = target.checklist.find((c) => c.id === item.id)
                  const isRequired = schedItem?.required ?? false
                  return (
                    <div
                      key={item.id}
                      className={`rounded-md border bg-background p-2.5 transition ${
                        item.done
                          ? 'border-emerald-300 dark:border-emerald-700'
                          : 'border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => toggleChecklist(idx)}
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition ${
                            item.done
                              ? 'border-emerald-500 bg-emerald-500 text-white'
                              : 'border-slate-300 dark:border-slate-600'
                          }`}
                          aria-label={item.done ? 'CancelDo' : 'Doitem'}
                        >
                          {item.done && <CheckCircle2 className="h-3 w-3" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium">{item.label}</span>
                            {isRequired && (
                              <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[9px] text-rose-600 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
                                บังคับตรวจ
                              </Badge>
                            )}
                          </div>
                          {item.done && (
                            <Input
                              value={item.note}
                              onChange={(e) => updateNote(idx, e.target.value)}
                              placeholder="หมายเหตุ (ไม่บังคับ)"
                              className="mt-1.5 h-7 text-xs"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Performed by */}
          <div className="space-y-1.5">
            <Label htmlFor="pm-perf" className="text-xs">ผู้ปฏิบัติงาน (ชื่อ-นามสกุล)</Label>
            <Input
              id="pm-perf"
              value={performedBy}
              onChange={(e) => setPerformedBy(e.target.value)}
              placeholder="ชื่อผู้ปฏิบัติงาน PM"
              className="h-9 text-xs"
            />
          </div>

          {/* Images */}
          <div className="space-y-1.5">
            <Label className="text-xs">รูปภาพประกอบ (ไม่บังคับ)</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              className="hidden"
            />
            <div className="flex flex-wrap gap-2">
              {images.map((img, idx) => (
                <div key={idx} className="relative">
                  <img
                    src={img}
                    alt={`evidence-${idx}`}
                    className="h-20 w-20 rounded-md border object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((_, i) => i !== idx))}
                    className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white hover:bg-rose-600"
                    aria-label="Deleteimage"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-20 w-20 items-center justify-center rounded-md border-2 border-dashed border-slate-300 text-slate-400 transition hover:border-emerald-400 hover:text-emerald-500 dark:border-slate-700"
                aria-label="captureImageorSelectimage"
              >
                <Camera className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Remark */}
          <div className="space-y-1.5">
            <Label htmlFor="pm-remark" className="text-xs">Remark</Label>
            <Textarea
              id="pm-remark"
              rows={2}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="หมายเหตุ (ไม่บังคับ)"
              className="text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {saving ? (
              <><RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" /> กำลังบันทึก...</>
            ) : (
              <><Save className="mr-1 h-3.5 w-3.5" /> บันทึกผลการซ่อมบำรุง</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
