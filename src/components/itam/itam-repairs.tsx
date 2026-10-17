'use client'

/**
 * ItamRepairs — หน้า "แจ้งซ่อม / ซ่อมบำรุง"
 *
 * ผู้ใช้สามารถ:
 *   1. ดู KPI สรุปจำนวนงานซ่อมแยกตามสถานะ + ค่าซ่อมรวมเดือนนี้
 *   2. กรองรายการตามสถานะ / ประเภท / คำค้น (assetCode หรือ description)
 *   3. สร้างคำขอซ่อมใหม่ (เลือกอุปกรณ์จาก list, ระบุประเภท, อาการ, ร้านซ่อม, วันเริ่ม)
 *   4. คลิกแถวเพื่อดูรายละเอียดเต็ม + แก้ไขสถานะ / ค่าซ่อม / ผลการซ่อม
 *
 * API (มี interceptor แปะ Bearer token ให้ /api/itam/* อัตโนมัติ):
 *   - GET    /api/itam/maintenance             → { logs: [...] }
 *   - POST   /api/itam/maintenance             → create new log
 *   - PUT    /api/itam/maintenance/[id]        → update status / cost / resolvedNote / endDate
 *   - GET    /api/itam/devices?limit=100       → สำหรับค้นเลือกอุปกรณ์ในฟอร์ม
 */

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { matchesSuffixOrContains } from '@/lib/suffix-search'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useLang, getCurrentLang, localeFor } from '@/store/i18n-store'
import {
  Wrench,
  Plus,
  RefreshCw,
  Search,
  CheckCheck,
  Clock,
  Loader2,
  AlertCircle,
  Banknote,
  Pencil,
  Check,
  ChevronsUpDown,
  CalendarDays,
} from 'lucide-react'

// ── Types ───────────────────────────────────────────────────────────────

interface DeviceLite {
  id: string
  assetCode: string
  brand: string | null
  model: string | null
  type: string | null
  site: string | null
}

interface MaintenanceLog {
  id: string
  logId: string | null
  assetCode: string
  type: string // repair | maintenance | inspection | upgrade
  status: string // open | in_progress | completed | cancelled
  startDate: string | null
  endDate: string | null
  cost: number | null
  vendor: string | null
  description: string | null
  resolvedNote: string | null
  createdAt: string
  device?: {
    assetCode: string
    brand: string | null
    model: string | null
    site: string | null
  } | null
}

interface MaintenanceResponse {
  logs: MaintenanceLog[]
}

// ── Constants ───────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  repair: 'ซ่อมแซม',
  maintenance: 'บำรุงรักษา',
  inspection: 'ตรวจสอบ',
  upgrade: 'อัปเกรด',
}

const TYPE_BADGES: Record<string, string> = {
  repair: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800',
  maintenance: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800',
  inspection: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
  upgrade: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
}

const STATUS_LABELS: Record<string, string> = {
  open: 'เปิดงาน',
  in_progress: 'กำลังซ่อม',
  completed: 'เสร็จแล้ว',
  cancelled: 'ยกเลิก',
}

const STATUS_BADGES: Record<string, string> = {
  open: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
  in_progress: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800',
  completed: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
}

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'ทุกสถานะ' },
  { value: 'open', label: 'เปิดงาน' },
  { value: 'in_progress', label: 'กำลังซ่อม' },
  { value: 'completed', label: 'เสร็จแล้ว' },
  { value: 'cancelled', label: 'ยกเลิก' },
]

const TYPE_FILTER_OPTIONS = [
  { value: 'all', label: 'ทุกประเภท' },
  { value: 'repair', label: 'ซ่อมแซม' },
  { value: 'maintenance', label: 'บำรุงรักษา' },
  { value: 'inspection', label: 'ตรวจสอบ' },
  { value: 'upgrade', label: 'อัปเกรด' },
]

// ── Helpers ─────────────────────────────────────────────────────────────

