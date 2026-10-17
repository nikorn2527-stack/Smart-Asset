'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Progress } from '@/components/ui/progress'
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
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import {
  Plus,
  RefreshCw,
  Pencil,
  Copy,
  Trash2,
  Search,
  Download,
  Upload,
  PackageOpen,
  X,
  ArrowRight,
  History,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  ScanLine,
  AlertTriangle,
  CheckCircle2,
  Wrench,
  XCircle,
  ShieldCheck,
  Keyboard,
  Columns3,
  Eye,
  Clock,
  ChevronsUpDown,
  Check,
  Printer,
  Zap,
  Layers,
  Loader2,
} from 'lucide-react'
import {
  type Device,
  type Site,
  DEVICE_STATUS_OPTIONS,
  statusBadgeClass,
  computeWarranty,
  formatMonthThai,
  canSelectSite,
} from './types'
import { DeviceDetailSheet } from './device-detail-sheet'
import { CsvImportDialog } from './csv-import-dialog'
import { StickerPrintDialog } from './sticker-print-dialog'
import { QuickAddDeviceDialog } from './quick-add-device-dialog'
import { printSingleSticker as quickPrintSticker } from './sticker-print-helpers'
import { PrintTemplateSelectionDialog } from './print-template-selection-dialog'
import { Combobox } from './combobox'
import { CustomExportDialog, type ExportColumn, type ExportFormat } from './custom-export-dialog'
import { runCustomExport } from '@/lib/custom-export'
import { downloadCsv, dateStamp } from '@/lib/csv'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { useAuthStore } from '@/store/auth-store'
import { useT, useFormatDateTime, useLang } from '@/store/i18n-store'
import { PaginationBar } from './pagination-bar'
import {
  buildDefaultTemplate,
  renderStickerFromTemplate,
  buildPrintDocument,
  DEFAULT_STICKER_SETTINGS,
  deviceToStickerData,
  type StickerElement,
  type StickerSettings,
  type StickerTemplate,
} from '@/lib/sticker-template'
import { generateStickerQrData } from '@/lib/smart-qr'
import QRCode from 'qrcode'

/** Build fetch headers with the user's JWT (if logged in). */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const t = useAuthStore.getState()?.token
  if (t) h['Authorization'] = `Bearer ${t}`
  return h
}

/** Authenticated fetch wrapper — forwards the Bearer token to the API. */
async function authFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

/**
 * Auto-format a MAC address as the user types: strips everything but
 * hex chars, uppercases, and inserts ":" every 2 chars (max 6 groups).
 *   "aabbccddeeff"   → "AA:BB:CC:DD:EE:FF"
 *   "aa:bb:cc-dd-ee" → "AA:BB:CC:DD:EE"
 */
function formatMacInput(raw: string): string {
  const hex = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase().slice(0, 12)
  if (!hex) return ''
  return (hex.match(/.{1,2}/g) ?? []).join(':')
}

const DEVICE_CSV_HEADERS = [
  { key: 'assetCode', label: 'devices.col.asset_code' },
  { key: 'name', label: 'common.name' },
  { key: 'brand', label: 'common.brand' },
  { key: 'model', label: 'common.model' },
  { key: 'reports.unit.type', label: 'common.type' },
  { key: 'serialNumber', label: 'common.serial' },
  { key: 'status', label: 'common.status' },
  { key: 'site', label: 'common.site' },
  { key: 'currentAssignee', label: 'devices.filter.assignee' },
  { key: 'department', label: 'common.department' },
  { key: 'departmentCode', label: 'devices.field.department_code' },
  { key: 'parentRef', label: 'ParentRef' },
  { key: 'displayLabel', label: 'DisplayLabel' },
  { key: 'location', label: 'common.location' },
  { key: 'purchaseDate', label: 'devices.col.purchase_date' },
  { key: 'lastMeterReading', label: 'devices.col.last_meter' },
]

/** License / Software row — mirrors the LicenseRecord Prisma model.
 *  Field names are camelCase in the client, mapped to PascalCase by the API. */
export interface LicenseRow {
  id?: string // present when loaded from DB (edit mode)
  licenseId: string // License_ID
  software: string // Software (required)
  licenseType: string // LicenseType (OEM | Volume | Retail | Subscription | Open License)
  licenseKey: string // License_Key
  quantity: number // Quantity
  expiryDate: string // Expiry_Date (yyyy-mm-dd)
  remark: string // Remark
}

/**
 * PendingAccessory — mirrors the DeviceAccessory Prisma model.
 *
 * Stored in the device Add/Edit form's local state until the user clicks
 * "'Save'" (Task ID: INLINE-ACCESSORY-IN-DEVICE-FORM). After the device is
 * created/updated, save() POSTs each row to /api/devices/[id]/accessories.
 *
 * `id` is present when loaded from DB (edit mode) — rows with an id are
 * PUT-updated; rows without an id are POST-created.
 */
export interface PendingAccessory {
  id?: string // present when loaded from DB (edit mode)
  accessoryType: string // KEYBOARD | MOUSE | MONITOR | ...
  brand: string
  model: string
  serialNumber: string
  status: string // Active | Inactive | In Repair | Disposed
  installedDate: string // yyyy-mm-dd (optional)
  remark: string
  /** Set when the user marks a row for deletion on edit mode. */
  _pendingDelete?: boolean
}

const ACCESSORY_TYPES_INLINE = [
  { value: 'KEYBOARD', labelKey: 'devices.acc_type.KEYBOARD' },
  { value: 'MOUSE', labelKey: 'devices.acc_type.MOUSE' },
  { value: 'MONITOR', labelKey: 'devices.acc_type.MONITOR' },
  { value: 'SCANNER', labelKey: 'devices.acc_type.SCANNER' },
  { value: 'CABLE', labelKey: 'devices.acc_type.CABLE' },
  { value: 'ADAPTER', labelKey: 'devices.acc_type.ADAPTER' },
  { value: 'type.ups', labelKey: 'devices.acc_type.UPS' },
  { value: 'HUB', labelKey: 'devices.acc_type.HUB' },
  { value: 'PRINTHEAD', labelKey: 'devices.acc_type.PRINTHEAD' },
  { value: 'TRAY', labelKey: 'devices.acc_type.TRAY' },
  { value: 'OTHER', labelKey: 'devices.acc_type.OTHER' },
] as const

const ACCESSORY_STATUSES_INLINE = [
  { value: 'status.active', labelKey: 'devices.acc_status.Active' },
  { value: 'status.inactive', labelKey: 'devices.acc_status.Inactive' },
  { value: 'devices.kpi.repair', labelKey: 'devices.acc_status.In Repair' },
  { value: 'devices.acc_status.Disposed', labelKey: 'devices.acc_status.Disposed' },
] as const

const EMPTY_ACCESSORY: PendingAccessory = {
  accessoryType: 'KEYBOARD',
  brand: '',
  model: '',
  serialNumber: '',
  status: 'Active',
  installedDate: '',
  remark: '',
}

const EMPTY_LICENSE: LicenseRow = {
  licenseId: '',
  software: '',
  licenseType: '',
  licenseKey: '',
  quantity: 1,
  expiryDate: '',
  remark: '',
}

const LICENSE_TYPE_OPTIONS = [
  { value: '__none__', labelKey: 'devices.lic_type.__none__' },
  { value: 'OEM', labelKey: 'devices.lic_type.OEM' },
  { value: 'Volume', labelKey: 'devices.lic_type.Volume' },
  { value: 'Retail', labelKey: 'devices.lic_type.Retail' },
  { value: 'Subscription', labelKey: 'devices.lic_type.Subscription' },
  { value: 'devices.lic_type.Open License', labelKey: 'devices.lic_type.Open License' },
] as const

interface FormState {
  id?: string
  assetCode: string
  assetSiteCode: string
  name: string
  brand: string
  model: string
  type: string
  serialNumber: string
  status: string
  site: string
  department: string
  departmentCode: string
  parentRef: string
  displayLabel: string
  location: string
  // ── 'Location' ──
  building: string
  floor: string
  room: string
  // ── 'Network / Other' ──
  ip: string
  mac: string
  remoteId: string
  // ── 'Purchase / Warranty' ──
  purchaseDate: string
  warrantyMonths: string
  purchasePrice: string
  salvageValue: string
  usefulLife: string
  warrantyEnd: string
  vendor: string
  contractNo: string
  uninstallDate: string
  // ── 'Meter' ──
  meterRequired: boolean
  meterMode: string
  // ── 'Other' ──
  costCenter: string
  deviceGroup: string
  remark: string
  // ── Device Set / Parent-Child (Task ID 9, Phase 2) ──
  parentDeviceId: string    // "" = no parent (this device is a parent or standalone)
  setLabel: string          // e.g. "ชุด'devices'พิมพ์'Room'จ่ายยา"
  setPosition: string      // "" = unset
  // ── License / Software (NEW) ──
  licenses: LicenseRow[]
  // ── Inline Accessories (Task ID: INLINE-ACCESSORY-IN-DEVICE-FORM) ──
  // Local state only — POSTed to /api/devices/[id]/accessories after the
  // device is created/updated. Best-effort: failures don't fail the device
  // save (logged via toast.warning).
  accessories: PendingAccessory[]
}

/**
 * DeviceGroup Thai labels — the MasterItem stores English codes (COMPANY,
 * LEASED, DEPT, PERSONAL) but the UI should display them in Thai so users
 * understand the meaning. The stored value stays the English code so the
 * backend / CSV / Apps Script bridge keeps working.
 */
const DEVICE_GROUP_LABEL_KEYS: Record<string, string> = {
  COMPANY: 'devices.group.company',
  LEASED: 'devices.group.leased',
  DEPT: 'devices.group.dept',
  PERSONAL: 'devices.group.personal',
}

/** Default DeviceGroup code on Add New (the user requested "'Organization'"). */
const DEFAULT_DEVICE_GROUP = 'COMPANY'

// ── Device form wizard (Full mode — Approach A) ──
// Replaces the old 5-tab layout. Each step maps 1:1 to the old tab field
// JSX; requiredFields lists the save()-critical fields that live in that
// step — used to gate the Next button and to jump back on save() errors.
interface WizardStepDef {
  key: string
  labelKey: string
  requiredFields: string[]
}

const WIZARD_STEPS: WizardStepDef[] = [
  {
    key: 'location',
    labelKey: 'devices.tab.location',
    // The device-identity block (Type/Brand/Model/Name/Serial) lives in
    // step 1 alongside site + assetCode.
    requiredFields: ['site', 'assetCode', 'name', 'type', 'brand', 'model'],
  },
  { key: 'device', labelKey: 'devices.tab.device', requiredFields: [] },
  { key: 'accessories', labelKey: 'devices.tab.accessories', requiredFields: [] },
  { key: 'set', labelKey: 'devices.tab.set', requiredFields: [] },
  { key: 'advanced', labelKey: 'devices.tab.advanced', requiredFields: [] },
]

/** i18n label keys for required fields (used in the missing-fields toast). */
const WIZARD_FIELD_LABEL_KEYS: Record<string, string> = {
  site: 'devices.field.site',
  assetCode: 'devices.field.asset_code',
  name: 'devices.field.name',
  type: 'devices.field.type',
  brand: 'devices.field.brand',
  model: 'devices.field.model',
}

const EMPTY_FORM: FormState = {
  assetCode: '',
  assetSiteCode: '',
  name: '',
  brand: '',
  model: '',
  type: '',
  serialNumber: '',
  status: 'active',
  site: '',
  department: '',
  departmentCode: '',
  parentRef: '',
  displayLabel: '',
  location: '',
  building: '',
  floor: '',
  room: '',
  ip: '',
  mac: '',
  remoteId: '',
  purchaseDate: '',
  warrantyMonths: '12',
  purchasePrice: '',
  salvageValue: '0',
  usefulLife: '60',
  warrantyEnd: '',
  vendor: '',
  contractNo: '',
  uninstallDate: '',
  meterRequired: false,
  meterMode: 'TOTAL',
  costCenter: '',
  deviceGroup: DEFAULT_DEVICE_GROUP,
  remark: '',
  parentDeviceId: '',
  setLabel: '',
  setPosition: '',
  licenses: [],
  accessories: [],
}

const METER_MODE_OPTIONS = [
  { value: 'TOTAL', labelKey: 'devices.meter_mode.total' },
  { value: 'BW_COLOR', labelKey: 'devices.meter_mode.bw_color' },
] as const

const WARRANTY_FILTER_OPTIONS = [
  { value: 'all', labelKey: 'devices.warranty.all' },
  { value: 'expiring', labelKey: 'devices.warranty.expiring' },
  { value: 'expired', labelKey: 'devices.warranty.expired' },
] as const

const ASSIGNEE_FILTER_OPTIONS = [
  { value: 'all', labelKey: 'devices.assignee.all' },
  { value: 'assigned', labelKey: 'devices.assignee.assigned' },
  { value: 'unassigned', labelKey: 'devices.assignee.unassigned' },
] as const

/**
 * Status value → i18n key map (mirrors DEVICE_STATUS_OPTIONS in ./types so we
 * can render translated labels without modifying the shared const).
 */
const DEVICE_STATUS_LABEL_KEY: Record<string, string> = {
  active: 'devices.status.active',
  spare: 'devices.status.spare',
  repair: 'devices.status.repair',
  disposed: 'devices.status.disposed',
}
function deviceStatusLabelKey(value: string): string {
  return DEVICE_STATUS_LABEL_KEY[value] ?? 'devices.status.active'
}

