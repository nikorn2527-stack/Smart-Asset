'use client'

/**
 * StockPending — รออนุมัติ (Tab 5)
 *
 * - Table: RequestNo (txnNumber), RequestDate (createdAt), Requester,
 *   Department, WorkOrderNo, Items (productCode × qty), Status, Actions
 * - Batch mode: checkbox + "Approve All" / "Reject All" buttons
 * - Single approve/reject buttons per row
 * - Approval mode controls: auto/manual dropdown + delay value input
 *
 * API:
 *   - GET  /api/stock-items/pending?status=PENDING|APPROVED|REJECTED|all
 *   - POST /api/stock-items/pending/batch { items: [{ txnId, action, note?, reason? }] }
 *   - GET  /api/stock-items/pending/settings
 *   - PUT  /api/stock-items/pending/settings
 *   - POST /api/stock-items/[id]/pending/[txnId]/approve
 *   - POST /api/stock-items/[id]/pending/[txnId]/reject
 */

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
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
  Clock,
  Check,
  X,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Settings2,
  Search,
} from 'lucide-react'
import {
  type StockTransaction,
  stockKeys,
  APPROVAL_LABELS,
  APPROVAL_BADGES,
  formatDateTime,
  truncate,
  authFetch,
} from './shared'
import { useLang } from '@/store/i18n-store'

// ── Response types ─────────────────────────────────────────────────────

interface PendingListResponse {
  data: StockTransaction[]
  pagination: { total: number }
}

interface PendingSettingsResponse {
  settings: {
    approvalMode: 'manual' | 'auto'
    autoApproveDelayMinutes: number
    autoApproveBatchLimit: number
  }
}

// ── Component ──────────────────────────────────────────────────────────

