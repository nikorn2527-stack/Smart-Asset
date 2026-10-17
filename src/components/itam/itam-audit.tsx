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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Search, RefreshCw, ChevronLeft, ChevronRight, Download, ScrollText, Filter } from 'lucide-react'
import { downloadCsv, dateStamp } from '@/lib/csv'
import { useAuthStore } from '@/store/auth-store'
import { CustomExportDialog, type ExportColumn, type ExportFormat } from './custom-export-dialog'
import { runCustomExport } from '@/lib/custom-export'
import { useT, useLang } from '@/store/i18n-store'

// ============================================================
// Custom Export — Audit page (Task ID: FIX-1-2-EXPORT-PRINT)
// ============================================================
const AUDIT_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'createdAt', label: 'วันที่/เวลา', group: 'หลัก' },
  { key: 'action', label: 'การกระทำ', group: 'หลัก' },
  { key: 'entity', label: 'ประเภท', group: 'หลัก' },
  { key: 'summary', label: 'รายการ', group: 'หลัก' },
  { key: 'actor', label: 'ผู้ดำเนินการ', group: 'หลัก' },
  { key: 'site', label: 'สาขา', group: 'หลัก' },
]

/**
 * Audit Log display (Task ID: FIX-RBAC-AUDIT-CYCLE-SITE — Issue 3).
 *
 * AuditLog columns (matches Prisma schema + DB):
 *   id, action, entity, entityId, summary, detail, actor, createdAt
 *
 * Fixes vs old version:
 *   • Reads `log.createdAt` (was `log.timestamp`)
 *   • Reads `log.actor` (was `log.user`)
 *   • Reads `log.detail` / `log.summary` (was `log.details`)
 *   • Adds action / actor / search / date-range filters
 *   • CSV export with all columns
 */

interface AuditLog {
  id: string
  action: string
  entity: string
  entityId: string | null
  summary: string
  detail: string | null
  actor: string
  createdAt: string
}
interface AuditResponse {
  logs: AuditLog[]
  count: number
  pagination: { page: number; limit: number; total: number; totalPages: number }
  actions?: { action: string; count: number }[]
}

