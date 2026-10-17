'use client'

/**
 * DeviceAccessoriesSection — ส่วนจัดการ "อุปกรณ์ในชุด" (รวมทั้งอุปกรณ์ต่อพ่วง + อุปกรณ์ลูกในชุด)
 *
 * แสดงใน device detail (desktop + mobile)
 * ฟีเจอร์:
 *   - แสดงรายการอุปกรณ์ต่อพ่วงทั้งหมดของอุปกรณ์นี้
 *   - เพิ่มอุปกรณ์ต่อพ่วงใหม่
 *   - แก้ไข / ลบ
 *   - เปลี่ยนสถานะ (Active → Inactive → Disposed)
 *   - พิมพ์สติกเกอร์ (StickerPrintDialog) — สติกเกอร์ใช้ QR เฉพาะของ accessory
 *     (เข้า /qr/a/{shortId}?action=view) และข้อมูลอุปกรณ์ต่อพ่วงผสมกับข้อมูล
 *     อุปกรณ์หลัก (site/department/building/floor/…)
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, Pencil, Keyboard, Mouse, Monitor, Cable, Battery, Usb, Printer, Package, ChevronsUpDown, Check } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Popover, PopoverTrigger, PopoverContent,
} from '@/components/ui/popover'
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from '@/components/ui/command'
import { useAuthStore } from '@/store/auth-store'
import { useQueryClient } from '@tanstack/react-query'
import { generateAccessoryQrUrl } from '@/lib/smart-qr'
import { StickerPrintDialog } from './sticker-print-dialog'
import type { Device } from './types'
import { bearerHeaders } from '@/lib/http-headers'

// ── Accessory types ──────────────────────────────────────────────────
const ACCESSORY_TYPES = [
  { value: 'KEYBOARD', label: 'คีย์บอร์ด', icon: Keyboard },
  { value: 'MOUSE', label: 'เมาส์', icon: Mouse },
  { value: 'MONITOR', label: 'จอภาพ', icon: Monitor },
  { value: 'SCANNER', label: 'สแกนเนอร์เสริม', icon: Package },
  { value: 'CABLE', label: 'สาย / แลน', icon: Cable },
  { value: 'ADAPTER', label: 'อะแดปเตอร์', icon: Cable },
  { value: 'UPS', label: 'UPS / สำรองไฟ', icon: Battery },
  { value: 'HUB', label: 'USB Hub', icon: Usb },
  { value: 'PRINTHEAD', label: 'หัวพิมพ์', icon: Printer },
  { value: 'TRAY', label: 'ถาดกระดาษเสริม', icon: Package },
  { value: 'OTHER', label: 'อื่นๆ', icon: Package },
]

const ACCESSORY_STATUSES = [
  { value: 'Active', label: 'ใช้งานอยู่', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'Inactive', label: 'ไม่ใช้งาน', color: 'bg-slate-100 text-slate-600' },
  { value: 'In Repair', label: 'ส่งซ่อม', color: 'bg-amber-100 text-amber-700' },
  { value: 'Disposed', label: 'ตัดจ่าย', color: 'bg-rose-100 text-rose-700' },
]

function getTypeMeta(type: string) {
  return ACCESSORY_TYPES.find((t) => t.value === type) ?? ACCESSORY_TYPES[ACCESSORY_TYPES.length - 1]
}

function getStatusMeta(status: string) {
  return ACCESSORY_STATUSES.find((s) => s.value === status) ?? ACCESSORY_STATUSES[0]
}

// ── Device Set child type (mirrors DeviceSetChild in device-set-children-section.tsx) ──
export interface DeviceSetChildLite {
  id: string
  assetCode: string
  name: string
  brand?: string | null
  model?: string | null
  type: string
  status: string
  setPosition?: number | null
}

// ── Status → color mapping (uses normalizeStatus for canonical form) ──
function statusBadgeClassFor(canonical: string): string {
  switch (canonical) {
    case 'Active':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800'
    case 'Spare':
      return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800'
    case 'In Repair':
      return 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800'
    case 'Inactive':
      return 'bg-slate-200 text-slate-700 border-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600'
    case 'Retired':
    case 'Disposed':
      return 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800'
    case 'Lost':
      return 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800'
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
  }
}

function statusLabelFor(canonical: string): string {
  const map: Record<string, string> = {
    Active: 'ใช้งานอยู่',
    Inactive: 'ไม่ใช้งาน',
    'In Repair': 'ส่งซ่อม',
    Spare: 'สำรอง',
    Retired: 'ปลดระวาง',
    Disposed: 'จำหน่าย',
    Lost: 'สูญหาย',
  }
  return map[canonical] ?? canonical
}

// ── Component ────────────────────────────────────────────────────────
export function DeviceAccessoriesSection({
  deviceId,
  parentDevice,
}: {
  deviceId: string
  /**
   * Parent device data — used to build the sticker print payload (we mix
   * accessory fields with parent device's site/department/building/etc).
   * Optional for backward-compat (the section still works without it, just
   * without the sticker print feature).
   */
  parentDevice?: Pick<
    Device,
    | 'id'
    | 'assetCode'
    | 'assetSiteCode'
    | 'site'
    | 'building'
    | 'floor'
    | 'department'
    | 'departmentCode'
    | 'location'
  > | null
}) {
  const token = useAuthStore((s) => s.token)
  const qc = useQueryClient()
  const [accessories, setAccessories] = React.useState<Array<{
    id: string; accessoryType: string; brand: string | null; model: string | null
    serialNumber: string | null; status: string; installedDate: string | null; remark: string | null
  }>>([])
  const [loading, setLoading] = React.useState(true)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  // ── Sticker print dialog state ──
  // When the user clicks the Printer icon on an accessory row, we build a
  // fake "Device" payload for the StickerPrintDialog and open it. The
  // qrContentFor prop encodes the accessory's smart-qr URL.
  const [stickerOpen, setStickerOpen] = React.useState(false)
  const [stickerDevices, setStickerDevices] = React.useState<Device[]>([])

  // ── Dialog mode: 'new' = create DeviceAccessory, 'existing' = link existing Device ──
  const [mode, setMode] = React.useState<'new' | 'existing'>('new')

  // ── "new" mode form state ──
  const [formType, setFormType] = React.useState('KEYBOARD')
  const [formBrand, setFormBrand] = React.useState('')
  const [formModel, setFormModel] = React.useState('')
  const [formSerial, setFormSerial] = React.useState('')
  const [formStatus, setFormStatus] = React.useState('Active')
  const [formRemark, setFormRemark] = React.useState('')

  // ── "existing" mode: device search + selected child ──
  const [selectedChildId, setSelectedChildId] = React.useState<string>('')
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [searchTerm, setSearchTerm] = React.useState('')
  const [searchResults, setSearchResults] = React.useState<Device[]>([])
  const [searchLoading, setSearchLoading] = React.useState(false)

  // ── Child devices (linked via parentDeviceId) ──
  // Devices in the same "ชุด" are full Device rows (parentDeviceId = this
  // device), as opposed to DeviceAccessory rows (peripherals). Both are
  // listed by this section so `totalCount` and the empty state reflect both.
  //
  // Loaded from `GET /api/devices?parentDeviceId=<id>` (the same endpoint +
  // react-query key the device detail sheet uses), so linking/unlinking a
  // child invalidates both caches below and stays consistent.
  const [childDevices, setChildDevices] = React.useState<Device[]>([])
  const [childrenLoading, setChildrenLoading] = React.useState(false)

  const loadChildren = React.useCallback(async () => {
    if (!deviceId) return
    setChildrenLoading(true)
    try {
      const res = await fetch(
        `/api/devices?parentDeviceId=${encodeURIComponent(deviceId)}&limit=100`,
        { headers: bearerHeaders(token) },
      )
      if (!res.ok) return
      const json = await res.json()
      setChildDevices((json.devices ?? []) as Device[])
    } catch {
      // silent fail — accessories list is the primary content of this section
    } finally {
      setChildrenLoading(false)
    }
  }, [deviceId, token])

  const totalCount = accessories.length + (childDevices?.length ?? 0)

  // Load accessories
  const loadAccessories = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/devices/${deviceId}/accessories`, {
        headers: bearerHeaders(token),
      })
      if (!res.ok) throw new Error('โหลดไม่สำเร็จ')
      const data = await res.json()
      setAccessories(data.accessories ?? [])
    } catch {
      // silent fail
    } finally {
      setLoading(false)
    }
  }, [deviceId, token])

  /**
   * Refresh everything this section owns, plus the caches the parent
   * `device-detail-sheet` keeps for children and the device list, so a
   * link/unlink is reflected everywhere at once.
   */
  const refreshAll = React.useCallback(() => {
    loadAccessories()
    loadChildren()
    qc.invalidateQueries({ queryKey: ['device-children', deviceId] })
    qc.invalidateQueries({ queryKey: ['devices'] })
  }, [loadAccessories, loadChildren, qc, deviceId])

  React.useEffect(() => {
    loadAccessories()
    loadChildren()
  }, [loadAccessories, loadChildren])

  // ── Device search (debounced) for "existing" mode ──
  // ใช้ microtask defer (Promise.resolve().then) สำหรับ setState ใน effect body
  // เพื่อหลีกเลี่ยง react-hooks/set-state-in-effect warning (ทำตามรูปแบบใน
  // device-set-children-section.tsx)
  React.useEffect(() => {
    if (!searchOpen || searchTerm.trim().length === 0) {
      // Defer the clear so it doesn't run synchronously in the effect body
      let cancelled = false
      Promise.resolve().then(() => {
        if (!cancelled) {
          setSearchResults([])
          setSearchLoading(false)
        }
      })
      return () => {
        cancelled = true
      }
    }
    let cancelled = false
    const handle = setTimeout(async () => {
      if (cancelled) return
      setSearchLoading(true)
      try {
        const params = new URLSearchParams({
          search: searchTerm.trim(),
          limit: '20',
          page: '1',
        })
        const res = await fetch(`/api/devices?${params}`, {
          headers: bearerHeaders(token),
        })
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled) setSearchResults((json.devices as Device[]) ?? [])
      } catch {
        if (!cancelled) setSearchResults([])
      } finally {
        if (!cancelled) setSearchLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [searchOpen, searchTerm, token])

  function openAdd() {
    setEditingId(null)
    setMode('new')
    setFormType('KEYBOARD')
    setFormBrand('')
    setFormModel('')
    setFormSerial('')
    setFormStatus('Active')
    setFormRemark('')
    setSelectedChildId('')
    setSearchTerm('')
    setSearchResults([])
    setDialogOpen(true)
  }

  function openEdit(acc: typeof accessories[0]) {
    setEditingId(acc.id)
    setMode('new')
    setFormType(acc.accessoryType)
    setFormBrand(acc.brand ?? '')
    setFormModel(acc.model ?? '')
    setFormSerial(acc.serialNumber ?? '')
    setFormStatus(acc.status)
    setFormRemark(acc.remark ?? '')
    setDialogOpen(true)
  }

  async function handleSave() {
    try {
      if (mode === 'existing') {
        // ── Link an existing Device as a child of this device ──
        if (!selectedChildId) {
          toast.error('กรุณาเลือกอุปกรณ์ที่จะเพิ่มเข้าชุด')
          return
        }
        if (selectedChildId === deviceId) {
          toast.error('ไม่สามารถเพิ่มอุปกรณ์ตัวเองเข้าชุดได้')
          return
        }
        const res = await fetch(`/api/devices/${selectedChildId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ parentDeviceId: deviceId }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => null)
          throw new Error(err?.error ?? 'เพิ่มเข้าชุดไม่สำเร็จ')
        }
        toast.success('เพิ่มอุปกรณ์เข้าชุดเรียบร้อย')
        setDialogOpen(false)
        setSelectedChildId('')
        refreshAll()
        return
      }

      // ── "new" mode: create/update a DeviceAccessory row ──
      const payload = {
        accessoryType: formType,
        brand: formBrand.trim() || null,
        model: formModel.trim() || null,
        serialNumber: formSerial.trim() || null,
        status: formStatus,
        remark: formRemark.trim() || null,
      }

      if (editingId) {
        // Update
        const res = await fetch(`/api/devices/${deviceId}/accessories/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('แก้ไขไม่สำเร็จ')
        toast.success('แก้ไขอุปกรณ์ต่อพ่วงเรียบร้อย')
      } else {
        // Create
        const res = await fetch(`/api/devices/${deviceId}/accessories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('เพิ่มไม่สำเร็จ')
        toast.success('เพิ่มอุปกรณ์ต่อพ่วงเรียบร้อย')
      }

      setDialogOpen(false)
      loadAccessories()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('ยืนยันลบอุปกรณ์ต่อพ่วงนี้?')) return
    try {
      const res = await fetch(`/api/devices/${deviceId}/accessories/${id}`, {
        method: 'DELETE',
        headers: bearerHeaders(token),
      })
      if (!res.ok) throw new Error('ลบไม่สำเร็จ')
      toast.success('ลบเรียบร้อย')
      loadAccessories()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ลบไม่สำเร็จ')
    }
  }

  /**
   * Open the StickerPrintDialog for a single accessory.
   *
   * Builds a "fake" Device payload that mixes accessory fields (brand, model,
   * serialNumber, type) with the parent device's location fields (site,
   * building, floor, department). The assetCode is set to
   * `<parent.assetCode>-A<position>` so the printed label clearly identifies
   * it as an accessory of the parent device.
   *
   * The QR content is overridden via the `qrContentFor` prop to encode the
   * accessory's Smart QR URL (/qr/a/{shortId}?action=view) instead of the
   * parent device's asset code.
   */
  function openAccessorySticker(acc: typeof accessories[0], position: number) {
    if (!parentDevice) {
      toast.error('ไม่พบข้อมูลอุปกรณ์หลัก — ไม่สามารถพิมพ์สติกเกอร์ได้')
      return
    }
    const typeMeta = getTypeMeta(acc.accessoryType)
    // Build a "fake" Device payload for the StickerPrintDialog.
    // The StickerPrintDialog expects Device-shaped objects, so we cast via
    // `as unknown as Device` after filling in the fields it reads.
    const fakeDevice = {
      id: acc.id,
      // Suffix the parent's assetCode with `-A1`, `-A2`, … to keep the
      // accessory visually associated with its parent on the printed label.
      assetCode: `${parentDevice.assetCode}-A${position}`,
      name: typeMeta.label,
      brand: acc.brand ?? '',
      model: acc.model ?? '',
      type: typeMeta.label,
      serialNumber: acc.serialNumber ?? '',
      // Force "Active" status so the dialog's disposed-device filter doesn't
      // hide the accessory (accessory status uses the same vocabulary).
      status: 'Active',
      site: parentDevice.site ?? '',
      department: parentDevice.department ?? null,
      departmentCode: parentDevice.departmentCode ?? null,
      assetSiteCode: parentDevice.assetSiteCode ?? null,
      purchaseDate: acc.installedDate ?? null,
    } as unknown as Device

    setStickerDevices([fakeDevice])
    setStickerOpen(true)
  }

  const showEmptyState =
    !loading &&
    !childrenLoading &&
    accessories.length === 0 &&
    (childDevices?.length ?? 0) === 0

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Usb className="h-4 w-4 text-[#f97316]" />
          จัดการอุปกรณ์ต่อพ่วง ({totalCount})
        </CardTitle>
        <Button size="sm" variant="outline" onClick={openAdd} className="h-7 text-xs">
          <Plus className="mr-1 h-3.5 w-3.5" /> เพิ่ม
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading || childrenLoading ? (
          <p className="text-center text-xs text-muted-foreground py-4">กำลังโหลด...</p>
        ) : showEmptyState ? (
          <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-200 py-6 text-center dark:border-slate-700">
            <Package className="h-8 w-8 text-slate-300 dark:text-slate-400" />
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              ยังไม่มีอุปกรณ์ในชุด
            </span>
            <span className="px-6 text-[10px] text-slate-400 dark:text-slate-500">
              กด "เพิ่ม" เพื่อสร้างอุปกรณ์ต่อพ่วงใหม่ หรือเลือกอุปกรณ์ที่มีในระบบมาผูกเป็นชุด
            </span>
          </div>
        ) : (
          <>
          {accessories.map((acc, idx) => {
            const typeMeta = getTypeMeta(acc.accessoryType)
            const statusMeta = getStatusMeta(acc.status)
            const Icon = typeMeta.icon
            const accessoryPosition = idx + 1
            return (
              <div
                key={acc.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-300">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      {typeMeta.label}
                    </span>
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800">
                      🔌 ต่อพ่วง
                    </Badge>
                    <Badge variant="outline" className={`px-1.5 py-0 text-[10px] ${statusMeta.color}`}>
                      {statusMeta.label}
                    </Badge>
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {acc.brand} {acc.model}
                    {acc.serialNumber && ` · S/N: ${acc.serialNumber}`}
                    {acc.installedDate && ` · ติดตั้ง: ${acc.installedDate}`}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {/* NOTE: `size` accepts 'icon' | 'sm' | 'default' | 'lg' — 'ghost'
                      is a *variant*, not a size. These are square icon buttons,
                      so 'icon' is the intended size. */}
                  <Button size="icon" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(acc)} title="แก้ไข">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-[#f97316]"
                    onClick={() => openAccessorySticker(acc, accessoryPosition)}
                    disabled={!parentDevice}
                    title="พิมพ์สติกเกอร์อุปกรณ์ต่อพ่วง"
                  >
                    <Printer className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 p-0 text-rose-500" onClick={() => handleDelete(acc.id)} title="ลบ">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
          </>
        )}
      </CardContent>

      {/* Add/Edit Dialog — unified for both "new accessory" + "link existing device" */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? 'แก้ไขอุปกรณ์ต่อพ่วง'
                : 'จัดการอุปกรณ์ต่อพ่วง'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              สำหรับจัดการข้อมูลอุปกรณ์ต่อพ่วง — "อุปกรณ์" สำหรับบันทึกข้อมูลอุปกรณ์ต่อพ่วง (ไม่มีชุด/ซื้อเป็นชุด),
              "ชุดอุปกรณ์" สำหรับบันทึก assetCode ของชุด
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* ── Mode toggle (hidden when editing an existing accessory) ── */}
            {!editingId && (
              <div className="space-y-1.5">
                <Label className="text-xs">ประเภทข้อมูล</Label>
                <RadioGroup
                  value={mode}
                  onValueChange={(v) => setMode(v as 'new' | 'existing')}
                  className="grid grid-cols-1 gap-2"
                >
                  <label
                    htmlFor="mode-new"
                    className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-xs transition-colors ${
                      mode === 'new'
                        ? 'border-[#f97316] bg-orange-50 dark:bg-orange-950/30'
                        : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <RadioGroupItem value="new" id="mode-new" className="mt-0.5" />
                    <div className="min-w-0">
                      <div className="font-medium text-slate-700 dark:text-slate-200">
                        📁 อุปกรณ์ (ไม่ซื้อเป็นชุด)
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        สำหรับ จัดการ/เพิ่ม/แก้ไข/serial ข้อมูลอุปกรณ์ต่อพ่วง — ใช้ตาราง DeviceAccessory
                      </div>
                    </div>
                  </label>
                  <label
                    htmlFor="mode-existing"
                    className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-xs transition-colors ${
                      mode === 'existing'
                        ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30'
                        : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <RadioGroupItem value="existing" id="mode-existing" className="mt-0.5" />
                    <div className="min-w-0">
                      <div className="font-medium text-slate-700 dark:text-slate-200">
                        🔗 ชุดอุปกรณ์ต่อพ่วง
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        สำหรับ assetCode/serial/name ของ Device ที่เป็นชุด — ใช้ตาราง Device Set
                      </div>
                    </div>
                  </label>
                </RadioGroup>
              </div>
            )}

            {/* ── Mode "new": accessory form ── */}
            {mode === 'new' && (
              <>
                {/* Type */}
                <div className="space-y-1.5">
                  <Label className="text-xs">ประเภท *</Label>
                  <Select value={formType} onValueChange={setFormType}>
                    <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ACCESSORY_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Brand + Model */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">ชื่อ</Label>
                    <Input value={formBrand} onChange={(e) => setFormBrand(e.target.value)} placeholder="Logitech" className="text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">รุ่น</Label>
                    <Input value={formModel} onChange={(e) => setFormModel(e.target.value)} placeholder="K380" className="text-sm" />
                  </div>
                </div>
                {/* Serial + Status */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Serial Number</Label>
                    <Input value={formSerial} onChange={(e) => setFormSerial(e.target.value)} placeholder="SN..." className="text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">สถานะ</Label>
                    <Select value={formStatus} onValueChange={setFormStatus}>
                      <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ACCESSORY_STATUSES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {/* Remark */}
                <div className="space-y-1.5">
                  <Label className="text-xs">หมายเหตุ</Label>
                  <Input value={formRemark} onChange={(e) => setFormRemark(e.target.value)} placeholder="หมายเหตุ (ถ้ามี)" className="text-sm" />
                </div>
              </>
            )}

            {/* ── Mode "existing": device search ── */}
            {mode === 'existing' && !editingId && (
              <div className="space-y-2">
                <Label className="text-xs">ค้นหาอุปกรณ์ที่จะเพิ่มเข้าชุด</Label>
                <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between text-sm"
                    >
                      {selectedChildId ? (
                        <span className="truncate">
                          <span className="font-mono font-semibold text-[#f97316]">
                            {searchResults.find((d) => d.id === selectedChildId)?.assetCode ?? selectedChildId}
                          </span>
                          {' — '}
                          <span className="text-slate-600 dark:text-slate-300">
                            {searchResults.find((d) => d.id === selectedChildId)?.name ?? '(โหลดชื่อ...)'}
                          </span>
                        </span>
                      ) : (
                        <span className="text-slate-400">พิมพ์รหัสทรัพย์สิน / ชื่อ / Serial...</span>
                      )}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[360px] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="พิมพ์เพื่อค้นหา..."
                        value={searchTerm}
                        onValueChange={setSearchTerm}
                      />
                      <CommandList>
                        <CommandEmpty>
                          {searchLoading
                            ? 'กำลังค้น...'
                            : searchTerm.trim().length === 0
                              ? 'เริ่มพิมพ์เพื่อค้นหาอุปกรณ์'
                              : 'ไม่พบอุปกรณ์ — ลองพิมพ์ใหม่'}
                        </CommandEmpty>
                        <CommandGroup>
                          {searchResults
                            .filter((d) => d.id !== deviceId) // exclude self
                            .map((d) => (
                              <CommandItem
                                key={d.id}
                                value={`${d.assetCode} ${d.name} ${d.serialNumber ?? ''}`}
                                onSelect={() => {
                                  setSelectedChildId(d.id)
                                  setSearchOpen(false)
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
                                {d.id === selectedChildId && <Check className="ml-auto h-4 w-4" />}
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {selectedChildId && (
                  <p className="text-[11px] text-muted-foreground">
                    เมื่อกด "เพิ่ม" ระบบจะตั้งค่า <span className="font-mono">parentDeviceId</span> ของอุปกรณ์ที่เลือก
                    ให้ชี้มาที่เครื่องนี้ (ผ่าน PUT /api/devices/&lt;id&gt;)
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>ยกเลิก</Button>
            <Button
              onClick={handleSave}
              disabled={mode === 'existing' && !selectedChildId}
              className="bg-[#f97316] text-white hover:bg-[#ea580c] disabled:opacity-50"
            >
              {editingId ? 'บันทึก' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sticker print dialog (per-accessory) */}
      <StickerPrintDialog
        open={stickerOpen}
        onOpenChange={setStickerOpen}
        devices={stickerDevices}
        dialogTitle={
          <span className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-[#f97316]" />
            🖨️ พิมพ์สติกเกอร์อุปกรณ์ต่อพ่วง
          </span>
        }
        dialogDescription="QR บนสติกเกอร์จะลิงก์ไปยังหน้าดูข้อมูลอุปกรณ์ต่อพ่วงโดยตรง (/qr/a/{shortId}?action=view)"
        // Override QR content — encode the accessory's Smart QR URL instead of
        // the asset code. The fake device's `id` is the accessory's id, so we
        // can resolve the URL from the device payload here.
        qrContentFor={(d) => generateAccessoryQrUrl(d.id, 'view')}
      />
    </Card>
  )
}