function formatBaht(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  return '฿' + n.toLocaleString(localeFor(getCurrentLang()), { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    // Accept both ISO datetime and yyyy-mm-dd
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso)
    if (isNaN(d.getTime())) return iso
    return d.toLocaleDateString(localeFor(getCurrentLang()), { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

function todayISO(): string {
  // Local date in yyyy-mm-dd (avoid UTC drift)
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isThisMonth(iso: string | null | undefined): boolean {
  if (!iso) return false
  try {
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso)
    if (isNaN(d.getTime())) return false
    const now = new Date()
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  } catch (e) { console.error(String(e)); return false }
}

function truncate(s: string | null | undefined, n = 40): string {
  if (!s) return '—'
  return s.length > n ? s.slice(0, n) + '…' : s
}

// ── Component ───────────────────────────────────────────────────────────

export function ItamRepairs() {
  const { lang } = useLang()
  const qc = useQueryClient()

  // Filter state
  const [statusFilter, setStatusFilter] = React.useState('all')
  const [typeFilter, setTypeFilter] = React.useState('all')
  const [search, setSearch] = React.useState('')

  // Create dialog state
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createForm, setCreateForm] = React.useState({
    assetCode: '',
    type: 'repair',
    description: '',
    vendor: '',
    startDate: todayISO(),
  })
  const [devicePickerOpen, setDevicePickerOpen] = React.useState(false)

  // Detail dialog state
  const [detailLog, setDetailLog] = React.useState<MaintenanceLog | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [editMode, setEditMode] = React.useState(false)
  const [editForm, setEditForm] = React.useState({
    status: 'open',
    endDate: '',
    cost: '',
    resolvedNote: '',
  })

  // ── Queries ──────────────────────────────────────────────────────────

  // Devices for the create-form picker (limit 100 to keep payload small)
  const { data: devicesData } = useQuery<{ devices: DeviceLite[] }>({
    queryKey: ['itam-devices-picker', 'limit-100'],
    queryFn: async () => {
      const res = await fetch('/api/itam/devices?limit=100')
      if (!res.ok) throw new Error('Failed to load devices')
      return res.json()
    },
    enabled: createOpen,
    staleTime: 60_000,
  })
  const devices = devicesData?.devices ?? []

  // Maintenance logs list
  const queryKey = React.useMemo(
    () => ['itam-maintenance', statusFilter, typeFilter, search],
    [statusFilter, typeFilter, search],
  )
  const { data, isLoading, isFetching } = useQuery<MaintenanceResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch('/api/itam/maintenance')
      if (!res.ok) throw new Error('Failed to load maintenance logs')
      return res.json()
    },
    staleTime: 30_000,
  })

  const allLogs = data?.logs ?? []

  // ── Client-side filter (status/type/search) ──────────────────────────
  const filteredLogs = React.useMemo(() => {
    let arr = allLogs
    if (statusFilter !== 'all') arr = arr.filter((l) => l.status === statusFilter)
    if (typeFilter !== 'all') arr = arr.filter((l) => l.type === typeFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      // SUFFIX-AWARE (SEARCH-FIX): for short numeric queries, identifier
      // fields (assetCode, logId) match by SUFFIX (operators read the last
      // digits off a sticker/receipt). Free-text fields (description,
      // vendor) still use contains.
      arr = arr.filter(
        (l) =>
          matchesSuffixOrContains(l.assetCode, q) ||
          (l.description ?? '').toLowerCase().includes(q) ||
          matchesSuffixOrContains(l.logId, q) ||
          (l.vendor ?? '').toLowerCase().includes(q),
      )
    }
    return arr
  }, [allLogs, statusFilter, typeFilter, search])

  // ── KPI stats (computed client-side from allLogs) ────────────────────
  const stats = React.useMemo(() => {
    const open = allLogs.filter((l) => l.status === 'open').length
    const inProgress = allLogs.filter((l) => l.status === 'in_progress').length
    const completedThisMonth = allLogs.filter(
      (l) => l.status === 'completed' && isThisMonth(l.endDate ?? l.startDate ?? l.createdAt),
    ).length
    const costThisMonth = allLogs
      .filter(
        (l) =>
          l.status === 'completed' &&
          isThisMonth(l.endDate ?? l.startDate ?? l.createdAt) &&
          l.cost != null,
      )
      .reduce((sum, l) => sum + (l.cost ?? 0), 0)
    return { open, inProgress, completedThisMonth, costThisMonth }
  }, [allLogs])

  // ── Mutations ────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (input: typeof createForm) => {
      const res = await fetch('/api/itam/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetCode: input.assetCode,
          type: input.type,
          status: 'open',
          startDate: input.startDate,
          description: input.description.trim() || null,
          vendor: input.vendor.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'ไม่สามารถสร้างคำขอซ่อมได้')
      return json
    },
    onSuccess: () => {
      toast.success('สร้างคำขอซ่อมแล้ว')
      qc.invalidateQueries({ queryKey: ['itam-maintenance'] })
      setCreateOpen(false)
      setCreateForm({
        assetCode: '',
        type: 'repair',
        description: '',
        vendor: '',
        startDate: todayISO(),
      })
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const res = await fetch(`/api/itam/maintenance/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'ไม่สามารถอัปเดตได้')
      return json
    },
    onSuccess: () => {
      toast.success('อัปเดตสถานะแล้ว')
      qc.invalidateQueries({ queryKey: ['itam-maintenance'] })
      setEditMode(false)
      setDetailOpen(false)
      setDetailLog(null)
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    },
  })

  // ── Handlers ─────────────────────────────────────────────────────────

  function openDetail(log: MaintenanceLog) {
    setDetailLog(log)
    setEditForm({
      status: log.status,
      endDate: log.endDate ?? '',
      cost: log.cost != null ? String(log.cost) : '',
      resolvedNote: log.resolvedNote ?? '',
    })
    setEditMode(false)
    setDetailOpen(true)
  }

  function submitCreate() {
    if (!createForm.assetCode) {
      toast.error('กรุณาเลือกอุปกรณ์')
      return
    }
    if (!createForm.startDate) {
      toast.error('กรุณาระบุวันที่เริ่ม')
      return
    }
    createMutation.mutate(createForm)
  }

  function submitEdit() {
    if (!detailLog) return
    updateMutation.mutate({
      id: detailLog.id,
      body: {
        status: editForm.status,
        endDate: editForm.endDate || null,
        cost: editForm.cost === '' ? null : Number(editForm.cost),
        resolvedNote: editForm.resolvedNote.trim() || null,
      },
    })
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="flex h-full w-full flex-col gap-3 p-3 md:p-4">
      {/* Header */}
      <div className="flex flex-shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            🔧 แจ้งซ่อม / ซ่อมบำรุง
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            สร้างและติดตามคำขอซ่อมบำรุงอุปกรณ์
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => qc.invalidateQueries({ queryKey })}
            className="dark:bg-slate-800 dark:border-slate-700"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            รีเฟรช
          </Button>
          <Button onClick={() => setCreateOpen(true)} className="bg-[#f97316] hover:bg-[#ea580c]">
            <Plus className="h-4 w-4" /> แจ้งซ่อมใหม่
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid flex-shrink-0 grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-4 w-4" />
              <span className="text-xs font-medium">เปิดงาน</span>
            </div>
            <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">
              {isLoading ? <Skeleton className="h-7 w-12" /> : stats.open.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400">
              <Clock className="h-4 w-4" />
              <span className="text-xs font-medium">กำลังซ่อม</span>
            </div>
            <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">
              {isLoading ? <Skeleton className="h-7 w-12" /> : stats.inProgress.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <CheckCheck className="h-4 w-4" />
              <span className="text-xs font-medium">เสร็จแล้ว (เดือนนี้)</span>
            </div>
            <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">
              {isLoading ? <Skeleton className="h-7 w-12" /> : stats.completedThisMonth.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-[#f97316]">
              <Banknote className="h-4 w-4" />
              <span className="text-xs font-medium">ค่าซ่อมรวม (เดือนนี้)</span>
            </div>
            <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">
              {isLoading ? <Skeleton className="h-7 w-24" /> : formatBaht(stats.costThisMonth)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter bar */}
      <div className="flex flex-shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-44 dark:bg-slate-800 dark:border-slate-700">
            <SelectValue placeholder="สถานะ" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-44 dark:bg-slate-800 dark:border-slate-700">
            <SelectValue placeholder="ประเภท" />
          </SelectTrigger>
          <SelectContent>
            {TYPE_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="ค้นหาด้วยรหัสอุปกรณ์ / คำอธิบาย / เลขที่..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 dark:bg-slate-800 dark:border-slate-700"
          />
        </div>
      </div>

      {/* Table */}
      <Card className="flex min-h-0 flex-1 flex-col border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="min-h-0 flex-1 p-0">
          <div className="itam-scroll h-full overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                <TableRow>
                  <TableHead className="w-28">เลขที่</TableHead>
                  <TableHead className="w-auto">รหัสอุปกรณ์</TableHead>
                  <TableHead className="w-24">ประเภท</TableHead>
                  <TableHead className="w-28">สถานะ</TableHead>
                  <TableHead className="w-32">วันที่เริ่ม</TableHead>
                  <TableHead className="w-32">วันที่เสร็จ</TableHead>
                  <TableHead className="w-28 text-right">ค่าซ่อม</TableHead>
                  <TableHead className="w-32">ร้านซ่อม</TableHead>
                  <TableHead className="w-auto">คำอธิบาย</TableHead>
                  <TableHead className="w-20 text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell colSpan={10}><Skeleton className="h-7 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : filteredLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-14">
                      <div className="flex flex-col items-center gap-3 text-slate-400 dark:text-slate-500">
                        <Wrench className="h-12 w-12" />
                        <div className="text-sm font-medium">ยังไม่มีคำขอซ่อม</div>
                        <Button
                          size="sm"
                          onClick={() => setCreateOpen(true)}
                          className="bg-[#f97316] hover:bg-[#ea580c]"
                        >
                          <Plus className="h-4 w-4" /> แจ้งซ่อมใหม่
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLogs.map((log) => (
                    <TableRow
                      key={log.id}
                      onClick={() => openDetail(log)}
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-300">
                        {log.logId ?? '—'}
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                          {log.assetCode}
                        </div>
                        {(log.device?.brand || log.device?.model) && (
                          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {[log.device?.brand, log.device?.model].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={TYPE_BADGES[log.type] || 'bg-slate-100 text-slate-600'}>
                          {TYPE_LABELS[log.type] || log.type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={STATUS_BADGES[log.status] || 'bg-slate-100 text-slate-600'}>
                          {STATUS_LABELS[log.status] || log.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                        {formatDate(log.startDate)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                        {formatDate(log.endDate)}
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono text-slate-700 dark:text-slate-200">
                        {formatBaht(log.cost)}
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate text-xs text-slate-600 dark:text-slate-300" title={log.vendor ?? ''}>
                        {log.vendor ?? '—'}
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate text-xs text-slate-500 dark:text-slate-400" title={log.description ?? ''}>
                        {truncate(log.description)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation()
                            openDetail(log)
                          }}
                          className="h-7 px-2 text-slate-500 hover:text-[#f97316]"
                          aria-label="ดูรายละเอียด"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Footer summary */}
      {filteredLogs.length > 0 && (
        <div className="text-xs text-slate-500 dark:text-slate-400">
          แสดง {filteredLogs.length.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} รายการ
          {filteredLogs.length !== allLogs.length && (
            <span className="ml-1">จากทั้งหมด {allLogs.length.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} รายการ</span>
          )}
        </div>
      )}

      {/* ── Create Dialog ─────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle>🔧 แจ้งซ่อมใหม่</DialogTitle>
            <DialogDescription>กรอกข้อมูลอุปกรณ์และอาการที่ต้องการซ่อม</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Asset picker (searchable) */}
            <div className="space-y-1.5">
              <Label>อุปกรณ์ <span className="text-rose-500">*</span></Label>
              <Popover open={devicePickerOpen} onOpenChange={setDevicePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal dark:bg-slate-800 dark:border-slate-700"
                  >
                    {createForm.assetCode ? (
                      <span className="flex items-center gap-2 truncate">
                        <span className="font-mono text-xs">{createForm.assetCode}</span>
                        {(() => {
                          const d = devices.find((x) => x.assetCode === createForm.assetCode)
                          if (!d) return null
                          return (
                            <span className="truncate text-xs text-slate-500">
                              {[d.brand, d.model].filter(Boolean).join(' · ')}
                            </span>
                          )
                        })()}
                      </span>
                    ) : (
                      <span className="text-slate-400">เลือกอุปกรณ์...</span>
                    )}
                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0 dark:border-slate-700 dark:bg-slate-900" align="start">
                  <Command>
                    <CommandInput placeholder="ค้นหา asset no / brand / model..." />
                    <CommandList className="itam-scroll max-h-72">
                      <CommandEmpty>ไม่พบอุปกรณ์</CommandEmpty>
                      <CommandGroup>
                        {devices.map((d) => (
                          <CommandItem
                            key={d.id}
                            value={`${d.assetCode} ${d.brand ?? ''} ${d.model ?? ''}`}
                            onSelect={() => {
                              setCreateForm((f) => ({ ...f, assetCode: d.assetCode }))
                              setDevicePickerOpen(false)
                            }}
                            className="hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Check
                              className={`mr-2 h-3.5 w-3.5 ${
                                createForm.assetCode === d.assetCode ? 'opacity-100' : 'opacity-0'
                              }`}
                            />
                            <div className="flex flex-1 items-center gap-2 truncate">
                              <span className="font-mono text-xs font-semibold">{d.assetCode}</span>
                              <span className="truncate text-xs text-slate-500">
                                {[d.brand, d.model].filter(Boolean).join(' · ')}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Type */}
            <div className="space-y-1.5">
              <Label>ประเภท <span className="text-rose-500">*</span></Label>
              <Select value={createForm.type} onValueChange={(v) => setCreateForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger className="w-full dark:bg-slate-800 dark:border-slate-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="repair">ซ่อมแซม</SelectItem>
                  <SelectItem value="maintenance">บำรุงรักษา</SelectItem>
                  <SelectItem value="inspection">ตรวจสอบ</SelectItem>
                  <SelectItem value="upgrade">อัปเกรด</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="rep-desc">อาการ / งานที่ต้องการ</Label>
              <Textarea
                id="rep-desc"
                rows={3}
                placeholder="อธิบายอาการหรืองานที่ต้องการให้ทำ..."
                value={createForm.description}
                onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>

            {/* Vendor */}
            <div className="space-y-1.5">
              <Label htmlFor="rep-vendor">ร้านซ่อม / ผู้ให้บริการ</Label>
              <Input
                id="rep-vendor"
                placeholder="(ไม่บังคับ) เช่น บจก. ซ่อมพิมพ์..."
                value={createForm.vendor}
                onChange={(e) => setCreateForm((f) => ({ ...f, vendor: e.target.value }))}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>

            {/* Start date */}
            <div className="space-y-1.5">
              <Label htmlFor="rep-start" className="flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" /> วันที่เริ่ม <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="rep-start"
                type="date"
                value={createForm.startDate}
                onChange={(e) => setCreateForm((f) => ({ ...f, startDate: e.target.value }))}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              ยกเลิก
            </Button>
            <Button
              onClick={submitCreate}
              disabled={createMutation.isPending || !createForm.assetCode}
              className="bg-[#f97316] hover:bg-[#ea580c]"
            >
              {createMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> กำลังบันทึก...</>
              ) : (
                <><Plus className="h-4 w-4" /> สร้างคำขอ</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Detail Dialog ─────────────────────────────────────────────── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-2xl dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle>รายละเอียดคำขอซ่อม</DialogTitle>
            <DialogDescription>
              {detailLog?.logId && <span className="font-mono">{detailLog.logId}</span>}
            </DialogDescription>
          </DialogHeader>

          {detailLog && (
            <div className="space-y-4">
              {/* Top summary row */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
                  <div className="text-[10px] uppercase text-slate-400">ประเภท</div>
                  <Badge className={TYPE_BADGES[detailLog.type] || 'bg-slate-100'} variant="outline">
                    {TYPE_LABELS[detailLog.type] || detailLog.type}
                  </Badge>
                </div>
                <div className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
                  <div className="text-[10px] uppercase text-slate-400">สถานะ</div>
                  {editMode ? (
                    <Select
                      value={editForm.status}
                      onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}
                    >
                      <SelectTrigger className="h-7 w-full text-xs dark:bg-slate-800 dark:border-slate-700">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">เปิดงาน</SelectItem>
                        <SelectItem value="in_progress">กำลังซ่อม</SelectItem>
                        <SelectItem value="completed">เสร็จแล้ว</SelectItem>
                        <SelectItem value="cancelled">ยกเลิก</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge className={STATUS_BADGES[detailLog.status] || 'bg-slate-100'} variant="outline">
                      {STATUS_LABELS[detailLog.status] || detailLog.status}
                    </Badge>
                  )}
                </div>
                <div className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
                  <div className="text-[10px] uppercase text-slate-400">วันที่เริ่ม</div>
                  <div className="text-xs text-slate-700 dark:text-slate-200">
                    {formatDate(detailLog.startDate)}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
                  <div className="text-[10px] uppercase text-slate-400">วันที่เสร็จ</div>
                  {editMode ? (
                    <Input
                      type="date"
                      value={editForm.endDate}
                      onChange={(e) => setEditForm((f) => ({ ...f, endDate: e.target.value }))}
                      className="h-7 w-full text-xs dark:bg-slate-800 dark:border-slate-700"
                    />
                  ) : (
                    <div className="text-xs text-slate-700 dark:text-slate-200">
                      {formatDate(detailLog.endDate)}
                    </div>
                  )}
                </div>
              </div>

              {/* Device info */}
              <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                <div className="text-[10px] uppercase text-slate-400">อุปกรณ์</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {detailLog.assetCode}
                  </span>
                  {(detailLog.device?.brand || detailLog.device?.model) && (
                    <span className="text-sm text-slate-500 dark:text-slate-400">
                      {[detailLog.device?.brand, detailLog.device?.model].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>
                {detailLog.device?.site && (
                  <div className="mt-0.5 text-xs text-slate-400">สาขา: {detailLog.device.site}</div>
                )}
              </div>

              {/* Description */}
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">อาการ / งานที่ต้องการ</Label>
                <div className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {detailLog.description || '—'}
                </div>
              </div>

              {/* Vendor + Cost */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">ร้านซ่อม / ผู้ให้บริการ</Label>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {detailLog.vendor || '—'}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">ค่าซ่อม (฿)</Label>
                  {editMode ? (
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={editForm.cost}
                      onChange={(e) => setEditForm((f) => ({ ...f, cost: e.target.value }))}
                      className="dark:bg-slate-800 dark:border-slate-700"
                    />
                  ) : (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-2 font-mono text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {formatBaht(detailLog.cost)}
                    </div>
                  )}
                </div>
              </div>

              {/* Resolved note */}
              <div className="space-y-1">
                <Label htmlFor="rep-resolved" className="text-xs text-slate-500">ผลการซ่อม / หมายเหตุ</Label>
                {editMode ? (
                  <Textarea
                    id="rep-resolved"
                    rows={3}
                    placeholder="บันทึกผลการซ่อมเมื่อเสร็จงาน..."
                    value={editForm.resolvedNote}
                    onChange={(e) => setEditForm((f) => ({ ...f, resolvedNote: e.target.value }))}
                    className="dark:bg-slate-800 dark:border-slate-700"
                  />
                ) : (
                  <div className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {detailLog.resolvedNote || '—'}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            {detailLog && !editMode ? (
              <>
                <Button variant="outline" onClick={() => setDetailOpen(false)}>ปิด</Button>
                <Button onClick={() => setEditMode(true)} className="bg-[#f97316] hover:bg-[#ea580c]">
                  <Pencil className="h-4 w-4" /> แก้ไขสถานะ
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setEditMode(false)} disabled={updateMutation.isPending}>
                  ยกเลิก
                </Button>
                <Button
                  onClick={submitEdit}
                  disabled={updateMutation.isPending}
                  className="bg-[#f97316] hover:bg-[#ea580c]"
                >
                  {updateMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> กำลังบันทึก...</>
                  ) : (
                    <><Check className="h-4 w-4" /> บันทึก</>
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
