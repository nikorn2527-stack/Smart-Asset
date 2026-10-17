'use client'

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
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
  Bell,
  MessageSquare,
  Plus,
  Pencil,
  Trash2,
  Copy,
  Check,
  RefreshCw,
} from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'

// ============================================================
// Notification Template Management Section
//   - Lists templates stored in AppSetting.notification_templates
//   - Add / Edit / Delete / Duplicate actions
//   - Per-event variable hints
// ============================================================

// ── Event definitions (matched to notifications.ts) ──────────
type AppKey = 'itam' | 'services' | 'stock' | 'all'
type ChannelKey = 'line-oa' | 'telegram' | 'email'

interface EventDef {
  event: string
  app: AppKey
  label: string
  vars: readonly string[]
}

const EVENT_DEFINITIONS = [
  // Services (Work Orders)
  { event: 'wo_created', app: 'services', label: 'แจ้งซ่อมใหม่', vars: ['woNumber', 'subject', 'building', 'location', 'reporterName', 'tel', 'priority'] },
  { event: 'wo_assigned', app: 'services', label: 'มอบหมายงาน', vars: ['woNumber', 'subject', 'assignedTo', 'assignedBy'] },
  { event: 'wo_completed', app: 'services', label: 'ปิดงานแล้ว', vars: ['woNumber', 'subject', 'closedAt', 'resolution'] },
  { event: 'wo_cancelled', app: 'services', label: 'ยกเลิกงาน', vars: ['woNumber', 'subject', 'cancelReason'] },
  { event: 'wo_message', app: 'services', label: 'ข้อความใหม่', vars: ['woNumber', 'author', 'message'] },
  { event: 'parts_requested', app: 'services', label: 'เบิกอะไหล่', vars: ['woNumber', 'productCode', 'productName', 'quantity'] },
  { event: 'parts_approved', app: 'services', label: 'อนุมัติอะไหล่', vars: ['woNumber', 'productCode', 'quantity', 'approver'] },
  // Stock
  { event: 'stock_low', app: 'stock', label: 'สต็อกต่ำ', vars: ['productCode', 'productName', 'quantity', 'unit', 'reorderPoint'] },
  { event: 'stock_out', app: 'stock', label: 'สต็อกหมด', vars: ['productCode', 'productName'] },
  // ITAM (Devices)
  { event: 'deviceAdded', app: 'itam', label: 'เพิ่มอุปกรณ์', vars: ['assetCode', 'brand', 'model', 'site'] },
  { event: 'deviceUpdated', app: 'itam', label: 'แก้ไขอุปกรณ์', vars: ['assetCode', 'changes'] },
  { event: 'transfer', app: 'itam', label: 'ย้ายอุปกรณ์', vars: ['assetCode', 'fromSite', 'toSite'] },
  { event: 'meter', app: 'itam', label: 'จดมิเตอร์', vars: ['assetCode', 'pagesBw', 'pagesColor'] },
  { event: 'meter_reminder', app: 'itam', label: 'แจ้งเตือนจดมิเตอร์', vars: ['deviceName', 'assetCode', 'cycleName'] },
] as const

const APP_LABELS: Record<AppKey, string> = {
  itam: 'ITAM',
  services: 'Services',
  stock: 'Stock',
  all: 'ทั้งหมด',
}

const APP_DOT: Record<AppKey, string> = {
  itam: 'bg-amber-500',
  services: 'bg-rose-500',
  stock: 'bg-violet-500',
  all: 'bg-slate-500',
}

const CHANNEL_LABELS: Record<ChannelKey, string> = {
  'line-oa': 'LINE OA',
  telegram: 'Telegram',
  email: 'Email',
}

const CHANNEL_DOT: Record<ChannelKey, string> = {
  'line-oa': 'bg-emerald-500',
  telegram: 'bg-sky-500',
  email: 'bg-orange-500',
}

interface TemplateEntry {
  id: string
  app: AppKey
  event: string
  channels: ChannelKey[]
  title: string
  body: string
  enabled: boolean
}

interface FormState {
  id: string | null
  app: AppKey
  event: string
  channels: ChannelKey[]
  title: string
  body: string
  enabled: boolean
}

const EMPTY_FORM: FormState = {
  id: null,
  app: 'services',
  event: 'wo_created',
  channels: ['telegram'],
  title: '',
  body: '',
  enabled: true,
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const t = useAuthStore.getState()?.token
  if (t) h['Authorization'] = `Bearer ${t}`
  return h
}

function makeId(): string {
  return 'tpl_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3)
}

function eventsForApp(app: AppKey) {
  // 'all' sees every event; otherwise filter by app
  if (app === 'all') return EVENT_DEFINITIONS as readonly EventDef[]
  return (EVENT_DEFINITIONS as readonly EventDef[]).filter((e) => e.app === app)
}

