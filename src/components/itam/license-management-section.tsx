'use client'

/**
 * LicenseManagementSection — overview + management UI for ALL LicenseRecord
 * rows in the system (Task ID: LICENSE-PAGE-PLUS-QUICK-ADD, Task A).
 *
 * Features:
 *   - Table with all licenses (paginated).
 *   - Columns: Software, License ID, Device (assetCode + name), Type,
 *     Expiry Date (color-coded), Status (active/inactive), Quantity.
 *   - Filters: site, expiry status, software name search box.
 *   - Per-row actions: Edit, Delete.
 *   - "เพิ่ม License" button → opens dialog with a device picker.
 *   - Export CSV button (reuses /api/licenses/export).
 *
 * API:
 *   - GET  /api/licenses?site=CODE&expiring=30  → { data: LicenseRow[] }
 *   - GET  /api/licenses/export?site=NAME&software=...  → CSV file
 *   - POST /api/devices/[id]/licenses            → create license on a device
 *   - PUT  /api/devices/[id]/licenses?licenseId= → update a license
 *   - DEL  /api/devices/[id]/licenses?licenseId= → delete a license
 *
 * Color coding (per spec):
 *   • red   — expires within 30 days OR already expired
 *   • amber — expires within 60 days
 *   • green — expires in more than 60 days (or no expiry set)
 *
 * NOTE on site filtering:
 *   The Device.site column stores the Thai site NAME (e.g. "สำนักงานใหญ่"),
 *   not the site CODE (e.g. "UDH"). The /api/licenses endpoint resolves
 *   site-code → site-name server-side, so the dropdown sends the code and
 *   the API handles the lookup. The CSV export endpoint (/api/licenses/export)
 *   expects the site NAME directly (pre-existing behavior), so when
 *   exporting we map the selected site code → name client-side before
 *   appending the query param.
 */

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  KeyRound,
  Plus,
  Search,
  Download,
  RefreshCw,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  X,
  CheckCircle2,
  AlertTriangle,
  ChevronsUpDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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
import { PaginationBar } from './pagination-bar'
import { type Site, formatThaiDate } from './types'
import { useAuthStore } from '@/store/auth-store'

/** Build fetch headers with the user's JWT (if logged in). */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const t = useAuthStore.getState()?.token
  if (t) h['Authorization'] = `Bearer ${t}`
  return h
}

// ── Types ──────────────────────────────────────────────────────────────

interface DeviceBrief {
  id: string
  assetCode: string
  name: string
  site: string
}

interface LicenseRow {
  id: string
  licenseId: string | null
  assetCode: string | null
  software: string
  licenseType: string | null
  licenseKey: string | null
  quantity: number
  expiryDate: string | null
  remark: string | null
  isActive: boolean
  deviceId: string | null
  device: DeviceBrief | null
  createdAt: string
  updatedAt: string
}

interface DevicePickItem {
  id: string
  assetCode: string
  name: string
  site: string
}

// ── Constants ──────────────────────────────────────────────────────────

const PAGE_SIZE_DEFAULT = 20
const PAGE_SIZE_OPTIONS = [20, 50, 100]

const LICENSE_TYPE_OPTIONS = [
  { value: 'OEM', label: 'OEM' },
  { value: 'Volume', label: 'Volume' },
  { value: 'Retail', label: 'Retail' },
  { value: 'Subscription', label: 'Subscription' },
  { value: 'Open License', label: 'Open License' },
]

type ExpiryFilter = 'all' | 'expired' | '30' | '60'

const EXPIRY_FILTER_OPTIONS: { value: ExpiryFilter; label: string }[] = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'expired', label: 'หมดอายุแล้ว' },
  { value: '30', label: 'ภายใน 30 วัน' },
  { value: '60', label: 'ภายใน 60 วัน' },
]

// ── Helpers ────────────────────────────────────────────────────────────

/** Days from today until an ISO date (negative if past). Returns null on invalid. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  try {
    const d = new Date(iso.slice(0, 10) + 'T00:00:00')
    if (Number.isNaN(d.getTime())) return null
    const now = new Date()
    const today = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    )
    const diff = d.getTime() - today.getTime()
    return Math.round(diff / (1000 * 60 * 60 * 24))
  } catch {
    return null
  }
}

/** Mask a license key, keeping the last 4 chars visible. */
function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 4) return '••••'
  return '•'.repeat(Math.min(key.length - 4, 16)) + key.slice(-4)
}

