'use client'

/**
 * MobileMyWork — mobile-first "งานของฉัน" (My Work) screen for technicians.
 *
 * Flow:
 *   1. List view: paginated card list of work orders.
 *      - Search by WO number / subject / reporter / location.
 *      - Filter chips: ทั้งหมด / รอดำเนินการ / กำลังซ่อม / รออะไหล่ / ซ่อมเสร็จ.
 *      - KPI strip showing per-status counts.
 *      - Each card: WO number, subject, status badge, priority dot, site/building, date.
 *      - Pull-to-refresh feel via a prominent refresh button.
 *   2. Tap a card → full-screen detail view (slides in over the list).
 *      - Full info: reporter, contact, building/location, device link.
 *      - Description + admin notes + resolution.
 *      - Timeline (messages) showing every status change + remark.
 *      - Status update actions (next-status buttons).
 *      - Photos: existing before/onsite/after images + capture new ones.
 *   3. Tap a status action → bottom sheet (Sheet side="bottom"):
 *      - Action title + helper text.
 *      - Required remark/note textarea (optional for some).
 *      - Optional photo capture (for ซ่อมเสร็จ / ส่งคืน).
 *      - Confirm button → calls the right API endpoint.
 *
 * Touch targets: every button is h-11 / h-12 (≥44px).
 *
 * Responsive: full-width on phones (max-w-md wrapper from the shell);
 * list has `max-h-[70vh] overflow-y-auto` style scroll on the detail card
 * list so it never pushes the bottom nav off-screen.
 *
 * Accessibility:
 *   - All inputs have <Label> + aria-required.
 *   - Touch-friendly hit areas (≥44px).
 *   - Error messages announced via role="alert".
 *   - Loading state has aria-busy + a spinner.
 *
 * API contract (Bearer token attached by the global fetch interceptor in
 * app/page.tsx — see /api/work-orders, /api/devices, etc.):
 *   GET    /api/work-orders?search=&status=&assignedTo=&page=&pageSize=
 *        → { data: WorkOrder[], pagination, stats }
 *   GET    /api/work-orders/[id]
 *        → { data: WorkOrder & { device?, messages?, reviews? } }
 *   PUT    /api/work-orders/[id]                       → set status / fields
 *   POST   /api/work-orders/[id]/complete             → mark COMPLETED
 *        body: { note?, resolution?, picAfter?, picOnsite?, actor? }
 *   POST   /api/work-orders/[id]/messages             → add a remark
 *        body: { message, author?, authorRole?, actor? }
 *   POST   /api/work-orders/[id]/images               → add a stage image
 *        body: { stage: 'before'|'onsite'|'after', image_data, fileName? }
 *
 * Status workflow (matches the 5-button spec):
 *   PENDING (รอดำเนินการ)
 *     └─ "เริ่มซ่อม" → IN_PROGRESS (PUT status=IN_PROGRESS)
 *   IN_PROGRESS (กำลังซ่อม)
 *     ├─ "รออะไหล่" → WAITING_PARTS (PUT status=WAITING_PARTS)
 *     └─ "ซ่อมเสร็จ" → COMPLETED (POST /complete with resolution+note+picAfter)
 *   WAITING_PARTS (รออะไหล่)
 *     ├─ "กลับซ่อมต่อ" → IN_PROGRESS (PUT status=IN_PROGRESS)
 *     └─ "ซ่อมเสร็จ" → COMPLETED (POST /complete)
 *   COMPLETED (ซ่อมเสร็จ)
 *     └─ "ส่งคืนอุปกรณ์" → adds a "ส่งคืนอุปกรณ์แล้ว" message + sets
 *                          detailsAdmin (finalization step — the schema
 *                          does not have a separate RETURNED status, so
 *                          we record it as a message + admin note).
 *   CANCELLED (ยกเลิก)
 *     └─ (no actions)
 */

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  Search,
  X,
  AlertCircle,
  MapPin,
  User,
  Phone,
  Clock,
  Camera,
  Image as ImageIcon,
  ChevronRight,
  Wrench,
  Package,
  CheckCircle2,
  Send,
  MessageSquare,
  Building2,
  Hash,
  ClipboardList,
  Inbox,
  Cpu,
  Trash2,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
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
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth-store'
import { useLang } from '@/store/i18n-store'
import { useKeyboardAware } from '@/hooks/use-keyboard-aware'
import { addToQueue } from '@/lib/offline-queue'
import { bearerHeaders } from '@/lib/http-headers'

// ── Types ─────────────────────────────────────────────────────────────

type WoStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'WAITING_PARTS'
  | 'COMPLETED'
  | 'CANCELLED'

interface WorkOrderLite {
  id: string
  woNumber: string | null
  requestId: string | null
  subject: string
  building: string | null
  location: string | null
  details: string | null
  priority: string
  status: string
  reporterName: string | null
  reporterEmail: string | null
  tel: string | null
  employeeCode: string | null
  assignedTo: string | null
  siteCode: string | null
  createdAt: string
  updatedAt: string
  workCompletedAt: string | null
  closedAt: string | null
}

interface WoMessage {
  id: string
  message: string
  author: string | null
  authorRole: string | null
  createdAt: string
}

interface WoDevice {
  id: string
  assetCode: string
  name: string
  brand: string | null
  model: string | null
  site: string | null
}

interface WorkOrderDetail extends WorkOrderLite {
  detailsAdmin: string | null
  dateAdmin: string | null
  resolution: string | null
  resolutionGroup: string | null
  assignedAt: string | null
  assignedBy: string | null
  assignmentNote: string | null
  picBefore: string | null
  picOnsite: string | null
  picAfter: string | null
  device?: WoDevice | null
  messages?: WoMessage[]
}

interface ListResponse {
  data: WorkOrderLite[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  stats: Record<string, number>
}

interface DetailResponse {
  data: WorkOrderDetail
}

// ── Constants ─────────────────────────────────────────────────────────

interface StatusMeta {
  label: string
  badge: string
  dot: string
  bar: string
}

const STATUS_META: Record<WoStatus, StatusMeta> = {
  PENDING: {
    label: 'รอดำเนินการ',
    badge:
      'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900',
    dot: 'bg-orange-500',
    bar: 'bg-orange-500',
  },
  IN_PROGRESS: {
    label: 'กำลังซ่อม',
    badge:
      'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900',
    dot: 'bg-sky-500',
    bar: 'bg-sky-500',
  },
  WAITING_PARTS: {
    label: 'รออะไหล่',
    badge:
      'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
    dot: 'bg-amber-500',
    bar: 'bg-amber-500',
  },
  COMPLETED: {
    label: 'ซ่อมเสร็จ',
    badge:
      'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
    dot: 'bg-emerald-500',
    bar: 'bg-emerald-500',
  },
  CANCELLED: {
    label: 'ยกเลิก',
    badge:
      'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800/60 dark:text-gray-300 dark:border-gray-700',
    dot: 'bg-gray-500',
    bar: 'bg-gray-500',
  },
}

interface PriorityMeta {
  label: string
  badge: string
  dot: string
}

const PRIORITY_META: Record<string, PriorityMeta> = {
  ด่วน: {
    label: 'ด่วน',
    badge:
      'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900',
    dot: 'bg-rose-500',
  },
  สูง: {
    label: 'สูง',
    badge:
      'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900',
    dot: 'bg-orange-500',
  },
  ปานกลาง: {
    label: 'ปานกลาง',
    badge:
      'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900',
    dot: 'bg-sky-500',
  },
  ปกติ: {
    label: 'ปกติ',
    badge:
      'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800/60 dark:text-gray-300 dark:border-gray-700',
    dot: 'bg-gray-400',
  },
}

const FILTERS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'PENDING', label: 'รอดำเนินการ' },
  { key: 'IN_PROGRESS', label: 'กำลังซ่อม' },
  { key: 'WAITING_PARTS', label: 'รออะไหล่' },
  { key: 'COMPLETED', label: 'ซ่อมเสร็จ' },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

