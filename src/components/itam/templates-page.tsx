'use client'

// ============================================================
// TemplatesPage — Unified Template Manager (Task ID: UNIFY-TEMPLATES-CLOCK)
// ============================================================
// One page to manage ALL templates in the system, organized by type:
//
//   ┌──────────────────────────────────────────────────────────┐
//   │ 📄 Template                                               │
//   │ [Sticker] [Document PDF] [Work Order]   ← type tabs          │
//   │                                                          │
//   │ Template list for selected type                          │
//   │   • system default badge ("System") or custom ("Custom")│
//   │   • default star ★ (which one is used on print)          │
//   │   • [Edit] [Copy] [Delete]                                │
//   │                                                          │
//   │ [+ CreateNew] → opens appropriate visual editor           │
//   └──────────────────────────────────────────────────────────┘
//
// Storage strategy (kept simple — separate AppSetting keys per type):
//   • Sticker templates  → /api/itam/sticker/templates  (AppSetting JSON)
//   • Document templates → /api/itam/document-templates (AppSetting JSON)
//   • Work-order templates → /api/templates (DocumentTemplate Prisma table)
//
// The two visual editors (ItamStickerEditor, ItamDocumentEditor) are kept
// as their own pages — clicking "Edit/CreateNew" navigates to them.
// ============================================================

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
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
  FileText,
  Plus,
  Pencil,
  Trash2,
  Check,
  Copy,
  Loader2,
  Pin,
  Star,
  ArrowLeft,
  Sparkles,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { useT, useFormatDateTime, useLang } from '@/store/i18n-store'
import { useAuthStore } from '@/store/auth-store'
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_TYPES,
  TEMPLATE_TYPE_META,
  type TemplateType,
} from '@/lib/templates'
import {
  makeDefaultContent,
  parseContent,
  serializeContent,
  type TemplateContent,
} from '@/lib/template-editor'
import { TemplateEditor } from './template-editor'
import {
  PAPER_PRESETS,
  type StickerTemplate,
} from '@/lib/sticker-template'
import type { DocumentTemplate as DocTemplateT } from '@/lib/document-template'

// ---------- Types ----------

/** DB-backed work-order/etc template (Prisma DocumentTemplate row). */
interface DbTemplate {
  id: string
  name: string
  type: string
  category: string | null
  content: string
  isActive: boolean
  isDefault: boolean
  isFixed: boolean
  createdAt: string
  updatedAt: string
}

type TabKey = 'sticker' | 'document' | 'work-order'

interface TabDef {
  key: TabKey
  label: string
  icon: string
  description: string
}

const TABS: TabDef[] = [
  {
    key: 'sticker',
    label: 'สติกเกอร์',
    icon: '🎨',
    description: 'ฉลากขนาดเล็ก เช่น 75×36mm, 50×30mm — สำหรับติดอุปกรณ์',
  },
  {
    key: 'document',
    label: 'เอกสาร PDF',
    icon: '📑',
    description: 'ขนาดกระดาษ A4/A3 — รายงาน / สรุปใบงาน',
  },
  {
    key: 'work-order',
    label: 'ใบงาน',
    icon: '🔧',
    description: 'ใบแจ้งซ่อม / ใบเบิกอะไหล่ / ใบรับเครื่อง / ใบสั่งซื้อ',
  },
]

// ---------- Helpers ----------

function formatThaiDate(iso: string | null, lang: 'th' | 'en' = 'th'): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

/** System-default template IDs — these are seeded by the system and cannot
 *  be deleted (only duplicated). Identifies the "System" badge vs "Custom". */
const STICKER_SYSTEM_IDS = new Set(['tpl-default'])
const DOC_SYSTEM_IDS = new Set(['doc-tpl-default'])

// =====================================================================
// Sticker tab
// =====================================================================

interface StickerListResponse {
  templates: StickerTemplate[]
  activeId: string | null
}

