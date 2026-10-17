'use client'

/**
 * StockCountSection — UI for stock take (Phase 5.2) + asset verification (Phase 5.3).
 *
 * Lives under the Settings page's "นับสต็อก/ตรวจนับ" tab. Both flows share
 * the StockCountSession/StockCountItem tables; the only difference is the
 * `scope` (STOCK_ITEM vs DEVICE). This component accepts a `scope` prop so
 * the Settings page can mount two instances under one tab (with a Segmented
 * toggle) — both write to the same DB tables but through different API routes
 * (/api/stock-count/* for STOCK_ITEM, /api/asset-verification/* for DEVICE).
 *
 * Features:
 *   • List sessions (OPEN / CLOSED / CANCELLED), newest first
 *   • "เริ่มรอบนับ" button → dialog (name, site, note)
 *   • Open session row → expandable detail with expected vs counted
 *   • For STOCK_ITEM: enter counted qty per item + scan-in by productCode
 *   • For DEVICE: scan QR / enter assetCode → mark COUNTED
 *   • "ปิดรอบ" button → confirms, calls PUT action=close, shows summary
 *     (totalCount, countedCount, notFoundCount, wrongLocationCount,
 *     varianceValue / missingValue)
 */

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Plus, Loader2, ClipboardList, CheckCircle2, XCircle, AlertTriangle, ScanLine, X,
} from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'
import { useLang } from '@/store/i18n-store'

export type StockCountScope = 'STOCK_ITEM' | 'DEVICE'

interface StockCountItemRow {
  id: string
  sessionId: string
  targetId: string
  targetCode: string | null
  expectedQty: number | null
  expectedLocation: string | null
  countedQty: number | null
  countedLocation: string | null
  countedBy: string | null
  countedAt: string | null
  variance: number | null
  status: string
  note: string | null
  target: {
    id: string
    productCode?: string
    productName?: string
    quantity?: number
    unitCost?: { toNumber?: () => number } | number | null
    location?: string | null
    site?: string | null
    assetCode?: string
    name?: string
    type?: string
    brand?: string
    model?: string
    building?: string | null
    floor?: string | null
    room?: string | null
  } | null
}

interface StockCountSessionRow {
  id: string
  name: string
  scope: string
  siteCode: string | null
  status: string
  startedAt: string
  closedAt: string | null
  createdBy: string | null
  note: string | null
  items?: StockCountItemRow[]
  _count?: { items: number }
}

interface StockCountSectionProps {
  scope: StockCountScope
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const t = useAuthStore.getState()?.token
  if (t) h['Authorization'] = `Bearer ${t}`
  return h
}

function fmtDateTime(iso: string | null, lang: 'th' | 'en' = 'th'): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

function statusBadge(status: string) {
  switch (status) {
    case 'OPEN':
      return <Badge className="bg-[#fff7ed] text-[#9a3412] border-[#fdba74] text-[10px]">เปิดอยู่</Badge>
    case 'CLOSED':
      return <Badge variant="secondary" className="text-[10px]">ปิดแล้ว</Badge>
    case 'CANCELLED':
      return <Badge variant="outline" className="text-[10px]">ยกเลิก</Badge>
    default:
      return <Badge variant="outline" className="text-[10px]">{status}</Badge>
  }
}

function itemStatusBadge(status: string) {
  switch (status) {
    case 'COUNTED':
      return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-[10px]">นับแล้ว</Badge>
    case 'NOT_FOUND':
      return <Badge className="bg-rose-100 text-rose-700 border-rose-300 text-[10px]">ไม่พบ</Badge>
    case 'WRONG_LOCATION':
      return <Badge className="bg-amber-100 text-amber-700 border-amber-300 text-[10px]">ผิดตำแหน่ง</Badge>
    default:
      return <Badge variant="outline" className="text-[10px]">รอนับ</Badge>
  }
}