export function DevicesPage() {
  const qc = useQueryClient()
  const t = useT()
  const { lang } = useLang()
  const fmtDateTime = useFormatDateTime()
  const [search, setSearch] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState('all')
  const [siteFilter, setSiteFilter] = React.useState('all')
  const [warrantyFilter, setWarrantyFilter] = React.useState<string>('all')
  const [assigneeFilter, setAssigneeFilter] = React.useState<string>('all')
  const [dialogOpen, setDialogOpen] = React.useState(false)
  // SPRINT-3 #1: Quick Add dialog (5 fields only, fast entry)
  const [quickAddOpen, setQuickAddOpen] = React.useState(false)
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = React.useState(false)
  // ── Wizard state (Full mode — Approach A) ──
  // Replaces the old 5-tab layout: one step visible at a time, with a
  // progress bar and per-step required-field gating on "Next".
  // step = current step, maxVisited = furthest step reached (lets the user
  // jump back freely but never skip ahead past unvalidated steps).
  const [step, setStep] = React.useState(0)
  const [maxVisited, setMaxVisited] = React.useState(0)
  // Scroll container of the wizard body — reset to top whenever the step
  // changes so each step starts at its first field (no stale scroll pos).
  const wizardBodyRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    wizardBodyRef.current?.scrollTo({ top: 0 })
  }, [step])
  // ── Quick Add mode (Task ID: LICENSE-PAGE-PLUS-QUICK-ADD, Task B) ──
  // When true, the Add/Edit dialog renders a simplified single-section form
  // with only the essential fields (site, assetCode, name, type, brand, model,
  // serial, status). Persisted in localStorage so the user's preference
  // survives reloads. Switching to "Full" mode brings back the 5-step wizard.
  const QUICK_ADD_LS_KEY = 'itam:device-form:quick-add'
  const [quickAdd, setQuickAdd] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem(QUICK_ADD_LS_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleQuickAdd = React.useCallback(() => {
    setQuickAdd((prev) => {
      const next = !prev
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(QUICK_ADD_LS_KEY, next ? '1' : '0')
        }
      } catch {
        // localStorage may be unavailable (private mode) — ignore.
      }
      return next
    })
  }, [])
  const [deleteTarget, setDeleteTarget] = React.useState<Device | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [detailDeviceId, setDetailDeviceId] = React.useState<string | null>(
    null,
  )
  const [exporting, setExporting] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [stickerOpen, setStickerOpen] = React.useState(false)
  // When set, StickerPrintDialog shows only this device (from row "t('devices.field.sticker')" button).
  // When null, shows all devices (from toolbar "t('devices.action.print_many')" button).
  const [singlePrintDeviceId, setSinglePrintDeviceId] = React.useState<string | null>(null)
  const [printTemplateOpen, setPrintTemplateOpen] = React.useState(false)
  // STICKER-PREVIEW-FIX-FINAL: per-row Printer-icon button calls
  // `printSingleSticker(device)` directly (no dialog). Track which device
  // is currently being rendered so we can show a spinner on its button.
  const [printingSingleId, setPrintingSingleId] = React.useState<string | null>(null)

  // Bulk operations state
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [bulkStatus, setBulkStatus] = React.useState<string>('')
  const [bulkSite, setBulkSite] = React.useState<string>('')
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false)
  const [bulkAction, setBulkAction] = React.useState(false)

  // Pagination state (client-side slicing of the filtered `devices` array)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(50)
  const [pageInput, setPageInput] = React.useState('1')

  // ── New: recently-viewed devices (persisted in localStorage) ──
  // Stores the last 5 device IDs the user opened in the detail sheet.
  const [recentDeviceIds, setRecentDeviceIds] = React.useState<string[]>([])
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('itam-recent-devices')
      if (raw) setRecentDeviceIds(JSON.parse(raw))
    } catch (e) { console.error(String(e)) }
  }, [])
  const pushRecentDevice = React.useCallback((id: string) => {
    setRecentDeviceIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 5)
      try {
        localStorage.setItem('itam-recent-devices', JSON.stringify(next))
      } catch (e) { console.error(String(e)) }
      return next
    })
  }, [])

  // ── New: keyboard shortcuts help dialog ──
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false)

  // ── New: column visibility (persisted) ──
  // Default columns mirror what the table currently renders. Hidden columns
  // are removed from the header + body. Users can toggle via the Columns button.
  type ColumnKey =
    | 'assetCode'
    | 'assetSiteCode'
    | 'reports.unit.type'
    | 'brandModel'
    | 'serialNumber'
    | 'location'
    | 'department'
    | 'status'
    | 'meter'
    | 'updatedAt'
    | 'actions'
  const ALL_COLUMNS: { key: ColumnKey; labelKey: string }[] = [
    { key: 'assetCode', labelKey: 'devices.col.asset_code' },
    { key: 'assetSiteCode', labelKey: 'devices.col.asset_site_code' },
    { key: 'reports.unit.type', labelKey: 'devices.col.type' },
    { key: 'brandModel', labelKey: 'devices.col.brand_model' },
    { key: 'serialNumber', labelKey: 'devices.col.serial' },
    { key: 'location', labelKey: 'devices.col.location' },
    { key: 'department', labelKey: 'devices.col.department' },
    { key: 'status', labelKey: 'devices.col.status' },
    { key: 'meter', labelKey: 'devices.col.meter' },
    { key: 'updatedAt', labelKey: 'devices.col.updated_at' },
    { key: 'actions', labelKey: 'devices.col.actions' },
  ]
  const [hiddenColumns, setHiddenColumns] = React.useState<Set<ColumnKey>>(
    () => {
      try {
        const raw = localStorage.getItem('itam-devices-hidden-cols')
        if (raw) return new Set(JSON.parse(raw))
      } catch (e) { console.error(String(e)) }
      return new Set()
    },
  )
  const toggleColumn = React.useCallback((key: ColumnKey) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try {
        localStorage.setItem(
          'itam-devices-hidden-cols',
          JSON.stringify([...next]),
        )
      } catch (e) { console.error(String(e)) }
      return next
    })
  }, [])
  const isColVisible = (key: ColumnKey) => !hiddenColumns.has(key)

  // ── New: global keyboard shortcuts ──
  // Ctrl/Cmd+K → focus search; Ctrl/Cmd+N → new device; Ctrl/Cmd+R → refresh; ? → shortcuts help
  const searchInputId = 'itam-devices-search'
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Skip when typing in inputs (except for Escape)
      const target = e.target as HTMLElement
      const isTyping =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      if (isTyping && e.key !== 'Escape') return

      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const el = document.getElementById(searchInputId) as HTMLInputElement | null
        el?.focus()
        el?.select()
      } else if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        openAddRef.current?.()
      } else if (mod && e.key.toLowerCase() === 'r') {
        e.preventDefault()
        qc.invalidateQueries({ queryKey: ['devices'] })
      } else if (e.key === '?' && !mod) {
        e.preventDefault()
        setShortcutsOpen(true)
      } else if (e.key === 'Escape') {
        if (shortcutsOpen) setShortcutsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shortcutsOpen, qc])

  // ── New: derived KPI counts from the filtered `devices` list ──
  // (Moved below `devices` declaration so the closure captures it correctly.)

  // Read pendingDeviceId / pendingWarrantyFilter from store on mount
  const pendingDeviceId = useAppStore((s) => s.pendingDeviceId)
  const clearPendingDeviceId = useAppStore((s) => s.clearPendingDeviceId)
  const pendingWarrantyFilter = useAppStore((s) => s.pendingWarrantyFilter)
  const clearPendingWarrantyFilter = useAppStore(
    (s) => s.clearPendingWarrantyFilter,
  )

  React.useEffect(() => {
    if (pendingDeviceId) {
      setDetailDeviceId(pendingDeviceId)
      clearPendingDeviceId()
    }
  }, [pendingDeviceId, clearPendingDeviceId])

  React.useEffect(() => {
    if (pendingWarrantyFilter) {
      setWarrantyFilter(pendingWarrantyFilter)
      clearPendingWarrantyFilter()
    }
  }, [pendingWarrantyFilter, clearPendingWarrantyFilter])

  // Settings query for org name (used in sticker header)
  const { data: settings } = useQuery<Record<string, string>>({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings', { headers: authHeaders() })
      if (!res.ok) return {}
      const json = await res.json()
      return (json.settings ?? {}) as Record<string, string>
    },
  })

  const { data: devicesRaw, isLoading } = useQuery<Device[]>({
    // NOTE: stable 'devices' prefix (not t('devices.unit.device')) so every
    // invalidateQueries({ queryKey: ['devices'] }) hits this query even when
    // the UI language changes (TH 'เครื่อง' vs EN 'devices').
    queryKey: ['devices', search, statusFilter, siteFilter, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (siteFilter !== 'all') params.set('site', siteFilter)
      // Use the user-selected page size (20/50/100) for the API request.
      // Previously hardcoded to 500 which caused the page size selector to
      // appear broken (UI showed 50 but API always fetched 500).
      params.set('limit', String(pageSize))
      params.set('page', '1')
      const res = await fetch(`/api/devices?${params.toString()}`, {
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error('Failed to load devices')
      const json = await res.json()
      return json.devices as Device[]
    },
    staleTime: 5 * 60 * 1000, // 5 min — reduce refetch frequency
  })

  // Apply warranty filter client-side (computed from purchaseDate + warrantyMonths)
  const devices = React.useMemo<Device[] | undefined>(() => {
    if (!devicesRaw) return undefined
    let list = devicesRaw
    if (warrantyFilter !== 'all') {
      list = list.filter((d) => {
        const w = computeWarranty(d.purchaseDate, d.warrantyMonths ?? 12)
        return w.status === warrantyFilter
      })
    }
    if (assigneeFilter === 'assigned') {
      list = list.filter((d) => Boolean(d.currentAssignee))
    } else if (assigneeFilter === 'unassigned') {
      list = list.filter((d) => !d.currentAssignee)
    }
    return list
  }, [devicesRaw, warrantyFilter, assigneeFilter])

  // ── New: derived KPI counts from the filtered `devices` list ──
  // Clicking a KPI card in the UI applies the corresponding filter.
  // Status matching is case-insensitive — DB stores mixed-case values
  // (Active, In Repair, Retired, Inactive, Disposed, Returned) but the
  // legacy short forms (active, spare, repair, disposed) also appear in
  // old imports. We normalise by lowercasing + checking against a set of
  // known aliases per KPI bucket.
  const kpi = React.useMemo(() => {
    const list = devices ?? []
    const norm = (s: string | null | undefined): string =>
      (s ?? '').trim().toLowerCase()
    const active = list.filter((d) => {
      const s = norm(d.status)
      return s === 'active' || s === 'in use'
    }).length
    const repair = list.filter((d) => {
      const s = norm(d.status)
      return s === 'in repair' || s === 'repair' || s === 'pending repair'
    }).length
    const inactive = list.filter((d) => {
      const s = norm(d.status)
      return (
        s === 'inactive'
        || s === 'retired'
        || s === 'disposed'
        || s === 'returned'
      )
    }).length
    const spare = list.filter((d) => {
      const s = norm(d.status)
      return s === 'spare' || s === 'in stock'
    }).length
    const warrantyExpiringSoon = list.filter((d) => {
      const w = computeWarranty(d.purchaseDate, d.warrantyMonths ?? 12)
      return w.status === 'expiring'
    }).length
    const warrantyExpired = list.filter((d) => {
      const w = computeWarranty(d.purchaseDate, d.warrantyMonths ?? 12)
      return w.status === 'expired'
    }).length
    return {
      total: list.length,
      active,
      repair,
      inactive,
      spare,
      warrantyExpiringSoon,
      warrantyExpired,
    }
  }, [devices])

  // ── Pagination: client-side slicing of the filtered `devices` array ──
  // When search/filter changes, reset to page 1.
  const totalCount = devices?.length ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const currentPage = Math.min(page, totalPages)
  const startIdx = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const endIdx = Math.min(currentPage * pageSize, totalCount)
  const pagedDevices = React.useMemo<Device[]>(() => {
    if (!devices) return []
    const start = (currentPage - 1) * pageSize
    return devices.slice(start, start + pageSize)
  }, [devices, currentPage, pageSize])

  // Reset to page 1 whenever the underlying filter inputs change
  React.useEffect(() => {
    setPage(1)
    setPageInput('1')
  }, [search, statusFilter, siteFilter, warrantyFilter, assigneeFilter, pageSize])

  // Keep pageInput in sync when currentPage changes externally
  React.useEffect(() => {
    setPageInput(String(currentPage))
  }, [currentPage])

  const { data: sites } = useQuery<Site[]>({
    queryKey: [t('dash.unit.site')],
    queryFn: async () => {
      const res = await fetch('/api/sites', { headers: authHeaders() })
      if (!res.ok) return []
      const json = await res.json()
      return json.sites as Site[]
    },
  })

  // ── Filter the site dropdown by the current user's allowedSites ──
  // (Non-admin users should only see their own sites in the form.)
  const authUser = useAuthStore((s) => s.user)
  const showSiteFilter = authUser ? canSelectSite(authUser) : false
  const userAllowedSites = authUser?.allowedSites ?? 'ALL'
  const userSitesArr = React.useMemo<string[] | null>(() => {
    if (!userAllowedSites || userAllowedSites.toUpperCase() === 'ALL') return null
    return userAllowedSites
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }, [userAllowedSites])
  const visibleSites = React.useMemo<Site[]>(() => {
    if (!sites) return []
    if (!userSitesArr) return sites
    return sites.filter((s) => userSitesArr.includes(s.code))
  }, [sites, userSitesArr])

  // ── Cascading master data (DeviceType → Brand → Model) ──
  // Uses the new /api/master?type=... endpoints backed by normalized tables.
  const { data: deviceTypes } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['master', 'device-types'],
    queryFn: async () => {
      const res = await fetch('/api/master?type=device-types', { headers: authHeaders() })
      if (!res.ok) return []
      const json = await res.json()
      return (json.items ?? []) as { id: string; name: string }[]
    },
    staleTime: 5 * 60 * 1000,
  })

  // Brands are filtered by the selected DeviceType (cascading).
  const { data: brandsData } = useQuery<{ id: string; name: string; typeId: string }[]>({
    queryKey: ['master', 'brands', form.type],
    queryFn: async () => {
      if (!form.type) return []
      // Find the DeviceType id from the deviceTypes list
      const typeId = deviceTypes?.find((dt) => dt.name === form.type)?.id
      if (!typeId) return []
      const res = await fetch(`/api/master?type=brands&typeId=${typeId}`, { headers: authHeaders() })
      if (!res.ok) return []
      const json = await res.json()
      return (json.items ?? []) as { id: string; name: string; typeId: string }[]
    },
    enabled: !!form.type && !!deviceTypes,
    staleTime: 5 * 60 * 1000,
  })

  // Models are filtered by the selected Brand (cascading).
  const { data: modelsData } = useQuery<{ id: string; name: string; brandId: string }[]>({
    queryKey: ['master', 'models', form.brand],
    queryFn: async () => {
      if (!form.brand) return []
      // Find the Brand id from the brandsData list
      const brandId = brandsData?.find((b) => b.name === form.brand)?.id
      if (!brandId) return []
      const res = await fetch(`/api/master?type=models&brandId=${brandId}`, { headers: authHeaders() })
      if (!res.ok) return []
      const json = await res.json()
      return (json.items ?? []) as { id: string; name: string; brandId: string }[]
    },
    enabled: !!form.brand && !!brandsData,
    staleTime: 5 * 60 * 1000,
  })

  // ── Legacy MasterItem lookups (Department, DeviceGroup, Affiliation) ──
  // These remain as flat MasterItem rows (not normalized into separate tables).
  const { data: masterItems } = useQuery<{
    category: string
    code: string
    label: string
    parentRef?: string | null
    deviceType?: string | null
    brand?: string | null
    model?: string | null
  }[]>({
    queryKey: ['master-all'],
    queryFn: async () => {
      const res = await fetch('/api/master', { headers: authHeaders() })
      if (!res.ok) return []
      const json = await res.json()
      return (json.items ?? []) as {
        category: string
        code: string
        label: string
        parentRef?: string | null
        deviceType?: string | null
        brand?: string | null
        model?: string | null
      }[]
    },
  })

  const departments = (masterItems ?? []).filter(
    (m) => m.category === t('common.department'),
  )
  const deviceGroups = (masterItems ?? []).filter(
    (m) => m.category === 'DeviceGroup',
  )
  // Affiliation rows — parent of Department. Used for the Affiliation dropdown.
  const affiliations = (masterItems ?? []).filter(
    (m) => m.category === 'Affiliation',
  )
  // Departments filtered by the selected Affiliation (parentRef stores the
  // Affiliation LABEL — not the code — so we match against label).
  const filteredDepartments = form.parentRef
    ? departments.filter((d) => d.parentRef === form.parentRef)
    : departments

  // ── DeviceClassification rows (Type/Brand/Model lookup) ──
  // Used for the reverse cascade: when the user picks a Model, we can
  // auto-fill Brand + Type from the matching DeviceClassification row.
  // Also used to filter brands by type and models by brand.
  const deviceClassifications = (masterItems ?? []).filter(
    (m) => m.category === 'DeviceClassification',
  )

  // ── Cascading dropdowns: site → building → floor → location ──
  // Uses /api/master?type=buildings|floors for buildings/floors (backed by
  // MasterItem with siteCode matching — works correctly with site CODES
  // like "UDH"). Location still uses the device-history-based cascading API
  // because locations aren't master data.
  const { data: buildingOptions } = useQuery<string[]>({
    queryKey: ['master', 'buildings', form.site],
    queryFn: async () => {
      try {
        const url = `/api/master?type=buildings${form.site ? `&site=${encodeURIComponent(form.site)}` : ''}`
        const res = await fetch(url, { headers: authHeaders() })
        if (!res.ok) return []
        const j = (await res.json()) as { items?: string[] }
        return j.items ?? []
      } catch {
        return []
      }
    },
    enabled: dialogOpen && Boolean(form.site),
  })
  const { data: floorOptions } = useQuery<string[]>({
    queryKey: ['master', 'floors'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/master?type=floors', { headers: authHeaders() })
        if (!res.ok) return []
        const j = (await res.json()) as { items?: string[] }
        return j.items ?? []
      } catch {
        return []
      }
    },
    enabled: dialogOpen,
  })
  // ── GLOBAL locations (distinct across all devices) ──
  // Used as the full list for the Location dropdown — so the user sees
  // every location that has ever been entered in the system, as a guide.
  // The ones matching the current floor are HIGHLIGHTED in green.
  const { data: globalLocations } = useQuery<string[]>({
    queryKey: ['global-locations'],
    queryFn: async () => {
      try {
        const j = await authFetch<{ values: string[] }>(
          '/api/itam/devices/cascading?field=location',
        )
        return j.values ?? []
      } catch {
        return []
      }
    },
    enabled: dialogOpen,
  })

  // ── Location Summary: which floors + departments + locations have devices at this building ──
  // Used to HIGHLIGHT (green) the floors/departments that actually exist at
  // the selected site+building — so the user knows "this floor has 5 departments"
  // without blocking them from picking others.
  const { data: locationSummary } = useQuery<{
    floors: string[]
    departments: string[]
    locations: string[]
    floorCounts: Record<string, number>
    departmentCounts: Record<string, number>
    locationCounts: Record<string, number>
  }>({
    queryKey: ['location-summary', form.site, form.building],
    queryFn: async () => {
      if (!form.site || !form.building) return { floors: [], departments: [], locations: [], floorCounts: {}, departmentCounts: {}, locationCounts: {} }
      try {
        const params = new URLSearchParams({
          site: form.site,
          building: form.building,
        })
        const j = await authFetch<{
          floors: string[]
          departments: string[]
          locations: string[]
          floorCounts: Record<string, number>
          departmentCounts: Record<string, number>
          locationCounts: Record<string, number>
        }>(`/api/itam/devices/location-summary?${params.toString()}`)
        return j
      } catch {
        return { floors: [], departments: [], locations: [], floorCounts: {}, departmentCounts: {}, locationCounts: {} }
      }
    },
    enabled: dialogOpen && Boolean(form.site) && Boolean(form.building),
  })

  // Derived highlight sets + badges
  const highlightedFloors = locationSummary?.floors ?? []
  const highlightedDepartments = locationSummary?.departments ?? []
  const highlightedLocations = locationSummary?.locations ?? []
  const floorBadges = React.useMemo(() => {
    const m: Record<string, string> = {}
    for (const [floor, count] of Object.entries(locationSummary?.floorCounts ?? {})) {
      m[floor] = t('devices.unit.count_suffix') ? `${count} ${t('devices.unit.count_suffix')}` : `${count}`
    }
    return m
  }, [locationSummary, t])
  const departmentBadges = React.useMemo(() => {
    const m: Record<string, string> = {}
    for (const [dept, count] of Object.entries(locationSummary?.departmentCounts ?? {})) {
      m[dept] = t('devices.unit.count_suffix') ? `${count} ${t('devices.unit.count_suffix')}` : `${count}`
    }
    return m
  }, [locationSummary, t])
  const locationBadges = React.useMemo(() => {
    const m: Record<string, string> = {}
    for (const [loc, count] of Object.entries(locationSummary?.locationCounts ?? {})) {
      m[loc] = t('devices.unit.count_suffix') ? `${count} ${t('devices.unit.count_suffix')}` : `${count}`
    }
    return m
  }, [locationSummary, t])

  // ── Auto-derive meterRequired from Type ──
  // Printers, copiers, and multi-function devices need meter tracking.
  // Scanners, barcode scanners, and other devices do not.
  // This runs whenever form.type changes — the user doesn't need to
  // manually check a "meter required" checkbox.
  const METER_REQUIRED_TYPES = ['PRINTER', 'COPIER', 'MFD', 'MULTIFUNCTION']
  React.useEffect(() => {
    if (!form.type) return
    const isMeterRequired = METER_REQUIRED_TYPES.some((mt) =>
      form.type.toUpperCase().includes(mt),
    )
    setForm((prev) =>
      prev.meterRequired === isMeterRequired
        ? prev
        : { ...prev, meterRequired: isMeterRequired },
    )
  }, [form.type])

  // ── Auto-generate device name from brand + model + location ──
  // Watches brand, model, building, floor, location — auto-fills `name`
  // unless the user has manually typed something.
  // Example: "BROTHER HL-L5210DN ตึกผู้ป่วยนอก (OPD) ชั้น 2"
  const nameManuallyEditedRef = React.useRef(false)
  React.useEffect(() => {
    // Don't auto-fill if user has manually edited the name
    if (nameManuallyEditedRef.current) return
    const parts = [
      form.brand,
      form.model,
      form.building,
      form.floor ? `${t('devices.field.floor')} ${form.floor}` : '',
      form.location,
    ].filter(Boolean)
    const autoName = parts.join(' ')
    setForm((prev) =>
      prev.name === autoName ? prev : { ...prev, name: autoName },
    )
  }, [form.brand, form.model, form.building, form.floor, form.location])

  // ── New device dialog opener ──
  // Uses a ref so the keyboard shortcut effect (declared earlier) can invoke
  // it without "Cannot access variable before declared" (temporal dead zone).
  const openAddRef = React.useRef<(() => void) | null>(null)
  React.useEffect(() => {
    openAddRef.current = () => {
      setForm({ ...EMPTY_FORM })
      nameManuallyEditedRef.current = false
      assetCodeManuallyEditedRef.current = false
      setStep(0)
      setMaxVisited(0)
      setDialogOpen(true)
      // Auto-generate the next assetCode from the active NumberingScheme
      // (e.g. 001-201-2569-00001) or the legacy integer sequence.
      // Best-effort — if the API call fails, the user can still type a code.
      void fetchNextAssetCode()
    }
  })
  function openAdd() {
    openAddRef.current?.()
  }

  // ── Re-generate assetCode when the numbering context changes ──
  // While CREATING a device, picking a type/site/purchase-date changes the
  // category codes + year that feed the Flexible Numbering Engine. We
  // silently refresh the generated code unless the user typed one manually.
  const assetCodeManuallyEditedRef = React.useRef(false)
  React.useEffect(() => {
    if (!dialogOpen || form.id) return
    if (assetCodeManuallyEditedRef.current) return
    const t = setTimeout(() => {
      void fetchNextAssetCode({ force: true })
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, form.type, form.site, form.purchaseDate])

  // ── Auto-generate assetCode (Numbering Engine / legacy) ──
  // Calls /api/devices/next-asset-code and fills the field on Add New.
  // With an active NumberingScheme the code is built from the FORM context
  // (type → category codes, purchase year, site) e.g. 001-201-2569-00001.
  // Only auto-fills when the field is empty (CREATE only) — the Sparkles
  // button explicitly re-runs it with the current context.
  const generatingAssetCodeRef = React.useRef(false)
  const fetchNextAssetCode = React.useCallback(
    async (opts?: { force?: boolean }) => {
      if (generatingAssetCodeRef.current) return
      generatingAssetCodeRef.current = true
      try {
        const params = new URLSearchParams()
        if (form.type) params.set('type', form.type)
        if (form.site) params.set('site', form.site)
        if (form.departmentCode) params.set('departmentCode', form.departmentCode)
        if (form.purchaseDate) params.set('purchaseDate', form.purchaseDate)
        const qs = params.toString()
        const res = await fetch(
          `/api/devices/next-asset-code${qs ? `?${qs}` : ''}`,
          { headers: authHeaders() },
        )
        if (!res.ok) return
        const j = (await res.json()) as { code?: string | null }
        if (j.code) {
          if (opts?.force) {
            // Respect a manual edit that landed WHILE this request was in
            // flight. The debounce guard above checks assetCodeManuallyEditedRef
            // at timer-FIRE time, but this setForm resolves after an async
            // network round-trip — re-check here so a user who typed their own
            // code after picking a site/type doesn't get it silently
            // overwritten when the slow numbering API finally responds. The
            // Sparkles button resets the ref to false before calling, so
            // explicit "regenerate" still overwrites.
            if (!assetCodeManuallyEditedRef.current) {
              setForm((prev) => ({ ...prev, assetCode: j.code ?? '' }))
            }
          } else {
            setForm((prev) =>
              prev.assetCode ? prev : { ...prev, assetCode: j.code ?? '' },
            )
          }
        }
      } catch (err) { console.error('[devices-page]', err) } finally {
        generatingAssetCodeRef.current = false
      }
    },
    [form.type, form.site, form.departmentCode, form.purchaseDate],
  )

  async function openEdit(d: Device) {
    // The list query intentionally omits detail-only fields. Load the full
    // record before populating the edit form so an unchanged save cannot
    // erase serial, network, or commercial data.
    let editDevice = d
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(d.id)}`, {
        headers: authHeaders(),
      })
      if (res.ok) {
        const json = (await res.json()) as { device?: Device }
        if (json.device) editDevice = json.device
      }
    } catch (err) {
      console.warn('[devices-page] detail load before edit failed', err)
    }
    nameManuallyEditedRef.current = true
    setForm({
      id: editDevice.id,
      assetCode: editDevice.assetCode,
      assetSiteCode: editDevice.assetSiteCode ?? '',
      name: editDevice.name,
      brand: editDevice.brand,
      model: editDevice.model,
      type: editDevice.type,
      serialNumber: editDevice.serialNumber ?? '',
      status: editDevice.status,
      site: editDevice.site,
      department: editDevice.department ?? '',
      departmentCode: editDevice.departmentCode ?? '',
      parentRef: editDevice.parentRef ?? '',
      displayLabel: editDevice.displayLabel ?? '',
      location: editDevice.location ?? '',
      building: editDevice.building ?? '',
      floor: editDevice.floor ?? '',
      room: editDevice.room ?? '',
      ip: editDevice.ip ?? '',
      mac: editDevice.mac ?? '',
      remoteId: editDevice.remoteId ?? '',
      purchaseDate: editDevice.purchaseDate ?? '',
      warrantyMonths: String(editDevice.warrantyMonths ?? 12),
      purchasePrice:
        editDevice.purchasePrice !== null && editDevice.purchasePrice !== undefined
          ? String(editDevice.purchasePrice)
          : '',
      salvageValue:
        editDevice.salvageValue !== null && editDevice.salvageValue !== undefined
          ? String(editDevice.salvageValue)
          : '0',
      usefulLife:
        editDevice.usefulLife !== null && editDevice.usefulLife !== undefined
          ? String(editDevice.usefulLife)
          : '60',
      warrantyEnd: editDevice.warrantyEnd ?? '',
      vendor: editDevice.vendor ?? '',
      contractNo: editDevice.contractNo ?? '',
      uninstallDate: editDevice.uninstallDate ?? '',
      meterRequired: Boolean(editDevice.meterRequired),
      meterMode: editDevice.meterMode ?? 'TOTAL',
      costCenter: editDevice.costCenter ?? '',
      deviceGroup: editDevice.deviceGroup ?? '',
      remark: editDevice.remark ?? '',
      // ── Device Set fields (Task ID 9, Phase 2) ──
      // Cast through unknown because the legacy `Device` type doesn't
      // include parentDeviceId/setLabel/setPosition yet (only the DB row does).
      parentDeviceId: (editDevice as unknown as { parentDeviceId?: string | null }).parentDeviceId ?? '',
      setLabel: (editDevice as unknown as { setLabel?: string | null }).setLabel ?? '',
      setPosition: (editDevice as unknown as { setPosition?: number | null }).setPosition != null
        ? String((editDevice as unknown as { setPosition?: number | null }).setPosition)
        : '',
      licenses: [],
      accessories: [],
    })
    setStep(0)
    setMaxVisited(0)
    setDialogOpen(true)
    // Load existing licenses for this device (edit mode only)
    void loadDeviceLicenses(editDevice.id)
    // Load existing accessories for this device (edit mode only)
    void loadDeviceAccessories(editDevice.id)
  }

  // SPRINT-3 #1 (UX Simplification Map — Device Form):
  // Clone Device — opens the Add form pre-filled with the source device's
  // fields EXCEPT assetCode, assetSiteCode, serialNumber (which must be
  // unique per device). The new assetCode is auto-generated by
  // fetchNextAssetCode() so the user can save immediately.
  function cloneDevice(d: Device) {
    nameManuallyEditedRef.current = true
    setForm({
      ...EMPTY_FORM,
      // Copy all descriptive fields from the source device
      name: d.name,
      brand: d.brand,
      model: d.model,
      type: d.type,
      status: d.status,
      site: d.site,
      department: d.department ?? '',
      departmentCode: d.departmentCode ?? '',
      parentRef: d.parentRef ?? '',
      displayLabel: d.displayLabel ?? '',
      location: d.location ?? '',
      building: d.building ?? '',
      floor: d.floor ?? '',
      room: d.room ?? '',
      ip: d.ip ?? '',
      mac: d.mac ?? '',
      remoteId: d.remoteId ?? '',
      purchaseDate: d.purchaseDate ?? '',
      warrantyMonths: String(d.warrantyMonths ?? 12),
      purchasePrice:
        d.purchasePrice !== null && d.purchasePrice !== undefined
          ? String(d.purchasePrice)
          : '',
      salvageValue:
        d.salvageValue !== null && d.salvageValue !== undefined
          ? String(d.salvageValue)
          : '0',
      usefulLife: String(d.usefulLife ?? 60),
      warrantyEnd: d.warrantyEnd ?? '',
      vendor: d.vendor ?? '',
      contractNo: d.contractNo ?? '',
      meterRequired: d.meterRequired ?? false,
      meterMode: (d as { meterMode?: string }).meterMode ?? 'TOTAL',
      costCenter: d.costCenter ?? '',
      deviceGroup: (d as { deviceGroup?: string }).deviceGroup ?? DEFAULT_DEVICE_GROUP,
      remark: (d as { remark?: string }).remark ?? '',
      // DO NOT copy these — they must be unique per device:
      // assetCode, assetSiteCode, serialNumber — left as EMPTY_FORM defaults
      // (assetCode will be auto-filled by fetchNextAssetCode below)
    })
    setStep(0)
    setMaxVisited(0)
    setDialogOpen(true)
    // Auto-generate a new assetCode (clone keeps the type/site so the
    // next-asset-code API can suggest the right sequence)
    void fetchNextAssetCode()
    toast.info('โคลนอุปกรณ์ — กรุณาตรวจสอบรหัสอุปกรณ์ใหม่ก่อนบันทึก')
  }

  // ── Load accessories for an existing device (edit mode) ──
  // Mirrors loadDeviceLicenses() — fetches the device's existing accessories
  // and populates form.accessories so the user can edit/remove them inline.
  // For new devices, accessories are kept in local state and POSTed after
  // the device is created (see save()).
  const [accessoriesLoading, setAccessoriesLoading] = React.useState(false)
  async function loadDeviceAccessories(deviceId: string) {
    setAccessoriesLoading(true)
    try {
      const res = await fetch(`/api/devices/${deviceId}/accessories`, {
        headers: authHeaders(),
      })
      if (!res.ok) return
      const j = (await res.json()) as {
        accessories?: Array<{
          id: string
          accessoryType: string
          brand: string | null
          model: string | null
          serialNumber: string | null
          status: string
          installedDate: string | null
          remark: string | null
        }>
      }
      const mapped: PendingAccessory[] = (j.accessories ?? []).map((a) => ({
        id: a.id,
        accessoryType: a.accessoryType ?? 'OTHER',
        brand: a.brand ?? '',
        model: a.model ?? '',
        serialNumber: a.serialNumber ?? '',
        status: a.status ?? t('status.active'),
        installedDate: a.installedDate ?? '',
        remark: a.remark ?? '',
      }))
      setForm((prev) => ({ ...prev, accessories: mapped }))
    } catch (err) { console.error('[devices-page]', err) } finally {
      setAccessoriesLoading(false)
    }
  }

  // ── Load licenses for an existing device (edit mode) ──
  // For new devices, licenses are kept in local state and POSTed after
  // the device is created (see save()).
  const [licensesLoading, setLicensesLoading] = React.useState(false)
  async function loadDeviceLicenses(deviceId: string) {
    setLicensesLoading(true)
    try {
      const res = await fetch(`/api/devices/${deviceId}/licenses`, {
        headers: authHeaders(),
      })
      if (!res.ok) return
      const j = (await res.json()) as {
        licenses?: Array<{
          id: string
          License_ID: string | null
          Software: string
          LicenseType: string | null
          License_Key: string | null
          Quantity: number
          Expiry_Date: string | null
          Remark: string | null
        }>
      }
      const mapped: LicenseRow[] = (j.licenses ?? []).map((l) => ({
        id: l.id,
        licenseId: l.License_ID ?? '',
        software: l.Software ?? '',
        licenseType: l.LicenseType ?? '',
        licenseKey: l.License_Key ?? '',
        quantity: l.Quantity ?? 1,
        expiryDate: l.Expiry_Date ?? '',
        remark: l.Remark ?? '',
      }))
      setForm((prev) => ({ ...prev, licenses: mapped }))
    } catch (err) { console.error('[devices-page]', err) } finally {
      setLicensesLoading(false)
    }
  }

  // ── License helpers (local state CRUD) ──
  function addLicense() {
    setForm((prev) => ({
      ...prev,
      licenses: [...prev.licenses, { ...EMPTY_LICENSE }],
    }))
  }
  function updateLicense(idx: number, patch: Partial<LicenseRow>) {
    setForm((prev) => ({
      ...prev,
      licenses: prev.licenses.map((l, i) =>
        i === idx ? { ...l, ...patch } : l,
      ),
    }))
  }
  function removeLicense(idx: number) {
    setForm((prev) => ({
      ...prev,
      licenses: prev.licenses.filter((_, i) => i !== idx),
    }))
  }

  // ── Accessory helpers (local state CRUD — mirrors the license helpers) ──
  // On new devices: stored in local state until save() POSTs them.
  // On edit devices: existing rows (with .id) are PATCH-updated, new rows
  // (no .id) are POST-created, and removed rows are DELETE-called.
  function addAccessory() {
    setForm((prev) => ({
      ...prev,
      accessories: [...prev.accessories, { ...EMPTY_ACCESSORY }],
    }))
  }
  function updateAccessory(idx: number, patch: Partial<PendingAccessory>) {
    setForm((prev) => ({
      ...prev,
      accessories: prev.accessories.map((a, i) =>
        i === idx ? { ...a, ...patch } : a,
      ),
    }))
  }
  function removeAccessory(idx: number) {
    setForm((prev) => ({
      ...prev,
      accessories: prev.accessories.filter((_, i) => i !== idx),
    }))
  }

  // ── Auto-generate assetSiteCode when the user picks a site ──
  // Calls /api/devices/next-site-code?site=<code> and fills the field.
  // Only auto-fills on CREATE (when the field is empty) — on edit, the
  // user has to click the "✨ t('devices.field.generate_code')" button explicitly to avoid
  // overwriting an existing code.
  const generatingCodeRef = React.useRef(false)
  const fetchNextSiteCode = React.useCallback(async (siteCode: string) => {
    if (!siteCode || generatingCodeRef.current) return
    generatingCodeRef.current = true
    try {
      const res = await fetch(
        `/api/devices/next-site-code?site=${encodeURIComponent(siteCode)}`,
        { headers: authHeaders() },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        if (j.error) toast.warning(j.error)
        return
      }
      const j = (await res.json()) as { code?: string | null }
      if (j.code) {
        setForm((prev) => ({ ...prev, assetSiteCode: j.code ?? '' }))
      }
    } catch (err) { console.error('[devices-page]', err) } finally {
      generatingCodeRef.current = false
    }
  }, [])

  async function generateSiteCodeNow() {
    if (!form.site) {
      toast.warning(t('devices.toast.select_site_first'))
      return
    }
    await fetchNextSiteCode(form.site)
    toast.success(t('devices.toast.site_code_created'))
  }

  // ── Wizard navigation (Full mode) ──
  // Required fields per step — mirrors save() global check, split by the
  // step that actually CONTAINS each field (all six live in step 1 today).
  function stepMissingFields(stepIndex: number): string[] {
    const def = WIZARD_STEPS[stepIndex]
    if (!def) return []
    return def.requiredFields.filter(
      (f) => !String(form[f as keyof FormState] ?? '').trim(),
    )
  }

  // A step chip is clickable when going backward (always), or when it has
  // already been visited AND every step before it still passes its check.
  function canJumpTo(target: number): boolean {
    if (target <= step) return true
    if (target > maxVisited) return false
    for (let j = 0; j < target; j++) {
      if (stepMissingFields(j).length > 0) return false
    }
    return true
  }

  function goNext() {
    const missing = stepMissingFields(step)
    if (missing.length > 0) {
      toast.error(
        t('devices.wizard.missing').replace(
          '{fields}',
          missing.map((f) => t(WIZARD_FIELD_LABEL_KEYS[f] ?? f)).join(', '),
        ),
      )
      return
    }
    if (step < WIZARD_STEPS.length - 1) {
      const next = step + 1
      setStep(next)
      setMaxVisited((m) => Math.max(m, next))
    }
  }

  function goBack() {
    if (step > 0) setStep(step - 1)
  }

  async function save() {
    if (!form.assetCode || !form.name || !form.brand || !form.model || !form.type || !form.site) {
      // Wizard: jump back to the first step that holds a missing required
      // field so the user immediately sees what to fix. Harmless in Quick
      // mode — the step only matters when the Full form is displayed.
      const requiredKeys = ['assetCode', 'name', 'brand', 'model', 'type', 'site']
      const missingKeys = requiredKeys.filter((k) => !form[k as keyof FormState])
      const firstStep = WIZARD_STEPS.findIndex((s) =>
        s.requiredFields.some((f) => missingKeys.includes(f)),
      )
      if (firstStep >= 0) {
        setStep(firstStep)
        setMaxVisited((m) => Math.max(m, firstStep))
      }
      toast.error(t('devices.toast.required_missing'))
      return
    }
    try {
      setSaving(true)
      // Omit licenses + accessories from the device payload — they're saved
      // separately via /api/devices/[id]/licenses + /api/devices/[id]/accessories
      // after the device is created/updated.
      const { licenses: _licenses, accessories: _accessories, ...deviceFields } = form
      void _licenses
      void _accessories
      const payload = {
        ...deviceFields,
        assetSiteCode: form.assetSiteCode || null,
        serialNumber: form.serialNumber || null,
        department: form.department || null,
        departmentCode: form.departmentCode || null,
        parentRef: form.parentRef || null,
        displayLabel: form.displayLabel || null,
        location: form.location || null,
        building: form.building || null,
        floor: form.floor || null,
        room: form.room || null,
        ip: form.ip || null,
        mac: form.mac || null,
        remoteId: form.remoteId || null,
        purchaseDate: form.purchaseDate || null,
        warrantyMonths: Number(form.warrantyMonths) || 12,
        purchasePrice:
          form.purchasePrice === '' ? null : Number(form.purchasePrice),
        salvageValue:
          form.salvageValue === '' ? 0 : Number(form.salvageValue),
        usefulLife:
          form.usefulLife === '' ? null : Number(form.usefulLife),
        warrantyEnd: form.warrantyEnd || null,
        vendor: form.vendor || null,
        contractNo: form.contractNo || null,
        uninstallDate: form.uninstallDate || null,
        meterRequired: Boolean(form.meterRequired),
        meterMode: form.meterMode || null,
        costCenter: form.costCenter || null,
        deviceGroup: form.deviceGroup || null,
        remark: form.remark || null,
        // ── Device Set fields (Task ID 9, Phase 2) ──
        parentDeviceId: form.parentDeviceId || null,
        setLabel: form.setLabel || null,
        setPosition: form.setPosition === '' ? null : Number(form.setPosition),
      }
      const isEdit = Boolean(form.id)
      const url = isEdit ? `/api/devices/${form.id}` : '/api/devices'
      const method = isEdit ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Save failed')
      }
      // After device is saved, sync licenses to the backend.
      // - New device: POST every license row
      // - Edit device: diff local vs server (we have the row IDs) — for
      //   simplicity, we POST new rows (no id) and PUT existing rows.
      let savedDeviceId = form.id
      if (!isEdit) {
        const j = (await res.json()) as { device?: { id: string } }
        savedDeviceId = j.device?.id
      }
      if (savedDeviceId && form.licenses.length > 0) {
        const licenseResults = await Promise.allSettled(
          form.licenses
            .filter((l) => l.software.trim() !== '')
            .map((l) => {
              const body = {
                software: l.software,
                licenseId: l.licenseId || undefined,
                licenseType: l.licenseType || undefined,
                licenseKey: l.licenseKey || undefined,
                quantity: l.quantity || 1,
                expiryDate: l.expiryDate || undefined,
                remark: l.remark || undefined,
              }
              if (l.id) {
                // Existing license — PUT update
                return fetch(
                  `/api/devices/${savedDeviceId}/licenses?licenseId=${l.id}`,
                  {
                    method: 'PUT',
                    headers: authHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify(body),
                  },
                )
              }
              // New license — POST create
              return fetch(`/api/devices/${savedDeviceId}/licenses`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(body),
              })
            }),
        )
        const failed = licenseResults.filter(
          (r) => r.status === 'rejected',
        ).length
        if (failed > 0) {
          toast.warning(
            t('devices.toast.license_partial_fail').replace('{count}', String(failed)),
          )
        }
      }
      // ── Sync accessories (Task ID: INLINE-ACCESSORY-IN-DEVICE-FORM) ──
      // After the device is created/updated, POST each new accessory row and
      // PATCH each existing one. Best-effort — failures don't fail the device
      // save (logged via toast.warning). Mirrors the license sync block above.
      if (savedDeviceId && form.accessories.length > 0) {
        const accessoryResults = await Promise.allSettled(
          form.accessories
            .filter((a) => a.accessoryType.trim() !== '')
            .map((a) => {
              const body = {
                accessoryType: a.accessoryType,
                brand: a.brand.trim() || null,
                model: a.model.trim() || null,
                serialNumber: a.serialNumber.trim() || null,
                status: a.status,
                installedDate: a.installedDate || null,
                remark: a.remark.trim() || null,
              }
              if (a.id) {
                // Existing accessory — PATCH update
                return fetch(
                  `/api/devices/${savedDeviceId}/accessories/${a.id}`,
                  {
                    method: 'PATCH',
                    headers: authHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify(body),
                  },
                )
              }
              // New accessory — POST create
              return fetch(`/api/devices/${savedDeviceId}/accessories`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(body),
              })
            }),
        )
        const accFailed = accessoryResults.filter(
          (r) => r.status === 'rejected',
        ).length
        if (accFailed > 0) {
          toast.warning(
            t('devices.toast.acc_partial_fail').replace('{count}', String(accFailed)),
          )
        }
      }
      toast.success(isEdit ? t('devices.toast.saved_edit') : t('devices.toast.saved_new'))
      setDialogOpen(false)
      await qc.invalidateQueries({ queryKey: ['devices'] })
      await qc.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      const res = await fetch(`/api/devices/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? t('devices.toast.delete_failed'))
      }
      toast.success(t('devices.toast.deleted'))
      setDeleteTarget(null)
      await qc.invalidateQueries({ queryKey: ['devices'] })
      await qc.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ลบอุปกรณ์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setDeleting(false)
    }
  }

  async function exportCsv() {
    try {
      setExporting(true)
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (siteFilter !== 'all') params.set('site', siteFilter)
      // For CSV export, request the maximum page size (500) and include auth
      params.set('limit', '500')
      const res = await fetch(`/api/devices?${params.toString()}`, {
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error('ไม่สามารถดึงข้อมูลเพื่อส่งออกได้')
      const json = await res.json()
      const rows = (json.devices ?? []) as Device[]
      // downloadCsv() reads keys off each row generically, so widen Device[] to
      // Record<string, unknown>[] at the boundary rather than changing the
      // shared helper's signature.
      downloadCsv(
        `devices-${dateStamp()}.csv`,
        rows as unknown as Record<string, unknown>[],
        DEVICE_CSV_HEADERS,
      )
      toast.success(t('devices.toast.exported_csv').replace('{count}', String(rows.length)))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ส่งออกข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setExporting(false)
    }
  }

  // ── STICKER-PREVIEW-FIX-FINAL: Single-device sticker print ─────────────
  //
  // Per-row "Printer" icon calls this directly — no dialog, no device-list
  // selection step. The sticker is rendered using the SAME template engine
  // (renderStickerFromTemplate + buildPrintDocument) the dialog uses, so
  // the printed output always matches what the live preview in the dialog
  // shows.
  //
  // Template resolution priority:
  //   1. Server-side active saved template (the one marked ⭐ in the editor)
  //   2. First saved template if no `activeId` is recorded
  //   3. buildDefaultTemplate() if the user has no saved templates at all
  //
  // Settings (companyName / orgName / hotline / footerNote / lineOALink)
  // are fetched from /api/itam/sticker/settings so the single-print output
  // matches what the dialog would produce. Falls back to the global org
  // name + DEFAULT_STICKER_SETTINGS when the API is unavailable.
  async function printSingleSticker(device: Device) {
    if (printingSingleId) return
    setPrintingSingleId(device.id)
    try {
      // 1) Fetch active saved template (server-side) + sticker settings.
      const [tplRes, settingsRes] = await Promise.all([
        fetch('/api/itam/sticker/templates', { headers: authHeaders() }),
        fetch('/api/itam/sticker/settings', { headers: authHeaders() }).catch(() => null),
      ])
      if (!tplRes.ok) throw new Error(t('devices.toast.load_tpl_failed'))
      const tplData = (await tplRes.json()) as {
        templates: StickerTemplate[]
        activeId: string | null
      }
      const active =
        (tplData.activeId &&
          tplData.templates.find((tpl) => tpl.id === tplData.activeId)) ||
        tplData.templates.find((tpl) => !tpl.isDefault) ||
        tplData.templates[0] ||
        buildDefaultTemplate()
      const template: StickerTemplate = active

      // 2) Build StickerSettings — prefer sticker-specific server settings;
      //    fall back to global org name + defaults when API is unavailable.
      let stickerSettings: StickerSettings = {
        ...DEFAULT_STICKER_SETTINGS,
        companyName: settings?.orgName?.trim() || DEFAULT_STICKER_SETTINGS.companyName,
        orgName: settings?.orgName?.trim() || DEFAULT_STICKER_SETTINGS.orgName,
      }
      if (settingsRes && settingsRes.ok) {
        const j = (await settingsRes.json()) as { settings?: StickerSettings }
        if (j.settings) {
          stickerSettings = {
            ...DEFAULT_STICKER_SETTINGS,
            ...j.settings,
            // Don't let an empty server value blank out the org name.
            companyName:
              (j.settings.companyName ?? '').trim() ||
              settings?.orgName?.trim() ||
              DEFAULT_STICKER_SETTINGS.companyName,
            orgName:
              (j.settings.orgName ?? '').trim() ||
              settings?.orgName?.trim() ||
              DEFAULT_STICKER_SETTINGS.orgName,
          }
        }
      }

      // 3) Build the per-device QR cache (honors the {{QrUrl}} Smart QR
      //    substitution so phone cameras open the ITAM repair page).
      // Use the shared mapper so every StickerDeviceData field is populated
      // (the previous hand-rolled literal omitted room / status /
      // currentAssignee / warrantyEnd / purchase* / ip / mac / licenses, so
      // those template variables rendered empty on single-device prints).
      const deviceData = deviceToStickerData(device as unknown as Record<string, unknown>)
      const qrOverride = generateStickerQrData('d', device.id, 'repair')
      const qrCache = new Map<string, string>()
      for (const el of template.elements as readonly StickerElement[]) {
        if (el.type !== 'qr') continue
        const data =
          (el.content ?? '').replace(/\{\{QrUrl\}\}/g, qrOverride) ||
          device.assetCode
        if (!data || qrCache.has(data)) continue
        try {
          const url = await QRCode.toDataURL(qrOverride, {
            margin: 1,
            width: 240,
            errorCorrectionLevel: 'M',
          })
          qrCache.set(data, url)
        } catch {
          // skip on QR generation error
        }
      }

      // 4) Render + open print window (1 sticker, cols=1 → 1 per page).
      const { html: stickerHtml } = await renderStickerFromTemplate(
        deviceData,
        template,
        stickerSettings,
        { qrCache },
      )
      const html = buildPrintDocument([stickerHtml], template, 1)

      const printWin = window.open('', '_blank')
      if (!printWin) {
        toast.error(t('devices.toast.allow_popup_print'))
        return
      }
      printWin.document.open()
      printWin.document.write(html)
      printWin.document.close()
      setTimeout(() => {
        try {
          printWin.focus()
          printWin.print()
        } catch (err) {
          console.error('[printSingleSticker]', err)
        }
      }, 350)

      // Fire-and-forget audit log.
      try {
        await fetch('/api/audit/log', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            action: 'PRINT',
            entity: t('jobtype.device'),
            entityId: device.id,
            summary: `t('devices.action.print_single') ${device.assetCode}`,
            detail: {
              count: 1,
              deviceIds: [device.id],
              canvasWidth: template.canvas.width,
              canvasHeight: template.canvas.height,
              savedTemplateId: template.id,
              savedTemplateName: template.name,
              single: true,
            },
          }),
        })
        await qc.invalidateQueries({ queryKey: ['audit'] })
      } catch (err) {
        console.error('[printSingleSticker]', err)
      }

      toast.success(t('devices.toast.sticker_ready').replace('{code}', device.assetCode))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('devices.toast.print_failed'))
    } finally {
      setPrintingSingleId(null)
    }
  }

  // ── Custom Export Dialog (Task ID 9, Phase 3) ──
  // Full list of columns that can be exported — richer than the default
  // DEVICE_CSV_HEADERS list. Grouped for visual clarity in the picker.
  const EXPORT_AVAILABLE_COLUMNS: ExportColumn[] = [
    { key: 'assetCode', label: 'devices.col.asset_code', group: 'devices.section.general' },
    { key: 'assetSiteCode', label: 'Site Code', group: 'devices.section.general' },
    { key: 'name', label: 'devices.col.name', group: 'devices.section.general' },
    { key: 'reports.unit.type', label: 'common.type', group: 'devices.section.general' },
    { key: 'brand', label: 'common.brand', group: 'devices.section.general' },
    { key: 'model', label: 'common.model', group: 'devices.section.general' },
    { key: 'serialNumber', label: 'devices.col.serial', group: 'devices.section.general' },
    { key: 'status', label: 'common.status', group: 'devices.section.general' },
    { key: 'site', label: 'common.site', group: 'devices.field.position' },
    { key: 'building', label: 'devices.field.building', group: 'devices.field.position' },
    { key: 'floor', label: 'devices.field.floor', group: 'devices.field.position' },
    { key: 'room', label: 'devices.field.room', group: 'devices.field.position' },
    { key: 'department', label: 'common.department', group: 'devices.field.position' },
    { key: 'departmentCode', label: 'devices.field.department_code', group: 'devices.field.position' },
    { key: 'location', label: 'devices.field.position_location', group: 'devices.field.position' },
    { key: 'currentAssignee', label: 'devices.col.assignee', group: 'devices.section.user_finance' },
    { key: 'costCenter', label: 'devices.field.cost_center', group: 'devices.section.user_finance' },
    { key: 'deviceGroup', label: 'devices.field.device_group', group: 'devices.section.user_finance' },
    { key: 'purchaseDate', label: 'devices.field.receive_date', group: 'devices.section.user_finance' },
    { key: 'purchasePrice', label: 'depreciation.col.purchase_price', group: 'devices.section.user_finance' },
    { key: 'salvageValue', label: 'devices.field.salvage_value', group: 'devices.section.user_finance' },
    { key: 'usefulLife', label: `${'devices.field.useful_life'} (${'devices.unit.month'})`, group: 'devices.section.user_finance' },
    { key: 'warrantyMonths', label: `${'devices.col.warranty'} (${'devices.unit.month'})`, group: 'devices.section.user_finance' },
    { key: 'warrantyEnd', label: 'devices.field.warranty_end', group: 'devices.section.user_finance' },
    { key: 'vendor', label: 'devices.field.vendor', group: 'devices.section.user_finance' },
    { key: 'contractNo', label: 'devices.field.contract_no', group: 'devices.section.user_finance' },
    { key: 'meterRequired', label: 'devices.field.meter_required', group: 'devices.section.meter' },
    { key: 'meterMode', label: 'devices.field.meter_mode', group: 'devices.section.meter' },
    { key: 'lastMeterBw', label: `${'devices.section.meter'} ${'devices.field.bw'}`, group: 'devices.section.meter' },
    { key: 'lastMeterColor', label: `${'devices.section.meter'} ${'devices.field.color'}`, group: 'devices.section.meter' },
    { key: 'lastReadingMonth', label: 'devices.field.last_read_month', group: 'devices.section.meter' },
    { key: 'ip', label: 'IP Address', group: 'devices.field.network_other' },
    { key: 'mac', label: 'MAC Address', group: 'devices.field.network_other' },
    { key: 'remoteId', label: 'Remote ID', group: 'devices.field.network_other' },
    { key: 'parentRef', label: 'devices.field.parent_ref', group: 'devices.section.set_relationship' },
    { key: 'parentDeviceId', label: `${'devices.field.parent_device'} (Set)`, group: 'devices.section.set_relationship' },
    { key: 'setLabel', label: 'devices.field.set_label', group: 'devices.section.set_relationship' },
    { key: 'setPosition', label: 'devices.field.set_position', group: 'devices.section.set_relationship' },
    { key: 'displayLabel', label: 'devices.field.display_label', group: 'devices.field.other' },
    { key: 'uninstallDate', label: 'devices.field.uninstall_date', group: 'devices.field.other' },
    { key: 'remark', label: 'common.remark', group: 'devices.field.other' },
    { key: 'updatedBy', label: 'devices.col.updated_by', group: 'devices.field.other' },
    { key: 'updatedAt', label: 'devices.col.updated_at', group: 'devices.field.other' },
  ]
  const [customExportOpen, setCustomExportOpen] = React.useState(false)

  /** Custom export handler — fetches devices and writes them in the chosen
   *  format with the user-selected columns (in the chosen order). */
  async function handleCustomExport(
    columns: ExportColumn[],
    format: ExportFormat,
  ) {
    try {
      setExporting(true)
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (siteFilter !== 'all') params.set('site', siteFilter)
      params.set('limit', '500')
      const res = await fetch(`/api/devices?${params.toString()}`, {
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error('ไม่สามารถดึงข้อมูลอุปกรณ์เพื่อส่งออกได้')
      const json = await res.json()
      const rows = (json.devices ?? []) as Record<string, unknown>[]

      runCustomExport(columns, format, rows, 'devices', t('devices.title'))

      toast.success(
        t('devices.toast.export_custom')
          .replace('{rows}', String(rows.length))
          .replace('{cols}', String(columns.length))
          .replace('{format}', format.toUpperCase()),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ส่งออกข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
      throw e
    } finally {
      setExporting(false)
    }
  }

  // ---- Bulk operations ----
  // toggleSelectAll now operates on the current page only (matches what the
  // user sees in the table header checkbox).
  function toggleSelectAll(checked: boolean) {
    if (checked) {
      const next = new Set(selectedIds)
      for (const d of pagedDevices) next.add(d.id)
      setSelectedIds(next)
    } else {
      const next = new Set(selectedIds)
      for (const d of pagedDevices) next.delete(d.id)
      setSelectedIds(next)
    }
  }
  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }
  function clearSelection() {
    setSelectedIds(new Set())
    setBulkStatus('')
    setBulkSite('')
  }

  async function logBulkAction(
    action: 'BULK_UPDATE' | 'BULK_TRANSFER' | 'BULK_DELETE',
    summary: string,
    detail: Record<string, unknown>,
  ) {
    try {
      await fetch('/api/audit/log', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action, entity: t('jobtype.device'), summary, detail }),
      })
    } catch {
      // non-fatal
    }
  }

  async function applyBulkStatus() {
    if (!bulkStatus || selectedIds.size === 0) return
    // SPRINT-3 #7: confirmation dialog with diff preview before bulk apply
    const count = selectedIds.size
    const statusLabel = t(deviceStatusLabelKey(bulkStatus))
    const confirmed = window.confirm(
      `ยืนยันการเปลี่ยนสถานะ ${count} อุปกรณ์\n\n` +
      `เปลี่ยนจากสถานะปัจจุบัน → "${statusLabel}"\n\n` +
      `กด "ตกลง" เพื่อดำเนินการต่อ หรือ "ยกเลิก" เพื่อยกเลิก`
    )
    if (!confirmed) return
    setBulkAction(true)
    const ids = Array.from(selectedIds)
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/devices/${id}`, {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ status: bulkStatus }),
        }),
      ),
    )
    const ok = results.filter((r) => r.status === 'fulfilled').length
    const fail = results.length - ok
    if (fail === 0) {
      toast.success(t('devices.toast.bulk_status_ok').replace('{count}', String(ok)).replace('{label}', statusLabel))
    } else {
      toast.warning(t('devices.toast.bulk_partial').replace('{ok}', String(ok)).replace('{fail}', String(fail)))
    }
    await logBulkAction('BULK_UPDATE', `t('devices.action.change_status') ${ok} ${statusLabel}`, {
      status: bulkStatus,
      count: ok,
      failed: fail,
      deviceIds: ids,
    })
    setBulkStatus('')
    clearSelection()
    await qc.invalidateQueries({ queryKey: ['devices'] })
    await qc.invalidateQueries({ queryKey: ['dashboard'] })
    await qc.invalidateQueries({ queryKey: ['audit'] })
    setBulkAction(false)
  }

  async function applyBulkTransfer() {
    if (!bulkSite || selectedIds.size === 0) return
    // SPRINT-3 #7: confirmation dialog before bulk transfer
    const count = selectedIds.size
    const transferSiteName = (visibleSites ?? []).find((s) => s.code === bulkSite)?.name ?? bulkSite
    const confirmed = window.confirm(
      `ยืนยันการย้าย ${count} อุปกรณ์\n\n` +
      `ไปยังสาขา: ${transferSiteName} (${bulkSite})\n\n` +
      `กด "ตกลง" เพื่อดำเนินการต่อ หรือ "ยกเลิก" เพื่อยกเลิก`
    )
    if (!confirmed) return
    setBulkAction(true)
    const ids = Array.from(selectedIds)
    const today = new Date().toISOString().slice(0, 10)
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/devices/${id}/transfer`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ toSite: bulkSite, transferDate: today }),
        }),
      ),
    )
    const ok = results.filter((r) => r.status === 'fulfilled').length
    const fail = results.length - ok
    if (fail === 0) {
      toast.success(t('devices.toast.bulk_transfer_ok').replace('{count}', String(ok)).replace('{site}', transferSiteName))
    } else {
      toast.warning(t('devices.toast.bulk_partial').replace('{ok}', String(ok)).replace('{fail}', String(fail)))
    }
    await logBulkAction('BULK_TRANSFER', `t('devices.action.transfer') ${ok} to ${transferSiteName}`, {
      toSite: bulkSite,
      count: ok,
      failed: fail,
      deviceIds: ids,
    })
    setBulkSite('')
    clearSelection()
    await qc.invalidateQueries({ queryKey: ['devices'] })
    await qc.invalidateQueries({ queryKey: ['dashboard'] })
    await qc.invalidateQueries({ queryKey: ['audit'] })
    setBulkAction(false)
  }

  async function applyBulkDelete() {
    if (selectedIds.size === 0) return
    setBulkAction(true)
    const ids = Array.from(selectedIds)
    const results = await Promise.allSettled(
      ids.map((id) => fetch(`/api/devices/${id}`, { method: 'DELETE', headers: authHeaders() })),
    )
    const ok = results.filter((r) => r.status === 'fulfilled').length
    const fail = results.length - ok
    if (fail === 0) {
      toast.success(t('devices.toast.bulk_delete_ok').replace('{count}', String(ok)))
    } else {
      toast.warning(t('devices.toast.bulk_partial').replace('{ok}', String(ok)).replace('{fail}', String(fail)))
    }
    await logBulkAction('BULK_DELETE', `t('devices.delete') ${ok} ${t('devices.unit.device')}`, {
      count: ok,
      failed: fail,
      deviceIds: ids,
    })
    setBulkDeleteOpen(false)
    clearSelection()
    await qc.invalidateQueries({ queryKey: ['devices'] })
    await qc.invalidateQueries({ queryKey: ['dashboard'] })
    await qc.invalidateQueries({ queryKey: ['audit'] })
    setBulkAction(false)
  }

  const hasDevices = (devices ?? []).length > 0
  // "all selected" reflects the CURRENT PAGE (since the header checkbox only
  // affects visible rows).
  const pageIds = pagedDevices.map((d) => d.id)
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id))
  const someSelected = pageIds.some((id) => selectedIds.has(id)) && !allSelected

  // ── When the Add/Edit full-page form is open, render ONLY the form ──
  // (no list view, no sidebar clutter behind it). This makes the form feel
  // like a real page rather than a modal floating over content.
  // CRITICAL: z-index must be higher than the sidebar (z-[100]) so the form
  // doesn't fall behind the sidebar. Using z-[300] to be above everything.
  if (dialogOpen) {
    return (
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          if (!o && saving) return
          setDialogOpen(o)
        }}
      >
        <DialogContent
          showCloseButton={false}
          aria-label={form.id ? t('devices.edit_title') : t('devices.add_new')}
          className="flex h-[100vh] max-h-[100vh] w-full max-w-[100vw] flex-col gap-0 overflow-hidden rounded-none border-none bg-white p-0 shadow-xl dark:bg-slate-900 sm:h-auto sm:max-h-[92vh] sm:max-w-3xl sm:rounded-lg sm:border sm:border-slate-200 dark:sm:border-slate-700"
        >
        {/* ── Sticky Header ── */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
              className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              title={t('devices.close_back')}
              aria-label={t('common.close')}
            >
              <X className="h-5 w-5" />
            </button>
            <div>
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 sm:text-lg">
                {form.id ? t('devices.edit_title') : t('devices.add_new')}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t('devices.form_required_hint').split('*').map((part, i, arr) => (
                  <React.Fragment key={i}>
                    {part}
                    {i < arr.length - 1 && <span className="font-semibold text-[#f97316]">*</span>}
                  </React.Fragment>
                ))}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* ── Quick Add / Full mode toggle ──
                (Task ID: LICENSE-PAGE-PLUS-QUICK-ADD, Task B)
                Shows the OTHER mode's label so the user knows what they'll
                switch TO. Persistence handled by toggleQuickAdd (localStorage). */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggleQuickAdd}
              disabled={saving}
              title={
                quickAdd
                  ? t('devices.switch_to_full')
                  : t('devices.switch_to_quick')
              }
              className={
                quickAdd
                  ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }
            >
              {quickAdd ? t('devices.full_mode') : t('devices.quick_mode')}
            </Button>
          </div>
        </div>

        {/* ── Scrollable Body ── */}
        <div
          ref={wizardBodyRef}
          className="flex-1 overflow-y-auto"
          onKeyDown={(e) => {
            // Enter-to-continue: inside the wizard body, Enter in a text
            // input advances to the next step (or saves on the last one).
            // Exclusions: textarea (newline), buttons/selects (own handler),
            // the SN-scanner input, and anything that already handled it.
            if (e.key !== 'Enter' || quickAdd || saving) return
            if (e.defaultPrevented) return
            const el = e.target as HTMLElement
            const tag = el.tagName
            if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return
            if (el.closest('[data-wizard-noenter]')) return
            e.preventDefault()
            if (step < WIZARD_STEPS.length - 1) goNext()
            else void save()
          }}
        >
          <div className="w-full px-4 py-4 sm:px-6">
            {quickAdd ? (
              <QuickAddForm
                form={form}
                setForm={setForm}
                visibleSites={visibleSites}
                deviceTypes={deviceTypes}
                brandsData={brandsData}
                deviceClassifications={deviceClassifications}
                nameManuallyEditedRef={nameManuallyEditedRef}
                fetchNextAssetCode={fetchNextAssetCode}
              />
            ) : (
              <>
            {/* ── Wizard progress header (replaces the old tab bar) ──
                Desktop: 5 clickable step chips — forward jumps are gated by
                per-step required fields (see canJumpTo).
                Mobile: chips hide; the ขั้นที่ X จาก 5 row + Progress bar
                stay, so the header remains one compact block. */}
            <div className="sticky top-0 z-[5] -mx-4 mb-3 border-b border-slate-200 bg-white/95 px-4 pb-3 pt-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:-mx-6 sm:px-6">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600 dark:text-slate-300">
                  {t('devices.wizard.progress')
                    .replace('{n}', String(step + 1))
                    .replace('{total}', String(WIZARD_STEPS.length))}
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  {t(WIZARD_STEPS[step].labelKey)}
                </span>
              </div>
              <Progress value={((step + 1) / WIZARD_STEPS.length) * 100} className="h-2" />
              <div className="mt-3 hidden grid-cols-5 gap-2 sm:grid">
                {WIZARD_STEPS.map((s, i) => {
                  const isActive = i === step
                  const isDone = i < step && stepMissingFields(i).length === 0
                  const allowed = canJumpTo(i)
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => allowed && setStep(i)}
                      disabled={!allowed}
                      title={t(s.labelKey)}
                      className={[
                        'flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors',
                        isActive
                          ? 'border-[#f97316] bg-[#f97316]/10 text-[#c2410c] dark:text-[#fdba74]'
                          : isDone
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400'
                            : allowed
                              ? 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                              : 'border-slate-200 bg-slate-50 text-slate-400 opacity-60 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-500',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                          isActive
                            ? 'bg-[#f97316] text-white'
                            : isDone
                              ? 'bg-emerald-500 text-white'
                              : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300',
                        ].join(' ')}
                      >
                        {isDone && !isActive ? <Check className="h-3 w-3" /> : i + 1}
                      </span>
                      <span className="truncate">{t(s.labelKey)}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ── SN Scanner (Step 1 only — the Serial Number field lives there) ──
                Scan a barcode → auto-fills the Serial Number field.
                Useful for quickly entering SN without manual typing.
                Uses Enter key (sent by most barcode scanners) to commit the value. */}
            {step === 0 && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-[#f97316]/30 bg-[#f97316]/5 px-3 py-2 dark:border-[#fb923c]/30 dark:bg-[#fb923c]/5">
              <ScanLine className="h-4 w-4 shrink-0 text-[#f97316] dark:text-[#fb923c]" />
              <input
                type="text"
                data-wizard-noenter="true"
                placeholder={t('devices.scan_sn_placeholder')}
                className="flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200 dark:placeholder:text-slate-500"
                onKeyDown={(e) => {
                  // Most barcode scanners send Enter after the code.
                  // We commit the value to form.serialNumber on Enter.
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const v = (e.target as HTMLInputElement).value.trim()
                    if (v) {
                      setForm((prev) => ({ ...prev, serialNumber: v }))
                      ;(e.target as HTMLInputElement).value = ''
                      // The Serial Number field lives in Step 1 — its form state
                      // updates as you type; we only clear the scanner input here.
                    }
                  }
                }}
                onBlur={(e) => {
                  // Also commit on blur (if user typed manually and clicked away)
                  const v = e.target.value.trim()
                  if (v) {
                    setForm((prev) => ({ ...prev, serialNumber: v }))
                    e.target.value = ''
                  }
                }}
              />
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {t('devices.scan_sn_hint')}
              </span>
            </div>
            )}

            {/* ── Quick legend ── */}
            <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              <span className="flex items-center gap-1">
                <span className="font-semibold text-[#f97316]">*</span>
                {t('devices.legend_required')}
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />
                {t('devices.legend_optional')}
              </span>
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-[#f97316]" />
                {t('devices.legend_auto')}
              </span>
            </div>

            {/* ── Wizard: 5 steps (replaced the old 5-tab layout) ──
                Step 1: 📍 สถานที่ตั้ง + ข้อมูลเครื่อง — site, รหัส, อาคาร/ชั้น/แผนก,
                        จุดติดตั้ง, Type/Brand/Model/Name/Serial
                        required: site, assetCode, name, type, brand, model
                Step 2: 💻 ตั้งค่าอุปกรณ์ (status, Remote ID, IP/MAC, group, meter)
                Step 3: 🔌 อุปกรณ์ต่อพ่วง (inline accessories — POST'd after save)
                Step 4: 📦 ชุดอุปกรณ์ (Device Set / Parent-Child)
                Step 5: ⚙️ ขั้นสูง (Purchase/Warranty, Finance, License, อื่นๆ)

                Only the ACTIVE step renders — the field JSX below is unchanged
                from the old tabs, so save()/validation behave identically. */}
            {step === 0 && (
              <div className="space-y-4">
                {/* ── Row 1: t('devices.field.site') + t('devices.field.asset_code') + t('devices.field.asset_code') (t('devices.field.single_row') — 2 t('devices.field.later_unit') auto from t('devices.field.site')) ── */}
                <div className="rounded-lg border border-sky-200 bg-white p-4 shadow-sm dark:border-sky-900/40 dark:bg-slate-900">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-400">
                    {t('devices.section.installation')}
                  </div>
                  <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-3 xl:grid-cols-4">
                    <Field label={t('devices.field.site')} required>
                      <Select
                        value={form.site}
                        onValueChange={(v) => {
                          setForm((prev) => ({
                            ...prev,
                            site: v,
                            building: '',
                            floor: '',
                            room: '',
                            assetSiteCode: '', // clear old site code so new one auto-generates
                          }))
                          if (!form.id) {
                            void fetchNextSiteCode(v)
                          }
                        }}
                      >
                        <SelectTrigger className="w-full" id="dev-site">
                          <SelectValue placeholder={t('devices.placeholder.site')} />
                        </SelectTrigger>
                        <SelectContent>
                          {(visibleSites ?? []).map((s) => (
                            <SelectItem key={s.code} value={s.code}>
                              {s.code} — {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label={t('devices.field.asset_code')} required>
                      <div className="relative">
                        <ScanLine className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <Input
                          id="dev-assetCode"
                          value={form.assetCode}
                          onChange={(e) => {
                            assetCodeManuallyEditedRef.current = true
                            setForm({ ...form, assetCode: e.target.value })
                          }}
                          placeholder={t('devices.placeholder.asset_code')}
                          className="bg-amber-50/50 pl-8 font-mono dark:bg-amber-950/10"
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            assetCodeManuallyEditedRef.current = false
                            void fetchNextAssetCode({ force: true })
                          }}
                          disabled={Boolean(form.id)}
                          title="สร้างเลขทะเบียนจากรูปแบบที่ตั้งไว้ (หมวดหมู่-ปีที่ซื้อ-ลำดับ)"
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-[#f97316] hover:bg-[#f97316]/10 disabled:opacity-40 dark:text-[#fb923c]"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </Field>
                    <Field label={t('devices.field.asset_site_code')}>
                      <div className="flex gap-2">
                        <Input
                          id="dev-assetSiteCode"
                          value={form.assetSiteCode}
                          onChange={(e) =>
                            setForm({ ...form, assetSiteCode: e.target.value })
                          }
                          placeholder={t('devices.placeholder.asset_site_code')}
                          className="bg-amber-50/50 font-mono text-xs dark:bg-amber-950/10 dark:border-slate-700"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={generateSiteCodeNow}
                          disabled={!form.site}
                          className="h-9 shrink-0 border-[#f97316]/30 text-[#f97316] hover:bg-[#f97316]/10 dark:border-[#fb923c]/30 dark:text-[#fb923c]"
                          title={t('devices.hint.gen_site_code')}
                          aria-label={t('devices.aria.gen_site_code')}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </Field>
                  </div>

                  {/* ── Row 2: t('devices.field.building') + t('devices.field.floor') + t('devices.field.department') ── */}
                  <div className="mt-4 grid grid-cols-1 items-start gap-4 sm:grid-cols-3 xl:grid-cols-4">
                    {/* building/floor are NOT enforced by save() or the API
                        (required list = site, assetCode, name, brand, model,
                        type) — no required asterisk, so the label matches the
                        actual validation logic. */}
                    <Field label={t('devices.field.building')}>
                      <Combobox
                        value={form.building}
                        onChange={(v) =>
                          setForm((prev) => ({
                            ...prev,
                            building: v,
                            floor: '',
                            location: '',
                            room: '',
                          }))
                        }
                        items={(buildingOptions ?? []).map((b) => ({
                          value: b,
                          label: b,
                        }))}
                        placeholder={t('devices.placeholder.building')}
                        emptyText={t('devices.empty_no_building')}
                      />
                    </Field>
                    <Field label={t('devices.field.floor')} hint={highlightedFloors.length > 0 ? t('devices.hint.floor_highlight').replace('{n}', String(highlightedFloors.length)) : undefined}>
                      <Combobox
                        value={form.floor}
                        onChange={(v) =>
                          setForm((prev) => ({
                            ...prev,
                            floor: v,
                            location: '',
                            room: '',
                          }))
                        }
                        items={(floorOptions ?? []).map((f) => ({
                          value: f,
                          label: f,
                        }))}
                        highlightedValues={highlightedFloors}
                        highlightBadges={floorBadges}
                        placeholder={t('devices.placeholder.floor')}
                        emptyText={t('devices.empty_no_floor')}
                      />
                    </Field>
                    <Field label={t('devices.field.department')} hint={highlightedDepartments.length > 0 ? t('devices.hint.dept_highlight').replace('{n}', String(highlightedDepartments.length)) : undefined}>
                      <Combobox
                        value={form.department}
                        onChange={(v) => {
                          const match = departments.find((d) => d.label === v)
                          if (match?.parentRef) {
                            setForm((prev) => ({
                              ...prev,
                              department: v,
                              parentRef: match.parentRef ?? prev.parentRef,
                              departmentCode: match.parentRef ?? prev.departmentCode,
                            }))
                          } else {
                            setForm((prev) => ({ ...prev, department: v }))
                          }
                        }}
                        items={filteredDepartments.map((d) => ({
                          value: d.label,
                          label: d.label,
                        }))}
                        highlightedValues={highlightedDepartments}
                        highlightBadges={departmentBadges}
                        placeholder={t('devices.placeholder.dept')}
                        emptyText={t('devices.empty_no_dept')}
                      />
                    </Field>
                  </div>

                  {/* ── t('devices.field.belonging') auto hint ── */}
                  {form.parentRef && (
                    <div className="mt-3 flex items-center gap-2 rounded-md bg-sky-50 px-3 py-2 text-[11px] text-sky-700 dark:bg-sky-950/30 dark:text-sky-400">
                      <span className="font-semibold">{t('devices.affiliation_auto_label')}</span>
                      <span>{form.parentRef}</span>
                      <span className="text-sky-400">{t('devices.affiliation_auto_hint')}</span>
                    </div>
                  )}

                  {/* ── Row 3: t('devices.field.position') + t('devices.field.room') (optional, t('devices.field.specific_location')) ── */}
                  <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {t('devices.section.specific_point')}
                    </div>
                    <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      <Field label={t('devices.field.location')} hint={highlightedLocations.length > 0 ? t('devices.hint.location_highlight').replace('{n}', String(highlightedLocations.length)) : t('devices.hint.location_default')}>
                        <Combobox
                          value={form.location}
                          onChange={(v) => setForm({ ...form, location: v })}
                          items={(globalLocations ?? []).map((l) => ({
                            value: l,
                            label: l,
                          }))}
                          highlightedValues={highlightedLocations}
                          highlightBadges={locationBadges}
                          placeholder={t('devices.placeholder.location')}
                          emptyText={t('devices.placeholder.location_empty')}
                        />
                      </Field>
                      <Field label={t('devices.field.room')}>
                        <Input
                        id="dev-room"
                          value={form.room}
                          onChange={(e) =>
                            setForm({ ...form, room: e.target.value })
                          }
                          placeholder={t('devices.placeholder.room')}
                        />
                      </Field>
                    </div>
                  </div>

                  {/* ── t('devices.section.device_info') (moved from Tab 2) ──
                      Type / Brand / Model / Name / Serial — t('devices.field.to_site')
                      Tab 1 — space available and required fields */}
                  <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {t('devices.section.device_info')}
                    </div>
                    <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      <Field label={t('devices.field.type')} required hint={t('devices.hint.type_meter')}>
                        <Combobox
                          value={form.type}
                          onChange={(v) =>
                            setForm({ ...form, type: v, brand: '', model: '' })
                          }
                          items={(deviceTypes ?? []).map((dt) => ({
                            value: dt.name,
                            label: dt.name,
                          }))}
                          placeholder={t('devices.placeholder.type')}
                          emptyText={t('devices.empty_no_type')}
                        />
                      </Field>
                      <Field label={t('devices.field.brand')} required>
                        <Combobox
                          value={form.brand}
                          onChange={(v) =>
                            setForm({ ...form, brand: v, model: '' })
                          }
                          items={(brandsData ?? []).map((b) => ({
                            value: b.name,
                            label: b.name,
                          }))}
                          placeholder={t('devices.placeholder.brand')}
                          emptyText={t('devices.empty_no_brand')}
                        />
                      </Field>
                      <Field label={t('devices.field.model')} required hint={t('devices.hint.model_brand_auto')}>
                        <Combobox
                          value={form.model}
                          onChange={(v) => {
                            const match = deviceClassifications.find(
                              (c) =>
                                (c.model ?? '').toLowerCase() ===
                                v.toLowerCase(),
                            )
                            if (match) {
                              setForm((prev) => ({
                                ...prev,
                                model: v,
                                brand: match.brand ?? prev.brand,
                                type: match.deviceType ?? prev.type,
                              }))
                            } else {
                              setForm((prev) => ({ ...prev, model: v }))
                            }
                          }}
                          items={Array.from(
                            new Set(
                              deviceClassifications
                                .map((c) => c.model)
                                .filter((m): m is string => Boolean(m)),
                            ),
                          )
                            .sort()
                            .map((m) => ({ value: m, label: m }))}
                          placeholder={t('devices.placeholder.model')}
                          emptyText={t('devices.empty_no_model')}
                        />
                      </Field>
                      <Field label={t('devices.field.name_auto')} hint={t('devices.hint.name_auto_full')}>
                        <Input
                          id="dev-name"
                          value={form.name}
                          onChange={(e) => {
                            nameManuallyEditedRef.current = true
                            setForm({ ...form, name: e.target.value })
                          }}
                          placeholder={t('devices.placeholder.name_full')}
                          className="bg-amber-50/50 dark:bg-amber-950/10"
                        />
                      </Field>
                      <Field label={t('devices.field.serial')}>
                        <div className="relative">
                          <ScanLine className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                          <Input
                            id="dev-serialNumber"
                            value={form.serialNumber}
                            onChange={(e) =>
                              setForm({ ...form, serialNumber: e.target.value })
                            }
                            placeholder={t('devices.placeholder.serial_form')}
                            className="pl-8 font-mono text-xs"
                          />
                        </div>
                      </Field>
                    </div>
                  </div>
                </div>
              </div>)}

              {/* ═══════════════════════════════════════════════════════
                  Tab 2: 💻 t('devices.title') (t('devices.field.setting') — Remote ID, t('devices.field.status'), IP/MAC, t('devices.field.device_group'), t('devices.section.meter'))
                  ═══════════════════════════════════════════════════════ */}
              {step === 1 && (
                <div className="space-y-4">
                <div className="rounded-lg border border-emerald-200 bg-white p-4 shadow-sm dark:border-emerald-900/40 dark:bg-slate-900">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                    {t('devices.section.device_setup')}
                  </div>
                  <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <Field label={t('devices.field.status')} required>
                      <Select
                        value={form.status}
                        onValueChange={(v) =>
                          setForm({ ...form, status: v })
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t('devices.placeholder.status')} />
                        </SelectTrigger>
                        <SelectContent>
                          {DEVICE_STATUS_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {t(deviceStatusLabelKey(o.value))}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Remote ID (TeamViewer / AnyDesk)">
                      <Input
                        id="dev-remoteId"
                        value={form.remoteId}
                        onChange={(e) =>
                          setForm({ ...form, remoteId: e.target.value })
                        }
                        placeholder="t('devices.field.such_as') 123 456 789"
                        className="font-mono text-xs"
                      />
                    </Field>
                    <Field label="IP Address">
                      <div className="relative">
                        <ScanLine className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <Input
                          id="dev-ip"
                          value={form.ip}
                          onChange={(e) =>
                            setForm({ ...form, ip: e.target.value })
                          }
                          placeholder="192.168.1.10"
                          className="pl-8 font-mono text-xs"
                          inputMode="decimal"
                        />
                      </div>
                    </Field>
                    <Field label="MAC Address">
                      <div className="relative">
                        <ScanLine className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <Input
                          id="dev-mac"
                          value={form.mac}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              mac: formatMacInput(e.target.value),
                            })
                          }
                          placeholder="AA:BB:CC:DD:EE:FF"
                          className="pl-8 font-mono text-xs"
                          inputMode="text"
                        />
                      </div>
                    </Field>
                    <Field
                      label={t('devices.field.device_group')}
                    >
                      <Combobox
                        value={form.deviceGroup}
                        onChange={(v) =>
                          setForm({ ...form, deviceGroup: v })
                        }
                        items={deviceGroups.map((g) => ({
                          value: g.code,
                          label: DEVICE_GROUP_LABEL_KEYS[g.code] ? t(DEVICE_GROUP_LABEL_KEYS[g.code]) : g.label,
                        }))}
                        displayValue={(v) => DEVICE_GROUP_LABEL_KEYS[v] ? t(DEVICE_GROUP_LABEL_KEYS[v]) : v}
                        placeholder={t('devices.placeholder.device_group')}
                        emptyText={t('devices.empty_no_device_group')}
                      />
                    </Field>
                    <Field label={t('devices.field.meter_mode')}>
                      <Select
                        value={form.meterMode}
                        onValueChange={(v) =>
                          setForm({ ...form, meterMode: v })
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t('devices.placeholder.meter_mode')} />
                        </SelectTrigger>
                        <SelectContent>
                          {METER_MODE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {t(o.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  {/* ── meter status hint (auto-derived from Type) ── */}
                  <div className={`mt-3 rounded-md px-3 py-2 text-[11px] ${form.meterRequired ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' : 'bg-slate-50 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400'}`}>
                    {form.meterRequired ? (
                      <>✅ <span className="font-semibold">{t('devices.meter.required_on')}</span> — {t('devices.meter.required_hint_on').replace('{type}', form.type)}</>
                    ) : (
                      <>⚪ <span className="font-semibold">{t('devices.meter.required_off')}</span> — {t('devices.meter.required_hint_off').replace('{type}', form.type || 'devices.meter.required_type_empty')}</>
                    )}
                  </div>
                </div>
              </div>)}

              {/* ═══════════════════════════════════════════════════════
                  Tab 3: 🔌 t('devices.field.accessory') (inline accessory editor)
                  ─────────────────────────────────────────────────────
                  Task ID: INLINE-ACCESSORY-IN-DEVICE-FORM

                  Lets the user add accessories AT THE SAME TIME as the device
                  (no need to save the device first, then open the detail
                  sheet, then add each accessory — single submit creates the
                  device + all accessories in one go).

                  • New device: rows are stored in local form.accessories[]
                    state — save() POSTs them to /api/devices/[id]/accessories
                    AFTER the device is created.
                  • Edit device: existing accessories are loaded into the form
                    on openEdit() — save() PATCHes rows with an .id and POSTs
                    rows without an .id.

                  Best-effort: if any accessory save fails, the device save
                  is NOT rolled back (logged via toast.warning).
                  ═══════════════════════════════════════════════════════ */}
              {step === 2 && (
                <div className="space-y-4">
                <div className="rounded-lg border border-orange-200 bg-white p-4 shadow-sm dark:border-orange-900/40 dark:bg-slate-900">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-400">
                      {t('devices.acc.title_count').replace('{count}', String(form.accessories.length))}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addAccessory}
                      className="border-[#f97316]/30 text-[#f97316] hover:bg-[#f97316]/10 dark:border-[#fb923c]/30 dark:text-[#fb923c]"
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      {t('devices.acc.add')}
                    </Button>
                  </div>

                  <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                    {t('devices.acc.intro')}
                  </p>

                  {accessoriesLoading && (
                    <div className="mb-3 text-sm text-slate-500 dark:text-slate-400">
                      {t('devices.acc.loading')}
                    </div>
                  )}

                  {form.accessories.length === 0 && !accessoriesLoading ? (
                    <div className="rounded-md border border-dashed border-orange-300 bg-orange-50/40 px-4 py-8 text-center dark:border-orange-800/50 dark:bg-orange-950/10">
                      <div className="mb-1 text-sm font-medium text-orange-700 dark:text-orange-300">
                        {t('devices.empty_no_acc')}
                      </div>
                      <div className="text-xs text-orange-600/80 dark:text-orange-400/80">
                        {t('devices.empty_no_acc_hint')}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {form.accessories.map((acc, idx) => {
                        const matchedAccType = ACCESSORY_TYPES_INLINE.find((opt) => opt.value === acc.accessoryType)
                        const typeLabel =
                          matchedAccType ? t(matchedAccType.labelKey) :
                          acc.accessoryType
                        return (
                          <div
                            key={acc.id ?? `new-acc-${idx}`}
                            className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
                          >
                            {/* ── Row header: index + DB badge + delete ── */}
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-orange-100 text-[10px] font-bold text-orange-700 dark:bg-orange-950/40 dark:text-orange-300">
                                  {idx + 1}
                                </span>
                                {typeLabel}
                                {acc.id && (
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                    {acc.id.slice(-8)}
                                  </span>
                                )}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeAccessory(idx)}
                                className="rounded p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                title={t('devices.acc.delete_row')}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            {/* ── Form fields (responsive grid) ── */}
                            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                              <Field label={t('devices.field.acc_type')} required>
                                <Select
                                  value={acc.accessoryType}
                                  onValueChange={(v) =>
                                    updateAccessory(idx, { accessoryType: v })
                                  }
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder={t('devices.placeholder.acc_type')} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ACCESSORY_TYPES_INLINE.map((opt) => (
                                      <SelectItem key={opt.value} value={opt.value}>
                                        {t(opt.labelKey)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </Field>
                              <Field label={t('devices.field.acc_brand')}>
                                <Input
                                  value={acc.brand}
                                  onChange={(e) =>
                                    updateAccessory(idx, { brand: e.target.value })
                                  }
                                  placeholder={t('devices.placeholder.acc_brand')}
                                />
                              </Field>
                              <Field label={t('devices.field.acc_model')}>
                                <Input
                                  value={acc.model}
                                  onChange={(e) =>
                                    updateAccessory(idx, { model: e.target.value })
                                  }
                                  placeholder={t('devices.placeholder.acc_model')}
                                />
                              </Field>
                              <Field label="Serial Number">
                                <Input
                                  value={acc.serialNumber}
                                  onChange={(e) =>
                                    updateAccessory(idx, { serialNumber: e.target.value })
                                  }
                                  placeholder="S/N..."
                                  className="font-mono text-xs"
                                />
                              </Field>
                              <Field label={t('devices.field.acc_status')}>
                                <Select
                                  value={acc.status}
                                  onValueChange={(v) =>
                                    updateAccessory(idx, { status: v })
                                  }
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ACCESSORY_STATUSES_INLINE.map((s) => (
                                      <SelectItem key={s.value} value={s.value}>
                                        {t(s.labelKey)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </Field>
                              <Field label={t('devices.field.acc_installed_date')}>
                                <Input
                                  type="date"
                                  value={acc.installedDate}
                                  onChange={(e) =>
                                    updateAccessory(idx, { installedDate: e.target.value })
                                  }
                                />
                              </Field>
                              <Field label={t('devices.field.acc_remark')}>
                                <Input
                                  value={acc.remark}
                                  onChange={(e) =>
                                    updateAccessory(idx, { remark: e.target.value })
                                  }
                                  placeholder={t('devices.placeholder.acc_remark')}
                                />
                              </Field>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>)}

              {/* ═══════════════════════════════════════════════════════
                  Tab 4: 📦 t('devices.field.set_devices') (Device Set / Parent-Child)
                  ─────────────────────────────────────────────────────
                  MERGE-ACCESSORY-DEVICE-SET: simplified — the primary flow
                  for adding children (or peripherals) is now done from the
                  parent device's detail sheet (DeviceAccessoriesSection with
                  "t('devices.action.add_to_set')" modal that supports both "new accessory"
                  and "link existing device" modes).

                  This tab now only manages the CURRENT device's role in a
                  set:
                  • setLabel = a free-text name for the whole set (shared
                    across all members — e.g. "ชุดt('devices.unit.device')พิมพ์t('devices.field.room')จ่ายยา").
                  • setPosition = optional ordering inside the set (1, 2, 3…).
                  • parentDeviceId (read-only here) — if this device is itself
                    a child of another device, show the parent info + an
                    "unlink" button. To CHANGE the parent, open that parent's
                    detail sheet and add this device via the new "t('devices.action.add_to_set')"
                    flow.
                  ═══════════════════════════════════════════════════════ */}
              {step === 3 && (
                <div className="space-y-4">
                <div className="rounded-lg border border-teal-200 bg-white p-4 shadow-sm dark:border-teal-900/40 dark:bg-slate-900">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-400">
                    {t('devices.section.set')}
                  </div>
                  <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                    {t('devices.set.intro')}
                  </p>

                  {/* ── Hint: how to add children (now done from detail sheet) ── */}
                  <div className="mb-3 rounded-md border border-teal-300 bg-teal-50/60 px-3 py-2 text-[11px] text-teal-700 dark:border-teal-700 dark:bg-teal-950/30 dark:text-teal-300">
                    {t('devices.set.add_child_hint')}
                  </div>

                  {/* ── Parent device info (read-only, with unlink button) ── */}
                  {form.parentDeviceId ? (
                    <div className="mb-3 space-y-2">
                      <Field label={t('devices.field.parent_device')}>
                        <div className="rounded-md border border-teal-300 bg-teal-50/60 px-3 py-2 text-xs dark:border-teal-700 dark:bg-teal-950/30">
                          <ParentDeviceInfo deviceId={form.parentDeviceId} authHeaders={authHeaders} />
                        </div>
                      </Field>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setForm({ ...form, parentDeviceId: '' })}
                        className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40"
                      >
                        <X className="mr-1 h-3.5 w-3.5" />
                        {t('devices.set.unlink')}
                      </Button>
                    </div>
                  ) : (
                    <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                      {t('devices.set.no_parent')}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    <Field label={t('devices.field.set_position')}>
                      <Input
                        type="number"
                        min="1"
                        value={form.setPosition}
                        onChange={(e) =>
                          setForm({ ...form, setPosition: e.target.value })
                        }
                        placeholder="1, 2, 3, …"
                      />
                      <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                        {t('devices.hint.set_position')}
                      </p>
                    </Field>

                    <Field label={t('devices.field.set_label')}>
                      <Input
                        value={form.setLabel}
                        onChange={(e) =>
                          setForm({ ...form, setLabel: e.target.value })
                        }
                        placeholder={t('devices.placeholder.set_label')}
                      />
                      <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                        {t('devices.hint.set_label')}
                      </p>
                    </Field>
                  </div>

                  {form.parentDeviceId && (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      {t('devices.set.child_warning')}
                    </div>
                  )}
                </div>
              </div>)}

              {/* ═══════════════════════════════════════════════════════
                  Tab 5: ⚙️ t('devices.section.advanced')
                  ═══════════════════════════════════════════════════════ */}
              {step === 4 && (
                <div className="space-y-4">
                {/* ── License / Software ── */}
                <div className="rounded-lg border border-violet-200 bg-white p-4 shadow-sm dark:border-violet-900/40 dark:bg-slate-900">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400">
                      {t('devices.section.license')}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addLicense}
                      className="border-[#f97316]/30 text-[#f97316] hover:bg-[#f97316]/10 dark:border-[#fb923c]/30 dark:text-[#fb923c]"
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      {t('devices.lic.add')}
                    </Button>
                  </div>
                  {licensesLoading && (
                    <div className="mb-3 text-sm text-slate-500 dark:text-slate-400">
                      {t('devices.lic.loading')}
                    </div>
                  )}
                  {form.licenses.length === 0 && !licensesLoading ? (
                    <div className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      {t('devices.empty_no_lic')}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {form.licenses.map((lic, idx) => (
                        <div
                          key={lic.id ?? `new-${idx}`}
                          className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                              License #{idx + 1}
                              {lic.id && (
                                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                  {lic.id.slice(-8)}
                                </span>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeLicense(idx)}
                              className="rounded p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                              title={t('devices.lic.delete_row')}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            <Field label={t('devices.field.lic_software')} required>
                              <Input
                                value={lic.software}
                                onChange={(e) =>
                                  updateLicense(idx, {
                                    software: e.target.value,
                                  })
                                }
                                placeholder={t('devices.placeholder.lic_software')}
                              />
                            </Field>
                            <Field label={t('devices.field.lic_type')}>
                              <Select
                                value={lic.licenseType || '__none__'}
                                onValueChange={(v) =>
                                  updateLicense(idx, { licenseType: v === '__none__' ? '' : v })
                                }
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder={t('devices.placeholder.lic_type')} />
                                </SelectTrigger>
                                <SelectContent>
                                  {LICENSE_TYPE_OPTIONS.map((o) => (
                                    <SelectItem key={o.value} value={o.value}>
                                      {t(o.labelKey)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </Field>
                            <Field label={t('devices.field.lic_seats')}>
                              <Input
                                type="number"
                                min={1}
                                step={1}
                                value={lic.quantity}
                                onChange={(e) =>
                                  updateLicense(idx, {
                                    quantity: Number(e.target.value) || 1,
                                  })
                                }
                              />
                            </Field>
                            <Field label="License ID">
                              <Input
                                value={lic.licenseId}
                                onChange={(e) =>
                                  updateLicense(idx, {
                                    licenseId: e.target.value,
                                  })
                                }
                                placeholder={t('devices.placeholder.lic_id')}
                                className="font-mono text-xs"
                              />
                            </Field>
                            <Field label="License Key">
                              <Input
                                value={lic.licenseKey}
                                onChange={(e) =>
                                  updateLicense(idx, {
                                    licenseKey: e.target.value,
                                  })
                                }
                                placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                                className="font-mono text-xs"
                              />
                            </Field>
                            <Field label={t('devices.field.lic_expiry')}>
                              <Input
                                type="date"
                                value={lic.expiryDate}
                                onChange={(e) =>
                                  updateLicense(idx, {
                                    expiryDate: e.target.value,
                                  })
                                }
                              />
                            </Field>
                            <Field label={t('devices.field.remark')}>
                              <Input
                                value={lic.remark}
                                onChange={(e) =>
                                  updateLicense(idx, {
                                    remark: e.target.value,
                                  })
                                }
                                placeholder={t('devices.placeholder.lic_remark')}
                              />
                            </Field>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── t('devices.section.purchase_warranty') ── */}
                <div className="rounded-lg border border-violet-200 bg-white p-4 shadow-sm dark:border-violet-900/40 dark:bg-slate-900">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400">
                    {t('devices.section.purchase')}
                  </div>
                  <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <Field label={t('devices.field.vendor')}>
                      <Input
                        id="dev-vendor"
                        value={form.vendor}
                        onChange={(e) =>
                          setForm({ ...form, vendor: e.target.value })
                        }
                        placeholder={t('devices.placeholder.vendor')}
                      />
                    </Field>
                    <Field label={t('devices.field.contract_no')}>
                      <Input
                        id="dev-contractNo"
                        value={form.contractNo}
                        onChange={(e) =>
                          setForm({ ...form, contractNo: e.target.value })
                        }
                        placeholder={t('devices.placeholder.contract_no')}
                      />
                    </Field>
                    <Field label={t('devices.field.purchase_date')}>
                      <Input
                        type="date"
                        id="dev-purchaseDate"
                        value={form.purchaseDate}
                        onChange={(e) =>
                          setForm({ ...form, purchaseDate: e.target.value })
                        }
                      />
                    </Field>
                    <Field label={t('devices.field.warranty_months')}>
                      <Input
                        type="number"
                        min={1}
                        max={120}
                        step={1}
                        id="dev-warrantyMonths"
                        value={form.warrantyMonths}
                        onChange={(e) =>
                          setForm({ ...form, warrantyMonths: e.target.value })
                        }
                        placeholder="12"
                      />
                    </Field>
                    <Field label={t('devices.field.warranty_end')}>
                      <Input
                        type="date"
                        id="dev-warrantyEnd"
                        value={form.warrantyEnd}
                        onChange={(e) =>
                          setForm({ ...form, warrantyEnd: e.target.value })
                        }
                      />
                    </Field>
                    <Field label={t('devices.field.uninstall_date')}>
                      <Input
                        type="date"
                        id="dev-uninstallDate"
                        value={form.uninstallDate}
                        onChange={(e) =>
                          setForm({ ...form, uninstallDate: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                </div>

                {/* ── t('devices.section.user_finance') ── */}
                <div className="rounded-lg border border-emerald-200 bg-white p-4 shadow-sm dark:border-emerald-900/40 dark:bg-slate-900">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                    {t('devices.section.finance')}
                  </div>
                  <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-3 xl:grid-cols-4">
                    <Field label={t('devices.field.purchase_price')}>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        id="dev-purchasePrice"
                        value={form.purchasePrice}
                        onChange={(e) =>
                          setForm({ ...form, purchasePrice: e.target.value })
                        }
                        placeholder="0.00"
                      />
                    </Field>
                    <Field label={t('devices.field.salvage_value')}>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        id="dev-salvageValue"
                        value={form.salvageValue}
                        onChange={(e) =>
                          setForm({ ...form, salvageValue: e.target.value })
                        }
                        placeholder="0.00"
                      />
                    </Field>
                    <Field label={t('devices.field.useful_life')}>
                      <Input
                        type="number"
                        min={1}
                        max={240}
                        step={1}
                        id="dev-usefulLife"
                        value={form.usefulLife}
                        onChange={(e) =>
                          setForm({ ...form, usefulLife: e.target.value })
                        }
                        placeholder="60"
                      />
                    </Field>
                  </div>
                  <div className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                    {t('devices.depreciation_formula')}
                  </div>
                </div>


                {/* ── t('devices.field.other') (Tech fields) ── */}
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    {t('devices.section.other_tech')}
                  </div>
                  <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <Field label={t('devices.field.cost_center')}>
                      <Input
                        id="dev-costCenter"
                        value={form.costCenter}
                        onChange={(e) =>
                          setForm({ ...form, costCenter: e.target.value })
                        }
                        placeholder={t('devices.placeholder.cost_center')}
                      />
                    </Field>
                    <Field label={t('devices.field.dept_code')}>
                      <Input
                        id="dev-departmentCode"
                        value={form.departmentCode}
                        onChange={(e) =>
                          setForm({ ...form, departmentCode: e.target.value })
                        }
                        placeholder={t('devices.placeholder.dept_code')}
                      />
                    </Field>
                    <Field label={t('devices.field.parent_ref')} hint={t('devices.hint.parent_ref')}>
                      <Input
                        id="dev-parentRef"
                        value={form.parentRef}
                        onChange={(e) =>
                          setForm({ ...form, parentRef: e.target.value })
                        }
                        placeholder={t('devices.placeholder.parent_ref')}
                      />
                    </Field>
                    <Field label={t('devices.field.display_label')} hint={t('devices.hint.display_label')}>
                      <Input
                        id="dev-displayLabel"
                        value={form.displayLabel}
                        onChange={(e) =>
                          setForm({ ...form, displayLabel: e.target.value })
                        }
                        placeholder={t('devices.placeholder.display_label')}
                      />
                    </Field>
                    <Field label={t('devices.field.remark')}>
                      <Input
                        id="dev-remark"
                        value={form.remark}
                        onChange={(e) =>
                          setForm({ ...form, remark: e.target.value })
                        }
                        placeholder={t('devices.placeholder.remark')}
                      />
                    </Field>
                  </div>
                </div>
              </div>)}
              </>
            )}

            {/* ── Bottom spacing ── */}
            <div className="h-16" />
          </div>
        </div>

        {/* ── Sticky Footer (wizard nav + mobile save bar) ──
            Left: Back / Next (Full mode only — Next runs per-step validation).
            Right: Cancel + Save — save() always checks ALL required fields,
            so saving is possible from any step. */}
        <div
          className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.04)] dark:border-slate-800 dark:bg-slate-900 sm:px-6"
        >
          {!quickAdd && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                type="button"
                onClick={goBack}
                disabled={saving || step === 0}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                {t('devices.wizard.back')}
              </Button>
              {step < WIZARD_STEPS.length - 1 ? (
                <>
                  <Button
                    type="button"
                    onClick={goNext}
                    disabled={saving || stepMissingFields(step).length > 0}
                    title={t('devices.wizard.enter_hint')}
                    className="border border-[#f97316]/40 bg-[#f97316]/10 text-[#c2410c] hover:bg-[#f97316]/20 disabled:opacity-50 dark:border-[#fb923c]/40 dark:text-[#fdba74]"
                  >
                    {t('devices.wizard.next')}
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                  {stepMissingFields(step).length > 0 && (
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      {t('devices.wizard.missing_hint').replace(
                        '{fields}',
                        stepMissingFields(step)
                          .map((f) => t(WIZARD_FIELD_LABEL_KEYS[f] ?? f))
                          .join(', '),
                      )}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {t('devices.wizard.final_hint')}
                </span>
              )}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
              className="hidden sm:inline-flex"
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={save}
              disabled={saving}
              className="bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
            >
              {saving
                ? t('devices.saving')
                : quickAdd
                  ? t('devices.save_quick')
                  : t('devices.save_device')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    )
  }

  return (
    <div className="flex h-full flex-col p-3 md:p-4">
      <div className="flex flex-shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{t('devices.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('devices.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Keyboard shortcuts help — `?` anywhere opens it */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShortcutsOpen(true)}
            className="hidden text-slate-500 hover:bg-slate-100 hover:text-[#f97316] dark:text-slate-400 dark:hover:bg-slate-800 sm:inline-flex"
            title={t('devices.aria.shortcuts_title')}
            aria-label={t('devices.aria.shortcuts')}
          >
            <Keyboard className="h-4 w-4" />
          </Button>
          {/* Primary CTA in the header — always visible without scrolling.
              On mobile it's full-width; on sm+ it's right-aligned. */}
          {/* SPRINT-3 #1: Quick Add (5 fields) — fast entry for common case */}
          <Button
            type="button"
            onClick={() => setQuickAddOpen(true)}
            variant="outline"
            className="w-full border-[#f97316] text-[#f97316] hover:bg-[#f97316]/10 sm:w-auto"
            title="เพิ่มอุปกรณ์ด่วน (5 ช่องหลัก)"
          >
            <Plus className="h-4 w-4" />
            <span className="sm:hidden">เพิ่มด่วน</span>
            <span className="hidden sm:inline">เพิ่มด่วน</span>
          </Button>
          <Button
            type="button"
                onClick={openAdd}
            className="w-full bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950 sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            {t('devices.add_device')}
          </Button>
        </div>
      </div>

      {/* ── KPI summary cards ──
          Quick stats computed from the filtered device list. Clicking a
          card applies the corresponding filter instantly. */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
        <KpiCard
          label={t('devices.kpi.total')}
          value={kpi.total}
          tone="neutral"
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
        />
        <KpiCard
          label={t('devices.kpi.active')}
          value={kpi.active}
          tone="success"
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          active={statusFilter === 'active'}
          onClick={() => setStatusFilter('active')}
        />
        <KpiCard
          label={t('devices.kpi.repair')}
          value={kpi.repair}
          tone="warning"
          icon={<Wrench className="h-3.5 w-3.5" />}
          active={statusFilter === 'repair'}
          onClick={() => setStatusFilter('repair')}
        />
        <KpiCard
          label={t('devices.kpi.spare')}
          value={kpi.spare}
          tone="info"
          icon={<PackageOpen className="h-3.5 w-3.5" />}
          active={statusFilter === 'spare'}
          onClick={() => setStatusFilter('spare')}
        />
        <KpiCard
          label={t('devices.kpi.inactive')}
          value={kpi.inactive}
          tone="danger"
          icon={<XCircle className="h-3.5 w-3.5" />}
          active={statusFilter === 'disposed'}
          onClick={() => setStatusFilter('disposed')}
        />
        <KpiCard
          label={t('devices.kpi.warranty_expiring')}
          value={kpi.warrantyExpiringSoon}
          tone="warning"
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          active={warrantyFilter === 'expiring'}
          onClick={() => setWarrantyFilter('expiring')}
        />
        <KpiCard
          label={t('devices.kpi.warranty_expired')}
          value={kpi.warrantyExpired}
          tone="danger"
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
          active={warrantyFilter === 'expired'}
          onClick={() => setWarrantyFilter('expired')}
        />
      </div>

      {/* SPRINT-3 #8: Quick site filter pills — 3 most common filters
          at the top, advanced filters (warranty/assignee) in KPI cards above */}
      {(visibleSites ?? []).length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-400">สาขา:</span>
          <button
            type="button"
            onClick={() => setSiteFilter('all')}
            className={`rounded-full px-2.5 py-0.5 font-medium transition-colors ${
              siteFilter === 'all'
                ? 'bg-[#f97316] text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
            }`}
          >
            ทั้งหมด
          </button>
          {(visibleSites ?? []).slice(0, 5).map((s) => (
            <button
              key={s.code}
              type="button"
              onClick={() => setSiteFilter(s.code)}
              className={`rounded-full px-2.5 py-0.5 font-medium transition-colors ${
                siteFilter === s.code
                  ? 'bg-[#f97316] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {s.code}
            </button>
          ))}
          {(visibleSites ?? []).length > 5 && (
            <Select value={siteFilter} onValueChange={setSiteFilter}>
              <SelectTrigger className="h-6 w-[140px] text-[11px]">
                <SelectValue placeholder="เพิ่มเติม..." />
              </SelectTrigger>
              <SelectContent>
                {(visibleSites ?? []).slice(5).map((s) => (
                  <SelectItem key={s.code} value={s.code} className="text-xs">
                    {s.code} — {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {/* ── Recently-viewed devices bar ──
          Shows the last 5 device IDs opened in the detail sheet, persisted
          in localStorage so they survive page reloads. Clicking opens the
          detail sheet instantly. */}
      {recentDeviceIds.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white/70 px-2.5 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900/70">
          <Clock className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-slate-500 dark:text-slate-400">{t('devices.recent.label')}</span>
          {recentDeviceIds.map((id) => {
            const dev = (devices ?? []).find((d) => d.id === id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setDetailDeviceId(id)
                  pushRecentDevice(id)
                }}
                className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700 transition-colors hover:bg-[#f97316]/10 hover:text-[#f97316] dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-[#fb923c]/10 dark:hover:text-[#fb923c]"
                title={dev ? `${dev.assetCode} — ${dev.name}` : id}
              >
                {dev ? dev.assetCode : id.slice(-6)}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => {
              setRecentDeviceIds([])
              try {
                localStorage.removeItem('itam-recent-devices')
              } catch (e) { console.error(String(e)) }
            }}
            className="ml-auto rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            aria-label={t('devices.recent.clear')}
            title={t('devices.recent.clear')}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <Card className="flex min-h-0 flex-1 flex-col border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="flex min-h-0 flex-1 flex-col p-4">
          {/* Toolbar */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id={searchInputId}
                  placeholder={t('devices.filter.search_placeholder')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={cn('pl-9', search ? 'pr-16' : 'pr-8')}
                  onKeyDown={(e) => {
                    // Enter key triggers search (already debounced but this gives immediate feedback)
                    if (e.key === 'Enter') setSearch((e.target as HTMLInputElement).value)
                  }}
                />
                <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                  {search && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch('')
                        setPage(1)
                      }}
                      className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                      title="ล้างการค้นหา"
                      aria-label="ล้างการค้นหา"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {/* Quick scan button — opens QR/barcode scanner */}
                  <button
                    type="button"
                    onClick={() => useAppStore.getState().setQrScannerOpen(true)}
                    className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-[#f97316] dark:hover:bg-slate-800"
                    title={t('devices.aria.scan_qr')}
                    aria-label={t('devices.aria.scan_qr')}
                  >
                    <ScanLine className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder={t('devices.filter.status_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('devices.filter.status_all')}</SelectItem>
                  {DEVICE_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {t(deviceStatusLabelKey(o.value))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {showSiteFilter && (
                <Select value={siteFilter} onValueChange={setSiteFilter}>
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue placeholder={t('devices.filter.site_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('devices.filter.site_all')}</SelectItem>
                    {(visibleSites ?? []).length === 0 && (
                      <SelectItem value="__none__" disabled>
                        {t('devices.empty_no_site_access')}
                      </SelectItem>
                    )}
                    {(visibleSites ?? []).map((s) => (
                      <SelectItem key={s.code} value={s.code}>
                        {s.code} — {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={warrantyFilter} onValueChange={setWarrantyFilter}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder={t('devices.filter.warranty_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {WARRANTY_FILTER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder={t('devices.filter.assignee_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNEE_FILTER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                type="button"
                onClick={() => setImportOpen(true)}
                aria-label={t('devices.aria.import_csv')}
                className="focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
              >
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">{t('devices.btn.import_csv')}</span>
              </Button>
              <Button
                variant="outline"
                onClick={() => setCustomExportOpen(true)}
                disabled={exporting}
                aria-label={exporting ? t('devices.aria.exporting') : t('devices.aria.export')}
                className="focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[#f97316]" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{exporting ? t('devices.btn.exporting') : t('devices.btn.export')}</span>
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSinglePrintDeviceId(null)
                  setStickerOpen(true)
                }}
                disabled={(devices ?? []).length === 0}
                aria-label={t('devices.aria.print_multi')}
                title={t('devices.aria.print_multi_title')}
                className="focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
              >
                <Layers className="h-4 w-4" />
                <span className="hidden sm:inline">{t('devices.btn.print_multi')}</span>
              </Button>
              <Button
                variant="outline"
                onClick={() => qc.invalidateQueries({ queryKey: ["devices"] })}
                aria-label={t('devices.aria.refresh')}
                className="focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
              >
                <RefreshCw className="h-4 w-4" />
                <span className="hidden sm:inline">{t('devices.btn.refresh')}</span>
              </Button>
              {/* Column visibility dropdown — lets the user hide columns
                  they don't need. Choice persists in localStorage. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    aria-label={t('devices.aria.columns')}
                    className="focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
                  >
                    <Columns3 className="h-4 w-4" />
                    <span className="hidden sm:inline">{t('devices.btn.columns')}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="text-xs text-slate-500 dark:text-slate-400">
                    {t('devices.columns.title')}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {ALL_COLUMNS.map((col) => (
                    <DropdownMenuCheckboxItem
                      key={col.key}
                      checked={isColVisible(col.key)}
                      onCheckedChange={() => toggleColumn(col.key)}
                      className="text-sm"
                    >
                      {t(col.labelKey)}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setHiddenColumns(new Set())
                      try {
                        localStorage.removeItem('itam-devices-hidden-cols')
                      } catch (e) { console.error(String(e)) }
                    }}
                    className="text-xs text-[#f97316] focus:text-[#f97316]"
                  >
                    {t('devices.columns.reset')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Bulk action bar — slides in when any rows are selected */}
          <AnimatePresence>
            {selectedIds.size > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="sticky top-0 z-20 -mt-2 mb-2 flex flex-col gap-3 rounded-lg border-l-4 border-[#f97316] border-y border-r border-slate-200 bg-white/90 p-3 shadow-md backdrop-blur-md dark:border-[#fb923c] dark:border-y-slate-800 dark:border-r-slate-800 dark:bg-slate-900/90 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 items-center rounded-md bg-[#f97316]/10 px-2.5 text-sm font-semibold text-[#f97316] dark:bg-[#fb923c]/10 dark:text-[#fb923c]">
                    {t('devices.bulk.selected_count').replace('{count}', String(selectedIds.size))}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearSelection}
                    className="h-7 px-2 text-xs text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  >
                    <X className="h-3.5 w-3.5" />
                    {t('devices.bulk.clear')}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Bulk status */}
                  <Select
                    value={bulkStatus}
                    onValueChange={(v) => {
                      setBulkStatus(v)
                    }}
                  >
                    <SelectTrigger className="h-8 w-[140px]">
                      <SelectValue placeholder={t('devices.bulk.change_status')} />
                    </SelectTrigger>
                    <SelectContent>
                      {DEVICE_STATUS_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {t(deviceStatusLabelKey(o.value))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!bulkStatus || bulkAction}
                    onClick={applyBulkStatus}
                    className="h-8 focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
                  >
                    {t('devices.bulk.apply')}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>

                  {/* Bulk site move */}
                  <Select
                    value={bulkSite}
                    onValueChange={(v) => {
                      setBulkSite(v)
                    }}
                  >
                    <SelectTrigger className="h-8 w-[140px]">
                      <SelectValue placeholder={t('devices.bulk.move_site')} />
                    </SelectTrigger>
                    <SelectContent>
                      {(visibleSites ?? []).map((s) => (
                        <SelectItem key={s.code} value={s.code}>
                          {s.code} — {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!bulkSite || bulkAction}
                    onClick={applyBulkTransfer}
                    className="h-8 focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
                  >
                    {t('devices.bulk.move')}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>

                  {/* Bulk delete */}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={bulkAction}
                    onClick={() => setBulkDeleteOpen(true)}
                    className="h-8 border-rose-300 text-rose-600 hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-1 dark:border-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40 dark:focus-visible:ring-offset-slate-950"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('devices.bulk.delete')}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Table */}
          {/* Table — fills remaining height of the Card. overflow-x-auto for mobile horizontal scroll. */}
          <div className="itam-scroll mt-4 min-h-0 flex-1 overflow-auto overflow-x-auto rounded-md border border-slate-300 bg-white dark:border-slate-800 dark:bg-slate-900">
            <Table className="w-full min-w-[1000px]">
              <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                <TableRow>
                  {hasDevices && isColVisible('assetCode') && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                        onCheckedChange={(v) => toggleSelectAll(v === true)}
                        aria-label={t('devices.aria.select_page_all')}
                        className="border-slate-300 data-[state=checked]:bg-[#f97316] data-[state=checked]:border-[#f97316] data-[state=checked]:text-white dark:border-slate-600 dark:data-[state=checked]:bg-[#f97316] dark:data-[state=checked]:border-[#f97316]"
                      />
                    </TableHead>
                  )}
                  {isColVisible('assetCode') && <TableHead className="text-slate-600 dark:text-slate-300">{t('devices.col.asset_code')}</TableHead>}
                  {isColVisible('assetSiteCode') && <TableHead className="text-slate-600 dark:text-slate-300">{t('devices.col.asset_site_code')}</TableHead>}
                  {isColVisible('reports.unit.type') && <TableHead className="text-slate-600 dark:text-slate-300">{t('devices.col.type')}</TableHead>}
                  {isColVisible('brandModel') && <TableHead className="text-slate-600 dark:text-slate-300">{t('devices.col.brand_model')}</TableHead>}
                  {isColVisible('serialNumber') && <TableHead className="text-slate-600 dark:text-slate-300">{t('devices.col.serial')}</TableHead>}
                  {isColVisible('location') && <TableHead className="text-slate-600 dark:text-slate-300">{t('devices.col.location')}</TableHead>}
                  {isColVisible('department') && <TableHead className="text-slate-600 dark:text-slate-300">{t('devices.col.department')}</TableHead>}
                  {isColVisible('status') && <TableHead className="text-slate-600 dark:text-slate-300">{t('devices.col.status')}</TableHead>}
                  {isColVisible('meter') && <TableHead className="text-slate-600 dark:text-slate-300">{t('devices.col.meter')}</TableHead>}
                  {isColVisible('updatedAt') && <TableHead className="text-slate-600 dark:text-slate-300">{t('devices.col.updated_at')}</TableHead>}
                  {isColVisible('actions') && <TableHead className="text-right text-slate-600 dark:text-slate-300 min-w-[290px] whitespace-nowrap">{t('devices.col.actions')}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell colSpan={12}>
                        <Skeleton className="h-6 w-full dark:bg-slate-800" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (devices ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="py-12">
                      <div className="flex flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-500">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                          <PackageOpen className="h-7 w-7 text-slate-300 dark:text-slate-400" />
                        </div>
                        <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                          {search || statusFilter !== 'all' || siteFilter !== 'all' || warrantyFilter !== 'all' || assigneeFilter !== 'all'
                            ? t('devices.empty_no_devices_match')
                            : t('devices.empty_no_devices_yet')}
                        </div>
                        <div className="text-xs text-slate-400 dark:text-slate-500">
                          {search || statusFilter !== 'all' || siteFilter !== 'all' || warrantyFilter !== 'all' || assigneeFilter !== 'all'
                            ? t('devices.empty_no_devices_hint_filter')
                            : t('devices.empty_no_devices_hint_add')}
                        </div>
                        {(search || statusFilter !== 'all' || siteFilter !== 'all' || warrantyFilter !== 'all' || assigneeFilter !== 'all') ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSearch('')
                              setStatusFilter('all')
                              setSiteFilter('all')
                              setWarrantyFilter('all')
                              setAssigneeFilter('all')
                            }}
                            className="mt-2 focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
                          >
                            {t('devices.btn.clear_filters')}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            type="button"
                onClick={openAdd}
                            className="mt-2 bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
                          >
                            <Plus className="h-4 w-4" />
                            {t('devices.add_device')}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedDevices.map((d) => {
                    const isSelected = selectedIds.has(d.id)
                    const lastMeterBw = (d as { lastMeterBw?: number }).lastMeterBw ?? 0
                    const lastMeterColor = (d as { lastMeterColor?: number }).lastMeterColor ?? 0
                    const lastReadingMonth = d.lastReadingMonth
                    const hasMeter = Boolean(lastReadingMonth) || lastMeterBw > 0
                    return (
                    <TableRow
                      key={d.id}
                      className={
                        'cursor-pointer transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/50' +
                        (isSelected
                          ? ' bg-orange-50 dark:bg-orange-950/30'
                          : '')
                      }
                      onClick={() => setDetailDeviceId(d.id)}
                    >
                      <TableCell
                        className="w-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isColVisible('assetCode') && (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(v) => toggleSelect(d.id, v === true)}
                            aria-label={t('devices.aria.select_row').replace('{code}', d.assetCode)}
                            className="border-slate-300 data-[state=checked]:bg-[#f97316] data-[state=checked]:border-[#f97316] data-[state=checked]:text-white dark:border-slate-600 dark:data-[state=checked]:bg-[#f97316] dark:data-[state=checked]:border-[#f97316]"
                          />
                        )}
                      </TableCell>
                      {/* t('devices.field.asset_code') */}
                      {isColVisible('assetCode') && (
                      <TableCell className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {d.assetCode}
                      </TableCell>
                      )}
                      {/* Site Code */}
                      {isColVisible('assetSiteCode') && (
                      <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-300">
                        {d.assetSiteCode || <span className="text-slate-300 dark:text-slate-400">—</span>}
                      </TableCell>
                      )}
                      {/* Type column. NOTE: pass the raw column key, not the
                          translated label — isColVisible() matches against the
                          persisted hidden-column set, so t('…') made this
                          column impossible to hide. */}
                      {isColVisible('reports.unit.type') && (
                      <TableCell className="text-slate-700 dark:text-slate-200">{d.type}</TableCell>
                      )}
                      {/* t('devices.field.brand_model') */}
                      {isColVisible('brandModel') && (
                      <TableCell className="max-w-[180px]">
                        <div className="text-sm text-slate-700 dark:text-slate-200 truncate" title={`${d.brand} ${d.model}`}>
                          {d.brand || '-'}
                        </div>
                        {d.model && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate" title={d.model}>
                            {d.model}
                          </div>
                        )}
                      </TableCell>
                      )}
                      {/* Serial No. */}
                      {isColVisible('serialNumber') && (
                      <TableCell className="max-w-[150px] font-mono text-xs text-slate-600 dark:text-slate-300">
                        <div className="truncate" title={d.serialNumber || undefined}>
                          {d.serialNumber || <span className="text-slate-300 dark:text-slate-400">—</span>}
                        </div>
                      </TableCell>
                      )}
                      {/* t('devices.field.building_floor') */}
                      {isColVisible('location') && (
                      <TableCell className="max-w-[140px]">
                        <div className="text-sm text-slate-700 dark:text-slate-200 truncate" title={d.building ?? ''}>
                          {d.building || '-'}
                        </div>
                        {d.floor && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {t('devices.row.floor_label').replace('{floor}', d.floor)}
                          </div>
                        )}
                      </TableCell>
                      )}
                      {/* t('devices.field.department')/t('devices.field.position') */}
                      {isColVisible('department') && (
                      <TableCell className="max-w-[160px]">
                        <div className="text-sm text-slate-700 dark:text-slate-200 truncate" title={d.department ?? ''}>
                          {d.department || '-'}
                        </div>
                        {d.location && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate" title={d.location}>
                            {d.location}
                          </div>
                        )}
                      </TableCell>
                      )}
                      {/* t('devices.field.status') */}
                      {isColVisible('status') && (
                      <TableCell className="whitespace-nowrap">
                        <Badge className={statusBadgeClass(d.status)}>
                          {t(deviceStatusLabelKey(d.status))}
                        </Badge>
                      </TableCell>
                      )}
                      {/* Last meter */}
                      {isColVisible('meter') && (
                      <TableCell className="w-auto">
                        {hasMeter ? (
                          <div>
                            <div className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                              {lastMeterBw.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                            </div>
                            {lastMeterColor > 0 && (
                              <div className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                                {t('devices.meter.color_label')} {lastMeterColor.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                              </div>
                            )}
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">
                              {lastReadingMonth ? formatMonthThai(lastReadingMonth) : '-'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400 dark:text-slate-500">
                            {t('devices.empty_no_meter_data')}
                          </span>
                        )}
                      </TableCell>
                      )}
                      {/* Last updated */}
                      {isColVisible('updatedAt') && (
                      <TableCell className="text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {fmtDateTime(d.updatedAt)}
                      </TableCell>
                      )}
                      {/* t('devices.col.actions') */}
                      {isColVisible('actions') && (
                      <TableCell
                        className="text-right min-w-[290px] whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDetailDeviceId(d.id)}
                            aria-label={t('devices.aria.history')}
                            title={t('devices.aria.history')}
                            className="h-7 gap-1 px-2 text-[11px] dark:bg-slate-800 dark:border-slate-700"
                          >
                            <History className="h-3.5 w-3.5" />
                            {t('devices.row.history')}
                          </Button>
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => openEdit(d)}
                            aria-label={t('devices.aria.edit')}
                            title={t('devices.aria.edit')}
                            className="h-7 gap-1 bg-[#f97316] px-2 text-[11px] text-white hover:bg-[#ea580c]"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            {t('devices.row.edit')}
                          </Button>
                          {/* SPRINT-3 #1: Clone Device — one-click duplicate with new assetCode */}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => cloneDevice(d)}
                            aria-label="โคลนอุปกรณ์"
                            title="โคลนอุปกรณ์ (สร้างใหม่จากข้อมูลเดิม)"
                            className="h-7 gap-1 px-2 text-[11px] dark:bg-slate-800 dark:border-slate-700"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">โคลน</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSinglePrintDeviceId(d.id)
                              setStickerOpen(true)
                            }}
                            aria-label={t('devices.aria.print_single')}
                            title={t('devices.aria.print_single')}
                            className="h-7 gap-1 px-2 text-[11px] dark:bg-slate-800 dark:border-slate-700"
                          >
                            <Printer className="h-3.5 w-3.5" />
                            {t('devices.row.sticker')}
                          </Button>
                          {/* SPRINT-3 #4: Quick Print — one-click sticker using active template (no dialog) */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              try {
                                await quickPrintSticker(d.assetCode)
                                toast.success(`พิมพ์สติ๊กเกอร์ ${d.assetCode} แล้ว`)
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : 'พิมพ์ไม่สำเร็จ')
                              }
                            }}
                            aria-label="พิมพ์ด่วน (ใช้เทมเพลตเริ่มต้น)"
                            title="พิมพ์ด่วน — ใช้เทมเพลตเริ่มต้น ไม่ต้องเปิดหน้าต่างแก้ไข"
                            className="h-7 gap-1 px-2 text-[11px] text-[#f97316] hover:bg-[#f97316]/10 dark:text-[#fb923c]"
                          >
                            <Zap className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">ด่วน</span>
                          </Button>
                          {/* Single-device delete — restored entry point for the
                              existing confirmDelete() AlertDialog (was lost in a
                              column redesign; without it users can only delete
                              via multi-select + bulk bar). */}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDeleteTarget(d)}
                            aria-label={t('devices.aria.delete')}
                            title={t('devices.aria.delete')}
                            className="h-7 gap-1 border-rose-200 px-2 text-[11px] text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/50 dark:hover:text-rose-300"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">{t('devices.row.delete')}</span>
                          </Button>
                        </div>
                      </TableCell>
                      )}
                    </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination — unified PaginationBar */}
          <PaginationBar
            page={currentPage}
            pageSize={pageSize}
            total={totalCount}
            totalPages={totalPages}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </CardContent>
      </Card>

      {/* Bulk delete confirm */}
      <AlertDialog
        open={bulkDeleteOpen}
        onOpenChange={(o) => !o && setBulkDeleteOpen(false)}
      >
        <AlertDialogContent className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-800 dark:text-slate-100">
              {t('devices.delete.bulk_title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('devices.delete.bulk_desc').split('{count}')[0]}{' '}
              <span className="font-semibold text-rose-700 dark:text-rose-400">
                {selectedIds.size} {t('devices.unit.count_suffix')}
              </span>{' '}
              {t('devices.delete.bulk_desc').split('{count}')[1]}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkAction}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                void applyBulkDelete()
              }}
              disabled={bulkAction}
              className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
            >
              {bulkAction ? t('devices.delete.deleting') : t('devices.delete.bulk_button').replace('{count}', String(selectedIds.size))}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      {/* Delete confirm */}
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-800 dark:text-slate-100">
              {t('devices.delete.single_title')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
              ต้องการลบอุปกรณ์ <span className="font-semibold text-slate-800 dark:text-slate-200">{deleteTarget?.name} ({deleteTarget?.assetCode})</span> ใช่หรือไม่? ข้อมูลทั้งหมดและประวัติมิเตอร์จะถูกลบอย่างถาวรและไม่สามารถกู้คืนได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                void confirmDelete()
              }}
              disabled={deleting}
              className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
            >
              {deleting ? t('devices.delete.deleting') : t('devices.delete.single_button')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Detail sheet */}
      <DeviceDetailSheet
        deviceId={detailDeviceId}
        onClose={() => setDetailDeviceId(null)}
        onEdit={(d) => {
          setDetailDeviceId(null)
          openEdit(d)
        }}
      />

      {/* CSV Import */}
      <CsvImportDialog open={importOpen} onOpenChange={setImportOpen} />

      {/* SPRINT-3 #1: Quick Add Device (5 fields only) */}
      <QuickAddDeviceDialog
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onCreated={async () => {
          await qc.invalidateQueries({ queryKey: ['devices'] })
        }}
        onOpenAdvanced={openAdd}
      />

      {/* Custom Export — column picker + reorder + format selector (CSV/Excel/PDF) */}
      <CustomExportDialog
        open={customExportOpen}
        onOpenChange={setCustomExportOpen}
        availableColumns={EXPORT_AVAILABLE_COLUMNS}
        onExport={handleCustomExport}
        storageKey="itam-devices-export-cols"
        defaultSelectedKeys={DEVICE_CSV_HEADERS.map((h) => h.key)}
        totalRows={totalCount}
      />

      {/* Sticker print — when singlePrintDeviceId is set, only show that device */}
      <StickerPrintDialog
        open={stickerOpen}
        onOpenChange={(open) => {
          setStickerOpen(open)
          if (!open) setSinglePrintDeviceId(null)
        }}
        devices={
          singlePrintDeviceId
            ? (devices ?? []).filter((d) => d.id === singlePrintDeviceId)
            : (devices ?? [])
        }
        orgName={settings?.orgName ?? null}
      />

      {/* Print Template Selection — lets user choose which template to use */}
      <PrintTemplateSelectionDialog
        open={printTemplateOpen}
        onOpenChange={setPrintTemplateOpen}
        templateType="sticker"
        actionLabel={t('devices.print_template.action')}
        onSelect={(template) => {
          toast.success(t('devices.toast.template_selected').replace('{name}', template.name))
          setStickerOpen(true)
        }}
        onCreateNew={() => {
          useAppStore.getState().setActivePage('templates')
        }}
      />

      {/* ── Keyboard shortcuts dialog ──
          Opened via the keyboard icon button or by pressing `?` anywhere. */}
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Keyboard className="h-5 w-5 text-[#f97316]" />
              {t('devices.shortcuts.title')}
            </DialogTitle>
            <DialogDescription>
              {t('devices.shortcuts.desc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {[
              { keys: ['Ctrl', 'K'], desc: t('devices.shortcuts.search_focus') },
              { keys: ['Ctrl', 'N'], desc: t('devices.shortcuts.add_new') },
              { keys: ['Ctrl', 'R'], desc: t('devices.shortcuts.refresh') },
              { keys: ['?'], desc: t('devices.shortcuts.open_help') },
              { keys: ['Esc'], desc: t('devices.shortcuts.close_dialog') },
              { keys: ['Enter'], desc: t('devices.shortcuts.search_enter') },
            ].map((s) => (
              <div
                key={s.desc}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
              >
                <span className="text-slate-700 dark:text-slate-300">
                  {s.desc}
                </span>
                <div className="flex items-center gap-1">
                  {s.keys.map((k) => (
                    <kbd
                      key={k}
                      className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-slate-300 bg-white px-1.5 font-mono text-xs font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                      {k}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── KpiCard ─────────────────────────────────────────────────────────
// A compact stat card used at the top of the devices page. Clickable so
// users can apply the corresponding filter instantly. `tone` controls the
// accent color (border-left + icon tint) so each metric is scannable.
type KpiTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'
function KpiCard({
  label,
  value,
  tone = 'neutral',
  icon,
  active,
  onClick,
}: {
  label: string
  value: number
  tone?: KpiTone
  icon?: React.ReactNode
  active?: boolean
  onClick?: () => void
}) {
  const { lang } = useLang()
  const toneClasses: Record<KpiTone, { ring: string; text: string; bg: string }> = {
    neutral: {
      ring: 'border-slate-200 dark:border-slate-800',
      text: 'text-slate-700 dark:text-slate-300',
      bg: 'bg-white dark:bg-slate-900',
    },
    success: {
      ring: 'border-emerald-200 dark:border-emerald-900/50',
      text: 'text-emerald-700 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    },
    warning: {
      ring: 'border-amber-200 dark:border-amber-900/50',
      text: 'text-amber-700 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-950/30',
    },
    danger: {
      ring: 'border-rose-200 dark:border-rose-900/50',
      text: 'text-rose-700 dark:text-rose-400',
      bg: 'bg-rose-50 dark:bg-rose-950/30',
    },
    info: {
      ring: 'border-sky-200 dark:border-sky-900/50',
      text: 'text-sky-700 dark:text-sky-400',
      bg: 'bg-sky-50 dark:bg-sky-950/30',
    },
  }
  const toneClass = toneClasses[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'group relative flex flex-col gap-1 rounded-lg border p-2.5 text-left transition-all',
        'hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1',
        toneClass.bg,
        toneClass.ring,
        active && 'ring-2 ring-[#f97316] ring-offset-1',
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={cn(
            'flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide',
            toneClass.text,
          )}
        >
          {icon}
          {label}
        </span>
      </div>
      <span className="text-xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
        {value.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
      </span>
    </button>
  )
}

// ── Quick Add form (Task ID: LICENSE-PAGE-PLUS-QUICK-ADD, Task B) ────────
// Simplified single-section form for bulk device entry. Shows only the
// essential fields (site, assetCode, name, type, brand, model, serial,
// status). User can fill in the rest later via Edit.
//
// The QuickAddForm shares the SAME form state as the full form (so the
// parent's `save()` works unchanged — it just sends fewer fields because
// the rest are empty strings, which the API maps to null). The auto-name
// generation effect in the parent also still fires (it only needs
// form.brand + form.model, both of which are in the Quick Add form).
//
// On mobile, all fields stack vertically (grid-cols-1). On sm+ screens
// we use a 2-column layout for the non-assetCode fields.
interface DeviceClassificationLite {
  category: string
  code: string
  label: string
  parentRef?: string | null
  deviceType?: string | null
  brand?: string | null
  model?: string | null
}

interface QuickAddFormProps {
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  visibleSites: Site[]
  deviceTypes: { id: string; name: string }[] | undefined
  brandsData: { id: string; name: string; typeId: string }[] | undefined
  deviceClassifications: DeviceClassificationLite[]
  nameManuallyEditedRef: React.MutableRefObject<boolean>
  fetchNextAssetCode: () => Promise<void>
}

function QuickAddForm({
  form,
  setForm,
  visibleSites,
  deviceTypes,
  brandsData,
  deviceClassifications,
  nameManuallyEditedRef,
  fetchNextAssetCode,
}: QuickAddFormProps) {
  const t = useT()
  return (
    <div className="space-y-4">
      {/* ── Banner explaining the mode ── */}
      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          {t('devices.quick.banner')}
        </div>
      </div>

      {/* ── Single-section form card ── */}
      <div className="rounded-lg border border-amber-200 bg-white p-4 shadow-sm dark:border-amber-900/40 dark:bg-slate-900">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
          {t('devices.quick.title')}
        </div>

        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {/* ── 'Site' ── */}
          <Field label={t('devices.field.site')} required>
            <Select
              value={form.site}
              onValueChange={(v) => {
                setForm((prev) => ({ ...prev, site: v }))
                // Auto-generate assetCode is handled by the parent's
                // openAdd() effect (calls fetchNextAssetCode on dialog
                // open). Here we just commit the site selection.
              }}
            >
              <SelectTrigger className="w-full" id="qa-site">
                <SelectValue placeholder={t('devices.placeholder.site')} />
              </SelectTrigger>
              <SelectContent>
                {visibleSites.length === 0 && (
                  <SelectItem value="__none__" disabled>
                    {t('devices.empty_no_site_access')}
                  </SelectItem>
                )}
                {visibleSites.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* ── t('devices.field.asset_code') (with auto-generate button) ── */}
          <Field label={t('devices.field.asset_code')} required>
            <div className="relative">
              <ScanLine className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                id="qa-assetCode"
                value={form.assetCode}
                onChange={(e) =>
                  setForm({ ...form, assetCode: e.target.value })
                }
                placeholder={t('devices.placeholder.asset_code')}
                className="bg-amber-50/50 pl-8 font-mono dark:bg-amber-950/10"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => void fetchNextAssetCode()}
                disabled={Boolean(form.id)}
                title={t('devices.hint.gen_next_asset_code')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-[#f97316] hover:bg-[#f97316]/10 disabled:opacity-40 dark:text-[#fb923c]"
              >
                <Sparkles className="h-3.5 w-3.5" />
              </button>
            </div>
          </Field>

          {/* ── t('devices.field.name_device') (auto from brand+model) ── */}
          <Field
            label={t('devices.field.name')}
            required
            hint={t('devices.hint.name_auto_short')}
          >
            <Input
              id="qa-name"
              value={form.name}
              onChange={(e) => {
                nameManuallyEditedRef.current = true
                setForm({ ...form, name: e.target.value })
              }}
              placeholder={t('devices.placeholder.name_quick')}
              className="bg-amber-50/50 dark:bg-amber-950/10"
            />
          </Field>

          {/* ── t('devices.field.status') (default 'active') ── */}
          <Field label={t('devices.field.status')} required>
            <Select
              value={form.status}
              onValueChange={(v) => setForm({ ...form, status: v })}
            >
              <SelectTrigger className="w-full" id="qa-status">
                <SelectValue placeholder={t('devices.placeholder.status')} />
              </SelectTrigger>
              <SelectContent>
                {DEVICE_STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(deviceStatusLabelKey(o.value))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* ── t('devices.field.type') (Type) ── */}
          <Field label={t('devices.field.type')} required>
            <Combobox
              value={form.type}
              onChange={(v) =>
                setForm({ ...form, type: v, brand: '', model: '' })
              }
              items={(deviceTypes ?? []).map((dt) => ({
                value: dt.name,
                label: dt.name,
              }))}
              placeholder={t('devices.placeholder.type')}
              emptyText={t('devices.empty_no_type')}
            />
          </Field>

          {/* ── Brand ── */}
          <Field label={t('devices.field.brand')} required>
            <Combobox
              value={form.brand}
              onChange={(v) => setForm({ ...form, brand: v, model: '' })}
              items={(brandsData ?? []).map((b) => ({
                value: b.name,
                label: b.name,
              }))}
              placeholder={t('devices.placeholder.brand')}
              emptyText={t('devices.empty_no_brand')}
            />
          </Field>

          {/* ── t('devices.field.model') (Model) — selects + auto-fills brand/type ── */}
          <Field
            label={t('devices.field.model')}
            required
            hint={t('devices.hint.model_brand_auto')}
          >
            <Combobox
              value={form.model}
              onChange={(v) => {
                const match = deviceClassifications.find(
                  (c) =>
                    (c.model ?? '').toLowerCase() === v.toLowerCase(),
                )
                if (match) {
                  setForm((prev) => ({
                    ...prev,
                    model: v,
                    brand: match.brand ?? prev.brand,
                    type: match.deviceType ?? prev.type,
                  }))
                } else {
                  setForm((prev) => ({ ...prev, model: v }))
                }
              }}
              items={Array.from(
                new Set(
                  deviceClassifications
                    .map((c) => c.model)
                    .filter((m): m is string => Boolean(m)),
                ),
              )
                .sort()
                .map((m) => ({ value: m, label: m }))}
              placeholder={t('devices.placeholder.model')}
              emptyText={t('devices.empty_no_model')}
            />
          </Field>

          {/* ── Serial Number (optional) ── */}
          <Field label={t('devices.field.serial')}>
            <div className="relative">
              <ScanLine className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                id="qa-serialNumber"
                value={form.serialNumber}
                onChange={(e) =>
                  setForm({ ...form, serialNumber: e.target.value })
                }
                placeholder={t('devices.placeholder.serial_quick')}
                className="pl-8 font-mono text-xs"
              />
            </div>
          </Field>
        </div>

        {/* ── Hint: required fields reminder ── */}
        <div className="mt-4 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          <span className="font-semibold text-[#f97316]">*</span>
          <span>{t('devices.quick.required_hint')}</span>
          <span className="font-semibold text-[#f97316]">*</span>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string
  children: React.ReactNode
  hint?: string
  /** When true, shows an orange asterisk next to the label and gives the
   *  wrapper a subtle orange left-border to make required fields scannable. */
  required?: boolean
}) {
  const t = useT()
  return (
    <div
      className={`flex flex-col gap-1.5 ${
        required ? 'border-l-2 border-[#f97316]/60 pl-2 dark:border-[#fb923c]/60' : ''
      }`}
    >
      <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
        {label}
        {required && (
          <span className="ml-0.5 font-semibold text-[#f97316] dark:text-[#fb923c]">*</span>
        )}
      </Label>
      {children}
      {hint && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400">{hint}</p>
      )}
    </div>
  )
}

/**
 * FormSection — a consistent card wrapper for each section of the full-page
 * form. Renders a numbered step badge + icon + title + subtitle, an optional
 * action button (e.g. "'Add' License"), and the children inside a padded body.
 *
 * Accent color options:
 *   amber  → 'Asset Code' / 'Meter' (amber-500)
 *   blue   → 'Install Location' (sky-500)
 *   emerald → '💻 Device Info' (emerald-500)
 *   violet → 'Purchase Date' / License (violet-500)
 *   slate  → 'Network / Other' (slate-500)
 */
function FormSection({
  step,
  icon,
  title,
  subtitle,
  accent = 'amber',
  action,
  children,
}: {
  step: number
  icon: string
  title: string
  subtitle?: string
  accent?: 'amber' | 'blue' | 'emerald' | 'violet' | 'slate'
  action?: React.ReactNode
  children: React.ReactNode
}) {
  const t = useT()
  const accentMap: Record<string, { ring: string; text: string; badge: string }> = {
    amber: {
      ring: 'border-amber-200 dark:border-amber-900/40',
      text: 'text-amber-700 dark:text-amber-400',
      badge: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400',
    },
    blue: {
      ring: 'border-sky-200 dark:border-sky-900/40',
      text: 'text-sky-700 dark:text-sky-400',
      badge: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-400',
    },
    emerald: {
      ring: 'border-emerald-200 dark:border-emerald-900/40',
      text: 'text-emerald-700 dark:text-emerald-400',
      badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400',
    },
    violet: {
      ring: 'border-violet-200 dark:border-violet-900/40',
      text: 'text-violet-700 dark:text-violet-400',
      badge: 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-400',
    },
    slate: {
      ring: 'border-slate-200 dark:border-slate-800',
      text: 'text-slate-700 dark:text-slate-300',
      badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    },
  }
  const a = accentMap[accent] ?? accentMap.amber
  return (
    <section className={`mb-5 overflow-hidden rounded-lg border bg-white shadow-sm dark:bg-slate-900 ${a.ring}`}>
      <header className={`flex items-start justify-between gap-3 border-b px-4 py-3 dark:border-slate-800 ${a.ring}`}>
        <div className="flex items-start gap-3">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${a.badge}`}
          >
            {step}
          </span>
          <div>
            <h3 className={`flex items-center gap-1.5 text-sm font-semibold ${a.text}`}>
              <span className="text-base">{icon}</span>
              {title}
            </h3>
            {subtitle && (
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

// A combobox-like input: lets the user either type or pick from a dropdown list
function SelectValueInput({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
}) {
  const [open, setOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
      />
      {open && options.length > 0 && (
        <div className="itam-scroll absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-white shadow-lg">
          {options.map((o) => (
            <button
              key={o.value}
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100"
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(o.value)
                setOpen(false)
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// (no extra exports)

// ============================================================
// DeviceParentCombobox — searches devices by assetCode/name/serial
// and lets the user pick a parent device for Device Set.
// ============================================================
function DeviceParentCombobox({
  value,
  onChange,
  excludeId,
  authHeaders,
}: {
  value: string
  onChange: (id: string) => void
  excludeId?: string
  authHeaders: () => Record<string, string>
}) {
  const t = useT()
  const [search, setSearch] = React.useState('')
  const [open, setOpen] = React.useState(false)

  const { data: results } = useQuery<Device[]>({
    queryKey: ['device-parent-search', search],
    queryFn: async () => {
      const params = new URLSearchParams({
        search,
        limit: '20',
        page: '1',
      })
      const res = await fetch(`/api/devices?${params}`, { headers: authHeaders() })
      if (!res.ok) return []
      const json = await res.json()
      return (json.devices as Device[]) ?? []
    },
    enabled: open && search.trim().length > 0,
    staleTime: 10_000,
  })

  const selectedDevice = results?.find((d) => d.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className="w-full justify-between"
        >
          {selectedDevice ? (
            <span className="truncate">
              <span className="font-mono font-semibold text-[#f97316]">{selectedDevice.assetCode}</span>
              {' — '}
              <span className="text-slate-600 dark:text-slate-300">{selectedDevice.name}</span>
            </span>
          ) : value ? (
            <span className="text-xs text-slate-400">{t('devices.parent.code_label').replace('{value}', value)}</span>
          ) : (
            <span className="text-slate-400">{t('devices.parent.search_placeholder')}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command>
          <CommandInput
            placeholder={t('devices.parent.command_placeholder')}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{t('devices.parent.command_empty')}</CommandEmpty>
            <CommandGroup>
              {(results ?? []).filter((d) => d.id !== excludeId).map((d) => (
                <CommandItem
                  key={d.id}
                  value={`${d.assetCode} ${d.name} ${d.serialNumber ?? ''}`}
                  onSelect={() => {
                    onChange(d.id)
                    setOpen(false)
                  }}
                >
                  <div className="flex flex-col">
                    <span>
                      <span className="font-mono font-semibold text-[#f97316]">{d.assetCode}</span>
                      {' — '}
                      {d.name}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {d.type} · {d.brand} {d.model} · Serial: {d.serialNumber ?? '—'} · {d.site ?? '—'}
                    </span>
                  </div>
                  {d.id === value && <Check className="ml-auto h-4 w-4" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ============================================================
// ParentDeviceInfo — fetches and displays parent device details
// (type, serial, brand, model) when a parent is selected.
// ============================================================
function ParentDeviceInfo({
  deviceId,
  authHeaders,
}: {
  deviceId: string
  authHeaders: () => Record<string, string>
}) {
  const t = useT()
  const { data: device, isLoading } = useQuery<Device>({
    queryKey: ['device-detail', deviceId],
    queryFn: async () => {
      const res = await fetch(`/api/devices/${deviceId}`, { headers: authHeaders() })
      if (!res.ok) throw new Error('Failed to load device')
      const json = await res.json()
      return json.device as Device
    },
    staleTime: 30_000,
  })

  if (isLoading) return <span className="text-slate-400">{t('devices.parent.loading')}</span>
  if (!device) return <span className="text-rose-500">{t('devices.parent.not_found')}</span>

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="font-mono font-semibold text-teal-700 dark:text-teal-300">{device.assetCode}</span>
        <span className="font-medium text-slate-700 dark:text-slate-200">{device.name}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
        <div>{t('devices.parent.field.type')} <span className="font-medium text-slate-600 dark:text-slate-300">{device.type}</span></div>
        <div>Serial: <span className="font-mono text-slate-600 dark:text-slate-300">{device.serialNumber ?? '—'}</span></div>
        <div>{t('devices.parent.field.brand')} <span className="text-slate-600 dark:text-slate-300">{device.brand ?? '—'}</span></div>
        <div>{t('devices.parent.field.model')} <span className="text-slate-600 dark:text-slate-300">{device.model ?? '—'}</span></div>
        <div>{t('devices.parent.field.site')} <span className="text-slate-600 dark:text-slate-300">{device.site ?? '—'}</span></div>
        <div>{t('devices.parent.field.status')} <span className="text-slate-600 dark:text-slate-300">{device.status}</span></div>
      </div>
    </div>
  )
}