function StickerTab() {
  const t = useT()
  const qc = useQueryClient()
  const setActivePage = useAppStore((s) => s.setActivePage)

  const { data, isLoading } = useQuery<StickerListResponse>({
    queryKey: ['sticker-templates'],
    queryFn: async () => {
      const res = await fetch('/api/itam/sticker/templates')
      if (!res.ok) throw new Error('Failed to load sticker templates')
      return res.json() as Promise<StickerListResponse>
    },
    staleTime: 15_000,
  })

  const templates = data?.templates ?? []
  const activeId = data?.activeId ?? null

  // ── Create dialog state ──
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createForm, setCreateForm] = React.useState({
    name: '',
    paper: PAPER_PRESETS[0].label,
  })
  const [creating, setCreating] = React.useState(false)

  // ── Delete state ──
  const [deleteTarget, setDeleteTarget] =
    React.useState<StickerTemplate | null>(null)

  const createMutation = useMutation({
    mutationFn: async (input: { name: string; canvas: { width: number; height: number; unit: 'mm' } }) => {
      const res = await fetch('/api/itam/sticker/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: input.name,
          canvas: input.canvas,
          overflow: 'clip',
          elements: [],
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'สร้างไม่สำเร็จ')
      }
      return res.json() as Promise<{ template: StickerTemplate }>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sticker-templates'] })
      toast.success('สร้างเทมเพลตสติกเกอร์แล้ว')
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : 'สร้างไม่สำเร็จ'),
  })

  const duplicateMutation = useMutation({
    mutationFn: async (tpl: StickerTemplate) => {
      const res = await fetch('/api/itam/sticker/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${tpl.name} (copy)`,
          canvas: tpl.canvas,
          overflow: tpl.overflow,
          elements: tpl.elements,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'คัดลอกไม่สำเร็จ')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sticker-templates'] })
      toast.success('คัดลอกเทมเพลตแล้ว')
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : 'คัดลอกไม่สำเร็จ'),
  })

  const activateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/itam/sticker/templates/${id}/activate`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'ตั้งค่าไม่สำเร็จ')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sticker-templates'] })
      toast.success('ตั้งเป็นเทมเพลตเริ่มต้นแล้ว')
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : 'ตั้งค่าไม่สำเร็จ'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/itam/sticker/templates/${id}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'ลบไม่สำเร็จ')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sticker-templates'] })
      toast.success('ลบเทมเพลตแล้ว')
      setDeleteTarget(null)
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : 'ลบไม่สำเร็จ'),
  })

  async function handleCreate() {
    const name = createForm.name.trim() || `Sticker ${templates.length + 1}`
    const preset =
      PAPER_PRESETS.find((p) => p.label === createForm.paper) ?? PAPER_PRESETS[0]
    setCreating(true)
    try {
      const data = await createMutation.mutateAsync({
        name,
        canvas: { width: preset.width, height: preset.height, unit: 'mm' },
      })
      setCreateOpen(false)
      setCreateForm({ name: '', paper: PAPER_PRESETS[0].label })
      // Jump straight into the visual editor for the newly-created template.
      // The ItamStickerEditor auto-selects the first template, so the user
      // will land on the editor with their new template ready to design.
      setActivePage('itam-sticker-editor')
      void data
    } finally {
      setCreating(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <span aria-hidden>🎨</span>
            สติกเกอร์ — เทมเพลต
            <Badge variant="secondary" className="ml-1 text-[10px]">
              {templates.length}
            </Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            ฉลากขนาดเล็กสำหรับติดอุปกรณ์ — กด &quot;สร้างใหม่&quot; เพื่อเริ่มออกแบบ
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          size="sm"
          className="shrink-0 bg-[#f97316] text-white hover:bg-[#ea580c]"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          สร้างใหม่
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full" />
            ))}
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm font-medium">ยังไม่มีเทมเพลตสติกเกอร์</p>
            <p className="text-xs text-muted-foreground">
              กด &quot;สร้างใหม่&quot; เพื่อสร้างเทมเพลตเริ่มต้น
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {templates.map((tpl) => {
              const isSystem = STICKER_SYSTEM_IDS.has(tpl.id)
              const isDefault = activeId === tpl.id
              return (
                <div
                  key={tpl.id}
                  className="group relative flex flex-col gap-2 rounded-lg border border-slate-200 p-3 transition-all hover:border-orange-300 hover:shadow-sm dark:border-slate-700 dark:hover:border-orange-700"
                >
                  {/* Mini preview — scaled sticker canvas */}
                  <div className="flex h-24 items-center justify-center overflow-hidden rounded-md bg-slate-50 dark:bg-slate-800">
                    <div
                      className="relative bg-white shadow-sm ring-1 ring-slate-200 dark:ring-slate-600"
                      style={{
                        width: `${Math.min(120, (tpl.canvas.width / tpl.canvas.height) * 60)}px`,
                        height: `${Math.min(60, 60)}px`,
                      }}
                      aria-hidden
                    >
                      <div className="absolute inset-0 flex items-center justify-center text-[8px] text-slate-400">
                        {tpl.canvas.width}×{tpl.canvas.height}mm
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">
                        {tpl.name}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {tpl.canvas.width} × {tpl.canvas.height} mm
                      </div>
                    </div>
                    {isDefault && (
                      <Star
                        className="h-4 w-4 flex-shrink-0 fill-orange-500 text-orange-500"
                        aria-label="ค่าเริ่มต้น"
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    <Badge
                      variant="outline"
                      className={
                        isSystem
                          ? 'border-sky-200 bg-sky-50 px-1.5 py-0 text-[10px] text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                          : 'border-teal-200 bg-teal-50 px-1.5 py-0 text-[10px] text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300'
                      }
                    >
                      {isSystem ? t('group.system') : 'กำหนดเอง'}
                    </Badge>
                    {isDefault && (
                      <Badge
                        variant="outline"
                        className="border-orange-200 bg-orange-50 px-1.5 py-0 text-[10px] text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300"
                      >
                        ★ ค่าเริ่มต้น
                      </Badge>
                    )}
                  </div>

                  <div className="mt-1 flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 flex-1 text-xs"
                      onClick={() => setActivePage('itam-sticker-editor')}
                    >
                      <Pencil className="mr-1 h-3 w-3" /> แก้ไข
                    </Button>
                    {!isDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => activateMutation.mutate(tpl.id)}
                        disabled={activateMutation.isPending}
                        title="ตั้งเป็นค่าเริ่มต้น"
                        aria-label="ตั้งเป็นค่าเริ่มต้น"
                      >
                        <Star className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => duplicateMutation.mutate(tpl)}
                      disabled={duplicateMutation.isPending}
                      title="คัดลอก"
                      aria-label="คัดลอก"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    {!isSystem && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
                        onClick={() => setDeleteTarget(tpl)}
                        disabled={deleteMutation.isPending}
                        title={t('settings.delete')}
                        aria-label={t('settings.delete')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span aria-hidden>🎨</span> สร้างเทมเพลตสติกเกอร์ใหม่
            </DialogTitle>
            <DialogDescription>
              เลือกขนาดกระดาษและตั้งชื่อ — กด &quot;สร้าง&quot; เพื่อเปิดหน้าออกแบบ
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="stk-name" className="text-xs">
                ชื่อเทมเพลต <span className="text-destructive">*</span>
              </Label>
              <Input
                id="stk-name"
                value={createForm.name}
                onChange={(e) =>
                  setCreateForm((s) => ({ ...s, name: e.target.value }))
                }
                placeholder="เช่น สติกเกอร์อุปกรณ์มาตรฐาน"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stk-paper" className="text-xs">
                ขนาดกระดาษ
              </Label>
              <Select
                value={createForm.paper}
                onValueChange={(v) =>
                  setCreateForm((s) => ({ ...s, paper: v }))
                }
              >
                <SelectTrigger id="stk-paper" className="h-9">
                  <SelectValue placeholder="เลือกขนาด" />
                </SelectTrigger>
                <SelectContent>
                  {PAPER_PRESETS.map((p) => (
                    <SelectItem key={p.label} value={p.label}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              ยกเลิก
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating}
              className="bg-[#f97316] text-white hover:bg-[#ea580c]"
            >
              {creating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> สร้าง…
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" /> สร้าง + เปิดหน้าออกแบบ
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบเทมเพลต</AlertDialogTitle>
            <AlertDialogDescription>
              คุณแน่ใจหรือไม่ว่าต้องการลบเทมเพลต{' '}
              <span className="font-medium text-foreground">
                &quot;{deleteTarget?.name}&quot;
              </span>
              ? การกระทำนี้ย้อนกลับไม่ได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('settings.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              className="bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-600"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
              }}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ลบ…
                </>
              ) : (
                'ลบเทมเพลต'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// =====================================================================
// Document (PDF) tab
// =====================================================================

interface DocListResponse {
  templates: DocTemplateT[]
  activeId: string | null
  enabled: boolean
}

function DocumentTab() {
  const t = useT()
  const qc = useQueryClient()
  const setActivePage = useAppStore((s) => s.setActivePage)

  const { data, isLoading } = useQuery<DocListResponse>({
    queryKey: ['document-templates'],
    queryFn: async () => {
      const res = await fetch('/api/itam/document-templates')
      if (!res.ok) throw new Error('Failed to load document templates')
      return res.json() as Promise<DocListResponse>
    },
    staleTime: 15_000,
  })

  const templates = data?.templates ?? []
  const activeId = data?.activeId ?? null

  const [createOpen, setCreateOpen] = React.useState(false)
  const [createName, setCreateName] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<DocTemplateT | null>(
    null,
  )

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch('/api/itam/document-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'สร้างไม่สำเร็จ')
      }
      return res.json() as Promise<{ template: DocTemplateT }>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-templates'] })
      toast.success('สร้างเทมเพลตเอกสารแล้ว')
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : 'สร้างไม่สำเร็จ'),
  })

  const duplicateMutation = useMutation({
    mutationFn: async (tpl: DocTemplateT) => {
      const res = await fetch('/api/itam/document-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${tpl.name} (copy)`,
          canvas: tpl.canvas,
          elements: tpl.elements,
          table: tpl.table,
          summary: tpl.summary,
          footer: tpl.footer,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'คัดลอกไม่สำเร็จ')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-templates'] })
      toast.success('คัดลอกเทมเพลตแล้ว')
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : 'คัดลอกไม่สำเร็จ'),
  })

  const activateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/itam/document-templates/${id}/activate`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'ตั้งค่าไม่สำเร็จ')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-templates'] })
      toast.success('ตั้งเป็นเทมเพลตเริ่มต้นแล้ว')
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : 'ตั้งค่าไม่สำเร็จ'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/itam/document-templates/${id}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'ลบไม่สำเร็จ')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-templates'] })
      toast.success('ลบเทมเพลตแล้ว')
      setDeleteTarget(null)
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : 'ลบไม่สำเร็จ'),
  })

  async function handleCreate() {
    const name = createName.trim() || `Document ${templates.length + 1}`
    setCreating(true)
    try {
      await createMutation.mutateAsync(name)
      setCreateOpen(false)
      setCreateName('')
      setActivePage('itam-document-editor')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <span aria-hidden>📑</span>
            เอกสาร PDF — เทมเพลต
            <Badge variant="secondary" className="ml-1 text-[10px]">
              {templates.length}
            </Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            ขนาดกระดาษ A4/A3 — รายงาน / สรุปใบงานรายเดือน
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          size="sm"
          className="shrink-0 bg-[#f97316] text-white hover:bg-[#ea580c]"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          สร้างใหม่
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm font-medium">ยังไม่มีเทมเพลตเอกสาร</p>
            <p className="text-xs text-muted-foreground">
              กด &quot;สร้างใหม่&quot; เพื่อสร้างเทมเพลตเริ่มต้น
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {templates.map((tpl) => {
              const isSystem = DOC_SYSTEM_IDS.has(tpl.id)
              const isDefault = activeId === tpl.id
              return (
                <div
                  key={tpl.id}
                  className="group relative flex flex-col gap-2 rounded-lg border border-slate-200 p-3 transition-all hover:border-orange-300 hover:shadow-sm dark:border-slate-700 dark:hover:border-orange-700"
                >
                  {/* Mini A4 preview */}
                  <div className="flex h-32 items-center justify-center overflow-hidden rounded-md bg-slate-50 dark:bg-slate-800">
                    <div
                      className="relative bg-white shadow-sm ring-1 ring-slate-200 dark:ring-slate-600"
                      style={{
                        width: '46px',
                        height: '65px',
                      }}
                      aria-hidden
                    >
                      <div className="absolute inset-0 flex items-center justify-center text-[7px] text-slate-400">
                        {tpl.canvas.paper ?? 'A4'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">
                        {tpl.name}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {tpl.canvas.paper} · {tpl.canvas.orientation}
                      </div>
                    </div>
                    {isDefault && (
                      <Star
                        className="h-4 w-4 flex-shrink-0 fill-orange-500 text-orange-500"
                        aria-label="ค่าเริ่มต้น"
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    <Badge
                      variant="outline"
                      className={
                        isSystem
                          ? 'border-sky-200 bg-sky-50 px-1.5 py-0 text-[10px] text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                          : 'border-teal-200 bg-teal-50 px-1.5 py-0 text-[10px] text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300'
                      }
                    >
                      {isSystem ? t('group.system') : 'กำหนดเอง'}
                    </Badge>
                    {isDefault && (
                      <Badge
                        variant="outline"
                        className="border-orange-200 bg-orange-50 px-1.5 py-0 text-[10px] text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300"
                      >
                        ★ ค่าเริ่มต้น
                      </Badge>
                    )}
                  </div>

                  <div className="mt-1 flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 flex-1 text-xs"
                      onClick={() => setActivePage('itam-document-editor')}
                    >
                      <Pencil className="mr-1 h-3 w-3" /> แก้ไข
                    </Button>
                    {!isDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => activateMutation.mutate(tpl.id)}
                        disabled={activateMutation.isPending}
                        title="ตั้งเป็นค่าเริ่มต้น"
                        aria-label="ตั้งเป็นค่าเริ่มต้น"
                      >
                        <Star className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => duplicateMutation.mutate(tpl)}
                      disabled={duplicateMutation.isPending}
                      title="คัดลอก"
                      aria-label="คัดลอก"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    {!isSystem && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
                        onClick={() => setDeleteTarget(tpl)}
                        disabled={deleteMutation.isPending}
                        title={t('settings.delete')}
                        aria-label={t('settings.delete')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span aria-hidden>📑</span> สร้างเทมเพลตเอกสารใหม่
            </DialogTitle>
            <DialogDescription>
              ตั้งชื่อเทมเพลต — กด &quot;สร้าง&quot; เพื่อเปิดหน้าแก้ไข A4
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="doc-name" className="text-xs">
                ชื่อเทมเพลต <span className="text-destructive">*</span>
              </Label>
              <Input
                id="doc-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="เช่น รายงานมิเตอร์รายเดือน"
                className="h-9"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              ยกเลิก
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating}
              className="bg-[#f97316] text-white hover:bg-[#ea580c]"
            >
              {creating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> สร้าง…
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" /> สร้าง + เปิดหน้าออกแบบ
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบเทมเพลต</AlertDialogTitle>
            <AlertDialogDescription>
              คุณแน่ใจหรือไม่ว่าต้องการลบเทมเพลต{' '}
              <span className="font-medium text-foreground">
                &quot;{deleteTarget?.name}&quot;
              </span>
              ? การกระทำนี้ย้อนกลับไม่ได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('settings.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              className="bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-600"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
              }}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ลบ…
                </>
              ) : (
                'ลบเทมเพลต'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// =====================================================================
// Work-order tab (legacy DB-backed DocumentTemplate table)
// =====================================================================

interface EditorState {
  id: string | null
  name: string
  category: string
  content: TemplateContent
  isActive: boolean
  isDefault: boolean
  isFixed: boolean
}

interface EditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: TemplateType
  initial: EditorState
}

function EditorDialog({ open, onOpenChange, type, initial }: EditorDialogProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const [form, setForm] = React.useState<EditorState>(initial)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setForm(initial)
    }
  }, [open, initial])

  const isEditing = form.id !== null

  async function handleSave(content: TemplateContent) {
    if (!form.name.trim()) {
      toast.error('กรุณาระบุชื่อเทมเพลต')
      throw new Error('กรุณาระบุชื่อเทมเพลต')
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        type,
        category: form.category.trim() || null,
        content: serializeContent(content),
        isActive: form.isActive,
        isDefault: form.isDefault,
        isFixed: form.isFixed,
      }
      const res = isEditing && form.id
        ? await fetch(`/api/templates/${form.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'บันทึกไม่สำเร็จ')
      }
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      toast.success(isEditing ? 'บันทึกเทมเพลตแล้ว' : 'สร้างเทมเพลตแล้ว')
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[95vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1200px]">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            {isEditing ? 'แก้ไขเทมเพลต' : 'สร้างเทมเพลตใหม่'}{' '}
            <Badge variant="outline" className="text-xs">
              {TEMPLATE_TYPE_META.find((m) => m.value === type)?.label ?? type}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs">
            ตัวอย่างเทมเพลตบนกระดาษจำลอง — ลาก/ย่อ/ขยายได้
            กด &quot;บันทึก&quot; เมื่อเสร็จแล้ว
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 border-b bg-card px-5 py-3 sm:grid-cols-[1fr_1fr_auto_auto_auto]">
          <div className="space-y-1">
            <Label htmlFor="tpl-name" className="text-[11px]">
              ชื่อเทมเพลต <span className="text-destructive">*</span>
            </Label>
            <Input
              id="tpl-name"
              value={form.name}
              onChange={(e) =>
                setForm((s) => ({ ...s, name: e.target.value }))
              }
              placeholder="เช่น ใบแจ้งซ่อมมาตรฐาน"
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tpl-category" className="text-[11px]">
              หมวดหมู่
            </Label>
            <Input
              id="tpl-category"
              value={form.category}
              onChange={(e) =>
                setForm((s) => ({ ...s, category: e.target.value }))
              }
              placeholder={t('common.optional')}
              className="h-8"
            />
          </div>
          <div className="flex items-end gap-2">
            <Switch
              id="tpl-active"
              checked={form.isActive}
              onCheckedChange={(v) =>
                setForm((s) => ({ ...s, isActive: v }))
              }
            />
            <Label htmlFor="tpl-active" className="text-[11px]">
              เปิดใช้งาน
            </Label>
          </div>
          <div className="flex items-end gap-2">
            <Switch
              id="tpl-default"
              checked={form.isDefault}
              onCheckedChange={(v) =>
                setForm((s) => ({ ...s, isDefault: v }))
              }
            />
            <Label htmlFor="tpl-default" className="text-[11px]">
              ค่าเริ่มต้น
            </Label>
          </div>
          <div className="flex items-end gap-2">
            <Switch
              id="tpl-fixed"
              checked={form.isFixed}
              onCheckedChange={(v) =>
                setForm((s) => ({ ...s, isFixed: v }))
              }
            />
            <Label
              htmlFor="tpl-fixed"
              className="flex items-center gap-1 text-[11px]"
              title="เทมเพลตของระบบ — ลบไม่ได้ (คัดลอกได้)"
            >
              <Pin className="h-3 w-3" />
              ระบบ
            </Label>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <TemplateEditor
            initialContent={form.content}
            onSave={handleSave}
            saving={saving}
            templateType={type}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function useSeedDefaults() {
  const queryClient = useQueryClient()
  const [seeding, setSeeding] = React.useState(false)
  const seededRef = React.useRef(false)

  const { data: allTemplates, isLoading } = useQuery<DbTemplate[]>({
    queryKey: ['templates', 'all'],
    queryFn: async () => {
      const res = await fetch('/api/templates')
      if (!res.ok) throw new Error('Failed to load templates')
      const j = await res.json()
      return (j.templates ?? []) as DbTemplate[]
    },
    staleTime: 30_000,
  })

  React.useEffect(() => {
    if (isLoading || seededRef.current || !allTemplates) return
    const missing = TEMPLATE_TYPES.filter(
      (t) => !allTemplates.some((tpl) => tpl.type === t),
    )
    if (missing.length === 0) {
      seededRef.current = true
      return
    }
    seededRef.current = true
    setSeeding(true)
    Promise.all(
      missing.map(async (t) => {
        let content: string
        try {
          const def: TemplateContent = makeDefaultContent('A4', t)
          content = serializeContent(def)
        } catch {
          content = DEFAULT_TEMPLATES[t].content
        }
        const res = await fetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: DEFAULT_TEMPLATES[t].name,
            type: t,
            content,
            isActive: true,
            isDefault: true,
            isFixed: true, // mark seeded defaults as system templates
          }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error ?? `สร้างเทมเพลตเริ่มต้นสำหรับ ${t} ไม่สำเร็จ`)
        }
        return res.json()
      }),
    )
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['templates'] })
        toast.success('สร้างเทมเพลตเริ่มต้นแล้ว')
      })
      .catch((err: unknown) => {
        toast.error(
          err instanceof Error ? err.message : 'สร้างเทมเพลตเริ่มต้นไม่สำเร็จ',
        )
      })
      .finally(() => setSeeding(false))
  }, [allTemplates, isLoading, queryClient])

  return { seeding }
}

