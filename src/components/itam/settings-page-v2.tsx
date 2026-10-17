// Settings patterns module — AssetPatternTab + WoPatternTab.
// Note: the legacy `SettingsPageV2` wrapper component was removed as dead code
// (it was dynamically imported in home-client.tsx but never rendered as JSX).
// 'use client' is set on the line below.

'use client'

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Building2,
  Hash,
  Settings as SettingsIcon,
  Save,
  Plus,
  Check,
  Eye,
  Palette,
  Sparkles,
  FileText,
} from 'lucide-react'

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────
interface OrgProfile {
  appName: string
  appTagline: string
  industryType: string
  logoUrl: string | null
  primaryColor: string
  accentColor: string
  language: string
  timezone: string
  currency: string
  allowExcelImport: boolean
}

interface AssetPattern {
  id: string
  name: string
  pattern: string
  description: string | null
  isActive: boolean
  defaultPrefix: string | null
  seqPadding: number
  seqStart: number
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────
const INDUSTRY_OPTIONS = [
  { value: 'general', label: 'ทั่วไป' },
  { value: 'office', label: 'สำนักงาน' },
  { value: 'corporate', label: 'องค์กร' },
  { value: 'education', label: 'สถาบันการศึกษา' },
  { value: 'government', label: 'หน่วยงานรัฐ' },
  { value: 'healthcare', label: 'สถานพยาบาล' },
  { value: 'industrial', label: 'อุตสาหกรรม' },
]

const TIMEZONE_OPTIONS = [
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Hong_Kong',
  'UTC',
  'Europe/London',
  'America/New_York',
]

const CURRENCY_OPTIONS = [
  { value: 'THB', label: 'THB — บาท' },
  { value: 'USD', label: 'USD — ดอลลาร์สหรัฐ' },
  { value: 'EUR', label: 'EUR — ยูโร' },
]

const SEGMENT_HELP: { seg: string; desc: string; example: string }[] = [
  { seg: '{prefix}', desc: 'คำนำหน้า', example: 'ASSET' },
  { seg: '{seq:N}', desc: 'เลขลำดับ N หลัก', example: '{seq:5} → 00001' },
  { seg: '{year:2|4}', desc: 'ปี', example: '{year:2} → 26' },
  { seg: '{month:2}', desc: 'เดือน', example: '08' },
  { seg: '{dept:N}', desc: 'รหัสแผนก N หลัก', example: '{dept:4} → ACC0' },
  { seg: '{type:N}', desc: 'รหัสประเภท N หลัก', example: '{type:3} → PRT' },
  { seg: '{site:N}', desc: 'รหัสสาขา N หลัก', example: '{site:3} → BKK' },
]

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Render a live preview of the asset number based on the pattern.
 * Replaces each segment with a plausible mock value.
 */
function previewAssetNumber(pattern: string, defaultPrefix?: string | null): string {
  if (!pattern) return ''
  let result = pattern
  const now = new Date()

  const replacements: Record<string, string> = {
    prefix: defaultPrefix || 'ASSET',
    'seq:1': '1',
    'seq:2': '01',
    'seq:3': '001',
    'seq:4': '0001',
    'seq:5': '00001',
    'seq:6': '000001',
    'year:2': String(now.getFullYear()).slice(-2),
    'year:4': String(now.getFullYear()),
    'month:2': String(now.getMonth() + 1).padStart(2, '0'),
    'dept:1': 'A',
    'dept:2': 'AC',
    'dept:3': 'ACC',
    'dept:4': 'ACC0',
    'dept:5': 'ACC00',
    'dept:6': 'ACC000',
    'type:1': 'P',
    'type:2': 'PR',
    'type:3': 'PRT',
    'type:4': 'PRT0',
    'type:5': 'PRT00',
    'type:6': 'PRT000',
    'site:1': 'B',
    'site:2': 'BK',
    'site:3': 'BKK',
    'site:4': 'BKK0',
    'site:5': 'BKK00',
    'site:6': 'BKK000',
  }

  // Replace all known segments
  result = result.replace(/\{([^}]+)\}/g, (_, inner: string) => {
    return replacements[inner] ?? `{${inner}}`
  })

