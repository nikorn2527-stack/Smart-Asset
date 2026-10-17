'use client'

/**
 * StockPurchaseOrders — ใบสั่งซื้อ (Tab 6)
 *
 * - PO list table: PONumber, OrderDate, Supplier, Status, TotalValue, Actions
 * - Create PO form: Date, Supplier, multi-item (ProductCode, ProductName,
 *   Quantity, Unit, UnitPrice)
 * - PO detail view with line items + receiving status
 *
 * API:
 *   - GET  /api/purchase-orders?search=&status=
 *   - POST /api/purchase-orders
 *   - GET  /api/purchase-orders/[id]
 *   - PUT  /api/purchase-orders/[id]
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
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useLang } from '@/store/i18n-store'
import {
  FileText,
  Plus,
  Trash2,
  Check,
  ChevronsUpDown,
  Loader2,
  RefreshCw,
  Eye,
  X,
  Save,
  Search,
  Package,
} from 'lucide-react'
import {
  type StockItem,
  type PurchaseOrder,
  type PurchaseOrderItem,
  stockKeys,
  PO_STATUS_LABELS,
  PO_STATUS_BADGES,
  formatBaht,
  formatInt,
  formatDate,
  todayISO,
  authFetch,
  PRIMARY_BTN,
} from './shared'

// ── Response types ─────────────────────────────────────────────────────

interface StockListResponse {
  data: StockItem[]
  pagination: { total: number }
  stats: { total: number; lowStock: number; totalValue: number; thisMonth: number }
}

interface PoListResponse {
  data: PurchaseOrder[]
  pagination: { total: number }
}

interface PoDetailResponse {
  data: PurchaseOrder & { items: (PurchaseOrderItem & { stockItem?: { productCode: string; productName: string; unit: string; unitCost: number | null } })[] }
}

interface FormState {
  orderDate: string
  supplier: string
  remark: string
}

interface LineItem {
  key: string
  stockItemId: string
  productCode: string
  productName: string
  unit: string
  quantity: string
  unitPrice: string
  pickerOpen: boolean
}

function newLineItem(): LineItem {
  return {
    key: Math.random().toString(36).slice(2, 9),
    stockItemId: '',
    productCode: '',
    productName: '',
    unit: 'ชิ้น',
    quantity: '1',
    unitPrice: '',
    pickerOpen: false,
  }
}

// ── Component ──────────────────────────────────────────────────────────

export function StockPurchaseOrders() {
  const { lang } = useLang()
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = React.useState('all')
  const [search, setSearch] = React.useState('')

  // Create dialog
  const [createOpen, setCreateOpen] = React.useState(false)
  const [form, setForm] = React.useState<FormState>({
    orderDate: todayISO(),
    supplier: '',
    remark: '',
  })
  const [lines, setLines] = React.useState<LineItem[]>([newLineItem()])

  // Detail dialog
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [detailId, setDetailId] = React.useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = React.useState<string | null>(null)

  // ── Queries ──────────────────────────────────────────────────────────

  const { data, isLoading, isFetching } = useQuery<PoListResponse>({
    queryKey: stockKeys.poList({ status: statusFilter, search: search.trim() }),
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: '200' })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const q = search.trim()
      if (q) params.set('search', q)
      return authFetch<PoListResponse>(`/api/purchase-orders?${params.toString()}`)
    },
    staleTime: 30_000,
  })
  const pos = data?.data ?? []

  const { data: productsData } = useQuery<StockListResponse>({
    queryKey: stockKeys.list({ pageSize: 200, forForm: 'po' }),
    queryFn: () =>
      authFetch<StockListResponse>('/api/stock-items?activeOnly=1&pageSize=200'),
    enabled: createOpen,
    staleTime: 60_000,
  })
  const products = productsData?.data ?? []

  const { data: detailData, isLoading: detailLoading } = useQuery<PoDetailResponse>({
    queryKey: stockKeys.poDetail(detailId ?? ''),
    queryFn: () => authFetch<PoDetailResponse>(`/api/purchase-orders/${detailId!}`),
    enabled: !!detailId && detailOpen,
    staleTime: 15_000,
  })

  // ── Mutations ────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        orderDate: form.orderDate,
        supplier: form.supplier.trim() || null,
        remark: form.remark.trim() || null,
        items: lines
          .filter((l) => l.stockItemId)
          .map((l) => ({
            stockItemId: l.stockItemId,
            quantityOrdered: Number(l.quantity),
            unitPrice: l.unitPrice === '' ? null : Number(l.unitPrice),
          })),
      }
      return authFetch('/api/purchase-orders', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    },
    onSuccess: () => {
      toast.success('สร้างใบสั่งซื้อเรียบร้อย')
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      setCreateOpen(false)
      setForm({ orderDate: todayISO(), supplier: '', remark: '' })
      setLines([newLineItem()])
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    },
  })

  const cancelPoMutation = useMutation({
    mutationFn: async (id: string) =>
      authFetch(`/api/purchase-orders/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'cancelled' }),
      }),
    onSuccess: () => {
      toast.success('ยกเลิกใบสั่งซื้อแล้ว')
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      if (detailId) qc.invalidateQueries({ queryKey: stockKeys.poDetail(detailId) })
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    },
  })

  // ── PO Receiving (Feature 3) ────────────────────────────────────────
  // Receive a single line item by hitting the existing stock-in
  // transaction endpoint with `purchaseOrderNo` set. The server-side
  // route updates PurchaseOrderItem.quantityReceived + recomputes the
  // PO status (open → partial → received).
  const [receiveQty, setReceiveQty] = React.useState<Record<string, string>>({})
  const [receivingId, setReceivingId] = React.useState<string | null>(null)

  const receiveMutation = useMutation({
    mutationFn: async ({
      stockItemId,
      poItem,
      po,
    }: {
      stockItemId: string
      poItem: PurchaseOrderItem
      po: PurchaseOrder
    }) => {
      const qty = Number(receiveQty[poItem.id] ?? '')
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error('กรุณาระบุจำนวนที่รับ')
      }
      const remaining = poItem.quantityOrdered - poItem.quantityReceived
      if (qty > remaining) {
        throw new Error(`จำนวนรับต้องไม่เกินคงเหลือ (${remaining})`)
      }
      return authFetch(`/api/stock-items/${stockItemId}/transaction`, {
        method: 'POST',
        body: JSON.stringify({
          type: 'IN',
          quantity: qty,
          purchaseOrderNo: po.poNumber,
          vendor: po.supplier ?? null,
          cost: poItem.unitPrice != null ? poItem.unitPrice * qty : null,
          reason: `รับสินค้าตามใบสั่งซื้อ ${po.poNumber ?? ''}`,
          txnDate: todayISO(),
        }),
      })
    },
    onMutate: (vars) => setReceivingId(vars.poItem.id),
    onSuccess: () => {
      toast.success('บันทึกการรับสินค้าแล้ว')
      setReceiveQty({})
      setReceivingId(null)
      if (detailId) qc.invalidateQueries({ queryKey: stockKeys.poDetail(detailId) })
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      qc.invalidateQueries({ queryKey: stockKeys.all })
    },
    onError: (err: unknown) => {
      setReceivingId(null)
      toast.error(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ')
    },
  })

  // ── Handlers ─────────────────────────────────────────────────────────

  function updateLine(key: string, patch: Partial<LineItem>) {
    setLines((arr) => arr.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function pickProduct(key: string, p: StockItem) {
    updateLine(key, {
      stockItemId: p.id,
      productCode: p.productCode,
      productName: p.productName,
      unit: p.unit,
      unitPrice: p.unitCost != null ? String(p.unitCost) : '',
      pickerOpen: false,
    })
  }

  function removeLine(key: string) {
    setLines((arr) => (arr.length === 1 ? arr : arr.filter((l) => l.key !== key)))
  }

  function addLine() {
    setLines((arr) => [...arr, newLineItem()])
  }

  function submitCreate() {
    if (!form.orderDate) {
      toast.error('กรุณาระบุวันที่สั่งซื้อ')
      return
    }
    const validLines = lines.filter((l) => l.stockItemId)
    if (validLines.length === 0) {
      toast.error('กรุณาเลือกอย่างน้อย 1 รายการสินค้า')
      return
    }
    for (let i = 0; i < validLines.length; i++) {
      const qty = Number(validLines[i].quantity)
      if (!Number.isFinite(qty) || qty <= 0) {
        toast.error(`รายการที่ ${i + 1}: จำนวนต้องมากกว่า 0`)
        return
      }
    }
    createMutation.mutate()
  }

  function openDetail(id: string) {
    setDetailId(id)
    setDetailOpen(true)
  }

  function handleCancelPo(id: string) {
    setCancelTarget(id)
  }

  const grandTotal = lines.reduce((sum, l) => {
    const qty = Number(l.quantity) || 0
    const price = Number(l.unitPrice) || 0
    return sum + qty * price
  }, 0)

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header + actions */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-6 w-6 text-[#0d9488]" />
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">ใบสั่งซื้อ</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">จัดการใบสั่งซื้อสินค้า — สร้าง / ติดตาม / ยกเลิก</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => qc.invalidateQueries({ queryKey: ['purchase-orders'] })}
            className="dark:bg-slate-800 dark:border-slate-700"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            รีเฟรช
          </Button>
          <Button onClick={() => setCreateOpen(true)} className={PRIMARY_BTN}>
            <Plus className="h-4 w-4" /> สร้างใบสั่งซื้อ
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-44 dark:bg-slate-800 dark:border-slate-700">
            <SelectValue placeholder="สถานะ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกสถานะ</SelectItem>
            <SelectItem value="open">เปิด</SelectItem>
            <SelectItem value="partial">รับบางส่วน</SelectItem>
            <SelectItem value="received">รับครบแล้ว</SelectItem>
            <SelectItem value="cancelled">ยกเลิก</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="ค้นหาเลขที่ / ผู้จำหน่าย / หมายเหตุ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 dark:bg-slate-800 dark:border-slate-700"
          />
        </div>
      </div>

      {/* PO table */}
      <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="p-0">
          <div className="itam-scroll max-h-[55vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                <TableRow>
                  <TableHead className="w-36">เลขที่ PO</TableHead>
                  <TableHead className="w-32">วันที่สั่ง</TableHead>
                  <TableHead className="min-w-[180px]">ผู้จำหน่าย</TableHead>
                  <TableHead className="w-28">สถานะ</TableHead>
                  <TableHead className="w-32 text-right">มูลค่ารวม</TableHead>
                  <TableHead className="w-32 text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={`po-${i}`}>
                      <TableCell colSpan={6}><Skeleton className="h-7 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : pos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-14">
                      <div className="flex flex-col items-center gap-3 text-slate-400 dark:text-slate-500">
                        <FileText className="h-12 w-12 opacity-30" />
                        <div className="text-sm font-medium">ยังไม่มีใบสั่งซื้อ</div>
                        <Button size="sm" onClick={() => setCreateOpen(true)} className={PRIMARY_BTN}>
                          <Plus className="h-4 w-4" /> สร้างใบสั่งซื้อใหม่
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  pos.map((po) => (
                    <TableRow key={po.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <TableCell className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                        {po.poNumber ?? '—'}
                      </TableCell>
                      <TableCell className="text-[11px] text-slate-600 dark:text-slate-300">
                        {formatDate(po.orderDate)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-700 dark:text-slate-200">
                        {po.supplier ?? '—'}
                        {po.remark && (
                          <div className="truncate text-[10px] text-slate-400" title={po.remark}>
                            {po.remark}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={`${PO_STATUS_BADGES[po.status] ?? 'bg-slate-100'} px-1.5 py-0 text-[10px]`}>
                          {PO_STATUS_LABELS[po.status] ?? po.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {formatBaht(po.totalValue)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            title="ดูรายละเอียด"
                            aria-label={`ดูรายละเอียดใบสั่งซื้อ ${po.poNumber ?? po.id ?? ''}`}
                            onClick={() => openDetail(po.id)}
                            className="h-7 px-2 text-slate-500 hover:text-[#0d9488]"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {(po.status === 'open' || po.status === 'partial') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title="ยกเลิก"
                              onClick={() => handleCancelPo(po.id)}
                              disabled={cancelPoMutation.isPending}
                              className="h-7 px-2 text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {pos.length > 0 && (
        <div className="text-xs text-slate-500 dark:text-slate-400">
          แสดง {pos.length.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} ใบสั่งซื้อ
        </div>
      )}

      {/* ── Create PO Dialog ───────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-3xl dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-[#f97316]" /> สร้างใบสั่งซื้อ
            </DialogTitle>
            <DialogDescription>ระบุข้อมูลใบสั่งซื้อและรายการสินค้า</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="po-date">วันที่สั่งซื้อ <span className="text-rose-500">*</span></Label>
                <Input
                  id="po-date"
                  type="date"
                  value={form.orderDate}
                  onChange={(e) => setForm((f) => ({ ...f, orderDate: e.target.value }))}
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="po-supplier">ผู้จำหน่าย</Label>
                <Input
                  id="po-supplier"
                  placeholder="ชื่อบริษัท / ร้าน..."
                  value={form.supplier}
                  onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="po-remark">หมายเหตุ</Label>
                <Input
                  id="po-remark"
                  placeholder="(ไม่บังคับ)"
                  value={form.remark}
                  onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
            </div>

            {/* Line items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-slate-600 dark:text-slate-300">รายการสินค้า</Label>
                <Button size="sm" variant="outline" onClick={addLine} className="dark:bg-slate-800 dark:border-slate-700">
                  <Plus className="h-4 w-4" /> เพิ่มรายการ
                </Button>
              </div>
              <div className="itam-scroll max-h-[40vh] overflow-auto rounded-md border border-slate-200 dark:border-slate-700">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800">
                    <TableRow>
                      <TableHead className="h-8 text-xs">รหัสสินค้า</TableHead>
                      <TableHead className="h-8 text-xs min-w-[160px]">ชื่อสินค้า</TableHead>
                      <TableHead className="h-8 text-xs text-right">จำนวน</TableHead>
                      <TableHead className="h-8 text-xs">หน่วย</TableHead>
                      <TableHead className="h-8 text-xs text-right">ราคา/หน่วย</TableHead>
                      <TableHead className="h-8 text-xs text-right">รวม</TableHead>
                      <TableHead className="h-8 w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, idx) => {
                      const lineTotal = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)
                      return (
                        <TableRow key={l.key}>
                          <TableCell>
                            <Popover open={l.pickerOpen} onOpenChange={(o) => updateLine(l.key, { pickerOpen: o })}>
                              <PopoverTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  role="combobox"
                                  className="w-full justify-between font-mono text-xs dark:bg-slate-800 dark:border-slate-700"
                                >
                                  {l.productCode ? (
                                    <span className="truncate">{l.productCode}</span>
                                  ) : (
                                    <span className="text-slate-400">เลือก...</span>
                                  )}
                                  <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-[--radix-popover-trigger-width] p-0 dark:border-slate-700 dark:bg-slate-900" align="start" onPointerDown={(e) => e.preventDefault()}>
                                <Command>
                                  <CommandInput placeholder="ค้นรหัส / ชื่อ..." />
                                  <CommandList className="itam-scroll max-h-60 overflow-y-auto">
                                    <CommandEmpty>ไม่พบสินค้า</CommandEmpty>
                                    <CommandGroup>
                                      {products.map((p) => (
                                        <CommandItem
                                          key={p.id}
                                          value={`${p.productCode} ${p.productName} ${p.brand ?? ''} ${p.model ?? ''}`}
                                          onSelect={() => pickProduct(l.key, p)}
                                          className="hover:bg-slate-100 dark:hover:bg-slate-800"
                                        >
                                          <Check className={`mr-2 h-3.5 w-3.5 ${l.stockItemId === p.id ? 'opacity-100' : 'opacity-0'}`} />
                                          <div className="flex flex-1 items-center gap-2 truncate">
                                            <span className="font-mono text-[11px] font-semibold">{p.productCode}</span>
                                            <span className="truncate text-xs text-slate-500">{p.productName}</span>
                                          </div>
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          </TableCell>
                          <TableCell className="text-xs">
                            {l.productName ? (
                              <span className="text-slate-700 dark:text-slate-200">{l.productName}</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="1"
                              value={l.quantity}
                              onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                              className="h-8 text-right text-xs dark:bg-slate-800 dark:border-slate-700"
                              aria-label={`จำนวนรายการที่ ${idx + 1}`}
                            />
                          </TableCell>
                          <TableCell className="text-xs text-slate-500 dark:text-slate-400">{l.unit}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              value={l.unitPrice}
                              onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })}
                              className="h-8 text-right text-xs dark:bg-slate-800 dark:border-slate-700"
                              aria-label={`ราคาต่อหน่วยรายการที่ ${idx + 1}`}
                            />
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                            {formatBaht(lineTotal)}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removeLine(l.key)}
                              disabled={lines.length === 1}
                              className="h-7 px-2 text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 pt-3 dark:border-slate-700">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                มูลค่ารวมทั้งหมด
              </span>
              <span className="text-base font-bold text-[#f97316]">{formatBaht(grandTotal)}</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              ยกเลิก
            </Button>
            <Button
              onClick={submitCreate}
              disabled={createMutation.isPending}
              className={PRIMARY_BTN}
            >
              {createMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> กำลังบันทึก...</>
              ) : (
                <><Save className="h-4 w-4" /> สร้างใบสั่งซื้อ</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── PO Detail Dialog ───────────────────────────────────────────── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-3xl dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-[#0d9488]" />
              ใบสั่งซื้อ {detailData?.data.poNumber ?? ''}
            </DialogTitle>
            <DialogDescription>
              วันที่สั่ง: {formatDate(detailData?.data.orderDate)} · ผู้จำหน่าย: {detailData?.data.supplier ?? '—'}
            </DialogDescription>
          </DialogHeader>

          {detailLoading && !detailData ? (
            <div className="space-y-2">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-2/3" />
            </div>
          ) : detailData ? (
            <div className="space-y-4">
              {/* Status banner */}
              <div className="flex items-center justify-between rounded-md border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 dark:text-slate-400">สถานะ:</span>
                  <Badge className={`${PO_STATUS_BADGES[detailData.data.status] ?? 'bg-slate-100'} text-xs`}>
                    {PO_STATUS_LABELS[detailData.data.status] ?? detailData.data.status}
                  </Badge>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase text-slate-400">มูลค่ารวม</div>
                  <div className="text-base font-bold text-[#f97316]">{formatBaht(detailData.data.totalValue)}</div>
                </div>
              </div>

              {/* Line items */}
              <div className="rounded-md border border-slate-200 dark:border-slate-700">
                <div className="itam-scroll max-h-72 overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                      <TableRow>
                        <TableHead className="h-8 text-xs">รหัส</TableHead>
                        <TableHead className="h-8 text-xs min-w-[160px]">ชื่อสินค้า</TableHead>
                        <TableHead className="h-8 text-xs text-right">สั่ง</TableHead>
                        <TableHead className="h-8 text-xs text-right">รับแล้ว</TableHead>
                        <TableHead className="h-8 text-xs text-right">คงเหลือ</TableHead>
                        <TableHead className="h-8 text-xs text-right">ราคา/หน่วย</TableHead>
                        <TableHead className="h-8 text-xs text-right">รวม</TableHead>
                        <TableHead className="h-8 text-xs text-right min-w-[140px]">รับเข้า</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(!detailData.data.items || detailData.data.items.length === 0) ? (
                        <TableRow>
                          <TableCell colSpan={8} className="py-8 text-center text-xs text-slate-400">
                            <Package className="mx-auto mb-2 h-8 w-8 opacity-30" />
                            ไม่มีรายการสินค้า
                          </TableCell>
                        </TableRow>
                      ) : (
                        detailData.data.items.map((it) => {
                          const remaining = it.quantityOrdered - it.quantityReceived
                          const fullyReceived = it.quantityReceived >= it.quantityOrdered
                          const canReceive =
                            remaining > 0 &&
                            (detailData.data.status === 'open' || detailData.data.status === 'partial')
                          const isReceiving = receivingId === it.id
                          return (
                            <TableRow key={it.id}>
                              <TableCell className="font-mono text-[11px] text-slate-700 dark:text-slate-200">
                                {it.stockItem?.productCode ?? '—'}
                              </TableCell>
                              <TableCell className="text-xs text-slate-700 dark:text-slate-200">
                                {it.stockItem?.productName ?? '—'}
                                <div className="text-[10px] text-slate-400">{it.stockItem?.unit}</div>
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs text-slate-700 dark:text-slate-200">
                                {formatInt(it.quantityOrdered)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs">
                                <span className={fullyReceived ? 'text-emerald-600 font-bold' : 'text-slate-700 dark:text-slate-200'}>
                                  {formatInt(it.quantityReceived)}
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs">
                                <span className={remaining > 0 ? 'text-amber-600 font-bold' : 'text-slate-400'}>
                                  {formatInt(remaining)}
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs text-slate-700 dark:text-slate-200">
                                {formatBaht(it.unitPrice)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                                {formatBaht(it.totalValue)}
                              </TableCell>
                              <TableCell className="text-right">
                                {fullyReceived ? (
                                  <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px]">
                                    <Check className="h-3 w-3 mr-1" /> ครบ
                                  </Badge>
                                ) : canReceive ? (
                                  <div className="flex items-center justify-end gap-1">
                                    <Input
                                      type="number"
                                      min={1}
                                      max={remaining}
                                      value={receiveQty[it.id] ?? ''}
                                      onChange={(e) =>
                                        setReceiveQty((m) => ({ ...m, [it.id]: e.target.value }))
                                      }
                                      placeholder={String(remaining)}
                                      className="h-8 w-16 text-right text-xs dark:bg-slate-800 dark:border-slate-700"
                                      aria-label={`จำนวนที่รับ: ${it.stockItem?.productName ?? ''}`}
                                      disabled={isReceiving}
                                    />
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 border-emerald-300 px-2 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950"
                                      disabled={isReceiving || !receiveQty[it.id]}
                                      onClick={() =>
                                        receiveMutation.mutate({
                                          stockItemId: it.stockItemId,
                                          poItem: it,
                                          po: detailData.data,
                                        })
                                      }
                                      aria-label={`รับสินค้า ${it.stockItem?.productName ?? ''}`}
                                    >
                                      {isReceiving ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Package className="h-3.5 w-3.5" />
                                      )}
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
              </div>

              {detailData.data.remark && (
                <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                  <div className="text-[10px] uppercase text-slate-400">หมายเหตุ</div>
                  <div className="mt-1 text-xs text-slate-700 dark:text-slate-200">
                    {detailData.data.remark}
                  </div>
                </div>
              )}

              {(detailData.data.status === 'open' || detailData.data.status === 'partial') && (
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => handleCancelPo(detailData.data.id)}
                    disabled={cancelPoMutation.isPending}
                    className="border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950"
                  >
                    <X className="h-4 w-4" /> ยกเลิกใบสั่งซื้อ
                  </Button>
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              <X className="h-4 w-4" /> ปิด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel PO confirmation */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการยกเลิก</AlertDialogTitle>
            <AlertDialogDescription>
              ต้องการยกเลิกใบสั่งซื้อนี้ใช่หรือไม่? การกระทำนี้ไม่สามารถยกเลิกได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                if (cancelTarget) {
                  cancelPoMutation.mutate(cancelTarget, {
                    onSuccess: () => setCancelTarget(null),
                  })
                }
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              ยืนยัน
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