/**
 * Expiry color tone (border + text + badge bg).
 *   red   — expired OR within 30 days
 *   amber — within 60 days
 *   green — more than 60 days (or no expiry set)
 */
type ExpiryTone = 'red' | 'amber' | 'green' | 'neutral'

function expiryTone(iso: string | null): ExpiryTone {
  const days = daysUntil(iso)
  if (days === null) return 'neutral'
  if (days < 0) return 'red'
  if (days < 30) return 'red'
  if (days < 60) return 'amber'
  return 'green'
}

const TONE_BADGE: Record<ExpiryTone, string> = {
  red: 'border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300',
  amber:
    'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
  green:
    'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  neutral:
    'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400',
}

const TONE_DOT: Record<ExpiryTone, string> = {
  red: 'bg-rose-500',
  amber: 'bg-amber-500',
  green: 'bg-emerald-500',
  neutral: 'bg-slate-300',
}

// ── Component ──────────────────────────────────────────────────────────

export function LicenseManagementSection() {
  const qc = useQueryClient()

  // ── Filters state ──
  const [search, setSearch] = React.useState('')
  const [siteFilter, setSiteFilter] = React.useState<string>('all')
  const [expiryFilter, setExpiryFilter] = React.useState<ExpiryFilter>('all')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(PAGE_SIZE_DEFAULT)
  const [onlyActive, setOnlyActive] = React.useState(false)

  // ── Add/Edit dialog state ──
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editingDeviceId, setEditingDeviceId] = React.useState<string | null>(
    null,
  )
  const [lcSoftware, setLcSoftware] = React.useState('')
  const [lcLicenseId, setLcLicenseId] = React.useState('')
  const [lcLicenseType, setLcLicenseType] = React.useState('')
  const [lcLicenseKey, setLcLicenseKey] = React.useState('')
  const [lcQuantity, setLcQuantity] = React.useState('1')
  const [lcExpiryDate, setLcExpiryDate] = React.useState('')
  const [lcRemark, setLcRemark] = React.useState('')
  const [lcDeviceId, setLcDeviceId] = React.useState<string>('')
  const [lcDeviceLabel, setLcDeviceLabel] = React.useState<string>('')
  const [saving, setSaving] = React.useState(false)

  // ── Delete confirmation ──
  const [deleteTarget, setDeleteTarget] = React.useState<LicenseRow | null>(
    null,
  )

  // ── Revealed license keys (per-row reveal toggle) ──
  const [revealedKeys, setRevealedKeys] = React.useState<
    Record<string, boolean>
  >({})

  // ── Sites ─────────────────────────────────────────────────────────
  // Loaded from /api/sites — gives us code + Thai name. Used both for the
  // filter dropdown AND for resolving site code → name when exporting CSV
  // (the export endpoint expects the Thai name).
  const { data: sites } = useQuery<Site[]>({
    queryKey: ['sites'],
    queryFn: async () => {
      const res = await fetch('/api/sites', { headers: authHeaders() })
      if (!res.ok) return []
      const json = (await res.json()) as { sites: Site[] }
      return json.sites ?? []
    },
  })

  // Map site code → Thai name (for CSV export param).
  const siteNameByCode = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const s of sites ?? []) m.set(s.code, s.name)
    return m
  }, [sites])

  // ── Licenses ──────────────────────────────────────────────────────
  // The /api/licenses endpoint resolves site code → device.site (Thai name)
  // server-side, so we can pass the raw site code in the `site` param.
  // For the expiring filter, the spec defines three buckets: expired (past),
  // 30 days, 60 days. We use a single `expiring=N` query param for the
  // upcoming-N-days case, and client-side post-filter for "expired".
  const expiringParam = expiryFilter === '30' || expiryFilter === '60'
    ? expiryFilter
    : null

  const { data: licenseData, isLoading: licensesLoading } = useQuery<{
    data: LicenseRow[]
  }>({
    queryKey: [
      'licenses-overview',
      siteFilter,
      expiringParam,
      onlyActive,
    ],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (siteFilter !== 'all') params.set('site', siteFilter)
      if (expiringParam) params.set('expiring', expiringParam)
      // Note: we don't push onlyActive here because the API doesn't support
      //       it directly — we filter client-side instead (the spec didn't
      //       call for an API param). The dataset is bounded by `expiring`
      //       + `site` so client filtering is fine.
      const url = `/api/licenses${params.toString() ? `?${params.toString()}` : ''}`
      const res = await fetch(url, { headers: authHeaders() })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'โหลดรายการ License ไม่สำเร็จ')
      }
      return (await res.json()) as { data: LicenseRow[] }
    },
  })

  // ── Client-side filtering ──
  // Apply the search box + onlyActive + "expired" filter on top of the API
  // response. The API already handles `site` and `expiring` (when given).
  const allLicenses = licenseData?.data ?? []

  const filteredLicenses = React.useMemo(() => {
    let list = allLicenses

    // Search box — match against software, licenseId, or asset code.
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((l) => {
        const haystacks = [
          l.software,
          l.licenseId ?? '',
          l.assetCode ?? '',
          l.device?.assetCode ?? '',
          l.device?.name ?? '',
          l.licenseKey ?? '',
        ]
        return haystacks.some((h) => h.toLowerCase().includes(q))
      })
    }

    // onlyActive filter
    if (onlyActive) {
      list = list.filter((l) => l.isActive)
    }

    // "expired" bucket (past expiry date) — only applied when the user
    // explicitly picks this filter. The "30" and "60" buckets are handled
    // server-side via the `expiring` param.
    if (expiryFilter === 'expired') {
      list = list.filter((l) => {
        const d = daysUntil(l.expiryDate)
        return d !== null && d < 0
      })
    }

    return list
  }, [allLicenses, search, onlyActive, expiryFilter])

  // ── Pagination ──
  const total = filteredLicenses.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)
  const paged = React.useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredLicenses.slice(start, start + pageSize)
  }, [filteredLicenses, safePage, pageSize])

  // Wrap filter setters so they ALSO reset page → 1. Doing this inline in
  // the event handler (rather than in a useEffect) avoids the
  // `react-hooks/set-state-in-effect` warning AND keeps the re-render
  // count low (both state updates are batched into a single render).
  const onSearchChange = (v: string) => {
    setSearch(v)
    setPage(1)
  }
  const onSiteChange = (v: string) => {
    setSiteFilter(v)
    setPage(1)
  }
  const onExpiryChange = (v: ExpiryFilter) => {
    setExpiryFilter(v)
    setPage(1)
  }
  const onOnlyActiveChange = (v: boolean) => {
    setOnlyActive(v)
    setPage(1)
  }
  const onPageSizeChange = (n: number) => {
    setPageSize(n)
    setPage(1)
  }

  // ── Device picker (for the "เพิ่ม License" dialog) ──
  // The /api/devices endpoint requires VIEW_DEVICES — anyone with
  // VIEW_DASHBOARD usually also has VIEW_DEVICES (the role defaults grant
  // both together). We do a debounced search by asset code / name.
  const [deviceQuery, setDeviceQuery] = React.useState('')
  const [deviceResults, setDeviceResults] = React.useState<DevicePickItem[]>(
    [],
  )
  const [deviceSearching, setDeviceSearching] = React.useState(false)
  const deviceSearchRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  const searchDevices = React.useCallback((q: string) => {
    if (deviceSearchRef.current) clearTimeout(deviceSearchRef.current)
    const trimmed = q.trim()
    if (!trimmed) {
      setDeviceResults([])
      return
    }
    deviceSearchRef.current = setTimeout(async () => {
      setDeviceSearching(true)
      try {
        const url = `/api/devices?search=${encodeURIComponent(trimmed)}&limit=20`
        const res = await fetch(url, { headers: authHeaders() })
        if (!res.ok) {
          setDeviceResults([])
          return
        }
        const j = (await res.json()) as {
          devices?: Array<{
            id: string
            assetCode: string
            name: string
            site: string
          }>
        }
        setDeviceResults(j.devices ?? [])
      } catch {
        setDeviceResults([])
      } finally {
        setDeviceSearching(false)
      }
    }, 250)
  }, [])

  function pickDevice(d: DevicePickItem) {
    setLcDeviceId(d.id)
    setLcDeviceLabel(`${d.assetCode} — ${d.name}`)
    setDeviceResults([])
    setDeviceQuery('')
  }

  // ── Dialog open/close ──
  function openAddDialog() {
    setEditingId(null)
    setEditingDeviceId(null)
    setLcSoftware('')
    setLcLicenseId('')
    setLcLicenseType('')
    setLcLicenseKey('')
    setLcQuantity('1')
    setLcExpiryDate('')
    setLcRemark('')
    setLcDeviceId('')
    setLcDeviceLabel('')
    setDeviceQuery('')
    setDeviceResults([])
    setDialogOpen(true)
  }

  function openEditDialog(l: LicenseRow) {
    setEditingId(l.id)
    setEditingDeviceId(l.deviceId)
    setLcSoftware(l.software)
    setLcLicenseId(l.licenseId ?? '')
    setLcLicenseType(l.licenseType ?? '')
    setLcLicenseKey(l.licenseKey ?? '')
    setLcQuantity(String(l.quantity ?? 1))
    setLcExpiryDate(l.expiryDate ?? '')
    setLcRemark(l.remark ?? '')
    setLcDeviceId(l.deviceId ?? '')
    setLcDeviceLabel(
      l.device ? `${l.device.assetCode} — ${l.device.name}` : '',
    )
    setDeviceQuery('')
    setDeviceResults([])
    setDialogOpen(true)
  }

  function closeDialog() {
    if (saving) return
    setDialogOpen(false)
  }

  // ── Save (POST or PUT) ──
  async function saveLicense() {
    // The "เพิ่ม License" flow requires a device — without one we have
    // nowhere to attach the license (the existing /api/devices/[id]/licenses
    // endpoint is the canonical create path).
    const targetDeviceId = editingId ? editingDeviceId : lcDeviceId
    if (!targetDeviceId) {
      toast.error('กรุณาเลือกอุปกรณ์ที่จะผูก License ด้วย')
      return
    }
    if (!lcSoftware.trim()) {
      toast.error('กรุณากรอกชื่อซอฟต์แวร์')
      return
    }
    try {
      setSaving(true)
      const payload = {
        software: lcSoftware.trim(),
        licenseId: lcLicenseId || null,
        licenseType: lcLicenseType || null,
        licenseKey: lcLicenseKey || null,
        quantity: Number(lcQuantity) || 1,
        expiryDate: lcExpiryDate || null,
        remark: lcRemark || null,
      }
      const isEditing = !!editingId
      const url = isEditing
        ? `/api/devices/${targetDeviceId}/licenses?licenseId=${encodeURIComponent(editingId!)}`
        : `/api/devices/${targetDeviceId}/licenses`
      const res = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Save failed')
      }
      toast.success(isEditing ? 'อัปเดต License แล้ว' : 'เพิ่ม License แล้ว')
      setDialogOpen(false)
      setEditingId(null)
      await qc.invalidateQueries({ queryKey: ['licenses-overview'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ──
  async function confirmDelete() {
    if (!deleteTarget) return
    const target = deleteTarget
    // Use the legacy Asset_No-based path when deviceId is null but we have
    // an Asset_No. Fall back to the FK-based delete when deviceId is set.
    const deviceId = target.deviceId
    if (!deviceId) {
      // No device FK — can't call /api/devices/[id]/licenses. Surface as
      // an error (the migration script backfills deviceId for legacy rows).
      toast.error(
        'ไม่สามารถลบ License นี้ได้ — ไม่พบอุปกรณ์ที่ผูกอยู่ (deviceId is null)',
      )
      setDeleteTarget(null)
      return
    }
    try {
      const res = await fetch(
        `/api/devices/${deviceId}/licenses?licenseId=${encodeURIComponent(target.id)}`,
        { method: 'DELETE', headers: authHeaders() },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Delete failed')
      }
      toast.success('ลบ License แล้ว')
      await qc.invalidateQueries({ queryKey: ['licenses-overview'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleteTarget(null)
    }
  }

  // ── Export CSV ──
  function exportCsv() {
    const params = new URLSearchParams()
    if (siteFilter !== 'all') {
      // Export endpoint expects the Thai site NAME (Device.site stores the
      // name, not the code) — resolve client-side.
      const name = siteNameByCode.get(siteFilter)
      if (name) params.set('site', name)
    }
    if (onlyActive) params.set('isActive', 'true')
    if (search.trim()) {
      // The export endpoint accepts `software` substring search.
      params.set('software', search.trim())
    }
    const qs = params.toString()
    const url = `/api/licenses/export${qs ? `?${qs}` : ''}`
    // Bearer token can't be sent in headers for window.open — fall back to
    // the `t` query param the auth-middleware supports (extractBearer).
    const token = useAuthStore.getState()?.token
    const finalUrl = token
      ? `${url}${qs ? '&' : '?'}t=${encodeURIComponent(token)}`
      : url
    window.open(finalUrl, '_blank')
  }

  // ── Render ──
  return (
    <div className="space-y-4">
      {/* ── Header row ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
            <KeyRound className="h-5 w-5 text-[#0d9488]" />
            ลิขสิทธิ์ซอฟต์แวร์
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            ภาพรวม License ทั้งหมดในระบบ · ตรวจสอบใกล้หมดอายุ · แก้ไข/ลบ
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              qc.invalidateQueries({ queryKey: ['licenses-overview'] })
            }
            className="dark:bg-slate-800 dark:border-slate-700"
            title="โหลดใหม่"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            className="dark:bg-slate-800 dark:border-slate-700"
            title="ส่งออก CSV"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Export CSV</span>
          </Button>
          <Button
            size="sm"
            onClick={openAddDialog}
            className="bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
          >
            <Plus className="h-4 w-4" />
            เพิ่ม License
          </Button>
        </div>
      </div>

      {/* ── Filters row ── */}
      <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 lg:flex-row lg:items-end">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="ค้นหา Software, License ID, รหัสอุปกรณ์…"
            className="pl-8 dark:bg-slate-800 dark:border-slate-700"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex">
          <Select
            value={siteFilter}
            onValueChange={(v) => onSiteChange(v)}
          >
            <SelectTrigger className="w-full lg:w-44 dark:bg-slate-800 dark:border-slate-700">
              <SelectValue placeholder="สาขา" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุกสาขา</SelectItem>
              {(sites ?? []).map((s) => (
                <SelectItem key={s.code} value={s.code}>
                  {s.code} — {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={expiryFilter}
            onValueChange={(v) => onExpiryChange(v as ExpiryFilter)}
          >
            <SelectTrigger className="w-full lg:w-44 dark:bg-slate-800 dark:border-slate-700">
              <SelectValue placeholder="สถานะใกล้หมดอายุ" />
            </SelectTrigger>
            <SelectContent>
              {EXPIRY_FILTER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 lg:w-44">
            <Switch
              checked={onlyActive}
              onCheckedChange={onOnlyActiveChange}
              aria-label="แสดงเฉพาะ active"
            />
            <span>เฉพาะ active</span>
          </div>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1">
          <span className={`h-2 w-2 rounded-full ${TONE_DOT.red}`} />
          หมดอายุหรือใกล้หมด (≤ 30 วัน)
        </span>
        <span className="flex items-center gap-1">
          <span className={`h-2 w-2 rounded-full ${TONE_DOT.amber}`} />
          ใกล้หมด (31-60 วัน)
        </span>
        <span className="flex items-center gap-1">
          <span className={`h-2 w-2 rounded-full ${TONE_DOT.green}`} />
          ปกติ (&gt; 60 วัน)
        </span>
      </div>

      {/* ── Table ── */}
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="itam-scroll max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur dark:bg-slate-900/95">
              <TableRow>
                <TableHead className="w-auto">Software</TableHead>
                <TableHead className="w-auto">License ID</TableHead>
                <TableHead className="w-auto">อุปกรณ์</TableHead>
                <TableHead className="w-auto">ประเภท</TableHead>
                <TableHead className="w-auto">วันหมดอายุ</TableHead>
                <TableHead className="min-w-[110px] text-center">สถานะ</TableHead>
                <TableHead className="min-w-[80px] text-center">จำนวน</TableHead>
                <TableHead className="min-w-[110px] text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {licensesLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-12 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-6 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-12 text-center text-sm text-slate-400 dark:text-slate-500"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <KeyRound className="h-8 w-8 text-slate-300 dark:text-slate-400" />
                      <span className="font-medium text-slate-500 dark:text-slate-400">
                        ไม่พบ License ที่ตรงกับเงื่อนไข
                      </span>
                      <span className="text-xs">
                        ลองเปลี่ยนตัวกรอง หรือกดปุ่ม &quot;เพิ่ม License&quot; ด้านบน
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <>
                {paged.map((l) => {
                  const tone = expiryTone(l.expiryDate)
                  const days = daysUntil(l.expiryDate)
                  const revealed = !!revealedKeys[l.id]
                  return (
                    <TableRow
                      key={l.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                              {l.software}
                            </span>
                            {l.licenseKey && (
                              <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                <span className="text-[10px] uppercase text-slate-400">
                                  Key:
                                </span>
                                <span className="break-all">
                                  {revealed ? l.licenseKey : maskKey(l.licenseKey)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRevealedKeys((prev) => ({
                                      ...prev,
                                      [l.id]: !prev[l.id],
                                    }))
                                  }
                                  aria-label={revealed ? 'ซ่อน Key' : 'แสดง Key'}
                                  title={revealed ? 'ซ่อน Key' : 'แสดง Key'}
                                  className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                                >
                                  {revealed ? (
                                    <EyeOff className="h-3 w-3" />
                                  ) : (
                                    <Eye className="h-3 w-3" />
                                  )}
                                </button>
                              </div>
                            )}
                            {l.remark && (
                              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                                {l.remark}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-500 dark:text-slate-400">
                          {l.licenseId || '—'}
                        </TableCell>
                        <TableCell>
                          {l.device ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="font-mono text-xs font-medium text-slate-700 dark:text-slate-200">
                                {l.device.assetCode}
                              </span>
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {l.device.name}
                              </span>
                              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                สาขา: {l.device.site || '—'}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 dark:text-slate-500">
                              ไม่ผูกอุปกรณ์
                              {l.assetCode ? (
                                <span className="block font-mono">
                                  (Asset_No: {l.assetCode})
                                </span>
                              ) : null}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {l.licenseType ? (
                            <Badge className="border-[#0d9488]/30 bg-[#0d9488]/10 text-[#0d9488] dark:border-[#14b8a6]/30 dark:bg-[#14b8a6]/10 dark:text-[#14b8a6]">
                              {l.licenseType}
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {l.expiryDate ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                                {formatThaiDate(l.expiryDate)}
                              </span>
                              <Badge
                                className={`w-fit border ${TONE_BADGE[tone]} text-[10px]`}
                              >
                                {tone === 'red' && days !== null && days < 0
                                  ? 'หมดอายุ'
                                  : tone === 'red' && days !== null
                                    ? `อีก ${days} วัน`
                                    : tone === 'amber' && days !== null
                                      ? `อีก ${days} วัน`
                                      : tone === 'green' && days !== null
                                        ? `อีก ${days} วัน`
                                        : 'ไม่ระบุ'}
                              </Badge>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">— ไม่มีวันหมดอายุ</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {l.isActive ? (
                            <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              <CheckCircle2 className="mr-0.5 h-3 w-3" />
                              active
                            </Badge>
                          ) : (
                            <Badge className="border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              inactive
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center text-sm font-medium">
                          {l.quantity}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEditDialog(l)}
                            disabled={!l.deviceId}
                            title={
                              !l.deviceId
                                ? 'ไม่สามารถแก้ไขได้ — License นี้ไม่ได้ผูกกับอุปกรณ์ (ข้อมูล legacy)'
                                : 'แก้ไข License'
                            }
                            aria-label="แก้ไข License"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteTarget(l)}
                            className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                            title="ลบ License"
                            aria-label="ลบ License"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <PaginationBar
        page={safePage}
        pageSize={pageSize}
        total={total}
        totalPages={totalPages}
        onPageChange={setPage}
        onPageSizeChange={onPageSizeChange}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
      />

      {/* ── Add/Edit Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-lg dark:bg-slate-900 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <KeyRound className="h-5 w-5 text-[#0d9488]" />
              {editingId ? 'แก้ไข License' : 'เพิ่ม License ใหม่'}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
              กรอกข้อมูล License ของซอฟต์แวร์ — ฟิลด์ที่มี <span className="font-semibold text-[#f97316]">*</span> เป็นข้อมูลที่จำเป็น
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3">
            {/* ── Device picker (only on Add) ── */}
            {!editingId && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  อุปกรณ์ <span className="font-semibold text-[#f97316]">*</span>
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between font-normal dark:bg-slate-800 dark:border-slate-700"
                    >
                      <span className={lcDeviceLabel ? '' : 'text-slate-400'}>
                        {lcDeviceLabel || 'ค้นหาอุปกรณ์ — พิมพ์รหัสหรือชื่อ…'}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0 dark:bg-slate-900 dark:border-slate-700" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="พิมพ์รหัสหรือชื่ออุปกรณ์..."
                        value={deviceQuery}
                        onValueChange={(v) => {
                          setDeviceQuery(v)
                          searchDevices(v)
                        }}
                      />
                      <CommandList>
                        {deviceSearching ? (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                          </div>
                        ) : deviceResults.length === 0 ? (
                          <CommandEmpty>ไม่พบอุปกรณ์ — ลองพิมพ์ใหม่</CommandEmpty>
                        ) : (
                          <CommandGroup>
                            {deviceResults.map((d) => (
                              <CommandItem
                                key={d.id}
                                value={d.id}
                                onSelect={() => pickDevice(d)}
                                className="flex flex-col items-start gap-0.5"
                              >
                                <span className="font-mono text-xs text-slate-700 dark:text-slate-200">
                                  {d.assetCode}
                                </span>
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                  {d.name}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  สาขา: {d.site}
                                </span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {lcDeviceId && (
                  <button
                    type="button"
                    onClick={() => {
                      setLcDeviceId('')
                      setLcDeviceLabel('')
                    }}
                    className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-500"
                  >
                    <X className="h-3 w-3" /> ยกเลิกการเลือกอุปกรณ์
                  </button>
                )}
              </div>
            )}

            {/* ── Software (required) ── */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                ชื่อซอฟต์แวร์ <span className="font-semibold text-[#f97316]">*</span>
              </Label>
              <Input
                value={lcSoftware}
                onChange={(e) => setLcSoftware(e.target.value)}
                placeholder="เช่น Microsoft Office 2021"
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  License ID
                </Label>
                <Input
                  value={lcLicenseId}
                  onChange={(e) => setLcLicenseId(e.target.value)}
                  placeholder="เช่น MS-OFFICE-2021-001"
                  className="font-mono text-xs dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  ประเภท
                </Label>
                <Select
                  value={lcLicenseType}
                  onValueChange={(v) => setLcLicenseType(v)}
                >
                  <SelectTrigger className="dark:bg-slate-800 dark:border-slate-700">
                    <SelectValue placeholder="เลือกประเภท" />
                  </SelectTrigger>
                  <SelectContent>
                    {LICENSE_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                License Key
              </Label>
              <Input
                value={lcLicenseKey}
                onChange={(e) => setLcLicenseKey(e.target.value)}
                placeholder="เช่น XXXXX-XXXXX-XXXXX-XXXXX"
                className="font-mono text-xs dark:bg-slate-800 dark:border-slate-700"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  จำนวน
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={lcQuantity}
                  onChange={(e) => setLcQuantity(e.target.value)}
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  วันหมดอายุ
                </Label>
                <Input
                  type="date"
                  value={lcExpiryDate}
                  onChange={(e) => setLcExpiryDate(e.target.value)}
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                หมายเหตุ
              </Label>
              <Input
                value={lcRemark}
                onChange={(e) => setLcRemark(e.target.value)}
                placeholder="ข้อมูลเพิ่มเติม"
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>

            {/* ── Expiry preview ── */}
            {lcExpiryDate && (
              <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800">
                {(() => {
                  const tone = expiryTone(lcExpiryDate)
                  const days = daysUntil(lcExpiryDate)
                  return (
                    <>
                      <AlertTriangle className={`h-3.5 w-3.5 ${tone === 'red' ? 'text-rose-500' : tone === 'amber' ? 'text-amber-500' : 'text-emerald-500'}`} />
                      <span className="text-slate-600 dark:text-slate-300">
                        {days !== null && days < 0
                          ? `หมดอายุแล้ว ${Math.abs(days)} วัน`
                          : days !== null
                            ? `เหลืออีก ${days} วัน`
                            : ''}
                      </span>
                    </>
                  )
                })()}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={closeDialog}
              disabled={saving}
              className="dark:bg-slate-800 dark:border-slate-700"
            >
              ยกเลิก
            </Button>
            <Button
              onClick={saveLicense}
              disabled={saving}
              className="bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  กำลังบันทึก…
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                  {editingId ? 'บันทึกการแก้ไข' : 'เพิ่ม License'}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent className="dark:bg-slate-900 dark:border-slate-800">
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบ License</AlertDialogTitle>
            <AlertDialogDescription>
              ต้องการลบ License &quot;{deleteTarget?.software ?? ''}&quot;
              {deleteTarget?.device
                ? ` (ของอุปกรณ์ ${deleteTarget.device.assetCode})`
                : ''}
              {' '}ใช่หรือไม่? การกระทำนี้ไม่สามารถยกเลิกได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={false}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                void confirmDelete()
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              ลบ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