// Curated action set — the dropdown also fetches the DB's distinct actions
// so new ones appear automatically. These are the common labels.
const ACTION_LABELS: Record<string, string> = {
  CREATE: 'เพิ่ม',
  UPDATE: 'แก้ไข',
  UPDATE_DEVICE: 'แก้ไขอุปกรณ์',
  DELETE: 'ลบ',
  LOGIN: 'เข้าสู่ระบบ',
  LOGOUT: 'ออกจากระบบ',
  METER_READING: 'จดมิเตอร์',
  METER_WRITE: 'บันทึกมิเตอร์',
  ASSIGN: 'มอบหมาย',
  RETURN: 'คืนอุปกรณ์',
  MAINTENANCE: 'ซ่อมบำรุง',
  SYNC: 'ซิงก์ข้อมูล',
  TRANSFER: 'ย้าย',
  BULK_UPDATE_DEVICES: 'แก้ไขกลุ่ม',
  BULK_TRANSFER: 'ย้ายกลุ่ม',
  BULK_DELETE: 'ลบกลุ่ม',
  IMPORT_DEVICES: 'นำเข้าอุปกรณ์',
  NOTIFY_SENT: 'ส่งแจ้งเตือน',
  CYCLE_START: 'เริ่มรอบจดมิเตอร์',
  CYCLE_END: 'ปิดรอบจดมิเตอร์',
  // ── Additional labels (from QA batch-4 — bug #8: duplicate text fix) ──
  GENERATE: 'สร้างรายงาน',
  IMPORT_LEGACY: 'นำเข้าข้อมูลเดิม',
  IMPORT: 'นำเข้า',
  INVITE_REQUEST: 'ร้องขอสิทธิ์เข้าใช้',
  AUTH_FALLBACK: 'กู้คืนการเข้าถึง',
  DEMO_RESET: 'รีเซ็ตข้อมูลเดโม',
  DOC_TEMPLATE_RENDER: 'สร้างเอกสารจากเทมเพลต',
  DOC_TEMPLATE_CREATE: 'สร้างเทมเพลตเอกสาร',
  DOC_TEMPLATE_UPDATE: 'แก้ไขเทมเพลตเอกสาร',
  DOC_TEMPLATE_DELETE: 'ลบเทมเพลตเอกสาร',
  DOC_TEMPLATE_ACTIVATE: 'ปิดใช้งานเทมเพลต',
  CONTACT_DIRECTORY_ADD: 'เพิ่มรายชื่อติดต่อ',
  STOCK_IN: 'รับเข้าสต๊อก',
  STOCK_OUT: 'เบิกออกสต๊อก',
  STOCK_ADJUST: 'ปรับสต๊อก',
  PM_COMPLETE: 'เสร็จสิ้น PM',
  PM_SKIP: 'ข้าม PM',
  WO_ASSIGN: 'มอบหมายงาน',
  WO_REOPEN: 'เปิดงานใหม่',
  WO_CLOSE: 'ปิดงาน',
  WO_CREATE: 'แจ้งซ่อมใหม่',
  WO_COMPLETE: 'ปิดงานซ่อม',
  WO_CANCEL: 'ยกเลิกงาน',
  WO_PARTS_REQUEST: 'เบิกอะไหล่',
  WO_UPDATE: 'แก้ไขใบงาน',
  WO_MESSAGE: 'ส่งข้อความในงาน',
  WO_PHOTO_UPLOAD: 'อัปโหลดรูปงาน',
  STICKER_RENDER: 'พิมพ์สติกเกอร์',
  PRINT: 'พิมพ์',
  EXPORT: 'ส่งออกข้อมูล',
  SEED: 'เพิ่มข้อมูลเริ่มต้น',
  BACKUP: 'สำรองข้อมูล',
  SETTINGS_UPDATE: 'แก้ไขการตั้งค่า',
  USER_CREATE: 'เพิ่มผู้ใช้',
  USER_UPDATE: 'แก้ไขผู้ใช้',
  USER_DELETE: 'ลบผู้ใช้',
  USER_APPROVE: 'อนุมัติผู้ใช้',
  USER_REJECT: 'ปฏิเสธผู้ใช้',
  ROLE_UPDATE: 'แก้ไขสิทธิ์การใช้งาน',
  SITE_UPDATE: 'แก้ไขสาขา',
  METER_CYCLE_START: 'เริ่มรอบจดมิเตอร์',
  METER_CYCLE_END: 'ปิดรอบจดมิเตอร์',
}

const ACTION_BADGE: Record<string, string> = {
  CREATE: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
  UPDATE_DEVICE: 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-800',
  UPDATE: 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-800',
  DELETE: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800',
  BULK_DELETE: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800',
  LOGIN: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300',
  LOGOUT: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300',
  METER_READING: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
  METER_WRITE: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
  ASSIGN: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800',
  RETURN: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800',
  MAINTENANCE: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800',
  SYNC: 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800',
  TRANSFER: 'bg-stone-100 text-stone-700 border-stone-200 dark:bg-stone-800 dark:text-stone-300',
  BULK_UPDATE_DEVICES: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800',
  BULK_TRANSFER: 'bg-stone-100 text-stone-700 border-stone-200 dark:bg-stone-800 dark:text-stone-300',
  IMPORT_DEVICES: 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800',
  NOTIFY_SENT: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800',
  CYCLE_START: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
  CYCLE_END: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300',
}

function fmtTimestamp(iso: string | null, lang: 'th' | 'en' = 'th'): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
      dateStyle: 'short',
      timeStyle: 'medium',
    })
  } catch {
    return iso
  }
}