export function StockPending() {
  const { lang } = useLang()
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = React.useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'all'>('PENDING')
  const [search, setSearch] = React.useState('')
  const [selected, setSelected] = React.useState<Set<string>>(new Set())

  // Settings dialog
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [settingsForm, setSettingsForm] = React.useState({
    approvalMode: 'manual' as 'manual' | 'auto',
    autoApproveDelayMinutes: '60',
    autoApproveBatchLimit: '100',
  })

  // Reject dialog (single + batch)
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [rejectTarget, setRejectTarget] = React.useState<{ mode: 'single' | 'batch'; txnIds: string[] } | null>(null)
  const [rejectReason, setRejectReason] = React.useState('')

  // ── Queries ──────────────────────────────────────────────────────────

  const queryKey = stockKeys.pending({ status: statusFilter, search: search.trim() })

  const { data, isLoading, isFetching } = useQuery<PendingListResponse>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ status: statusFilter, pageSize: '500' })
      const q = search.trim()
      if (q) params.set('search', q)
      return authFetch<PendingListResponse>(`/api/stock-items/pending?${params.toString()}`)
    },
    staleTime: 15_000,
  })
  const txns = data?.data ?? []

  const { data: settingsData, isLoading: settingsLoading } = useQuery<PendingSettingsResponse>({
    queryKey: stockKeys.pendingSettings,
    queryFn: () => authFetch<PendingSettingsResponse>('/api/stock-items/pending/settings'),
    staleTime: 60_000,
  })

  // Sync settings form when data arrives.
  React.useEffect(() => {
    if (settingsData?.settings) {
      const s = settingsData.settings
      setSettingsForm({
        approvalMode: s.approvalMode,
        autoApproveDelayMinutes: String(s.autoApproveDelayMinutes),
        autoApproveBatchLimit: String(s.autoApproveBatchLimit),
      })
    }
  }, [settingsData])

  // ── Mutations ────────────────────────────────────────────────────────

  const batchMutation = useMutation({
    mutationFn: async (input: { txnIds: string[]; action: 'approve' | 'reject'; reason?: string | null }) => {
      const items = input.txnIds.map((txnId) => ({
        txnId,
        action: input.action,
        reason: input.reason ?? null,
        note: input.reason ?? null,
      }))
      return authFetch('/api/stock-items/pending/batch', {
        method: 'POST',
        body: JSON.stringify({ items }),
      })
    },
    onSuccess: (_json, vars) => {
      const verb = vars.action === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ'
      toast.success(`${verb} ${vars.txnIds.length} รายการเรียบร้อย`)
      qc.invalidateQueries({ queryKey: ['stock-items'] })
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      setSelected(new Set())
      setRejectOpen(false)
      setRejectTarget(null)
      setRejectReason('')
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    },
  })

  const saveSettingsMutation = useMutation({
    mutationFn: async (input: typeof settingsForm) =>
      authFetch('/api/stock-items/pending/settings', {
        method: 'PUT',
        body: JSON.stringify({
          approvalMode: input.approvalMode,
          autoApproveDelayMinutes: Number(input.autoApproveDelayMinutes),
          autoApproveBatchLimit: Number(input.autoApproveBatchLimit),
        }),
      }),
    onSuccess: () => {
      toast.success('บันทึกการตั้งค่าการอนุมัติแล้ว')
      qc.invalidateQueries({ queryKey: stockKeys.pendingSettings })
      setSettingsOpen(false)
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    },
  })

  // ── Handlers ─────────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      if (prev.size === txns.length) return new Set()
      return new Set(txns.map((t) => t.id))
    })
  }

  function approveOne(txn: StockTransaction) {
    batchMutation.mutate({ txnIds: [txn.id], action: 'approve' })
  }

  function openRejectSingle(txn: StockTransaction) {
    setRejectTarget({ mode: 'single', txnIds: [txn.id] })
    setRejectReason('')
    setRejectOpen(true)
  }

  function openRejectBatch() {
    if (selected.size === 0) {
      toast.error('กรุณาเลือกอย่างน้อย 1 รายการ')
      return
    }
    setRejectTarget({ mode: 'batch', txnIds: Array.from(selected) })
    setRejectReason('')
    setRejectOpen(true)
  }

  function approveBatch() {
    if (selected.size === 0) {
      toast.error('กรุณาเลือกอย่างน้อย 1 รายการ')
      return
    }
    batchMutation.mutate({ txnIds: Array.from(selected), action: 'approve' })
  }

  function submitReject() {
    if (!rejectTarget) return
    if (!rejectReason.trim()) {
      toast.error('กรุณาระบุเหตุผลในการปฏิเสธ')
      return
    }
    batchMutation.mutate({
      txnIds: rejectTarget.txnIds,
      action: 'reject',
      reason: rejectReason.trim(),
    })
  }

  // ── Render ───────────────────────────────────────────────────────────

  const pendingCount = txns.filter((t) => t.approvalStatus === 'PENDING').length
  const allSelected = txns.length > 0 && selected.size === txns.length

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header + actions */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-6 w-6 text-[#f97316]" />
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">รออนุมัติ</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              คำขอเบิกออกที่รอการอนุมัติ — มี {pendingCount} รายการรอดำเนินการ
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => qc.invalidateQueries({ queryKey: ['stock-items'] })}
            className="dark:bg-slate-800 dark:border-slate-700"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            รีเฟรช
          </Button>
          <Button
            variant="outline"
            onClick={() => setSettingsOpen(true)}
            className="dark:bg-slate-800 dark:border-slate-700"
          >
            <Settings2 className="h-4 w-4" /> ตั้งค่า
          </Button>
        </div>
      </div>

      {/* Settings summary card */}
      {settingsData?.settings && (
        <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">โหมดอนุมัติ:</span>
              <Badge className={
                settingsData.settings.approvalMode === 'auto'
                  ? 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800'
                  : 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800'
              }>
                {settingsData.settings.approvalMode === 'auto' ? 'อัตโนมัติ' : 'ด้วยมือ'}
              </Badge>
            </div>
            {settingsData.settings.approvalMode === 'auto' && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">หน่วงเวลา:</span>
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                    {settingsData.settings.autoApproveDelayMinutes} นาที
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">ขนาด batch สูงสุด:</span>
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                    {settingsData.settings.autoApproveBatchLimit}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Filter bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-full sm:w-44 dark:bg-slate-800 dark:border-slate-700">
            <SelectValue placeholder="สถานะ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING">รออนุมัติ</SelectItem>
            <SelectItem value="APPROVED">อนุมัติแล้ว</SelectItem>
            <SelectItem value="REJECTED">ปฏิเสธ</SelectItem>
            <SelectItem value="all">ทั้งหมด</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="ค้นหาเลขที่ / รหัสสินค้า / ชื่อ / ใบสั่งซ่อม..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 dark:bg-slate-800 dark:border-slate-700"
          />
        </div>
      </div>

      {/* Batch action bar (appears when items are selected) */}
      {selected.size > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-[#f97316]/30 bg-[#f97316]/5 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-700 dark:text-slate-200">
            เลือกแล้ว <span className="font-bold text-[#f97316]">{selected.size}</span> รายการ
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={approveBatch}
              disabled={batchMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Check className="h-4 w-4" /> อนุมัติทั้งหมด
            </Button>
            <Button
              size="sm"
              onClick={openRejectBatch}
              disabled={batchMutation.isPending}
              variant="outline"
              className="border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950"
            >
              <X className="h-4 w-4" /> ปฏิเสธทั้งหมด
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
              className="dark:text-slate-300"
            >
              ยกเลิกเลือก
            </Button>
          </div>
        </div>
      )}

      {/* Pending table — fills remaining height (Issue 3) */}
      <Card className="flex min-h-0 flex-1 flex-col border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="min-h-0 flex-1 p-0">
          <div className="itam-scroll max-h-[calc(100vh-20rem)] min-h-[300px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="เลือกทั้งหมด"
                    />
                  </TableHead>
                  <TableHead className="w-36">เลขที่คำขอ</TableHead>
                  <TableHead className="w-32">วันที่ขอ</TableHead>
                  <TableHead className="w-28">ผู้ขอเบิก</TableHead>
                  <TableHead className="w-28">แผนก</TableHead>
                  <TableHead className="w-32">ใบสั่งซ่อม</TableHead>
                  <TableHead className="min-w-[200px]">รายการสินค้า</TableHead>
                  <TableHead className="w-24">สถานะ</TableHead>
                  <TableHead className="w-32 text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell colSpan={9}><Skeleton className="h-7 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : txns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-14">
                      <div className="flex flex-col items-center gap-3 text-slate-400 dark:text-slate-500">
                        <Clock className="h-12 w-12 opacity-30" />
                        <div className="text-sm font-medium">
                          {statusFilter === 'PENDING' ? 'ไม่มีรายการรออนุมัติ' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  txns.map((t) => {
                    const isChecked = selected.has(t.id)
                    const isPending = t.approvalStatus === 'PENDING'
                    const outOfStock =
                      isPending &&
                      t.stockItem &&
                      t.quantity > t.stockItem.quantity
                    return (
                      <TableRow key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <TableCell>
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => toggleSelect(t.id)}
                            disabled={!isPending}
                            aria-label={`เลือก ${t.txnNumber ?? t.id}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                          {t.txnNumber ?? '—'}
                        </TableCell>
                        <TableCell className="text-[11px] text-slate-600 dark:text-slate-300">
                          {formatDateTime(t.createdAt)}
                        </TableCell>
                        <TableCell className="text-xs text-slate-700 dark:text-slate-200">
                          {truncate(t.requester ?? t.performedBy ?? '—', 20)}
                        </TableCell>
                        <TableCell className="text-xs text-slate-700 dark:text-slate-200">
                          {truncate(t.department ?? '—', 16)}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-slate-700 dark:text-slate-200">
                          {t.workOrderNo ?? '—'}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                              {t.productCode ?? t.stockItem?.productCode ?? '—'}
                            </span>
                            <span className="text-slate-400">×</span>
                            <span className="font-mono text-[11px] text-slate-700 dark:text-slate-200">
                              {t.quantity}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {t.unit ?? t.stockItem?.unit ?? ''}
                            </span>
                          </div>
                          <div className="truncate text-[10px] text-slate-500" title={t.productName ?? t.stockItem?.productName ?? ''}>
                            {truncate(t.productName ?? t.stockItem?.productName ?? '', 40)}
                          </div>
                          {t.purpose && (
                            <div className="text-[10px] text-slate-400" title={t.purpose}>
                              {truncate(t.purpose, 30)}
                            </div>
                          )}
                          {outOfStock && (
                            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-rose-500">
                              <AlertTriangle className="h-3 w-3" /> สต็อกไม่พอ
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {t.approvalStatus && (
                            <Badge className={`${APPROVAL_BADGES[t.approvalStatus] ?? 'bg-slate-100'} px-1.5 py-0 text-[10px]`}>
                              {APPROVAL_LABELS[t.approvalStatus] ?? t.approvalStatus}
                            </Badge>
                          )}
                          {t.approvalStatus === 'PENDING' && t.autoApproveAt && (
                            <div className="mt-0.5 text-[9px] text-slate-400">
                              auto: {formatDateTime(t.autoApproveAt)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isPending ? (
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                title="อนุมัติ"
                                onClick={() => approveOne(t)}
                                disabled={batchMutation.isPending}
                                className="h-7 px-2 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                title="ปฏิเสธ"
                                onClick={() => openRejectSingle(t)}
                                disabled={batchMutation.isPending}
                                className="h-7 px-2 text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-400">—</span>
                          )}
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

      {txns.length > 0 && (
        <div className="text-xs text-slate-500 dark:text-slate-400">
          แสดง {txns.length.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} รายการ
        </div>
      )}

      {/* ── Settings Dialog ────────────────────────────────────────────── */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-[#f97316]" /> ตั้งค่าการอนุมัติ
            </DialogTitle>
            <DialogDescription>กำหนดโหมดการอนุมัติคำขอเบิกออก</DialogDescription>
          </DialogHeader>
          {settingsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="set-mode">โหมดอนุมัติ</Label>
                <Select
                  value={settingsForm.approvalMode}
                  onValueChange={(v) => setSettingsForm((f) => ({ ...f, approvalMode: v as 'manual' | 'auto' }))}
                >
                  <SelectTrigger id="set-mode" className="dark:bg-slate-800 dark:border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">ด้วยมือ (Manual)</SelectItem>
                    <SelectItem value="auto">อัตโนมัติ (Auto)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {settingsForm.approvalMode === 'auto' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="set-delay">หน่วงเวลาก่อนอนุมัติอัตโนมัติ (นาที)</Label>
                    <Input
                      id="set-delay"
                      type="number"
                      min="0"
                      max="10080"
                      value={settingsForm.autoApproveDelayMinutes}
                      onChange={(e) => setSettingsForm((f) => ({ ...f, autoApproveDelayMinutes: e.target.value }))}
                      className="dark:bg-slate-800 dark:border-slate-700"
                    />
                    <p className="text-[10px] text-slate-400">0–10080 นาที (สูงสุด 7 วัน)</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="set-limit">ขนาด batch สูงสุดต่อรอบ cron</Label>
                    <Input
                      id="set-limit"
                      type="number"
                      min="1"
                      max="500"
                      value={settingsForm.autoApproveBatchLimit}
                      onChange={(e) => setSettingsForm((f) => ({ ...f, autoApproveBatchLimit: e.target.value }))}
                      className="dark:bg-slate-800 dark:border-slate-700"
                    />
                    <p className="text-[10px] text-slate-400">1–500</p>
                  </div>
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>ยกเลิก</Button>
            <Button
              onClick={() => saveSettingsMutation.mutate(settingsForm)}
              disabled={saveSettingsMutation.isPending}
              className="bg-[#f97316] hover:bg-[#ea580c] text-white"
            >
              {saveSettingsMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> กำลังบันทึก...</>
              ) : (
                <><Check className="h-4 w-4" /> บันทึก</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reject Dialog (single or batch) ────────────────────────────── */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <X className="h-5 w-5 text-rose-500" /> ปฏิเสธคำขอ
            </DialogTitle>
            <DialogDescription>
              {rejectTarget?.mode === 'batch'
                ? `กำลังปฏิเสธ ${rejectTarget.txnIds.length} รายการ`
                : 'กรุณาระบุเหตุผลในการปฏิเสธ'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">เหตุผล <span className="text-rose-500">*</span></Label>
            <Input
              id="reject-reason"
              placeholder="เช่น สต็อกไม่เพียงพอ, ไม่ใช่งานที่จำเป็น..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="dark:bg-slate-800 dark:border-slate-700"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={batchMutation.isPending}>
              ยกเลิก
            </Button>
            <Button
              onClick={submitReject}
              disabled={batchMutation.isPending || !rejectReason.trim()}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {batchMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> กำลังบันทึก...</>
              ) : (
                <><X className="h-4 w-4" /> ยืนยันปฏิเสธ</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