interface StatusAction {
  /** Action key — used for sheet state. */
  key: string
  /** Button label shown on the detail page. */
  label: string
  /** Helper text shown in the bottom-sheet header. */
  description: string
  /** Tailwind classes for the button (idle). */
  buttonClass: string
  /** Whether a remark is required. */
  remarkRequired: boolean
  /** Whether photo capture is offered. */
  photoOptional: boolean
  /** Endpoint: 'PUT status' | 'POST complete' | 'POST message' */
  endpoint: 'put-status' | 'complete' | 'message'
  /** Target status (only for 'put-status'). */
  targetStatus?: WoStatus
  /** Icon component. */
  icon: React.ComponentType<{ className?: string }>
}

/** Per-status action map — drives which buttons are visible on the detail page. */
const ACTIONS_BY_STATUS: Record<WoStatus, StatusAction[]> = {
  PENDING: [
    {
      key: 'start',
      label: 'เริ่มซ่อม',
      description: 'เปลี่ยนสถานะเป็น "กำลังซ่อม" เพื่อเริ่มงาน',
      buttonClass: 'bg-sky-500 text-white hover:bg-sky-600',
      remarkRequired: false,
      photoOptional: true,
      endpoint: 'put-status',
      targetStatus: 'IN_PROGRESS',
      icon: Wrench,
    },
  ],
  IN_PROGRESS: [
    {
      key: 'waiting-parts',
      label: 'รออะไหล่',
      description: 'พัาซ่อมชั่วคราว — เปลี่ยนสถานะเป็น "รออะไหล่"',
      buttonClass: 'bg-amber-500 text-white hover:bg-amber-600',
      remarkRequired: true,
      photoOptional: false,
      endpoint: 'put-status',
      targetStatus: 'WAITING_PARTS',
      icon: Package,
    },
    {
      key: 'complete',
      label: 'ซ่อมเสร็จ',
      description: 'ปิดงานซ่อม — กรอกผลการแก้ไขและแนบรูปหลังซ่อม',
      buttonClass: 'bg-emerald-500 text-white hover:bg-emerald-600',
      remarkRequired: true,
      photoOptional: true,
      endpoint: 'complete',
      icon: CheckCircle2,
    },
  ],
  WAITING_PARTS: [
    {
      key: 'resume',
      label: 'กลับซ่อมต่อ',
      description: 'ได้อะไหล่แล้ว — เปลี่ยนสถานะกลับเป็น "กำลังซ่อม"',
      buttonClass: 'bg-sky-500 text-white hover:bg-sky-600',
      remarkRequired: false,
      photoOptional: false,
      endpoint: 'put-status',
      targetStatus: 'IN_PROGRESS',
      icon: RotateCcw,
    },
    {
      key: 'complete',
      label: 'ซ่อมเสร็จ',
      description: 'ปิดงานซ่อม — กรอกผลการแก้ไขและแนบรูปหลังซ่อม',
      buttonClass: 'bg-emerald-500 text-white hover:bg-emerald-600',
      remarkRequired: true,
      photoOptional: true,
      endpoint: 'complete',
      icon: CheckCircle2,
    },
  ],
  COMPLETED: [
    {
      key: 'return',
      label: 'ส่งคืนอุปกรณ์',
      description: 'บันทึกการส่งคืนอุปกรณ์ให้ผู้แจ้ง — เพิ่มข้อความรับรอง',
      buttonClass: 'bg-orange-500 text-white hover:bg-orange-600',
      remarkRequired: true,
      photoOptional: true,
      endpoint: 'message',
      icon: Send,
    },
  ],
  CANCELLED: [],
}

const PAGE_SIZE = 20
const MAX_AFTER_PHOTOS = 4

// ── Helpers ───────────────────────────────────────────────────────────

function isStatus(s: string | null | undefined): s is WoStatus {
  return typeof s === 'string' && s in STATUS_META
}

function getStatusMeta(s: string | null | undefined): StatusMeta {
  if (s && isStatus(s)) return STATUS_META[s]
  return STATUS_META.PENDING
}

function getPriorityMeta(p: string | null | undefined): PriorityMeta {
  if (p && p in PRIORITY_META) return PRIORITY_META[p]
  return PRIORITY_META['ปกติ']
}

function formatDate(iso: string | null | undefined, lang: 'th' | 'en' = 'th'): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatShortDate(iso: string | null | undefined, lang: 'th' | 'en' = 'th'): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', {
      day: '2-digit',
      month: 'short',
    })
  } catch {
    return iso
  }
}