function eventDef(event: string): EventDef | undefined {
  return (EVENT_DEFINITIONS as readonly EventDef[]).find((e) => e.event === event)
}

function appBadgeClass(app: AppKey): string {
  switch (app) {
    case 'itam':
      return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900'
    case 'services':
      return 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900'
    case 'stock':
      return 'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900'
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
  }
}

export function NotificationTemplatesSection() {
  const qc = useQueryClient()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [deleteId, setDeleteId] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)

  // ── Fetch templates ────────────────────────────────────────
  const { data, isLoading, isFetching } = useQuery<TemplateEntry[]>({
    queryKey: ['notify-templates'],
    queryFn: async () => {
      const res = await fetch('/api/settings/notification-templates', {
        headers: authHeaders(),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
      const j = (await res.json()) as { data?: TemplateEntry[] }
      return j.data ?? []
    },
  })

  // ── Save mutation (PUT full array) ────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (next: TemplateEntry[]) => {
      const res = await fetch('/api/settings/notification-templates', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ templates: next }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'บันทึกไม่สำเร็จ')
      }
      const j = (await res.json()) as { data?: TemplateEntry[] }
      return j.data ?? next
    },
    onSuccess: () => {
      toast.success('บันทึกเทมเพลตแล้ว')
      qc.invalidateQueries({ queryKey: ['notify-templates'] })
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    },
  })

  const templates = data ?? []

  // ── Actions ───────────────────────────────────────────────
  function openAdd() {
    setForm({ ...EMPTY_FORM })
    setDialogOpen(true)
  }

  function openEdit(t: TemplateEntry) {
    setForm({
      id: t.id,
      app: t.app,
      event: t.event,
      channels: [...t.channels],
      title: t.title,
      body: t.body,
      enabled: t.enabled,
    })
    setDialogOpen(true)
  }

  function openDuplicate(t: TemplateEntry) {
    setForm({
      id: null,
      app: t.app,
      event: t.event,
      channels: [...t.channels],
      title: t.title + ' (สำเนา)',
      body: t.body,
      enabled: t.enabled,
    })
    setDialogOpen(true)
  }

  function confirmDelete() {
    if (!deleteId) return
    const next = templates.filter((t) => t.id !== deleteId)
    // Close the dialog only after the mutation succeeds; onError shows a toast.
    saveMutation.mutate(next, {
      onSuccess: () => setDeleteId(null),
    })
  }

  function toggleEnabled(t: TemplateEntry, value: boolean) {
    const next = templates.map((x) => (x.id === t.id ? { ...x, enabled: value } : x))
    saveMutation.mutate(next)
  }

  // ── Save form (add or edit) ───────────────────────────────
  function saveForm() {
    if (!form.event) {
      toast.error('กรุณาเลือกเหตุการณ์')
      return
    }
    if (!form.title.trim()) {
      toast.error('กรุณากรอกหัวข้อ')
      return
    }
    if (form.channels.length === 0) {
      toast.error('กรุณาเลือกอย่างน้อย 1 ช่องทาง')
      return
    }

    const entry: TemplateEntry = {
      id: form.id ?? makeId(),
      app: form.app,
      event: form.event,
      channels: form.channels,
      title: form.title,
      body: form.body,
      enabled: form.enabled,
    }

    let next: TemplateEntry[]
    if (form.id) {
      next = templates.map((t) => (t.id === form.id ? entry : t))
    } else {
      next = [...templates, entry]
    }
    saveMutation.mutate(next)
    setDialogOpen(false)
  }

  // ── Helpers for form ──────────────────────────────────────
  function onAppChange(app: AppKey) {
    // when app changes, default event to first event in that app group
    const evs = eventsForApp(app)
    const stillValid = evs.some((e) => e.event === form.event)
    setForm({ ...form, app, event: stillValid ? form.event : (evs[0]?.event ?? '') })
  }

  function toggleChannel(ch: ChannelKey, checked: boolean) {
    if (checked) {
      if (!form.channels.includes(ch)) {
        setForm({ ...form, channels: [...form.channels, ch] })
      }
    } else {
      setForm({ ...form, channels: form.channels.filter((c) => c !== ch) })
    }
  }

  const currentVars = eventDef(form.event)?.vars ?? []
  const titlePlaceholder = currentVars.length
    ? `ตัวอย่าง: ใบงาน {woNumber} — {subject}`
    : 'กรอกหัวข้อข้อความ'
  const bodyPlaceholder = currentVars.length
    ? `ตัวอย่าง:\nหัวข้อ: {subject}\nสถานที่: {building} - {location}\nผู้แจ้ง: {reporterName}\nเบอร์: {tel}`
    : 'กรอกเนื้อหาข้อความ'

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <MessageSquare className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          <span>
            กำหนดข้อความแจ้งเตือนสำหรับแต่ละเหตุการณ์ — รองรับตัวแปร{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] dark:bg-slate-800">{`{variable}`}</code>
          </span>
        </div>
        <div className="flex gap-2 sm:ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ['notify-templates'] })}
            className="dark:bg-slate-800 dark:border-slate-700"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> รีเฟรช
          </Button>
          <Button
            size="sm"
            onClick={openAdd}
            className="bg-teal-600 text-white hover:bg-teal-700"
          >
            <Plus className="h-4 w-4" /> เพิ่มเทมเพลต
          </Button>
        </div>
      </div>

      {/* Templates table */}
      <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            เทมเพลตข้อความแจ้งเตือน
            {templates.length > 0 && (
              <Badge className="bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-900">
                {templates.length} รายการ
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="itam-scroll max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-100/95 backdrop-blur dark:bg-slate-900/95 z-10">
                <TableRow>
                  <TableHead className="min-w-[110px]">แอป</TableHead>
                  <TableHead className="min-w-[140px]">เหตุการณ์</TableHead>
                  <TableHead className="min-w-[160px]">ช่องทาง</TableHead>
                  <TableHead className="min-w-[220px]">หัวข้อ</TableHead>
                  <TableHead className="min-w-[100px] text-center">สถานะ</TableHead>
                  <TableHead className="min-w-[140px] text-right">การกระทำ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                      <TableCell className="text-center"><Skeleton className="h-5 w-10 mx-auto rounded-full" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-7 w-24 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : templates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-sm text-slate-400">
                      <Bell className="mx-auto mb-2 h-8 w-8 opacity-40" />
                      ยังไม่มีเทมเพลตข้อความ — กด &quot;เพิ่มเทมเพลต&quot; เพื่อเริ่มต้น
                    </TableCell>
                  </TableRow>
                ) : (
                  templates.map((t) => {
                    const def = eventDef(t.event)
                    return (
                      <TableRow key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                            <span className={`h-2 w-2 rounded-full ${APP_DOT[t.app]}`} />
                            {APP_LABELS[t.app]}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                              {def?.label ?? t.event}
                            </span>
                            <span className="font-mono text-[11px] text-slate-400">{t.event}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {t.channels.length === 0 ? (
                              <span className="text-xs text-slate-400">—</span>
                            ) : (
                              t.channels.map((ch) => (
                                <Badge
                                  key={ch}
                                  variant="outline"
                                  className="inline-flex items-center gap-1 text-[11px]"
                                >
                                  <span className={`h-1.5 w-1.5 rounded-full ${CHANNEL_DOT[ch]}`} />
                                  {CHANNEL_LABELS[ch]}
                                </Badge>
                              ))
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[360px]">
                            <div className="truncate text-sm font-medium text-slate-700 dark:text-slate-200" title={t.title}>
                              {t.title || <span className="text-slate-400">—</span>}
                            </div>
                            {t.body && (
                              <div className="mt-0.5 truncate text-[11px] text-slate-400" title={t.body}>
                                {t.body.split('\n')[0]}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={t.enabled}
                            onCheckedChange={(v) => toggleEnabled(t, v)}
                            aria-label="สถานะเปิดใช้งาน"
                          />
                          <div className="mt-1">
                            {t.enabled ? (
                              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900">
                                <Check className="mr-0.5 h-3 w-3" /> เปิด
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-slate-400">ปิด</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEdit(t)}
                              title="แก้ไข"
                              className="text-teal-600 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950/40"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openDuplicate(t)}
                              title="ทำสำเนา"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeleteId(t.id)}
                              title="ลบ"
                              className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Add/Edit Dialog ─────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[95vh] overflow-y-auto dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              {form.id ? 'แก้ไขเทมเพลต' : 'เพิ่มเทมเพลตข้อความ'}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {/* App + Event row */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">แอป *</Label>
                <Select value={form.app} onValueChange={(v) => onAppChange(v as AppKey)}>
                  <SelectTrigger className="dark:bg-slate-800 dark:border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="itam">ITAM</SelectItem>
                    <SelectItem value="services">Services</SelectItem>
                    <SelectItem value="stock">Stock</SelectItem>
                    <SelectItem value="all">ทั้งหมด (All)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">เหตุการณ์ *</Label>
                <Select value={form.event} onValueChange={(v) => setForm({ ...form, event: v })}>
                  <SelectTrigger className="dark:bg-slate-800 dark:border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {form.app === 'all' ? (
                      <>
                        <SelectGroup>
                          <SelectLabel>ITAM</SelectLabel>
                          {eventsForApp('itam').map((e) => (
                            <SelectItem key={e.event} value={e.event}>
                              {e.label} · <span className="font-mono text-[10px] text-slate-400">{e.event}</span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                        <SelectGroup>
                          <SelectLabel>Services</SelectLabel>
                          {eventsForApp('services').map((e) => (
                            <SelectItem key={e.event} value={e.event}>
                              {e.label} · <span className="font-mono text-[10px] text-slate-400">{e.event}</span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                        <SelectGroup>
                          <SelectLabel>Stock</SelectLabel>
                          {eventsForApp('stock').map((e) => (
                            <SelectItem key={e.event} value={e.event}>
                              {e.label} · <span className="font-mono text-[10px] text-slate-400">{e.event}</span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </>
                    ) : (
                      eventsForApp(form.app).map((e) => (
                        <SelectItem key={e.event} value={e.event}>
                          {e.label} · <span className="font-mono text-[10px] text-slate-400">{e.event}</span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Channels */}
            <div className="space-y-2">
              <Label className="text-xs">ช่องทางส่ง *</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(Object.keys(CHANNEL_LABELS) as ChannelKey[]).map((ch) => (
                  <label
                    key={ch}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 p-2.5 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50"
                  >
                    <Checkbox
                      checked={form.channels.includes(ch)}
                      onCheckedChange={(v) => toggleChannel(ch, v === true)}
                    />
                    <span className="flex items-center gap-1.5 text-sm">
                      <span className={`h-2 w-2 rounded-full ${CHANNEL_DOT[ch]}`} />
                      {CHANNEL_LABELS[ch]}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Available variables hint */}
            {currentVars.length > 0 && (
              <div className="rounded-md border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-900 dark:bg-teal-950/20">
                <div className="mb-1.5 text-xs font-semibold text-teal-800 dark:text-teal-300">
                  📌 ตัวแปรที่ใช้ได้สำหรับเหตุการณ์นี้
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {currentVars.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        // Insert at cursor — append to body for simplicity
                        setForm({ ...form, body: form.body + (form.body ? ' ' : '') + `{${v}}` })
                      }}
                      className="rounded border border-teal-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-teal-700 transition hover:bg-teal-100 dark:border-teal-800 dark:bg-slate-900 dark:text-teal-300 dark:hover:bg-teal-950/50"
                      title="คลิกเพื่อแทรกที่ท้ายเนื้อหา"
                    >
                      {`{${v}}`}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-teal-700/80 dark:text-teal-400/80">
                  💡 คลิกที่ตัวแปรเพื่อแทรกท้ายช่องเนื้อหา หรือพิมพ์ <code>{`{variable}`}</code> ลงในหัวข้อ/เนื้อหาได้โดยตรง
                </p>
              </div>
            )}

            {/* Title */}
            <div className="space-y-1.5">
              <Label className="text-xs">หัวข้อ (Title) *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={titlePlaceholder}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>

            {/* Body */}
            <div className="space-y-1.5">
              <Label className="text-xs">เนื้อหา (Body)</Label>
              <Textarea
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                placeholder={bodyPlaceholder}
                rows={6}
                className="font-mono text-xs dark:bg-slate-800 dark:border-slate-700"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                ใช้บรรทัดใหม่ (\n) สำหรับขึ้นบรรทัด — ตัวแปรในรูป <code>{`{varName}`}</code> จะถูกแทนด้วยค่าจริงตอนส่ง
              </p>
            </div>

            {/* Enabled toggle */}
            <div className="flex items-center justify-between rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <div>
                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">เปิดใช้งานเทมเพลตนี้</div>
                <div className="text-xs text-slate-400">ปิดชั่วคราวได้โดยไม่ต้องลบ</div>
              </div>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => setForm({ ...form, enabled: v })}
              />
            </div>

            {/* Live preview */}
            {(form.title || form.body) && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  ตัวอย่างข้อความ (พรีวิว)
                </div>
                <div className="rounded bg-white p-2.5 text-xs shadow-sm dark:bg-slate-900">
                  <div className="font-semibold text-slate-700 dark:text-slate-200">
                    {form.title || <span className="text-slate-400">(ยังไม่กรอกหัวข้อ)</span>}
                  </div>
                  {form.body && (
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-600 dark:text-slate-300">
                      {form.body}
                    </pre>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="dark:bg-slate-800 dark:border-slate-700">
              ยกเลิก
            </Button>
            <Button
              onClick={saveForm}
              disabled={saveMutation.isPending}
              className="bg-teal-600 text-white hover:bg-teal-700"
            >
              {saveMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ─────────────────────────────────── */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle>ลบเทมเพลตนี้?</AlertDialogTitle>
            <AlertDialogDescription>
              การกระทำนี้ไม่สามารถยกเลิกได้ — เทมเพลตจะถูกลบออกจากระบบทันที
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="dark:bg-slate-800 dark:border-slate-700">ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                confirmDelete()
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              ลบเทมเพลต
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
