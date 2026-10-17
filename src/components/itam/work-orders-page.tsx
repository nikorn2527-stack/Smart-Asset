'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogClose,
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
import { CameraCapture } from './camera-capture'
import {
  Plus,
  RefreshCw,
  Search,
  Wrench,
  Clock,
  CheckCircle2,
  XCircle,
  MapPin,
  User,
  Phone,
  Send,
  MessageSquare,
  AlertTriangle,
  CalendarClock,
  Image as ImageIcon,
  Building2,
  Edit3,
  Trash2,
  ShieldCheck,
  PackageOpen,
  ClipboardList,
  Hash,
  Package,
  Check,
  Box,
  Printer,
  ScanLine,
  Eye,
  X,
  Calculator,
  ChevronRight,
  Unlock,
} from 'lucide-react'
import { formatThaiDate, relativeTime, type Site, canSelectSite } from './types'
import { TemplatePrintDialog } from './template-print-dialog'
import { Combobox } from './combobox'
import { InlineGuidance } from './stepper'
import { useAppStore } from '@/store/app-store'
import { useT, useFormatDateTime, useLang, getCurrentLang, localeFor } from '@/store/i18n-store'
import { useAuthStore } from '@/store/auth-store'
import { normalizeImageUrlThumb, normalizeImageUrl } from '@/lib/image-url'
import { PaginationBar } from './pagination-bar'

// ============================================================
// Auth headers helper — every fetch() in this file MUST pass
// `headers: getAuthHeaders()` (or merge with Content-Type) so the
// API can verify the JWT session via `requireAuth()`. Without the
// Bearer token the endpoints return 401/403 and the dialogs never
// load their data.
// ============================================================
function getAuthHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const token = useAuthStore.getState()?.token
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

// ============================================================
// Types
// ============================================================
export interface WorkOrderMessage {
  id: string
  workOrderId: string
  message: string
  author: string | null
  authorRole: string | null
  createdAt: string
}

export interface WorkOrderReview {
  id: string
  workOrderId: string
  rating: number
  comment: string | null
  reviewedBy: string | null
  createdAt: string
}

export interface ExternalMeta {
  clientName?: string
  place?: string
  contactPhone?: string
  serials?: string[]
}

export interface WorkOrderImage {
  id: string
  workOrderId: string
  stage: 'before' | 'onsite' | 'after'
  image_data: string
  fileName: string | null
  uploadedBy: string | null
  createdAt: string
}

export interface WorkOrder {
  id: string
  woNumber: string | null
  systemJobNo: string | null
  legacyJobNo: string | null
  subject: string
  building: string | null
  location: string | null
  details: string | null
  priority: string
  reporterName: string | null
  reporterEmail: string | null
  tel: string | null
  employeeCode: string | null
  submissionSource: string
  trackable: boolean
  externalMeta: string | null
  picBefore: string | null
  picOnsite: string | null
  picAfter: string | null
  status: string
  acceptStatus: string | null
  assignedTo: string | null
  assignedBy: string | null
  assignedAt: string | null
  assignmentNote: string | null
  detailsAdmin: string | null
  dateAdmin: string | null
  resolution: string | null
  resolutionGroup: string | null
  editUnlockActive: boolean
  editUnlockBy: string | null
  editUnlockAt: string | null
  editUnlockNote: string | null
  workCompletedAt: string | null
  closedAt: string | null
  canceledAt: string | null
  cancelReason: string | null
  deviceId: string | null
  // ── VISUAL-TEMPLATE-EDITOR: TemplatePrintat Fix Keep ──
  printTemplateId: string | null
  // Special (Has cost) — Task ID: SPECIALFEE-WOPATTERN-APPROVAL
  isSpecialFee?: boolean
  createdAt: string
  updatedAt: string
  device?: {
    id: string
    assetCode: string
    name: string
    brand: string
    model: string
    site: string
  } | null
  messages?: WorkOrderMessage[]
  review?: WorkOrderReview | null
  images?: WorkOrderImage[]
}

