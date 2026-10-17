/**
 * QuickAddDeviceDialog — SPRINT-3 #1 (UX Simplification Map)
 *
 * แทนที่จะเปิด full-page form (20+ fields) ทุกครั้ง, ผู้ใช้สามารถเพิ่มอุปกรณ์
 * ผ่าน dialog เล็กๆ ที่แสดงเฉพาะ 5 fields หลัก:
 *   1. assetCode (auto-generated, แก้ได้)
 *   2. type (จาก master data)
 *   3. brand (จาก master data)
 *   4. model (จาก master data)
 *   5. site (จาก site attributes)
 *
 * บันทึกแล้วไปเปิด full form เพื่อกรอกข้อมูลเพิ่มเติมได้.
 *
 * ปุ่ม "ขั้นสูง" ใน dialog เปิด full-page form โดยตรง.
 */

'use client'

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Plus, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/store/auth-store'

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const t = useAuthStore.getState()?.token
  if (t) h['Authorization'] = `Bearer ${t}`
  return h
}

interface QuickAddDeviceDialogProps {
  open: boolean
  onClose: () => void
  onCreated?: (deviceId: string) => void
  /** Open the full-page form (advanced mode) */
  onOpenAdvanced?: () => void
}

interface Option {
  code: string
  label: string
}

interface SiteOption {
  id: string
  SiteCode: string
  SiteName: string | null
}

export function QuickAddDeviceDialog({ open, onClose, onCreated, onOpenAdvanced }: QuickAddDeviceDialogProps) {
  const [assetCode, setAssetCode] = React.useState('')
  const [type, setType] = React.useState('')
  const [brand, setBrand] = React.useState('')
  const [model, setModel] = React.useState('')
  const [site, setSite] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [types, setTypes] = React.useState<Option[]>([])
  const [brands, setBrands] = React.useState<Option[]>([])
  const [models, setModels] = React.useState<Option[]>([])
  const [sites, setSites] = React.useState<SiteOption[]>([])

  // Load options when dialog opens
  React.useEffect(() => {
    if (!open) return
    void loadOptions()
    void loadNextAssetCode()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function loadOptions() {
    try {
      const [masterRes, sitesRes] = await Promise.all([
        fetch('/api/itam/master-items', { headers: authHeaders() }),
        fetch('/api/itam/sites', { headers: authHeaders() }),
      ])
      if (masterRes.ok) {
        const j = (await masterRes.json()) as { items?: Array<{ code: string; label: string; category: string }> }
        const items = j.items ?? []
        setTypes(items.filter(i => i.category === 'DeviceType').map(i => ({ code: i.code, label: i.label })))
        setBrands(items.filter(i => i.category === 'Brand').map(i => ({ code: i.code, label: i.label })))
        setModels(items.filter(i => i.category === 'Model').map(i => ({ code: i.code, label: i.label })))
      }
      if (sitesRes.ok) {
        const j = (await sitesRes.json()) as { sites?: SiteOption[] }
        setSites(j.sites ?? [])
      }
    } catch (err) {
      console.error('[QuickAddDevice] loadOptions failed:', err)
    }
  }

  async function loadNextAssetCode() {
    try {
      const res = await fetch('/api/devices/next-asset-code', { headers: authHeaders() })
      if (!res.ok) return
      const j = (await res.json()) as { code?: string | null }
      if (j.code) setAssetCode(j.code)
    } catch (err) {
      console.error('[QuickAddDevice] loadNextAssetCode failed:', err)
    }
  }

  async function handleSave() {
    if (!assetCode || !type || !site) {
      toast.error('กรุณากรอกรหัสอุปกรณ์, ประเภท และสาขา')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          assetCode,
          name: `${brand} ${model}`.trim() || assetCode,
          type,
          brand: brand || undefined,
          model: model || undefined,
          site,
          status: 'active',
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || 'บันทึกไม่สำเร็จ')
      }
      const j = (await res.json()) as { id?: string }
      toast.success(`เพิ่มอุปกรณ์ ${assetCode} แล้ว — คุณสามารถแก้ไขข้อมูลเพิ่มเติมได้`)
      onCreated?.(j.id ?? '')
      // Reset for next time
      setAssetCode('')
      setType('')
      setBrand('')
      setModel('')
      setSite('')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  function handleOpenAdvanced() {
    onClose()
    onOpenAdvanced?.()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-[#f97316]" />
            เพิ่มอุปกรณ์ด่วน
          </DialogTitle>
          <DialogDescription className="text-xs">
            กรอกเฉพาะข้อมูลหลัก 5 ช่อง — บันทึกแล้วแก้ไขรายละเอียดเพิ่มเติมได้ในภายหลัง
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* 1. assetCode */}
          <div className="space-y-1">
            <Label htmlFor="qa-assetCode" className="text-xs">
              รหัสอุปกรณ์ <span className="text-red-500">*</span>
            </Label>
            <Input
              id="qa-assetCode"
              value={assetCode}
              onChange={(e) => setAssetCode(e.target.value)}
              placeholder="เช่น BKK-001"
              className="h-8 text-sm"
            />
          </div>

          {/* 2. type */}
          <div className="space-y-1">
            <Label className="text-xs">
              ประเภท <span className="text-red-500">*</span>
            </Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="เลือกประเภท" />
              </SelectTrigger>
              <SelectContent>
                {types.map((t) => (
                  <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 3. brand + 4. model (side by side on sm+) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">ยี่ห้อ</Label>
              <Select value={brand} onValueChange={setBrand}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="เลือกยี่ห้อ" />
                </SelectTrigger>
                <SelectContent>
                  {brands.map((b) => (
                    <SelectItem key={b.code} value={b.code}>{b.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">รุ่น</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="เลือกรุ่น" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 5. site */}
          <div className="space-y-1">
            <Label className="text-xs">
              สาขา <span className="text-red-500">*</span>
            </Label>
            <Select value={site} onValueChange={setSite}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="เลือกสาขา" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={s.id} value={s.SiteCode}>
                    {s.SiteCode} {s.SiteName ? `— ${s.SiteName}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenAdvanced}
            className="gap-1"
          >
            <Settings2 className="h-3.5 w-3.5" />
            ขั้นสูง
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !assetCode || !type || !site}
            className="gap-1 bg-[#f97316] hover:bg-[#ea580c]"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