export function StockCountSection({ scope }: StockCountSectionProps) {
  const qc = useQueryClient()
  const { lang } = useLang()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createForm, setCreateForm] = React.useState({ name: '', siteCode: '', note: '' })
  const [openSessionId, setOpenSessionId] = React.useState<string | null>(null)
  const [summaryOpen, setSummaryOpen] = React.useState<null | {
    totalCount: number
    countedCount: number
    notFoundCount: number
    wrongLocationCount: number
    varianceValue?: number
    missingValue?: number
    sessionName: string
  }>(null)
  const [scanInput, setScanInput] = React.useState('')
  const [countedQtyInput, setCountedQtyInput] = React.useState('')

  const isDevice = scope === 'DEVICE'
  const baseApi = isDevice ? '/api/asset-verification' : '/api/stock-count'

  const { data: listData, isLoading } = useQuery({
    queryKey: ['stock-count-sessions', scope],
    queryFn: async () => {
      const res = await fetch(`${baseApi}?scope=${scope}`, { headers: authHeaders() })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
      return res.json() as Promise<{ data: StockCountSessionRow[] }>
    },
  })

  const { data: sessionData, isLoading: sessionLoading } = useQuery({
    queryKey: ['stock-count-session', openSessionId],
    queryFn: async () => {
      if (!openSessionId) return null
      const res = await fetch(`${baseApi}/${openSessionId}`, { headers: authHeaders() })
      if (!res.ok) throw new Error('Failed to fetch session')
      return res.json() as Promise<{ data: StockCountSessionRow }>
    },
    enabled: !!openSessionId,
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: createForm.name.trim(),
        siteCode: createForm.siteCode.trim() || null,
        note: createForm.note.trim() || null,
      }
      const res = await fetch(baseApi, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
      return res.json() as Promise<{ data: StockCountSessionRow }>
    },
    onSuccess: (data) => {
      toast.success('สร้างรอบนับแล้ว')
      setCreateOpen(false)
      setCreateForm({ name: '', siteCode: '', note: '' })
      qc.invalidateQueries({ queryKey: ['stock-count-sessions', scope] })
      setOpenSessionId(data.data.id)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const scanMutation = useMutation({
    mutationFn: async () => {
      if (!openSessionId) return
      const code = scanInput.trim()
      if (!code) return
      const body: Record<string, unknown> = isDevice
        ? { scanCode: code }
        : { scanCode: code, countedQty: countedQtyInput ? Number(countedQtyInput) : null }
      const res = await fetch(`${baseApi}/${openSessionId}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to scan')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success(isDevice ? 'บันทึกการตรวจพบอุปกรณ์แล้ว' : 'บันทึกการนับแล้ว')
      setScanInput('')
      setCountedQtyInput('')
      qc.invalidateQueries({ queryKey: ['stock-count-session', openSessionId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const closeMutation = useMutation({
    mutationFn: async () => {
      if (!openSessionId) return null
      const res = await fetch(`${baseApi}/${openSessionId}`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'close' }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to close')
      }
      return res.json() as Promise<{ summary: { totalCount: number; countedCount: number; notFoundCount: number; wrongLocationCount: number; varianceValue?: number; missingValue?: number } }>
    },
    onSuccess: (data) => {
      if (!data) return
      const session = sessionData?.data
      setSummaryOpen({
        ...data.summary,
        sessionName: session?.name ?? '',
      })
      qc.invalidateQueries({ queryKey: ['stock-count-sessions', scope] })
      qc.invalidateQueries({ queryKey: ['stock-count-session', openSessionId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const sessions = listData?.data ?? []
  const session = sessionData?.data
  const items = session?.items ?? []

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ClipboardList className="h-4 w-4 text-[#f97316]" />
          {isDevice ? 'รอบตรวจนับอุปกรณ์' : 'รอบนับสต็อก'} ({sessions.length})
        </CardTitle>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="bg-[#f97316] text-white hover:bg-[#ea580c]">
          <Plus className="mr-1 h-3.5 w-3.5" /> เริ่มรอบ{isDevice ? 'ตรวจนับ' : 'นับ'}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-[#f97316]" /></div>
        ) : sessions.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            ยังไม่มีรอบ{isDevice ? 'ตรวจนับอุปกรณ์' : 'นับสต็อก'} — กด "เริ่มรอบ{isDevice ? 'ตรวจนับ' : 'นับ'}" เพื่อสร้าง
          </p>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div key={s.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{s.name}</span>
                      {statusBadge(s.status)}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {s.siteCode ? `สาขา: ${s.siteCode} · ` : ''}
                      {s._count?.items ?? 0} รายการ · เริ่ม {fmtDateTime(s.startedAt, lang)}
                      {s.closedAt ? ` · ปิด ${fmtDateTime(s.closedAt, lang)}` : ''}
                      {s.createdBy ? ` · โดย ${s.createdBy}` : ''}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setOpenSessionId(s.id)}
                    className="h-7 text-xs"
                  >
                    เปิด
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Session detail dialog ── */}
        <Dialog open={!!openSessionId} onOpenChange={(o) => !o && setOpenSessionId(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-4 w-4 text-[#f97316]" />
                {session?.name ?? '...'}
                {session && statusBadge(session.status)}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {isDevice
                  ? 'สแกน QR หรือกรอกรหัสทรัพย์สินเพื่อบันทึกการตรวจพบอุปกรณ์'
                  : 'สแกนบาร์โค้ด หรือกรอกรหัสสินค้า + จำนวนที่นับได้'}
              </DialogDescription>
            </DialogHeader>

            {sessionLoading || !session ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#f97316]" /></div>
            ) : (
              <>
                {/* Scan input row */}
                {session.status === 'OPEN' && (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex-1 min-w-[180px] space-y-1">
                        <Label className="text-[10px]">
                          {isDevice ? 'สแกน / รหัสทรัพย์สิน' : 'สแกน / รหัสสินค้า'}
                        </Label>
                        <div className="flex gap-1">
                          <ScanLine className="mt-2 h-4 w-4 shrink-0 text-[#f97316]" />
                          <Input
                            value={scanInput}
                            onChange={(e) => setScanInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && scanInput.trim()) scanMutation.mutate()
                            }}
                            placeholder={isDevice ? 'เช่น IT-PRN-00231' : 'เช่น STK-0001'}
                            className="h-8 text-sm font-mono"
                            autoFocus
                          />
                        </div>
                      </div>
                      {!isDevice && (
                        <div className="w-24 space-y-1">
                          <Label className="text-[10px]">จำนวนที่นับ</Label>
                          <Input
                            type="number"
                            value={countedQtyInput}
                            onChange={(e) => setCountedQtyInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && scanInput.trim()) scanMutation.mutate()
                            }}
                            className="h-8 text-sm"
                            placeholder="0"
                          />
                        </div>
                      )}
                      <Button
                        size="sm"
                        onClick={() => scanMutation.mutate()}
                        disabled={scanMutation.isPending || !scanInput.trim()}
                        className="bg-[#f97316] text-white hover:bg-[#ea580c] h-8"
                      >
                        {scanMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'บันทึก'}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Items list */}
                <div className="mt-2 flex-1 overflow-auto max-h-[55vh]">
                  {items.length === 0 ? (
                    <p className="py-8 text-center text-xs text-muted-foreground">
                      ยังไม่มีรายการในรอบนี้ — {isDevice ? 'สแกนอุปกรณ์เพื่อเพิ่ม' : 'สแกนสินค้าเพื่อเพิ่ม'}
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">รหัส</TableHead>
                          <TableHead className="text-xs">ชื่อ</TableHead>
                          {isDevice ? (
                            <>
                              <TableHead className="text-xs">ตำแหน่งที่ควร</TableHead>
                              <TableHead className="text-xs">ตำแหน่งที่พบ</TableHead>
                            </>
                          ) : (
                            <>
                              <TableHead className="text-xs text-right">คาดการณ์</TableHead>
                              <TableHead className="text-xs text-right">นับได้</TableHead>
                              <TableHead className="text-xs text-right">ต่าง</TableHead>
                            </>
                          )}
                          <TableHead className="text-xs">สถานะ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((it) => (
                          <TableRow key={it.id}>
                            <TableCell className="font-mono text-[11px]">{it.targetCode ?? it.targetId}</TableCell>
                            <TableCell className="text-xs">
                              {it.target?.productName ?? it.target?.name ?? '-'}
                            </TableCell>
                            {isDevice ? (
                              <>
                                <TableCell className="text-xs">{it.expectedLocation ?? '-'}</TableCell>
                                <TableCell className="text-xs">{it.countedLocation ?? '-'}</TableCell>
                              </>
                            ) : (
                              <>
                                <TableCell className="text-right text-xs">{it.expectedQty ?? '-'}</TableCell>
                                <TableCell className="text-right text-xs">{it.countedQty ?? '-'}</TableCell>
                                <TableCell className="text-right text-xs">
                                  {it.variance != null ? (
                                    <span className={it.variance === 0 ? 'text-emerald-600' : it.variance > 0 ? 'text-blue-600' : 'text-rose-600'}>
                                      {it.variance > 0 ? '+' : ''}{it.variance}
                                    </span>
                                  ) : '-'}
                                </TableCell>
                              </>
                            )}
                            <TableCell>{itemStatusBadge(it.status)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>

                {/* Footer with close button */}
                <DialogFooter className="border-t pt-3">
                  <Button variant="outline" onClick={() => setOpenSessionId(null)}>
                    <X className="mr-1 h-3.5 w-3.5" /> ปิดหน้าต่าง
                  </Button>
                  {session.status === 'OPEN' && (
                    <Button
                      onClick={() => closeMutation.mutate()}
                      disabled={closeMutation.isPending}
                      className="bg-[#f97316] text-white hover:bg-[#ea580c]"
                    >
                      {closeMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                      ปิดรอบ
                    </Button>
                  )}
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* ── Create session dialog ── */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>เริ่มรอบ{isDevice ? 'ตรวจนับอุปกรณ์' : 'นับสต็อก'}</DialogTitle>
              <DialogDescription className="text-xs">
                {isDevice
                  ? 'เริ่มรอบเพื่อสแกนทีละเครื่อง — ระบบจะเก็บสถานะตำแหน่งที่พบและเปรียบเทียบกับตำแหน่งที่ควรจะเป็น'
                  : 'เริ่มรอบเพื่อนับสต็อกทีละรายการ — ระบบจะคำนวณผลต่างและมูลค่าผิดปกติเมื่อปิดรอบ'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">ชื่อรอบ *</Label>
                <Input
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder={isDevice ? 'เช่น ตรวจนับไตรมาส 4/2026' : 'เช่น นับสต็อกประจำเดือน พ.ย. 2026'}
                  className="text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">สาขา (เว้นว่าง = ทุกสาขา)</Label>
                <Input
                  value={createForm.siteCode}
                  onChange={(e) => setCreateForm({ ...createForm, siteCode: e.target.value.toUpperCase() })}
                  placeholder="เช่น UDH"
                  className="text-sm font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">หมายเหตุ (ไม่บังคับ)</Label>
                <Input
                  value={createForm.note}
                  onChange={(e) => setCreateForm({ ...createForm, note: e.target.value })}
                  placeholder="เช่น นับก่อนสิ้นปีงบประมาณ"
                  className="text-sm"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>ยกเลิก</Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !createForm.name.trim()}
                className="bg-[#f97316] text-white hover:bg-[#ea580c]"
              >
                {createMutation.isPending ? 'กำลังสร้าง...' : 'สร้างรอบ'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Close summary dialog ── */}
        <Dialog open={!!summaryOpen} onOpenChange={(o) => !o && setSummaryOpen(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ปิดรอบ{isDevice ? 'ตรวจนับ' : 'นับ'}เรียบร้อย
              </DialogTitle>
              <DialogDescription className="text-xs">
                {summaryOpen?.sessionName}
              </DialogDescription>
            </DialogHeader>
            {summaryOpen && (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border p-3">
                  <div className="text-[10px] text-muted-foreground">รายการทั้งหมด</div>
                  <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{summaryOpen.totalCount}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-[10px] text-muted-foreground">นับแล้ว</div>
                  <div className="text-lg font-bold text-emerald-600">{summaryOpen.countedCount}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-[10px] text-muted-foreground">ไม่พบ</div>
                  <div className="text-lg font-bold text-rose-600">{summaryOpen.notFoundCount}</div>
                </div>
                {isDevice ? (
                  <div className="rounded-md border p-3">
                    <div className="text-[10px] text-muted-foreground">ผิดตำแหน่ง</div>
                    <div className="text-lg font-bold text-amber-600">{summaryOpen.wrongLocationCount}</div>
                  </div>
                ) : (
                  <div className="rounded-md border p-3">
                    <div className="text-[10px] text-muted-foreground">ผิดตำแหน่ง</div>
                    <div className="text-lg font-bold text-amber-600">{summaryOpen.wrongLocationCount}</div>
                  </div>
                )}
                {isDevice ? (
                  <div className="col-span-2 rounded-md border bg-rose-50 p-3 dark:bg-rose-950/30">
                    <div className="text-[10px] text-muted-foreground">มูลค่าอุปกรณ์ที่ไม่พบ (Book Value)</div>
                    <div className="text-lg font-bold text-rose-700 dark:text-rose-300">
                      ฿{(summaryOpen.missingValue ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                ) : (
                  <div className="col-span-2 rounded-md border bg-amber-50 p-3 dark:bg-amber-950/30">
                    <div className="text-[10px] text-muted-foreground">มูลค่าผิดปกติรวม (|ต่าง| × ทุน)</div>
                    <div className="text-lg font-bold text-amber-700 dark:text-amber-300">
                      ฿{(summaryOpen.varianceValue ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => setSummaryOpen(null)} className="bg-[#f97316] text-white hover:bg-[#ea580c]">
                ตกลง
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