  return result
}

/** Render logo — emoji if short, img if URL, fallback icon */
function LogoPreview({
  logoUrl,
  size = 40,
  background,
}: {
  logoUrl: string | null
  size?: number
  background?: string
}) {
  if (logoUrl && /^https?:\/\//i.test(logoUrl)) {
    return (
      <img
        src={logoUrl}
        alt="logo"
        style={{ width: size, height: size }}
        className="rounded-md object-cover"
      />
    )
  }
  if (logoUrl && logoUrl.trim().length > 0) {
    return (
      <div
        style={{
          width: size,
          height: size,
          background: background || '#f97316',
          fontSize: size * 0.55,
        }}
        className="flex items-center justify-center rounded-md text-white"
      >
        {logoUrl.trim().slice(0, 2)}
      </div>
    )
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        background: background || '#f97316',
      }}
      className="flex items-center justify-center rounded-md text-white"
    >
      <Building2 style={{ width: size * 0.55, height: size * 0.55 }} />
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || '#f97316'}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-md border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
          aria-label={`${label} color picker`}
        />
        <Input
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#f97316"
          className="w-32 font-mono text-sm"
        />
        <div
          className="h-9 w-9 rounded-md border border-slate-200 dark:border-slate-700"
          style={{ background: value || '#f97316' }}
          aria-hidden
        />
      </div>
    </div>
  )
}