interface WorkOrderListResponse {
  data: WorkOrder[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  stats: Record<string, number>
}

interface WorkOrderDetail extends WorkOrder {
  messages: WorkOrderMessage[]
  review: WorkOrderReview | null
}

interface ImagesGroupedResponse {
  data: WorkOrderImage[]
  grouped: {
    before: WorkOrderImage[]
    onsite: WorkOrderImage[]
    after: WorkOrderImage[]
  }
}

interface SubjectOption {
  group: string
  value: string
  default_priority: string
}

interface ResolutionOption {
  group: string
  value: string
}

interface BuildingOption {
  group: string
  value: string
}

interface OptionsResponse {
  subjects: SubjectOption[]
  resolutions: ResolutionOption[]
  buildings?: BuildingOption[]
}

interface DeviceLookupItem {
  id: string
  assetCode: string
  name: string
  brand: string
  model: string
  type?: string
  site: string
  building: string | null
  location: string | null
  department?: string | null
  serialNumber: string | null
}

// ============================================================
// Stock parts (linked to a work order)
// ============================================================
interface PartsStockItem {
  id: string
  productCode: string
  productName: string
  unit: string
  quantity: number
  unitCost: number | null
  active: boolean
  category?: string | null
  brand?: string | null
  model?: string | null
  // ── WO-PARTS-FLOW Level 2+: cost model + expected usage defaults ──
  costModel?: string | null // 'fixed' | 'per-page' | 'per-hour' | 'monthly' | 'per-device'
  expectedDevicesPerUnit?: number | null
  expectedHoursPerUnit?: number | null
  expectedPagesPerUnit?: number | null
  ratePerPage?: number | null
  ratePerHour?: number | null
  ratePerMonth?: number | null
  ratePerDevice?: number | null
}

interface PartsTransaction {
  id: string
  txnNumber: string | null
  stockItemId: string
  productCode: string | null
  productName: string | null
  type: string
  quantity: number
  unit: string | null
  balanceAfter: number
  reason: string | null
  requester: string | null
  purpose: string | null
  workOrderId: string | null
  workOrderNo: string | null
  approver: string | null
  approvedAt: string | null
  approvalStatus: string | null
  approvalMode: string | null
  rejectReason: string | null
  txnDate: string
  remark: string | null
  createdAt: string
  stockItem?: {
    productCode: string
    productName: string
    unit: string
    quantity: number
    active: boolean
  } | null
}

interface PartsListResponse {
  data: PartsTransaction[]
  summary: {
    total: number
    pending: number
    approved: number
    rejected: number
    immediate: number
  }
}

interface PartsListApiResponse {
  data: PartsStockItem[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

// ============================================================
// Constants
// ============================================================
const STATUS_OPTIONS = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'PENDING_REVIEW', label: 'รอตรวจสอบ' },
  { value: 'PENDING', label: 'รอดำเนินการ' },
  { value: 'IN_PROGRESS', label: 'กำลังซ่อม' },
  { value: 'WAITING_PARTS', label: 'รออะไหล่' },
  { value: 'COMPLETED', label: 'เสร็จแล้ว' },
  { value: 'CANCELLED', label: 'ยกเลิก' },
] as const

const PRIORITY_OPTIONS = [
  { value: 'all', label: 'ความเร่งด่วนทั้งหมด' },
  // Values MUST match the API's VALID_PRIORITIES (src/app/api/work-orders/route.ts)
  // — anything else is silently dropped by the filter.
  { value: 'ปกติ', label: 'ปกติ' },
  { value: 'ปานกลาง', label: 'ปานกลาง' },
  { value: 'สูง', label: 'สูง' },
  { value: 'ด่วน', label: 'ด่วน' },
] as const

const PRIORITY_FORM_OPTIONS = [
  // Same Thai values the POST endpoint validates against.
  { value: 'ปกติ', label: 'ปกติ' },
  { value: 'ปานกลาง', label: 'ปานกลาง' },
  { value: 'สูง', label: 'สูง' },
  { value: 'ด่วน', label: 'ด่วน' },
] as const

const PAGE_SIZE = 12

function statusLabel(status: string): string {
  return STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'PENDING_REVIEW':
      // More saturated than PENDING's amber — needs immediate attention.
      return 'border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-200'
    case 'PENDING':
      return 'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
    case 'IN_PROGRESS':
      return 'border-blue-200 bg-blue-100 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300'
    case 'WAITING_PARTS':
      return 'border-purple-200 bg-purple-100 text-purple-700 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300'
    case 'COMPLETED':
      return 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
    case 'CANCELLED':
      return 'border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300'
    default:
      return 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
}

function priorityBadgeClass(priority: string): string {
  // DB stores Thai priorities (ปกติ/ปานกลาง/สูง/ด่วน). Keep the legacy
  // English values too so old rows / other modules still colour correctly.
  switch (priority) {
    case 'ด่วน':
    case 'Urgent':
      return 'border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300'
    case 'สูง':
    case 'High':
      return 'border-orange-200 bg-orange-100 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300'
    case 'ปานกลาง':
    case 'Medium':
      return 'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
    case 'ปกติ':
    case 'Normal':
    default:
      return 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(localeFor(getCurrentLang()), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function parseExternalMeta(raw: string | null): ExternalMeta | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return null
    return obj as ExternalMeta
  } catch {
    return null
  }
}

// ============================================================
// Main component
// ============================================================
interface NewFormState {
  // Task ID: UX-GAPS-3-ITEMS — wizard step 1: pick job type first, then
  // show only the relevant fields in step 2. '' = step 1 (no selection yet).
  jobType: '' | 'internal' | 'external' | 'guest'
  subject: string
  subjectGroup: string
  building: string
  location: string
  details: string
  priority: string
  reporterName: string
  tel: string
  employeeCode: string
  isExternal: boolean
  // External fields
  clientName: string
  place: string
  contactPhone: string
  serials: string[]
  serialInput: string
  // Device lookup (internal)
  deviceId: string | null
  deviceSearch: string
  // Multi-image (before stage) — up to 9 base64 data URLs
  picBeforeImages: string[]
  // Special (Has cost) — Task ID: SPECIALFEE-WOPATTERN-APPROVAL
  isSpecialFee: boolean
}

const EMPTY_FORM: NewFormState = {
  jobType: '',
  subject: '',
  subjectGroup: '',
  building: '',
  location: '',
  details: '',
  // Thai value matching the API's VALID_PRIORITIES — a custom subject never
  // passes handleSubjectChange, so this default IS what gets submitted.
  priority: 'ปกติ',
  reporterName: '',
  tel: '',
  employeeCode: '',
  isExternal: false,
  clientName: '',
  place: '',
  contactPhone: '',
  serials: [],
  serialInput: '',
  deviceId: null,
  deviceSearch: '',
  picBeforeImages: [],
  isSpecialFee: false,
}

// 9 images per stage (matches user requirement)
const MAX_IMAGES_PER_STAGE = 9
// 1.5 MB hard cap on a single base64 data URL (~1 MB image after JPEG q=0.7)
const MAX_PIC_BYTES = 1_500_000

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Compress an image file to a JPEG data URL.
 *
 * - Max dimension: 1024px (preserves aspect ratio)
 * - JPEG quality starts at 0.7 and steps down to ~0.4 if the output is still
 *   larger than `maxBytes`
 *
 * Falls back to the original data URL if canvas drawing fails.
 */
async function compressImage(file: File, maxBytes = MAX_PIC_BYTES): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file)
  // For non-image inputs (shouldn't happen given accept="image/*"), skip canvas
  if (!dataUrl.startsWith('data:image')) return dataUrl
  return new Promise<string>((resolve) => {
    const img = new window.Image()
    img.onload = () => {
      const maxDim = 1024
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(dataUrl)
        return
      }
      // White background to avoid black-on-transparent PNGs turning into black
      // when re-encoded as JPEG.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      let quality = 0.7
      let out = canvas.toDataURL('image/jpeg', quality)
      while (out.length > maxBytes && quality > 0.4) {
        quality -= 0.1
        out = canvas.toDataURL('image/jpeg', quality)
      }
      resolve(out)
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

export function WorkOrdersPage() {
  const t = useT()
  const { lang } = useLang()
  const fmtDateTime = useFormatDateTime()
  const qc = useQueryClient()
  const [search, setSearch] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<string>('all')
  const [priorityFilter, setPriorityFilter] = React.useState<string>('all')
  const [siteFilter, setSiteFilter] = React.useState<string>('all')
  const [page, setPage] = React.useState(1)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [form, setForm] = React.useState<NewFormState>(EMPTY_FORM)
  const [saving, setSaving] = React.useState(false)
  const [detailId, setDetailId] = React.useState<string | null>(null)

  // ── Site filter visibility: Show dropdown Only user atSelect site  ──
  // superadmin/admin → Show (seeAll site, SelectFilter)
  // user atHas 2+ sites → Show (SelectFilter)
  // user atHas 1 site or 0 site → Hide (Nonebenefit)
  const authUser = useAuthStore((s) => s.user)
  const showSiteFilter = authUser ? canSelectSite(authUser) : false

  // ── QR/barcode scan handling for the list search box ──
  // Only react when the create dialog is NOT open (otherwise the create
  // form's device-search field is the intended target).
  const qrScanNonce = useAppStore((s) => s.qrScanNonce)
  const lastQrScan = useAppStore((s) => s.lastQrScan)
  React.useEffect(() => {
    if (qrScanNonce === 0) return
    if (createOpen) return
    if (!lastQrScan) return
    setSearch(lastQrScan)
  }, [qrScanNonce, createOpen, lastQrScan])

  // Load subject + resolution options once
  const optionsQuery = useQuery<OptionsResponse>({
    queryKey: ['wo-options'],
    queryFn: async () => {
      const res = await fetch('/api/settings/options', {
        headers: getAuthHeaders(),
      })
      if (!res.ok) throw new Error('Failed to load options')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  // Debounce search to avoid spamming the API on every keystroke
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  React.useEffect(() => {
    setPage(1)
  }, [statusFilter, priorityFilter, siteFilter])

  // ── Sites list (for site filter dropdown — superadmin can filter to a single site) ──
  const { data: sitesData } = useQuery<Site[]>({
    queryKey: ['wo-sites'],
    queryFn: async () => {
      const res = await fetch('/api/sites', { headers: getAuthHeaders() })
      if (!res.ok) return []
      const json = (await res.json()) as { sites?: Site[] } | Site[]
      return Array.isArray(json) ? json : (json.sites ?? [])
    },
    staleTime: 60_000,
  })
  const sites = sitesData ?? []

  const listQuery = useQuery<WorkOrderListResponse>({
    queryKey: [
      'work-orders',
      debouncedSearch,
      statusFilter,
      priorityFilter,
      siteFilter,
      page,
    ],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (priorityFilter !== 'all') params.set('priority', priorityFilter)
      if (siteFilter !== 'all') params.set('site', siteFilter)
      params.set('page', String(page))
      params.set('pageSize', String(PAGE_SIZE))
      const res = await fetch(`/api/work-orders?${params.toString()}`, {
        headers: getAuthHeaders(),
      })
      if (!res.ok) throw new Error('Failed to load work orders')
      return res.json()
    },
  })

  const items = listQuery.data?.data ?? []
  const stats = listQuery.data?.stats ?? {
    PENDING: 0,
    IN_PROGRESS: 0,
    COMPLETED: 0,
    CANCELLED: 0,
  }
  const pagination = listQuery.data?.pagination

  function openCreate() {
    setForm({ ...EMPTY_FORM })
    setCreateOpen(true)
  }

  async function handleCreate() {
    if (!form.subject.trim()) {
      toast.error('กรุณาระบุประเภทปัญหา')
      return
    }
    // ── Per-job-type validation (Task ID: UX-GAPS-3-ITEMS) ──
    // internal: no required reporter fields (uses logged-in user)
    // external: clientName required
    // guest:    reporterName + tel required (ContactDirectory verification)
    if (form.jobType === 'external') {
      if (!form.clientName.trim()) {
        toast.error('กรุณาระบุชื่อลูกค้าภายนอก')
        return
      }
    } else if (form.jobType === 'guest') {
      if (!form.reporterName.trim() || !form.tel.trim()) {
        toast.error('ผู้แจ้ง (Guest) ต้องระบุชื่อและเบอร์โทรเพื่อยืนยันตัวตน')
        return
      }
    }
    try {
      setSaving(true)
      const payload: Record<string, unknown> = {
        subject: form.subject.trim(),
        details: form.details.trim() || null,
        priority: form.priority,
        picBeforeImages: form.picBeforeImages,
        isSpecialFee: form.isSpecialFee === true,
      }
      if (form.jobType === 'internal') {
        // Staff submission via session — reporter is the logged-in user.
        // Skip guest contact validation; building/location/device still
        // optional.
        payload.submissionSource = 'session'
        payload.reporterName = form.reporterName.trim() || authUser?.name || null
        payload.reporterEmail = authUser?.email ?? null
        payload.tel = form.tel.trim() || null
        payload.employeeCode = form.employeeCode.trim() || null
        payload.building = form.building.trim() || null
        payload.location = form.location.trim() || null
        payload.deviceId = form.deviceId || null
        payload.skipGuestValidation = true
      } else if (form.jobType === 'external') {
        // External client work — uses externalMeta, skips ContactDirectory.
        payload.submissionSource = 'guest'
        payload.isExternal = true
        payload.externalMeta = {
          clientName: form.clientName.trim(),
          place: form.place.trim() || undefined,
          contactPhone: form.contactPhone.trim() || undefined,
          serials: form.serials.length > 0 ? form.serials : undefined,
        }
        // For external WOs the reporter is the staff filling the form
        payload.reporterName = form.reporterName.trim() || null
        payload.tel = form.tel.trim() || null
        payload.skipGuestValidation = true
      } else {
        // Guest flow — walk-in reporter requires ContactDirectory verification.
        payload.submissionSource = 'guest'
        payload.reporterName = form.reporterName.trim()
        payload.tel = form.tel.trim()
        payload.employeeCode = form.employeeCode.trim() || null
        payload.building = form.building.trim() || null
        payload.location = form.location.trim() || null
        payload.deviceId = form.deviceId || null
      }
      const res = await fetch('/api/work-orders', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'บันทึกไม่สำเร็จ')
      }
      const json = await res.json()
      toast.success(`สร้างใบแจ้งซ่อม ${json.data?.woNumber ?? ''} แล้ว`)
      setCreateOpen(false)
      qc.invalidateQueries({ queryKey: ['work-orders'] })
      // Open the new detail right away
      if (json.data?.id) setDetailId(json.data.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  // Inline guidance: check whether any approver-capable user exists.
  // Uses the same /api/settings/completion endpoint that the Settings
  // page consumes, then isolates the 'approvers' item.
  const completionQuery = useQuery<{
    items: Array<{ key: string; status: string; canEdit: boolean; reason?: string }>
  }>({
    queryKey: ['settings-completion'],
    queryFn: async () => {
      const res = await fetch('/api/settings/completion')
      if (!res.ok) return { items: [] }
      return res.json()
    },
    staleTime: 60_000,
  })
  const approversItem = completionQuery.data?.items?.find(i => i.key === 'approvers')
  const showNoApproverGuidance =
    !!approversItem &&
    approversItem.status !== 'complete' &&
    approversItem.status !== 'not_required' &&
    approversItem.canEdit !== false
  const [approverGuidanceDismissed, setApproverGuidanceDismissed] =
    React.useState(false)

  return (
    <div className="flex h-full w-full flex-col p-3 md:p-4">
      {/* Header */}
      <div className="flex flex-shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold md:text-2xl">
            <Wrench className="h-6 w-6 text-orange-500" />
            แจ้งซ่อม
          </h1>
          <p className="text-sm text-muted-foreground">
            ระบบแจ้งซ่อมครบวงจร — แจ้ง → รับ → ซ่อม → ปิดงาน (รอรับเครื่องคืนจากลูกค้าภายนอก)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button"
            variant="outline"
            size="sm"
            onClick={() => listQuery.refetch()}
            disabled={listQuery.isFetching}
            aria-label={t('settings.refresh')}
          >
            <RefreshCw
              className={listQuery.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
            />
            <span className="hidden sm:inline">{t('settings.refresh')}</span>
          </Button>
          <Button type="button" size="sm" onClick={openCreate} className="bg-orange-500 hover:bg-orange-600">
            <Plus className="h-4 w-4" />
            แจ้งซ่อมใหม่
          </Button>
        </div>
      </div>

      {/* Inline Guidance (§5.3): warn at the point of work if no
          approver has been configured. Lets the user jump to
          Settings → Users to fix it without leaving Work Orders. */}
      {showNoApproverGuidance && !approverGuidanceDismissed && (
        <div className="mt-3">
          <InlineGuidance
            message={
              approversItem?.reason
                ? `${approversItem.reason} — งานจะสร้างได้ แต่ส่งอนุมัติไม่ได้ จะค้างในสถานะ PENDING_REVIEW`
                : 'ยังไม่มีผู้อนุมัติสำหรับ workflow นี้ — งานจะสร้างได้ แต่ส่งอนุมัติไม่ได้'
            }
            actionLabel="ไปกำหนดผู้อนุมัติ"
            onAction={() => {
              // Navigate to Settings → Users tab via the global app
              // store so the SPA shell switches routes.
              window.location.hash = '#settings'
              const url = new URL('/settings?tab=users', window.location.origin)
              window.location.assign(url.pathname + url.search)
            }}
            dismissLabel="ทำภายหลัง"
            onDismiss={() => setApproverGuidanceDismissed(true)}
          />
        </div>
      )}

      {/* KPI stats bar */}
      <div className="grid flex-shrink-0 grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          label="รอตรวจสอบ"
          value={stats.PENDING_REVIEW ?? 0}
          icon={<AlertTriangle className="h-5 w-5" />}
          color="orange"
        />
        <KpiCard
          label="รอดำเนินการ"
          value={stats.PENDING ?? 0}
          icon={<Clock className="h-5 w-5" />}
          color="amber"
        />
        <KpiCard
          label="กำลังซ่อม"
          value={(stats.IN_PROGRESS ?? 0) + (stats.WAITING_PARTS ?? 0)}
          icon={<Wrench className="h-5 w-5" />}
          color="blue"
        />
        <KpiCard
          label="เสร็จแล้ว"
          value={stats.COMPLETED ?? 0}
          icon={<CheckCircle2 className="h-5 w-5" />}
          color="emerald"
        />
        <KpiCard
          label="ยกเลิก"
          value={stats.CANCELLED ?? 0}
          icon={<XCircle className="h-5 w-5" />}
          color="rose"
        />
      </div>

      {/* Filter bar */}
      <Card className="flex-shrink-0 gap-3 py-3">
        <CardContent className="flex flex-col gap-3 px-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหา เลขที่ใบงาน / ปัญหา / สถานที่ / ผู้แจ้ง / โทรศัพท์ / รหัสพนักงาน / ช่าง / ผลการแก้ไข"
              className="pl-9 pr-9"
              aria-label="ค้นหาใบแจ้งซ่อม"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setSearch((e.target as HTMLInputElement).value)
                }
              }}
            />
            {/* Quick scan button — opens QR/barcode scanner */}
            <button
              type="button"
              onClick={() => useAppStore.getState().setQrScannerOpen(true)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-orange-500"
              title="สแกน QR / บาร์โคด"
              aria-label="สแกน QR / บาร์โคด"
            >
              <ScanLine className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 md:flex md:w-auto">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-[160px]" aria-label="ตัวกรองสถานะ">
                <SelectValue placeholder={t('settings.col.status')} />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-full md:w-[160px]" aria-label="ตัวกรองความเร่งด่วน">
                <SelectValue placeholder="ความเร่งด่วน" />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {showSiteFilter && (
              <Select value={siteFilter} onValueChange={setSiteFilter}>
                <SelectTrigger className="w-full md:w-[160px]" aria-label="ตัวกรองไซต์">
                  <SelectValue placeholder={t('devices.filter.site_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทุกไซต์</SelectItem>
                  {sites.map((s) => (
                    <SelectItem key={s.id} value={s.code}>
                      {s.code} {s.name ? `— ${s.name}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>

      {/* List — table layout (replaces card grid per user request) */}
      {listQuery.isLoading ? (
        <Card className="flex min-h-0 flex-1 flex-col py-3">
          <CardContent className="space-y-2 px-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-md" />
            ))}
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card className="flex min-h-0 flex-1 flex-col items-center justify-center py-12">
          <CardContent className="flex flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-950">
              <Wrench className="h-7 w-7 text-orange-500" />
            </div>
            <div className="text-base font-medium">ยังไม่มีใบแจ้งซ่อม</div>
            <p className="max-w-sm text-sm text-muted-foreground">
              กดปุ่ม &quot;แจ้งซ่อมใหม่&quot; เพื่อสร้างใบงานแรก หรือใช้ตัวกรองเพื่อค้นหาใบงานเดิม
            </p>
            <Button type="button" size="sm" onClick={openCreate} className="mt-1 bg-orange-500 hover:bg-orange-600">
              <Plus className="h-4 w-4" />
              แจ้งซ่อมใหม่
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200 py-0 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="itam-scroll min-h-0 flex-1 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                <TableRow>
                  <TableHead className="text-xs">เลขที่ใบงาน</TableHead>
                  <TableHead className="text-xs">เรื่อง</TableHead>
                  <TableHead className="text-xs">สถานะ</TableHead>
                  <TableHead className="text-xs">ความเร่งด่วน</TableHead>
                  <TableHead className="text-xs">อาคาร/สถานที่</TableHead>
                  <TableHead className="text-xs">ผู้แจ้ง</TableHead>
                  <TableHead className="text-xs">โทรศัพท์</TableHead>
                  <TableHead className="text-xs">ผู้รับผิดชอบ</TableHead>
                  <TableHead className="text-xs">วันที่แจ้ง</TableHead>
                  <TableHead className="text-right text-xs">การจัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((wo) => {
                  const external = parseExternalMeta(wo.externalMeta)
                  return (
                    <TableRow
                      key={wo.id}
                      className="cursor-pointer border-slate-100 transition-colors hover:bg-orange-50/60 dark:border-slate-800 dark:hover:bg-orange-950/20"
                      onClick={() => setDetailId(wo.id)}
                    >
                      <TableCell className="whitespace-nowrap py-2.5 font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                        <div className="flex flex-col">
                          <span className="inline-flex items-center gap-1">
                            {wo.systemJobNo ?? wo.woNumber ?? '—'}
                            {wo.isSpecialFee && (
                              <span
                                title="พิเศษ (มีค่าใช้จ่าย)"
                                aria-label="พิเศษ (มีค่าใช้จ่าย)"
                                className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-[10px] dark:bg-amber-950"
                              >
                                💰
                              </span>
                            )}
                          </span>
                          {wo.legacyJobNo && (
                            <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400">
                              เลขเดิม: {wo.legacyJobNo}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[260px] py-2.5">
                        <div className="flex items-start gap-1.5">
                          {external && (
                            <Badge
                              className="shrink-0 border-teal-200 bg-teal-100 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300"
                              variant="outline"
                            >
                              งานภายนอก
                            </Badge>
                          )}
                          <span className="line-clamp-2 text-sm font-medium text-slate-800 dark:text-slate-100" title={wo.subject}>
                            {wo.subject}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Badge
                          className={statusBadgeClass(wo.status) + ' px-2 py-0.5 text-[11px] font-semibold'}
                          variant="outline"
                        >
                          {statusLabel(wo.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Badge
                          className={priorityBadgeClass(wo.priority) + ' px-2 py-0.5 text-[11px] font-semibold'}
                          variant="outline"
                        >
                          {wo.priority}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[180px] py-2.5 text-xs text-slate-600 dark:text-slate-300">
                        {external ? (
                          <div className="truncate" title={`${external.clientName ?? ''} ${external.place ?? ''}`}>
                            {external.clientName ?? '—'}
                            {external.place ? ` • ${external.place}` : ''}
                          </div>
                        ) : (
                          <div className="truncate" title={`${wo.building ?? ''} ${wo.location ?? ''}`}>
                            {wo.building ?? '—'}
                            {wo.location ? ` • ${wo.location}` : ''}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate py-2.5 text-xs text-slate-700 dark:text-slate-200" title={wo.reporterName ?? ''}>
                        {wo.reporterName ?? '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2.5 font-mono text-xs text-slate-600 dark:text-slate-300">
                        {wo.tel ?? '—'}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate py-2.5 text-xs text-slate-700 dark:text-slate-200" title={wo.assignedTo ?? ''}>
                        {wo.assignedTo ?? '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2.5 text-xs text-slate-500 dark:text-slate-400" title={wo.createdAt}>
                        {formatDateTime(wo.createdAt)}
                      </TableCell>
                      <TableCell className="py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setDetailId(wo.id)}
                            aria-label="ดูรายละเอียดใบงาน"
                            title="ดูรายละเอียด"
                            className="h-7 px-2 text-[11px]"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const t = useAuthStore.getState()?.token
                              const qs = t ? `?t=${encodeURIComponent(t)}` : ''
                              window.open(`/api/work-orders/${wo.id}/print-sheet${qs}`, '_blank', 'noopener,noreferrer')
                            }}
                            aria-label="พิมพ์ใบงาน"
                            title="พิมพ์ใบงาน"
                            className="h-7 px-2 text-[11px]"
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Pagination — unified PaginationBar */}
      {pagination && pagination.totalPages > 1 && (
        <PaginationBar
          page={page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
        />
      )}

      {/* Create dialog */}
      <CreateWorkOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        form={form}
        setForm={setForm}
        saving={saving}
        onSubmit={handleCreate}
        subjects={optionsQuery.data?.subjects ?? []}
        buildings={optionsQuery.data?.buildings ?? []}
        authUser={authUser}
      />

      {/* Detail dialog */}
      <WorkOrderDetailDialog
        id={detailId}
        onOpenChange={(open) => {
          if (!open) setDetailId(null)
        }}
        resolutions={optionsQuery.data?.resolutions ?? []}
      />
    </div>
  )
}

// ============================================================
// KPI Card
// ============================================================
const KPI_COLORS: Record<string, string> = {
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  emerald:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
}

function KpiCard({
  label,
  value,
  icon,
  color,
  loading = false,
}: {
  label: string
  value: number
  icon: React.ReactNode
  color: keyof typeof KPI_COLORS | string
  loading?: boolean
}) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="flex items-center gap-3 px-4">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-lg ${
            KPI_COLORS[color] ?? KPI_COLORS.amber
          }`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          {/* Bug UI-01 fix: distinguish loading state from real 0 values */}
          <div className="text-2xl font-bold leading-tight">
            {loading ? (
              <span className="inline-block h-7 w-12 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
            ) : (
              value.toLocaleString('en-US')
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================
// Work Order Card (mobile-friendly list item)
// ============================================================
function WorkOrderCard({
  wo,
  onOpen,
}: {
  wo: WorkOrder
  onOpen: () => void
}) {
  const external = parseExternalMeta(wo.externalMeta)
  return (
    <Card
      className="group cursor-pointer py-0 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <CardContent className="space-y-3 p-4">
        {/* Top row: WO number + status badges (status badge larger for readability) */}
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex min-w-0 flex-col truncate font-mono text-xs font-semibold text-muted-foreground">
            <span className="inline-flex items-center gap-1 truncate">
              {wo.systemJobNo ?? wo.woNumber ?? '—'}
              {wo.isSpecialFee && (
                <span
                  title="พิเศษ (มีค่าใช้จ่าย)"
                  aria-label="พิเศษ (มีค่าใช้จ่าย)"
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] dark:bg-amber-950"
                >
                  💰
                </span>
              )}
            </span>
            {wo.legacyJobNo && (
              <span className="truncate text-[10px] font-normal text-slate-500 dark:text-slate-400">
                เลขเดิม: {wo.legacyJobNo}
              </span>
            )}
          </span>
          <div className="flex flex-wrap items-center justify-end gap-1">
            {external && (
              <Badge
                className="border-teal-200 bg-teal-100 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300"
                variant="outline"
              >
                งานภายนอก
              </Badge>
            )}
            <Badge
              className={statusBadgeClass(wo.status) + ' px-2.5 py-1 text-xs font-semibold'}
              variant="outline"
            >
              {statusLabel(wo.status)}
            </Badge>
          </div>
        </div>

        {/* Subject + prominent priority badge top-right */}
        <div className="flex items-start gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-orange-100 dark:bg-orange-950">
            <Wrench className="h-4 w-4 text-orange-600 dark:text-orange-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-sm font-semibold leading-tight">
              {wo.subject}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {relativeTime(wo.createdAt)}
            </div>
          </div>
          {/* Priority badge — prominent, top-right corner */}
          <Badge
            className={
              priorityBadgeClass(wo.priority) +
              ' shrink-0 px-2.5 py-1 text-xs font-semibold'
            }
            variant="outline"
          >
            {wo.priority}
          </Badge>
        </div>

        {/* Meta */}
        <div className="space-y-1 text-xs text-muted-foreground">
          {external ? (
            <>
              <div className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {external.clientName ?? '—'}
                  {external.place ? ` • ${external.place}` : ''}
                </span>
              </div>
              {external.contactPhone && (
                <div className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{external.contactPhone}</span>
                </div>
              )}
            </>
          ) : (
            <>
              {wo.building && (
                <div className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {wo.building}
                    {wo.location ? ` • ${wo.location}` : ''}
                  </span>
                </div>
              )}
              {wo.reporterName && (
                <div className="flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{wo.reporterName}</span>
                  {wo.tel && (
                    <>
                      <span aria-hidden>•</span>
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{wo.tel}</span>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer: assignedTo only (priority moved up) */}
        <div className="flex items-center justify-end gap-2 border-t pt-2.5">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            {wo.assignedTo ? (
              <>
                <User className="h-3 w-3" />
                <span className="truncate">{wo.assignedTo}</span>
              </>
            ) : wo.status === 'PENDING' ? (
              <span className="text-amber-600 dark:text-amber-400">ยังไม่ได้มอบหมาย</span>
            ) : (
              <span>—</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================
// Create Dialog — with guest verification + external mode + subject dropdown
// ============================================================
function CreateWorkOrderDialog({
  open,
  onOpenChange,
  form,
  setForm,
  saving,
  onSubmit,
  subjects,
  buildings,
  authUser,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  form: NewFormState
  setForm: React.Dispatch<React.SetStateAction<NewFormState>>
  saving: boolean
  onSubmit: () => void
  subjects: SubjectOption[]
  buildings: BuildingOption[]
  authUser: ReturnType<typeof useAuthStore.getState>['user']
}) {
  const t = useT()
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [picBusy, setPicBusy] = React.useState(false)

  // Group subjects for the dropdown
  const subjectGroups = React.useMemo(() => {
    const map = new Map<string, SubjectOption[]>()
    for (const s of subjects) {
      if (!map.has(s.group)) map.set(s.group, [])
      map.get(s.group)!.push(s)
    }
    return Array.from(map.entries())
  }, [subjects])

  // Device lookup (internal mode only)
  const [deviceResults, setDeviceResults] = React.useState<DeviceLookupItem[]>([])
  const [deviceLoading, setDeviceLoading] = React.useState(false)
  const [deviceResultsCache, setDeviceResultsCache] = React.useState<DeviceLookupItem | null>(null)
  React.useEffect(() => {
    if (!form.deviceSearch.trim() || form.isExternal) {
      setDeviceResults([])
      return
    }
    let cancelled = false
    setDeviceLoading(true)
    const t = setTimeout(async () => {
      try {
        // Use /api/search (suffix-aware) — same as mobile repair request
        const res = await fetch(`/api/search?q=${encodeURIComponent(form.deviceSearch.trim())}&type=devices`, {
          headers: getAuthHeaders(),
        })
        if (!res.ok) {
          // Fallback to /api/devices
          const params = new URLSearchParams({ search: form.deviceSearch.trim() })
          const fallbackRes = await fetch(`/api/devices?${params.toString()}`, {
            headers: getAuthHeaders(),
          })
          if (!fallbackRes.ok) return
          const json = await fallbackRes.json()
          if (!cancelled) setDeviceResults((json.devices ?? []).slice(0, 8))
          return
        }
        const data = await res.json()
        const searchResults = data.results?.devices ?? []
        // Map search results to device format
        const mapped = searchResults.map((d: { id: string; title: string; subtitle: string }) => {
          const titleParts = d.title.split(' · ')
          const subtitle = d.subtitle || ''
          let serialNumber = ''
          let site = ''
          if (subtitle.includes('S/N:')) {
            serialNumber = subtitle.split('S/N:')[1]?.split('|')[0]?.trim() ?? ''
            const afterPipe = subtitle.split('|')[1]?.trim() ?? ''
            site = afterPipe.split('·').pop()?.trim() ?? ''
          }
          return {
            id: d.id,
            assetCode: titleParts[0] ?? '',
            name: titleParts.slice(1).join(' · ') ?? '',
            serialNumber,
            brand: '',
            model: '',
            site,
          }
        })
        if (!cancelled) setDeviceResults(mapped.slice(0, 8))
      } catch {
        if (!cancelled) setDeviceResults([])
      } finally {
        if (!cancelled) setDeviceLoading(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [form.deviceSearch, form.isExternal])

  // ── QR/barcode scan handling for the device search field ──
  // When a scan is published while the create dialog is open, drop the value
  // into the device search field so the lookup effect kicks in.
  const qrScanNonce = useAppStore((s) => s.qrScanNonce)
  const lastQrScan = useAppStore((s) => s.lastQrScan)
  React.useEffect(() => {
    if (!open) return
    if (qrScanNonce === 0) return
    if (!lastQrScan) return
    // Only fill if the user was focused on the create dialog (the list page
    // checks `!createOpen` for its own scan reaction, so the two won't fight).
    setForm((s) => ({ ...s, deviceSearch: lastQrScan, deviceId: null }))
  }, [qrScanNonce, open, lastQrScan, setForm])

  // When subject changes, auto-set priority from default_priority
  function handleSubjectChange(value: string) {
    if (value === '__custom__') {
      setForm((s) => ({ ...s, subject: '__custom__', subjectGroup: '' }))
      return
    }
    const opt = subjects.find((s) => s.value === value)
    setForm((s) => ({
      ...s,
      subject: value,
      subjectGroup: opt?.group ?? '',
      priority: opt?.default_priority ?? s.priority,
    }))
  }

  // Multi-image upload (up to 9). Reads every selected file, compresses each,
  // then appends to form.picBeforeImages while respecting the cap.
  async function handlePicBeforeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    try {
      setPicBusy(true)
      const remaining = MAX_IMAGES_PER_STAGE - form.picBeforeImages.length
      if (remaining <= 0) {
        toast.error(`เพิ่มรูปได้สูงสุด ${MAX_IMAGES_PER_STAGE} รูป`)
        return
      }
      const list = Array.from(files).slice(0, remaining)
      const compressed: string[] = []
      for (const f of list) {
        try {
          const dataUrl = await compressImage(f)
          compressed.push(dataUrl)
        } catch (err) { console.error('[work-orders-page]', err) }
      }
      if (compressed.length === 0) {
        toast.error('อ่านไฟล์รูปภาพไม่สำเร็จ')
        return
      }
      setForm((s) => ({
        ...s,
        picBeforeImages: [...s.picBeforeImages, ...compressed].slice(
          0,
          MAX_IMAGES_PER_STAGE,
        ),
      }))
      if (list.length < files.length) {
        toast.message(`เพิ่มได้สูงสุด ${MAX_IMAGES_PER_STAGE} รูป — เพิ่มแล้ว ${list.length} รูป`)
      }
    } finally {
      setPicBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function removePicBefore(idx: number) {
    setForm((s) => ({
      ...s,
      picBeforeImages: s.picBeforeImages.filter((_, i) => i !== idx),
    }))
  }

  function addSerial() {
    const v = form.serialInput.trim()
    if (!v) return
    if (form.serials.includes(v)) {
      toast.error('S/N นี้มีอยู่แล้ว')
      return
    }
    setForm((s) => ({ ...s, serials: [...s.serials, v], serialInput: '' }))
  }

  function removeSerial(s: string) {
    setForm((frm) => ({ ...frm, serials: frm.serials.filter((x) => x !== s) }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[100vh] max-h-[100vh] w-full max-w-[100vw] flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[92vh] sm:max-w-2xl sm:rounded-lg sm:p-6"
      >
        {/* Mobile-first header: title + 44px close button */}
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3 sm:px-0 sm:py-0 sm:border-0">
          <div className="min-w-0 flex-1">
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Plus className="h-5 w-5 text-orange-500" />
              แจ้งซ่อมใหม่
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs sm:text-sm">
              ระบุรายละเอียดปัญหา ระบบจะสร้างเลขที่ใบงานอัตโนมัติ (WO-YYYYMMDD-NNN)
            </DialogDescription>
          </div>
          <DialogClose
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-orange-500"
            aria-label={t('settings.close')}
          >
            <X className="h-5 w-5" />
          </DialogClose>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-0 sm:py-1">
          <div className="grid gap-3">
            {/* ── Step 1: Job type selector (Task ID: UX-GAPS-3-ITEMS) ──
                When no jobType is picked yet, show the 3-option wizard.
                After selection, show a compact banner + "Change" button. */}
            {form.jobType === '' ? (
              <div className="grid gap-3">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-sm font-semibold">เลือกประเภทงาน</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    เลือกประเภทงานก่อน — ระบบจะแสดงเฉพาะฟิลด์ที่เกี่ยวข้อง
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setForm((s) => ({ ...s, jobType: 'internal', isExternal: false }))
                  }
                  className="flex w-full items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-orange-300 hover:bg-orange-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-orange-700 dark:hover:bg-orange-950/30"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-950 dark:text-orange-300">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">งานภายใน</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      พนักงานแจ้งซ่อมด้วยตนเองผ่านบัญชีที่ล็อกอิน — ใช้ข้อมูลผู้ล็อกอินเป็นผู้แจ้ง (ไม่ต้องกรอกชื่อ-เบอร์)
                    </div>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setForm((s) => ({ ...s, jobType: 'external', isExternal: true }))
                  }
                  className="flex w-full items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-orange-300 hover:bg-orange-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-orange-700 dark:hover:bg-orange-950/30"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-teal-600 dark:bg-teal-950 dark:text-teal-300">
                    <PackageOpen className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">งานลูกค้าภายนอก</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      ลูกค้าภายนอก/หน่วยงานภายนอก — ระบุชื่อลูกค้า + สถานที่ + เบอร์ติดต่อ
                    </div>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setForm((s) => ({ ...s, jobType: 'guest', isExternal: false }))
                  }
                  className="flex w-full items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-orange-300 hover:bg-orange-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-orange-700 dark:hover:bg-orange-950/30"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-300">
                    <User className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">ผู้ใช้ทั่วไป</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      ผู้ใช้เดินเข้ามาแจ้งซ่อม — ต้องระบุชื่อ+เบอร์โทรเพื่อยืนยันตัวตนกับสมุดโทรศัพท์
                    </div>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <div className="grid gap-3">
                {/* Selected job type banner — compact, with "Change" button */}
                <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    {form.jobType === 'internal' && (
                      <Building2 className="mt-0.5 h-4 w-4 text-orange-600 dark:text-orange-400" />
                    )}
                    {form.jobType === 'external' && (
                      <PackageOpen className="mt-0.5 h-4 w-4 text-teal-600 dark:text-teal-400" />
                    )}
                    {form.jobType === 'guest' && (
                      <User className="mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-400" />
                    )}
                    <div>
                      <div className="text-sm font-medium">
                        {form.jobType === 'internal' && 'งานภายใน'}
                        {form.jobType === 'external' && 'งานลูกค้าภายนอก'}
                        {form.jobType === 'guest' && 'ผู้ใช้ทั่วไป'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {form.jobType === 'internal' &&
                          'ใช้ข้อมูลผู้ล็อกอินเป็นผู้แจ้ง'}
                        {form.jobType === 'external' &&
                          'ลูกค้าภายนอก/หน่วยงานภายนอก'}
                        {form.jobType === 'guest' &&
                          'ผู้แจ้งต้องยืนยันตัวตนกับสมุดโทรศัพท์'}
                      </div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setForm((s) => ({ ...s, jobType: '', isExternal: false }))
                    }
                    disabled={saving}
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    เปลี่ยนประเภทงาน
                  </Button>
                </div>

            {/* Subject dropdown (grouped) */}
            <div className="grid gap-1.5">
              <Label htmlFor="wo-subject">
                ประเภทปัญหา <span className="text-rose-500">*</span>
              </Label>
              {subjects.length === 0 ? (
                <Input
                  id="wo-subject"
                  value={form.subject}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, subject: e.target.value }))
                  }
                  placeholder="เช่น เครื่องพิมพ์ไม่ทำงาน, อินเทอร์เน็ตไม่เชื่อมต่อ"
                  autoFocus
                />
              ) : (
                <Select value={form.subject} onValueChange={handleSubjectChange}>
                  <SelectTrigger id="wo-subject">
                    <SelectValue placeholder="เลือกประเภทปัญหา" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjectGroups.map(([group, opts]) => (
                      <SelectGroup key={group}>
                        <SelectLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {group}
                        </SelectLabel>
                        {opts.map((o) => (
                          <SelectItem key={group + '|' + o.value} value={o.value}>
                            <span className="flex w-full items-center justify-between gap-2">
                              <span>{o.value}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {o.default_priority}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                    <SelectItem value="__custom__">— ระบุเอง —</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {form.subject === '__custom__' && (
                <Input
                  value={form.subject === '__custom__' ? '' : form.subject}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, subject: e.target.value }))
                  }
                  placeholder="พิมพ์หัวข้อปัญหา"
                  autoFocus
                />
              )}
              {form.subjectGroup && (
                <div className="text-[11px] text-muted-foreground">
                  หมวดหมู่: {form.subjectGroup} • ความเร่งด่วนอัตโนมัติ: {form.priority}
                </div>
              )}
            </div>

            {/* Conditional sections */}
            {form.isExternal ? (
              <div className="grid gap-3 rounded-lg border border-teal-200 bg-teal-50/50 p-3 dark:border-teal-800 dark:bg-teal-950/30">
                <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="wo-client">
                      ชื่อลูกค้า <span className="text-rose-500">*</span>
                    </Label>
                    <Input
                      id="wo-client"
                      value={form.clientName}
                      onChange={(e) =>
                        setForm((s) => ({ ...s, clientName: e.target.value }))
                      }
                      placeholder="เช่น บริษัท ตัวอย่าง จำกัด"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="wo-place">สถานที่</Label>
                    <Input
                      id="wo-place"
                      value={form.place}
                      onChange={(e) =>
                        setForm((s) => ({ ...s, place: e.target.value }))
                      }
                      placeholder="เช่น อาคาร X ชั้น 2"
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="wo-contact-phone">เบอร์ติดต่อลูกค้า</Label>
                  <Input
                    id="wo-contact-phone"
                    value={form.contactPhone}
                    onChange={(e) =>
                      setForm((s) => ({ ...s, contactPhone: e.target.value }))
                    }
                    placeholder="08xxxxxxxx"
                    inputMode="tel"
                  />
                </div>
                {/* Serials list */}
                <div className="grid gap-1.5">
                  <Label htmlFor="wo-serial">S/N (Serial Number)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="wo-serial"
                      value={form.serialInput}
                      onChange={(e) =>
                        setForm((s) => ({ ...s, serialInput: e.target.value }))
                      }
                      placeholder="ระบุ S/N แล้วกด + เพื่อเพิ่ม"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addSerial()
                        }
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={addSerial}
                      disabled={!form.serialInput.trim()}
                      aria-label="เพิ่มหมายเลขซีเรียล"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {form.serials.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {form.serials.map((s) => (
                        <Badge
                          key={s}
                          variant="outline"
                          className="gap-1 font-mono text-[11px]"
                        >
                          <Hash className="h-3 w-3" />
                          {s}
                          <button
                            type="button"
                            onClick={() => removeSerial(s)}
                            className="ml-1 rounded-full p-0.5 hover:bg-muted"
                            aria-label={`ลบ ${s}`}
                          >
                            <XCircle className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="wo-building">อาคาร / แผนก</Label>
                    <Combobox
                      value={form.building}
                      onChange={(v) => setForm((s) => ({ ...s, building: v }))}
                      items={buildings.map((b) => ({ value: b.value, label: b.value }))}
                      placeholder="เลือกหรือพิมพ์อาคาร / แผนก"
                      emptyText="ยังไม่มีข้อมูลอาคาร — พิมพ์เพื่อเพิ่มใหม่"
                      inputId="wo-building"
                    />
                    {buildings.length > 0 && (
                      <div className="text-[10px] text-muted-foreground">
                        เลือกจากรายการที่บันทึกไว้ ({buildings.length}) หรือพิมพ์เพื่อเพิ่มใหม่
                      </div>
                    )}
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="wo-location">ตำแหน่ง / ห้อง</Label>
                    <Input
                      id="wo-location"
                      value={form.location}
                      onChange={(e) =>
                        setForm((s) => ({ ...s, location: e.target.value }))
                      }
                      placeholder="เช่น ชั้น 3 ห้อง 305"
                    />
                  </div>
                </div>

                {/* Asset lookup */}
                <div className="grid gap-1.5">
                  <Label htmlFor="wo-device-search">รหัสทะเบียนอุปกรณ์ (ไม่บังคับ)</Label>
                  <Input
                    id="wo-device-search"
                    value={form.deviceSearch}
                    onChange={(e) =>
                      setForm((s) => ({
                        ...s,
                        deviceSearch: e.target.value,
                        deviceId: null,
                      }))
                    }
                    placeholder="พิมพ์รหัสทะเบียน / ชื่อ / S/N เพื่อค้นหาอุปกรณ์"
                  />
                  {deviceLoading && (
                    <div className="text-[11px] text-muted-foreground">กำลังค้นหา...</div>
                  )}
                  {!deviceLoading && deviceResults.length > 0 && (
                    <div className="max-h-40 overflow-y-auto rounded-md border bg-card">
                      {deviceResults.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => {
                            setForm((s) => ({
                              ...s,
                              deviceId: d.id,
                              deviceSearch: `${d.assetCode} — ${d.name}`,
                              building: s.building || d.building || '',
                              location: s.location || d.location || '',
                              // SPRINT-4 #8 (UI-BUG-002): removed `department` assignment
                              // because NewFormState doesn't have a `department` field.
                              // Setting it was a no-op that produced a TS warning.
                            }))
                            setDeviceResultsCache(d)
                            setDeviceResults([])
                          }}
                          className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted"
                        >
                          <span className="font-mono font-semibold">{d.assetCode}</span>
                          <span className="text-muted-foreground">
                            {d.name} {d.brand && d.model ? `(${d.brand} ${d.model})` : ''}
                            {d.site ? ` • ${d.site}` : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {form.deviceId && (() => {
                    const selected = deviceResults.find(d => d.id === form.deviceId) || deviceResultsCache
                    return (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-[11px] dark:border-emerald-800 dark:bg-emerald-950/30">
                      <div className="flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" /> อุปกรณ์ที่เลือก
                        <button
                          type="button"
                          onClick={() =>
                            setForm((s) => ({
                              ...s,
                              deviceId: null,
                              deviceSearch: '',
                            }))
                          }
                          className="ml-auto underline"
                        >
                          ล้าง
                        </button>
                      </div>
                      {selected && (
                        <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-slate-600 dark:text-slate-400">
                          <span>รหัส: <strong className="font-mono">{selected.assetCode}</strong></span>
                          <span>ไซต์: {selected.site || '-'}</span>
                          <span>ยี่ห้อ: {selected.brand || '-'}</span>
                          <span>รุ่น: {selected.model || '-'}</span>
                          <span>S/N: <span className="font-mono">{selected.serialNumber || '-'}</span></span>
                          <span>ประเภท: {selected.type || '-'}</span>
                          <span>อาคาร: {selected.building || '-'}</span>
                          <span>แผนก: {selected.department || '-'}</span>
                        </div>
                      )}
                    </div>
                    )
                  })()}
                </div>
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="wo-details">รายละเอียดปัญหา</Label>
              <Textarea
                id="wo-details"
                value={form.details}
                onChange={(e) => setForm((s) => ({ ...s, details: e.target.value }))}
                placeholder="อธิบายอาการ ความถี่ หรือข้อมูลที่ช่างควรทราบ"
                className="min-h-[80px]"
              />
            </div>

            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="wo-priority">ความเร่งด่วน</Label>
                <Select
                  value={form.priority}
                  onValueChange={(v) => setForm((s) => ({ ...s, priority: v }))}
                >
                  <SelectTrigger id="wo-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_FORM_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wo-pic" className="flex items-center justify-between">
                  <span>รูปก่อนซ่อม (ไม่บังคับ)</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {form.picBeforeImages.length}/{MAX_IMAGES_PER_STAGE} รูป
                  </span>
                </Label>
                <input
                  ref={fileInputRef}
                  id="wo-pic"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  onChange={handlePicBeforeChange}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={
                    picBusy || form.picBeforeImages.length >= MAX_IMAGES_PER_STAGE
                  }
                  className="min-h-11 w-full justify-center border-orange-300 text-orange-700 hover:bg-orange-50 hover:text-orange-800 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950/40"
                >
                  {picBusy ? (
                    <RefreshCw className="h-5 w-5 animate-spin" />
                  ) : (
                    <ImageIcon className="h-5 w-5" />
                  )}
                  เพิ่มรูปก่อนซ่อม
                </Button>
                <CameraCapture
                  onCapture={(dataUrl) => {
                    if (form.picBeforeImages.length >= MAX_IMAGES_PER_STAGE) {
                      toast.error(`เพิ่มรูปได้สูงสุด ${MAX_IMAGES_PER_STAGE} รูป`)
                      return
                    }
                    setForm((s) => ({
                      ...s,
                      picBeforeImages: [...s.picBeforeImages, dataUrl].slice(
                        0,
                        MAX_IMAGES_PER_STAGE,
                      ),
                    }))
                  }}
                  label="ถ่ายรูปจากกล้อง"
                  className="min-h-11 w-full justify-center border-orange-300 text-orange-700 hover:bg-orange-50 hover:text-orange-800 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950/40"
                />
                <p className="text-[11px] text-muted-foreground">
                  สูงสุด {MAX_IMAGES_PER_STAGE} รูป • บีบอัดอัตโนมัติ
                </p>
                {form.picBeforeImages.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-2 sm:grid sm:grid-cols-4 sm:overflow-visible sm:pb-0">
                    {form.picBeforeImages.map((src, idx) => (
                      <div
                        key={`${idx}-${src.slice(0, 24)}`}
                        className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-md border sm:h-auto sm:w-auto sm:aspect-square"
                      >
                        <img
                          src={src}
                          alt={`รูปก่อนซ่อม ${idx + 1}`}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                        <button
                          type="button"
                          onClick={() => removePicBefore(idx)}
                          className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-rose-600"
                          aria-label={`ลบรูปที่ ${idx + 1}`}
                        >
                          <X className="h-4 w-4" />
                        </button>
                        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                          {idx + 1}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Special (Has cost) — Task ID: SPECIALFEE-WOPATTERN-APPROVAL */}
            <div className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2.5 dark:border-amber-700 dark:bg-amber-950/30">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-base leading-none" aria-hidden>
                  💰
                </span>
                <div>
                  <div className="text-sm font-medium">
                    พิเศษ (มีค่าใช้จ่าย)
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ใช้สำหรับงานที่มีค่าใช้จ่ายเพิ่มเติม — แอปอื่นดึงผ่าน API
                  </div>
                </div>
              </div>
              <Switch
                checked={form.isSpecialFee}
                onCheckedChange={(v) =>
                  setForm((s) => ({ ...s, isSpecialFee: v }))
                }
                aria-label="พิเศษ (มีค่าใช้จ่าย)"
              />
            </div>

            {/* Reporter block — hidden for internal mode (uses logged-in user).
                Task ID: UX-GAPS-3-ITEMS */}
            {form.jobType === 'internal' ? (
              <div className="grid gap-1 rounded-lg border bg-muted/40 p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  ผู้แจ้ง (พนักงานที่ล็อกอิน)
                </div>
                <div className="text-sm">
                  {authUser?.name ?? authUser?.email ?? 'ผู้ใช้ที่ล็อกอินปัจจุบัน'}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  ระบบจะใช้ข้อมูลผู้ล็อกอินเป็นผู้แจ้ง (submissionSource = session)
                </div>
              </div>
            ) : (
            <div className="grid gap-2 rounded-lg border bg-card p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" />
                {form.isExternal
                  ? 'ผู้แจ้ง (ช่างรับแจ้ง)'
                  : 'ผู้แจ้ง (ต้องยืนยันตัวตนกับสมุดโทรศัพท์)'}
              </div>
              <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="wo-reporter">
                    ชื่อผู้แจ้ง
                    {!form.isExternal && <span className="text-rose-500"> *</span>}
                  </Label>
                  <Input
                    id="wo-reporter"
                    value={form.reporterName}
                    onChange={(e) =>
                      setForm((s) => ({ ...s, reporterName: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        document.getElementById('wo-tel')?.focus()
                      }
                    }}
                    placeholder="ชื่อ-นามสกุล"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="wo-tel">
                    โทรศัพท์
                    {!form.isExternal && <span className="text-rose-500"> *</span>}
                  </Label>
                  <div className="relative">
                    <ScanLine className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="wo-tel"
                      value={form.tel}
                      onChange={(e) => setForm((s) => ({ ...s, tel: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          document.getElementById('wo-emp')?.focus()
                        }
                      }}
                      placeholder="08xxxxxxxx"
                      inputMode="tel"
                      className="pl-8 font-mono text-xs"
                    />
                  </div>
                </div>
              </div>
              {!form.isExternal && (
                <div className="grid gap-1.5">
                  <Label htmlFor="wo-emp">รหัสพนักงาน (ไม่บังคับ)</Label>
                  <div className="relative">
                    <ScanLine className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="wo-emp"
                      value={form.employeeCode}
                      onChange={(e) =>
                        setForm((s) => ({ ...s, employeeCode: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          document.getElementById('wo-details')?.focus()
                        }
                      }}
                      placeholder="สแกนบัตรพนักงานหรือพิมพ์รหัส เช่น EMP001"
                      className="pl-8 font-mono text-xs"
                    />
                  </div>
                </div>
              )}
              {!form.isExternal && (
                <div className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  ระบบจะตรวจสอบชื่อ + เบอร์โทรกับสมุดโทรศัพท์ (ContactDirectory)
                  หากไม่ตรงกันจะส่งใบแจ้งซ่อมไม่ได้
                </div>
              )}
            </div>
            )}
              </div>
            )}
          </div>
        </div>

        {/* Sticky footer — buttonCancel/Save AtlowerForActiveonMobile */}
        <DialogFooter className="sticky bottom-0 gap-2 border-t bg-white p-3 dark:bg-slate-900 sm:flex-row sm:justify-end sm:border-0 sm:bg-transparent sm:p-0 sm:dark:bg-transparent">
          <Button type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="min-h-11 w-full sm:w-auto"
          >
            ยกเลิก
          </Button>
          <Button type="button"
            onClick={onSubmit}
            disabled={saving || form.jobType === '' || !form.subject.trim() || form.subject === '__custom__'}
            className="min-h-11 w-full bg-orange-500 hover:bg-orange-600 sm:w-auto"
          >
            {saving ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            บันทึกใบแจ้งซ่อม
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// Detail Dialog
// ============================================================
function WorkOrderDetailDialog({
  id,
  onOpenChange,
  resolutions,
}: {
  id: string | null
  onOpenChange: (open: boolean) => void
  resolutions: ResolutionOption[]
}) {
  const qc = useQueryClient()
  const open = Boolean(id)

  // Detail query (only when an id is selected)
  const detailQuery = useQuery<WorkOrderDetail>({
    queryKey: ['work-order', id],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders/${id}`, {
        headers: getAuthHeaders(),
      })
      if (!res.ok) throw new Error('Failed to load work order')
      const json = await res.json()
      return json.data as WorkOrderDetail
    },
    enabled: Boolean(id),
  })

  const wo = detailQuery.data

  // Invalidate list when detail changes (action happened)
  function refreshAll() {
    qc.invalidateQueries({ queryKey: ['work-orders'] })
    qc.invalidateQueries({ queryKey: ['work-order', id] })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[100vh] max-h-[100vh] w-full max-w-[100vw] flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[92vh] sm:max-w-3xl sm:rounded-lg"
      >
        {detailQuery.isLoading ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : detailQuery.isError ? (
          // Defensive fix: show error state instead of blank screen
          <div className="space-y-3 p-6">
            <div className="text-sm font-medium text-rose-600">โหลดใบงานไม่สำเร็จ</div>
            <div className="text-xs text-muted-foreground">
              {detailQuery.error instanceof Error
                ? detailQuery.error.message
                : 'เกิดข้อผิดพลาดบางอย่าง — ลองปิดแล้วเปิดใหม่'}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => detailQuery.refetch()}>
              ลองใหม่
            </Button>
          </div>
        ) : !wo ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            ไม่พบใบงาน
          </div>
        ) : (
          <WorkOrderDetailContent
            wo={wo}
            onMutated={refreshAll}
            onClose={() => onOpenChange(false)}
            resolutions={resolutions}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function WorkOrderDetailContent({
  wo,
  onMutated,
  onClose,
  resolutions,
}: {
  wo: WorkOrderDetail
  onMutated: () => void
  onClose: () => void
  resolutions: ResolutionOption[]
}) {
  // BUG-WO-002 fix: missing useQueryClient() — multiple `qc.invalidateQueries`
  // calls below (lines ~2215+) reference `qc` but it was never declared in
  // this component scope, causing runtime ReferenceError when image upload
  // or parts/approve flows try to invalidate the WO cache.
  const qc = useQueryClient()
  const t = useT()
  const { lang } = useLang()

  // Assign technician
  const [assignOpen, setAssignOpen] = React.useState(false)
  const [techName, setTechName] = React.useState(wo.assignedTo ?? '')
  const [assignNote, setAssignNote] = React.useState(wo.assignmentNote ?? '')
  const [assigning, setAssigning] = React.useState(false)

  // Approve (PENDING_REVIEW → PENDING)
  // Tier 2/3 submissions from LINE/public land in PENDING_REVIEW and need
  // staff approval before they enter the normal work queue. Approving
  // transitions the WO to PENDING (which then unlocks Assign/Complete).
  const [approving, setApproving] = React.useState(false)

  // Complete
  const [completeOpen, setCompleteOpen] = React.useState(false)
  const [completeNote, setCompleteNote] = React.useState('')
  const [completing, setCompleting] = React.useState(false)
  const [resolutionValue, setResolutionValue] = React.useState<string>(wo.resolution ?? '')
  const [resolutionGroup, setResolutionGroup] = React.useState<string>(wo.resolutionGroup ?? '')
  const [picAfter, setPicAfter] = React.useState<string | null>(wo.picAfter ?? null)
  const picAfterInputRef = React.useRef<HTMLInputElement>(null)

  // Complete — Step 2: WithdrawPartsAtClose
  // Lets the technician attach a parts request directly from the CompleteDialog.
  // Same search/add-line pattern as the dedicated parts dialog, but with an
  // auto-approve toggle that controls whether the WO actually completes or
  // transitions to WAITING_PARTS instead.
  const [completePartsSearch, setCompletePartsSearch] = React.useState('')
  const [completePartsSearchResults, setCompletePartsSearchResults] = React.useState<PartsStockItem[]>([])
  const [completePartsSearchLoading, setCompletePartsSearchLoading] = React.useState(false)
  const [completePartsLines, setCompletePartsLines] = React.useState<
    { productCode: string; productName: string; unit: string; quantity: string; remark: string; unitCost: number | null }[]
  >([])
  const [completeAutoApproveParts, setCompleteAutoApproveParts] = React.useState(false)

  // Cancel
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [cancelReason, setCancelReason] = React.useState('')
  const [canceling, setCanceling] = React.useState(false)

  // ── Edit-unlock (Task ID: UX-GAPS-3-ITEMS) ──
  // Admin-only action: unlock a terminal WO (COMPLETED/CANCELLED) so it
  // can be edited again. Calls POST /api/work-orders/[id]/edit-unlock.
  const [unlockOpen, setUnlockOpen] = React.useState(false)
  const [unlockNote, setUnlockNote] = React.useState('')
  const [unlocking, setUnlocking] = React.useState(false)
  const authUser = useAuthStore((s) => s.user)

  // Reporter edit
  const [reporterEditOpen, setReporterEditOpen] = React.useState(false)
  const [reporterEdit, setReporterEdit] = React.useState({
    verifyName: wo.reporterName ?? '',
    verifyPhone: wo.tel ?? '',
    employeeCode: wo.employeeCode ?? '',
    subject: wo.subject,
    building: wo.building ?? '',
    location: wo.location ?? '',
    details: wo.details ?? '',
    tel: wo.tel ?? '',
  })
  const [reporterEditSaving, setReporterEditSaving] = React.useState(false)

  // Chat
  const [chatText, setChatText] = React.useState('')
  const [sendingMsg, setSendingMsg] = React.useState(false)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const messages = wo.messages ?? []

  // ── Parts (WithdrawParts) ──
  const [partsOpen, setPartsOpen] = React.useState(false)
  const [partsRequester, setPartsRequester] = React.useState('')
  const [partsSearch, setPartsSearch] = React.useState('')
  // WO-PARTS-FLOW Level 2+: each line tracks both `quantity` (stock-out count)
  // and `usageQuantity` (fraction actually used), plus `usageSource` flag.
  // Also tracks `usageHours` and `usagePages` for cost models that need them
  // (per-hour / per-page). usagePages is also useful for "spare parts replacement"
  // jobs to record how many pages the device has printed since the last part swap.
  const [partsLines, setPartsLines] = React.useState<
    {
      productCode: string
      productName: string
      quantity: string
      usageQuantity: string
      usageUnit: string
      usageSource: 'new-bottle' | 'open-bottle' | 'new-and-open'
      usageHours: string
      usagePages: string
      remark: string
    }[]
  >([])
  const [partsSaving, setPartsSaving] = React.useState(false)
  const [partsSearchResults, setPartsSearchResults] = React.useState<PartsStockItem[]>([])
  const [partsSearchLoading, setPartsSearchLoading] = React.useState(false)

  // Approve / reject parts (inline)
  const [approvingTxnId, setApprovingTxnId] = React.useState<string | null>(null)
  const [rejectingTxnId, setRejectingTxnId] = React.useState<string | null>(null)
  const [rejectReason, setRejectReason] = React.useState('')

  // ── Print form (Repair Ticket) ──
  const [printOpen, setPrintOpen] = React.useState(false)

  // Parts list query (always on for the detail view)
  const partsQuery = useQuery<PartsListResponse>({
    queryKey: ['wo-parts', wo.id],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders/${wo.id}/parts`, {
        headers: getAuthHeaders(),
      })
      if (!res.ok) throw new Error('Failed to load parts')
      return res.json()
    },
  })
  const partsList: PartsTransaction[] = partsQuery.data?.data ?? []
  const partsSummary = partsQuery.data?.summary

  // ── Multi-image (WorkOrderImage) — grouped by stage ──
  const imagesQuery = useQuery<ImagesGroupedResponse>({
    queryKey: ['wo-images', wo.id],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders/${wo.id}/images`, {
        headers: getAuthHeaders(),
      })
      if (!res.ok) throw new Error('Failed to load images')
      return res.json()
    },
  })
  const imagesGrouped = imagesQuery.data?.grouped ?? {
    before: [],
    onsite: [],
    after: [],
  }
  // Mirror legacy single-picAfter into the "after" group so old WOs still
  // show their picAfter image even if no WorkOrderImage row exists.
  const afterImages: WorkOrderImage[] = React.useMemo(() => {
    if (imagesGrouped.after.length > 0) return imagesGrouped.after
    if (wo.picAfter) {
      return [
        {
          id: `legacy-after-${wo.id}`,
          workOrderId: wo.id,
          stage: 'after',
          image_data: wo.picAfter,
          fileName: null,
          uploadedBy: null,
          createdAt: wo.updatedAt,
        },
      ]
    }
    return []
  }, [imagesGrouped.after, wo.id, wo.picAfter, wo.updatedAt])
  // Mirror legacy picBefore / picOnsite too.
  const beforeImages: WorkOrderImage[] = React.useMemo(() => {
    if (imagesGrouped.before.length > 0) return imagesGrouped.before
    if (wo.picBefore) {
      return [
        {
          id: `legacy-before-${wo.id}`,
          workOrderId: wo.id,
          stage: 'before',
          image_data: wo.picBefore,
          fileName: null,
          uploadedBy: null,
          createdAt: wo.createdAt,
        },
      ]
    }
    return []
  }, [imagesGrouped.before, wo.id, wo.picBefore, wo.createdAt])
  const onsiteImages: WorkOrderImage[] = React.useMemo(() => {
    if (imagesGrouped.onsite.length > 0) return imagesGrouped.onsite
    if (wo.picOnsite) {
      return [
        {
          id: `legacy-onsite-${wo.id}`,
          workOrderId: wo.id,
          stage: 'onsite',
          image_data: wo.picOnsite,
          fileName: null,
          uploadedBy: null,
          createdAt: wo.updatedAt,
        },
      ]
    }
    return []
  }, [imagesGrouped.onsite, wo.id, wo.picOnsite, wo.updatedAt])

  // Image upload state — single hidden input reused for whichever stage
  // the user clicks "Addimage" on.
  const stageFileInputRef = React.useRef<HTMLInputElement>(null)
  const [activeStage, setActiveStage] = React.useState<
    'before' | 'onsite' | 'after' | null
  >(null)
  const [imgBusy, setImgBusy] = React.useState(false)
  const [lightboxSrc, setLightboxSrc] = React.useState<string | null>(null)
  const [deletingImgId, setDeletingImgId] = React.useState<string | null>(null)
  const [deleteImageTarget, setDeleteImageTarget] = React.useState<WorkOrderImage | null>(null)

  function triggerUpload(stage: 'before' | 'onsite' | 'after') {
    setActiveStage(stage)
    // Defer the click to the next tick so React has a chance to set activeStage
    // (not strictly required, but safer).
    setTimeout(() => stageFileInputRef.current?.click(), 0)
  }

  async function handleStageImageChange(
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const files = e.target.files
    const stage = activeStage
    if (!files || files.length === 0 || !stage) return
    try {
      setImgBusy(true)
      const existingCount =
        stage === 'before'
          ? beforeImages.length
          : stage === 'onsite'
            ? onsiteImages.length
            : afterImages.length
      const remaining = MAX_IMAGES_PER_STAGE - existingCount
      if (remaining <= 0) {
        toast.error(`เพิ่มรูปได้สูงสุด ${MAX_IMAGES_PER_STAGE} รูปต่อขั้นตอน`)
        return
      }
      const list = Array.from(files).slice(0, remaining)
      let added = 0
      for (const f of list) {
        try {
          const dataUrl = await compressImage(f)
          const res = await fetch(`/api/work-orders/${wo.id}/images`, {
            method: 'POST',
            headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              stage,
              image_data: dataUrl,
              fileName: f.name,
              uploadedBy: 'admin',
            }),
          })
          if (!res.ok) {
            const j = await res.json().catch(() => ({}))
            throw new Error(j.error ?? 'อัปโหลดรูปภาพไม่สำเร็จ')
          }
          added++
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'อัปโหลดรูปภาพไม่สำเร็จ',
          )
        }
      }
      if (added > 0) {
        toast.success(`เพิ่มรูปแล้ว ${added} รูป (${stage})`)
        qc.invalidateQueries({ queryKey: ['wo-images', wo.id] })
        onMutated()
      }
    } finally {
      setImgBusy(false)
      setActiveStage(null)
      if (stageFileInputRef.current) stageFileInputRef.current.value = ''
    }
  }

  // Camera capture for stage images — accepts a JPEG data URL already
  // compressed by <CameraCapture /> (max 1024px). Uploads it to the same
  // images endpoint as `handleStageImageChange` and refreshes the gallery.
  async function handleStageImageFromCamera(
    stage: 'before' | 'onsite' | 'after',
    dataUrl: string,
  ) {
    const existingCount =
      stage === 'before'
        ? beforeImages.length
        : stage === 'onsite'
          ? onsiteImages.length
          : afterImages.length
    const remaining = MAX_IMAGES_PER_STAGE - existingCount
    if (remaining <= 0) {
      toast.error(`เพิ่มรูปได้สูงสุด ${MAX_IMAGES_PER_STAGE} รูปต่อขั้นตอน`)
      return
    }
    try {
      setImgBusy(true)
      setActiveStage(stage)
      const res = await fetch(`/api/work-orders/${wo.id}/images`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          stage,
          image_data: dataUrl,
          fileName: `camera-${Date.now()}.jpg`,
          uploadedBy: 'admin',
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'อัปโหลดรูปภาพไม่สำเร็จ')
      }
      toast.success(`เพิ่มรูปจากกล้องแล้ว (${stage})`)
      qc.invalidateQueries({ queryKey: ['wo-images', wo.id] })
      onMutated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'อัปโหลดรูปภาพไม่สำเร็จ')
    } finally {
      setImgBusy(false)
      setActiveStage(null)
    }
  }

  async function handleDeleteImage(img: WorkOrderImage) {
    // Legacy mirror images can't be deleted through this endpoint — they live
    // on the WorkOrder row itself.
    if (img.id.startsWith('legacy-')) {
      toast.error('รูปนี้เป็นข้อมูลต้นฉบับ — ใช้การแก้ไขใบงานเพื่อลบ')
      return
    }
    setDeleteImageTarget(img)
  }

  async function confirmDeleteImage() {
    if (!deleteImageTarget) return
    const img = deleteImageTarget
    try {
      setDeletingImgId(img.id)
      const res = await fetch(
        `/api/work-orders/${wo.id}/images?imageId=${encodeURIComponent(img.id)}`,
        { method: 'DELETE', headers: getAuthHeaders() },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'ลบรูปภาพไม่สำเร็จ')
      }
      toast.success('ลบรูปแล้ว')
      qc.invalidateQueries({ queryKey: ['wo-images', wo.id] })
      onMutated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ลบรูปภาพไม่สำเร็จ')
    } finally {
      setDeletingImgId(null)
      setDeleteImageTarget(null)
    }
  }

  React.useEffect(() => {
    if (partsOpen) {
      // Reset the parts form when the dialog opens
      setPartsRequester('')
      setPartsSearch('')
      setPartsLines([])
      setPartsSearchResults([])
    }
  }, [partsOpen])

  // Reset the CompleteDialog's Step-2 parts section whenever the dialog opens
  // (mirrors the partsOpen reset above).
  React.useEffect(() => {
    if (completeOpen) {
      setCompletePartsSearch('')
      setCompletePartsSearchResults([])
      setCompletePartsLines([])
      setCompleteAutoApproveParts(false)
    }
  }, [completeOpen])

  // Debounced parts search for the CompleteDialog's Step-2 section.
  // Same pattern as the partsSearch effect above.
  React.useEffect(() => {
    if (!completePartsSearch.trim()) {
      setCompletePartsSearchResults([])
      return
    }
    let cancelled = false
    setCompletePartsSearchLoading(true)
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          search: completePartsSearch.trim(),
          pageSize: '20',
        })
        const res = await fetch(`/api/stock-items?${params.toString()}`, {
          headers: getAuthHeaders(),
        })
        if (!res.ok) return
        const json: PartsListApiResponse = await res.json()
        if (!cancelled) setCompletePartsSearchResults(json.data ?? [])
      } catch {
        if (!cancelled) setCompletePartsSearchResults([])
      } finally {
        if (!cancelled) setCompletePartsSearchLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [completePartsSearch])

  // Debounced parts search
  React.useEffect(() => {
    if (!partsSearch.trim()) {
      setPartsSearchResults([])
      return
    }
    let cancelled = false
    setPartsSearchLoading(true)
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ search: partsSearch.trim(), pageSize: '20' })
        const res = await fetch(`/api/stock-items?${params.toString()}`, {
          headers: getAuthHeaders(),
        })
        if (!res.ok) return
        const json: PartsListApiResponse = await res.json()
        if (!cancelled) setPartsSearchResults(json.data ?? [])
      } catch {
        if (!cancelled) setPartsSearchResults([])
      } finally {
        if (!cancelled) setPartsSearchLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [partsSearch])

  React.useEffect(() => {
    // sync tech name when WO changes
    setTechName(wo.assignedTo ?? '')
    setAssignNote(wo.assignmentNote ?? '')
    setResolutionValue(wo.resolution ?? '')
    setResolutionGroup(wo.resolutionGroup ?? '')
    setPicAfter(wo.picAfter ?? null)
    setReporterEdit({
      verifyName: wo.reporterName ?? '',
      verifyPhone: wo.tel ?? '',
      employeeCode: wo.employeeCode ?? '',
      subject: wo.subject,
      building: wo.building ?? '',
      location: wo.location ?? '',
      details: wo.details ?? '',
      tel: wo.tel ?? '',
    })
  }, [wo.id, wo.assignedTo, wo.assignmentNote, wo.resolution, wo.resolutionGroup, wo.picAfter, wo.reporterName, wo.tel, wo.employeeCode, wo.subject, wo.building, wo.location, wo.details])

  React.useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length])

  const external = parseExternalMeta(wo.externalMeta)

  const canAssign = wo.status === 'PENDING' || wo.status === 'IN_PROGRESS' || wo.status === 'WAITING_PARTS'
  const canComplete = wo.status === 'IN_PROGRESS' || wo.status === 'WAITING_PARTS'
  const canCancel = wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED'
  const canChat = wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED'
  const canReporterEdit = wo.status === 'PENDING'
  const canRequestParts = wo.status === 'IN_PROGRESS' || wo.status === 'WAITING_PARTS'
  // ── Edit-unlock (Task ID: UX-GAPS-3-ITEMS) ──
  // Admin-only: visible when the WO is terminal (COMPLETED/CANCELLED),
  // not already unlocked, AND the current user is an admin (role-based OR
  // explicit ADMIN permission grant — matches the v1 PUT route's check).
  const isTerminalWo = wo.status === 'COMPLETED' || wo.status === 'CANCELLED'
  const isAdminUser =
    authUser?.role === 'admin' || authUser?.role === 'superadmin'
  const canUnlockEdit =
    isTerminalWo && !wo.editUnlockActive && isAdminUser
  // PENDING_REVIEW → staff approves the submission (Tier 2/3 from LINE/public).
  // Approving transitions the WO into the normal queue (PENDING) so the
  // assign/complete/cancel actions become available.
  const canApprove = wo.status === 'PENDING_REVIEW'

  // Resolution groups for the dropdown
  const resolutionGroups = React.useMemo(() => {
    const map = new Map<string, ResolutionOption[]>()
    for (const r of resolutions) {
      if (!map.has(r.group)) map.set(r.group, [])
      map.get(r.group)!.push(r)
    }
    return Array.from(map.entries())
  }, [resolutions])

  async function handleAssign() {
    if (!techName.trim()) {
      toast.error('กรุณาระบุชื่อช่าง')
      return
    }
    try {
      setAssigning(true)
      const res = await fetch(`/api/work-orders/${wo.id}/assign`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          assignedTo: techName.trim(),
          assignmentNote: assignNote.trim() || null,
          actor: 'admin',
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'มอบหมายงานไม่สำเร็จ')
      }
      toast.success(`มอบหมายให้ ${techName.trim()} แล้ว`)
      setAssignOpen(false)
      onMutated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'มอบหมายงานไม่สำเร็จ')
    } finally {
      setAssigning(false)
    }
  }

  // Approve a PENDING_REVIEW WO → transition to PENDING (normal queue).
  // Uses the same PUT /api/work-orders/[id] route as the WO editor,
  // with a status-only payload. The route's VALID_STATUSES allowlist
  // accepts PENDING, so this is a safe state transition. Authorization
  // is WO_ASSIGN at the WO's Site (verified by loadAuthorizedWorkOrder).
  async function handleApprove() {
    try {
      setApproving(true)
      const res = await fetch(`/api/work-orders/${wo.id}`, {
        method: 'PUT',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          status: 'PENDING',
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'อนุมัติไม่สำเร็จ')
      }
      toast.success('อนุมัติใบงานแล้ว — เข้าคิวปกติ')
      onMutated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'อนุมัติไม่สำเร็จ')
    } finally {
      setApproving(false)
    }
  }

  // ── Edit-unlock handler (Task ID: UX-GAPS-3-ITEMS) ──
  // POST /api/work-orders/[id]/edit-unlock with { active: true, note }.
  // On success: refresh the WO detail (edit button will now be enabled
  // for the reporter / admin) and close the confirmation dialog.
  async function handleUnlockEdit() {
    try {
      setUnlocking(true)
      const res = await fetch(`/api/work-orders/${wo.id}/edit-unlock`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          active: true,
          note: unlockNote.trim() || 'ปลดล็อกเพื่อแก้ไขข้อมูลที่ผิดพลาด',
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'ปลดล็อกไม่สำเร็จ')
      }
      toast.success('ปลดล็อกการแก้ไขแล้ว — สามารถแก้ไขใบงานได้')
      setUnlockOpen(false)
      setUnlockNote('')
      onMutated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ปลดล็อกไม่สำเร็จ')
    } finally {
      setUnlocking(false)
    }
  }

  async function handlePicAfterChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const dataUrl = await compressImage(file)
      setPicAfter(dataUrl)
    } catch {
      toast.error('อ่านไฟล์รูปภาพไม่สำเร็จ')
    } finally {
      if (picAfterInputRef.current) picAfterInputRef.current.value = ''
    }
  }

  // ── Complete — Step 2 parts helpers (WithdrawPartsAtClose) ──
  function addCompletePart(item: PartsStockItem) {
    if (completePartsLines.some((l) => l.productCode === item.productCode)) {
      toast.error(`${item.productCode} มีอยู่ในรายการแล้ว`)
      return
    }
    setCompletePartsLines((prev) => [
      ...prev,
      {
        productCode: item.productCode,
        productName: item.productName,
        unit: item.unit,
        unitCost: item.unitCost,
        quantity: '1',
        remark: '',
      },
    ])
    setCompletePartsSearch('')
    setCompletePartsSearchResults([])
  }
  function removeCompletePart(idx: number) {
    setCompletePartsLines((prev) => prev.filter((_, i) => i !== idx))
  }
  function updateCompletePart(
    idx: number,
    key: 'quantity' | 'remark',
    value: string,
  ) {
    setCompletePartsLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [key]: value } : l)),
    )
  }

  async function handleComplete() {
    try {
      setCompleting(true)
      // Look up group for the chosen resolution
      let group = ''
      if (resolutionValue) {
        const opt = resolutions.find((r) => r.value === resolutionValue)
        group = opt?.group ?? ''
      }
      // Filter to lines with a positive quantity before submission.
      const validParts = completePartsLines.filter((l) => Number(l.quantity) > 0)
      const res = await fetch(`/api/work-orders/${wo.id}/complete`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          note: completeNote.trim() || null,
          resolution: resolutionValue || null,
          resolutionGroup: group || null,
          picAfter: picAfter,
          actor: 'admin',
          // Step 2: parts requested inline while completing the WO.
          // When `autoApproveParts=true` the server creates APPROVED
          // stock-outs (reduces stock immediately) so the WO can still
          // complete in this request. When false, the server creates
          // PENDING requests and flips the WO to WAITING_PARTS.
          parts: validParts.map((l) => ({
            productCode: l.productCode,
            quantity: Number(l.quantity),
            remark: l.remark.trim() || undefined,
          })),
          autoApproveParts: completeAutoApproveParts,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'ปิดงานไม่สำเร็จ')
      }
      const json = await res.json().catch(() => ({}))
      const partsCreated: number | undefined = json?.partsCreated
      const autoApproved: boolean | undefined = json?.autoApproved
      const newStatus: string | undefined = json?.data?.status
      if (partsCreated && partsCreated > 0) {
        if (newStatus === 'WAITING_PARTS' || autoApproved === false) {
          toast.success(
            `เพิ่มคำขอเบิกอะไหล่ ${partsCreated} รายการ — สถานะใบงานเปลี่ยนเป็น "รออะไหล่"`,
          )
        } else {
          toast.success(
            `พร้อมปิดงาน — เบิกอะไหล่อัตโนมัติ ${partsCreated} รายการ`,
          )
        }
      } else {
        toast.success(t('common.close'))
      }
      setCompleteOpen(false)
      setCompleteNote('')
      onMutated()
      // Invalidate the parts cache so the WO detail's parts list refreshes.
      qc.invalidateQueries({ queryKey: ['wo-parts', wo.id] })
      qc.invalidateQueries({ queryKey: ['stock-items'] })
      qc.invalidateQueries({ queryKey: ['stock-pending'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ปิดงานไม่สำเร็จ')
    } finally {
      setCompleting(false)
    }
  }

  async function handleCancel() {
    if (!cancelReason.trim()) {
      toast.error('กรุณาระบุเหตุผลในการยกเลิก')
      return
    }
    try {
      setCanceling(true)
      const res = await fetch(`/api/work-orders/${wo.id}/cancel`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          reason: cancelReason.trim(),
          actor: 'admin',
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'ยกเลิกไม่สำเร็จ')
      }
      toast.success('ยกเลิกใบงานแล้ว')
      setCancelOpen(false)
      setCancelReason('')
      onMutated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ยกเลิกไม่สำเร็จ')
    } finally {
      setCanceling(false)
    }
  }

  async function handleReporterEdit() {
    if (!reporterEdit.verifyName.trim() || !reporterEdit.verifyPhone.trim()) {
      toast.error('ต้องระบุชื่อและเบอร์โทรของผู้แจ้งเพื่อยืนยันตัวตน')
      return
    }
    try {
      setReporterEditSaving(true)
      const res = await fetch(`/api/work-orders/${wo.id}/reporter-edit`, {
        method: 'PUT',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          verifyName: reporterEdit.verifyName.trim(),
          verifyPhone: reporterEdit.verifyPhone.trim(),
          employeeCode: reporterEdit.employeeCode.trim() || undefined,
          subject: reporterEdit.subject.trim() || undefined,
          building: reporterEdit.building.trim() || null,
          location: reporterEdit.location.trim() || null,
          details: reporterEdit.details.trim() || null,
          tel: reporterEdit.tel.trim() || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'แก้ไขไม่สำเร็จ')
      }
      toast.success('แก้ไขใบงานแล้ว')
      setReporterEditOpen(false)
      onMutated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'แก้ไขไม่สำเร็จ')
    } finally {
      setReporterEditSaving(false)
    }
  }

  async function handleSendMessage() {
    const text = chatText.trim()
    if (!text) return
    try {
      setSendingMsg(true)
      const res = await fetch(`/api/work-orders/${wo.id}/messages`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          message: text,
          author: 'admin',
          authorRole: 'admin',
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'ส่งข้อความไม่สำเร็จ')
      }
      setChatText('')
      onMutated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ส่งข้อความไม่สำเร็จ')
    } finally {
      setSendingMsg(false)
    }
  }

  // ── Parts request (WithdrawParts) ──
  // WO-PARTS-FLOW Level 2+: defaults now come from the StockItem's
  // expectedDevicesPerUnit / expectedHoursPerUnit / expectedPagesPerUnit
  // (set in the Stock page). Falls back to category-based defaults if
  // those fields are not configured.
  function defaultUsageForItem(item: PartsStockItem): { qty: string; usage: string; unit: string; hours: string; pages: string } {
    // Priority 1: item-level expected values (configured in Stock page).
    if (item.expectedDevicesPerUnit && item.expectedDevicesPerUnit > 0) {
      const u = 1 / item.expectedDevicesPerUnit
      return { qty: '1', usage: String(Math.round(u * 1000) / 1000), unit: 'fraction', hours: '', pages: '' }
    }
    if (item.expectedHoursPerUnit && item.expectedHoursPerUnit > 0) {
      return { qty: '1', usage: '1', unit: 'unit', hours: String(item.expectedHoursPerUnit), pages: '' }
    }
    if (item.expectedPagesPerUnit && item.expectedPagesPerUnit > 0) {
      // For toner/cartridge items, "expected pages" = the spec yield (e.g. 6000 pages).
      // Pre-fill usagePages with this so the technician can confirm/adjust.
      return { qty: '1', usage: '1', unit: 'unit', hours: '', pages: String(item.expectedPagesPerUnit) }
    }
    // Priority 2: category-based fallback (legacy behavior).
    const c = (item.category ?? '').toUpperCase()
    if (c.includes('INK') || c.includes('TONER') || c.includes('BOTTLE')) {
      return { qty: '1', usage: '0.333', unit: 'bottle', hours: '', pages: '' }
    }
    if (c.includes('CARTRIDGE') || c.includes('DRUM')) {
      return { qty: '1', usage: '1', unit: 'cartridge', hours: '', pages: '' }
    }
    // Default: 1:1.
    return { qty: '1', usage: '1', unit: 'unit', hours: '', pages: '' }
  }

  function addPartsLine(item: PartsStockItem) {
    // Skip if already in list
    if (partsLines.some((l) => l.productCode === item.productCode)) {
      toast.error(`${item.productCode} มีอยู่ในรายการแล้ว`)
      return
    }
    const d = defaultUsageForItem(item)
    setPartsLines((prev) => [
      ...prev,
      {
        productCode: item.productCode,
        productName: item.productName,
        quantity: d.qty,
        usageQuantity: d.usage,
        usageUnit: d.unit,
        usageSource: 'new-bottle',
        usageHours: d.hours,
        usagePages: d.pages,
        remark: '',
      },
    ])
    setPartsSearch('')
    setPartsSearchResults([])

    // WO-USAGE-AUTO: fetch suggested usageHours + usagePages from server.
    // The server computes hours from WO assigned/completed timestamps, and
    // pages from the device's meter reading delta since the last part swap.
    // We don't await — fire-and-forget. When the response arrives, we
    // update the line item (only if the user hasn't manually edited it).
    fetchUsageSuggestions(item.id).then((suggestion) => {
      if (!suggestion) return
      setPartsLines((prev) =>
        prev.map((l) => {
          if (l.productCode !== item.productCode) return l
          // Only auto-fill if the user hasn't typed a value yet.
          return {
            ...l,
            usageHours:
              (l.usageHours === '' || l.usageHours === d.hours) && suggestion.suggestedHours !== null
                ? String(suggestion.suggestedHours)
                : l.usageHours,
            usagePages:
              (l.usagePages === '' || l.usagePages === d.pages) && suggestion.suggestedPagesBw !== null
                ? String(suggestion.suggestedPagesBw)
                : l.usagePages,
          }
        }),
      )
    }).catch(() => {
      // Silent — suggestions are nice-to-have, not required.
    })
  }

  // WO-USAGE-AUTO: fetch suggested usageHours + usagePages for a stock item.
  async function fetchUsageSuggestions(stockItemId: string): Promise<{
    suggestedHours: number | null
    suggestedPagesBw: number | null
    suggestedPagesColor: number | null
    lastSwapDate: string | null
  } | null> {
    try {
      const res = await fetch(
        `/api/work-orders/${wo.id}/parts/suggest-usage?stockItemIds=${encodeURIComponent(stockItemId)}`,
        { headers: getAuthHeaders() },
      )
      if (!res.ok) return null
      const json = await res.json()
      return json.data?.[stockItemId] ?? null
    } catch {
      return null
    }
  }
  function removePartsLine(idx: number) {
    setPartsLines((prev) => prev.filter((_, i) => i !== idx))
  }
  function updatePartsLine(
    idx: number,
    key: 'quantity' | 'usageQuantity' | 'usageSource' | 'usageHours' | 'usagePages' | 'remark',
    value: string,
  ) {
    setPartsLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l
        const next = { ...l, [key]: value }
        // Auto-adjust: if usageSource flips to 'open-bottle', force qty=0.
        // If flips back to 'new-bottle', restore qty=1.
        if (key === 'usageSource') {
          if (value === 'open-bottle') {
            next.quantity = '0'
          } else if (value === 'new-bottle' && l.quantity === '0') {
            next.quantity = '1'
          }
        }
        return next
      }),
    )
  }
  async function handleRequestParts() {
    // WO-PARTS-FLOW Level 2+: accept both qty>0 (new stock-out) AND qty=0 with
    // usageQuantity>0 (open-bottle usage). The server validates both.
    const valid = partsLines.filter((l) => {
      const qty = Number(l.quantity)
      const usage = Number(l.usageQuantity)
      // Valid: (qty>0) OR (qty=0 AND usage>0 AND usageSource='open-bottle')
      if (qty > 0) return true
      if (qty === 0 && usage > 0 && l.usageSource === 'open-bottle') return true
      return false
    })
    if (valid.length === 0) {
      toast.error('ต้องเพิ่มอะไหล่อย่างน้อย 1 รายการ โดยระบุจำนวนให้ถูกต้อง')
      return
    }
    try {
      setPartsSaving(true)
      // Idempotency key — same key returns the same txns on retry, no duplicates.
      const clientMutationId = `wo-${wo.id}-${Date.now()}`
      const res = await fetch(`/api/work-orders/${wo.id}/parts`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          requester: partsRequester.trim() || undefined,
          clientMutationId,
          items: valid.map((l) => ({
            productCode: l.productCode,
            quantity: Number(l.quantity),
            usageQuantity: Number(l.usageQuantity),
            usageUnit: l.usageUnit,
            usageSource: l.usageSource,
            usageHours: l.usageHours ? Number(l.usageHours) : undefined,
            usagePages: l.usagePages ? Number(l.usagePages) : undefined,
            remark: l.remark.trim() || undefined,
          })),
          actor: 'admin',
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'เบิกอะไหล่ไม่สำเร็จ')
      }
      const json = await res.json()
      const createdCount = json.data?.created ?? valid.length
      const isIdempotent = json.data?.idempotent === true
      toast.success(
        `${isIdempotent ? '(รายการซ้ำ — ใช้ข้อมูลเดิม)' : `สร้างคำขอเบิกอะไหล่ ${createdCount} รายการ`} — สถานะใบงาน: ${
          json.data?.workOrderStatus === 'WAITING_PARTS' ? 'รออะไหล่' : json.data?.workOrderStatus
        }`,
      )
      setPartsOpen(false)
      onMutated()
      qc.invalidateQueries({ queryKey: ['wo-parts', wo.id] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'เบิกอะไหล่ไม่สำเร็จ')
    } finally {
      setPartsSaving(false)
    }
  }

  async function handleApprovePart(txnId: string) {
    try {
      setApprovingTxnId(txnId)
      const res = await fetch(`/api/work-orders/${wo.id}/parts/${txnId}/approve`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ approver: 'admin' }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'อนุมัติไม่สำเร็จ')
      }
      toast.success('อนุมัติเบิกอะไหล่แล้ว')
      qc.invalidateQueries({ queryKey: ['wo-parts', wo.id] })
      qc.invalidateQueries({ queryKey: ['stock-items'] })
      qc.invalidateQueries({ queryKey: ['stock-pending'] })
      onMutated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'อนุมัติไม่สำเร็จ')
    } finally {
      setApprovingTxnId(null)
    }
  }

  async function handleRejectPart(txn: PartsTransaction) {
    if (!rejectReason.trim()) {
      toast.error('กรุณาระบุเหตุผลในการปฏิเสธ')
      return
    }
    try {
      setRejectingTxnId(txn.id)
      // Reject goes through the stock-items pending route (id = stockItemId)
      const res = await fetch(
        `/api/stock-items/${txn.stockItemId}/pending/${txn.id}/reject`,
        {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            approver: 'admin',
            reason: rejectReason.trim(),
          }),
        },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'ปฏิเสธไม่สำเร็จ')
      }
      toast.success('ปฏิเสธคำขอเบิกอะไหล่แล้ว')
      setRejectingTxnId(null)
      setRejectReason('')
      qc.invalidateQueries({ queryKey: ['wo-parts', wo.id] })
      qc.invalidateQueries({ queryKey: ['stock-pending'] })
      onMutated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ปฏิเสธไม่สำเร็จ')
    } finally {
      setRejectingTxnId(null)
    }
  }

  // Build timeline from key WO timestamps + messages.
  // NOTE: the element type is annotated on the *literal*, not on `timeline` —
  // annotating the post-`.filter()` result leaves the array literal
  // contextually untyped, so each `tone` widens to `string`.
  type TimelineEntry = {
    key: string
    label: string
    at: string | null
    tone: 'info' | 'success' | 'warning' | 'danger' | 'muted'
  }
  const timelineEntries: TimelineEntry[] = [
    { key: 'created', label: 'แจ้งซ่อม', at: wo.createdAt, tone: 'info' },
    { key: 'assigned', label: wo.assignedTo ? `มอบหมายให้ ${wo.assignedTo}` : 'มอบหมายงาน', at: wo.assignedAt, tone: wo.assignedAt ? 'info' : 'muted' },
    { key: 'completed', label: 'ปิดงาน', at: wo.workCompletedAt ?? wo.closedAt, tone: wo.workCompletedAt ? 'success' : 'muted' },
    { key: 'cancelled', label: wo.cancelReason ? `ยกเลิก — ${wo.cancelReason}` : 'ยกเลิก', at: wo.canceledAt, tone: wo.canceledAt ? 'danger' : 'muted' },
  ]
  const timeline = timelineEntries.filter((t) => t.at !== null || t.key === 'created')

  return (
    <div className="flex h-full flex-col">
      {/* Header — with 44px close button for mobile */}
      <div className="space-y-2 border-b px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className="font-mono text-xs font-semibold text-muted-foreground">
              {wo.woNumber ?? '—'}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1">
            {external && (
              <Badge
                className="border-teal-200 bg-teal-100 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300"
                variant="outline"
              >
                งานภายนอก
              </Badge>
            )}
            {wo.isSpecialFee && (
              <Badge
                className="border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
                variant="outline"
              >
                💰 พิเศษ (มีค่าใช้จ่าย)
              </Badge>
            )}
            <Badge
              className={statusBadgeClass(wo.status) + ' px-2.5 py-1 text-xs font-semibold'}
              variant="outline"
            >
              {statusLabel(wo.status)}
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPrintOpen(true)}
              aria-label="พิมพ์ใบงาน"
              title="พิมพ์ใบงาน"
              className="h-8 gap-1 px-2.5 text-xs"
            >
              <Printer className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">พิมพ์ใบงาน</span>
            </Button>
            <DialogClose
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-orange-500 sm:hidden"
              aria-label={t('settings.close')}
            >
              <X className="h-5 w-5" />
            </DialogClose>
          </div>
        </div>
        <h2 className="text-base font-bold leading-tight sm:text-lg">{wo.subject}</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarClock className="h-3.5 w-3.5" />
            {formatDateTime(wo.createdAt)}
          </span>
          <span aria-hidden>•</span>
          <Badge
            className={priorityBadgeClass(wo.priority) + ' px-2 py-0.5 text-[11px] font-semibold'}
            variant="outline"
          >
            {wo.priority}
          </Badge>
          <span className="text-[10px] uppercase tracking-wide">
            ({wo.submissionSource === 'session' ? 'ผู้ใช้ในระบบ' : 'บุคคลทั่วไป'})
          </span>
        </div>
      </div>

      {/* Body — scrollable (with max-height for desktop) */}
      <div className="flex-1 overflow-y-auto sm:max-h-[calc(92vh-8rem)]">
        <div className="space-y-4 px-4 py-4 sm:px-5">
          {/* External block */}
          {external && (
            <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-800 dark:bg-teal-950/30">
              <div className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-teal-700 dark:text-teal-300">
                <PackageOpen className="h-3.5 w-3.5" />
                ข้อมูลลูกค้าภายนอก
              </div>
              <div className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
                {external.clientName && (
                  <div>
                    <span className="text-[10px] uppercase text-muted-foreground">ลูกค้า</span>
                    <div className="font-medium">{external.clientName}</div>
                  </div>
                )}
                {external.place && (
                  <div>
                    <span className="text-[10px] uppercase text-muted-foreground">สถานที่</span>
                    <div className="font-medium">{external.place}</div>
                  </div>
                )}
                {external.contactPhone && (
                  <div>
                    <span className="text-[10px] uppercase text-muted-foreground">เบอร์ติดต่อ</span>
                    <div className="font-medium">{external.contactPhone}</div>
                  </div>
                )}
              </div>
              {external.serials && external.serials.length > 0 && (
                <div className="mt-2">
                  <div className="mb-1 text-[10px] uppercase text-muted-foreground">S/N</div>
                  <div className="flex flex-wrap gap-1.5">
                    {external.serials.map((s) => (
                      <Badge key={s} variant="outline" className="gap-1 font-mono text-[11px]">
                        <Hash className="h-3 w-3" />
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Info grid */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {!external && (
              <>
                <InfoRow
                  icon={<MapPin className="h-4 w-4" />}
                  label="อาคาร / แผนก"
                  value={wo.building ?? '—'}
                />
                <InfoRow
                  icon={<MapPin className="h-4 w-4" />}
                  label="ตำแหน่ง / ห้อง"
                  value={wo.location ?? '—'}
                />
              </>
            )}
            <InfoRow
              icon={<User className="h-4 w-4" />}
              label="ผู้แจ้ง"
              value={wo.reporterName ?? '—'}
            />
            <InfoRow
              icon={<Phone className="h-4 w-4" />}
              label="โทรศัพท์"
              value={wo.tel ?? '—'}
            />
            {wo.employeeCode && (
              <InfoRow
                icon={<Hash className="h-4 w-4" />}
                label="รหัสพนักงาน"
                value={wo.employeeCode}
              />
            )}
            {wo.device && (
              <InfoRow
                icon={<ClipboardList className="h-4 w-4" />}
                label="รหัสทะเบียนอุปกรณ์"
                value={`${wo.device.assetCode} — ${wo.device.name}`}
              />
            )}
            <InfoRow
              icon={<User className="h-4 w-4" />}
              label="ช่างผู้รับผิดชอบ"
              value={wo.assignedTo ?? '—'}
            />
            <InfoRow
              icon={<CalendarClock className="h-4 w-4" />}
              label="เวลาที่มอบหมาย"
              value={wo.assignedAt ? formatDateTime(wo.assignedAt) : '—'}
            />
            {wo.assignedBy && (
              <InfoRow
                icon={<User className="h-4 w-4" />}
                label="มอบหมายโดย"
                value={wo.assignedBy}
              />
            )}
            {wo.workCompletedAt && (
              <InfoRow
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="เวลาที่เสร็จงาน"
                value={formatDateTime(wo.workCompletedAt)}
              />
            )}
            {wo.closedAt && wo.closedAt !== wo.workCompletedAt && (
              <InfoRow
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="เวลาที่ปิดงาน"
                value={formatDateTime(wo.closedAt)}
              />
            )}
          </div>

          {/* Assignment note */}
          {wo.assignmentNote && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="mb-1 text-xs font-semibold text-muted-foreground">
                หมายเหตุการมอบหมาย
              </div>
              <p className="whitespace-pre-wrap">{wo.assignmentNote}</p>
            </div>
          )}

          {/* Details */}
          {wo.details && (
            <div className="rounded-lg border bg-muted/40 p-3">
              <div className="mb-1 text-xs font-semibold text-muted-foreground">
                รายละเอียดปัญหา
              </div>
              <p className="whitespace-pre-wrap text-sm">{wo.details}</p>
            </div>
          )}

          {/* Admin note + Resolution */}
          {(wo.detailsAdmin || wo.resolution) && (
            <div className="space-y-2">
              {wo.resolution && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/40">
                  <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    ผลการซ่อม
                    {wo.resolutionGroup && (
                      <span className="ml-1 rounded bg-emerald-200/60 px-1.5 py-0.5 text-[10px] dark:bg-emerald-900/60">
                        {wo.resolutionGroup}
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap">{wo.resolution}</p>
                </div>
              )}
              {wo.detailsAdmin && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm dark:border-orange-800 dark:bg-orange-950/40">
                  <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-orange-700 dark:text-orange-300">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    หมายเหตุช่างเทคนิค
                  </div>
                  <p className="whitespace-pre-wrap">{wo.detailsAdmin}</p>
                </div>
              )}
            </div>
          )}

          {/* Cancel reason */}
          {wo.status === 'CANCELLED' && wo.cancelReason && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm dark:border-rose-800 dark:bg-rose-950/40">
              <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-rose-700 dark:text-rose-300">
                <XCircle className="h-3.5 w-3.5" />
                เหตุผลที่ยกเลิก
              </div>
              <p className="whitespace-pre-wrap">{wo.cancelReason}</p>
            </div>
          )}

          {/* Edit-unlock info */}
          {wo.editUnlockActive && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/40">
              <div className="mb-1 flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300">
                <Edit3 className="h-3.5 w-3.5" />
                ปลดล็อกให้ผู้แจ้งแก้ไข
              </div>
              <div>
                ปลดล็อกโดย: {wo.editUnlockBy ?? '—'} • {wo.editUnlockAt ? formatDateTime(wo.editUnlockAt) : '—'}
              </div>
              {wo.editUnlockNote && <div className="mt-0.5">หมายเหตุ: {wo.editUnlockNote}</div>}
            </div>
          )}

          {/* Smart Prompt (WO-PARTS-FLOW): if the WO subject contains keywords
              that typically require parts (FillInk, subInk, drum, cartridge, etc.)
              AND no parts have been requested yet, show an amber prompt reminding
              the technician to add parts. This addresses the user feedback:
              "TechniciansomepersonSelectSubjectFillInk แ่NoWithdrawInk". */}
          {canRequestParts && partsList.length === 0 && (() => {
            const subject = (wo.subject ?? '').toLowerCase()
            const details = (wo.details ?? '').toLowerCase()
            const hasTonerKeyword =
              subject.includes('Ink') ||
              subject.includes('Cartridge') ||
              subject.includes('sub') ||
              subject.includes('drum') ||
              subject.includes('cartridge') ||
              subject.includes('toner') ||
              details.includes('Ink') ||
              details.includes('Cartridge')
            if (!hasTonerKeyword) return null
            return (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="flex-1">
                    <div className="font-semibold text-amber-800 dark:text-amber-300">
                      ประเด็นที่พบบ่อย — ต้องเบิกอะไหล่
                    </div>
                    <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                      ตรวจสอบและเบิกอะไหล่ที่ต้องใช้ (หมึก/ตลับหมึก/ผงหมึก/ดรัม) — ระบุจำนวนตามที่ใช้จริง
                      หากใช้จากขวดที่เปิดแล้ว ให้เลือก &quot;ใช้ขวดที่เปิดแล้ว&quot; (ไม่ตัดสต๊อก)
                    </div>
                  </div>
                  <Button type="button"
                    size="sm"
                    onClick={() => setPartsOpen(true)}
                    className="h-7 bg-amber-600 px-2 text-[11px] hover:bg-amber-700"
                  >
                    <Package className="mr-1 h-3 w-3" />
                    เบิกอะไหล่
                  </Button>
                </div>
              </div>
            )
          })()}

          {/* Parts list (WithdrawParts) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Box className="h-3.5 w-3.5" />
                รายการเบิกอะไหล่
                {partsSummary && partsSummary.total > 0 && (
                  <Badge variant="outline" className="ml-1 text-[10px]">
                    รออนุมัติ {partsSummary.pending} • อนุมัติแล้ว {partsSummary.approved} • ปฏิเสธ {partsSummary.rejected}
                  </Badge>
                )}
              </div>
              {canRequestParts && (
                <Button type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPartsOpen(true)}
                  className="h-7 border-purple-300 px-2 text-[11px] text-purple-700 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-300 dark:hover:bg-purple-950/40"
                >
                  <Package className="mr-1 h-3 w-3" />
                  เบิกอะไหล่
                </Button>
              )}
            </div>

            {partsQuery.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : partsList.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                ยังไม่มีรายการเบิกอะไหล่สำหรับใบงานนี้
                {canRequestParts && ' — กดปุ่ม "เบิกอะไหล่" เพื่อสร้างคำขอ'}
              </p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border bg-card p-2">
                {partsList.map((p) => {
                  const status = p.approvalStatus ?? 'APPROVED'
                  const stockItem = p.stockItem
                  return (
                    <div
                      key={p.id}
                      className="rounded-md border bg-background p-2.5 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] font-semibold text-purple-600 dark:text-purple-400">
                              {p.productCode ?? '—'}
                            </span>
                            <span className="truncate font-medium">
                              {p.productName ?? stockItem?.productName ?? '—'}
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            เลขที่: {p.txnNumber ?? '—'} • จำนวน:{' '}
                            <span className="font-semibold text-foreground">
                              {p.quantity} {p.unit ?? ''}
                            </span>
                            {stockItem && (
                              <>
                                {' '}• คงเหลือในสต๊อก:{' '}
                                <span
                                  className={
                                    stockItem.quantity < p.quantity
                                      ? 'font-semibold text-rose-600 dark:text-rose-400'
                                      : 'font-semibold text-foreground'
                                  }
                                >
                                  {stockItem.quantity} {stockItem.unit}
                                </span>
                              </>
                            )}
                          </div>
                          {p.remark && (
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              หมายเหตุ: {p.remark}
                            </div>
                          )}
                          {p.rejectReason && (
                            <div className="mt-0.5 text-[11px] text-rose-600 dark:text-rose-400">
                              สาเหตุที่ปฏิเสธ: {p.rejectReason}
                            </div>
                          )}
                          {p.approver && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              โดย: {p.approver}
                              {p.approvedAt && ` • ${formatDateTime(p.approvedAt)}`}
                            </div>
                          )}
                        </div>
                        <PartsStatusBadge status={status} />
                      </div>
                      {status === 'PENDING' && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2">
                          <Button type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleApprovePart(p.id)}
                            disabled={approvingTxnId === p.id}
                            className="h-7 border-emerald-300 px-2 text-[11px] text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                          >
                            {approvingTxnId === p.id ? (
                              <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="mr-1 h-3 w-3" />
                            )}
                            อนุมัติ
                          </Button>
                          {rejectingTxnId === p.id ? (
                            <div className="flex flex-1 items-center gap-1">
                              <Input
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                placeholder="สาเหตุที่ปฏิเสธ"
                                className="h-7 flex-1 text-[11px]"
                                autoFocus
                              />
                              <Button type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => handleRejectPart(p)}
                                disabled={!rejectReason.trim()}
                                className="h-7 border-rose-300 px-2 text-[11px] text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/40"
                              >
                                ยืนยัน
                              </Button>
                              <Button type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setRejectingTxnId(null)
                                  setRejectReason('')
                                }}
                                className="h-7 px-2 text-[11px]"
                              >
                                ยกเลิก
                              </Button>
                            </div>
                          ) : (
                            <Button type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setRejectingTxnId(p.id)
                                setRejectReason('')
                              }}
                              className="h-7 border-rose-300 px-2 text-[11px] text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/40"
                            >
                              <XCircle className="mr-1 h-3 w-3" />
                              ปฏิเสธ
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {partsSummary && partsSummary.pending > 0 && (
              <div className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                ⚠️ ยังปิดงานไม่ได้ — มีคำขอเบิกอะไหล่ {partsSummary.pending} รายการรอการอนุมัติ
              </div>
            )}
          </div>

          {/* Images — grouped by stage, multi-image per stage */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <ImageIcon className="h-3.5 w-3.5" />
              รูปภาพแยกตามขั้นตอน
              {imagesQuery.isFetching && (
                <RefreshCw className="ml-1 h-3 w-3 animate-spin" />
              )}
            </div>
            {/* Hidden input reused for all 3 stages. `multiple` + `capture`
                let mobile browsers open the back camera directly. */}
            <input
              ref={stageFileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={handleStageImageChange}
              className="hidden"
              aria-hidden
            />
            <WoImageStageGroup
              label="ก่อนซ่อม"
              stageKey="before"
              images={beforeImages}
              onAdd={() => triggerUpload('before')}
              onCamera={(dataUrl) => handleStageImageFromCamera('before', dataUrl)}
              onView={(src) => setLightboxSrc(src)}
              onDelete={(img) => handleDeleteImage(img)}
              deletingId={deletingImgId}
              busy={imgBusy && activeStage === 'before'}
              canAdd={true}
            />
            <WoImageStageGroup
              label="ระหว่างซ่อม"
              stageKey="onsite"
              images={onsiteImages}
              onAdd={() => triggerUpload('onsite')}
              onCamera={(dataUrl) => handleStageImageFromCamera('onsite', dataUrl)}
              onView={(src) => setLightboxSrc(src)}
              onDelete={(img) => handleDeleteImage(img)}
              deletingId={deletingImgId}
              busy={imgBusy && activeStage === 'onsite'}
              canAdd={true}
            />
            <WoImageStageGroup
              label="หลังซ่อม"
              stageKey="after"
              images={afterImages}
              onAdd={() => triggerUpload('after')}
              onCamera={(dataUrl) => handleStageImageFromCamera('after', dataUrl)}
              onView={(src) => setLightboxSrc(src)}
              onDelete={(img) => handleDeleteImage(img)}
              deletingId={deletingImgId}
              busy={imgBusy && activeStage === 'after'}
              canAdd={true}
            />
          </div>

          {/* Timeline */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">
              ไทม์ไลน์
            </div>
            <ol className="relative space-y-3 border-l-2 border-muted pl-4">
              {timeline.map((t) => (
                <li key={t.key} className="relative">
                  <span
                    className={`absolute -left-[21px] top-1 h-3 w-3 rounded-full border-2 border-background ${
                      t.tone === 'success'
                        ? 'bg-emerald-500'
                        : t.tone === 'danger'
                          ? 'bg-rose-500'
                          : t.tone === 'warning'
                            ? 'bg-amber-500'
                            : t.tone === 'info'
                              ? 'bg-orange-500'
                              : 'bg-slate-300'
                    }`}
                  />
                  <div className="text-sm font-medium">{t.label}</div>
                  {t.at && (
                    <div className="text-[11px] text-muted-foreground">
                      {formatDateTime(t.at)}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {/* Chat */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" />
              ข้อความ ({messages.length})
            </div>
            {messages.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                ยังไม่มีข้อความในใบงานนี้
              </p>
            ) : (
              <div className="min-h-[180px] max-h-80 space-y-2 overflow-y-auto rounded-md border bg-muted/30 p-3">
                {messages.map((m) => {
                  const isSystem = m.authorRole === 'system'
                  return (
                    <div
                      key={m.id}
                      className={`flex ${isSystem ? 'justify-center' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                          isSystem
                            ? 'bg-muted text-muted-foreground'
                            : m.authorRole === 'admin'
                              ? 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-100'
                              : m.authorRole === 'reporter'
                                ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100'
                                : 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100'
                        }`}
                      >
                        {!isSystem && (
                          <div className="mb-0.5 text-[10px] font-semibold opacity-70">
                            {m.author ?? '—'} · {m.authorRole ?? 'staff'}
                          </div>
                        )}
                        <p className="whitespace-pre-wrap break-words">{m.message}</p>
                        <div className="mt-0.5 text-right text-[10px] opacity-60">
                          {relativeTime(m.createdAt)}
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div ref={messagesEndRef} />
              </div>
            )}
            {canChat && (
              <div className="flex items-center gap-2">
                <Input
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  placeholder="พิมพ์ข้อความ..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSendMessage()
                    }
                  }}
                  disabled={sendingMsg}
                />
                <Button type="button"
                  size="sm"
                  onClick={handleSendMessage}
                  disabled={sendingMsg || !chatText.trim()}
                  className="min-h-11 bg-orange-500 hover:bg-orange-600"
                >
                  {sendingMsg ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer actions — sticky at bottom, all buttons ≥44px (min-h-11).
          Order: PRIMARY workflow actions first (Close, Assign, WithdrawParts,
          Cancel) so they're visible on row 1 on mobile; secondary actions
          (Print, ReporterEdit) come after since they're less time-critical. */}
      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-white px-3 py-3 dark:bg-slate-900 sm:px-5">
        {canApprove && (
          <Button type="button"
            size="sm"
            onClick={() => void handleApprove()}
            disabled={approving}
            className="order-1 min-h-11 w-full bg-emerald-600 hover:bg-emerald-700 sm:w-auto"
          >
            {approving ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            อนุมัติ
          </Button>
        )}
        {canComplete && (
          <Button type="button"
            size="sm"
            onClick={() => setCompleteOpen(true)}
            className="order-1 min-h-11 w-full bg-emerald-600 hover:bg-emerald-700 sm:w-auto"
          >
            <CheckCircle2 className="h-4 w-4" />
            ปิดงาน
          </Button>
        )}
        {canAssign && (
          <Button type="button"
            size="sm"
            variant="outline"
            onClick={() => setAssignOpen(true)}
            className="order-2 min-h-11 border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950"
          >
            <User className="h-4 w-4" />
            {wo.assignedTo ? 'เปลี่ยนช่างซ่อม' : 'มอบหมายช่างซ่อม'}
          </Button>
        )}
        {canRequestParts && (
          <Button type="button"
            size="sm"
            variant="outline"
            onClick={() => setPartsOpen(true)}
            className="order-3 min-h-11 border-purple-300 text-purple-700 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-300 dark:hover:bg-purple-950"
          >
            <Package className="h-4 w-4" />
            เบิกอะไหล่
          </Button>
        )}
        {canCancel && (
          <Button type="button"
            size="sm"
            variant="outline"
            onClick={() => setCancelOpen(true)}
            className="order-4 min-h-11 border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950"
          >
            <XCircle className="h-4 w-4" />
            ยกเลิก
          </Button>
        )}
        <Button type="button"
          size="sm"
          variant="outline"
          onClick={() => setPrintOpen(true)}
          className="order-5 min-h-11 border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950"
        >
          <Printer className="h-4 w-4" />
          <span className="hidden sm:inline">พิมพ์ใบงาน</span>
          <span className="sm:hidden">พิมพ์</span>
        </Button>
        <Button type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            if (!wo.id) return
            const t = useAuthStore.getState()?.token
            const qs = t ? `?t=${encodeURIComponent(t)}` : ''
            window.open(`/api/work-orders/${wo.id}/print-sheet${qs}`, '_blank', 'noopener,noreferrer')
          }}
          className="order-6 min-h-11 border-teal-300 text-teal-700 hover:bg-teal-50 dark:border-teal-700 dark:text-teal-300 dark:hover:bg-teal-950"
          title="พิมพ์ใบงานช่าง (แผ่นข้อมูลย่อ พร้อมคิวอาร์โคด)"
        >
          <Printer className="h-4 w-4" />
          <span className="hidden sm:inline">ใบงานช่าง (QR)</span>
          <span className="sm:hidden">QR</span>
        </Button>
        {canReporterEdit && (
          <Button type="button"
            size="sm"
            variant="outline"
            onClick={() => setReporterEditOpen(true)}
            className="order-7 min-h-11 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950"
          >
            <Edit3 className="h-4 w-4" />
            <span className="hidden sm:inline">แก้ไขผู้แจ้ง</span>
            <span className="sm:hidden">แก้ไข</span>
          </Button>
        )}
        {/* ── Admin-only: unlock terminal WO for editing (Task ID: UX-GAPS-3-ITEMS) ── */}
        {canUnlockEdit && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setUnlockOpen(true)}
            className="order-7 min-h-11 border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950"
            title="ปลดล็อกเพื่อแก้ไข (สำหรับแอดมิน)"
          >
            <Unlock className="h-4 w-4" />
            <span className="hidden sm:inline">ปลดล็อกเพื่อแก้ไข</span>
            <span className="sm:hidden">ปลดล็อก</span>
          </Button>
        )}
        {/* Spacer: order-8 puts it AFTER the action buttons (order-1..order-7)
            and BEFORE the Close button (order-last). P2 fix: previously the
            spacer had default order=0, so it landed before all positive-order
            actions — on mobile with a full-width primary button, the spacer
            could expand across a blank first flex line. */}
        <div className="order-8 flex-1" />
        <Button type="button" size="sm" variant="ghost" onClick={onClose} className="order-last min-h-11">
          ปิด
        </Button>
      </div>

      {/* Assign dialog */}
      <AlertDialog open={assignOpen} onOpenChange={setAssignOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>มอบหมายช่างซ่อม</AlertDialogTitle>
            <AlertDialogDescription>
              ระบุชื่อช่างที่จะรับผิดชอบใบงาน {wo.woNumber}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="tech-name">ชื่อช่าง</Label>
              <Input
                id="tech-name"
                value={techName}
                onChange={(e) => setTechName(e.target.value)}
                placeholder="เช่น สมชาย"
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="assign-note">หมายเหตุ (ถ้ามี)</Label>
              <Textarea
                id="assign-note"
                value={assignNote}
                onChange={(e) => setAssignNote(e.target.value)}
                placeholder="เช่น นัดเข้าตรวจสอบวันที่..."
                className="min-h-[60px]"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={assigning}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={assigning || !techName.trim()}
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                void handleAssign()
              }}
            >
              {assigning ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : null}
              มอบหมายงาน
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Complete dialog */}
      <AlertDialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>ปิดงาน</AlertDialogTitle>
            <AlertDialogDescription>
              ยืนยันการปิดงาน {wo.woNumber} — สถานะจะเปลี่ยนเป็น &quot;เสร็จแล้ว&quot;
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="complete-resolution">ผลการซ่อม</Label>
              {resolutions.length === 0 ? (
                <Input
                  id="complete-resolution"
                  value={resolutionValue}
                  onChange={(e) => setResolutionValue(e.target.value)}
                  placeholder="พิมพ์ผลการซ่อม"
                />
              ) : (
                <Select
                  value={resolutionValue}
                  onValueChange={(v) => {
                    setResolutionValue(v)
                    const opt = resolutions.find((r) => r.value === v)
                    setResolutionGroup(opt?.group ?? '')
                  }}
                >
                  <SelectTrigger id="complete-resolution">
                    <SelectValue placeholder="เลือกผลการซ่อม" />
                  </SelectTrigger>
                  <SelectContent>
                    {resolutionGroups.map(([group, opts]) => (
                      <SelectGroup key={group}>
                        <SelectLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {group}
                        </SelectLabel>
                        {opts.map((o) => (
                          <SelectItem key={group + '|' + o.value} value={o.value}>
                            {o.value}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="complete-note">หมายเหตุการซ่อม</Label>
              <Textarea
                id="complete-note"
                value={completeNote}
                onChange={(e) => setCompleteNote(e.target.value)}
                placeholder="เช่น เปลี่ยนหมึก, แก้ไขการตั้งค่าเครือข่าย..."
                className="min-h-[80px]"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="complete-pic-after">รูปหลังซ่อม (ไม่บังคับ)</Label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={picAfterInputRef}
                  id="complete-pic-after"
                  type="file"
                  accept="image/*"
                  onChange={handlePicAfterChange}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => picAfterInputRef.current?.click()}
                >
                  <ImageIcon className="h-4 w-4" />
                  {picAfter ? 'เปลี่ยนรูป' : 'เลือกรูป'}
                </Button>
                <CameraCapture
                  onCapture={(dataUrl) => setPicAfter(dataUrl)}
                  label="ถ่ายรูป"
                />
                {picAfter && (
                  <div className="flex items-center gap-1">
                    <img
                      src={picAfter}
                      alt="รูปหลังซ่อม"
                      className="h-8 w-8 rounded border object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setPicAfter(null)}
                      className="text-[11px] text-rose-500 underline"
                    >
                      ลบ
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Step 2: WithdrawPartsAtClose ── */}
          {/* Purple-bordered box mirroring the parts dialog pattern, but
              with an auto-approve toggle that controls whether the WO
              actually completes in this request (auto) or transitions to
              WAITING_PARTS (manual). */}
          <div className="space-y-3 rounded-lg border border-purple-200 bg-purple-50/40 p-3 dark:border-purple-900/60 dark:bg-purple-950/20">
            <div className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              <span className="text-sm font-semibold text-purple-700 dark:text-purple-300">
                เบิกอะไหล่ตอนปิดงาน
              </span>
              <Badge
                variant="outline"
                className="border-purple-200 bg-purple-100 text-[10px] text-purple-700 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300"
              >
                (ตัวเลือก)
              </Badge>
            </div>
            <p className="text-[11px] leading-relaxed text-purple-700/80 dark:text-purple-300/80">
              เพิ่มอะไหล่ที่ใช้ซ่อม — หากปิดงานโดยใช้ &quot;อนุมัติอัตโนมัติ&quot; ระบบจะตัดสต๊อกอัตโนมัติ
              และปิดงานทันที หากยังไม่ปิดงาน ใบงานจะเปลี่ยนสถานะเป็น &quot;รออะไหล่&quot;
              และรอการอนุมัติก่อนปิดงาน
            </p>

            {/* Search box */}
            <div className="grid gap-1.5">
              <Label
                htmlFor="complete-parts-search"
                className="text-purple-700 dark:text-purple-300"
              >
                ค้นหาสินค้า
              </Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="complete-parts-search"
                  value={completePartsSearch}
                  onChange={(e) => setCompletePartsSearch(e.target.value)}
                  placeholder="พิมพ์รหัสสินค้า / ชื่อ / ยี่ห้อ"
                  className="bg-white pl-9 dark:bg-slate-900"
                />
              </div>
              {completePartsSearchLoading && (
                <div className="text-[11px] text-muted-foreground">
                  กำลังค้นหา...
                </div>
              )}
              {!completePartsSearchLoading &&
                completePartsSearchResults.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-md border border-purple-200 bg-card dark:border-purple-900/60">
                    {completePartsSearchResults.map((it) => (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => addCompletePart(it)}
                        disabled={!it.active}
                        className="flex w-full items-center justify-between gap-2 border-b border-purple-100 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-purple-900/60 dark:hover:bg-purple-950/40"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-mono font-semibold text-purple-600 dark:text-purple-400">
                            {it.productCode}
                          </div>
                          <div className="truncate text-muted-foreground">
                            {it.productName}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>
                            คงเหลือ: {it.quantity} {it.unit}
                          </span>
                          <Plus className="h-3 w-3 text-purple-500" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              {!completePartsSearchLoading &&
                completePartsSearch.trim() &&
                completePartsSearchResults.length === 0 && (
                  <div className="rounded-md border border-dashed border-purple-200 p-3 text-center text-[11px] text-muted-foreground dark:border-purple-900/60">
                    ไม่พบสินค้าที่ตรงกับ &quot;{completePartsSearch}&quot;
                  </div>
                )}
            </div>

            {/* Selected parts list */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-purple-700 dark:text-purple-300">
                  รายการที่เบิก ({completePartsLines.length})
                </Label>
              </div>
              {completePartsLines.length === 0 ? (
                <div className="rounded-md border border-dashed border-purple-200 p-3 text-center text-[11px] text-muted-foreground dark:border-purple-900/60">
                  ยังไม่ได้เลือกอะไหล่ — ค้นหาแล้วกด + เพื่อเพิ่ม
                </div>
              ) : (
                <div className="space-y-2">
                  {completePartsLines.map((line, idx) => (
                    <div
                      key={`${line.productCode}-${idx}`}
                      className="grid grid-cols-12 gap-2 rounded-md border border-purple-100 bg-white p-2 dark:border-purple-900/60 dark:bg-slate-900"
                    >
                      <div className="col-span-12 sm:col-span-6">
                        <div className="font-mono text-[11px] font-semibold text-purple-600 dark:text-purple-400">
                          {line.productCode}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {line.productName}
                        </div>
                        {line.unitCost !== null && line.unitCost > 0 && (
                          <div className="text-[10px] text-muted-foreground">
                            ราคา/หน่วย: THB
                            {line.unitCost.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </div>
                        )}
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <Input
                          type="number"
                          min="1"
                          value={line.quantity}
                          onChange={(e) =>
                            updateCompletePart(idx, 'quantity', e.target.value)
                          }
                          className="h-8 text-xs"
                          placeholder={t('common.quantity')}
                        />
                      </div>
                      <div className="col-span-7 sm:col-span-3">
                        <Input
                          value={line.remark}
                          onChange={(e) =>
                            updateCompletePart(idx, 'remark', e.target.value)
                          }
                          className="h-8 text-xs"
                          placeholder={t('devices.placeholder.remark')}
                        />
                      </div>
                      <div className="col-span-1 flex items-center justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          onClick={() => removeCompletePart(idx)}
                          aria-label="ลบรายการ"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Auto-approve toggle + status hint */}
            {completePartsLines.length > 0 && (
              <div className="space-y-2">
                <label
                  htmlFor="complete-auto-approve"
                  className="flex cursor-pointer items-start gap-2 text-xs"
                >
                  <Checkbox
                    id="complete-auto-approve"
                    checked={completeAutoApproveParts}
                    onCheckedChange={(v) =>
                      setCompleteAutoApproveParts(v === true)
                    }
                    className="mt-0.5 border-emerald-400 data-[state=checked]:border-emerald-600 data-[state=checked]:bg-emerald-600"
                  />
                  <span className="flex-1">
                    <span className="font-medium text-emerald-700 dark:text-emerald-300">
                      อนุมัติเบิกอะไหล่อัตโนมัติ
                    </span>
                    <br />
                    <span className="text-muted-foreground">
                      เมื่อปิดงาน — ระบบจะตัดสต๊อกและปิดงานทันที
                    </span>
                  </span>
                </label>
                <div
                  className={
                    completeAutoApproveParts
                      ? 'rounded-md border border-emerald-200 bg-emerald-50 p-2 text-[11px] text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
                      : 'rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
                  }
                >
                  {completeAutoApproveParts ? (
                    <>
                      ✓ พร้อมปิดงาน — เบิกอะไหล่ {completePartsLines.length} รายการ
                      (ตัดสต๊อกทันที)
                    </>
                  ) : (
                    <>
                      ⚠ ใบงานจะเปลี่ยนสถานะเป็น &quot;รออะไหล่&quot; และต้องอนุมัติเบิกอะไหล่ก่อนปิดงาน
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={completing}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={completing}
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                void handleComplete()
              }}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {completing ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              ปิดงาน
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel dialog */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยกเลิกใบงาน</AlertDialogTitle>
            <AlertDialogDescription>
              ยืนยันการยกเลิกใบงาน {wo.woNumber} — ไม่สามารถย้อนกลับได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5 py-2">
            <Label htmlFor="cancel-reason">
              เหตุผลที่ยกเลิก <span className="text-rose-500">*</span>
            </Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="เช่น ผู้แจ้งขอถอนการติดตั้ง, ซ่อมเอง, ไม่พบปัญหาจริง..."
              className="min-h-[80px]"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={canceling}>ปิด</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={canceling || !cancelReason.trim()}
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                void handleCancel()
              }}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {canceling ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              ยกเลิกใบงาน
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Edit-unlock confirmation dialog (Task ID: UX-GAPS-3-ITEMS) ── */}
      <AlertDialog open={unlockOpen} onOpenChange={setUnlockOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Unlock className="h-5 w-5 text-orange-500" />
              ปลดล็อกเพื่อแก้ไขใบงาน
            </AlertDialogTitle>
            <AlertDialogDescription>
              ใบงาน {wo.woNumber} อยู่ในสถานะ {wo.status}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              ⚠️ การปลดล็อกจะทำให้แก้ไขใบงานที่ปิดไปแล้วได้อีกครั้ง
              ใช้เฉพาะกรณีแก้ไขข้อมูลที่ผิดพลาดเท่านั้น
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="unlock-note">
                Remark <span className="text-[10px] text-slate-400">(ไม่บังคับ)</span>
              </Label>
              <Textarea
                id="unlock-note"
                value={unlockNote}
                onChange={(e) => setUnlockNote(e.target.value)}
                placeholder="ระบุเหตุผลในการปลดล็อก เช่น แก้ไขข้อมูลที่ผิดพลาด..."
                className="min-h-[60px]"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unlocking}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={unlocking}
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                void handleUnlockEdit()
              }}
              className="bg-orange-500 hover:bg-orange-600"
            >
              {unlocking ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Unlock className="h-4 w-4" />
              )}
              ปลดล็อกเพื่อแก้ไข
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reporter edit dialog */}
      <Dialog open={reporterEditOpen} onOpenChange={setReporterEditOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="h-5 w-5 text-amber-500" />
              ผู้แจ้งแก้ไขใบงานของตนเอง
            </DialogTitle>
            <DialogDescription>
              แก้ไขได้เฉพาะใบงานที่ยังไม่ได้รับเรื่อง (สถานะ PENDING)
              ต้องยืนยันตัวตนด้วยชื่อและเบอร์โทรของผู้แจ้ง
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="re-verify-name">
                  ชื่อผู้แจ้ง <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="re-verify-name"
                  value={reporterEdit.verifyName}
                  onChange={(e) =>
                    setReporterEdit((s) => ({ ...s, verifyName: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="re-verify-phone">
                  โทรศัพท์ <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="re-verify-phone"
                  value={reporterEdit.verifyPhone}
                  onChange={(e) =>
                    setReporterEdit((s) => ({ ...s, verifyPhone: e.target.value }))
                  }
                  inputMode="tel"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="re-emp">รหัสพนักงาน (ไม่บังคับ)</Label>
              <Input
                id="re-emp"
                value={reporterEdit.employeeCode}
                onChange={(e) =>
                  setReporterEdit((s) => ({ ...s, employeeCode: e.target.value }))
                }
              />
            </div>
            <div className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              ชื่อและเบอร์โทรต้องตรงกับสมุดรายชื่อและข้อมูลผู้แจ้งในใบงาน
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="re-subject">ประเภทปัญหา</Label>
              <Input
                id="re-subject"
                value={reporterEdit.subject}
                onChange={(e) =>
                  setReporterEdit((s) => ({ ...s, subject: e.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="re-building">อาคาร / แผนก</Label>
                <Input
                  id="re-building"
                  value={reporterEdit.building}
                  onChange={(e) =>
                    setReporterEdit((s) => ({ ...s, building: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="re-location">{t('devices.field.location')}</Label>
                <Input
                  id="re-location"
                  value={reporterEdit.location}
                  onChange={(e) =>
                    setReporterEdit((s) => ({ ...s, location: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="re-details">รายละเอียด</Label>
              <Textarea
                id="re-details"
                value={reporterEdit.details}
                onChange={(e) =>
                  setReporterEdit((s) => ({ ...s, details: e.target.value }))
                }
                className="min-h-[80px]"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="re-tel">เบอร์โทรใหม่</Label>
              <Input
                id="re-tel"
                value={reporterEdit.tel}
                onChange={(e) =>
                  setReporterEdit((s) => ({ ...s, tel: e.target.value }))
                }
                inputMode="tel"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button"
              variant="outline"
              onClick={() => setReporterEditOpen(false)}
              disabled={reporterEditSaving}
            >
              ยกเลิก
            </Button>
            <Button type="button"
              onClick={handleReporterEdit}
              disabled={reporterEditSaving}
              className="bg-amber-500 hover:bg-amber-600"
            >
              {reporterEditSaving ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Edit3 className="h-4 w-4" />
              )}
              บันทึกการแก้ไข
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Parts request dialog (WithdrawParts) ── */}
      <Dialog open={partsOpen} onOpenChange={setPartsOpen}>
        <DialogContent className="max-h-[92vh] overflow-hidden sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-purple-500" />
              เบิกอะไหล่ — {wo.woNumber ?? '—'}
            </DialogTitle>
            <DialogDescription>
              ค้นหาอะไหล่ที่ต้องการ ระบุจำนวน แล้วกดบันทึก — ระบบจะสร้างคำขอรอการอนุมัติ
              (หากไม่มีอะไหล่ค้างรอ สถานะใบงานจะเปลี่ยนเป็น &quot;รออะไหล่&quot;)
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[68vh]">
            <div className="grid gap-3 px-1 py-1">
              {/* Requester */}
              <div className="grid gap-1.5">
                <Label htmlFor="parts-requester">ผู้เบิก (ไม่บังคับ)</Label>
                <Input
                  id="parts-requester"
                  value={partsRequester}
                  onChange={(e) => setPartsRequester(e.target.value)}
                  placeholder="ชื่อช่าง / ผู้เบิก"
                />
              </div>

              {/* Search products */}
              <div className="grid gap-1.5">
                <Label htmlFor="parts-search">ค้นหาสินค้า</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="parts-search"
                    value={partsSearch}
                    onChange={(e) => setPartsSearch(e.target.value)}
                    placeholder="พิมพ์รหัสสินค้า / ชื่อ / ยี่ห้อ"
                    className="pl-9"
                    autoFocus
                  />
                </div>
                {partsSearchLoading && (
                  <div className="text-[11px] text-muted-foreground">
                    กำลังค้นหา...
                  </div>
                )}
                {!partsSearchLoading && partsSearchResults.length > 0 && (
                  <div className="max-h-48 overflow-y-auto rounded-md border bg-card">
                    {partsSearchResults.map((it) => (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => addPartsLine(it)}
                        disabled={!it.active}
                        className="flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-mono font-semibold text-purple-600 dark:text-purple-400">
                            {it.productCode}
                          </div>
                          <div className="truncate text-muted-foreground">
                            {it.productName}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>
                            คงเหลือ: {it.quantity} {it.unit}
                          </span>
                          <Plus className="h-3 w-3 text-purple-500" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {!partsSearchLoading &&
                  partsSearch.trim() &&
                  partsSearchResults.length === 0 && (
                    <div className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
                      ไม่พบสินค้าที่ตรงกับ &quot;{partsSearch}&quot;
                    </div>
                  )}
              </div>

              {/* Selected parts list */}
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label>รายการที่เบิก ({partsLines.length})</Label>
                </div>
                {partsLines.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                    ยังไม่ได้เลือกอะไหล่ — ค้นหาแล้วกด + เพื่อเพิ่ม
                  </div>
                ) : (
                  <div className="space-y-2">
                    {partsLines.map((line, idx) => {
                      const isOpenBottle = line.usageSource === 'open-bottle'
                      return (
                        <div
                          key={`${line.productCode}-${idx}`}
                          className={`rounded-md border p-2 ${isOpenBottle ? 'border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/20' : 'border-purple-200 bg-purple-50/30 dark:border-purple-800 dark:bg-purple-950/20'}`}
                        >
                          {/* Header row: product code + name + delete */}
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className={`font-mono text-[11px] font-semibold ${isOpenBottle ? 'text-amber-700 dark:text-amber-400' : 'text-purple-600 dark:text-purple-400'}`}>
                                {line.productCode}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {line.productName}
                              </div>
                            </div>
                            <Button type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                              onClick={() => removePartsLine(idx)}
                              aria-label="ลบรายการ"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>

                          {/* ── Source toggle (simplified to 2 options) ── */}
                          <div className="mb-2 flex gap-1">
                            <button
                              type="button"
                              onClick={() => updatePartsLine(idx, 'usageSource', 'new-bottle')}
                              className={`flex-1 rounded border px-2 py-1 text-[10px] font-medium ${line.usageSource !== 'open-bottle' ? 'border-purple-500 bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}
                            >
                              📦 เบิกใหม่
                            </button>
                            <button
                              type="button"
                              onClick={() => updatePartsLine(idx, 'usageSource', 'open-bottle')}
                              className={`flex-1 rounded border px-2 py-1 text-[10px] font-medium ${line.usageSource === 'open-bottle' ? 'border-amber-500 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}
                            >
                              🔁 ใช้ขวดที่เปิดแล้ว
                            </button>
                          </div>

                          {/* ── SMART MINIMAL UI ──
                              Show only the inputs the technician MUST fill, based on
                              what the StockItem spec declares:

                              - QuantityatWithdraw (quantity) — ALWAYS shown (mandatory)
                              - Usereal (usageQuantity) — shown when costModel='fixed' AND
                                expectedDevicesPerUnit is set (technician confirms fraction)
                              - hr (usageHours) — shown when costModel='per-hour'
                                (auto-filled from WO timestamps, technician can adjust)
                              - frontPrint (usagePages) — shown when costModel='per-page'
                                OR when expectedPagesPerUnit is set (auto-filled from
                                device meter delta, technician can adjust)
                              - Remark (remark) — ALWAYS shown (optional)

                              Cost/price is NEVER shown to the technician — that's a
                              backend concern (computed from StockItem.unitCost + the
                              usage values). */}
                          {/* Find the StockItem spec for this line to decide which inputs to show */}
                          {(() => {
                            // Look up the item's spec from partsSearchResults OR from a cached spec map.
                            // Since we don't have a persistent map, we use the line's existing fields
                            // + the defaultUsageForItem() defaults to infer the cost model.
                            // (Better approach: store the full StockItem on the line. For now, infer.)
                            const stockItem = partsSearchResults.find((s) => s.productCode === line.productCode)
                            const costModel = stockItem?.costModel ?? 'fixed'
                            const expectedDevices = stockItem?.expectedDevicesPerUnit ?? null
                            const expectedHours = stockItem?.expectedHoursPerUnit ?? null
                            const expectedPages = stockItem?.expectedPagesPerUnit ?? null

                            // Decide which optional inputs to show:
                            const showUsageQuantity =
                              costModel === 'fixed' && (expectedDevices !== null && expectedDevices > 0)
                            const showUsageHours =
                              costModel === 'per-hour' || (expectedHours !== null && expectedHours > 0)
                            const showUsagePages =
                              costModel === 'per-page' || (expectedPages !== null && expectedPages > 0)

                            return (
                              <div className="grid grid-cols-12 gap-2">
                                {/* QuantityatWithdraw — always shown */}
                                <div className={isOpenBottle ? 'col-span-12' : 'col-span-6 sm:col-span-4'}>
                                  <Label className="mb-1 block text-[10px] text-muted-foreground">
                                    จำนวนที่เบิก {!isOpenBottle && <span className="text-rose-500">*</span>}
                                  </Label>
                                  <Input
                                    type="number"
                                    min={isOpenBottle ? '0' : '1'}
                                    step="1"
                                    value={line.quantity}
                                    onChange={(e) => updatePartsLine(idx, 'quantity', e.target.value)}
                                    disabled={isOpenBottle}
                                    className="h-9 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                                    placeholder="1"
                                  />
                                  <p className="mt-0.5 text-[9px] text-slate-400">
                                    {isOpenBottle ? 'ไม่ตัดสต๊อก (qty=0)' : 'จำนวนที่จะตัดจากคลัง'}
                                  </p>
                                </div>

                                {/* Usereal (fragmentbottles) — only when expectedDevices is set */}
                                {showUsageQuantity && (
                                  <div className="col-span-6 sm:col-span-4">
                                    <Label className="mb-1 block text-[10px] text-muted-foreground">
                                      จำนวนที่ใช้จริง (เศษของขวด) {expectedDevices ? <span className="text-slate-400">· 1 ขวด = {expectedDevices} หน่วย</span> : null}
                                    </Label>
                                    <Input
                                      type="number"
                                      step="0.001"
                                      min="0"
                                      value={line.usageQuantity}
                                      onChange={(e) => updatePartsLine(idx, 'usageQuantity', e.target.value)}
                                      className="h-9 text-sm"
                                      placeholder="0.333"
                                    />
                                    <div className="mt-0.5 flex gap-0.5 text-[9px]">
                                      {['0.25', '0.333', '0.5', '1'].map((v) => (
                                        <button key={v} type="button"
                                          onClick={() => updatePartsLine(idx, 'usageQuantity', v)}
                                          className="flex-1 rounded bg-slate-100 px-1 py-0.5 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                                        >
                                          {v}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* hr — only when per-hour model OR expectedHours is set */}
                                {showUsageHours && (
                                  <div className="col-span-6 sm:col-span-4">
                                    <Label className="mb-1 block text-[10px] text-muted-foreground">
                                      ชม. ที่ใช้ {expectedHours ? <span className="text-slate-400">· ปกติ {expectedHours} ชม.</span> : null}
                                    </Label>
                                    <Input
                                      type="number"
                                      step="0.5"
                                      min="0"
                                      value={line.usageHours}
                                      onChange={(e) => updatePartsLine(idx, 'usageHours', e.target.value)}
                                      className="h-9 text-sm"
                                      placeholder="0"
                                    />
                                    <p className="mt-0.5 text-[9px] text-slate-400">
                                      {line.usageHours ? `ใช้ไป ${line.usageHours} ชม.` : 'ระบบจะดึงจากเวลาซ่อมอัตโนมัติ'}
                                    </p>
                                  </div>
                                )}

                                {/* frontPrint — only when per-page model OR expectedPages is set */}
                                {showUsagePages && (
                                  <div className="col-span-6 sm:col-span-4">
                                    <Label className="mb-1 block text-[10px] text-muted-foreground">
                                      จำนวนแผ่นที่พิมพ์ {expectedPages ? <span className="text-slate-400">· พิมพ์ได้ {expectedPages.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น</span> : null}
                                    </Label>
                                    <Input
                                      type="number"
                                      min="0"
                                      value={line.usagePages}
                                      onChange={(e) => updatePartsLine(idx, 'usagePages', e.target.value)}
                                      className="h-9 text-sm"
                                      placeholder="0"
                                    />
                                    <p className="mt-0.5 text-[9px] text-slate-400">
                                      {line.usagePages ? `${Number(line.usagePages).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น` : 'ระบบจะดึงจากมิเตอร์อัตโนมัติ'}
                                    </p>
                                  </div>
                                )}

                                {/* Remark — always shown (optional) */}
                                <div className={isOpenBottle ? 'col-span-12' : 'col-span-6 sm:col-span-4'}>
                                  <Label className="mb-1 block text-[10px] text-muted-foreground">
                                    หมายเหตุ
                                  </Label>
                                  <Input
                                    value={line.remark}
                                    onChange={(e) => updatePartsLine(idx, 'remark', e.target.value)}
                                    className="h-9 text-sm"
                                    placeholder="หมายเหตุ (ถ้ามี)"
                                  />
                                </div>
                              </div>
                            )
                          })()}

                          {isOpenBottle && (
                            <div className="mt-1.5 rounded bg-amber-100 px-2 py-1 text-[10px] text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                              ℹ️ ใช้จากขวดหมึกที่เปิดแล้วตอนปิดงาน — ไม่ตัดสต๊อก (qty=0) บันทึกเฉพาะจำนวนที่ใช้จริง
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button type="button"
              variant="outline"
              onClick={() => setPartsOpen(false)}
              disabled={partsSaving}
            >
              ยกเลิก
            </Button>
            <Button type="button"
              onClick={handleRequestParts}
              disabled={partsSaving || partsLines.length === 0}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {partsSaving ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Package className="h-4 w-4" />
              )}
              ส่งคำขอเบิก ({partsLines.filter((l) => Number(l.quantity) > 0 || (Number(l.usageQuantity) > 0 && l.usageSource === 'open-bottle')).length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Print form dialog (Repair Ticket) ── */}
      {/* Use the new Visual Template Editor-driven print flow.
          If WO has a printTemplateId, the dialog uses that template
          automatically (with a "ChangeTemplate" option). */}
      <TemplatePrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        workOrderId={wo.id}
        woNumber={wo.woNumber}
        fixedTemplateId={wo.printTemplateId ?? null}
      />

      {/* ── Image lightbox (full-size view) ── */}
      <Dialog
        open={Boolean(lightboxSrc)}
        onOpenChange={(v) => {
          if (!v) setLightboxSrc(null)
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-[92vw] overflow-hidden border-none bg-black/95 p-0 sm:max-w-[1000px]">
          <DialogHeader className="sr-only">
            <DialogTitle>ดูขนาดเต็ม</DialogTitle>
            <DialogDescription>
              คลิกนอกรูปหรือกด Esc เพื่อปิด
            </DialogDescription>
          </DialogHeader>
          {lightboxSrc && (
            <div className="relative flex max-h-[92vh] items-center justify-center">
              <img
                src={normalizeImageUrl(lightboxSrc) ?? undefined}
                alt="รูปภาพขนาดเต็ม"
                className="max-h-[92vh] max-w-full object-contain"
                onError={(e) => {
                  // If full-res fails, show message instead of broken image.
                  const target = e.currentTarget as HTMLImageElement
                  target.style.display = 'none'
                  const parent = target.parentElement
                  if (parent && !parent.querySelector('.lightbox-fallback')) {
                    const div = document.createElement('div')
                    div.className = 'lightbox-fallback p-6 text-center text-sm text-muted-foreground'
                    div.textContent = 'โหลดรูปภาพไม่ได้ — ไฟล์ใน Google Drive อาจถูกตั้งค่าเป็นส่วนตัวหรือลิงก์หมดอายุ'
                    parent.appendChild(div)
                  }
                }}
              />
              <button
                type="button"
                onClick={() => setLightboxSrc(null)}
                className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                aria-label={t('settings.close')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete image confirmation */}
      <AlertDialog open={!!deleteImageTarget} onOpenChange={(open) => !open && setDeleteImageTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบ</AlertDialogTitle>
            <AlertDialogDescription>
              ต้องการลบรูปภาพ ({deleteImageTarget?.stage ?? ''}) ใช่หรือไม่? การกระทำนี้ยกเลิกไม่ได้
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
    </div>
  )
}

function PartsStatusBadge({ status }: { status: string }) {
  if (status === 'PENDING') {
    return (
      <Badge
        variant="outline"
        className="border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
      >
        รอการอนุมัติ
      </Badge>
    )
  }
  if (status === 'APPROVED') {
    return (
      <Badge
        variant="outline"
        className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      >
        อนุมัติ
      </Badge>
    )
  }
  if (status === 'REJECTED') {
    return (
      <Badge
        variant="outline"
        className="border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300"
      >
        ปฏิเสธ
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className="border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
    >
      {status}
    </Badge>
  )
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="truncate text-sm font-medium">{value}</div>
      </div>
    </div>
  )
}

function WoImageStageGroup({
  label,
  stageKey,
  images,
  onAdd,
  onCamera,
  onView,
  onDelete,
  deletingId,
  busy,
  canAdd,
}: {
  label: string
  stageKey: 'before' | 'onsite' | 'after'
  images: WorkOrderImage[]
  onAdd: () => void
  onCamera: (dataUrl: string) => void
  onView: (src: string) => void
  onDelete: (img: WorkOrderImage) => void
  deletingId: string | null
  busy: boolean
  canAdd: boolean
}) {
  const full = images.length >= MAX_IMAGES_PER_STAGE
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              stageKey === 'before'
                ? 'bg-amber-500'
                : stageKey === 'onsite'
                  ? 'bg-blue-500'
                  : 'bg-emerald-500'
            }`}
            aria-hidden
          />
          {label}
          <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {images.length}/{MAX_IMAGES_PER_STAGE}
          </span>
        </div>
        {canAdd && (
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onAdd}
              disabled={busy || full}
              className="min-h-9 px-3 text-xs sm:min-h-7 sm:px-2 sm:text-[11px]"
            >
              {busy ? (
                <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin sm:h-3 sm:w-3" />
              ) : (
                <Plus className="mr-1 h-3.5 w-3.5 sm:h-3 sm:w-3" />
              )}
              เพิ่มรูป
            </Button>
            <CameraCapture
              onCapture={onCamera}
              label="ถ่ายรูป"
              className="min-h-9 px-3 text-xs sm:min-h-7 sm:px-2 sm:text-[11px]"
            />
          </div>
        )}
      </div>
      {images.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-4 text-center text-[11px] text-muted-foreground">
          ยังไม่มีรูปภาพในขั้นตอนนี้
          {canAdd && ' — กด "เพิ่มรูป" เพื่ออัปโหลด'}
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-2 sm:grid sm:grid-cols-4 sm:overflow-visible sm:pb-0">
          {images.map((img) => {
            const isDeleting = deletingId === img.id
            const isLegacy = img.id.startsWith('legacy-')
            return (
              <div
                key={img.id}
                className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-md border bg-muted/30 sm:h-auto sm:w-auto sm:aspect-square"
              >
                <button
                  type="button"
                  onClick={() => onView(img.image_data)}
                  className="absolute inset-0 h-full w-full"
                  aria-label={`ดูรูป ${label} ขนาดเต็ม`}
                  title="ดูขนาดเต็ม"
                >
                  <img
                    src={normalizeImageUrlThumb(img.image_data) ?? undefined}
                    alt={`${label} ${img.fileName ?? ''}`}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      // If the Google Drive thumbnail fails to load (e.g. file
                      // is private), fall back to a placeholder icon.
                      const target = e.currentTarget as HTMLImageElement
                      target.style.display = 'none'
                      const parent = target.parentElement
                      if (parent && !parent.querySelector('.img-fallback')) {
                        const div = document.createElement('div')
                        div.className = 'img-fallback flex h-full w-full items-center justify-center bg-muted text-muted-foreground'
                        div.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>'
                        parent.appendChild(div)
                      }
                    }}
                    loading="lazy"
                  />
                </button>
                {/* Hover toolbar */}
                <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-end gap-1 bg-gradient-to-b from-black/60 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onView(img.image_data)
                    }}
                    className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                    aria-label="ดูขนาดเต็ม"
                    title="ดูขนาดเต็ม"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  {!isLegacy && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(img)
                      }}
                      disabled={isDeleting}
                      className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-rose-600 disabled:opacity-50"
                      aria-label="ลบรูปภาพ"
                      title="ลบรูปภาพ"
                    >
                      {isDeleting ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                  {img.fileName ?? label}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