function tryPrettyDetail(s: string | null): string {
  if (!s) return '—'
  try {
    const obj = JSON.parse(s)
    return JSON.stringify(obj)
  } catch {
    return s
  }
}

function actionLabel(a: string): string {
  return ACTION_LABELS[a] ?? a
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const t = useAuthStore.getState()?.token
  if (t) h['Authorization'] = `Bearer ${t}`
  return h
}

export function ItamAudit() {
  const t = useT()
  const { lang } = useLang()
  const qc = useQueryClient()
  const [action, setAction] = React.useState('all')
  const [actor, setActor] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [startDate, setStartDate] = React.useState('')
  const [endDate, setEndDate] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [limit] = React.useState(25)

  // Custom export dialog state (Task ID: FIX-1-2-EXPORT-PRINT)
  const [customExportOpen, setCustomExportOpen] = React.useState(false)

  const queryKey = React.useMemo(
    () => ['itam-audit', action, actor, search, startDate, endDate, page, limit],
    [action, actor, search, startDate, endDate, page, limit],
  )

  const { data, isLoading, isFetching } = useQuery<AuditResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (action !== 'all') params.set('action', action)
      if (actor.trim()) params.set('actor', actor.trim())
      if (search.trim()) params.set('q', search.trim())
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      const res = await fetch(`/api/itam/audit?${params}`, {
        headers: authHeaders(),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || t('status.failed'))
      }
      return res.json()
    },
  })

  const logs = data?.logs ?? []
  const total = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 0

  // Build the action dropdown options — merge the curated list with what
  // the DB reports as currently present.
  const actionOptions = React.useMemo(() => {
    const set = new Set<string>()
    for (const a of data?.actions ?? []) set.add(a.action)
    for (const k of Object.keys(ACTION_LABELS)) set.add(k)
    return Array.from(set).sort()
  }, [data?.actions])

  async function exportCsv() {
    // Bug Group D — audit export must include ALL matching rows, not just
    // the current page. Re-fetch with a high limit using the same filters
    // so the exported CSV matches what the user sees on screen.
    toast.info('กำลังเตรียมข้อมูลส่งออก…')
    const params = new URLSearchParams({ page: '1', limit: '10000' })
    if (action !== 'all') params.set('action', action)
    if (actor.trim()) params.set('actor', actor.trim())
    if (search.trim()) params.set('q', search.trim())
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    let allLogs: AuditLog[] = logs
    try {
      const res = await fetch(`/api/itam/audit?${params}`, { headers: authHeaders() })
      if (res.ok) {
        const j: { logs?: AuditLog[] } = await res.json()
        if (Array.isArray(j.logs) && j.logs.length > 0) allLogs = j.logs
      }
    } catch {
      // Fall back to current page logs if the bulk fetch fails.
      allLogs = logs
    }
    if (allLogs.length === 0) {
      toast.warning('ไม่มีข้อมูลให้ส่งออก')
      return
    }
    const rows = allLogs.map((l) => ({
      createdAt: l.createdAt || '',
      action: l.action,
      actionLabel: actionLabel(l.action),
      entity: l.entity || '',
      entityId: l.entityId || '',
      actor: l.actor || '',
      summary: l.summary || '',
      detail: tryPrettyDetail(l.detail),
    }))
    downloadCsv(`audit-${dateStamp()}.csv`, rows, [
      { key: 'createdAt', label: 'วันที่/เวลา' },
      { key: 'action', label: 'รหัสการกระทำ' },
      { key: 'actionLabel', label: 'การกระทำ' },
      { key: 'entity', label: 'ประเภท' },
      { key: 'entityId', label: 'รหัสรายการ' },
      { key: 'actor', label: 'ผู้ดำเนินการ' },
      { key: 'summary', label: 'สรุป' },
      { key: 'detail', label: 'รายละเอียด' },
    ])
    toast.success(`ส่งออก ${rows.length} รายการ`)
  }

  function resetFilters() {
    setAction('all')
    setActor('')
    setSearch('')
    setStartDate('')
    setEndDate('')
    setPage(1)
  }

  // ── Custom Export handler ── (Task ID: FIX-1-2-EXPORT-PRINT)
  // Fetches ALL matching audit logs (ignoring pagination) and maps each
  // row to the user-selected columns. The `site` column is best-effort:
  // if the audit detail JSON contains a `site` field we use it; otherwise
  // empty string. (AuditLog schema doesn't have a dedicated site column.)
  const handleCustomExport = React.useCallback(
    async (columns: ExportColumn[], format: ExportFormat) => {
      // Re-fetch with a high limit so the export includes everything that
      // matches the current filters, not just the current page.
      const params = new URLSearchParams({ page: '1', limit: '10000' })
      if (action !== 'all') params.set('action', action)
      if (actor.trim()) params.set('actor', actor.trim())
      if (search.trim()) params.set('q', search.trim())
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      const res = await fetch(`/api/itam/audit?${params}`, { headers: authHeaders() })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'โหลดข้อมูล audit ไม่สำเร็จ')
      }
      const json: { logs: AuditLog[] } = await res.json()
      const allLogs = json.logs ?? []
      if (allLogs.length === 0) {
        toast.warning('ไม่มีข้อมูล audit ในตัวกรองปัจจุบันให้ส่งออก')
        return
      }
      const rows: Record<string, unknown>[] = allLogs.map((l) => {
        // Try to extract `site` from the detail JSON if present.
        let siteVal = ''
        if (l.detail) {
          try {
            const obj = JSON.parse(l.detail) as Record<string, unknown>
            if (typeof obj.site === 'string') siteVal = obj.site
            else if (typeof obj.siteName === 'string') siteVal = obj.siteName
          } catch {
            // detail wasn't JSON — leave siteVal empty
          }
        }
        return {
          createdAt: fmtTimestamp(l.createdAt, lang),
          action: actionLabel(l.action),
          entity: l.entity ?? '',
          summary: l.summary ?? '',
          actor: l.actor ?? '',
          site: siteVal,
        }
      })
      runCustomExport(columns, format, rows, 'audit-log', 'รายงานประวัติการใช้งาน (Audit Log)')
      toast.success(`ส่งออก ${rows.length} รายการ`)
    },
    [action, actor, search, startDate, endDate],
  )

  const hasActiveFilter =
    action !== 'all' ||
    actor.trim() !== '' ||
    search.trim() !== '' ||
    startDate !== '' ||
    endDate !== ''

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            📜 ประวัติการใช้งาน (Audit Log)
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            ทั้งหมด {total.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} รายการ
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => qc.invalidateQueries({ queryKey })}
            className="dark:bg-slate-800 dark:border-slate-700"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> รีเฟรช
          </Button>
          <Button
            variant="outline"
            onClick={exportCsv}
            className="dark:bg-slate-800 dark:border-slate-700"
          >
            <Download className="h-4 w-4" /> ส่งออก CSV
          </Button>
          {/* Export (custom) — Task ID: FIX-1-2-EXPORT-PRINT */}
          <Button
            variant="outline"
            onClick={() => setCustomExportOpen(true)}
            className="border-[#f97316] text-[#f97316] hover:bg-[#f97316]/10 dark:border-[#fb923c] dark:text-[#fb923c]"
          >
            <Download className="h-4 w-4" /> ส่งออกแบบกำหนดเอง
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <Card className="flex-shrink-0 border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="w-full sm:w-48">
              <Label className="mb-1 block text-xs text-slate-500">การกระทำ</Label>
              <Select value={action} onValueChange={(v) => { setAction(v); setPage(1) }}>
                <SelectTrigger className="w-full dark:bg-slate-800 dark:border-slate-700">
                  <SelectValue placeholder="เลือกการกระทำ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทั้งหมด</SelectItem>
                  {actionOptions.map((a) => (
                    <SelectItem key={a} value={a}>
                      {actionLabel(a)} ({a})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-48">
              <Label className="mb-1 block text-xs text-slate-500">ผู้ดำเนินการ</Label>
              <Input
                placeholder="เช่น admin@example.com"
                value={actor}
                onChange={(e) => { setActor(e.target.value); setPage(1) }}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
              {/* SPRINT-3 #9: "กิจกรรมของฉัน" quick toggle — filters audit log
                  to entries where actor matches the logged-in user's email */}
              <button
                type="button"
                onClick={() => {
                  const me = useAuthStore.getState()?.user?.email ?? ''
                  setActor(me)
                  setPage(1)
                }}
                className="mt-1 text-[11px] font-medium text-[#f97316] transition-colors hover:text-[#ea580c]"
              >
                กิจกรรมของฉัน →
              </button>
            </div>
            <div className="flex-1">
              <Label className="mb-1 block text-xs text-slate-500">ค้นหา</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="ค้นหาคำในสรุป / รายละเอียด / ผู้ใช้…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                  className="pl-9 dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
            </div>
            <div className="w-full sm:w-40">
              <Label className="mb-1 block text-xs text-slate-500">จากวันที่</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(1) }}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>
            <div className="w-full sm:w-40">
              <Label className="mb-1 block text-xs text-slate-500">ถึงวันที่</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(1) }}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>
            {hasActiveFilter && (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="text-slate-500 hover:text-slate-700 dark:text-slate-400">
                <Filter className="h-3.5 w-3.5" /> ล้าง
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="flex min-h-0 flex-1 flex-col border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="min-h-0 flex-1 p-0">
          <div className="itam-scroll h-full overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                <TableRow>
                  <TableHead className="w-44">{t('import.col_date')}</TableHead>
                  <TableHead className="w-40">การกระทำ</TableHead>
                  <TableHead className="w-28">ประเภท</TableHead>
                  <TableHead className="w-48">ผู้ดำเนินการ</TableHead>
                  <TableHead>{t('reports.type.summary')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-12">
                      <div className="flex flex-col items-center gap-2 text-slate-400">
                        <ScrollText className="h-10 w-10" />
                        <span className="text-sm">ไม่พบรายการ</span>
                        {hasActiveFilter && (
                          <Button variant="ghost" size="sm" onClick={resetFilters} className="mt-1">
                            ล้างตัวกรอง
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((l) => (
                    <TableRow key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-300">
                        {fmtTimestamp(l.createdAt, lang)}
                      </TableCell>
                      <TableCell>
                        <Badge className={ACTION_BADGE[l.action] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}>
                          {actionLabel(l.action)}
                        </Badge>
                        <span className="ml-1.5 font-mono text-[10px] text-slate-400">{l.action}</span>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 dark:text-slate-400">
                        {l.entity || '—'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                        {l.actor || '—'}
                      </TableCell>
                      <TableCell
                        className="max-w-md truncate text-xs text-slate-700 dark:text-slate-300"
                        title={tryPrettyDetail(l.detail)}
                      >
                        <div className="truncate font-medium">{l.summary || '—'}</div>
                        {l.detail && (
                          <div className="truncate text-[10px] text-slate-400 dark:text-slate-500">
                            {tryPrettyDetail(l.detail)}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-shrink-0 items-center justify-between">
          <span className="text-xs text-slate-500">หน้า {page} / {totalPages} ({total.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} รายการ)</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" /> ก่อนหน้า
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              ถัดไป <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Custom Export Dialog — Task ID: FIX-1-2-EXPORT-PRINT */}
      <CustomExportDialog
        open={customExportOpen}
        onOpenChange={setCustomExportOpen}
        availableColumns={AUDIT_EXPORT_COLUMNS}
        onExport={handleCustomExport}
        storageKey="itam-audit-export-cols"
        totalRows={total}
      />
    </div>
  )
}
