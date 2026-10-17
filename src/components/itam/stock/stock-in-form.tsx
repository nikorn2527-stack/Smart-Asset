'use client'

/**
 * StockInForm — รับเข้า (Tab 3)
 *
 * - Form: Date, Supplier (text for now), PurchaseOrderNo (optional), Remark
 * - Multi-item rows: ProductCode (search), ProductName (auto), Quantity,
 *   Unit (auto), UnitPrice
 * - Submit → POST /api/stock-items/[id]/transaction with type=IN (one call per row)
 *
 * Notes:
 *   - We fetch /api/stock-items?pageSize=200 to drive the ProductCode picker.
 *   - Supplier/PurchaseOrderNo/Remark are duplicated into each row's body so
 *     the audit trail carries the context (the API does not yet persist
 *     `purchaseOrderNo`/`vendor`-as-supplier, but `vendor` and `remark` are
 *     stored on StockTransaction).
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
  ArrowDownCircle,
  Plus,
  Trash2,
  Check,
  ChevronsUpDown,
  Loader2,
  Save,
  ScanLine,
  QrCode,
} from 'lucide-react'
import {
  type StockItem,
  stockKeys,
  formatBaht,
  todayISO,
  authFetch,
  PRIMARY_BTN,
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

interface FormState {
  txnDate: string
  supplier: string
  purchaseOrderNo: string
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

export function StockInForm() {
  const qc = useQueryClient()
  const [form, setForm] = React.useState<FormState>({
    txnDate: todayISO(),
    supplier: '',
    purchaseOrderNo: '',
    remark: '',
  })
  const [lines, setLines] = React.useState<LineItem[]>([newLineItem()])
  // QR/barcode scan dialog state (Task ID: UX-GAPS-3-ITEMS).
  // On scan: look up the matching StockItem by productCode (or partial
  // name) and drop it into the first empty line — or append a new line
  // if all rows are already filled.
  const [scanOpen, setScanOpen] = React.useState(false)
  const [scanTargetKey, setScanTargetKey] = React.useState<string | null>(null)

  // Fetch the product list to drive the picker.
  const { data, isLoading } = useQuery<StockListResponse>({
    queryKey: stockKeys.list({ pageSize: 200, forForm: 'in' }),
    queryFn: () =>
      authFetch<StockListResponse>('/api/stock-items?activeOnly=1&pageSize=200'),
    staleTime: 60_000,
  })
  const products = data?.data ?? []

  // Fetch MasterItem (category=Vendor) to drive the supplier combobox. The
  // user can still type a free-form value if their supplier isn't in the list.
  const { data: vendorItems } = useQuery<{ code: string; label: string }[]>({
    queryKey: ['master-all-vendors'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/master?category=Vendor', {
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
  const supplierOptions = (vendorItems ?? []).map((v) => ({ value: v.label, label: v.label }))

  // Submit — one POST per line. We use Promise.allSettled so that partial
  // failures are surfaced clearly to the user.
  const submitMutation = useMutation({
    mutationFn: async (items: LineItem[]) => {
      const results = await Promise.allSettled(
        items.map((it) =>
          authFetch(`/api/stock-items/${it.stockItemId}/transaction`, {
            method: 'POST',
            body: JSON.stringify({
              type: 'IN',
              quantity: Math.trunc(Number(it.quantity)),
              cost: it.unitPrice === '' ? null : Number(it.unitPrice) * Number(it.quantity),
              vendor: form.supplier.trim() || null,
              purchaseOrderNo: form.purchaseOrderNo.trim() || null,
              txnDate: form.txnDate,
              remark: form.remark.trim() || null,
              performedBy: null,
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
      toast.success(`รับเข้าสต็อกเรียบร้อย (${count} รายการ)`)
      qc.invalidateQueries({ queryKey: ['stock-items'] })
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      // Reset only the lines + remark — keep txnDate/supplier for batch workflows.
      setLines([newLineItem()])
      setForm((f) => ({ ...f, purchaseOrderNo: '', remark: '' }))
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

  // ── Scan-to-add (Task ID: UX-GAPS-3-ITEMS) ──
  // The `scanTargetKey` lets a per-row scan button fill a specific line;
  // when null, the scan fills the first empty line or appends a new one.
  function openScannerForLine(key?: string) {
    setScanTargetKey(key ?? null)
    setScanOpen(true)
  }

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
              unitPrice: p.unitCost != null ? String(p.unitCost) : l.unitPrice,
              pickerOpen: false,
            }
          : l,
      ),
    )
  }

  function handleScanResult(code: string) {
    setScanOpen(false)
    setScanTargetKey(null)
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
    if (scanTargetKey) {
      applyScanToLine(scanTargetKey, match)
    } else {
      // Pick into the first empty line; if none, append a new filled line.
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
          unitPrice: match.unitCost != null ? String(match.unitCost) : '',
          pickerOpen: false,
        }
        setLines((arr) => [...arr, newLine])
      }
    }
    toast.success(`สแกนพบ: ${match.productCode} — ${match.productName}`)
  }

  function submit() {
    if (!form.txnDate) {
      toast.error('กรุณาระบุวันที่')
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
    submitMutation.mutate(validLines)
  }

  const grandTotal = lines.reduce((sum, l) => {
    const qty = Number(l.quantity) || 0
    const price = Number(l.unitPrice) || 0
    return sum + qty * price
  }, 0)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ArrowDownCircle className="h-6 w-6 text-emerald-600" />
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">รับเข้าสต็อก</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">บันทึกการรับสินค้าเข้าคลัง — ทีละหลายรายการในเอกสารเดียว</p>
        </div>
      </div>

      {/* Top form */}
      <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">ข้อมูลเอกสาร</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="in-date">วันที่ <span className="text-rose-500">*</span></Label>
            <Input
              id="in-date"
              type="date"
              value={form.txnDate}
              onChange={(e) => setForm((f) => ({ ...f, txnDate: e.target.value }))}
              className="dark:bg-slate-800 dark:border-slate-700"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="in-supplier">ผู้จำหน่าย</Label>
            <Combobox
              value={form.supplier}
              onChange={(v) => setForm((f) => ({ ...f, supplier: v }))}
              items={supplierOptions}
              placeholder="เลือกหรือพิมพ์ผู้จำหน่าย"
              emptyText="ยังไม่มีผู้จำหน่าย — พิมพ์เพื่อเพิ่มใหม่"
              inputId="in-supplier"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="in-po">ใบสั่งซื้อเลขที่ <span className="text-[10px] text-slate-400">(ไม่บังคับ)</span></Label>
            <Input
              id="in-po"
              placeholder="PO-YYYYMMDD-NNN"
              value={form.purchaseOrderNo}
              onChange={(e) => setForm((f) => ({ ...f, purchaseOrderNo: e.target.value }))}
              className="dark:bg-slate-800 dark:border-slate-700"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="in-remark">หมายเหตุ</Label>
            <Input
              id="in-remark"
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
            <CardTitle className="text-sm">รายการสินค้า</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => openScannerForLine()}
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
                  <TableHead className="min-w-[200px]">ชื่อสินค้า</TableHead>
                  <TableHead className="w-24 text-right">จำนวน</TableHead>
                  <TableHead className="w-20">หน่วย</TableHead>
                  <TableHead className="w-32 text-right">ราคา/หน่วย</TableHead>
                  <TableHead className="w-32 text-right">รวม</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7}><Skeleton className="h-7 w-full" /></TableCell>
                  </TableRow>
                ) : (
                  lines.map((l, idx) => {
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

      {/* Footer summary + submit */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-600 dark:text-slate-300">
          มูลค่ารวมทั้งหมด:{' '}
          <span className="text-base font-bold text-[#f97316]">{formatBaht(grandTotal)}</span>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setLines([newLineItem()])
              setForm({ txnDate: todayISO(), supplier: '', purchaseOrderNo: '', remark: '' })
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
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {submitMutation.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> กำลังบันทึก...</>
            ) : (
              <><Save className="h-4 w-4" /> บันทึกรับเข้า</>
            )}
          </Button>
        </div>
      </div>

      {/* QR/barcode scanner dialog (Task ID: UX-GAPS-3-ITEMS) */}
      <QrScannerDialog
        open={scanOpen}
        onOpenChange={(v) => {
          setScanOpen(v)
          if (!v) setScanTargetKey(null)
        }}
        onScan={handleScanResult}
      />
    </div>
  )
}