function WorkOrderTab() {
  const t = useT()
  const { lang } = useLang()
  const queryClient = useQueryClient()
  const [selectedType, setSelectedType] =
    React.useState<TemplateType>('work-order')
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [editorInitial, setEditorInitial] = React.useState<EditorState>(
    () => ({
      id: null,
      name: '',
      category: '',
      content: makeDefaultContent('A4', 'work-order'),
      isActive: true,
      isDefault: false,
      isFixed: false,
    }),
  )
  const [deleteTarget, setDeleteTarget] =
    React.useState<DbTemplate | null>(null)

  useSeedDefaults()

  const { data: templates, isLoading } = useQuery<DbTemplate[]>({
    queryKey: ['templates', selectedType],
    queryFn: async () => {
      const res = await fetch(`/api/templates?type=${selectedType}`)
      if (!res.ok) throw new Error('Failed to load templates')
      const j = await res.json()
      return (j.templates ?? []) as DbTemplate[]
    },
    staleTime: 15_000,
  })

  const setActiveMutation = useMutation({
    mutationFn: async (tpl: DbTemplate) => {
      const res = await fetch(`/api/templates/${tpl.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !tpl.isActive }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'อัปเดตไม่สำเร็จ')
      }
      return res.json()
    },
    onSuccess: (_data, tpl) => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      toast.success(tpl.isActive ? 'ปิดใช้งานเทมเพลตแล้ว' : 'เปิดใช้งานเทมเพลตแล้ว')
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'อัปเดตไม่สำเร็จ')
    },
  })

  const setDefaultMutation = useMutation({
    mutationFn: async (tpl: DbTemplate) => {
      const res = await fetch(`/api/templates/${tpl.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: !tpl.isDefault }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'อัปเดตไม่สำเร็จ')
      }
      return res.json()
    },
    onSuccess: (_data, tpl) => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      toast.success(
        tpl.isDefault ? 'ยกเลิกการตั้งเป็นค่าเริ่มต้น' : 'ตั้งเป็นค่าเริ่มต้น',
      )
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'อัปเดตไม่สำเร็จ')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'ลบไม่สำเร็จ')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      toast.success('ลบเทมเพลตแล้ว')
      setDeleteTarget(null)
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'ลบไม่สำเร็จ')
    },
  })

  const duplicateMutation = useMutation({
    mutationFn: async (tpl: DbTemplate) => {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${tpl.name} (copy)`,
          type: tpl.type,
          category: tpl.category,
          content: tpl.content,
          isActive: true,
          isDefault: false,
          isFixed: false,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'คัดลอกไม่สำเร็จ')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      toast.success('คัดลอกเทมเพลตแล้ว')
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'คัดลอกไม่สำเร็จ')
    },
  })

  function openCreate() {
    setEditorInitial({
      id: null,
      name: '',
      category: '',
      content: makeDefaultContent('A4', selectedType),
      isActive: true,
      isDefault: false,
      isFixed: false,
    })
    setEditorOpen(true)
  }

  function openEdit(tpl: DbTemplate) {
    setEditorInitial({
      id: tpl.id,
      name: tpl.name,
      category: tpl.category ?? '',
      content: parseContent(tpl.content),
      isActive: tpl.isActive,
      isDefault: tpl.isDefault,
      isFixed: tpl.isFixed,
    })
    setEditorOpen(true)
  }

  const selectedMeta = TEMPLATE_TYPE_META.find(
    (m) => m.value === selectedType,
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <span aria-hidden>{selectedMeta?.icon}</span>
            {selectedMeta?.label} — เทมเพลต
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {selectedMeta?.description}
          </p>
        </div>
        <Button
          onClick={openCreate}
          size="sm"
          className="shrink-0 bg-[#f97316] text-white hover:bg-[#ea580c]"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          สร้างเทมเพลตใหม่
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Sub-type selector (work-order / stock-out / stock-in / purchase-order) */}
        <div>
          <Label className="mb-2 block text-xs text-muted-foreground">
            ประเภทเอกสาร
          </Label>
          <div className="flex flex-wrap gap-2">
            {TEMPLATE_TYPE_META.filter(
              (m) => m.value !== 'sticker' && m.value !== 'pdf',
            ).map((meta) => {
              const active = selectedType === meta.value
              return (
                <button
                  key={meta.value}
                  type="button"
                  onClick={() => setSelectedType(meta.value)}
                  aria-pressed={active}
                  className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-1 ${
                    active
                      ? 'border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-300'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-orange-300 hover:bg-orange-50/50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-orange-800 dark:hover:bg-orange-950/20'
                  }`}
                >
                  <span aria-hidden>{meta.icon}</span>
                  <span className="font-medium">{meta.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Template list (table) */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !templates || templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm font-medium">ยังไม่มีเทมเพลตประเภทนี้</p>
            <p className="text-xs text-muted-foreground">
              กด &quot;สร้างเทมเพลตใหม่&quot; เพื่อสร้างเทมเพลตเริ่มต้น
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[180px]">ชื่อ</TableHead>
                  <TableHead className="min-w-[120px]">หมวดหมู่</TableHead>
                  <TableHead className="text-center">ประเภท</TableHead>
                  <TableHead className="text-center">สถานะ</TableHead>
                  <TableHead className="text-center">ค่าเริ่มต้น</TableHead>
                  <TableHead className="min-w-[110px]">วันที่สร้าง</TableHead>
                  <TableHead className="text-right">การจัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((tpl) => (
                  <TableRow key={tpl.id}>
                    <TableCell className="font-medium">{tpl.name}</TableCell>
                    <TableCell>
                      {tpl.category ? (
                        <span className="text-sm text-muted-foreground">
                          {tpl.category}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground/60">
                          —
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="outline"
                        className={
                          tpl.isFixed
                            ? 'border-sky-200 bg-sky-50 px-1.5 py-0 text-[10px] text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                            : 'border-teal-200 bg-teal-50 px-1.5 py-0 text-[10px] text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300'
                        }
                        title={
                          tpl.isFixed
                            ? 'เทมเพลตของระบบ — ลบไม่ได้'
                            : 'ผู้ใช้สร้างเอง'
                        }
                      >
                        {tpl.isFixed ? t('group.system') : 'กำหนดเอง'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={tpl.isActive ? 'default' : 'secondary'}
                        className={
                          tpl.isActive
                            ? 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : ''
                        }
                      >
                        {tpl.isActive ? t('status.active') : t('common.close')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {tpl.isDefault ? (
                        <Badge
                          variant="default"
                          className="border-orange-200 bg-orange-100 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300"
                        >
                          ★ ค่าเริ่มต้น
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground/60">
                          —
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatThaiDate(tpl.createdAt, lang)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => setActiveMutation.mutate(tpl)}
                          disabled={setActiveMutation.isPending}
                          title={tpl.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                          aria-label={
                            tpl.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'
                          }
                        >
                          <Check
                            className={`h-4 w-4 ${
                              tpl.isActive
                                ? 'text-emerald-600'
                                : 'text-muted-foreground'
                            }`}
                          />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => setDefaultMutation.mutate(tpl)}
                          disabled={setDefaultMutation.isPending}
                          title={
                            tpl.isDefault
                              ? 'ยกเลิกการตั้งเป็นค่าเริ่มต้น'
                              : 'ตั้งเป็นค่าเริ่มต้น'
                          }
                          aria-label="ค่าเริ่มต้น"
                        >
                          <Star
                            className={`h-4 w-4 ${
                              tpl.isDefault
                                ? 'fill-orange-500 text-orange-500'
                                : 'text-muted-foreground'
                            }`}
                          />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => duplicateMutation.mutate(tpl)}
                          disabled={duplicateMutation.isPending}
                          title="คัดลอก"
                          aria-label="คัดลอก"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => openEdit(tpl)}
                          title={t('settings.edit')}
                          aria-label={t('settings.edit')}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
                          onClick={() => setDeleteTarget(tpl)}
                          disabled={tpl.isFixed || tpl.isDefault}
                          title={
                            tpl.isFixed
                              ? 'ลบเทมเพลตของระบบไม่ได้'
                              : tpl.isDefault
                                ? 'ลบเทมเพลตเริ่มต้นไม่ได้'
                                : t('common.delete')
                          }
                          aria-label={t('settings.delete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <EditorDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          type={selectedType}
          initial={editorInitial}
        />

        <AlertDialog
          open={deleteTarget !== null}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ยืนยันการลบเทมเพลต</AlertDialogTitle>
              <AlertDialogDescription>
                คุณแน่ใจหรือไม่ว่าต้องการลบเทมเพลต{' '}
                <span className="font-medium text-foreground">
                  &quot;{deleteTarget?.name}&quot;
                </span>
                ? การกระทำนี้ย้อนกลับไม่ได้
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('settings.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                type="button"
                className="bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-600"
                disabled={deleteMutation.isPending}
                onClick={(e) => {
                  e.preventDefault() // prevent Radix auto-close before async completes
                  if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
                }}
              >
                {deleteMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ลบ…
                  </>
                ) : (
                  'ลบเทมเพลต'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

// =====================================================================
// Main page — type tabs + lazy mount of each tab's content
// =====================================================================

export function TemplatesPage() {
  const t = useT()
  const [tab, setTab] = React.useState<TabKey>('sticker')
  const setActivePage = useAppStore((s) => s.setActivePage)
  const queryClient = useQueryClient()
  const [seeding, setSeeding] = React.useState(false)
  const [seedResult, setSeedResult] = React.useState<string | null>(null)

  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0]

  const handleSeed = async () => {
    setSeeding(true)
    setSeedResult(null)
    try {
      const token = useAuthStore.getState().token
      const res = await fetch('/api/templates/seed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      const data = await res.json()
      if (res.ok) {
        setSeedResult(`✓ ${data.message}`)
        // Bug Group F fix: do NOT redirect (was window.location.reload()
        // which reset activePage to 'dashboard' on next mount). Instead,
        // invalidate templates queries so each tab's list re-fetches,
        // and stay on the current Templates page so the user can verify
        // the new templates populated. Toast provides immediate feedback.
        toast.success(data.message || 'ติดตั้งเทมเพลตเริ่มต้นสำเร็จ')
        await queryClient.invalidateQueries({ queryKey: ['templates'] })
        await queryClient.invalidateQueries({ queryKey: ['sticker-templates'] })
        await queryClient.invalidateQueries({ queryKey: ['document-templates'] })
      } else {
        setSeedResult(`✗ ${data.error || 'Seed failed'}`)
        toast.error(data.error || 'ติดตั้งเทมเพลตเริ่มต้นไม่สำเร็จ')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setSeedResult(`✗ ${msg}`)
      toast.error(msg)
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="flex h-full w-full flex-col gap-3 p-3 md:p-4 lg:p-5">
      {/* Compact header — h1 + seed button on one row, tabs right below */}
      <div className="flex flex-shrink-0 items-center justify-between gap-3">
        <h1 className="text-lg font-bold tracking-tight md:text-xl">
          📄 เทมเพลต
        </h1>
        <Button
          onClick={handleSeed}
          disabled={seeding}
          variant="outline"
          size="sm"
          className="shrink-0 border-[#f97316] text-[#f97316] hover:bg-[#f97316]/10"
        >
          <Sparkles className={`mr-1.5 h-4 w-4 ${seeding ? 'animate-pulse' : ''}`} />
          {seeding ? 'กำลังติดตั้ง...' : 'ติดตั้งเทมเพลตเริ่มต้น'}
        </Button>
      </div>

      {seedResult && (
        <div className={`rounded-lg border p-3 text-sm ${
          seedResult.startsWith('✓')
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
            : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
        }`}>
          {seedResult}
        </div>
      )}

      {/* Type tabs — sticker / document / work-order */}
      <div className="flex flex-shrink-0 flex-wrap gap-2">
        {TABS.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={active}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-1 ${
                active
                  ? 'border-orange-400 bg-orange-50 text-orange-700 shadow-sm dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-300'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-orange-300 hover:bg-orange-50/50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-orange-800 dark:hover:bg-orange-950/20'
              }`}
            >
              <span aria-hidden className="text-base">
                {t.icon}
              </span>
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* Active tab description */}
      <p className="flex-shrink-0 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{activeTab.icon} {activeTab.label}:</span>{' '}
        {activeTab.description}
      </p>

      {/* Tab content */}
      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {tab === 'sticker' && <StickerTab />}
        {tab === 'document' && <DocumentTab />}
        {tab === 'work-order' && <WorkOrderTab />}
      </motion.div>

      {/* Hint card */}
      <Card className="flex-shrink-0">
        <CardContent className="space-y-2 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            💡 วิธีใช้งานเทมเพลต
          </p>
          <ul className="ml-4 list-disc space-y-1 text-xs">
            <li>
              <strong>สติกเกอร์</strong> — ฉลากเล็กสำหรับติดอุปกรณ์ (75×36mm, 50×30mm) —
              กด &quot;สร้างใหม่&quot; เลือกขนาดกระดาษ
            </li>
            <li>
              <strong>เอกสาร PDF</strong> — ขนาดกระดาษ A4/A3 เช่น รายงานมิเตอร์รายเดือน
            </li>
            <li>
              <strong>ใบงาน</strong> — ใบแจ้งซ่อม / ใบเบิกอะไหล่ / ใบรับเครื่อง / ใบสั่งซื้อ —
              มีหน้าจอออกแบบในตัว
            </li>
            <li>
              เทมเพลต <Badge variant="outline" className="mx-1 px-1 py-0 text-[10px] border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300">ระบบ</Badge>
              เป็นเทมเพลตของระบบที่สร้างไว้ตั้งแต่ติดตั้ง — แก้ไขได้ แต่ลบไม่ได้ (คัดลอกได้)
            </li>
            <li>
              เทมเพลต <Badge variant="outline" className="mx-1 px-1 py-0 text-[10px] border-teal-300 bg-teal-100 text-teal-800 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300">กำหนดเอง</Badge>
              เป็นเทมเพลตที่ผู้ใช้สร้างเอง — ลบได้
            </li>
            <li>
              ปุ่ม <Star className="inline h-3 w-3 fill-orange-500 text-orange-500" />{' '}
              สำหรับตั้งเป็นค่าเริ่มต้น — เทมเพลตเริ่มต้นจะถูกเลือกอัตโนมัติเมื่อกดพิมพ์
            </li>
            <li>
              ปุ่มพิมพ์ในจุดที่ใช้จริง: ตารางอุปกรณ์ → &quot;สติกเกอร์&quot;,
              ใบงาน → &quot;พิมพ์ใบงาน&quot;
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Quick links back to editors (in case user is on a tab and wants
          to jump straight into the full-page editor without using a card
          button). Visible only when NOT on the work-order tab. */}
      {tab !== 'work-order' && (
        <div className="flex flex-wrap items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/50 p-3 text-xs dark:border-slate-700 dark:bg-slate-900/30">
          <span className="text-muted-foreground">
            ต้องการเปิดหน้าออกแบบประเภทนี้?
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setActivePage('itam-sticker-editor')}
          >
            <ArrowLeft className="mr-1 h-3 w-3 rotate-180" /> หน้าออกแบบสติกเกอร์
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setActivePage('itam-document-editor')}
          >
            <ArrowLeft className="mr-1 h-3 w-3 rotate-180" /> หน้าออกแบบเอกสาร PDF
          </Button>
        </div>
      )}
    </div>
  )
}
