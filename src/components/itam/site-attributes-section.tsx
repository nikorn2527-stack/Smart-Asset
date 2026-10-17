'use client'

/**
 * SiteAttributesSection — จัดการสาขา (Site Management)
 *
 * Admin UI for the SiteAttribute table (site code, name, LINE OA, hotline,
 * paper rates). The data is consumed by `/api/devices/next-site-code` to
 * generate per-site asset codes like `UDH-00001`.
 *
 * Endpoints used:
 *   GET    /api/site-attributes          → { sites: SiteAttribute[] }
 *   POST   /api/site-attributes          → create
 *   PUT    /api/site-attributes/[id]     → update
 *   DELETE /api/site-attributes/[id]     → delete
 *   POST   /api/site-attributes/sync     → mirror into MasterItem (category='Site')
 *
 * The Prisma `SiteAttribute` model uses PascalCase fields, so the JSON keys
 * returned by the API are also PascalCase (SiteCode, SiteName, LineOA,
 * Hotline, TelegramChatId, EmailAddress, PaperRateBW, PaperRateColor).
 */

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
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
  Building2,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Phone,
  MessageCircle,
  Send,
  Mail,
} from 'lucide-react'

/** Raw SiteAttribute row as returned by GET /api/site-attributes */
interface SiteAttribute {
  id: string
  SiteCode: string
  SiteName: string | null
  LineOA: string | null
  Hotline: string | null
  TelegramChatId: string | null
  EmailAddress: string | null
  PaperRateBW: number | null
  PaperRateColor: number | null
  created_at?: string
  updated_at?: string
}

interface SyncResponse {
  ok: boolean
  total: number
  created: number
  updated: number
  skipped: number
}

const EMPTY_FORM = {
  siteCode: '',
  siteName: '',
  lineOa: '',
  hotline: '',
  telegramChatId: '',
  emailAddress: '',
  paperRateBw: 0.5,
  paperRateColor: 2.0,
}

/**
 * Build a `baht` formatter for the per-page paper rate. Avoids Intl
 * polyfill issues in sandboxed runtimes.
 */
function formatBaht(value: number | string | null | undefined, fallback = 0): string {
  let n = fallback
  if (typeof value === 'number' && !Number.isNaN(value)) {
    n = value
  } else if (typeof value === 'string') {
    // Prisma Decimal serializes to string — parse it
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) n = parsed
  }
  return n.toFixed(2).replace(/\.00$/, '')
}

