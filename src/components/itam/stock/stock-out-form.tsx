'use client'

/**
 * StockOutForm — เบิกออก (Tab 4)
 *
 * - Form: Date, Requester, Department, Purpose, WorkOrderNo (optional), Remark
 * - Multi-item rows: ProductCode, ProductName, Quantity, Unit, stockRemain display
 * - Submit → POST /api/stock-items/[id]/transaction with type=OUT (one call per row)
 *
 * Notes:
 *   - The /api/stock-items/[id]/transaction route enforces stock sufficiency;
 *     we additionally guard client-side using the cached product list so the
 *     user gets a friendlier error before the request leaves the browser.
 *   - requester/department/purpose/workOrderNo are forwarded in the body so
 *     that future API enhancements can persist them without UI changes
 *     (current route stores reason/remark/performedBy/workOrderId/workOrderNo
 *     via the schema fields, but does not yet populate requester/department
 *     /purpose).
 */

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  ArrowUpCircle,
  Plus,
  Trash2,
  Check,
  ChevronsUpDown,
  Loader2,
  Save,
  AlertTriangle,
  Search,
  FileText,
  X,
  QrCode,
  ScanLine,
} from 'lucide-react'
import {
  type StockItem,
  stockKeys,
  formatInt,
  todayISO,
  isLow,
  authFetch,
} from './shared'
import { Combobox } from '../combobox'
import { QrScannerDialog } from '../qr-scanner-dialog'
import { useAuthStore } from '@/store/auth-store'
import { bearerHeaders } from '@/lib/http-headers'

interface StockListResponse {
  data: StockItem[]
  pagination: { total: number }
  stats: { total: number; lowStock: number; totalValue: number; thisMonth: number }
}

interface WorkOrderLite {
  id: string
  woNumber: string | null
  subject: string
  status: string
  reporterName: string | null
  building: string | null
  location: string | null
}