function relativeTime(iso: string | null | undefined, lang: 'th' | 'en' = 'th'): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const diffMs = Date.now() - d.getTime()
    const sec = Math.floor(diffMs / 1000)
    if (sec < 60) return 'เมื่อสักครู่'
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min} นาทีที่แล้ว`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr} ชม.ที่แล้ว`
    const day = Math.floor(hr / 24)
    if (day < 30) return `${day} วันที่แล้ว`
    return formatShortDate(iso, lang)
  } catch {
    return iso
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// ── Main Component ────────────────────────────────────────────────────

export function MobileMyWork() {
  // ── List state ──
  const [searchTerm, setSearchTerm] = React.useState('')
  const [filter, setFilter] = React.useState<FilterKey>('all')
  const [onlyMine, setOnlyMine] = React.useState(true)
  const [items, setItems] = React.useState<WorkOrderLite[]>([])
  const [stats, setStats] = React.useState<Record<string, number>>({})
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [page, setPage] = React.useState(1)
  const [totalPages, setTotalPages] = React.useState(1)
  const [total, setTotal] = React.useState(0)

  // ── Detail state ──
  const [detailId, setDetailId] = React.useState<string | null>(null)

  // ── Auth ──
  const user = useAuthStore((s) => s.user)
  const isAdmin = React.useMemo(() => {
    if (!user) return false
    const role = user.role?.toLowerCase() ?? ''
    return (
      role === 'admin' ||
      role === 'superadmin' ||
      role === 'super_admin' ||
      role === 'super-admin'
    )
  }, [user])

  // ── Debounced search ──
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void fetchList({ silent: false })
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchTerm, filter, onlyMine, page, user])

  // ── Initial load ──
  React.useEffect(() => {
    void fetchList({ silent: false })
  }, [])

  // ── List fetcher ──
  async function fetchList(opts: { silent?: boolean } = {}) {
    const silent = opts.silent === true
    if (!silent) setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      const q = searchTerm.trim()
      if (q) params.set('search', q)
      if (filter !== 'all') params.set('status', filter)
      // For "My work" tab, prefer assignments to the current user.
      // Admins can toggle "onlyMine" off to see all pending.
      const techName = user?.name ?? user?.username ?? user?.email ?? ''
      if (onlyMine && techName) params.set('assignedTo', techName)

      const res = await fetch(`/api/work-orders?${params.toString()}`, {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? 'โหลดรายการไม่สำเร็จ')
      }
      const json = (await res.json()) as ListResponse
      setItems(json.data ?? [])
      setStats(json.stats ?? {})
      setTotal(json.pagination?.total ?? 0)
      setTotalPages(json.pagination?.totalPages ?? 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดรายการไม่สำเร็จ')
      if (silent) toast.error(e instanceof Error ? e.message : 'โหลดรายการไม่สำเร็จ')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  // ── Pull-to-refresh feel: pull a fresh list + reset page ──
  async function handleRefresh() {
    setPage(1)
    await fetchList({ silent: false })
    toast.success('รีเฟรชรายการแล้ว')
  }

  // ── Render ──
  if (detailId) {
    return (
      <DetailView
        workOrderId={detailId}
        onBack={() => {
          setDetailId(null)
          // refresh list silently so counts / statuses update
          void fetchList({ silent: true })
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── Search + filter header ── */}
      <Card className="gap-0 py-0">
        <CardContent className="px-0 py-0">
          <div className="p-3">
            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                inputMode="search"
                autoComplete="off"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value)
                  setPage(1)
                }}
                placeholder="เลขใบงาน / หัวข้อ / สถานที่"
                aria-label="ค้นหาใบงาน"
                className="h-11 rounded-lg pl-9 pr-9 text-base"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('')
                    setPage(1)
                  }}
                  aria-label="ล้างคำค้นหา"
                  className="absolute right-2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Filter chips */}
          <div
            className="flex gap-2 overflow-x-auto px-3 pb-3"
            style={{ scrollbarWidth: 'none' }}
            aria-label="กรองตามสถานะ"
          >
            {FILTERS.map((f) => {
              const active = filter === f.key
              const count =
                f.key === 'all'
                  ? total
                  : (stats[f.key as string] ?? 0)
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => {
                    setFilter(f.key)
                    setPage(1)
                  }}
                  aria-pressed={active}
                  className={cn(
                    'flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                    active
                      ? 'border-orange-500 bg-orange-500 text-white'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted',
                  )}
                >
                  <span>{f.label}</span>
                  {count > 0 && (
                    <span
                      className={cn(
                        'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold',
                        active
                          ? 'bg-white/25 text-white'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Admin toggle: only my work vs. all */}
          {isAdmin && (
            <div className="flex items-center justify-between border-t px-3 py-2.5">
              <label
                htmlFor="mmw-only-mine"
                className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
              >
                <input
                  id="mmw-only-mine"
                  type="checkbox"
                  checked={onlyMine}
                  onChange={(e) => {
                    setOnlyMine(e.target.checked)
                    setPage(1)
                  }}
                  className="h-4 w-4 accent-orange-500"
                />
                แสดงเฉพาะงานที่มอบหมายให้ฉัน
              </label>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading}
                aria-label="รีเฟรชรายการ"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw
                  className={cn('h-4 w-4', loading && 'animate-spin')}
                />
              </button>
            </div>
          )}
          {!isAdmin && (
            <div className="flex items-center justify-end border-t px-3 py-2.5">
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading}
                aria-label="รีเฟรชรายการ"
                className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw
                  className={cn('h-3.5 w-3.5', loading && 'animate-spin')}
                />
                รีเฟรช
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Results summary ── */}
      <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span>
          {loading ? (
            'กำลังโหลด…'
          ) : (
            <>
              พบ <span className="font-semibold text-foreground">{total}</span>{' '}
              รายการ
              {onlyMine && (
                <span className="ml-1 text-orange-600">
                  · งานของฉัน
                </span>
              )}
            </>
          )}
        </span>
        {totalPages > 1 && (
          <span>
            หน้า {page} / {totalPages}
          </span>
        )}
      </div>

      {/* ── List / loading / error / empty states ── */}
      {loading && items.length === 0 ? (
        <ListSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void fetchList({ silent: false })} />
      ) : items.length === 0 ? (
        <EmptyState
          filter={filter}
          onlyMine={onlyMine}
          searchTerm={searchTerm}
          onClear={() => {
            setSearchTerm('')
            setFilter('all')
            setOnlyMine(isAdmin ? false : true)
            setPage(1)
          }}
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((wo) => (
            <li key={wo.id}>
              <WorkOrderCard
                wo={wo}
                onClick={() => setDetailId(wo.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* ── Pagination ── */}
      {totalPages > 1 && !loading && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => {
              setPage((p) => Math.max(1, p - 1))
              void fetchList({ silent: true })
            }}
            className="h-10"
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            ก่อนหน้า
          </Button>
          <span className="text-xs text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => {
              setPage((p) => Math.min(totalPages, p + 1))
              void fetchList({ silent: true })
            }}
            className="h-10"
          >
            ถัดไป
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

// ── List sub-components ───────────────────────────────────────────────

function WorkOrderCard({
  wo,
  onClick,
}: {
  wo: WorkOrderLite
  onClick: () => void
}) {
  const { lang } = useLang()
  const statusMeta = getStatusMeta(wo.status)
  const prMeta = getPriorityMeta(wo.priority)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`เปิดรายละเอียดใบงาน ${wo.woNumber ?? wo.id}`}
      className="block w-full rounded-xl border border-border bg-background p-0 text-left transition-all hover:border-orange-300 hover:shadow-md active:scale-[0.99]"
    >
      <div className="flex items-stretch">
        {/* Priority bar (left edge) */}
        <div className={cn('w-1 rounded-l-xl', prMeta.dot)} aria-hidden="true" />

        <div className="min-w-0 flex-1 p-3">
          {/* Header row: WO number + status */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {wo.woNumber && (
                  <span className="font-mono text-[11px] font-bold text-orange-600">
                    {wo.woNumber}
                  </span>
                )}
                {prMeta.label !== 'ปกติ' && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold',
                      prMeta.badge,
                    )}
                  >
                    <span
                      className={cn('h-1.5 w-1.5 rounded-full', prMeta.dot)}
                      aria-hidden="true"
                    />
                    {prMeta.label}
                  </span>
                )}
              </div>
              <h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-snug">
                {wo.subject}
              </h3>
            </div>
            <Badge
              variant="outline"
              className={cn(
                'flex-shrink-0 gap-1 text-[10px] font-semibold',
                statusMeta.badge,
              )}
            >
              <span
                className={cn('h-1.5 w-1.5 rounded-full', statusMeta.dot)}
                aria-hidden="true"
              />
              {statusMeta.label}
            </Badge>
          </div>

          {/* Meta row: site/building + date */}
          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">
                {wo.siteCode ?? wo.building ?? wo.location ?? '—'}
              </span>
            </div>
            <span className="flex-shrink-0">{relativeTime(wo.createdAt, lang)}</span>
          </div>

          {/* Reporter row */}
          {(wo.reporterName || wo.assignedTo) && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <User className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">
                {wo.reporterName ?? 'ไม่ระบุผู้แจ้ง'}
              </span>
              {wo.assignedTo && (
                <span className="ml-1 truncate text-orange-600">
                  → {wo.assignedTo}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

function ListSkeleton() {
  return (
    <ul className="flex flex-col gap-2.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i}>
          <Card className="gap-0 py-0">
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  )
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <Card className="border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30">
      <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-900 dark:text-rose-300">
          <AlertCircle className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm font-semibold">โหลดรายการไม่สำเร็จ</p>
          <p className="mt-1 text-xs text-muted-foreground" role="alert">
            {message}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onRetry}
          className="h-10"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          ลองอีกครั้ง
        </Button>
      </CardContent>
    </Card>
  )
}

function EmptyState({
  filter,
  onlyMine,
  searchTerm,
  onClear,
}: {
  filter: FilterKey
  onlyMine: boolean
  searchTerm: string
  onClear: () => void
}) {
  const filterLabel =
    filter === 'all'
      ? onlyMine
        ? 'งานของฉัน'
        : 'ทั้งหมด'
      : FILTERS.find((f) => f.key === filter)?.label ?? 'ทั้งหมด'
  return (
    <Card className="border-dashed bg-muted/30">
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Inbox className="h-7 w-7" />
        </div>
        <div>
          <p className="text-sm font-semibold">ไม่พบใบงาน</p>
          <p className="mt-1 text-xs text-muted-foreground">
            ไม่มีใบงานในหมวด “{filterLabel}”
            {searchTerm ? ' ที่ตรงกับคำค้นหา' : ''}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onClear}
          className="h-10"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          ล้างตัวกรอง
        </Button>
      </CardContent>
    </Card>
  )
}

// ── Detail View ────────────────────────────────────────────────────────

function DetailView({
  workOrderId,
  onBack,
}: {
  workOrderId: string
  onBack: () => void
}) {
  const { lang } = useLang()
  const [detail, setDetail] = React.useState<WorkOrderDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Active status-action sheet (null when closed)
  const [activeAction, setActiveAction] = React.useState<StatusAction | null>(
    null,
  )

  // Auth (for actor name in API calls)
  const user = useAuthStore((s) => s.user)

  async function fetchDetail() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/work-orders/${encodeURIComponent(workOrderId)}`,
        {
          headers: bearerHeaders(useAuthStore.getState()?.token),
        },
      )
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? 'โหลดรายละเอียดไม่สำเร็จ')
      }
      const json = (await res.json()) as DetailResponse
      setDetail(json.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดรายละเอียดไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    void fetchDetail()
  }, [workOrderId])

  const actorName =
    user?.email ?? user?.name ?? user?.username ?? 'mobile-user'

  async function handleActionComplete() {
    setActiveAction(null)
    // Re-fetch detail so the new status + messages show
    await fetchDetail()
  }

  // ── Loading ──
  if (loading && !detail) {
    return (
      <div className="flex flex-col gap-3">
        <DetailHeader
          woNumber={null}
          statusLabel="กำลังโหลด…"
          onBack={onBack}
        />
        <Card className="gap-0 py-0">
          <CardContent className="space-y-3 p-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── Error ──
  if (error && !detail) {
    return (
      <div className="flex flex-col gap-3">
        <DetailHeader woNumber={null} statusLabel="ผิดพลาด" onBack={onBack} />
        <ErrorState message={error} onRetry={fetchDetail} />
      </div>
    )
  }

  if (!detail) return null

  const statusMeta = getStatusMeta(detail.status)
  const prMeta = getPriorityMeta(detail.priority)
  const actions = isStatus(detail.status)
    ? ACTIONS_BY_STATUS[detail.status]
    : []

  return (
    <div className="flex flex-col gap-3">
      <DetailHeader
        woNumber={detail.woNumber ?? detail.id}
        statusLabel={statusMeta.label}
        statusBadgeClass={statusMeta.badge}
        statusDotClass={statusMeta.dot}
        onBack={onBack}
      />

      {/* ── Subject + meta ── */}
      <Card className="gap-0 py-0">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {prMeta.label !== 'ปกติ' && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                  prMeta.badge,
                )}
              >
                <span
                  className={cn('h-1.5 w-1.5 rounded-full', prMeta.dot)}
                  aria-hidden="true"
                />
                ความเร่งด่วน: {prMeta.label}
              </span>
            )}
            <Badge
              variant="outline"
              className={cn('gap-1 text-[10px] font-semibold', statusMeta.badge)}
            >
              <span
                className={cn('h-1.5 w-1.5 rounded-full', statusMeta.dot)}
                aria-hidden="true"
              />
              {statusMeta.label}
            </Badge>
          </div>
          <h2 className="mt-2 text-base font-semibold leading-snug">
            {detail.subject}
          </h2>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>แจ้งเมื่อ {formatDate(detail.createdAt, lang)}</span>
          </div>
          {(detail.workCompletedAt || detail.closedAt) && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>
                ซ่อมเสร็จ {formatDate(detail.workCompletedAt, lang)}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Reporter + contact ── */}
      <Card className="gap-0 py-0">
        <CardContent className="p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <User className="h-4 w-4 text-orange-600" />
            ข้อมูลผู้แจ้ง
          </h3>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <DetailField
              icon={<User className="h-3.5 w-3.5" />}
              label="ผู้แจ้ง"
              value={detail.reporterName ?? '—'}
            />
            <DetailField
              icon={<Phone className="h-3.5 w-3.5" />}
              label="เบอร์โทร"
              value={detail.tel ?? '—'}
            />
            {detail.employeeCode && (
              <DetailField
                icon={<Hash className="h-3.5 w-3.5" />}
                label="รหัสพนักงาน"
                value={detail.employeeCode}
              />
            )}
            {detail.assignedTo && (
              <DetailField
                icon={<Wrench className="h-3.5 w-3.5" />}
                label="ช่างที่รับผิดชอบ"
                value={detail.assignedTo}
                valueClass="text-orange-600"
              />
            )}
            <DetailField
              icon={<MapPin className="h-3.5 w-3.5" />}
              label="อาคาร"
              value={detail.building ?? '—'}
            />
            <DetailField
              icon={<MapPin className="h-3.5 w-3.5" />}
              label="ตำแหน่ง"
              value={detail.location ?? '—'}
            />
            {detail.siteCode && (
              <DetailField
                icon={<Building2 className="h-3.5 w-3.5" />}
                label="ไซต์"
                value={detail.siteCode}
              />
            )}
          </dl>
        </CardContent>
      </Card>

      {/* ── Device info ── */}
      {detail.device && (
        <Card className="gap-0 py-0">
          <CardContent className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Cpu className="h-4 w-4 text-orange-600" />
              อุปกรณ์ที่แจ้งซ่อม
            </h3>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-950 dark:text-orange-300">
                <Cpu className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-orange-600">
                    {detail.device.assetCode}
                  </span>
                  <span className="truncate text-sm font-medium">
                    {detail.device.name}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {[
                    detail.device.brand,
                    detail.device.model,
                    detail.device.site,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Problem details ── */}
      {detail.details && (
        <Card className="gap-0 py-0">
          <CardContent className="p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <ClipboardList className="h-4 w-4 text-orange-600" />
              รายละเอียดอาการ
            </h3>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
              {detail.details}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Resolution (if completed) ── */}
      {detail.resolution && (
        <Card className="gap-0 border-emerald-200 bg-emerald-50/50 py-0 dark:border-emerald-900 dark:bg-emerald-950/20">
          <CardContent className="p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              ผลการแก้ไข
            </h3>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {detail.resolution}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Admin notes ── */}
      {detail.detailsAdmin && (
        <Card className="gap-0 py-0">
          <CardContent className="p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <MessageSquare className="h-4 w-4 text-orange-600" />
              หมายเหตุจากช่าง
            </h3>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
              {detail.detailsAdmin}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Photos: existing before/onsite/after + capture ── */}
      <PhotosCard workOrderId={detail.id} detail={detail} />

      {/* ── Timeline / messages ── */}
      {detail.messages && detail.messages.length > 0 && (
        <Card className="gap-0 py-0">
          <CardContent className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Clock className="h-4 w-4 text-orange-600" />
              ประวัติการทำงาน
            </h3>
            <ol className="relative space-y-3 border-l border-border pl-4">
              {detail.messages
                .slice()
                .reverse() // newest first
                .map((m) => (
                  <li key={m.id} className="relative">
                    <span
                      className="absolute -left-[1.32rem] top-1 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-background"
                      aria-hidden="true"
                    />
                    <p className="text-xs font-medium text-foreground">
                      {m.author ?? 'ระบบ'}
                      {m.authorRole && m.authorRole !== 'system' && (
                        <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {m.authorRole}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">
                      {m.message}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {formatDate(m.createdAt, lang)}
                    </p>
                  </li>
                ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* ── Status update actions ── */}
      <Card className="gap-0 border-orange-200 py-0 dark:border-orange-900">
        <CardContent className="p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Wrench className="h-4 w-4 text-orange-600" />
            อัปเดตสถานะงาน
          </h3>
          {actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {detail.status === 'CANCELLED'
                ? 'ใบงานนี้ถูกยกเลิก — ไม่สามารถอัปเดตสถานะได้'
                : 'ไม่มีการอัปเดตสถานะเพิ่มเติมในขั้นตอนปัจจุบัน'}
            </p>
          ) : (
            <div className="grid gap-2">
              {actions.map((a) => {
                const Icon = a.icon
                return (
                  <Button
                    key={a.key}
                    type="button"
                    onClick={() => setActiveAction(a)}
                    className={cn('h-12 justify-start text-sm font-semibold', a.buttonClass)}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    {a.label}
                  </Button>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Status update sheet (bottom) ── */}
      <StatusUpdateSheet
        workOrderId={detail.id}
        action={activeAction}
        actorName={actorName}
        onClose={() => setActiveAction(null)}
        onDone={handleActionComplete}
      />
    </div>
  )
}

function DetailHeader({
  woNumber,
  statusLabel,
  statusBadgeClass,
  statusDotClass,
  onBack,
}: {
  woNumber: string | null
  statusLabel: string
  statusBadgeClass?: string
  statusDotClass?: string
  onBack: () => void
}) {
  return (
    <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 border-b bg-background/95 px-3 py-2.5 backdrop-blur">
      <button
        type="button"
        onClick={onBack}
        aria-label="ย้อนกลับไปรายการ"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1">
        {woNumber && (
          <p className="truncate font-mono text-xs font-bold text-orange-600">
            {woNumber}
          </p>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold">รายละเอียดใบงาน</span>
          {statusBadgeClass && statusDotClass && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold',
                statusBadgeClass,
              )}
            >
              <span
                className={cn('h-1.5 w-1.5 rounded-full', statusDotClass)}
                aria-hidden="true"
              />
              {statusLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailField({
  icon,
  label,
  value,
  valueClass,
}: {
  icon: React.ReactNode
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="space-y-0.5">
      <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd
        className={cn(
          'break-words text-sm font-medium text-foreground',
          valueClass,
        )}
      >
        {value}
      </dd>
    </div>
  )
}

// ── Photos Card ────────────────────────────────────────────────────────

function PhotosCard({
  workOrderId,
  detail,
}: {
  workOrderId: string
  detail: WorkOrderDetail
}) {
  const [existingImages, setExistingImages] = React.useState<
    Array<{ id: string; stage: string; data: string; fileName: string | null }>
  >([])
  const [loadingImages, setLoadingImages] = React.useState(true)
  const [staged, setStaged] = React.useState<
    Array<{ stage: 'onsite' | 'after'; data: string }>
  >([])
  const [uploading, setUploading] = React.useState(false)

  // Camera overlay state
  const [cameraOpen, setCameraOpen] = React.useState(false)
  const [cameraTarget, setCameraTarget] = React.useState<'onsite' | 'after'>(
    'after',
  )
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null)
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const cameraInputRef = React.useRef<HTMLInputElement>(null)

  const user = useAuthStore((s) => s.user)
  const uploadedBy = user?.email ?? user?.name ?? user?.username ?? null

  // Fetch existing images
  async function fetchImages() {
    setLoadingImages(true)
    try {
      const res = await fetch(
        `/api/work-orders/${encodeURIComponent(workOrderId)}/images`,
        {
          headers: bearerHeaders(useAuthStore.getState()?.token),
        },
      )
      if (!res.ok) return
      const json = (await res.json()) as {
        data: Array<{
          id: string
          stage: string
          image_data: string
          fileName: string | null
        }>
      }
      setExistingImages(
        (json.data ?? []).map((img) => ({
          id: img.id,
          stage: img.stage,
          data: img.image_data,
          fileName: img.fileName,
        })),
      )
    } catch {
      // silent — images are nice-to-have
    } finally {
      setLoadingImages(false)
    }
  }

  React.useEffect(() => {
    void fetchImages()
  }, [workOrderId])

  // Cleanup camera on unmount
  React.useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
  }, [])

  async function openCameraForStage(stage: 'onsite' | 'after') {
    if (cameraOpen) return
    if (staged.filter((s) => s.stage === stage).length >= MAX_AFTER_PHOTOS) {
      toast.error(`เพิ่มรูปได้สูงสุด ${MAX_AFTER_PHOTOS} รูปต่อขั้นตอน`)
      return
    }
    setCameraTarget(stage)
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error('เบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      streamRef.current = stream
      setCameraOpen(true)
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream
      }, 50)
    } catch {
      toast.error('ไม่สามารถเปิดกล้องได้ ตรวจสอบสิทธิ์การใช้งาน')
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setCameraOpen(false)
  }

  function capturePhoto() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const w = video.videoWidth || 1280
    const h = video.videoHeight || 720
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, w, h)
    const maxW = 1024
    let dataUrl: string
    if (w > maxW) {
      const scale = maxW / w
      const tmp = document.createElement('canvas')
      tmp.width = maxW
      tmp.height = Math.max(1, Math.round(h * scale))
      const tmpCtx = tmp.getContext('2d')
      if (!tmpCtx) {
        dataUrl = canvas.toDataURL('image/jpeg', 0.7)
      } else {
        tmpCtx.drawImage(canvas, 0, 0, tmp.width, tmp.height)
        dataUrl = tmp.toDataURL('image/jpeg', 0.7)
      }
    } else {
      dataUrl = canvas.toDataURL('image/jpeg', 0.7)
    }
    setStaged((prev) => [...prev, { stage: cameraTarget, data: dataUrl }])
    stopCamera()
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    const stage = cameraTarget
    const remaining = MAX_AFTER_PHOTOS - staged.filter((s) => s.stage === stage).length
    if (remaining <= 0) {
      toast.error(`เพิ่มรูปได้สูงสุด ${MAX_AFTER_PHOTOS} รูปต่อขั้นตอน`)
      e.target.value = ''
      return
    }
    try {
      const list = Array.from(files).slice(0, remaining)
      const loaded: Array<{ stage: typeof stage; data: string }> = []
      for (const file of list) {
        const dataUrl = await readFileAsDataUrl(file)
        loaded.push({ stage, data: dataUrl })
      }
      setStaged((prev) => [...prev, ...loaded])
    } catch {
      toast.error('ไม่สามารถอ่านไฟล์รูปได้')
    } finally {
      e.target.value = ''
    }
  }

  async function uploadStaged() {
    if (staged.length === 0) return
    setUploading(true)
    let ok = 0
    let fail = 0
    for (const img of staged) {
      try {
        const res = await fetch(
          `/api/work-orders/${encodeURIComponent(workOrderId)}/images`,
          {
            method: 'POST',
            headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              stage: img.stage,
              image_data: img.data,
              uploadedBy,
            }),
          },
        )
        if (res.ok) ok++
        else fail++
      } catch {
        fail++
      }
    }
    setUploading(false)
    if (ok > 0) {
      toast.success(`อัปโหลดรูปแล้ว ${ok} รูป`)
    }
    if (fail > 0) {
      toast.error(`อัปโหลดไม่สำเร็จ ${fail} รูป`)
    }
    setStaged([])
    await fetchImages()
  }

  async function deleteImage(imageId: string) {
    setDeleteTarget(imageId)
  }

  async function confirmDeleteImage() {
    if (!deleteTarget) return
    const imageId = deleteTarget
    try {
      const res = await fetch(
        `/api/work-orders/${encodeURIComponent(workOrderId)}/images?imageId=${encodeURIComponent(imageId)}`,
        {
          method: 'DELETE',
          headers: bearerHeaders(useAuthStore.getState()?.token),
        },
      )
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? 'ลบรูปไม่สำเร็จ')
      }
      toast.success('ลบรูปแล้ว')
      await fetchImages()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ลบรูปไม่สำเร็จ')
    } finally {
      setDeleteTarget(null)
    }
  }

  const beforeImgs = existingImages.filter((i) => i.stage === 'before')
  const onsiteImgs = existingImages.filter((i) => i.stage === 'onsite')
  const afterImgs = existingImages.filter((i) => i.stage === 'after')

  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Camera className="h-4 w-4 text-orange-600" />
          รูปภาพประกอบ
        </h3>

        {/* Before (read-only — captured by reporter at creation) */}
        <PhotoGroup
          title="ก่อนซ่อม"
          images={beforeImgs}
          loading={loadingImages}
        />

        {/* Onsite */}
        <PhotoGroup
          title="ระหว่างซ่อม"
          images={onsiteImgs}
          loading={loadingImages}
          onDelete={deleteImage}
          onCapture={() => openCameraForStage('onsite')}
          captureLabel="ถ่ายภาพระหว่างซ่อม"
        />

        {/* After */}
        <PhotoGroup
          title="หลังซ่อม"
          images={afterImgs}
          loading={loadingImages}
          onDelete={deleteImage}
          onCapture={() => openCameraForStage('after')}
          captureLabel="ถ่ายภาพหลังซ่อม"
        />

        {/* Staged (new captures pending upload) */}
        {staged.length > 0 && (
          <div className="mt-3 rounded-lg border border-dashed border-orange-300 bg-orange-50/50 p-3 dark:border-orange-900 dark:bg-orange-950/20">
            <p className="mb-2 flex items-center justify-between text-xs font-medium text-orange-700 dark:text-orange-300">
              <span>รูปใหม่รออัปโหลด ({staged.length})</span>
              <button
                type="button"
                onClick={() => setStaged([])}
                className="text-[11px] underline hover:no-underline"
              >
                ล้างทั้งหมด
              </button>
            </p>
            <div className="grid grid-cols-4 gap-2">
              {staged.map((img, i) => (
                <div
                  key={i}
                  className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
                >
                  <img
                    src={img.data}
                    alt={`รูปใหม่ ${i + 1}`}
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white">
                    {img.stage === 'after' ? 'หลัง' : 'ระหว่าง'}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setStaged((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    aria-label={`ลบรูปที่ ${i + 1}`}
                    className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-rose-600 text-white shadow-sm hover:bg-rose-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              onClick={uploadStaged}
              disabled={uploading}
              className="mt-2 h-10 w-full bg-orange-500 hover:bg-orange-600"
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  กำลังอัปโหลด…
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  อัปโหลดรูปทั้งหมด
                </>
              )}
            </Button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onFileChange}
          className="hidden"
          aria-hidden="true"
        />
      </CardContent>

      {/* Full-screen camera overlay */}
      {cameraOpen && (
        <div className="fixed inset-0 z-[9999] flex flex-col bg-black">
          <div className="flex items-center justify-between p-4">
            <span className="text-sm text-white">
              ถ่ายภาพ {cameraTarget === 'after' ? 'หลังซ่อม' : 'ระหว่างซ่อม'}
            </span>
            <button
              type="button"
              onClick={stopCamera}
              aria-label="ปิดกล้อง"
              className="flex h-9 w-9 items-center justify-center rounded-full text-white hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="flex-1 object-contain"
          />
          <canvas ref={canvasRef} className="hidden" />
          <div className="p-6">
            <Button
              type="button"
              onClick={capturePhoto}
              className="h-12 w-full bg-white text-black hover:bg-white/90"
            >
              <Camera className="mr-2 h-5 w-5" />
              ถ่ายภาพ
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              className="mt-2 h-10 w-full text-white hover:bg-white/10"
            >
              <ImageIcon className="mr-2 h-4 w-4" />
              เลือกจากคลัง
            </Button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบ</AlertDialogTitle>
            <AlertDialogDescription>
              ต้องการลบรูปนี้ใช่หรือไม่? การกระทำนี้ไม่สามารถยกเลิกได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                void confirmDeleteImage()
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              ลบ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function PhotoGroup({
  title,
  images,
  loading,
  onDelete,
  onCapture,
  captureLabel,
}: {
  title: string
  images: Array<{ id: string; stage: string; data: string; fileName: string | null }>
  loading: boolean
  onDelete?: (id: string) => void
  onCapture?: () => void
  captureLabel?: string
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        {onCapture && (
          <button
            type="button"
            onClick={onCapture}
            className="flex items-center gap-1 text-[11px] font-medium text-orange-600 hover:underline"
          >
            <Camera className="h-3 w-3" />
            {captureLabel ?? 'ถ่ายภาพ'}
          </button>
        )}
      </div>
      {loading ? (
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-md" />
          ))}
        </div>
      ) : images.length === 0 && !onCapture ? (
        <p className="text-xs text-muted-foreground">ไม่มีรูป</p>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {images.map((img) => (
            <a
              key={img.id}
              href={img.data}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
            >
              <img
                src={img.data}
                alt={`${title} — ${img.fileName ?? 'รูปภาพ'}`}
                className="h-full w-full object-cover"
              />
              {onDelete && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    onDelete(img.id)
                  }}
                  aria-label="ลบรูปนี้"
                  className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-rose-600 text-white opacity-0 shadow-sm transition-opacity hover:bg-rose-700 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </a>
          ))}
          {images.length === 0 && (
            <div className="flex aspect-square items-center justify-center rounded-md border border-dashed text-[10px] text-muted-foreground">
              ไม่มีรูป
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Status Update Sheet ───────────────────────────────────────────────

function StatusUpdateSheet({
  workOrderId,
  action,
  actorName,
  onClose,
  onDone,
}: {
  workOrderId: string
  action: StatusAction | null
  actorName: string
  onClose: () => void
  onDone: () => Promise<void> | void
}) {
  const [remark, setRemark] = React.useState('')
  const [photos, setPhotos] = React.useState<string[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Resolution selector state — for 'complete' action, user can pick
  // from standard resolution options (43 items in 5 groups) + type extra.
  const [selectedResolutions, setSelectedResolutions] = React.useState<string[]>([])
  const [resolutionOptions, setResolutionOptions] = React.useState<
    Array<{ id?: string; value: string; group?: string }>
  >([])
  const [resOptionsLoaded, setResOptionsLoaded] = React.useState(false)

  // Keyboard-aware: detect keyboard height + auto-scroll to focused input
  const { keyboardHeight, scrollRef } = useKeyboardAware()

  // Load resolution options from /api/settings/options (lazy — only when
  // 'complete' action is opened the first time)
  React.useEffect(() => {
    if (!action || action.endpoint !== 'complete' || resOptionsLoaded) return
    setResOptionsLoaded(true)
    fetch('/api/settings/options', {
      headers: {
        Authorization: `Bearer ${useAuthStore.getState()?.token ?? ''}`,
      },
    })
      .then((r) => r.json())
      .then((data) => {
        const resolutions = data.resolutions ?? []
        setResolutionOptions(resolutions)
      })
      .catch(() => {
        // silent fail — fallback to free-text only
      })
  }, [action, resOptionsLoaded])

  // Camera overlay state
  const [cameraOpen, setCameraOpen] = React.useState(false)
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const cameraInputRef = React.useRef<HTMLInputElement>(null)

  // Reset when action changes
  React.useEffect(() => {
    setRemark('')
    setPhotos([])
    setSelectedResolutions([])
    setError(null)
  }, [action?.key])

  // Cleanup camera on unmount
  React.useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
  }, [])

  if (!action) return null

  const Icon = action.icon

  async function openCamera() {
    if (cameraOpen) return
    if (photos.length >= MAX_AFTER_PHOTOS) {
      toast.error(`เพิ่มรูปได้สูงสุด ${MAX_AFTER_PHOTOS} รูป`)
      return
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error('เบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      streamRef.current = stream
      setCameraOpen(true)
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream
      }, 50)
    } catch {
      toast.error('ไม่สามารถเปิดกล้องได้ ตรวจสอบสิทธิ์การใช้งาน')
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setCameraOpen(false)
  }

  function capturePhoto() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const w = video.videoWidth || 1280
    const h = video.videoHeight || 720
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, w, h)
    const maxW = 1024
    let dataUrl: string
    if (w > maxW) {
      const scale = maxW / w
      const tmp = document.createElement('canvas')
      tmp.width = maxW
      tmp.height = Math.max(1, Math.round(h * scale))
      const tmpCtx = tmp.getContext('2d')
      if (!tmpCtx) {
        dataUrl = canvas.toDataURL('image/jpeg', 0.7)
      } else {
        tmpCtx.drawImage(canvas, 0, 0, tmp.width, tmp.height)
        dataUrl = tmp.toDataURL('image/jpeg', 0.7)
      }
    } else {
      dataUrl = canvas.toDataURL('image/jpeg', 0.7)
    }
    setPhotos((prev) => [...prev, dataUrl].slice(0, MAX_AFTER_PHOTOS))
    stopCamera()
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    const remaining = MAX_AFTER_PHOTOS - photos.length
    if (remaining <= 0) {
      toast.error(`เพิ่มรูปได้สูงสุด ${MAX_AFTER_PHOTOS} รูป`)
      e.target.value = ''
      return
    }
    try {
      const list = Array.from(files).slice(0, remaining)
      const loaded: string[] = []
      for (const file of list) {
        const dataUrl = await readFileAsDataUrl(file)
        loaded.push(dataUrl)
      }
      setPhotos((prev) => [...prev, ...loaded].slice(0, MAX_AFTER_PHOTOS))
    } catch {
      toast.error('ไม่สามารถอ่านไฟล์รูปได้')
    } finally {
      e.target.value = ''
    }
  }

  async function submit() {
    if (!action) return
    setError(null)
    if (action.remarkRequired && !remark.trim()) {
      setError('กรุณาเพิ่มหมายเหตุ')
      return
    }
    setSubmitting(true)
    // Capture the primary request for offline-queue fallback.
    // Only the FIRST fetch in each branch is queued — secondary requests
    // (photo uploads, message posts) are best-effort and use .catch(() => undefined)
    // already, so they degrade gracefully on their own.
    let queuedRequest: {
      url: string
      method: 'POST' | 'PUT'
      body: unknown
      label: string
    } | null = null
    try {
      const note = remark.trim()
      const firstPhoto = photos[0] ?? null

      if (action.endpoint === 'put-status' && action.targetStatus) {
        // 1. Update status
        const body: Record<string, unknown> = {
          status: action.targetStatus,
          actor: actorName,
        }
        if (note) {
          body.detailsAdmin = note
        }
        queuedRequest = {
          url: `/api/work-orders/${encodeURIComponent(workOrderId)}`,
          method: 'PUT',
          body,
          label: `เปลี่ยนสถานะเป็น ${STATUS_META[action.targetStatus]?.label ?? action.targetStatus} (WO ${workOrderId})`,
        }
        const res = await fetch(
          `/api/work-orders/${encodeURIComponent(workOrderId)}`,
          {
            method: 'PUT',
            headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
            body: JSON.stringify(body),
          },
        )
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(j.error ?? 'อัปเดตสถานะไม่สำเร็จ')
        }
        // 2. Upload photos (if any) for the new stage
        await uploadPhotos(workOrderId, photos, 'onsite')
        // 3. Add a system message about the transition
        const transitionLabel = STATUS_META[action.targetStatus].label
        const msg = note
          ? `เปลี่ยนสถานะเป็น "${transitionLabel}" — ${note}`
          : `เปลี่ยนสถานะเป็น "${transitionLabel}"`
        await fetch(
          `/api/work-orders/${encodeURIComponent(workOrderId)}/messages`,
          {
            method: 'POST',
            headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              message: msg,
              author: actorName,
              // See note above: no `user` binding in scope in this component.
              authorRole: (useAuthStore.getState()?.user?.role ??
                'user') as 'admin' | 'staff' | 'reporter' | 'system',
              actor: actorName,
            }),
          },
        ).catch(() => undefined)
        toast.success(`อัปเดตเป็น "${transitionLabel}" แล้ว`)
      } else if (action.endpoint === 'complete') {
        // POST /complete — sets COMPLETED + workCompletedAt + closedAt
        // Combine selected resolutions + free-text note into the resolution field
        const combinedResolution = [
          ...selectedResolutions,
          note.trim(),
        ].filter(Boolean).join('\n')
        const body = {
          note: combinedResolution || note,
          resolution: combinedResolution || note,
          resolutionGroup: selectedResolutions.length > 0
            ? resolutionOptions.find((o) => o.value === selectedResolutions[0])?.group ?? null
            : null,
          picAfter: firstPhoto,
          actor: actorName,
        }
        queuedRequest = {
          url: `/api/work-orders/${encodeURIComponent(workOrderId)}/complete`,
          method: 'POST',
          body,
          label: `ปิดงาน WO ${workOrderId}`,
        }
        const res = await fetch(
          `/api/work-orders/${encodeURIComponent(workOrderId)}/complete`,
          {
            method: 'POST',
            headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
            body: JSON.stringify(body),
          },
        )
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(j.error ?? 'ปิดงานไม่สำเร็จ')
        }
        // Upload remaining photos (skip first since it's stored as picAfter)
        const remaining = photos.slice(1)
        if (remaining.length > 0) {
          await uploadPhotos(workOrderId, remaining, 'after')
        }
        toast.success('ปิดงานเรียบร้อย')
      } else if (action.endpoint === 'message') {
        // POST /messages — for "ส่งคืนอุปกรณ์" finalization
        const msg = note
          ? `ส่งคืนอุปกรณ์แล้ว — ${note}`
          : 'ส่งคืนอุปกรณ์แล้ว'
        const body = {
          message: msg,
          author: actorName,
          // NOTE: this component reads auth via `useAuthStore.getState()` (there is
          // no `user` binding in scope here) — mirror that instead of referencing an
          // undefined identifier, which would throw a ReferenceError at runtime.
          authorRole: (useAuthStore.getState()?.user?.role ??
            'user') as 'admin' | 'staff' | 'reporter' | 'system',
          actor: actorName,
        }
        queuedRequest = {
          url: `/api/work-orders/${encodeURIComponent(workOrderId)}/messages`,
          method: 'POST',
          body,
          label: `ส่งคืนอุปกรณ์ WO ${workOrderId}`,
        }
        const res = await fetch(
          `/api/work-orders/${encodeURIComponent(workOrderId)}/messages`,
          {
            method: 'POST',
            headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
            body: JSON.stringify(body),
          },
        )
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(j.error ?? 'บันทึกไม่สำเร็จ')
        }
        // Also append to detailsAdmin via PUT
        await fetch(`/api/work-orders/${encodeURIComponent(workOrderId)}`, {
          method: 'PUT',
          headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            detailsAdmin: note ? `ส่งคืนอุปกรณ์: ${note}` : 'ส่งคืนอุปกรณ์แล้ว',
            actor: actorName,
          }),
        }).catch(() => undefined)
        // Upload photos as "after" stage
        await uploadPhotos(workOrderId, photos, 'after')
        toast.success('บันทึกการส่งคืนอุปกรณ์แล้ว')
      }

      await onDone()
    } catch (e) {
      // Offline queue fallback — only when the network is actually down,
      // not on server-side validation errors (those still surface to the user).
      if (!navigator.onLine && queuedRequest) {
        addToQueue(queuedRequest)
        toast.success('บันทึกไว้ในคิว จะส่งอัตโนมัติเมื่อออนไลน์')
        // Close the action sheet so the technician can continue with the
        // next work order; the queue will replay the request when online.
        onClose()
        return
      }
      setError(e instanceof Error ? e.message : 'อัปเดตไม่สำเร็จ')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet
      open={!!action}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <SheetContent
        side="bottom"
        ref={scrollRef}
        // Bug fix: when keyboard opens, shrink max height so sheet fits above keyboard
        // + use dvh (dynamic viewport height) which accounts for mobile browser UI
        style={{
          maxHeight: keyboardHeight > 0 ? `calc(100dvh - ${keyboardHeight}px)` : '90dvh',
        }}
        className="mx-auto w-full max-w-md overflow-y-auto p-0 transition-[max-height] duration-200"
      >
        <SheetHeader className="pb-2">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-950 dark:text-orange-300">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <SheetTitle className="text-base">{action.label}</SheetTitle>
              <SheetDescription className="text-xs">
                {action.description}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          {/* Resolution selector — เลือกวิธีแก้ไขจากข้อมูลมาตรฐาน (only for 'complete' action) */}
          {action.endpoint === 'complete' && resolutionOptions.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                วิธีแก้ไขปัญหา
                <span className="ml-2 text-[10px] text-slate-400 font-normal">
                  (เลือกได้หลายข้อ · จากข้อมูลมาตรฐาน)
                </span>
              </Label>
              <ResolutionSelector
                options={resolutionOptions}
                selected={selectedResolutions}
                onChange={setSelectedResolutions}
              />
              {selectedResolutions.length > 0 && (
                <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/30 p-2 text-xs">
                  <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                    เลือกแล้ว {selectedResolutions.length} ข้อ:
                  </span>{' '}
                  <span className="text-slate-600 dark:text-slate-300">
                    {selectedResolutions.join(', ')}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Resolution text — ผลการแก้ไข (free text, for 'complete' action) */}
          {action.endpoint === 'complete' && (
            <div className="space-y-1.5">
              <Label htmlFor="mmw-resolution" className="text-sm font-medium">
                รายละเอียดเพิ่มเติม
                <span className="ml-2 text-xs text-slate-400 font-normal">
                  {selectedResolutions.length > 0 ? '(เพิ่มเติมจากที่เลือก)' : '(บอกผลที่ทำ)'}
                </span>
              </Label>
              <Textarea
                id="mmw-resolution"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="บอกผลที่ทำ เช่น เปลี่ยน Drum"
                rows={3}
                maxLength={1000}
                className="text-base"
                aria-required={action.remarkRequired && selectedResolutions.length === 0}
              />
              <p className="text-right text-[11px] text-muted-foreground">
                {remark.length}/1000
              </p>
            </div>
          )}

          {/* Remark — หมายเหตุเพิ่มเติม (for all actions) */}
          {action.endpoint !== 'complete' && (
            <div className="space-y-1.5">
              <Label htmlFor="mmw-remark" className="text-sm font-medium">
                หมายเหตุ / รายละเอียด
                {action.remarkRequired && (
                  <span className="ml-1 text-rose-500">*</span>
                )}
              </Label>
              <Textarea
                id="mmw-remark"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder={
                  action.endpoint === 'message'
                    ? 'บันทึกการส่งคืน (เช่น ส่งคืนที่ตู้ XYZ, ผู้รับ: คุณ A)'
                    : 'หมายเหตุเพิ่มเติม (ถ้ามี)'
                }
                rows={3}
                maxLength={1000}
                className="text-base"
                aria-required={action.remarkRequired}
              />
              <p className="text-right text-[11px] text-muted-foreground">
                {remark.length}/1000
              </p>
            </div>
          )}

          {/* Photo capture (optional) */}
          {action.photoOptional && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                รูปภาพประกอบ{' '}
                <span className="text-muted-foreground">
                  (ถ่ายหรือเลือก — สูงสุด {MAX_AFTER_PHOTOS} รูป)
                </span>
              </Label>
              {photos.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {photos.map((img, i) => (
                    <div
                      key={i}
                      className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
                    >
                      <img
                        src={img}
                        alt={`รูป ${i + 1}`}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setPhotos((prev) => prev.filter((_, idx) => idx !== i))
                        }
                        aria-label={`ลบรูปที่ ${i + 1}`}
                        className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-rose-600 text-white shadow-sm hover:bg-rose-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={openCamera}
                  disabled={photos.length >= MAX_AFTER_PHOTOS}
                  className="h-11"
                >
                  <Camera className="mr-2 h-4 w-4" />
                  ถ่ายภาพ
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={photos.length >= MAX_AFTER_PHOTOS}
                  className="h-11"
                >
                  <ImageIcon className="mr-2 h-4 w-4" />
                  เลือกจากคลัง
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={onFileChange}
                className="hidden"
                aria-hidden="true"
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <SheetFooter className="flex-row gap-2 border-t p-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
            className="h-12 flex-1"
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={submitting}
            aria-busy={submitting}
            className={cn('h-12 flex-1', action.buttonClass)}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                กำลังบันทึก…
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                ยืนยัน
              </>
            )}
          </Button>
        </SheetFooter>

        {/* Full-screen camera overlay (for sheet's photo capture) */}
        {cameraOpen && (
          <div className="fixed inset-0 z-[10000] flex flex-col bg-black">
            <div className="flex items-center justify-between p-4">
              <span className="text-sm text-white">ถ่ายภาพประกอบ</span>
              <button
                type="button"
                onClick={stopCamera}
                aria-label="ปิดกล้อง"
                className="flex h-9 w-9 items-center justify-center rounded-full text-white hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="flex-1 object-contain"
            />
            <canvas ref={canvasRef} className="hidden" />
            <div className="p-6">
              <Button
                type="button"
                onClick={capturePhoto}
                className="h-12 w-full bg-white text-black hover:bg-white/90"
              >
                <Camera className="mr-2 h-5 w-5" />
                ถ่ายภาพ
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// Upload multiple photos as a single stage.
async function uploadPhotos(
  workOrderId: string,
  photos: string[],
  stage: 'onsite' | 'after',
): Promise<void> {
  for (const dataUrl of photos) {
    try {
      await fetch(`/api/work-orders/${encodeURIComponent(workOrderId)}/images`, {
        method: 'POST',
        headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          stage,
          image_data: dataUrl,
        }),
      })
    } catch {
      // silent — best-effort upload
    }
  }
}

// ── ResolutionSelector ────────────────────────────────────────────────
// เลือกวิธีแก้ไขปัญหาแบบ multi-select — จัดกลุ่มตาม resolution group
// (ซ่อมสำเร็จ / เปลี่ยนอะไหล่ / ปรับแต่ง / ส่งซ่อมภายนอก / อื่นๆ)
// Collapsible sections + checkbox multi-select (เหมือน ProblemCategorySelector)
//
function ResolutionSelector({
  options,
  selected,
  onChange,
}: {
  options: Array<{ id?: string; value: string; group?: string }>
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const groups = React.useMemo(() => {
    const map = new Map<string, typeof options>()
    for (const opt of options) {
      const g = opt.group || 'อื่นๆ'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(opt)
    }
    return Array.from(map.entries())
  }, [options])

  const [expandedGroups, setExpandedGroups] = React.useState<Set<string>>(
    new Set(groups.length > 0 ? [groups[0][0]] : []),
  )

  const toggleGroup = (g: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      return next
    })
  }

  const toggleItem = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((s) => s !== value))
    } else {
      onChange([...selected, value])
    }
  }

  return (
    <div className="space-y-2">
      {groups.map(([groupName, items]) => {
        const isExpanded = expandedGroups.has(groupName)
        const count = items.filter((i) => selected.includes(i.value)).length
        return (
          <div
            key={groupName}
            className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
          >
            <button
              type="button"
              onClick={() => toggleGroup(groupName)}
              className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
              aria-expanded={isExpanded}
            >
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {groupName}
                </span>
                {count > 0 && (
                  <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {count}
                  </span>
                )}
              </span>
              <span className="text-xs text-slate-400">
                {items.length} ข้อ
                <span className="ml-1 inline-block transition-transform" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)' }}>
                  ›
                </span>
              </span>
            </button>
            {isExpanded && (
              <div className="space-y-1 border-t border-slate-100 p-2 dark:border-slate-700">
                {items.map((item) => {
                  const isSelected = selected.includes(item.value)
                  return (
                    <label
                      key={item.id ?? item.value}
                      className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                        isSelected
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                          : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleItem(item.value)}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-500"
                      />
                      <span className="flex-1">{item.value}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
