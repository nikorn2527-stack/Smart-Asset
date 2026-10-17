'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { VisibleResponsiveContainer } from '@/components/itam/visible-responsive-container'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Pencil,
  X,
  Gauge,
  Inbox,
  ArrowLeftRight,
  ArrowRight,
  Loader2,
  MapPin,
  ShieldAlert,
  User,
  RefreshCw,
  UserPlus,
  Undo2,
  ClipboardList,
  KeyRound,
  Plus,
  Trash2,
  Settings2,
  Eye,
  EyeOff,
  Building2,
  Layers,
  ScanLine,
  CheckCircle2,
  AlertCircle,
  PackageCheck,
  PackagePlus,
} from 'lucide-react'
import type { Device, MeterReading, DeviceTransfer, Site, Assignment, LicenseRecord } from './types'
import { useAuthStore } from '@/store/auth-store'
import { useLang, getCurrentLang, localeFor } from '@/store/i18n-store'
import {
  statusBadgeClass,
  statusLabel,
  computeWarranty,
  warrantyBadgeClass,
  warrantyLabel,
  formatThaiDate,
  formatBaht,
  formatMonthThai,
} from './types'
import {
  CascadingDropdown,
  type CascadingValue,
} from './cascading-dropdown'
import { useAppStore } from '@/store/app-store'
import { parseAssetNo } from '@/lib/asset-qr'
import { DeviceAccessoriesSection } from './device-accessories-section'
import {
  DeviceSetChildrenSection,
  DeviceSetParentBanner,
} from './device-set-children-section'
import { ReplaceDeviceDialog } from './replace-device-dialog'
import { CustomFieldRenderer } from './custom-field-renderer'
import { bearerHeaders } from '@/lib/http-headers'

