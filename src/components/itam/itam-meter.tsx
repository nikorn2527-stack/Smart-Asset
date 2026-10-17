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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Gauge, RefreshCw, ChevronLeft, ChevronRight, ClipboardList, Loader2, AlertTriangle } from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'
import { type Site, canSelectSite } from './types'
import { useLang } from '@/store/i18n-store'
import { bearerHeaders } from '@/lib/http-headers'

interface Reading {
  id: string; assetCode: string; readingDate: string | null; readingMonth: string | null
  meterBw: number; meterColor: number; pagesBw: number; pagesColor: number
  prevMeterBw: number; remark: string | null; readBy: string | null
  readingType?: string | null
  device?: { assetCode: string; brand: string | null; model: string | null; site: string | null }
}
interface ReadingsResponse {
  readings: Reading[]; pagination: { page: number; limit: number; total: number; totalPages: number }
}
interface Device {
  id: string; assetCode: string; type: string | null; brand: string | null; model: string | null
  site: string | null; meterRequired: boolean; status: string
}
interface DevicesResponse {
  devices: Device[]; pagination: { page: number; limit: number; total: number; totalPages: number }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

// Reading type → Thai label + badge class
const READING_TYPE_LABELS: Record<string, string> = {
  MONTHLY: 'ประจำเดือน',
  INITIAL: 'เริ่มต้น',
  FINAL: 'สิ้นสุด',
  RESET: 'RESET',
  CHECKOUT: 'เช็คเอาท์',
  SEND_REPAIR: 'ส่งซ่อม',
  RETURN: 'คืนเครื่อง',
  // TRANSFER closes the meter at the location being left; TRANSFER_IN opens it
  // at the destination with the same number (pages = 0), so both branches show
  // the device without double-counting.
  TRANSFER: 'ปิดงวด (ย้ายออก)',
  TRANSFER_IN: 'เปิดงวด (ย้ายเข้า)',
}
const READING_TYPE_BADGES: Record<string, string> = {
  MONTHLY: 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  INITIAL: 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300',
  FINAL: 'border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300',
  RESET: 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
  CHECKOUT: 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300',
  SEND_REPAIR: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300',
  RETURN: 'border-teal-300 bg-teal-100 text-teal-800 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300',
  TRANSFER: 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
  TRANSFER_IN: 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
}

function readingTypeBadge(type: string | null | undefined): { label: string; cls: string } {
  if (!type) return { label: '—', cls: 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400' }
  const upper = type.toUpperCase()
  return {
    label: READING_TYPE_LABELS[upper] ?? type,
    cls: READING_TYPE_BADGES[upper] ?? 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400',
  }
}

export function ItamMeter() {
  const { lang } = useLang()
  const qc = useQueryClient()
  const [page, setPage] = React.useState(1)
  const [limit] = React.useState(20)
  const [siteFilter, setSiteFilter] = React.useState<string>('all')
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [assetCode, setAssetCode] = React.useState('')
  const [meterBw, setMeterBw] = React.useState('')
  const [remark, setRemark] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  // Bulk entry dialog
  const [bulkOpen, setBulkOpen] = React.useState(false)

  // ── Site filter visibility ──
  const authUser = useAuthStore((s) => s.user)
  const showSiteFilter = authUser ? canSelectSite(authUser) : false

  // ── Sites list (for site filter dropdown) ──
  const getAuthHeaders = React.useCallback((extra?: Record<string, string>) => {
    const token = useAuthStore.getState()?.token
    return { ...(extra ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  }, [])
  const { data: sitesData } = useQuery<Site[]>({
    queryKey: ['meter-sites'],
    queryFn: async () => {
      const res = await fetch('/api/sites', { headers: getAuthHeaders() })
      if (!res.ok) return []
      const json = (await res.json()) as { sites?: Site[] } | Site[]
      return Array.isArray(json) ? json : (json.sites ?? [])
    },
    staleTime: 60_000,
  })
  const sites = sitesData ?? []

  const { data, isLoading } = useQuery<ReadingsResponse>({
    queryKey: ['itam-readings', page, limit, siteFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (siteFilter !== 'all') params.set('site', siteFilter)
      const res = await fetch(`/api/itam/meter-readings?${params.toString()}`, {
        headers: getAuthHeaders(),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  async function saveReading() {
    if (!assetCode || !meterBw) { toast.error('กรุณากรอกรหัสอุปกรณ์และค่ามิเตอร์'); return }
    try {
      setSaving(true)
      const res = await fetch('/api/itam/meter-readings', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ assetCode, meterBw: Number(meterBw), remark: remark || null }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
      toast.success('บันทึกมิเตอร์แล้ว')
      setDialogOpen(false); setAssetCode(''); setMeterBw(''); setRemark('')
      await qc.invalidateQueries({ queryKey: ['itam-readings'] })
      await qc.invalidateQueries({ queryKey: ['itam-dashboard'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally { setSaving(false) }
  }

  const readings = data?.readings ?? []
  const total = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 0

  return (
    <div className="flex h-full w-full flex-col gap-3 p-3 md:p-4">
      <div className="flex flex-shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">จดมิเตอร์ (Real DB)</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{total.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} รายการ</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {showSiteFilter && (
            <Select value={siteFilter} onValueChange={(v) => { setSiteFilter(v); setPage(1) }}>
              <SelectTrigger className="h-9 w-[140px] text-xs" aria-label="กรองสาขา">
                <SelectValue placeholder="สาขา" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุกสาขา</SelectItem>
                {sites.map((s) => (
                  <SelectItem key={s.id} value={s.code}>
                    {s.code} {s.name ? `— ${s.name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ['itam-readings'] })} className="dark:bg-slate-800 dark:border-slate-700">
            <RefreshCw className="h-4 w-4" /> รีเฟรช
          </Button>
          <Button variant="outline" onClick={() => setBulkOpen(true)} className="dark:bg-slate-800 dark:border-slate-700">
            <ClipboardList className="h-4 w-4" /> จดหลายเครื่อง
          </Button>
          <Button className="bg-[#f97316] text-white hover:bg-[#ea580c]" onClick={() => setDialogOpen(true)}>
            <Gauge className="h-4 w-4" /> จดมิเตอร์
          </Button>
        </div>
      </div>

      <Card className="flex min-h-0 flex-1 flex-col border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="min-h-0 flex-1 p-0">
          <div className="itam-scroll h-full overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                <TableRow>
                  <TableHead>วันที่</TableHead>
                  <TableHead>รหัส</TableHead>
                  <TableHead>อุปกรณ์</TableHead>
                  <TableHead className="text-right">ก่อนหน้า</TableHead>
                  <TableHead className="text-right">ค่ามิเตอร์</TableHead>
                  <TableHead className="text-right">ส่วนต่าง</TableHead>
                  <TableHead className="text-right">ใช้ไป</TableHead>
                  <TableHead>ประเภท</TableHead>
                  <TableHead>หมายเหตุ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  // Skeleton rows matching column widths
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    </TableRow>
                  ))
                ) : readings.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="py-12 text-center text-slate-400 text-sm">ยังไม่มีข้อมูล</TableCell></TableRow>
                ) : (
                  readings.map((r) => {
                    const delta = (r.meterBw ?? 0) - (r.prevMeterBw ?? 0)
                    const rt = readingTypeBadge(r.readingType)
                    return (
                    <TableRow key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <TableCell className="text-xs text-slate-500">{r.readingDate?.substring(0, 16) || '—'}</TableCell>
                      <TableCell className="font-mono text-xs font-medium">{r.assetCode}</TableCell>
                      <TableCell className="text-xs">{r.device ? `${r.device.brand || ''} ${r.device.model || ''}` : '—'}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                        {(r.prevMeterBw ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{(r.meterBw ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant="outline"
                          className={
                            'tabular-nums ' +
                            (delta < 0
                              ? 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : delta > 0
                                ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                                : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400')
                          }
                          title={`${(r.prevMeterBw ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} → ${(r.meterBw ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} = ${delta >= 0 ? '+' : ''}${(delta ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}`}
                        >
                          {delta >= 0 ? '+' : ''}{(delta ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          {((r.pagesBw ?? 0) + (r.pagesColor ?? 0)).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={rt.cls}>
                          {rt.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-400">{r.remark || '—'}</TableCell>
                    </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {isLoading ? (
            <Skeleton className="h-4 w-32" />
          ) : (
            <span className="text-xs text-slate-500">หน้า {page} / {totalPages}</span>
          )}
          <div className="flex gap-2">
            {isLoading ? (
              <>
                <Skeleton className="h-8 w-9" />
                <Skeleton className="h-8 w-9" />
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Dialog: จดมิเตอร์ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader><DialogTitle>📈 จดมิเตอร์</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">รหัสอุปกรณ์ *</Label>
              <Input value={assetCode} onChange={(e) => setAssetCode(e.target.value)} placeholder="เช่น 100" className="dark:bg-slate-800 dark:border-slate-700" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">ค่ามิเตอร์ (ขาวดำ) *</Label>
              <Input type="number" value={meterBw} onChange={(e) => setMeterBw(e.target.value)} placeholder="เช่น 5000" className="dark:bg-slate-800 dark:border-slate-700" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">หมายเหตุ</Label>
              <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} rows={2} className="dark:bg-slate-800 dark:border-slate-700" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>ยกเลิก</Button>
            <Button onClick={saveReading} disabled={saving} className="bg-[#f97316] text-white hover:bg-[#ea580c]">
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Meter Dialog */}
      <BulkMeterDialog open={bulkOpen} onOpenChange={setBulkOpen} />
    </div>
  )
}

// ============== Bulk Meter Dialog (inline) ==============

function BulkMeterDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { lang } = useLang()
  const qc = useQueryClient()
  const [readingDate, setReadingDate] = React.useState<string>(todayISO())
  const [rows, setRows] = React.useState<Record<string, { newReading: string; remark: string; prev: number; name: string }>>({})
  const [saving, setSaving] = React.useState(false)

  // Fetch meter-required devices
  const { data: devicesData, isLoading: devicesLoading } = useQuery<DevicesResponse>({
    queryKey: ['itam-devices-bulk', 'meter-required'],
    queryFn: async () => {
      const token = useAuthStore.getState()?.token
      const res = await fetch('/api/itam/devices?limit=100', {
        headers: bearerHeaders(token),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: open,
  })

  // Fetch last reading per device
  const eligibleDevices = React.useMemo(
    () => (devicesData?.devices ?? []).filter(d => d.meterRequired),
    [devicesData],
  )

  // For each eligible device, fetch its most recent reading to get the "last value"
  const lastReadingsMap = React.useRef<Record<string, number>>({})
  const [lastReadingsLoaded, setLastReadingsLoaded] = React.useState(false)

  React.useEffect(() => {
    if (!open || eligibleDevices.length === 0) {
      setLastReadingsLoaded(false)
      return
    }
    let cancelled = false
    setLastReadingsLoaded(false)
    Promise.all(
      eligibleDevices.map(d =>
        fetch(`/api/itam/meter-readings?assetCode=${encodeURIComponent(d.assetCode)}&limit=1`, {
          headers: bearerHeaders(useAuthStore.getState()?.token),
        })
          .then(r => r.ok ? r.json() : null)
          .then(j => {
            const r = j?.readings?.[0]
            lastReadingsMap.current[d.assetCode] = r ? r.meterBw : 0
          })
          .catch(() => { lastReadingsMap.current[d.assetCode] = 0 }),
      ),
    ).then(() => {
      if (cancelled) return
      const init: Record<string, { newReading: string; remark: string; prev: number; name: string }> = {}
      for (const d of eligibleDevices) {
        const prev = lastReadingsMap.current[d.assetCode] ?? 0
        init[d.assetCode] = {
          newReading: String(prev),
          remark: '',
          prev,
          name: `${d.brand || ''} ${d.model || ''}`.trim() || d.assetCode,
        }
      }
      setRows(init)
      setLastReadingsLoaded(true)
    })
    return () => { cancelled = true }
  }, [open, eligibleDevices])

  function updateRow(assetCode: string, patch: Partial<{ newReading: string; remark: string }>) {
    setRows(prev => ({ ...prev, [assetCode]: { ...prev[assetCode], ...patch } }))
  }

  const rowMeta = React.useMemo(() => {
    const arr: Array<{ assetCode: string; name: string; prev: number; next: number | null; delta: number; changed: boolean; valid: boolean; isReset: boolean }> = []
    for (const d of eligibleDevices) {
      const r = rows[d.assetCode]
      if (!r) continue
      const trimmed = (r.newReading ?? '').trim()
      const nextNum = trimmed === '' ? null : Number(trimmed)
      const next = nextNum !== null && Number.isFinite(nextNum) ? nextNum : null
      const delta = next !== null ? next - r.prev : 0
      const isReset = next !== null && next < r.prev
      const changed = next !== null && next !== r.prev
      const valid = next !== null && !(isReset && !r.remark.trim())
      arr.push({ assetCode: d.assetCode, name: r.name, prev: r.prev, next, delta, changed, valid, isReset })
    }
    return arr
  }, [eligibleDevices, rows])

  const changedCount = rowMeta.filter(m => m.changed && m.valid).length
  const hasInvalidChange = rowMeta.some(m => m.changed && !m.valid)
  const canSave = changedCount > 0 && !hasInvalidChange && !saving

  async function handleSave() {
    if (!canSave) return
    const toSave = rowMeta.filter(m => m.changed && m.valid)
    setSaving(true)
    try {
      const results = await Promise.allSettled(
        toSave.map(m =>
          fetch('/api/itam/meter-readings', {
            method: 'POST',
            headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              assetCode: m.assetCode,
              meterBw: m.next,
              prevMeterBw: m.prev,
              readingDate,
              remark: rows[m.assetCode]?.remark?.trim() || null,
            }),
          }).then(async res => {
            if (!res.ok) {
              const j = await res.json().catch(() => ({}))
              throw new Error(j.error ?? 'Save failed')
            }
            return res.json()
          }),
        ),
      )
      const succeeded = results.filter(r => r.status === 'fulfilled').length
      const failed = results.length - succeeded
      if (failed === 0) toast.success(`บันทึก ${succeeded} เครื่องสำเร็จ`)
      else if (succeeded === 0) toast.error(`บันทึกล้มเหลวทั้ง ${failed} เครื่อง`)
      else toast.warning(`บันทึก ${succeeded} สำเร็จ, ${failed} ล้มเหลว`)
      onOpenChange(false)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['itam-readings'] }),
        qc.invalidateQueries({ queryKey: ['itam-dashboard'] }),
      ])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Bulk save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden sm:max-w-3xl dark:border-slate-800 dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <ClipboardList className="h-5 w-5 text-[#f97316]" />
            📝 จดมิเตอร์หลายเครื่อง
          </DialogTitle>
        </DialogHeader>
        <div className="itam-scroll flex-1 min-h-0 space-y-3 overflow-y-auto">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Label htmlFor="bulk-reading-date" className="text-xs font-medium text-slate-600 dark:text-slate-300">
                วันที่จด *
              </Label>
              <Input
                id="bulk-reading-date"
                type="date"
                value={readingDate}
                onChange={(e) => setReadingDate(e.target.value)}
                className="w-[160px] dark:bg-slate-800 dark:border-slate-700"
              />
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              ทั้งหมด <span className="font-semibold">{eligibleDevices.length}</span> เครื่อง · เปลี่ยนแปลง{' '}
              <span className="font-semibold text-[#f97316]">{changedCount}</span> เครื่อง
            </div>
          </div>

          <div className="itam-scroll max-h-[55vh] overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm dark:bg-slate-900/95">
                <TableRow>
                  <TableHead className="text-xs">รหัส</TableHead>
                  <TableHead className="text-xs">ชื่ออุปกรณ์</TableHead>
                  <TableHead className="text-right text-xs">ค่าล่าสุด</TableHead>
                  <TableHead className="text-right text-xs">ค่ามิเตอร์ใหม่</TableHead>
                  <TableHead className="text-right text-xs">ส่วนต่าง</TableHead>
                  <TableHead className="text-xs">หมายเหตุ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devicesLoading || !lastReadingsLoaded ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
                      <div className="mt-2 text-xs text-slate-400">กำลังโหลดข้อมูล...</div>
                    </TableCell>
                  </TableRow>
                ) : eligibleDevices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-slate-400">
                      ไม่พบอุปกรณ์ที่ต้องจดมิเตอร์
                    </TableCell>
                  </TableRow>
                ) : (
                  rowMeta.map((m) => {
                    const rowBg = m.changed
                      ? m.isReset
                        ? 'bg-amber-50/60 dark:bg-amber-950/20'
                        : 'bg-emerald-50/40 dark:bg-emerald-950/15'
                      : ''
                    return (
                      <TableRow key={m.assetCode} className={rowBg}>
                        <TableCell className="font-mono text-xs font-medium text-slate-700 dark:text-slate-200">{m.assetCode}</TableCell>
                        <TableCell className="max-w-[180px] truncate text-xs text-slate-700 dark:text-slate-200">{m.name}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs text-slate-600 dark:text-slate-300">{(m.prev ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            inputMode="numeric"
                            value={rows[m.assetCode]?.newReading ?? ''}
                            onChange={(e) => updateRow(m.assetCode, { newReading: e.target.value })}
                            className={
                              'ml-auto w-28 text-right ' +
                              (m.isReset
                                ? 'border-amber-400 focus-visible:ring-amber-200 dark:border-amber-600'
                                : m.changed
                                  ? 'border-emerald-300 focus-visible:ring-emerald-200 dark:border-emerald-700'
                                  : 'dark:bg-slate-800 dark:border-slate-700')
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {!m.changed ? (
                            <span className="text-xs text-slate-300 dark:text-slate-400">—</span>
                          ) : (
                            <Badge
                              className={
                                'tabular-nums ' +
                                (m.delta < 0
                                  ? 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                  : 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300')
                              }
                            >
                              {m.delta > 0 ? '+' : ''}{(m.delta ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {m.isReset ? (
                            <Textarea
                              value={rows[m.assetCode]?.remark ?? ''}
                              onChange={(e) => updateRow(m.assetCode, { remark: e.target.value })}
                              placeholder="เหตุผลที่ค่าลดลง (RESET) *"
                              rows={1}
                              className={
                                'min-h-[36px] text-xs ' +
                                (!rows[m.assetCode]?.remark?.trim()
                                  ? 'border-amber-400 dark:border-amber-600'
                                  : 'dark:bg-slate-800 dark:border-slate-700')
                              }
                            />
                          ) : (
                            <Input
                              value={rows[m.assetCode]?.remark ?? ''}
                              onChange={(e) => updateRow(m.assetCode, { remark: e.target.value })}
                              placeholder="หมายเหตุ (ถ้ามี)"
                              className="h-8 text-xs dark:bg-slate-800 dark:border-slate-700"
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {hasInvalidChange && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>มีเครื่องที่ค่าใหม่น้อยกว่าค่าก่อนหน้า (RESET) แต่ยังไม่ได้ระบุหมายเหตุ — กรุณาระบุหมายเหตุก่อนบันทึก</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>ยกเลิก</Button>
          <Button onClick={handleSave} disabled={!canSave} className="bg-[#f97316] text-white hover:bg-[#ea580c]">
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                กำลังบันทึก...
              </>
            ) : `บันทึก (${changedCount} เครื่อง)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