interface WorkOrdersSearchResponse {
  data: WorkOrderLite[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

interface FormState {
  txnDate: string
  requester: string
  department: string
  purpose: string
  workOrderId: string
  workOrderNo: string
  remark: string
}

interface LineItem {
  key: string
  stockItemId: string
  productCode: string
  productName: string
  unit: string
  quantity: string
  stockRemain: number
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
    stockRemain: 0,
    pickerOpen: false,
  }
}

const PURPOSE_OPTIONS = [
  'เบิกใช้งานประจำ',
  'เบิกซ่อมบำรุง',
  'เบิกตามใบสั่งซ่อม',
  'เบิกย้ายสาขา',
  'เบิกทิ้ง/เสียหาย',
  'อื่น ๆ',
]

// ── Component ──────────────────────────────────────────────────────────

export function StockOutForm() {
  const qc = useQueryClient()
  const [form, setForm] = React.useState<FormState>({
    txnDate: todayISO(),
    requester: '',
    department: '',
    purpose: '',
    workOrderId: '',
    workOrderNo: '',
    remark: '',
  })
  const [lines, setLines] = React.useState<LineItem[]>([newLineItem()])
  // QR/barcode scan dialog state (Task ID: UX-GAPS-3-ITEMS).
  // On scan: match a StockItem by productCode/name and pick it into the
  // first empty line — or append a new filled line if all rows are full.
  const [scanOpen, setScanOpen] = React.useState(false)

  // ── Work-order search (Stock OUT → link to WO) ──
  // The WO field used to be a plain text Input — replaced with a
  // search-then-pick dropdown that stores both `workOrderId` (FK,
  // resolved server-side) and `workOrderNo` (display).
  const [woSearch, setWoSearch] = React.useState('')
  const [woSearchOpen, setWoSearchOpen] = React.useState(false)
  const [woDebounced, setWoDebounced] = React.useState('')
  const [selectedWo, setSelectedWo] = React.useState<WorkOrderLite | null>(null)
  React.useEffect(() => {
    const t = setTimeout(() => setWoDebounced(woSearch.trim()), 300)
    return () => clearTimeout(t)
  }, [woSearch])
  const { data: woSearchData, isLoading: woSearchLoading } =
    useQuery<WorkOrdersSearchResponse>({
      queryKey: ['wo-search-stock-out', woDebounced],
      queryFn: async () => {
        if (!woDebounced) return { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }
        const params = new URLSearchParams({
          status: 'ALL',
          search: woDebounced,
          pageSize: '20',
        })
        return authFetch<WorkOrdersSearchResponse>(
          `/api/work-orders?${params.toString()}`,
        )
      },
      enabled: woDebounced.length > 0,
      staleTime: 30_000,
    })
  const woResults: WorkOrderLite[] = woSearchData?.data ?? []

  const { data, isLoading } = useQuery<StockListResponse>({
    queryKey: stockKeys.list({ pageSize: 200, forForm: 'out' }),
    queryFn: () =>
      authFetch<StockListResponse>('/api/stock-items?activeOnly=1&pageSize=200'),
    staleTime: 60_000,
  })
  const products = data?.data ?? []

  // Fetch MasterItem (category=Department) to drive the department combobox.
  // The user can still type a free-form value.
  const { data: deptItems } = useQuery<{ code: string; label: string }[]>({
    queryKey: ['master-all-departments'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/master?category=Department', {
          headers: bearerHeaders(useAuthStore.getState()?.token),
        })
        if (!res.ok) return []
        const j = await res.json()
        return ((j.items ?? []) as { code: string; label: string }[])
      } catch {
        return []
      }
    },
    staleTime: 60_000,
  })
  const deptOptions = (deptItems ?? []).map((d) => ({ value: d.label, label: d.label }))

  const submitMutation = useMutation({
    mutationFn: async (items: LineItem[]) => {
      const results = await Promise.allSettled(
        items.map((it) =>
          authFetch(`/api/stock-items/${it.stockItemId}/transaction`, {
            method: 'POST',
            body: JSON.stringify({
              type: 'OUT',
              quantity: Math.trunc(Number(it.quantity)),
              txnDate: form.txnDate,
              requester: form.requester.trim() || null,
              department: form.department.trim() || null,
              purpose: form.purpose.trim() || null,
              // Send BOTH the FK id and the display string — the API's
              // `resolveWorkOrderReference` prefers `workOrderId` but
              // also accepts `workOrderNo` as a fallback (so legacy
              // lookups by woNumber still work).
              workOrderId: form.workOrderId.trim() || null,
              workOrderNo: form.workOrderNo.trim() || null,
              performedBy: form.requester.trim() || null,
              reason: form.purpose.trim() || null,
              remark: form.remark.trim() || null,
            }),
          }),
        ),
      )
      const failures = results
        .map((r, i) => (r.status === 'rejected' ? { index: i, reason: String(r.reason) } : null))
        .filter(Boolean) as { index: number; reason: string }[]
      if (failures.length > 0) {
        throw new Error(
          `บันทึกสำเร็จ ${results.length - failures.length}/${results.length} รายการ — ล้มเหลว: ${failures
            .map((f) => `รายการที่ ${f.index + 1}`)
            .join(', ')}`,
        )
      }
      return results.length
    },
    onSuccess: (count) => {
      toast.success(`เบิกออกสต็อกเรียบร้อย (${count} รายการ)`)
      qc.invalidateQueries({ queryKey: ['stock-items'] })
      setLines([newLineItem()])
      setForm((f) => ({ ...f, workOrderId: '', workOrderNo: '', remark: '' }))
      setSelectedWo(null)
      setWoSearch('')
      setWoDebounced('')
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    },
  })

  function updateLine(key: string, patch: Partial<LineItem>) {
    setLines((arr) => arr.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function pickProduct(key: string, p: StockItem) {
    updateLine(key, {
      stockItemId: p.id,
      productCode: p.productCode,
      productName: p.productName,
      unit: p.unit,
      stockRemain: p.quantity,
      pickerOpen: false,
      quantity: '1',
    })
  }

  function removeLine(key: string) {
    setLines((arr) => (arr.length === 1 ? arr : arr.filter((l) => l.key !== key)))
  }

  function addLine() {
    setLines((arr) => [...arr, newLineItem()])
  }

  // ── Scan-to-add (Task ID: UX-GAPS-3-ITEMS) ──
  function findProductByCode(code: string): StockItem | undefined {
    const v = code.trim().toLowerCase()
    if (!v) return undefined
    return (
      products.find((p) => p.productCode.toLowerCase() === v) ??
      products.find((p) => p.productCode.toLowerCase().includes(v)) ??
      products.find((p) => p.productName.toLowerCase().includes(v))
    )
  }

  function applyScanToLine(key: string, p: StockItem) {
    setLines((arr) =>
      arr.map((l) =>
        l.key === key
          ? {
              ...l,
              stockItemId: p.id,
              productCode: p.productCode,
              productName: p.productName,
              unit: p.unit,
              stockRemain: p.quantity,
              quantity: '1',
              pickerOpen: false,
            }
          : l,
      ),
    )
  }

  function handleScanResult(code: string) {
    setScanOpen(false)
    const v = code.trim()
    if (!v) return
    if (products.length === 0) {
      toast.error('ยังไม่มีรายการสินค้าในระบบ')
      return
    }
    const match = findProductByCode(v)
    if (!match) {
      toast.error(`ไม่พบสินค้าที่ตรงกับ "${v}"`)
      return
    }
    const emptyLine = lines.find((l) => !l.stockItemId)
    if (emptyLine) {
      applyScanToLine(emptyLine.key, match)
    } else {
      const newLine: LineItem = {
        ...newLineItem(),
        stockItemId: match.id,
        productCode: match.productCode,
        productName: match.productName,
        unit: match.unit,
        stockRemain: match.quantity,
        quantity: '1',
        pickerOpen: false,
      }
      setLines((arr) => [...arr, newLine])
    }
    toast.success(`สแกนพบ: ${match.productCode} — ${match.productName}`)
  }

  function submit() {
    if (!form.txnDate) {
      toast.error('กรุณาระบุวันที่')
      return
    }
    if (!form.requester.trim()) {
      toast.error('กรุณาระบุชื่อผู้เบิก')
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
      if (qty > validLines[i].stockRemain) {
        toast.error(
          `รายการที่ ${i + 1}: จำนวนเบิกเกินคงเหลือ (${validLines[i].stockRemain} ${validLines[i].unit})`,
        )
        return
      }
    }
    submitMutation.mutate(validLines)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ArrowUpCircle className="h-6 w-6 text-amber-600" />
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">เบิกออกสต็อก</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">บันทึกการเบิกสินค้าออกจากคลัง — ทีละหลายรายการในเอกสารเดียว</p>
        </div>
      </div>

      {/* Top form */}
      <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">ข้อมูลการเบิก</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="out-date">วันที่ <span className="text-rose-500">*</span></Label>
            <Input
              id="out-date"
              type="date"
              value={form.txnDate}
              onChange={(e) => setForm((f) => ({ ...f, txnDate: e.target.value }))}
              className="dark:bg-slate-800 dark:border-slate-700"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="out-requester">ผู้เบิก <span className="text-rose-500">*</span></Label>
            <Input
              id="out-requester"
              placeholder="ชื่อ-นามสกุล"
              value={form.requester}
              onChange={(e) => setForm((f) => ({ ...f, requester: e.target.value }))}
              className="dark:bg-slate-800 dark:border-slate-700"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="out-dept">แผนก</Label>
            <Combobox
              value={form.department}
              onChange={(v) => setForm((f) => ({ ...f, department: v }))}
              items={deptOptions}
              placeholder="เลือกหรือพิมพ์แผนก"
              emptyText="ยังไม่มีแผนก — พิมพ์เพื่อเพิ่มใหม่"
              inputId="out-dept"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="out-purpose">วัตถุประสงค์</Label>
            <Combobox
              value={form.purpose}
              onChange={(v) => setForm((f) => ({ ...f, purpose: v }))}
              items={PURPOSE_OPTIONS.map((p) => ({ value: p, label: p }))}
              placeholder="เลือกหรือพิมพ์วัตถุประสงค์"
              emptyText="ไม่พบตัวเลือก"
              inputId="out-purpose"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="out-wo">ใบสั่งซ่อมเลขที่ <span className="text-[10px] text-slate-400">(ไม่บังคับ)</span></Label>

            {/* Hidden inputs keep the actual form values for submission.
                The visible UI is the search input + chip below. */}
            <input
              type="hidden"
              name="workOrderId"
              value={form.workOrderId}
            />
            <input
              type="hidden"
              name="workOrderNo"
              value={form.workOrderNo}
            />

            {selectedWo ? (
              // Selected WO chip (emerald) — woNumber + subject + reporter + building + remove.
              <div className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-2 dark:border-emerald-700 dark:bg-emerald-950/30">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      {selectedWo.woNumber ?? selectedWo.id}
                    </span>
                    <Badge
                      variant="outline"
                      className="border-emerald-200 bg-emerald-100 px-1 py-0 text-[9px] text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                    >
                      {selectedWo.status || 'WO'}
                    </Badge>
                  </div>
                  <div className="truncate text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
                    {selectedWo.subject}
                  </div>
                  <div className="text-[10px] text-emerald-700/70 dark:text-emerald-300/70">
                    {selectedWo.reporterName ?? '—'}
                    {selectedWo.building ? ` • ${selectedWo.building}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedWo(null)
                    setForm((f) => ({ ...f, workOrderId: '', workOrderNo: '' }))
                    setWoSearch('')
                    setWoDebounced('')
                    setWoSearchOpen(false)
                  }}
                  className="shrink-0 rounded p-1 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-900/40 dark:hover:text-emerald-100"
                  aria-label="ลบใบสั่งซ่อมที่เลือก"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              // Search Input + results dropdown (Popover + Command — same
              // pattern as the product picker in the line items table).
              <Popover open={woSearchOpen} onOpenChange={setWoSearchOpen}>
                <PopoverTrigger asChild>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="out-wo"
                      value={woSearch}
                      onChange={(e) => {
                        setWoSearch(e.target.value)
                        setWoSearchOpen(true)
                      }}
                      onFocus={() => setWoSearchOpen(true)}
                      onBlur={() => setTimeout(() => setWoSearchOpen(false), 200)}
                      placeholder="ค้นหา WO-YYYYMMDD-NNN / หัวข้อ / อาคาร / ผู้แจ้ง"
                      className="pl-9 dark:bg-slate-800 dark:border-slate-700"
                      autoComplete="off"
                    />
                    <ChevronsUpDown className="absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  </div>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[--radix-popover-trigger-width] p-0 dark:border-slate-700 dark:bg-slate-900"
                  align="start"
                  onPointerDown={(e) => e.preventDefault()}
                >
                  <Command shouldFilter={false}>
                    <CommandList className="itam-scroll max-h-72 overflow-y-auto">
                      {woSearchLoading && (
                        <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-slate-500">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          กำลังค้นหา...
                        </div>
                      )}
                      {!woSearchLoading && woResults.length === 0 && (
                        <CommandEmpty>
                          {woSearch.trim()
                            ? 'ไม่พบใบสั่งซ่อม'
                            : 'พิมพ์เพื่อค้นหาใบสั่งซ่อม (WO-YYYYMMDD-NNN / หัวข้อ / อาคาร / ผู้แจ้ง)'}
                        </CommandEmpty>
                      )}
                      {!woSearchLoading && woResults.length > 0 && (
                        <CommandGroup>
                          {woResults.map((wo) => (
                            <CommandItem
                              key={wo.id}
                              value={`${wo.woNumber ?? ''} ${wo.subject} ${wo.reporterName ?? ''} ${wo.building ?? ''}`}
                              onSelect={() => {
                                setSelectedWo(wo)
                                setForm((f) => ({
                                  ...f,
                                  workOrderId: wo.id,
                                  workOrderNo: wo.woNumber ?? '',
                                }))
                                setWoSearch('')
                                setWoDebounced('')
                                setWoSearchOpen(false)
                              }}
                              className="hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <Check className="mr-2 h-3.5 w-3.5 opacity-0" />
                              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                    {wo.woNumber ?? '—'}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className="px-1 py-0 text-[9px] text-slate-500"
                                  >
                                    {wo.status}
                                  </Badge>
                                </div>
                                <span className="truncate text-xs text-slate-700 dark:text-slate-200">
                                  {wo.subject}
                                </span>
                                <span className="text-[10px] text-slate-500">
                                  {wo.reporterName ?? '—'}
                                  {wo.building ? ` • ${wo.building}` : ''}
                                </span>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="out-remark">หมายเหตุ</Label>
            <Input
              id="out-remark"
              placeholder="(ไม่บังคับ)"
              value={form.remark}
              onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
              className="dark:bg-slate-800 dark:border-slate-700"
            />
          </div>
        </CardContent>
      </Card>

      {/* Line items */}
      <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">รายการสินค้าที่เบิก</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setScanOpen(true)}
                disabled={isLoading || products.length === 0}
                title="สแกน QR/บาร์โค้ดเพื่อเพิ่มรายการ"
                className="border-orange-300 text-orange-700 hover:bg-orange-50 hover:text-orange-800 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950/40"
              >
                <QrCode className="h-4 w-4" />
                <ScanLine className="h-3.5 w-3.5" />
                สแกน
              </Button>
              <Button size="sm" variant="outline" onClick={addLine} className="dark:bg-slate-800 dark:border-slate-700">
                <Plus className="h-4 w-4" /> เพิ่มรายการ
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="itam-scroll max-h-[50vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                <TableRow>
                  <TableHead className="w-40">รหัสสินค้า</TableHead>
                  <TableHead className="min-w-[180px]">ชื่อสินค้า</TableHead>
                  <TableHead className="w-28 text-right">คงเหลือ</TableHead>
                  <TableHead className="w-24 text-right">จำนวนเบิก</TableHead>
                  <TableHead className="w-20">หน่วย</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6}><Skeleton className="h-7 w-full" /></TableCell>
                  </TableRow>
                ) : (
                  lines.map((l, idx) => {
                    const lowStock = l.stockRemain > 0 && l.stockRemain <= 5
                    const overDraw = Number(l.quantity) > l.stockRemain
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
                                          <Badge className="ml-auto bg-slate-100 text-slate-500 text-[9px]">
                                            {p.quantity} {p.unit}
                                          </Badge>
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
                        <TableCell className="text-right font-mono text-xs">
                          {l.stockRemain > 0 ? (
                            <span className={lowStock ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-slate-700 dark:text-slate-200'}>
                              {formatInt(l.stockRemain)}
                              {lowStock && <AlertTriangle className="ml-1 inline h-3 w-3" />}
                            </span>
                          ) : (
                            <Badge className="bg-rose-100 text-rose-700 border-rose-200 text-[9px] dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800">
                              หมด
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="1"
                            max={l.stockRemain || undefined}
                            value={l.quantity}
                            onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                            className={`h-8 text-right text-xs dark:bg-slate-800 dark:border-slate-700 ${overDraw ? 'border-rose-400 focus-visible:ring-rose-400' : ''}`}
                            aria-label={`จำนวนเบิกรายการที่ ${idx + 1}`}
                          />
                          {overDraw && (
                            <div className="text-[10px] text-rose-500">เกินคงเหลือ</div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500 dark:text-slate-400">{l.unit}</TableCell>
                        <TableCell>
                          <Button
            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => removeLine(l.key)}
                            disabled={lines.length === 1}
                            className="h-7 px-2 text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                            title="ลบรายการ"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
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

      {/* Submit */}
      <div className="flex justify-end gap-2">
        <Button
            type="button"
          variant="outline"
          onClick={() => {
            setLines([newLineItem()])
            setForm({ txnDate: todayISO(), requester: '', department: '', purpose: '', workOrderId: '', workOrderNo: '', remark: '' })
            setSelectedWo(null)
            setWoSearch('')
            setWoDebounced('')
            setWoSearchOpen(false)
          }}
          disabled={submitMutation.isPending}
          className="dark:bg-slate-800 dark:border-slate-700"
        >
          ล้างฟอร์ม
        </Button>
        <Button
          type="button"
          onClick={submit}
          disabled={submitMutation.isPending}
          className="bg-amber-600 hover:bg-amber-700 text-white"
        >
          {submitMutation.isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> กำลังบันทึก...</>
          ) : (
            <><Save className="h-4 w-4" /> บันทึกเบิกออก</>
          )}
        </Button>
      </div>

      {/* QR/barcode scanner dialog (Task ID: UX-GAPS-3-ITEMS) */}
      <QrScannerDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onScan={handleScanResult}
      />
    </div>
  )
}