interface Props {
  deviceId: string | null
  onClose: () => void
  onEdit?: (device: Device) => void
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="break-words text-sm font-medium text-slate-800 dark:text-slate-100">
        {value === null || value === undefined || value === '' ? (
          <span className="text-slate-400 dark:text-slate-400">—</span>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

function formatThaiDateTime(iso: string): string {
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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Mask a license key, keeping the last 4 chars visible. */
function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 4) return '••••'
  return '•'.repeat(Math.min(key.length - 4, 16)) + key.slice(-4)
}

/** Days from today until an ISO date (negative if past). Returns null on invalid. */
function daysUntil(iso: string): number | null {
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

/** Color tone (border + text) for each lifecycle action button. */
function actionToneClass(id: string): { border: string; text: string } {
  switch (id) {
    case 'transfer':
      return {
        border: 'border-slate-200 hover:border-[#f97316]/50 dark:border-slate-700 dark:hover:border-[#f97316]/60',
        text: 'text-slate-700 dark:text-slate-200',
      }
    case 'send_repair':
      return {
        border: 'border-amber-200 hover:border-amber-400 dark:border-amber-800/60 dark:hover:border-amber-600',
        text: 'text-amber-700 dark:text-amber-300',
      }
    case 'receive_repair':
    case 'mark_ready':
      return {
        border: 'border-emerald-200 hover:border-emerald-400 dark:border-emerald-800/60 dark:hover:border-emerald-600',
        text: 'text-emerald-700 dark:text-emerald-300',
      }
    case 'uninstall':
      return {
        border: 'border-slate-300 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-500',
        text: 'text-slate-700 dark:text-slate-200',
      }
    case 'dispose':
      return {
        border: 'border-rose-200 hover:border-rose-400 dark:border-rose-800/60 dark:hover:border-rose-600',
        text: 'text-rose-700 dark:text-rose-300',
      }
    case 'reinstall':
      return {
        border: 'border-teal-200 hover:border-teal-400 dark:border-teal-800/60 dark:hover:border-teal-600',
        text: 'text-teal-700 dark:text-teal-300',
      }
    case 'return_device':
      return {
        border: 'border-purple-200 hover:border-purple-400 dark:border-purple-800/60 dark:hover:border-purple-600',
        text: 'text-purple-700 dark:text-purple-300',
      }
    case 'other_status':
      return {
        border: 'border-slate-200 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-500',
        text: 'text-slate-700 dark:text-slate-200',
      }
    default:
      return {
        border: 'border-slate-200 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-500',
        text: 'text-slate-700 dark:text-slate-200',
      }
  }
}

// ── DeviceSetChildrenSection ───────────────────────────────────────────
// Component สำหรับแสดง "อุปกรณ์ในชุด" (children ของ device ปัจจุบัน) และ
// "อุปกรณ์นี้อยู่ในชุดของ: …" banner (parent info) ถูกย้ายไปอยู่ในไฟล์แยก:
//   src/components/itm/device-set-children-section.tsx
// เพื่อให้ reuse ได้ในหลายจุด (เช่น mobile sheet, future device-set page)
// และลดขนาดของ device-detail-sheet.tsx
//
// การ render จริงอยู่ที่บรรทัด ~2240 (DeviceSetChildrenSection) และ ~1432 (banner)

export function DeviceDetailSheet({ deviceId, onClose, onEdit }: Props) {
  const open = Boolean(deviceId)
  const { lang } = useLang()
  const qc = useQueryClient()
  const { theme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const isDark = mounted && theme === 'dark'
  const gridStroke = isDark ? '#334155' : '#e2e8f0'
  const tooltipBorder = isDark ? '#334155' : '#e2e8f0'
  const tooltipBg = isDark ? '#0f172a' : '#ffffff'
  const tooltipFg = isDark ? '#e2e8f0' : '#1e293b'

  // Transfer dialog state
  const [transferOpen, setTransferOpen] = React.useState(false)
  const [tSite, setTSite] = React.useState('')
  const [tDept, setTDept] = React.useState('')
  const [tDeptCode, setTDeptCode] = React.useState('')
  const [tReason, setTReason] = React.useState('')
  const [tDate, setTDate] = React.useState(todayISO())
  const [transferring, setTransferring] = React.useState(false)
  // SPRINT-3 #3: wizard step state (1=จดมิเตอร์, 2=เลือกที่ใหม่, 3=ยืนยัน)
  const [transferStep, setTransferStep] = React.useState(1)
  const [tMeterBw, setTMeterBw] = React.useState('')
  const [tMeterColor, setTMeterColor] = React.useState('')

  // Assign dialog state
  const [assignOpen, setAssignOpen] = React.useState(false)
  const [aAssignee, setAAssignee] = React.useState('')
  const [aRole, setARole] = React.useState('')
  const [aDept, setADept] = React.useState('')
  const [aCheckout, setACheckout] = React.useState(todayISO())
  const [aExpectedReturn, setAExpectedReturn] = React.useState('')
  const [aNotes, setANotes] = React.useState('')
  const [assigning, setAssigning] = React.useState(false)

  // Return dialog state
  const [returnOpen, setReturnOpen] = React.useState(false)
  const [rReturnDate, setRReturnDate] = React.useState(todayISO())
  const [rNotes, setRNotes] = React.useState('')
  const [returning, setReturning] = React.useState(false)

  // License dialog state
  const [licenseOpen, setLicenseOpen] = React.useState(false)
  const [editingLicenseId, setEditingLicenseId] = React.useState<string | null>(
    null,
  )
  const [lcSoftware, setLcSoftware] = React.useState('')
  const [lcLicenseId, setLcLicenseId] = React.useState('')
  const [lcLicenseType, setLcLicenseType] = React.useState('')
  const [lcLicenseKey, setLcLicenseKey] = React.useState('')
  const [lcQuantity, setLcQuantity] = React.useState('1')
  const [lcExpiryDate, setLcExpiryDate] = React.useState('')
  const [lcRemark, setLcRemark] = React.useState('')
  const [savingLicense, setSavingLicense] = React.useState(false)
  const [deletingLicenseId, setDeletingLicenseId] = React.useState<string | null>(
    null,
  )
  // Track which license keys are revealed
  const [revealedLicenseKeys, setRevealedLicenseKeys] = React.useState<
    Record<string, boolean>
  >({})

  // ── Quick Edit (cascading master data + location) dialog state ──
  // Lets the user update Type/Brand/Model + Building/Floor/Department/Location
  // without opening the full edit form. Saves both new FK fields AND the
  // legacy String fields (backward compatible).
  const [quickEditOpen, setQuickEditOpen] = React.useState(false)
  const [cascadeVal, setCascadeVal] = React.useState<CascadingValue>({})
  const [quickSaving, setQuickSaving] = React.useState(false)

  // Lifecycle action dialog state
  const [actionOpen, setActionOpen] = React.useState(false)
  const [actionId, setActionId] = React.useState<string>('')
  // Location fields (for transfer / reinstall)
  const [actSite, setActSite] = React.useState('')
  const [actDept, setActDept] = React.useState('')
  const [actDeptCode, setActDeptCode] = React.useState('')
  const [actBuilding, setActBuilding] = React.useState('')
  const [actFloor, setActFloor] = React.useState('')
  const [actLocation, setActLocation] = React.useState('')
  // Meter reading (if meterable)
  const [actMeterBw, setActMeterBw] = React.useState('')
  const [actMeterColor, setActMeterColor] = React.useState('')
  const [actMeterSkipAcknowledged, setActMeterSkipAcknowledged] = React.useState(false)
  // P1-2 (LIFECYCLE-METER): dedicated "skip meter reason" textarea, shown only
  // when the user checks "มิเตอร์นับต่อเนื่อง". Separates the audit "why I skipped
  // the meter" from the lifecycle "why I'm moving/disposing this device".
  const [actSkipMeterReason, setActSkipMeterReason] = React.useState('')
  // Q4: when the operator can't read the device, these carry the number to close
  // the month with. Empty = carry forward the device's last known value.
  const [actEstimatedBw, setActEstimatedBw] = React.useState('')
  const [actEstimatedColor, setActEstimatedColor] = React.useState('')
  const [actCustomStatus, setActCustomStatus] = React.useState('')
  // Common: reason / remark
  const [actReason, setActReason] = React.useState('')
  const [actionDate, setActionDate] = React.useState(todayISO())
  const [actioning, setActioning] = React.useState(false)

  // ── Which meter month will this action close? ──────────────────────
  // The lifecycle/transfer dialog writes its MeterReading with `actionDate`,
  // so the reading's month IS the action date's month. Surfacing it here is
  // what lets staff close a month from the move screen instead of hunting for
  // the device again on the meter screen — a moved device is automatically
  // treated as "read" for that month (the unread list keys off readingMonth
  // only, not readingType).
  const [actionMonth, setActionMonth] = React.useState(() => todayISO().slice(0, 7))
  const closingMonthLabel = React.useMemo(
    () => (/^\d{4}-\d{2}$/.test(actionMonth) ? formatMonthThai(actionMonth) : ''),
    [actionMonth],
  )

  // Keep the derived month in step with the date field (the field stays a plain
  // YYYY-MM-DD input; picking any day inside a month closes that month).
  const onActionDateChange = React.useCallback((value: string) => {
    setActionDate(value)
    const month = String(value ?? '').slice(0, 7)
    if (/^\d{4}-\d{2}$/.test(month)) setActionMonth(month)
  }, [])

  // ── Replace-on-Withdraw state ──
  // When the user picks "เครื่องทดแทน" they can either:
  //   • 'existing' — scan/find a registered device by assetCode/serial
  //   • 'new'      — create a brand new device record (auto-install)
  // `actReplacementEnabled` toggles the whole section. When enabled, the
  // confirmAction() flow calls /replace-on-withdraw instead of /lifecycle.
  const [actReplacementEnabled, setActReplacementEnabled] = React.useState(false)
  const [actReplacementMode, setActReplacementMode] = React.useState<'existing' | 'new'>('existing')
  const [actReplacementAssetCode, setActReplacementAssetCode] = React.useState('')
  const [actReplacementSerial, setActReplacementSerial] = React.useState('')
  const [actReplacementName, setActReplacementName] = React.useState('')
  const [actReplacementBrand, setActReplacementBrand] = React.useState('')
  const [actReplacementModel, setActReplacementModel] = React.useState('')
  const [actReplacementType, setActReplacementType] = React.useState('')
  const [actReplacementLookup, setActReplacementLookup] = React.useState<
    | { state: 'idle' }
    | { state: 'searching' }
    | { state: 'found'; device: { id: string; assetCode: string; name: string; brand?: string | null; model?: string | null; status: string; site: string } }
    | { state: 'not-found' }
    | { state: 'error'; message: string }
  >({ state: 'idle' })

  const LICENSE_TYPE_OPTIONS = [
    { value: 'OEM', label: 'OEM' },
    { value: 'Volume', label: 'Volume' },
    { value: 'Retail', label: 'Retail' },
    { value: 'Subscription', label: 'Subscription' },
    { value: 'Open License', label: 'Open License' },
  ]

  // ── "เปลี่ยนเครื่องหลัก" dialog state ──
  const [replaceOpen, setReplaceOpen] = React.useState(false)

  // Available status options for "other status" select
  const STATUS_OPTIONS_FOR_ACTION = [
    { value: 'Active', label: 'Active — ใช้งานอยู่' },
    { value: 'In Stock', label: 'In Stock — ในสต็อก' },
    { value: 'In Repair', label: 'In Repair — ส่งซ่อม' },
    { value: 'Inactive', label: 'Inactive — ถอนการติดตั้ง' },
    { value: 'Retired', label: 'Retired — ปลดระวาง' },
    { value: 'Returned', label: 'Returned — คืนแล้ว' },
    { value: 'Disposed', label: 'Disposed — จำหน่ายแล้ว' },
    { value: 'Spare', label: 'Spare — สำรอง' },
  ]

  /** Build the lifecycle action list based on the device's current status. */
  function buildDeviceActions(statusRaw: string, isMeterable: boolean) {
    const status = String(statusRaw || '').toLowerCase()
    const list = [
      {
        id: 'transfer',
        icon: '🔄',
        label: 'ย้ายตำแหน่ง',
        desc: 'ย้ายไปแผนก/Site/ตำแหน่งอื่น',
        show: true,
        needLoc: true,
        needMeter: true,
        targetStatus: null,
      },
      {
        id: 'send_repair',
        icon: '🔧',
        label: 'ส่งซ่อม',
        desc: 'เปลี่ยนสถานะ → In Repair',
        show:
          status !== 'in repair' &&
          !['retired', 'returned', 'disposed', 'inactive'].includes(status),
        needMeter: isMeterable,
        targetStatus: 'In Repair',
      },
      {
        id: 'receive_repair',
        icon: '✅',
        label: 'รับซ่อมกลับ',
        desc: 'In Repair → Active',
        show: status === 'in repair',
        needMeter: isMeterable,
        targetStatus: 'Active',
        isReinstall: true,
      },
      {
        id: 'uninstall',
        icon: '📦',
        label: 'ถอนการติดตั้ง',
        desc: 'เอาออกมา ยังไม่ตัดสิน',
        show: ['active', 'in repair'].includes(status),
        needMeter: isMeterable,
        targetStatus: 'Inactive',
      },
      {
        id: 'mark_ready',
        icon: '✅',
        label: 'เครื่องพร้อมใช้',
        desc: 'Inactive → In Stock',
        show: status === 'inactive',
        needMeter: false,
        targetStatus: 'In Stock',
      },
      {
        id: 'dispose',
        icon: '🗑️',
        label: 'จำหน่าย',
        desc: 'ปิดงานจริง — ขาย/ทิ้ง/เลิกใช้',
        show: ['active', 'in repair', 'inactive'].includes(status),
        needMeter: isMeterable,
        targetStatus: 'Disposed',
      },
      {
        id: 'reinstall',
        icon: '♻️',
        label: 'ติดตั้งใหม่',
        desc: 'นำเครื่องกลับมาใช้',
        show: ['disposed', 'returned', 'inactive', 'in stock', 'retired'].includes(
          status,
        ),
        needLoc: true,
        needMeter: isMeterable,
        targetStatus: 'Active',
        isReinstall: true,
      },
      {
        id: 'return_device',
        icon: '🔙',
        label: 'คืนเครื่อง',
        desc: 'คืนเครื่องให้เจ้าของ/ผู้ขาย',
        show: ['active', 'in repair', 'inactive'].includes(status),
        needMeter: isMeterable,
        targetStatus: 'Returned',
      },
      {
        id: 'other_status',
        icon: '⚙️',
        label: 'เปลี่ยนสถานะอื่น',
        desc: 'เลือกสถานะเอง',
        show: true,
        needStatusSelect: true,
        targetStatus: null,
      },
    ]
    return list.filter((a) => a.show)
  }

  const { data: deviceData, isLoading: deviceLoading } = useQuery<{
    device: Device
  } | null>({
    queryKey: ['device-detail', deviceId],
    queryFn: async () => {
      if (!deviceId) return null
      const res = await fetch(`/api/devices/${deviceId}`, {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) return null
      const json = await res.json()
      return { device: json.device as Device }
    },
    enabled: Boolean(deviceId),
  })

  const { data: readings, isLoading: readingsLoading } = useQuery<
    MeterReading[]
  >({
    queryKey: ['device-meter', deviceId],
    queryFn: async () => {
      if (!deviceId) return []
      const res = await fetch(`/api/meter?deviceId=${deviceId}`, {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) return []
      const json = await res.json()
      return (json.readings ?? []) as MeterReading[]
    },
    enabled: Boolean(deviceId),
  })

  const { data: transfers, isLoading: transfersLoading } = useQuery<
    DeviceTransfer[]
  >({
    queryKey: ['device-transfers', deviceId],
    queryFn: async () => {
      if (!deviceId) return []
      const res = await fetch(`/api/devices/${deviceId}/transfer`, {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) return []
      const json = await res.json()
      return (json.transfers ?? []) as DeviceTransfer[]
    },
    enabled: Boolean(deviceId),
  })

  const { data: assignments, isLoading: assignmentsLoading } = useQuery<
    Assignment[]
  >({
    queryKey: ['device-assignments', deviceId],
    queryFn: async () => {
      if (!deviceId) return []
      const res = await fetch(`/api/devices/${deviceId}/assign`, {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) return []
      const json = await res.json()
      return (json.assignments ?? []) as Assignment[]
    },
    enabled: Boolean(deviceId),
  })

  const { data: licenses, isLoading: licensesLoading } = useQuery<
    LicenseRecord[]
  >({
    queryKey: ['device-licenses', deviceId],
    queryFn: async () => {
      if (!deviceId) return []
      const res = await fetch(`/api/devices/${deviceId}/licenses`, {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) return []
      const json = await res.json()
      return (json.licenses ?? []) as LicenseRecord[]
    },
    enabled: Boolean(deviceId),
  })

  // Note: the "child devices" + "parent device" useQuery hooks are declared
  // AFTER `const device = deviceData?.device` (further down) because they
  // depend on the loaded device row (parentDeviceId, etc). See around line 1097.

  function openLicenseDialog(existing?: LicenseRecord) {
    if (existing) {
      setEditingLicenseId(existing.id)
      setLcSoftware(existing.software || '')
      setLcLicenseId(existing.licenseId || '')
      setLcLicenseType(existing.licenseType || '')
      setLcLicenseKey(existing.licenseKey || '')
      setLcQuantity(String(existing.quantity ?? 1))
      setLcExpiryDate(existing.expiryDate || '')
      setLcRemark(existing.remark || '')
    } else {
      setEditingLicenseId(null)
      setLcSoftware('')
      setLcLicenseId('')
      setLcLicenseType('')
      setLcLicenseKey('')
      setLcQuantity('1')
      setLcExpiryDate('')
      setLcRemark('')
    }
    setLicenseOpen(true)
  }

  async function saveLicense() {
    if (!deviceId) return
    if (!lcSoftware.trim()) {
      toast.error('กรุณากรอกชื่อซอฟต์แวร์')
      return
    }
    try {
      setSavingLicense(true)
      const payload = {
        licenseId: lcLicenseId || null,
        software: lcSoftware.trim(),
        licenseType: lcLicenseType || null,
        licenseKey: lcLicenseKey || null,
        quantity: Number(lcQuantity) || 1,
        expiryDate: lcExpiryDate || null,
        remark: lcRemark || null,
      }
      const isEditing = !!editingLicenseId
      const url = isEditing
        ? `/api/devices/${deviceId}/licenses?licenseId=${encodeURIComponent(editingLicenseId!)}`
        : `/api/devices/${deviceId}/licenses`
      const res = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Save failed')
      }
      toast.success(isEditing ? 'อัปเดต License แล้ว' : 'เพิ่ม License แล้ว')
      setLicenseOpen(false)
      setEditingLicenseId(null)
      await qc.invalidateQueries({ queryKey: ['device-licenses', deviceId] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingLicense(false)
    }
  }

  async function deleteLicense(id: string) {
    if (!deviceId) return
    try {
      setDeletingLicenseId(id)
      const res = await fetch(
        `/api/devices/${deviceId}/licenses?licenseId=${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
          headers: bearerHeaders(useAuthStore.getState()?.token),
        },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Delete failed')
      }
      toast.success('ลบ License แล้ว')
      await qc.invalidateQueries({ queryKey: ['device-licenses', deviceId] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeletingLicenseId(null)
    }
  }

  // ── Lifecycle action handlers ─────────────────────────────────────
  function openActionDialog(id: string) {
    if (!device) return
    setActionId(id)
    setActSite(device.site || '')
    setActDept(device.department || '')
    setActDeptCode(device.departmentCode || '')
    setActBuilding(device.building || '')
    setActFloor(device.floor || '')
    setActLocation(device.location || '')
    setActMeterBw('')
    setActMeterColor('')
    setActMeterSkipAcknowledged(false)
    setActSkipMeterReason('')
    setActEstimatedBw('')
    setActEstimatedColor('')
    setActCustomStatus('')
    setActReason('')
    setActionDate(todayISO())
    setActionMonth(todayISO().slice(0, 7))
    // Reset replacement state — only enabled for withdraw-type actions
    setActReplacementEnabled(false)
    setActReplacementMode('existing')
    setActReplacementAssetCode('')
    setActReplacementSerial('')
    setActReplacementName('')
    setActReplacementBrand(device.brand || '')
    setActReplacementModel(device.model || '')
    setActReplacementType(device.type || '')
    setActReplacementLookup({ state: 'idle' })
    setActionOpen(true)
  }

  // ── Lookup a replacement device by assetCode/serial (debounced) ──
  // Fires when `actReplacementAssetCode` changes in 'existing' mode. Sets
  // lookup state to 'found' / 'not-found' / 'error' so the UI can show
  // inline feedback.
  React.useEffect(() => {
    if (!actReplacementEnabled || actReplacementMode !== 'existing') {
      setActReplacementLookup({ state: 'idle' })
      return
    }
    const q = actReplacementAssetCode.trim()
    if (!q) {
      setActReplacementLookup({ state: 'idle' })
      return
    }
    let cancelled = false
    setActReplacementLookup({ state: 'searching' })
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ search: q, limit: '5' })
        const res = await fetch(`/api/devices?${params.toString()}`, {
          headers: bearerHeaders(useAuthStore.getState()?.token),
        })
        if (!res.ok) {
          if (!cancelled) setActReplacementLookup({ state: 'error', message: 'HTTP ' + res.status })
          return
        }
        const json = (await res.json()) as { devices?: Array<{ id: string; assetCode: string; name: string; brand?: string | null; model?: string | null; status: string; site: string; serialNumber?: string | null }> }
        const list = json.devices ?? []
        // Match: exact assetCode OR exact serialNumber OR startsWith assetCode
        const match = list.find(
          (d) => d.assetCode === q
            || d.serialNumber === q
            || d.assetCode.startsWith(q),
        )
        if (cancelled) return
        if (match) {
          setActReplacementLookup({
            state: 'found',
            device: {
              id: match.id,
              assetCode: match.assetCode,
              name: match.name,
              brand: match.brand,
              model: match.model,
              status: match.status,
              site: match.site,
            },
          })
        } else {
          setActReplacementLookup({ state: 'not-found' })
        }
      } catch (e) {
        if (!cancelled) {
          setActReplacementLookup({ state: 'error', message: e instanceof Error ? e.message : 'lookup failed' })
        }
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [actReplacementEnabled, actReplacementMode, actReplacementAssetCode])

  // Subscribe to global QR scanner results when the replacement section is
  // open — so a technician can scan a QR/barcode to fill the asset code.
  const qrScanNonce = useAppStore((s) => s.qrScanNonce)
  const lastQrScan = useAppStore((s) => s.lastQrScan)
  React.useEffect(() => {
    if (qrScanNonce === 0) return
    if (!actReplacementEnabled) return
    if (!actionOpen) return
    if (!lastQrScan) return
    const parsed = parseAssetNo(lastQrScan)
    if (parsed) {
      setActReplacementAssetCode(parsed)
    } else {
      setActReplacementAssetCode(lastQrScan)
    }
  }, [qrScanNonce, actReplacementEnabled, actionOpen, lastQrScan])

  /** Find the action config by id (from the full list, ignoring show filter). */
  function findActionConfig(id: string) {
    const all = buildDeviceActions('__all__', true).concat(
      // ensure we can also resolve actions that would normally be hidden
      // by re-running with a synthetic status that matches each action's
      // visibility. Simpler: build a static map.
      [] as ReturnType<typeof buildDeviceActions>,
    )
    const found = all.find((a) => a.id === id)
    if (found) return found
    // Fallback static map
    // P0-1 FIX (LIFECYCLE-METER): previously only `transfer` had `needMeter: true`,
    // which meant the meter-reading input + skip checkbox were NOT rendered for
    // send_repair / uninstall / dispose / return_device / receive_repair / reinstall
    // — even though the server enforces METER_REQUIRED for all of them (via
    // METERED_LIFECYCLE_ACTIONS in lifecycle/route.ts). This made the gate
    // unsatisfiable through the UI.
    //
    // Now every meterable lifecycle action sets needMeter: true. The actual
    // rendering condition (`cfg.needMeter && device?.meterRequired`) still gates
    // on the device being meterable, so non-metered devices skip the prompt.
    // (deviceIsMeterable is hoisted to component scope — see definition above.)
    const map: Record<
      string,
      {
        id: string
        icon: string
        label: string
        desc: string
        targetStatus: string | null
        needLoc?: boolean
        needMeter?: boolean
        needStatusSelect?: boolean
        isReinstall?: boolean
      }
    > = {
      transfer: { id: 'transfer', icon: '🔄', label: 'ย้ายตำแหน่ง', desc: 'ย้ายไปแผนก/Site/ตำแหน่งอื่น', targetStatus: null, needLoc: true, needMeter: true },
      send_repair: { id: 'send_repair', icon: '🔧', label: 'ส่งซ่อม', desc: 'เปลี่ยนสถานะ → In Repair', targetStatus: 'In Repair', needMeter: deviceIsMeterable },
      receive_repair: { id: 'receive_repair', icon: '✅', label: 'รับซ่อมกลับ', desc: 'In Repair → Active', targetStatus: 'Active', isReinstall: true, needMeter: deviceIsMeterable },
      uninstall: { id: 'uninstall', icon: '📦', label: 'ถอนการติดตั้ง', desc: 'เอาออกมา ยังไม่ตัดสิน', targetStatus: 'Inactive', needMeter: deviceIsMeterable },
      mark_ready: { id: 'mark_ready', icon: '✅', label: 'เครื่องพร้อมใช้', desc: 'Inactive → In Stock', targetStatus: 'In Stock' },
      dispose: { id: 'dispose', icon: '🗑️', label: 'จำหน่าย', desc: 'ปิดงานจริง — ขาย/ทิ้ง/เลิกใช้', targetStatus: 'Disposed', needMeter: deviceIsMeterable },
      reinstall: { id: 'reinstall', icon: '♻️', label: 'ติดตั้งใหม่', desc: 'นำเครื่องกลับมาใช้', targetStatus: 'Active', needLoc: true, isReinstall: true, needMeter: deviceIsMeterable },
      return_device: { id: 'return_device', icon: '🔙', label: 'คืนเครื่อง', desc: 'คืนเครื่องให้เจ้าของ/ผู้ขาย', targetStatus: 'Returned', needMeter: deviceIsMeterable },
      other_status: { id: 'other_status', icon: '⚙️', label: 'เปลี่ยนสถานะอื่น', desc: 'เลือกสถานะเอง', targetStatus: null, needStatusSelect: true },
    }
    return map[id]
  }

  async function confirmAction() {
    if (!device || !deviceId) return
    const cfg = findActionConfig(actionId)
    if (!cfg) {
      toast.error('ไม่พบการกระทำที่เลือก')
      return
    }
    const newStatus = cfg.needStatusSelect && actCustomStatus
      ? actCustomStatus
      : cfg.targetStatus
    const meterRequired = Boolean(cfg.needMeter && device.meterRequired)
    const hasMeterValue = actMeterBw.trim() !== ''
    if (cfg.needLoc && !actSite.trim()) {
      toast.error('กรุณาเลือกสาขาปลายทาง')
      return
    }
    if (cfg.needStatusSelect && !actCustomStatus) {
      toast.error('กรุณาเลือกสถานะใหม่')
      return
    }
    if (meterRequired && !hasMeterValue && !actMeterSkipAcknowledged) {
      toast.error('กรุณาจดมิเตอร์ หรือยืนยันว่ามิเตอร์นับต่อเนื่อง')
      return
    }
    if (
      meterRequired &&
      hasMeterValue &&
      Number(actMeterBw) < (device.lastMeterReading ?? 0) &&
      !actReason.trim()
    ) {
      toast.error('ค่ามิเตอร์ใหม่น้อยกว่าค่าเดิม กรุณาระบุหมายเหตุ (RESET)')
      return
    }

    // ── Replacement-specific validation ──
    // Only enabled for withdraw-type actions (send_repair / uninstall / dispose / return_device)
    const isWithdrawAction =
      actionId === 'send_repair'
      || actionId === 'uninstall'
      || actionId === 'dispose'
      || actionId === 'return_device'
    if (actReplacementEnabled) {
      if (!isWithdrawAction) {
        toast.error('เครื่องทดแทนใช้ได้เฉพาะการถอน/ส่งซ่อม/จำหน่าย/คืนเครื่อง')
        return
      }
      if (!actReplacementAssetCode.trim()) {
        toast.error('กรุณาระบุรหัสเครื่องทดแทน หรือสแกน QR/บาร์โค้ด')
        return
      }
      if (actReplacementMode === 'existing' && actReplacementLookup.state !== 'found') {
        toast.error('ไม่พบเครื่องทดแทนในระบบ — หากต้องการสร้างใหม่ ให้เปลี่ยนเป็นโหมด "สร้างใหม่"')
        return
      }
      if (actReplacementMode === 'new' && actReplacementLookup.state === 'found') {
        toast.error(`รหัส "${actReplacementAssetCode}" มีอยู่แล้ว — ใช้โหมด "ใช้เครื่องที่มี"`)
        return
      }
    }

    try {
      setActioning(true)

      // ── Branch: Replace-on-Withdraw (single atomic transaction) ──
      // When replacement is enabled, we skip the meter-pre-write + lifecycle
      // flow and call the dedicated /replace-on-withdraw route instead.
      // The replacement device's meter is not relevant here (it may be new).
      if (actReplacementEnabled && isWithdrawAction) {
        // P0-2 (LIFECYCLE-METER): pass source device's closing meter value +
        // skipMeterReason to the replace-on-withdraw route so the source
        // device gets a proper FINAL/SEND_REPAIR/CHECKOUT anchor in its
        // meter history (previously the route skipped meter capture entirely).
        const sourceMeterBw = meterRequired && actMeterBw.trim() ? Number(actMeterBw) : null
        const sourceMeterColor = meterRequired && actMeterColor.trim() ? Number(actMeterColor) : null
        const replaceRes = await fetch(`/api/devices/${deviceId}/replace-on-withdraw`, {
          method: 'POST',
          headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            action: actionId,
            toStatus: newStatus ?? cfg.targetStatus ?? device.status,
            reason: actReason.trim() || null,
            actionDate,
            // Source device closing meter (optional but enforced by server when
            // device.meterRequired is true and ack is not checked).
            sourceMeterBw,
            sourceMeterColor,
            meterSkipAcknowledged: meterRequired && sourceMeterBw === null && actMeterSkipAcknowledged,
            skipMeterReason: meterRequired && sourceMeterBw === null
              ? (actSkipMeterReason.trim() || actReason.trim() || null)
              : null,
            replacement: {
              mode: actReplacementMode,
              assetCode: actReplacementAssetCode.trim(),
              serialNumber: actReplacementSerial.trim() || undefined,
              name: actReplacementName.trim() || undefined,
              brand: actReplacementBrand.trim() || undefined,
              model: actReplacementModel.trim() || undefined,
              type: actReplacementType.trim() || undefined,
            },
          }),
        })
        if (!replaceRes.ok) {
          const j = await replaceRes.json().catch(() => ({}))
          throw new Error(j.error ?? 'ถอนพร้อมทดแทนไม่สำเร็จ')
        }
        const result = (await replaceRes.json()) as {
          sourceDevice?: { assetCode?: string }
          replacementDevice?: { assetCode?: string; id?: string }
          created?: boolean
        }
        toast.success(
          `${cfg.label} เรียบร้อย พร้อมติดตั้งเครื่องทดแทน ${result.replacementDevice?.assetCode ?? actReplacementAssetCode}${result.created ? ' (สร้างใหม่)' : ''}`,
        )
        setActionOpen(false)
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['device-detail', deviceId] }),
          qc.invalidateQueries({ queryKey: ['device-transfers', deviceId] }),
          qc.invalidateQueries({ queryKey: ['device-meter', deviceId] }),
          qc.invalidateQueries({ queryKey: ['devices'] }),
          qc.invalidateQueries({ queryKey: ['dashboard'] }),
          qc.invalidateQueries({ queryKey: ['audit'] }),
        ])
        // If a new replacement device was created, also open its detail sheet
        if (result.replacementDevice?.id) {
          // Capture the id: inside the setTimeout closure the `?.` narrowing on
          // `result.replacementDevice` is not preserved.
          const replacementId: string = result.replacementDevice.id
          // Best-effort: small delay so toast is visible first
          setTimeout(() => {
            useAppStore.getState().setPendingDeviceId(replacementId)
          }, 800)
        }
        return
      }

      // ── Default flow: meter pre-write + lifecycle ──
      let meterReadingId: string | null = null

      // The compatibility meter API returns the saved row id. Pass it to the
      // lifecycle endpoint so history and event linkage are not best-effort.
      if (meterRequired && hasMeterValue) {
        const meterRemark = [actReason.trim(), `[${cfg.label}]`]
          .filter(Boolean)
          .join(' — ')
        const meterRes = await fetch('/api/meter', {
          method: 'POST',
          headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            deviceId,
            reading: Number(actMeterBw),
            meterColor: actMeterColor.trim() === '' ? 0 : Number(actMeterColor),
            date: actionDate,
            remark: meterRemark || null,
          }),
        })
        const meterPayload = await meterRes.json().catch(() => ({})) as {
          error?: string
          reading?: { id?: string }
        }
        if (!meterRes.ok) {
          throw new Error(meterPayload.error ?? 'จดมิเตอร์ไม่สำเร็จ')
        }
        meterReadingId = meterPayload.reading?.id ?? null
        if (!meterReadingId) {
          throw new Error('ไม่พบรหัสรายการมิเตอร์หลังบันทึก')
        }
      }

      const lifecycleRes = await fetch(`/api/devices/${deviceId}/lifecycle`, {
        method: 'POST',
        headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: actionId,
          toStatus: newStatus ?? device.status,
          toSite: cfg.needLoc ? actSite.trim() : device.site,
          toBuilding: cfg.needLoc ? actBuilding.trim() || null : device.building,
          toFloor: cfg.needLoc ? actFloor.trim() || null : device.floor,
          toDepartment: cfg.needLoc ? actDept.trim() || null : device.department,
          toDepartmentCode: cfg.needLoc ? actDeptCode.trim() || null : device.departmentCode,
          toLocation: cfg.needLoc ? actLocation.trim() || null : device.location,
          meterReadingId,
          meterSkipAcknowledged: meterRequired && !meterReadingId && actMeterSkipAcknowledged,
          skipMeterReason: meterRequired && !meterReadingId ? (actSkipMeterReason.trim() || actReason.trim() || null) : null,
          // Q4: the number to close the month with when the device could not be
          // read. Blank = carry forward the device's last known value.
          estimatedMeterBw: meterRequired && !meterReadingId && actMeterSkipAcknowledged
            ? (actEstimatedBw.trim() === '' ? undefined : Number(actEstimatedBw))
            : undefined,
          estimatedMeterColor: meterRequired && !meterReadingId && actMeterSkipAcknowledged
            ? (actEstimatedColor.trim() === '' ? undefined : Number(actEstimatedColor))
            : undefined,
          reason: actReason.trim() || null,
          actionDate,
        }),
      })
      if (!lifecycleRes.ok) {
        const j = await lifecycleRes.json().catch(() => ({}))
        throw new Error(j.error ?? 'อัปเดตวงจรอุปกรณ์ไม่สำเร็จ')
      }

      toast.success(`${cfg.label} เรียบร้อยแล้ว`)
      // Tell staff the month is closed, so they don't go re-enter it on the
      // meter screen. Only meaningful when a real meter reading was written
      // (not when they acknowledged "มิเตอร์นับต่อเนื่อง" without a number).
      if (meterReadingId && closingMonthLabel) {
        toast.success(`ปิดมิเตอร์เดือน ${closingMonthLabel} ให้ ${device.assetCode} แล้ว`)
      }
      setActionOpen(false)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['device-detail', deviceId] }),
        qc.invalidateQueries({ queryKey: ['device-transfers', deviceId] }),
        qc.invalidateQueries({ queryKey: ['device-meter', deviceId] }),
        // The device just closed a meter month, so the pending list on the
        // meter screen must drop it without the user navigating back.
        qc.invalidateQueries({ queryKey: ['meter-readings'] }),
        qc.invalidateQueries({ queryKey: ['meter-unread'] }),
        qc.invalidateQueries({ queryKey: ['devices'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setActioning(false)
    }
  }

  const activeAssignment = React.useMemo(
    () => (assignments ?? []).find((a) => a.status === 'active') ?? null,
    [assignments],
  )

  const { data: sites } = useQuery<Site[]>({
    queryKey: ['sites'],
    queryFn: async () => {
      const res = await fetch('/api/sites', {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) return []
      const json = await res.json()
      return json.sites as Site[]
    },
  })

  const device = deviceData?.device
  // BUGFIX (QA-ROUND-C): `deviceIsMeterable` was previously defined ONLY inside
  // findActionConfig(), but the transfer-wizard JSX (step 1/step 3) referenced
  // it from the component render scope → ReferenceError: deviceIsMeterable is
  // not defined → whole DeviceDetailSheet crashed to the error boundary.
  // Hoisted here so every scope (findActionConfig + JSX) sees the same value.
  const deviceIsMeterable = !!device?.meterRequired

  // ── Device Set: fetch child devices (devices whose parentDeviceId === this.id) ──
  // Uses the new ?parentDeviceId=<id> filter on GET /api/devices. Declared
  // here (after `device` is defined) because the parent-device query depends
  // on `device.parentDeviceId`.
  const { data: childDevices, isLoading: childrenLoading } = useQuery<Device[]>({
    queryKey: ['device-children', deviceId],
    queryFn: async () => {
      if (!deviceId) return []
      const res = await fetch(`/api/devices?parentDeviceId=${encodeURIComponent(deviceId)}&limit=100`, {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) return []
      const json = await res.json()
      return (json.devices ?? []) as Device[]
    },
    enabled: Boolean(deviceId),
  })

  // ── Device Set: fetch parent device (if this device is itself a child) ──
  // Only fires when device.parentDeviceId is set. The result is the parent's
  // full Device row, used to render the "อุปกรณ์นี้อยู่ในชุดของ: …" banner.
  const parentDeviceId = device?.parentDeviceId ?? null
  const { data: parentDevice } = useQuery<Device | null>({
    queryKey: ['device-parent', parentDeviceId],
    queryFn: async () => {
      if (!parentDeviceId) return null
      const res = await fetch(`/api/devices/${encodeURIComponent(parentDeviceId)}`, {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) return null
      const json = await res.json()
      return (json.device ?? null) as Device | null
    },
    enabled: Boolean(parentDeviceId),
  })

  const sortedReadings = React.useMemo(
    () =>
      (readings ?? [])
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date)),
    [readings],
  )
  const chartData = sortedReadings.map((r) => ({
    date: r.date,
    label: r.date.slice(5),
    reading: r.reading,
  }))

  function handleEdit() {
    if (device && onEdit) {
      onEdit(device)
    }
  }

  // ── Quick Edit (cascading master data + location) ──
  // Open the dialog pre-filled with the device's current Type/Brand/Model
  // + Building/Floor/Department/Location. The user can change any field,
  // and on save we PUT both the new FK fields AND the legacy String fields.
  function openQuickEdit() {
    if (!device) return
    setCascadeVal({
      type: device.type ?? '',
      brand: device.brand ?? '',
      model: device.model ?? '',
      // typeId/brandId/modelId come from the device row when present
      // (newer devices populate them; legacy devices will resolve the IDs
      // via the loaded master lists once the user picks a known value).
      typeId: device.typeId ?? null,
      brandId: device.brandId ?? null,
      modelId: device.modelId ?? null,
      building: device.building ?? '',
      floor: device.floor ?? '',
      department: device.department ?? '',
      location: device.location ?? '',
    })
    setQuickEditOpen(true)
  }

  async function saveQuickEdit() {
    if (!device) return
    if (!cascadeVal.type || !cascadeVal.brand || !cascadeVal.model) {
      toast.error('กรุณากรอกประเภท แบรนด์ และรุ่นให้ครบ')
      return
    }
    try {
      setQuickSaving(true)
      const body: Record<string, unknown> = {
        // ── Legacy String fields (backward compat) ──
        type: cascadeVal.type ?? null,
        brand: cascadeVal.brand ?? null,
        model: cascadeVal.model ?? null,
        building: cascadeVal.building || null,
        floor: cascadeVal.floor || null,
        department: cascadeVal.department || null,
        location: cascadeVal.location || null,
        // ── New FK fields (may be null when user typed a brand-new value) ──
        typeId: cascadeVal.typeId || null,
        brandId: cascadeVal.brandId || null,
        modelId: cascadeVal.modelId || null,
      }
      const res = await fetch(`/api/devices/${device.id}`, {
        method: 'PUT',
        headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'อัปเดตไม่สำเร็จ')
      }
      const json = await res.json()
      toast.success('บันทึกข้อมูลหลักเรียบร้อยแล้ว')
      setQuickEditOpen(false)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['device-detail', deviceId] }),
        qc.invalidateQueries({ queryKey: ['devices'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ])
      // If the user typed a brand-new Type/Brand/Model, the server-side
      // PUT doesn't auto-create the master rows. We surface a hint here
      // so the admin can add them later via the Master Data screen.
      if (
        cascadeVal.isNewType ||
        cascadeVal.isNewBrand ||
        cascadeVal.isNewModel
      ) {
        toast.info(
          'ค่าใหม่ถูกบันทึกเป็นข้อความ — แต่ยังไม่ถูกเพิ่มเข้า Master Data',
          { duration: 6000 },
        )
      }
      // Best-effort: log the returned device for debugging.
      void json
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setQuickSaving(false)
    }
  }

  function openTransferDialog() {
    if (!device) return
    setTSite('')
    setTDept(device.department ?? '')
    setTDeptCode(device.departmentCode ?? '')
    setTReason('')
    setTDate(todayISO())
    setTransferOpen(true)
  }

  function openAssignDialog() {
    if (!device) return
    setAAssignee('')
    setARole('')
    setADept(device.department ?? '')
    setACheckout(todayISO())
    setAExpectedReturn('')
    setANotes('')
    setAssignOpen(true)
  }

  function openReturnDialog() {
    if (!activeAssignment) return
    setRReturnDate(todayISO())
    setRNotes('')
    setReturnOpen(true)
  }

  async function confirmAssign() {
    if (!device) return
    if (!aAssignee.trim()) {
      toast.error('กรุณากรอกชื่อผู้รับมอบหมาย')
      return
    }
    try {
      setAssigning(true)
      const res = await fetch(`/api/devices/${device.id}/assign`, {
        method: 'POST',
        headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          assignee: aAssignee.trim(),
          assigneeRole: aRole.trim() || null,
          department: aDept.trim() || null,
          checkoutDate: aCheckout,
          expectedReturnDate: aExpectedReturn || null,
          notes: aNotes.trim() || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Assign failed')
      }
      toast.success(`มอบหมายอุปกรณ์ให้ ${aAssignee.trim()} แล้ว`)
      setAssignOpen(false)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['device-detail', deviceId] }),
        qc.invalidateQueries({ queryKey: ['device-assignments', deviceId] }),
        qc.invalidateQueries({ queryKey: ['devices'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Assign failed')
    } finally {
      setAssigning(false)
    }
  }

  async function confirmReturn() {
    if (!device || !activeAssignment) return
    try {
      setReturning(true)
      const res = await fetch(`/api/devices/${device.id}/return`, {
        method: 'POST',
        headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          actualReturnDate: rReturnDate,
          notes: rNotes.trim() || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Return failed')
      }
      toast.success(`คืนอุปกรณ์จาก ${activeAssignment.assignee} แล้ว`)
      setReturnOpen(false)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['device-detail', deviceId] }),
        qc.invalidateQueries({ queryKey: ['device-assignments', deviceId] }),
        qc.invalidateQueries({ queryKey: ['devices'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Return failed')
    } finally {
      setReturning(false)
    }
  }

  async function confirmTransfer() {
    if (!device) return
    if (!tSite) {
      toast.error('กรุณาเลือกสาขาปลายทาง')
      return
    }
    if (tSite === device.site && tDept.trim() === (device.department ?? '') && tDeptCode.trim() === (device.departmentCode ?? '')) {
      toast.error('ไม่มีการเปลี่ยนแปลง — สาขา/แผนกเหมือนเดิม')
      return
    }
    if (device.meterRequired) {
      toast.error('อุปกรณ์นี้ต้องจดมิเตอร์ก่อนย้าย กรุณาใช้เมนู “ย้ายตำแหน่ง” ในรายการวงจรอุปกรณ์')
      return
    }
    try {
      setTransferring(true)
      const res = await fetch(`/api/devices/${device.id}/transfer`, {
        method: 'POST',
        headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          toSite: tSite,
          toDept: tDept.trim() || null,
          toDeptCode: tDeptCode.trim() || null,
          reason: tReason.trim() || null,
          transferDate: tDate,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Transfer failed')
      }
      toast.success('ย้ายอุปกรณ์แล้ว')
      setTransferOpen(false)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['device-detail', deviceId] }),
        qc.invalidateQueries({ queryKey: ['device-transfers', deviceId] }),
        qc.invalidateQueries({ queryKey: ['devices'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Transfer failed')
    } finally {
      setTransferring(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        onEscapeKeyDown={() => onClose()}
        className="itam-scroll w-full gap-0 overflow-y-auto border-slate-800 bg-white p-0 dark:border-slate-800 dark:bg-slate-900 sm:max-w-[480px]"
      >
        <SheetHeader className="border-b border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900">
          {/* Visually-hidden title for accessibility (Radix Dialog requires it) */}
          <SheetTitle className="sr-only">
            {device?.name || 'รายละเอียดอุปกรณ์'}
          </SheetTitle>
          {deviceLoading ? (
            <>
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </>
          ) : device ? (
            <>
              <SheetTitle className="text-lg text-slate-800 dark:text-slate-100">
                {device.name}
              </SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{device.assetCode}</span>
                <Badge className={statusBadgeClass(device.status) + ' transition-colors hover:scale-105'}>
                  {statusLabel(device.status)}
                </Badge>
              </SheetDescription>
            </>
          ) : (
            <>
              <SheetTitle>—</SheetTitle>
              <SheetDescription>ไม่พบอุปกรณ์</SheetDescription>
            </>
          )}
        </SheetHeader>

        <div className="flex-1 space-y-5 p-5">
          {device && <Button variant="outline" className="w-full" onClick={() => window.open(`/government/register?device=${encodeURIComponent(device.id)}`, '_blank', 'noopener,noreferrer')}>ทะเบียนคุมทรัพย์สินราชการ / พิมพ์ PDF</Button>}
          {/* Warranty alert banner */}
          {device && (() => {
            const w = computeWarranty(device.purchaseDate, device.warrantyMonths ?? 12)
            if (w.status === 'expired' && w.expiry) {
              return (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                >
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <span className="font-semibold">⚠️ รับประกันหมดแล้วเมื่อ {formatThaiDate(w.expiry)}</span>
                    <span className="mt-0.5 block text-xs text-rose-600 dark:text-rose-400">
                      อุปกรณ์นี้อาจไม่ได้รับการคุ้มครองจากผู้ผลิต — พิจารณาต่ออายุรับประกันหรือวางแผนส่งซ่อม
                    </span>
                  </span>
                </div>
              )
            }
            if (w.status === 'expiring' && w.expiry && w.daysUntilExpiry !== null) {
              return (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                >
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <span className="font-semibold">⏰ รับประกันจะหมดในอีก {w.daysUntilExpiry} วัน ({formatThaiDate(w.expiry)})</span>
                    <span className="mt-0.5 block text-xs text-amber-600 dark:text-amber-400">
                      วางแผนต่ออายุรับประกันหรือเตรียมอุปกรณ์สำรองก่อนวันหมดรับประกัน
                    </span>
                  </span>
                </div>
              )
            }
            return null
          })()}

          {/* ── "อุปกรณ์นี้อยู่ในชุดของ …" banner (shown only when device is a child) ── */}
          {/* ใช้ DeviceSetParentBanner จากไฟล์ device-set-children-section.tsx
              (ย้ายออกจากไฟล์นี้เพื่อให้ reuse ได้) */}
          {device && parentDevice && (
            <DeviceSetParentBanner
              parentDevice={{
                id: parentDevice.id,
                assetCode: parentDevice.assetCode,
                name: parentDevice.name,
              }}
              setLabel={device.setLabel}
              setPosition={device.setPosition}
              onOpenParent={(parentId) => {
                // ปิด sheet ปัจจุบันก่อน เพื่อกัน stacking ของ sheet
                onClose()
                // Defer to next tick ให้ Sheet close animation เริ่มก่อน
                setTimeout(() => {
                  useAppStore.getState().setPendingDeviceId(parentId)
                }, 100)
              }}
            />
          )}

          {/* ── "เครื่องนี้ถูกแทนที่แล้ว" banner (shown only when device.replacedById is set) ── */}
          {device && device.replacedById && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <RefreshCw className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  🔄 เครื่องนี้ถูกเปลี่ยนทดแทนแล้ว (Replaced)
                </div>
                {device.replacedAt && (
                  <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">
                    เมื่อ {formatThaiDateTime(
                      typeof device.replacedAt === 'string'
                        ? device.replacedAt
                        : new Date(device.replacedAt).toISOString(),
                    )}
                  </div>
                )}
                <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                  ใช้อุปกรณ์ต่อพ่วง/การมอบหมาย/แผน PM กับเครื่องใหม่ต่อไป
                </div>
              </div>
            </div>
          )}

          {/* Current assignee card */}
          {device && (
            <section>
              {assignmentsLoading ? (
                <Skeleton className="h-24 w-full dark:bg-slate-800" />
              ) : activeAssignment ? (
                <div className="relative overflow-hidden rounded-lg border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-4 dark:border-teal-800/60 dark:from-teal-950/30 dark:to-slate-900">
                  <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#14b8a6] to-[#0d9488]" />
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
                      <User className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">
                          ผู้ใช้งานปัจจุบัน
                        </h3>
                        <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          active
                        </Badge>
                      </div>
                      <div className="mt-1 text-base font-bold text-slate-800 dark:text-slate-100">
                        {activeAssignment.assignee}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {activeAssignment.assigneeRole && (
                          <span>{activeAssignment.assigneeRole}</span>
                        )}
                        {activeAssignment.department && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {activeAssignment.department}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <ClipboardList className="h-3 w-3" />
                          มอบเมื่อ {formatThaiDate(activeAssignment.checkoutDate)}
                        </span>
                        {activeAssignment.expectedReturnDate && (
                          <span>
                            กำหนดคืน {formatThaiDate(activeAssignment.expectedReturnDate)}
                          </span>
                        )}
                      </div>
                      {activeAssignment.notes && (
                        <div className="mt-1.5 rounded bg-teal-50 px-2 py-1 text-xs text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">
                          📝 {activeAssignment.notes}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={openReturnDialog}
                      disabled={returning}
                      className="shrink-0 border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/60 focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
                    >
                      <Undo2 className="h-4 w-4" />
                      คืนอุปกรณ์
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-teal-300 bg-teal-50/40 py-6 text-center dark:border-teal-700 dark:bg-teal-950/20">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-300">
                    <User className="h-5 w-5" />
                  </div>
                  <div className="text-sm font-medium text-slate-600 dark:text-slate-300">
                    ยังไม่มีผู้ใช้งานปัจจุบัน
                  </div>
                  <div className="text-xs text-slate-400 dark:text-slate-500">
                    มอบหมายอุปกรณ์นี้ให้ผู้ใช้งานเพื่อติดตามการใช้งาน
                  </div>
                  <Button
                    size="sm"
                    onClick={openAssignDialog}
                    className="mt-1 border border-[#0d9488] bg-[#0d9488] text-white hover:bg-[#0f766e] focus-visible:ring-2 focus-visible:ring-[#0d9488] focus-visible:ring-offset-1 dark:border-[#14b8a6] dark:bg-[#14b8a6] dark:hover:bg-[#0d9488] dark:focus-visible:ring-offset-slate-950"
                  >
                    <UserPlus className="h-4 w-4" />
                    มอบหมาย
                  </Button>
                </div>
              )}
            </section>
          )}

          {/* Info grid */}
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                ข้อมูลอุปกรณ์
              </h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={openQuickEdit}
                disabled={!device}
                className="h-7 gap-1 px-2 text-[11px] text-[#0d9488] hover:bg-[#0d9488]/10 hover:text-[#0d9488] dark:text-[#14b8a6]"
                title="แก้ไขประเภท / แบรนด์ / รุ่น / ที่ตั้ง"
              >
                <Layers className="h-3.5 w-3.5" />
                แก้ไขข้อมูลหลัก
              </Button>
            </div>
            {deviceLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : device ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <InfoRow label="แบรนด์" value={device.brand} />
                <InfoRow label="รุ่น" value={device.model} />
                <InfoRow label="ประเภท" value={device.type} />
                <InfoRow
                  label="หมายเลข SN"
                  value={
                    <span className="font-mono text-xs">
                      {device.serialNumber}
                    </span>
                  }
                />
                <InfoRow label="สาขา" value={device.site} />
                <InfoRow label="แผนก" value={device.department} />
                <InfoRow
                  label="รหัสแผนก"
                  value={
                    <span className="font-mono text-xs">
                      {device.departmentCode}
                    </span>
                  }
                />
                <InfoRow
                  label="ParentRef"
                  value={
                    <span className="font-mono text-xs">
                      {device.parentRef}
                    </span>
                  }
                />
                <InfoRow label="DisplayLabel" value={device.displayLabel} />
                <InfoRow label="ที่ตั้ง" value={device.location} />
                <InfoRow label="วันที่ซื้อ" value={formatThaiDate(device.purchaseDate)} />
                <InfoRow
                  label="รับประกัน (เดือน)"
                  value={
                    <span className="tabular-nums">
                      {device.warrantyMonths ?? 12}
                    </span>
                  }
                />
                {(() => {
                  const w = computeWarranty(
                    device.purchaseDate,
                    device.warrantyMonths ?? 12,
                  )
                  return (
                    <InfoRow
                      label="วันหมดรับประกัน"
                      value={
                        w.expiry ? (
                          <span
                            className={
                              'font-medium ' +
                              (w.status === 'expired'
                                ? 'text-rose-600 dark:text-rose-400'
                                : w.status === 'expiring'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-emerald-600 dark:text-emerald-400')
                            }
                          >
                            {formatThaiDate(w.expiry)}
                          </span>
                        ) : (
                          <Badge className={warrantyBadgeClass(w.status)}>
                            {warrantyLabel(w.status)}
                          </Badge>
                        )
                      }
                    />
                  )
                })()}
                <InfoRow
                  label="มิเตอร์ล่าสุด"
                  value={
                    <span className="font-mono tabular-nums">
                      {(device.lastMeterBw ?? device.lastMeterReading ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                      {device.lastMeterColor && device.lastMeterColor > 0 ? (
                        <span className="ml-2 text-[10px] text-slate-400">สี {(device.lastMeterColor ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</span>
                      ) : null}
                    </span>
                  }
                />
                {(() => {
                  // Compute straight-line depreciation inline using device fields.
                  const price = device.purchasePrice
                  const salvage =
                    device.salvageValue !== null &&
                    device.salvageValue !== undefined
                      ? device.salvageValue
                      : 0
                  const usefulLife =
                    device.usefulLife && device.usefulLife > 0
                      ? device.usefulLife
                      : 60
                  if (price === null || price === undefined || price <= 0) {
                    return null
                  }
                  // Age in months
                  let ageInMonths = 0
                  if (
                    device.purchaseDate &&
                    /^\d{4}-\d{2}-\d{2}/.test(device.purchaseDate)
                  ) {
                    const start = new Date(
                      device.purchaseDate.slice(0, 10) + 'T00:00:00',
                    )
                    if (!Number.isNaN(start.getTime())) {
                      const now = new Date()
                      let m =
                        (now.getFullYear() - start.getFullYear()) * 12 +
                        (now.getMonth() - start.getMonth())
                      if (now.getDate() < start.getDate()) m -= 1
                      ageInMonths = Math.max(0, m)
                    }
                  }
                  const clampedSalvage = Math.min(salvage, price)
                  const monthlyDepreciation =
                    (price - clampedSalvage) / usefulLife
                  const accumulatedDepreciation = Math.min(
                    Math.max(0, monthlyDepreciation * ageInMonths),
                    Math.max(0, price - clampedSalvage),
                  )
                  const currentValue = Math.max(
                    clampedSalvage,
                    price - accumulatedDepreciation,
                  )
                  const pct =
                    price > 0
                      ? Math.round((accumulatedDepreciation / price) * 100)
                      : 0
                  const status =
                    currentValue <= clampedSalvage
                      ? 'หมดอายุการใช้งาน'
                      : ageInMonths < 1
                        ? 'ใหม่'
                        : 'กำลังเสื่อม'
                  const statusColor =
                    currentValue <= clampedSalvage
                      ? 'text-rose-600 dark:text-rose-400'
                      : ageInMonths < 1
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                  return (
                    <InfoRow
                      label="มูลค่าปัจจุบัน"
                      value={
                        <div className="space-y-1">
                          <div className="flex items-baseline gap-2">
                            <span className="font-semibold tabular-nums text-[#0d9488] dark:text-[#14b8a6]">
                              {formatBaht(currentValue)}
                            </span>
                            <span className="text-xs text-slate-400 dark:text-slate-500">
                              · เสื่อม {pct}%
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 dark:text-slate-500">
                            ราคาซื้อ {formatBaht(price)} ·{' '}
                            <span className={statusColor}>{status}</span>
                          </div>
                        </div>
                      }
                    />
                  )
                })()}
                <InfoRow
                  label="สร้างเมื่อ"
                  value={formatThaiDateTime(device.createdAt)}
                />
                <InfoRow
                  label="อัปเดตเมื่อ"
                  value={formatThaiDateTime(device.updatedAt)}
                />
              </dl>
            ) : null}
          </section>

          {/* Meter history */}
          <section>
            <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <Gauge className="h-3.5 w-3.5 text-[#0d9488]" />
              ประวัติการจดมิเตอร์ ({sortedReadings.length})
            </h3>
            {readingsLoading ? (
              <Skeleton className="h-44 w-full" />
            ) : chartData.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 py-8 text-slate-400 dark:border-slate-700 dark:text-slate-500">
                <Inbox className="h-8 w-8 text-slate-300 dark:text-slate-400" />
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">ยังไม่มีประวัติการจดมิเตอร์</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">เริ่มจดมิเตอร์ได้จากหน้าจดมิเตอร์</span>
              </div>
            ) : (
              <>
                <div className="rounded-md border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-800/40">
                  <VisibleResponsiveContainer width="100%" height={180}>
                    <LineChart
                      data={chartData}
                      margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={gridStroke}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        tickLine={false}
                        width={48}
                        tickFormatter={(v) =>
                          Number(v).toLocaleString('en-US', {
                            notation: 'compact',
                          })
                        }
                      />
                      <Tooltip
                        formatter={(v: number) => [
                          (Number(v) || 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB'),
                          'ค่ามิเตอร์',
                        ]}
                        labelFormatter={(l) => `วันที่ ${l}`}
                        contentStyle={{
                          fontSize: 12,
                          borderRadius: 8,
                          border: `1px solid ${tooltipBorder}`,
                          background: tooltipBg,
                          color: tooltipFg,
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="reading"
                        stroke="#0d9488"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: '#0d9488' }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </VisibleResponsiveContainer>
                </div>

                <ul className="itam-scroll mt-3 max-h-48 space-y-1.5 overflow-y-auto">
                  {[...sortedReadings].reverse().map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-slate-100 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                          {r.date}
                        </div>
                        <div className="text-sm font-medium text-slate-700 tabular-nums dark:text-slate-200">
                          {(r.reading ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {r.remark && (
                          <span
                            className="max-w-[120px] truncate text-xs text-amber-600 dark:text-amber-400"
                            title={r.remark}
                          >
                            ⚠ {r.remark}
                          </span>
                        )}
                        <Badge
                          className={
                            'tabular-nums transition-colors hover:scale-105 ' +
                            (r.delta < 0
                              ? 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : r.delta === 0
                                ? 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                : 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300')
                          }
                        >
                          {r.delta >= 0 ? '+' : ''}
                          {(r.delta ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* Transfer history */}
          <section>
            <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <ArrowLeftRight className="h-3.5 w-3.5 text-[#f97316]" />
              ประวัติการย้าย ({transfers?.length ?? 0})
            </h3>
            {transfersLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : !transfers || transfers.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 py-8 text-slate-400 dark:border-slate-700 dark:text-slate-500">
                <MapPin className="h-8 w-8 text-slate-300 dark:text-slate-400" />
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">ยังไม่มีประวัติการย้าย</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">กดปุ่ม &quot;ย้ายอุปกรณ์&quot; ด้านล่างเพื่อบันทึกการย้าย</span>
              </div>
            ) : (
              <ol className="relative space-y-4 border-l-2 border-[#f97316]/30 pl-5">
                {transfers.map((t) => (
                  <li key={t.id} className="relative">
                    {/* connector dot */}
                    <span className="absolute -left-[26px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-[#f97316] bg-white dark:bg-slate-900">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#f97316]" />
                    </span>
                    <div className="rounded-md border border-slate-100 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono">{t.transferDate}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
                        <span>{t.fromSite ?? '—'}</span>
                        {t.fromDept && (
                          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                            ({t.fromDept})
                          </span>
                        )}
                        <ArrowRight className="h-3.5 w-3.5 text-[#f97316]" />
                        <span className="text-[#f97316]">{t.toSite}</span>
                        {t.toDept && (
                          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                            ({t.toDept})
                          </span>
                        )}
                      </div>
                      {t.reason && (
                        <div className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          📝 {t.reason}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Assignment history timeline */}
          <section>
            <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <User className="h-3.5 w-3.5 text-[#0d9488]" />
              ประวัติการมอบหมาย ({assignments?.length ?? 0})
            </h3>
            {assignmentsLoading ? (
              <Skeleton className="h-24 w-full dark:bg-slate-800" />
            ) : !assignments || assignments.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 py-8 text-slate-400 dark:border-slate-700 dark:text-slate-500">
                <User className="h-8 w-8 text-slate-300 dark:text-slate-400" />
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">ยังไม่มีประวัติการมอบหมาย</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">กดปุ่ม &quot;มอบหมาย&quot; ด้านบนเพื่อบันทึกการมอบหมาย</span>
              </div>
            ) : (
              <ol className="relative space-y-4 border-l-2 border-[#0d9488]/30 pl-5">
                {assignments.map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[26px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-[#0d9488] bg-white dark:bg-slate-900">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#0d9488]" />
                    </span>
                    <div className="rounded-md border border-slate-100 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                          {a.checkoutDate}
                        </div>
                        <Badge
                          className={
                            a.status === 'active'
                              ? 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }
                        >
                          {a.status === 'active' ? 'กำลังใช้งาน' : 'คืนแล้ว'}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium text-slate-700 dark:text-slate-200">
                        <User className="h-3.5 w-3.5 text-[#0d9488]" />
                        <span>{a.assignee}</span>
                        {a.assigneeRole && (
                          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                            · {a.assigneeRole}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {a.department && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {a.department}
                          </span>
                        )}
                        {a.expectedReturnDate && (
                          <span>กำหนดคืน {formatThaiDate(a.expectedReturnDate)}</span>
                        )}
                        {a.actualReturnDate && (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            คืนจริง {formatThaiDate(a.actualReturnDate)}
                          </span>
                        )}
                      </div>
                      {a.notes && (
                        <div className="mt-1.5 rounded bg-teal-50 px-2 py-1 text-xs text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">
                          📝 {a.notes}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* ── Lifecycle action buttons (Apps Script parity) ── */}
          {device && (() => {
            const isMeterable = !!device.meterRequired
            const actions = buildDeviceActions(device.status, isMeterable)
            if (actions.length === 0) return null
            return (
              <section className="rounded-lg border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-3 dark:border-slate-800 dark:from-slate-900 dark:to-slate-900">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <Settings2 className="h-3.5 w-3.5 text-[#f97316]" />
                    การจัดการอุปกรณ์
                  </h3>
                  <Badge className="border-slate-200 bg-white text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                    {actions.length} การกระทำ
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {actions.map((a) => {
                    const tone = actionToneClass(a.id)
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => openActionDialog(a.id)}
                        className={
                          'group flex flex-col items-start gap-1 rounded-md border bg-white px-2.5 py-2 text-left transition-all hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316]/40 dark:bg-slate-800/60 ' +
                          tone.border
                        }
                      >
                        <div className="flex w-full items-center gap-1.5">
                          <span className="text-base leading-none">{a.icon}</span>
                          <span className={'text-xs font-semibold ' + tone.text}>
                            {a.label}
                          </span>
                        </div>
                        <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                          {a.desc}
                        </p>
                      </button>
                    )
                  })}
                </div>
                {isMeterable && (
                  <p className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
                    ℹ️ อุปกรณ์นี้บังคับจดมิเตอร์ — ระบบจะให้กรอกค่ามิเตอร์ก่อนเปลี่ยนสถานะ
                  </p>
                )}
              </section>
            )
          })()}

          {/* License records section */}
          <section className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <KeyRound className="h-4 w-4 text-[#0d9488]" />
                ลิขสิทธิ์ซอฟต์แวร์
                {licenses && licenses.length > 0 && (
                  <Badge className="border-[#0d9488]/30 bg-[#0d9488]/10 text-[#0d9488] dark:border-[#14b8a6]/30 dark:bg-[#14b8a6]/10 dark:text-[#14b8a6]">
                    {licenses.length}
                  </Badge>
                )}
              </h3>
              <Button
                size="sm"
                onClick={() => openLicenseDialog()}
                disabled={!device}
                className="h-8 border border-[#0d9488] bg-[#0d9488] text-white hover:bg-[#0f766e] focus-visible:ring-2 focus-visible:ring-[#0d9488] focus-visible:ring-offset-1 dark:border-[#14b8a6] dark:bg-[#14b8a6] dark:hover:bg-[#0d9488] dark:focus-visible:ring-offset-slate-950"
              >
                <Plus className="h-4 w-4" />
                เพิ่ม License
              </Button>
            </div>
            {licensesLoading ? (
              <Skeleton className="h-24 w-full dark:bg-slate-800" />
            ) : !licenses || licenses.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 py-8 text-slate-400 dark:border-slate-700 dark:text-slate-500">
                <KeyRound className="h-8 w-8 text-slate-300 dark:text-slate-400" />
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                  ยังไม่มีลิขสิทธิ์ซอฟต์แวร์
                </span>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  กดปุ่ม &quot;เพิ่ม License&quot; ด้านบนเพื่อบันทึก License ใหม่
                </span>
              </div>
            ) : (
              <ul className="space-y-2">
                {licenses.map((lc) => {
                  const revealed = !!revealedLicenseKeys[lc.id]
                  const masked = maskKey(lc.licenseKey || '')
                  return (
                    <li
                      key={lc.id}
                      className="rounded-md border border-slate-100 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                              {lc.software}
                            </span>
                            {lc.licenseType && (
                              <Badge className="border-[#0d9488]/30 bg-[#0d9488]/10 text-[#0d9488] dark:border-[#14b8a6]/30 dark:bg-[#14b8a6]/10 dark:text-[#14b8a6]">
                                {lc.licenseType}
                              </Badge>
                            )}
                            <Badge className="border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              จำนวน {lc.quantity}
                            </Badge>
                            {lc.expiryDate && (() => {
                              const days = daysUntil(lc.expiryDate)
                              if (days === null) return null
                              if (days < 0) {
                                return (
                                  <Badge className="border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
                                    หมดอายุ
                                  </Badge>
                                )
                              }
                              if (days <= 30) {
                                return (
                                  <Badge className="border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                    อีก {days} วัน
                                  </Badge>
                                )
                              }
                              return null
                            })()}
                          </div>
                          {lc.licenseId && (
                            <div className="mt-0.5 font-mono text-[11px] text-slate-400 dark:text-slate-500">
                              ID: {lc.licenseId}
                            </div>
                          )}
                          {lc.licenseKey && (
                            <div className="mt-1 flex items-center gap-1.5 font-mono text-xs text-slate-600 dark:text-slate-300">
                              <span className="text-[10px] uppercase text-slate-400">
                                Key:
                              </span>
                              <span className="break-all">
                                {revealed ? lc.licenseKey : masked}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setRevealedLicenseKeys((prev) => ({
                                    ...prev,
                                    [lc.id]: !prev[lc.id],
                                  }))
                                }
                                aria-label={revealed ? 'ซ่อน License Key' : 'แสดง License Key'}
                                title={revealed ? 'ซ่อน Key' : 'แสดง Key'}
                                className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                              >
                                {revealed ? (
                                  <EyeOff className="h-3 w-3" />
                                ) : (
                                  <Eye className="h-3 w-3" />
                                )}
                              </button>
                            </div>
                          )}
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {lc.expiryDate && (
                              <span>
                                หมดอายุ:{' '}
                                <span className="font-medium">
                                  {formatThaiDate(lc.expiryDate)}
                                </span>
                              </span>
                            )}
                          </div>
                          {lc.remark && (
                            <div className="mt-1.5 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                              📝 {lc.remark}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openLicenseDialog(lc)}
                            aria-label="แก้ไข License"
                            title="แก้ไข License"
                            className="h-7 w-7 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteLicense(lc.id)}
                            disabled={deletingLicenseId === lc.id}
                            aria-label="ลบ License"
                            title="ลบ License"
                            className="h-7 w-7 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50"
                          >
                            {deletingLicenseId === lc.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* Custom Fields — ฟิลด์เพิ่มเติมที่องค์กรกำหนดเอง (Phase 1 multi-org) */}
          {device && (
            <CustomFieldRenderer targetEntity="Device" targetId={device.id} />
          )}
        </div>
        {/* MERGE-ACCESSORY-DEVICE-SET: previously this was 2 separate sections
            (DeviceAccessoriesSection + DeviceSetChildrenSection). Now merged
            into a single section with a toggle in the Add dialog: "new" creates
            a DeviceAccessory row; "existing" links an existing Device as a
            child by PATCHing its parentDeviceId. */}
        {device && (
          <div className="px-4 pb-4">
            <DeviceAccessoriesSection deviceId={device.id} parentDevice={device} />
          </div>
        )}

        {/* ── Device Set: children of this device ── */}
        {/* ใช้ DeviceSetChildrenSection จากไฟล์ device-set-children-section.tsx
            (ย้ายออกจากไฟล์นี้เพื่อให้ reuse ได้ในหลายจุด)
            ส่ง initialChildren + loading มาเพื่อใช้ react-query ที่ fetch แล้ว
            (device-detail-sheet มี childDevices query อยู่แล้ว — ไม่ต้อง fetch ซ้ำ) */}
        {device && (
          <div className="px-4 pb-4">
            <DeviceSetChildrenSection
              deviceId={device.id}
              setLabel={device.setLabel}
              initialChildren={(childDevices ?? []).map((c) => ({
                id: c.id,
                assetCode: c.assetCode,
                name: c.name,
                brand: c.brand,
                model: c.model,
                type: c.type,
                status: c.status,
                setPosition: c.setPosition ?? null,
              }))}
              loading={childrenLoading}
              onChildClick={(childId) => {
                // Reuse the existing pending-device mechanism (set by other
                // actions like replace-on-withdraw when a new replacement is
                // created). Closing this sheet first prevents stacking.
                onClose()
                // Defer to next tick so the Sheet close animation can start.
                setTimeout(() => {
                  useAppStore.getState().setPendingDeviceId(childId)
                }, 100)
              }}
            />
          </div>
        )}

        <SheetFooter className="flex-row gap-2 border-t border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1"
          >
            <X className="h-4 w-4" />
            ปิด
          </Button>
          <Button
            variant="outline"
            onClick={openTransferDialog}
            disabled={!device}
            className="flex-1 border-[#f97316]/40 text-[#f97316] hover:bg-[#f97316]/10 focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
          >
            <ArrowLeftRight className="h-4 w-4" />
            🔄 ย้ายอุปกรณ์
          </Button>
          <Button
            variant="outline"
            onClick={() => setReplaceOpen(true)}
            disabled={!device || device.status === 'Replaced'}
            title={
              device?.status === 'Replaced'
                ? 'อุปกรณ์นี้ถูกเปลี่ยนทดแทนไปแล้ว — ไม่สามารถเปลี่ยนซ้ำได้'
                : 'เปลี่ยนเครื่องหลัก — โอน accessories/ชุด/การมอบหมาย/แผน PM ไปยังเครื่องใหม่'
            }
            className="flex-1 border-[#0d9488]/40 text-[#0d9488] hover:bg-[#0d9488]/10 focus-visible:ring-2 focus-visible:ring-[#0d9488] focus-visible:ring-offset-1 dark:border-[#14b8a6]/40 dark:text-[#14b8a6] dark:focus-visible:ring-offset-slate-950"
          >
            <RefreshCw className="h-4 w-4" />
            เปลี่ยนเครื่องหลัก
          </Button>
          <Button
            onClick={handleEdit}
            disabled={!device || !onEdit}
            className="flex-1 bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
          >
            <Pencil className="h-4 w-4" />
            แก้ไข
          </Button>
        </SheetFooter>
      </SheetContent>

      {/* "เปลี่ยนเครื่องหลัก" sub-dialog */}
      <ReplaceDeviceDialog
        open={replaceOpen}
        onOpenChange={setReplaceOpen}
        oldDevice={device}
        onReplaced={() => {
          // Refresh the queries so the sheet reflects the new status
          // immediately. The dialog itself invalidates the broader device
          // list + dashboard + audit queries.
          qc.invalidateQueries({ queryKey: ['device-detail', deviceId] })
          qc.invalidateQueries({ queryKey: ['device-children', deviceId] })
          qc.invalidateQueries({ queryKey: ['device-assignments', deviceId] })
          qc.invalidateQueries({ queryKey: ['device-licenses', deviceId] })
        }}
      />

      {/* Transfer sub-dialog */}
      <Dialog open={transferOpen} onOpenChange={(open) => {
        setTransferOpen(open)
        if (!open) {
          // Reset wizard state on close
          setTransferStep(1)
          setTMeterBw('')
          setTMeterColor('')
        }
      }}>
        <DialogContent className="sm:max-w-md dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <ArrowLeftRight className="h-4 w-4 text-[#f97316]" />
              🔄 ย้ายอุปกรณ์
            </DialogTitle>
            <DialogDescription>
              {device?.name} ({device?.assetCode}) — ปัจจุบัน:{' '}
              <span className="font-medium text-slate-600 dark:text-slate-300">
                {device?.site}
                {device?.department ? ` · ${device.department}` : ''}
              </span>
            </DialogDescription>
          </DialogHeader>
          {/* SPRINT-3 #3: wizard step indicator */}
          <div className="flex items-center justify-between gap-1 rounded-md bg-slate-100 p-2 text-[11px] dark:bg-slate-800">
            {[
              { n: 1, label: 'จดมิเตอร์' },
              { n: 2, label: 'เลือกที่ใหม่' },
              { n: 3, label: 'ยืนยัน' },
            ].map((s, i) => (
              <React.Fragment key={s.n}>
                {i > 0 && <div className={`h-0.5 flex-1 ${transferStep > s.n - 1 ? 'bg-[#f97316]' : 'bg-slate-300 dark:bg-slate-600'}`} />}
                <div className="flex items-center gap-1">
                  <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                    transferStep === s.n ? 'bg-[#f97316] text-white ring-2 ring-[#f97316]/30' :
                    transferStep > s.n ? 'bg-emerald-500 text-white' :
                    'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                  }`}>
                    {transferStep > s.n ? '✓' : s.n}
                  </div>
                  <span className={transferStep === s.n ? 'font-semibold text-slate-700 dark:text-slate-200' : 'text-slate-400'}>{s.label}</span>
                </div>
              </React.Fragment>
            ))}
          </div>
          <div className="space-y-3">
            {/* Step 1: จดมิเตอร์ (only show if device is meterable) */}
            {transferStep === 1 && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {deviceIsMeterable
                    ? 'กรอกค่ามิเตอร์ปัจจุบันก่อนย้าย (บังคับเพื่อรักษาประวัติ)'
                    : 'อุปกรณ์นี้ไม่ต้องจดมิเตอร์ — กด "ถัดไป" เพื่อข้ามขั้นตอนนี้'}
                </p>
                {deviceIsMeterable && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">มิเตอร์ BW *</Label>
                      <Input
                        type="number"
                        value={tMeterBw}
                        onChange={(e) => setTMeterBw(e.target.value)}
                        placeholder="เช่น 12345"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">มิเตอร์ Color</Label>
                      <Input
                        type="number"
                        value={tMeterColor}
                        onChange={(e) => setTMeterColor(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* Step 2: เลือกที่ใหม่ */}
            {transferStep === 2 && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    สาขาปลายทาง *
                  </Label>
                  <Select value={tSite} onValueChange={setTSite}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="เลือกสาขา" />
                    </SelectTrigger>
                    <SelectContent>
                      {(sites ?? []).map((s) => (
                        <SelectItem key={s.code} value={s.code}>
                          {s.name} ({s.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      แผนกใหม่
                    </Label>
                    <Input
                      value={tDept}
                      onChange={(e) => setTDept(e.target.value)}
                      placeholder="เช่น IT"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      รหัสแผนกใหม่
                    </Label>
                    <Input
                      value={tDeptCode}
                      onChange={(e) => setTDeptCode(e.target.value)}
                      placeholder="เช่น IT-001"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    วันที่ย้าย *
                  </Label>
                  <Input
                    type="date"
                    value={tDate}
                    onChange={(e) => setTDate(e.target.value)}
                  />
                </div>
              </>
            )}
            {/* Step 3: ยืนยัน */}
            {transferStep === 3 && (
              <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/50">
                <div className="font-semibold text-slate-700 dark:text-slate-200">สรุปการย้าย</div>
                {deviceIsMeterable && Number(tMeterBw) > 0 && (
                  <div>มิเตอร์ BW: <span className="font-mono font-medium">{tMeterBw}</span> {tMeterColor && `/ Color: ${tMeterColor}`}</div>
                )}
                <div>ไปยัง: <span className="font-medium">{tSite || '—'}</span></div>
                {tDept && <div>แผนกใหม่: {tDept} {tDeptCode && `(${tDeptCode})`}</div>}
                <div>วันที่: {tDate}</div>
                <div className="space-y-1.5 pt-2">
                  <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    เหตุผลการย้าย
                  </Label>
                  <Textarea
                    value={tReason}
                    onChange={(e) => setTReason(e.target.value)}
                    placeholder="เช่น ย้ายไปใช้ที่แผนกใหม่ / เปลี่ยนสาขา"
                    rows={2}
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setTransferOpen(false)}
              disabled={transferring}
            >
              ยกเลิก
            </Button>
            {transferStep > 1 && (
              <Button
                variant="outline"
                onClick={() => setTransferStep(transferStep - 1)}
                disabled={transferring}
              >
                ย้อนกลับ
              </Button>
            )}
            {transferStep < 3 ? (
              <Button
                onClick={() => setTransferStep(transferStep + 1)}
                disabled={transferStep === 2 && !tSite}
                className="bg-[#f97316] text-white hover:bg-[#ea580c]"
              >
                ถัดไป →
              </Button>
            ) : (
              <Button
                onClick={confirmTransfer}
                disabled={transferring}
                className="bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
              >
                {transferring ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    กำลังย้าย...
                  </>
                ) : (
                  'ยืนยันการย้าย'
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign sub-dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-md dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <UserPlus className="h-4 w-4 text-[#0d9488]" />
              👤 มอบหมายอุปกรณ์
            </DialogTitle>
            <DialogDescription>
              {device?.name} ({device?.assetCode}) — ระบุผู้รับมอบหมายเพื่อติดตามการใช้งาน
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                ผู้รับมอบหมาย *
              </Label>
              <Input
                value={aAssignee}
                onChange={(e) => setAAssignee(e.target.value)}
                placeholder="ชื่อ-นามสกุล หรือ email"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  ตำแหน่ง/บทบาท
                </Label>
                <Input
                  value={aRole}
                  onChange={(e) => setARole(e.target.value)}
                  placeholder="เช่น พนักงาน IT"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  แผนก
                </Label>
                <Input
                  value={aDept}
                  onChange={(e) => setADept(e.target.value)}
                  placeholder="เช่น IT"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  วันที่มอบ *
                </Label>
                <Input
                  type="date"
                  value={aCheckout}
                  onChange={(e) => setACheckout(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  กำหนดคืน
                </Label>
                <Input
                  type="date"
                  value={aExpectedReturn}
                  onChange={(e) => setAExpectedReturn(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                หมายเหตุ
              </Label>
              <Textarea
                value={aNotes}
                onChange={(e) => setANotes(e.target.value)}
                placeholder="หมายเหตุการมอบหมาย (ถ้ามี)"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAssignOpen(false)}
              disabled={assigning}
            >
              ยกเลิก
            </Button>
            <Button
              onClick={confirmAssign}
              disabled={assigning || !aAssignee.trim()}
              className="border border-[#0d9488] bg-[#0d9488] text-white hover:bg-[#0f766e] focus-visible:ring-2 focus-visible:ring-[#0d9488] focus-visible:ring-offset-1 dark:border-[#14b8a6] dark:bg-[#14b8a6] dark:hover:bg-[#0d9488] dark:focus-visible:ring-offset-slate-950"
            >
              {assigning ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  กำลังมอบหมาย...
                </>
              ) : (
                'ยืนยันการมอบหมาย'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Return sub-dialog */}
      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent className="sm:max-w-md dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <Undo2 className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              📥 คืนอุปกรณ์
            </DialogTitle>
            <DialogDescription>
              {device?.name} ({device?.assetCode}) — คืนจาก{' '}
              <span className="font-medium text-slate-600 dark:text-slate-300">
                {activeAssignment?.assignee}
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                วันที่คืนจริง *
              </Label>
              <Input
                type="date"
                value={rReturnDate}
                onChange={(e) => setRReturnDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                หมายเหตุการคืน
              </Label>
              <Textarea
                value={rNotes}
                onChange={(e) => setRNotes(e.target.value)}
                placeholder="สภาพอุปกรณ์ / อุปกรณ์เสริมที่คืน / หมายเหตุอื่น ๆ"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReturnOpen(false)}
              disabled={returning}
            >
              ยกเลิก
            </Button>
            <Button
              onClick={confirmReturn}
              disabled={returning}
              className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
            >
              {returning ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  กำลังคืน...
                </>
              ) : (
                'ยืนยันการคืน'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Edit (cascading master data + location) sub-dialog */}
      <Dialog open={quickEditOpen} onOpenChange={setQuickEditOpen}>
        <DialogContent className="sm:max-w-3xl dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <Layers className="h-4 w-4 text-[#0d9488]" />
              แก้ไขข้อมูลหลัก — {device?.assetCode}
            </DialogTitle>
            <DialogDescription>
              เลือกจากรายการที่มี หรือพิมพ์ค่าใหม่ได้ (ระบบจะทำเคราะห์ค่าใหม่ด้วยเครื่องหมาย “+ ใหม่”).
              บันทึกทั้งฟิลด์ FK ใหม่ ({'typeId/brandId/modelId'}) และฟิลด์ข้อความเดิม ({'type/brand/model'}).
            </DialogDescription>
          </DialogHeader>

          {device && (
            <CascadingDropdown
              site={device.site}
              initial={cascadeVal}
              onChange={setCascadeVal}
              disabled={quickSaving}
            />
          )}

          <DialogFooter className="mt-2">
            <Button
              variant="outline"
              onClick={() => setQuickEditOpen(false)}
              disabled={quickSaving}
            >
              ยกเลิก
            </Button>
            <Button
              onClick={saveQuickEdit}
              disabled={quickSaving}
              className="border border-[#0d9488] bg-[#0d9488] text-white hover:bg-[#0f766e] focus-visible:ring-2 focus-visible:ring-[#0d9488] focus-visible:ring-offset-1 dark:border-[#14b8a6] dark:bg-[#14b8a6] dark:hover:bg-[#0d9488] dark:focus-visible:ring-offset-slate-950"
            >
              {quickSaving ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  กำลังบันทึก...
                </>
              ) : (
                'บันทึก'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* License add sub-dialog */}
      <Dialog open={licenseOpen} onOpenChange={setLicenseOpen}>
        <DialogContent className="sm:max-w-lg dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <KeyRound className="h-4 w-4 text-[#0d9488]" />
              {editingLicenseId ? '✏️ แก้ไข License' : '🔑 เพิ่ม License'}{' '}
              ให้ {device?.assetCode}
            </DialogTitle>
            <DialogDescription>
              {editingLicenseId
                ? 'ปรับปรุงข้อมูลลิขสิทธิ์ซอฟต์แวร์ของอุปกรณ์นี้'
                : 'บันทึกลิขสิทธิ์ซอฟต์แวร์ของอุปกรณ์นี้'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                ชื่อซอฟต์แวร์ *
              </Label>
              <Input
                value={lcSoftware}
                onChange={(e) => setLcSoftware(e.target.value)}
                placeholder="เช่น Microsoft Office 2021, Windows 11 Pro"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                License ID
              </Label>
              <Input
                value={lcLicenseId}
                onChange={(e) => setLcLicenseId(e.target.value)}
                placeholder="เช่น LIC-0001"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                ประเภท License
              </Label>
              <Select
                value={lcLicenseType}
                onValueChange={(v) =>
                  setLcLicenseType(v === '__none__' ? '' : v)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="เลือกประเภท" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— ไม่ระบุ —</SelectItem>
                  {LICENSE_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                License Key / Product Key
              </Label>
              <Input
                value={lcLicenseKey}
                onChange={(e) => setLcLicenseKey(e.target.value)}
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                จำนวน (Quantity)
              </Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={lcQuantity}
                onChange={(e) => setLcQuantity(e.target.value)}
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
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                หมายเหตุ
              </Label>
              <Textarea
                value={lcRemark}
                onChange={(e) => setLcRemark(e.target.value)}
                rows={2}
                placeholder="หมายเหตุเพิ่มเติม"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLicenseOpen(false)}
              disabled={savingLicense}
            >
              ยกเลิก
            </Button>
            <Button
              onClick={saveLicense}
              disabled={savingLicense}
              className="bg-[#0d9488] text-white hover:bg-[#0f766e] focus-visible:ring-2 focus-visible:ring-[#0d9488] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
            >
              {savingLicense ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  กำลังบันทึก...
                </>
              ) : editingLicenseId ? (
                'อัปเดต'
              ) : (
                'บันทึก'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lifecycle action sub-dialog */}
      <Dialog open={actionOpen} onOpenChange={setActionOpen}>
        <DialogContent className="sm:max-w-lg dark:border-slate-800 dark:bg-slate-900">
          {(() => {
            const cfg = findActionConfig(actionId)
            if (!cfg) return null
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
                    <span className="text-lg">{cfg.icon}</span>
                    {cfg.label}
                  </DialogTitle>
                  <DialogDescription>
                    {device?.name} ({device?.assetCode}) —{' '}
                    <span className="text-slate-600 dark:text-slate-300">
                      {cfg.desc}
                    </span>
                  </DialogDescription>
                </DialogHeader>
                <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                  {/* Date */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                        วันที่ทำรายการ *
                      </Label>
                      <Input
                        type="date"
                        value={actionDate}
                        onChange={(e) => onActionDateChange(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                        สถานะปัจจุบัน
                      </Label>
                      <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 dark:border-slate-700 dark:bg-slate-800">
                        <Badge className={statusBadgeClass(device?.status ?? '')}>
                          {statusLabel(device?.status ?? '')}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Status select (other_status) */}
                  {cfg.needStatusSelect && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                        เลือกสถานะใหม่ *
                      </Label>
                      <Select
                        value={actCustomStatus}
                        onValueChange={setActCustomStatus}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="เลือกสถานะ" />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS_FOR_ACTION.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Target status hint */}
                  {!cfg.needStatusSelect && cfg.targetStatus && (
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      เป้าหมาย: เปลี่ยนสถานะเป็น{' '}
                      <Badge className={statusBadgeClass(cfg.targetStatus)}>
                        {cfg.targetStatus}
                      </Badge>
                    </div>
                  )}

                  {/* Location fields (transfer / reinstall) */}
                  {cfg.needLoc && (
                    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                        <Building2 className="h-3.5 w-3.5 text-[#f97316]" />
                        ตำแหน่งใหม่
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                          สาขา *
                        </Label>
                        <Select value={actSite} onValueChange={setActSite}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="เลือกสาขา" />
                          </SelectTrigger>
                          <SelectContent>
                            {(sites ?? []).map((s) => (
                              <SelectItem key={s.code} value={s.code}>
                                {s.name} ({s.code})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                            แผนก
                          </Label>
                          <Input
                            value={actDept}
                            onChange={(e) => setActDept(e.target.value)}
                            placeholder="เช่น IT"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                            รหัสแผนก
                          </Label>
                          <Input
                            value={actDeptCode}
                            onChange={(e) => setActDeptCode(e.target.value)}
                            placeholder="เช่น IT-001"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                            อาคาร
                          </Label>
                          <Input
                            value={actBuilding}
                            onChange={(e) => setActBuilding(e.target.value)}
                            placeholder="เช่น อาคาร A"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                            ชั้น
                          </Label>
                          <Input
                            value={actFloor}
                            onChange={(e) => setActFloor(e.target.value)}
                            placeholder="เช่น 3"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                          ตำแหน่ง/ห้อง
                        </Label>
                        <Input
                          value={actLocation}
                          onChange={(e) => setActLocation(e.target.value)}
                          placeholder="เช่น ห้อง 301"
                        />
                      </div>
                    </div>
                  )}

                  {/* Meter reading (if meterable device) */}
                  {cfg.needMeter && device?.meterRequired && (
                    <div className="space-y-3 rounded-md border border-[#0d9488]/30 bg-[#0d9488]/5 p-3 dark:border-[#14b8a6]/30 dark:bg-[#14b8a6]/10">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0d9488] dark:text-[#14b8a6]">
                        <Gauge className="h-3.5 w-3.5" />
                        จดมิเตอร์ก่อนเปลี่ยนสถานะ
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        ค่ามิเตอร์ล่าสุด:{' '}
                        <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                          {(device.lastMeterReading ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                            เลขปิดมิเตอร์ BW (ขาวดำ)
                          </Label>
                          <Input
                            type="number"
                            value={actMeterBw}
                            onChange={(e) => setActMeterBw(e.target.value)}
                            placeholder="0"
                            className="font-mono"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                            มิเตอร์ Color (สี)
                          </Label>
                          <Input
                            type="number"
                            value={actMeterColor}
                            onChange={(e) => setActMeterColor(e.target.value)}
                            placeholder="0 (ถ้ามี)"
                            className="font-mono"
                          />
                        </div>
                      </div>
                      <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={actMeterSkipAcknowledged}
                          onChange={(e) => setActMeterSkipAcknowledged(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#0d9488] focus:ring-[#0d9488]"
                        />
                        <span>
                          ไม่มีค่ามิเตอร์ในรายการนี้ และยืนยันว่า “มิเตอร์นับต่อเนื่อง”
                        </span>
                      </label>
                      {/* Tells staff, before they commit, that this action closes
                          the month chosen in "วันที่ทำรายการ" — so a device moved
                          mid-cycle does not have to be re-entered on the meter
                          screen. The unread list keys off readingMonth only, so
                          this device drops off the pending list immediately. */}
                      {closingMonthLabel && !actMeterSkipAcknowledged && (
                        <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300">
                          <span className="font-medium">ปิดมิเตอร์เดือน {closingMonthLabel}</span>
                          <span className="block text-[11px] opacity-90">
                            เครื่องนี้จะถูกนับว่าจดครบเดือน {closingMonthLabel} แล้ว
                            ไม่ต้องเข้าไปจดมิเตอร์อีกรอบ
                          </span>
                        </div>
                      )}
                      {/* P1-2 (LIFECYCLE-METER): dedicated "เหตุผลที่ไม่จดมิเตอร์" textarea.
                          Shown only when the user checks "มิเตอร์นับต่อเนื่อง".
                          Separates the audit "why I skipped the meter" from the
                          lifecycle "why I'm moving/disposing this device".

                          Q4: checking the box no longer leaves the month
                          un-recorded. The route writes a carry-forward (or
                          operator-averaged) closing reading so the month is
                          actually closed — but only if the operator also says
                          WHICH number to use and WHY. */}
                      {actMeterSkipAcknowledged && (
                        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-800 dark:bg-amber-950/40">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs font-medium text-amber-800 dark:text-amber-300">
                                ใช้เลขประมาณ BW
                              </Label>
                              <Input
                                type="number"
                                value={actEstimatedBw}
                                onChange={(e) => setActEstimatedBw(e.target.value)}
                                placeholder={String(device.lastMeterReading ?? 0)}
                                className="h-9 border-amber-300 bg-white font-mono text-sm dark:border-amber-700 dark:bg-slate-900"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs font-medium text-amber-800 dark:text-amber-300">
                                ใช้เลขประมาณสี
                              </Label>
                              <Input
                                type="number"
                                value={actEstimatedColor}
                                onChange={(e) => setActEstimatedColor(e.target.value)}
                                placeholder={String(device.lastMeterColor ?? 0)}
                                className="h-9 border-amber-300 bg-white font-mono text-sm dark:border-amber-700 dark:bg-slate-900"
                              />
                            </div>
                          </div>
                          <p className="text-[11px] text-amber-700 dark:text-amber-300/90">
                            เว้นว่างไว้ = ใช้เลขเดิม ({(device.lastMeterReading ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')})
                            {' '}· ถ้าใส่เลขเอง ระบบจะคิดหน้าที่ใช้จริงเป็นผลต่างจากเลขเดิม
                          </p>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-medium text-amber-700 dark:text-amber-400">
                              เหตุผลที่ไม่ได้อ่านเครื่อง <span className="text-rose-500">*</span>
                            </Label>
                            <Textarea
                              value={actSkipMeterReason}
                              onChange={(e) => setActSkipMeterReason(e.target.value)}
                              placeholder="เช่น เครื่องพัง จดไม่ได้ / ใช้ค่าเฉลี่ยของเครื่อง / ส่งซ่อมก่อนจด"
                              rows={2}
                              className="border-amber-300 text-xs focus:border-amber-500 dark:border-amber-700 dark:bg-slate-900"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Reason / remark */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      หมายเหตุ / เหตุผล
                    </Label>
                    <Textarea
                      value={actReason}
                      onChange={(e) => setActReason(e.target.value)}
                      placeholder={
                        actionId === 'dispose'
                          ? 'เช่น ขายให้บริษัท A / ทิ้ง / เลิกใช้'
                          : actionId === 'send_repair'
                            ? 'เช่น เครื่องพิมพ์ไม่ออก / จอดำ'
                            : actionId === 'return_device'
                              ? 'เช่น คืนลูกค้า / คืนผู้ขายหลังหมดสัญญา'
                              : actionId === 'transfer'
                                ? 'เช่น ย้ายไปใช้ที่แผนกใหม่'
                                : 'หมายเหตุเพิ่มเติม'
                      }
                      rows={2}
                    />
                  </div>

                  {/* Disposal warning */}
                  {actionId === 'dispose' && (
                    <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
                      ⚠️ การจำหน่ายเป็นการปิดงานถาวร — หลังจำหน่ายเครื่องจะไม่สามารถใช้งานได้อีก (ยกเว้นติดตั้งใหม่)
                    </div>
                  )}

                  {/* ── Replace-on-Withdraw section ──
                      Only shown for withdraw-type actions (send_repair, uninstall,
                      dispose, return_device). Lets the user specify a replacement
                      device that will be installed at the same location in one
                      atomic transaction — saves doing 2 separate operations. */}
                  {(actionId === 'send_repair' || actionId === 'uninstall' || actionId === 'dispose' || actionId === 'return_device') && (
                    <div className="rounded-lg border border-[#f97316]/30 bg-[#f97316]/5 p-3 dark:border-[#fb923c]/30 dark:bg-[#fb923c]/5">
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={actReplacementEnabled}
                          onChange={(e) => setActReplacementEnabled(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-[#f97316] focus:ring-[#f97316] dark:border-slate-600 dark:bg-slate-800"
                        />
                        <PackageCheck className="h-4 w-4 text-[#f97316]" />
                        <span className="font-medium text-slate-700 dark:text-slate-200">
                          ติดตั้งเครื่องทดแทนในตำแหน่งเดิม
                        </span>
                      </label>
                      <p className="mt-1 pl-6 text-xs text-slate-500 dark:text-slate-400">
                        ถอนเครื่องนี้ + ติดตั้งเครื่องทดแทนที่ตำแหน่งเดิมในคลิกเดียว — ไม่ต้องเพิ่มเครื่องใหม่แยก
                      </p>

                      {actReplacementEnabled && (
                        <div className="mt-3 space-y-3 border-t border-[#f97316]/20 pt-3 dark:border-[#fb923c]/20">
                          {/* Mode toggle */}
                          <div className="flex gap-1 rounded-md bg-slate-100 p-1 dark:bg-slate-800">
                            <button
                              type="button"
                              onClick={() => setActReplacementMode('existing')}
                              className={
                                'flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors ' +
                                (actReplacementMode === 'existing'
                                  ? 'bg-white text-[#f97316] shadow-sm dark:bg-slate-700 dark:text-[#fb923c]'
                                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100')
                              }
                            >
                              <PackageCheck className="h-3.5 w-3.5" />
                              ใช้เครื่องที่มีในระบบ
                            </button>
                            <button
                              type="button"
                              onClick={() => setActReplacementMode('new')}
                              className={
                                'flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors ' +
                                (actReplacementMode === 'new'
                                  ? 'bg-white text-[#f97316] shadow-sm dark:bg-slate-700 dark:text-[#fb923c]'
                                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100')
                              }
                            >
                              <PackagePlus className="h-3.5 w-3.5" />
                              สร้างเครื่องใหม่
                            </button>
                          </div>

                          {/* Asset code input + scan button */}
                          <div className="space-y-1.5">
                            <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                              รหัสทรัพย์สินเครื่องทดแทน *
                            </Label>
                            <div className="flex gap-2">
                              <div className="relative flex-1">
                                <Input
                                  value={actReplacementAssetCode}
                                  onChange={(e) => setActReplacementAssetCode(e.target.value)}
                                  placeholder={
                                    actReplacementMode === 'existing'
                                      ? 'ค้นหา / สแกนรหัสทรัพย์สิน หรือ Serial No.'
                                      : 'รหัสทรัพย์สินใหม่ (เช่น 2379)'
                                  }
                                  className="pr-9"
                                />
                                <button
                                  type="button"
                                  onClick={() => useAppStore.getState().setQrScannerOpen(true)}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-[#f97316] dark:hover:bg-slate-800"
                                  title="สแกน QR / บาร์โค้ด"
                                  aria-label="สแกน QR / บาร์โค้ดเครื่องทดแทน"
                                >
                                  <ScanLine className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                            {/* Lookup feedback (existing mode) */}
                            {actReplacementMode === 'existing' && actReplacementLookup.state !== 'idle' && (
                              <div className="text-xs">
                                {actReplacementLookup.state === 'searching' && (
                                  <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    กำลังค้นหา...
                                  </span>
                                )}
                                {actReplacementLookup.state === 'found' && (
                                  <span className="flex items-start gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                                    <span>
                                      <strong>{actReplacementLookup.device.assetCode}</strong> — {actReplacementLookup.device.name}
                                      {actReplacementLookup.device.brand && ` (${actReplacementLookup.device.brand} ${actReplacementLookup.device.model ?? ''})`}
                                      <br />
                                      สถานะปัจจุบัน: {actReplacementLookup.device.status} @ {actReplacementLookup.device.site}
                                    </span>
                                  </span>
                                )}
                                {actReplacementLookup.state === 'not-found' && (
                                  <span className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                                    <span>
                                      ไม่พบในระบบ — หากต้องการสร้างใหม่ ให้เปลี่ยนเป็นโหมด "สร้างเครื่องใหม่"
                                    </span>
                                  </span>
                                )}
                                {actReplacementLookup.state === 'error' && (
                                  <span className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                                    <AlertCircle className="h-3.5 w-3.5" />
                                    ผิดพลาด: {actReplacementLookup.message}
                                  </span>
                                )}
                              </div>
                            )}
                            {/* New mode — show hint */}
                            {actReplacementMode === 'new' && (
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                ระบบจะสร้างอุปกรณ์ใหม่อัตโนมัติที่ตำแหน่งเดิม — สามารถแก้ไขรายละเอียดเพิ่มเติมได้ภายหลัง
                              </p>
                            )}
                          </div>

                          {/* Extra fields (new mode only) */}
                          {actReplacementMode === 'new' && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <Label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                  Serial No.
                                </Label>
                                <Input
                                  value={actReplacementSerial}
                                  onChange={(e) => setActReplacementSerial(e.target.value)}
                                  placeholder="ไม่บังคับ"
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                  ชื่อเครื่อง
                                </Label>
                                <Input
                                  value={actReplacementName}
                                  onChange={(e) => setActReplacementName(e.target.value)}
                                  placeholder={`อุปกรณ์ทดแทน ${device?.assetCode ?? ''}`}
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                  ยี่ห้อ
                                </Label>
                                <Input
                                  value={actReplacementBrand}
                                  onChange={(e) => setActReplacementBrand(e.target.value)}
                                  placeholder="สืบทอดจากเครื่องเดิม"
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                  รุ่น
                                </Label>
                                <Input
                                  value={actReplacementModel}
                                  onChange={(e) => setActReplacementModel(e.target.value)}
                                  placeholder="สืบทอดจากเครื่องเดิม"
                                  className="h-8 text-sm"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setActionOpen(false)}
                    disabled={actioning}
                  >
                    ยกเลิก
                  </Button>
                  <Button
                    onClick={confirmAction}
                    disabled={
                      actioning ||
                      (cfg.needStatusSelect && !actCustomStatus) ||
                      (cfg.needLoc && !actSite)
                    }
                    className={
                      actionId === 'dispose'
                        ? 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950'
                        : actionId === 'send_repair'
                          ? 'bg-amber-600 text-white hover:bg-amber-700 focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950'
                          : 'bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950'
                    }
                  >
                    {actioning ? (
                      <>
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        กำลังบันทึก...
                      </>
                    ) : (
                      <>ยืนยัน — {cfg.label}</>
                    )}
                  </Button>
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>
    </Sheet>
  )
}