function OrgProfileTab({ profile }: { profile: OrgProfile | undefined }) {
  const queryClient = useQueryClient()
  const [form, setForm] = React.useState<OrgProfile | null>(null)

  React.useEffect(() => {
    if (profile) setForm({ ...profile })
  }, [profile])

  const saveMutation = useMutation({
    mutationFn: async (data: OrgProfile) => {
      const res = await fetch('/api/settings/org-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => {
      toast.success('บันทึกการตั้งค่าแล้ว')
      queryClient.invalidateQueries({ queryKey: ['org-profile'] })
    },
    onError: () => {
      toast.error('บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง')
    },
  })

  if (!form) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    )
  }

  const update = <K extends keyof OrgProfile>(key: K, value: OrgProfile[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* Main form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-[#f97316]" />
            ข้อมูลองค์กร
          </CardTitle>
          <CardDescription>
            ตั้งค่าชื่อแอป โลโก้ สี และข้อมูลพื้นฐาน — เปลี่ยนได้ตลอดโดยไม่กระทบข้อมูล
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="appName" className="text-sm font-medium">
                ชื่อแอป
              </Label>
              <Input
                id="appName"
                value={form.appName}
                onChange={(e) => update('appName', e.target.value)}
                placeholder="ระบบจัดการสินทรัพย์"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appTagline" className="text-sm font-medium">
                แท็กไลน์
              </Label>
              <Input
                id="appTagline"
                value={form.appTagline}
                onChange={(e) => update('appTagline', e.target.value)}
                placeholder="Asset Management System"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">ประเภทอุตสาหกรรม</Label>
              <Select
                value={form.industryType}
                onValueChange={(v) => update('industryType', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="เลือกประเภท" />
                </SelectTrigger>
                <SelectContent>
                  {INDUSTRY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="logoUrl" className="text-sm font-medium">
                โลโก้ (emoji หรือ URL)
              </Label>
              <Input
                id="logoUrl"
                value={form.logoUrl || ''}
                onChange={(e) => update('logoUrl', e.target.value)}
                placeholder="🏥 หรือ https://..."
              />
              <p className="text-xs text-slate-500">
                หากใส่ URL จะแสดงเป็นรูปภาพ หากใส่ emoji/ตัวอักษรจะแสดงเป็นตัวอักษร
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <ColorField
              label="สีหลัก"
              value={form.primaryColor}
              onChange={(v) => update('primaryColor', v)}
            />
            <ColorField
              label="สีรอง"
              value={form.accentColor}
              onChange={(v) => update('accentColor', v)}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">ภาษา</Label>
              <Select
                value={form.language}
                onValueChange={(v) => update('language', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="เลือกภาษา" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="th">ภาษาไทย</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">สกุลเงิน</Label>
              <Select
                value={form.currency}
                onValueChange={(v) => update('currency', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="เลือกสกุลเงิน" />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              onClick={() => saveMutation.mutate(form)}
              disabled={saveMutation.isPending}
              className="bg-[#f97316] text-white hover:bg-[#ea580c]"
            >
              <Save className="mr-2 h-4 w-4" />
              {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Live preview sidebar mockup */}
      <Card className="h-fit lg:sticky lg:top-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Eye className="h-4 w-4 text-[#0d9488]" />
            ตัวอย่าง Sidebar
          </CardTitle>
          <CardDescription>ดูตัวอย่างหน้าตาแบบเรียลไทม์</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
            style={{ background: form.primaryColor }}
          >
            <div className="flex items-center gap-3 p-4 text-white">
              <LogoPreview
                logoUrl={form.logoUrl}
                size={44}
                background="rgba(255,255,255,0.18)"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {form.appName || 'ระบบจัดการสินทรัพย์'}
                </div>
                <div className="truncate text-[11px] opacity-80">
                  {form.appTagline || 'Asset Management System'}
                </div>
              </div>
            </div>
            <div className="space-y-1 bg-white p-3 dark:bg-slate-900">
              {['Dashboard', 'จัดการอุปกรณ์', 'จดมิเตอร์', 'แจ้งซ่อม', 'สต๊อก'].map(
                (item, idx) => (
                  <div
                    key={item}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                      idx === 0
                        ? 'font-medium text-white'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                    style={
                      idx === 0
                        ? { background: form.primaryColor }
                        : undefined
                    }
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{
                        background: idx === 0 ? '#fff' : form.accentColor,
                      }}
                    />
                    {item}
                  </div>
                ),
              )}
            </div>
          </div>

          <div className="mt-4 space-y-2 rounded-md bg-slate-50 p-3 dark:bg-slate-800/50">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">ประเภทอุตสาหกรรม</span>
              <span className="font-medium">
                {INDUSTRY_OPTIONS.find((o) => o.value === form.industryType)
                  ?.label ?? form.industryType}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">ภาษา / สกุลเงิน</span>
              <span className="font-medium">
                {form.language.toUpperCase()} / {form.currency}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">สี:</span>
              <span
                className="inline-block h-4 w-4 rounded border border-slate-200"
                style={{ background: form.primaryColor }}
                title="สีหลัก"
              />
              <span
                className="inline-block h-4 w-4 rounded border border-slate-200"
                style={{ background: form.accentColor }}
                title="สีรอง"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Tab 2: Asset Number Patterns
// ────────────────────────────────────────────────────────────

export function AssetPatternTab() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = React.useState(false)

  const { data, isLoading } = useQuery<{
    patterns: AssetPattern[]
    active: AssetPattern | null
  }>({
    queryKey: ['asset-patterns'],
    queryFn: async () => {
      const res = await fetch('/api/settings/asset-patterns')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const activateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/settings/asset-patterns/${id}/activate`,
        { method: 'POST' },
      )
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => {
      toast.success('เปลี่ยนรูปแบบเลขทะเบียนเรียบร้อยแล้ว')
      queryClient.invalidateQueries({ queryKey: ['asset-patterns'] })
    },
    onError: () => {
      toast.error('เปลี่ยนรูปแบบไม่สำเร็จ')
    },
  })

  const patterns = data?.patterns ?? []
  const activePattern = data?.active ?? null

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Hash className="h-5 w-5 text-[#f97316]" />
              รูปแบบเลขทะเบียนสินทรัพย์
            </CardTitle>
            <CardDescription>
              เลือกรูปแบบเลขทะเบียนที่ใช้งาน — ระบบจะใช้รูปแบบนี้เมื่อสร้างอุปกรณ์ใหม่
            </CardDescription>
          </div>
          <Button
            variant="outline"
            onClick={() => setCreateOpen(true)}
            className="border-[#f97316] text-[#f97316] hover:bg-[#fff7ed]"
          >
            <Plus className="mr-2 h-4 w-4" />
            สร้างรูปแบบใหม่
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          ) : patterns.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
              ยังไม่มีรูปแบบเลขทะเบียน — คลิก "สร้างรูปแบบใหม่" เพื่อเริ่ม
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {patterns.map((p) => {
                const isActive = !!activePattern && activePattern.id === p.id
                const preview = previewAssetNumber(p.pattern, p.defaultPrefix)
                return (
                  <div
                    key={p.id}
                    className={`rounded-lg border p-4 transition-colors ${
                      isActive
                        ? 'border-[#f97316] bg-[#fff7ed] dark:bg-[#fff7ed]/10'
                        : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900'
                    }`}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate font-semibold">
                            {p.name}
                          </h4>
                          {isActive && (
                            <Badge className="bg-[#f97316] text-white hover:bg-[#f97316]">
                              <Check className="mr-1 h-3 w-3" />
                              ใช้งานอยู่
                            </Badge>
                          )}
                        </div>
                        {p.description && (
                          <p className="mt-0.5 text-xs text-slate-500">
                            {p.description}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mb-3 rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                        รูปแบบ
                      </div>
                      <code className="font-mono text-sm text-slate-700 dark:text-slate-200">
                        {p.pattern}
                      </code>
                    </div>

                    <div className="mb-3 flex items-center gap-2 text-xs">
                      <Eye className="h-3.5 w-3.5 text-[#0d9488]" />
                      <span className="text-slate-500">ตัวอย่าง:</span>
                      <code className="rounded bg-[#0d9488]/10 px-2 py-0.5 font-mono text-sm font-semibold text-[#0d9488]">
                        {preview}
                      </code>
                    </div>

                    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                      {p.defaultPrefix && (
                        <span>
                          prefix: <code className="font-mono">{p.defaultPrefix}</code>
                        </span>
                      )}
                      <span>
                        seq padding: <code className="font-mono">{p.seqPadding}</code>
                      </span>
                      <span>
                        seq start: <code className="font-mono">{p.seqStart}</code>
                      </span>
                    </div>

                    {isActive ? (
                      <Button
                        variant="outline"
                        disabled
                        className="w-full border-[#f97316] text-[#f97316]"
                      >
                        <Check className="mr-2 h-4 w-4" />
                        รูปแบบปัจจุบัน
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => activateMutation.mutate(p.id)}
                        disabled={activateMutation.isPending}
                      >
                        ใช้รูปแบบนี้
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <CreatePatternDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ['asset-patterns'] })
        }}
      />
    </div>
  )
}

function CreatePatternDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: () => void
}) {
  const [name, setName] = React.useState('')
  const [pattern, setPattern] = React.useState('{prefix}-{seq:5}')
  const [description, setDescription] = React.useState('')
  const [defaultPrefix, setDefaultPrefix] = React.useState('ASSET')
  const [seqPadding, setSeqPadding] = React.useState(5)
  const [seqStart, setSeqStart] = React.useState(1)

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings/asset-patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          pattern,
          description,
          defaultPrefix,
          seqPadding,
          seqStart,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => {
      toast.success('สร้างรูปแบบใหม่เรียบร้อยแล้ว')
      setName('')
      setPattern('{prefix}-{seq:5}')
      setDescription('')
      setDefaultPrefix('ASSET')
      setSeqPadding(5)
      setSeqStart(1)
      onOpenChange(false)
      onCreated()
    },
    onError: () => {
      toast.error('สร้างรูปแบบไม่สำเร็จ')
    },
  })

  const preview = previewAssetNumber(pattern, defaultPrefix)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-[#f97316]" />
            สร้างรูปแบบเลขทะเบียนใหม่
          </DialogTitle>
          <DialogDescription>
            กำหนดรูปแบบเลขทะเบียนของสินทรัพย์ — ใช้ segment ในวงเล็บปีกกา {'{ }'} เพื่อสร้างรูปแบบ
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pat-name" className="text-sm font-medium">
                ชื่อรูปแบบ *
              </Label>
              <Input
                id="pat-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="เช่น แบบง่าย, แบบแยกหน่วยงาน"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pat-defaultPrefix" className="text-sm font-medium">
                คำนำหน้า (defaultPrefix)
              </Label>
              <Input
                id="pat-defaultPrefix"
                value={defaultPrefix}
                onChange={(e) => setDefaultPrefix(e.target.value)}
                placeholder="ASSET"
                className="font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pat-pattern" className="text-sm font-medium">
              รูปแบบ (Pattern) *
            </Label>
            <Input
              id="pat-pattern"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="{prefix}-{seq:5}"
              className="font-mono"
            />
            <p className="text-xs text-slate-500">
              ตัวอย่าง: <code className="font-mono">{`{prefix}-{seq:5}`}</code> → ASSET-00001
              {' หรือ '}
              <code className="font-mono">{`{dept:4}-{type:3}-{seq:3}-{year:2}`}</code> → ACC-PRT-001-26
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Segment ที่รองรับ</Label>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
              <ul className="grid gap-1.5 text-xs sm:grid-cols-2">
                {SEGMENT_HELP.map((s) => (
                  <li key={s.seg} className="flex flex-col">
                    <code className="font-mono font-semibold text-[#f97316]">
                      {s.seg}
                    </code>
                    <span className="text-slate-600 dark:text-slate-300">
                      {s.desc}
                    </span>
                    <span className="text-slate-400">เช่น {s.example}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pat-seqPadding" className="text-sm font-medium">
                จำนวนหลักเลขลำดับ (seqPadding)
              </Label>
              <Input
                id="pat-seqPadding"
                type="number"
                min={1}
                max={10}
                value={seqPadding}
                onChange={(e) => setSeqPadding(parseInt(e.target.value) || 5)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pat-seqStart" className="text-sm font-medium">
                เลขเริ่มต้น (seqStart)
              </Label>
              <Input
                id="pat-seqStart"
                type="number"
                min={1}
                value={seqStart}
                onChange={(e) => setSeqStart(parseInt(e.target.value) || 1)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pat-desc" className="text-sm font-medium">
              คำอธิบาย
            </Label>
            <Textarea
              id="pat-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="อธิบายรูปแบบสั้นๆ เช่น เหมาะสำหรับองค์กรขนาดเล็ก"
              rows={2}
            />
          </div>

          {/* Live preview */}
          <div className="rounded-md border border-[#0d9488]/30 bg-[#0d9488]/5 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[#0d9488]">
              <Eye className="h-3.5 w-3.5" />
              ตัวอย่างเลขทะเบียนที่จะได้
            </div>
            <code className="font-mono text-lg font-bold text-[#0d9488]">
              {preview || '—'}
            </code>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !name || !pattern}
            className="bg-[#f97316] text-white hover:bg-[#ea580c]"
          >
            <Save className="mr-2 h-4 w-4" />
            {createMutation.isPending ? 'กำลังสร้าง...' : 'สร้างรูปแบบ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ────────────────────────────────────────────────────────────
// Tab 2b: WoNumberPattern — รูปแบบเลขใบงาน (Task ID: SPECIALFEE-WOPATTERN-APPROVAL)
// ────────────────────────────────────────────────────────────

interface WoPatternRow {
  id: string
  name: string
  pattern: string
  description: string | null
  isActive: boolean
  defaultPrefix: string | null
  seqPadding: number
  seqStart: number
}

const WO_SEGMENT_HELP: { seg: string; desc: string; example: string }[] = [
  { seg: '{prefix}', desc: 'คำนำหน้า', example: 'PPIT' },
  { seg: '{seq:N}', desc: 'เลขลำดับ N หลัก', example: '{seq:4} → 0001' },
  { seg: '{year:2|4}', desc: 'ปี', example: '{year:2} → 26' },
  { seg: '{month:2}', desc: 'เดือน', example: '08' },
]

export function WoPatternTab() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = React.useState(false)

  const { data, isLoading } = useQuery<{
    patterns: WoPatternRow[]
    active: WoPatternRow | null
  }>({
    queryKey: ['wo-patterns'],
    queryFn: async () => {
      const res = await fetch('/api/settings/wo-patterns')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const activateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/settings/wo-patterns/${id}/activate`,
        { method: 'POST' },
      )
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => {
      toast.success('เปลี่ยนรูปแบบเลขใบงานเรียบร้อยแล้ว')
      queryClient.invalidateQueries({ queryKey: ['wo-patterns'] })
    },
    onError: () => {
      toast.error('เปลี่ยนรูปแบบไม่สำเร็จ')
    },
  })

  const patterns = data?.patterns ?? []
  const activePattern = data?.active ?? null

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-[#f97316]" />
              รูปแบบเลขใบงาน
            </CardTitle>
            <CardDescription>
              เลือกรูปแบบเลขใบงานที่ใช้งาน — ระบบจะใช้รูปแบบนี้เมื่อสร้างใบแจ้งซ่อมใหม่
              (เช่น PPIT0001 หรือ PPIT-0001)
            </CardDescription>
          </div>
          <Button
            variant="outline"
            onClick={() => setCreateOpen(true)}
            className="border-[#f97316] text-[#f97316] hover:bg-[#fff7ed]"
          >
            <Plus className="mr-2 h-4 w-4" />
            สร้างรูปแบบใหม่
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          ) : patterns.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
              ยังไม่มีรูปแบบเลขใบงาน — คลิก &quot;สร้างรูปแบบใหม่&quot; เพื่อเริ่ม
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {patterns.map((p) => {
                const isActive = !!activePattern && activePattern.id === p.id
                const preview = previewAssetNumber(p.pattern, p.defaultPrefix)
                return (
                  <div
                    key={p.id}
                    className={`rounded-lg border p-4 transition-colors ${
                      isActive
                        ? 'border-[#f97316] bg-[#fff7ed] dark:bg-[#fff7ed]/10'
                        : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900'
                    }`}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate font-semibold">
                            {p.name}
                          </h4>
                          {isActive && (
                            <Badge className="bg-[#f97316] text-white hover:bg-[#f97316]">
                              <Check className="mr-1 h-3 w-3" />
                              ใช้งานอยู่
                            </Badge>
                          )}
                        </div>
                        {p.description && (
                          <p className="mt-0.5 text-xs text-slate-500">
                            {p.description}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mb-3 rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                        รูปแบบ
                      </div>
                      <code className="font-mono text-sm text-slate-700 dark:text-slate-200">
                        {p.pattern}
                      </code>
                    </div>

                    <div className="mb-3 flex items-center gap-2 text-xs">
                      <Eye className="h-3.5 w-3.5 text-[#0d9488]" />
                      <span className="text-slate-500">ตัวอย่าง:</span>
                      <code className="rounded bg-[#0d9488]/10 px-2 py-0.5 font-mono text-sm font-semibold text-[#0d9488]">
                        {preview}
                      </code>
                    </div>

                    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                      {p.defaultPrefix && (
                        <span>
                          prefix: <code className="font-mono">{p.defaultPrefix}</code>
                        </span>
                      )}
                      <span>
                        seq padding: <code className="font-mono">{p.seqPadding}</code>
                      </span>
                      <span>
                        seq start: <code className="font-mono">{p.seqStart}</code>
                      </span>
                    </div>

                    {isActive ? (
                      <Button
                        variant="outline"
                        disabled
                        className="w-full border-[#f97316] text-[#f97316]"
                      >
                        <Check className="mr-2 h-4 w-4" />
                        รูปแบบปัจจุบัน
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => activateMutation.mutate(p.id)}
                        disabled={activateMutation.isPending}
                      >
                        ใช้รูปแบบนี้
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateWoPatternDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ['wo-patterns'] })
        }}
      />
    </div>
  )
}

function CreateWoPatternDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: () => void
}) {
  const [name, setName] = React.useState('')
  const [pattern, setPattern] = React.useState('{prefix}{seq:4}')
  const [description, setDescription] = React.useState('')
  const [defaultPrefix, setDefaultPrefix] = React.useState('PPIT')
  const [seqPadding, setSeqPadding] = React.useState(4)
  const [seqStart, setSeqStart] = React.useState(1)

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings/wo-patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          pattern,
          description,
          defaultPrefix,
          seqPadding,
          seqStart,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => {
      toast.success('สร้างรูปแบบเลขใบงานใหม่เรียบร้อยแล้ว')
      setName('')
      setPattern('{prefix}{seq:4}')
      setDescription('')
      setDefaultPrefix('PPIT')
      setSeqPadding(4)
      setSeqStart(1)
      onOpenChange(false)
      onCreated()
    },
    onError: () => {
      toast.error('สร้างรูปแบบไม่สำเร็จ')
    },
  })

  const preview = previewAssetNumber(pattern, defaultPrefix)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-[#f97316]" />
            สร้างรูปแบบเลขใบงานใหม่
          </DialogTitle>
          <DialogDescription>
            กำหนดรูปแบบเลขใบงาน — ใช้ segment ในวงเล็บปีกกา {'{ }'} เพื่อสร้างรูปแบบ
            (เช่น {'{prefix}{seq:4}'} → PPIT0001)
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wopat-name" className="text-sm font-medium">
                ชื่อรูปแบบ *
              </Label>
              <Input
                id="wopat-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="เช่น PPIT (ไม่มี dash), PPIT-ปี-ลำดับ"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wopat-defaultPrefix" className="text-sm font-medium">
                คำนำหน้า (defaultPrefix)
              </Label>
              <Input
                id="wopat-defaultPrefix"
                value={defaultPrefix}
                onChange={(e) => setDefaultPrefix(e.target.value)}
                placeholder="PPIT"
                className="font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wopat-pattern" className="text-sm font-medium">
              รูปแบบ (Pattern) *
            </Label>
            <Input
              id="wopat-pattern"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="{prefix}{seq:4}"
              className="font-mono"
            />
            <p className="text-xs text-slate-500">
              ตัวอย่าง: <code className="font-mono">{`{prefix}{seq:4}`}</code> → PPIT0001
              {' หรือ '}
              <code className="font-mono">{`{prefix}-{seq:4}`}</code> → PPIT-0001
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Segment ที่รองรับ</Label>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
              <ul className="grid gap-1.5 text-xs sm:grid-cols-2">
                {WO_SEGMENT_HELP.map((s) => (
                  <li key={s.seg} className="flex flex-col">
                    <code className="font-mono font-semibold text-[#f97316]">
                      {s.seg}
                    </code>
                    <span className="text-slate-600 dark:text-slate-300">
                      {s.desc}
                    </span>
                    <span className="text-slate-400">เช่น {s.example}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wopat-seqPadding" className="text-sm font-medium">
                จำนวนหลักเลขลำดับ (seqPadding)
              </Label>
              <Input
                id="wopat-seqPadding"
                type="number"
                min={1}
                max={10}
                value={seqPadding}
                onChange={(e) => setSeqPadding(parseInt(e.target.value) || 4)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wopat-seqStart" className="text-sm font-medium">
                เลขเริ่มต้น (seqStart)
              </Label>
              <Input
                id="wopat-seqStart"
                type="number"
                min={1}
                value={seqStart}
                onChange={(e) => setSeqStart(parseInt(e.target.value) || 1)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wopat-desc" className="text-sm font-medium">
              คำอธิบาย
            </Label>
            <Textarea
              id="wopat-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="รายละเอียดสั้นๆ ของรูปแบบนี้"
              className="min-h-[60px]"
            />
          </div>

          {/* Live preview */}
          <div className="rounded-md border border-[#0d9488]/30 bg-[#0d9488]/5 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[#0d9488]">
              <Eye className="h-3.5 w-3.5" />
              ตัวอย่างเลขใบงานที่จะได้
            </div>
            <code className="font-mono text-lg font-bold text-[#0d9488]">
              {preview || '—'}
            </code>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !name || !pattern}
            className="bg-[#f97316] text-white hover:bg-[#ea580c]"
          >
            <Save className="mr-2 h-4 w-4" />
            {createMutation.isPending ? 'กำลังสร้าง...' : 'สร้างรูปแบบ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ────────────────────────────────────────────────────────────
// Tab 3: General settings (Excel import, timezone)
// ────────────────────────────────────────────────────────────

function GeneralTab({ profile }: { profile: OrgProfile | undefined }) {
  const queryClient = useQueryClient()
  const [allowExcelImport, setAllowExcelImport] = React.useState(true)
  const [timezone, setTimezone] = React.useState('Asia/Bangkok')

  React.useEffect(() => {
    if (profile) {
      setAllowExcelImport(profile.allowExcelImport)
      setTimezone(profile.timezone)
    }
  }, [profile])

  const saveMutation = useMutation({
    mutationFn: async (data: { allowExcelImport: boolean; timezone: string }) => {
      // Merge with existing profile so PUT doesn't wipe other fields
      const merged = { ...(profile || {}), ...data }
      const res = await fetch('/api/settings/org-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => {
      toast.success('บันทึกการตั้งค่าทั่วไปแล้ว')
      queryClient.invalidateQueries({ queryKey: ['org-profile'] })
    },
    onError: () => {
      toast.error('บันทึกไม่สำเร็จ')
    },
  })

  if (!profile) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SettingsIcon className="h-5 w-5 text-[#f97316]" />
          ตั้งค่าทั่วไป
        </CardTitle>
        <CardDescription>
          ควบคุมฟีเจอร์การนำเข้าข้อมูลและโซนเวลาของระบบ
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 font-medium">
              <Sparkles className="h-4 w-4 text-[#0d9488]" />
              อนุญาตให้นำเข้าข้อมูลด้วย Excel
            </div>
            <p className="text-xs text-slate-500">
              เปิดใช้งานเมนู "นำเข้า Excel" สำหรับอุปกรณ์, สต๊อก, และข้อมูลอื่นๆ
            </p>
          </div>
          <Switch
            checked={allowExcelImport}
            onCheckedChange={setAllowExcelImport}
            aria-label="อนุญาตให้นำเข้าข้อมูลด้วย Excel"
          />
        </div>

        <div className="space-y-1.5 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <Label className="text-sm font-medium">โซนเวลา (Timezone)</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger>
              <SelectValue placeholder="เลือกโซนเวลา" />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONE_OPTIONS.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-slate-500">
            ใช้สำหรับแสดงวันที่/เวลาในรายงานและประวัติต่างๆ
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            onClick={() =>
              saveMutation.mutate({ allowExcelImport, timezone })
            }
            disabled={saveMutation.isPending}
            className="bg-[#f97316] text-white hover:bg-[#ea580c]"
          >
            <Save className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