export function SiteAttributesSection() {
  const qc = useQueryClient()

  // ── List query ──────────────────────────────────────────────────────
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['site-attributes'],
    queryFn: async () => {
      const res = await fetch('/api/site-attributes')
      if (!res.ok) throw new Error('Failed to fetch site attributes')
      return res.json() as Promise<{ sites: SiteAttribute[] }>
    },
  })

  const sites = data?.sites ?? []

  // ── Add/Edit dialog state ───────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editTarget, setEditTarget] = React.useState<SiteAttribute | null>(null)
  const [form, setForm] = React.useState({ ...EMPTY_FORM })
  const [saving, setSaving] = React.useState(false)

  function openAdd() {
    setEditTarget(null)
    setForm({ ...EMPTY_FORM })
    setDialogOpen(true)
  }

  function openEdit(site: SiteAttribute) {
    setEditTarget(site)
    setForm({
      siteCode: site.SiteCode ?? '',
      siteName: site.SiteName ?? '',
      lineOa: site.LineOA ?? '',
      hotline: site.Hotline ?? '',
      telegramChatId: site.TelegramChatId ?? '',
      emailAddress: site.EmailAddress ?? '',
      paperRateBw:
        typeof site.PaperRateBW === 'number'
          ? site.PaperRateBW
          : typeof site.PaperRateBW === 'string'
            ? Number(site.PaperRateBW)
            : 0.5,
      paperRateColor:
        typeof site.PaperRateColor === 'number'
          ? site.PaperRateColor
          : typeof site.PaperRateColor === 'string'
            ? Number(site.PaperRateColor)
            : 2.0,
    })
    setDialogOpen(true)
  }

  async function saveSite() {
    const siteCode = form.siteCode.trim().toUpperCase()
    const siteName = form.siteName.trim()

    if (!siteCode) {
      toast.error('กรุณากรอกรหัสสาขา')
      return
    }
    if (!siteName) {
      toast.error('กรุณากรอกชื่อสาขา')
      return
    }

    setSaving(true)
    try {
      const payload = {
        siteCode,
        siteName,
        lineOa: form.lineOa.trim() || undefined,
        hotline: form.hotline.trim() || undefined,
        telegramChatId: form.telegramChatId.trim() || undefined,
        emailAddress: form.emailAddress.trim() || undefined,
        paperRateBw: Number(form.paperRateBw) || 0,
        paperRateColor: Number(form.paperRateColor) || 0,
      }

      if (editTarget) {
        const res = await fetch(
          `/api/site-attributes/${editTarget.id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        )
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || 'Failed to update site')
        }
        toast.success(`แก้ไขสาขา ${siteCode} แล้ว`)
      } else {
        const res = await fetch('/api/site-attributes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || 'Failed to create site')
        }
        toast.success(`เพิ่มสาขา ${siteCode} แล้ว`)
      }

      setDialogOpen(false)
      await qc.invalidateQueries({ queryKey: ['site-attributes'] })
      // Also refresh master-data (Site mirror) + itam sites cards
      await qc.invalidateQueries({ queryKey: ['itam-master'] })
      await qc.invalidateQueries({ queryKey: ['itam-sites'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete confirm state ────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = React.useState<SiteAttribute | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/site-attributes/${deleteTarget.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to delete')
      }
      toast.success(`ลบสาขา ${deleteTarget.SiteCode} แล้ว`)
      setDeleteTarget(null)
      await qc.invalidateQueries({ queryKey: ['site-attributes'] })
      await qc.invalidateQueries({ queryKey: ['itam-master'] })
      await qc.invalidateQueries({ queryKey: ['itam-sites'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ลบไม่สำเร็จ')
    } finally {
      setDeleting(false)
    }
  }

  // ── Sync to Master Data ─────────────────────────────────────────────
  const [syncing, setSyncing] = React.useState(false)

  async function syncToMaster() {
    setSyncing(true)
    try {
      const res = await fetch('/api/site-attributes/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to sync')
      }
      const result = (await res.json()) as SyncResponse
      toast.success(
        `Sync เสร็จ — สร้างใหม่ ${result.created} | อัปเดต ${result.updated} | ข้าม ${result.skipped} (รวม ${result.total} สาขา)`,
      )
      await qc.invalidateQueries({ queryKey: ['itam-master'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sync ไม่สำเร็จ')
    } finally {
      setSyncing(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header card with action buttons */}
      <Card className="border-teal-200/60 bg-teal-50/40 shadow-sm dark:border-teal-900/40 dark:bg-teal-950/20">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base text-teal-800 dark:text-teal-200">
              <Building2 className="h-5 w-5" />
              🏢 จัดการสาขา (Site Attributes)
            </CardTitle>
            <p className="text-xs text-teal-700/80 dark:text-teal-300/70">
              รหัสสาขาใช้สำหรับสร้าง Asset Code เช่น <code className="rounded bg-teal-100/70 px-1 py-0.5 font-mono text-[11px] dark:bg-teal-900/40">UDH-00001</code> — ข้อมูลนี้เชื่อมกับ Master Data (หมวด Site)
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={syncToMaster}
              disabled={syncing}
              className="border-teal-300 bg-white text-teal-700 hover:bg-teal-50 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200 dark:hover:bg-teal-900/30"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              🔄 Sync ไป Master Data
            </Button>
            <Button
              size="sm"
              onClick={openAdd}
              className="bg-teal-600 text-white hover:bg-teal-700"
            >
              <Plus className="h-4 w-4" />
              เพิ่มสาขา
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Sites table */}
      <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="p-0">
          <div className="itam-scroll max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-teal-50/80 backdrop-blur dark:bg-teal-950/60">
                <TableRow>
                  <TableHead className="w-24">รหัสสาขา</TableHead>
                  <TableHead>ชื่อสาขา</TableHead>
                  <TableHead className="hidden md:table-cell">LINE OA</TableHead>
                  <TableHead className="hidden md:table-cell">Hotline</TableHead>
                  <TableHead className="hidden md:table-cell">Telegram</TableHead>
                  <TableHead className="hidden md:table-cell">Email</TableHead>
                  <TableHead className="text-right whitespace-nowrap">ขาวดำ (฿/แผ่น)</TableHead>
                  <TableHead className="text-right whitespace-nowrap">สี (฿/แผ่น)</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell><Skeleton className="h-6 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-7 w-20 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : sites.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-12 text-center text-sm text-slate-400">
                      <Building2 className="mx-auto mb-2 h-8 w-8 opacity-40" />
                      ยังไม่มีข้อมูลสาขา — กด &quot;เพิ่มสาขา&quot; เพื่อเริ่มต้น
                    </TableCell>
                  </TableRow>
                ) : (
                  sites.map((site) => (
                    <TableRow
                      key={site.id}
                      className="hover:bg-teal-50/40 dark:hover:bg-teal-950/20"
                    >
                      <TableCell>
                        <Badge className="bg-teal-100 text-teal-800 hover:bg-teal-100 dark:bg-teal-900/40 dark:text-teal-200">
                          {site.SiteCode}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        {site.SiteName || (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-slate-500 dark:text-slate-400">
                        {site.LineOA ? (
                          <span className="inline-flex items-center gap-1">
                            <MessageCircle className="h-3 w-3 text-emerald-500" />
                            <span className="truncate max-w-[180px]" title={site.LineOA}>
                              {site.LineOA}
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-slate-500 dark:text-slate-400">
                        {site.Hotline ? (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3 w-3 text-emerald-500" />
                            {site.Hotline}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-slate-500 dark:text-slate-400">
                        {site.TelegramChatId ? (
                          <span className="inline-flex items-center gap-1">
                            <Send className="h-3 w-3 text-sky-500" />
                            <span className="truncate max-w-[140px] font-mono" title={site.TelegramChatId}>
                              {site.TelegramChatId}
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-slate-500 dark:text-slate-400">
                        {site.EmailAddress ? (
                          <span className="inline-flex items-center gap-1">
                            <Mail className="h-3 w-3 text-amber-500" />
                            <span className="truncate max-w-[200px]" title={site.EmailAddress}>
                              {site.EmailAddress}
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-600 dark:text-slate-300">
                        ฿{formatBaht(site.PaperRateBW, 0.5)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-600 dark:text-slate-300">
                        ฿{formatBaht(site.PaperRateColor, 2.0)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(site)}
                          aria-label={`แก้ไขสาขา ${site.SiteCode}`}
                          className="text-teal-700 hover:bg-teal-50 hover:text-teal-800 dark:text-teal-300 dark:hover:bg-teal-950/40"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteTarget(site)}
                          aria-label={`ลบสาขา ${site.SiteCode}`}
                          className="text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Footer summary + refresh */}
      <div className="flex flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between dark:text-slate-400">
        <span>
          รวม <strong className="text-teal-700 dark:text-teal-300">{sites.length}</strong> สาขา
          {isFetching && !isLoading && (
            <span className="ml-2 inline-flex items-center gap-1 text-teal-600">
              <RefreshCw className="h-3 w-3 animate-spin" /> กำลังรีเฟรช…
            </span>
          )}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => qc.invalidateQueries({ queryKey: ['site-attributes'] })}
          className="self-start text-teal-700 hover:bg-teal-50 hover:text-teal-800 sm:self-auto dark:text-teal-300 dark:hover:bg-teal-950/40"
        >
          <RefreshCw className="h-3.5 w-3.5" /> รีเฟรชรายการ
        </Button>
      </div>

      {/* ── Add / Edit dialog ────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={(open) => {
        if (!saving) setDialogOpen(open)
      }}>
        <DialogContent className="sm:max-w-lg dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-teal-800 dark:text-teal-200">
              <Building2 className="h-5 w-5" />
              {editTarget ? `แก้ไขสาขา ${editTarget.SiteCode}` : 'เพิ่มสาขาใหม่'}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* SiteCode */}
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="sa-site-code" className="text-xs">
                รหัสสาขา <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="sa-site-code"
                value={form.siteCode}
                onChange={(e) =>
                  setForm({ ...form, siteCode: e.target.value.toUpperCase() })
                }
                placeholder="เช่น UDH, NKP"
                maxLength={16}
                disabled={!!editTarget}
                className="font-mono uppercase dark:bg-slate-800 dark:border-slate-700"
              />
              {editTarget ? (
                <p className="text-[11px] text-slate-400">
                  รหัสสาขาเปลี่ยนไม่ได้ (ใช้สร้าง Asset Code)
                </p>
              ) : (
                <p className="text-[11px] text-slate-400">
                  ตัวอักษรพิมพ์ใหญ่, ใช้สร้าง Asset Code เช่น <code>UDH-00001</code>
                </p>
              )}
            </div>

            {/* SiteName */}
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="sa-site-name" className="text-xs">
                ชื่อสาขา <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="sa-site-name"
                value={form.siteName}
                onChange={(e) => setForm({ ...form, siteName: e.target.value })}
                placeholder="เช่น สำนักงานใหญ่, สาขากรุงเทพ"
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>

            {/* LineOA */}
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="sa-line-oa" className="text-xs">
                LINE OA <span className="text-slate-400">(ถ้ามี)</span>
              </Label>
              <Input
                id="sa-line-oa"
                value={form.lineOa}
                onChange={(e) => setForm({ ...form, lineOa: e.target.value })}
                placeholder="Channel ID หรือ Token"
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>

            {/* Hotline */}
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="sa-hotline" className="text-xs">
                Hotline <span className="text-slate-400">(ถ้ามี)</span>
              </Label>
              <Input
                id="sa-hotline"
                value={form.hotline}
                onChange={(e) => setForm({ ...form, hotline: e.target.value })}
                placeholder="เช่น 0-4221-XXXX"
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>

            {/* TelegramChatId */}
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="sa-telegram" className="text-xs">
                Telegram Chat ID <span className="text-slate-400">(ถ้ามี)</span>
              </Label>
              <Input
                id="sa-telegram"
                value={form.telegramChatId}
                onChange={(e) =>
                  setForm({ ...form, telegramChatId: e.target.value })
                }
                placeholder="เช่น -1001234567890"
                className="font-mono dark:bg-slate-800 dark:border-slate-700"
              />
            </div>

            {/* EmailAddress */}
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="sa-email" className="text-xs">
                Email Address <span className="text-slate-400">(ถ้ามี)</span>
              </Label>
              <Input
                id="sa-email"
                type="email"
                value={form.emailAddress}
                onChange={(e) =>
                  setForm({ ...form, emailAddress: e.target.value })
                }
                placeholder="เช่น it-udh@hospital.go.th"
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>

            {/* PaperRateBW */}
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="sa-rate-bw" className="text-xs">
                อัตราค่ากระดาษขาวดำ (฿/แผ่น)
              </Label>
              <Input
                id="sa-rate-bw"
                type="number"
                step={0.1}
                min={0}
                value={form.paperRateBw}
                onChange={(e) =>
                  setForm({ ...form, paperRateBw: Number(e.target.value) })
                }
                className="font-mono dark:bg-slate-800 dark:border-slate-700"
              />
            </div>

            {/* PaperRateColor */}
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="sa-rate-color" className="text-xs">
                อัตราค่ากระดาษสี (฿/แผ่น)
              </Label>
              <Input
                id="sa-rate-color"
                type="number"
                step={0.1}
                min={0}
                value={form.paperRateColor}
                onChange={(e) =>
                  setForm({ ...form, paperRateColor: Number(e.target.value) })
                }
                className="font-mono dark:bg-slate-800 dark:border-slate-700"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
              className="dark:bg-slate-800 dark:border-slate-700"
            >
              ยกเลิก
            </Button>
            <Button
              onClick={saveSite}
              disabled={saving}
              className="bg-teal-600 text-white hover:bg-teal-700"
            >
              {saving ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : editTarget ? (
                <Pencil className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {editTarget ? 'บันทึกการแก้ไข' : 'เพิ่มสาขา'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ───────────────────────────────────────────── */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!deleting) setDeleteTarget(open ? deleteTarget : null)
        }}
      >
        <AlertDialogContent className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
              <Trash2 className="h-5 w-5" />
              ยืนยันการลบสาขา
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  คุณกำลังจะลบสาขา{' '}
                  <strong className="text-rose-700 dark:text-rose-400">
                    {deleteTarget.SiteCode}
                  </strong>
                  {deleteTarget.SiteName ? (
                    <>
                      {' '}({deleteTarget.SiteName})
                    </>
                  ) : null}
                  <br />
                  ระบบจะปิดใช้งาน MasterItem หมวด Site ที่เกี่ยวข้อง (ไม่ลบประวัติ)
                  การกระทำนี้ไม่สามารถย้อนกลับได้
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="dark:bg-slate-800 dark:border-slate-700">
              ยกเลิก
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                void confirmDelete()
              }}
              disabled={deleting}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {deleting ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              ลบสาขา
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default SiteAttributesSection
