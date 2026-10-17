'use client'

/**
 * StockSummary — สรุป (Tab 8)
 *
 * - Summary by product: total IN, total OUT, current stock, value
 * - Summary by person: total transactions per person
 * - Date range filter
 *
 * Data sources:
 *   - /api/stock-items?pageSize=200 — for current stock levels + value
 *   - /api/stock-items/pending?status=all&pageSize=500 — for transaction
 *     history (IN/OUT/ADJUST), grouped client-side
 */

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
  BarChart3,
  Package,
  Users,
  TrendingUp,
  TrendingDown,
  Banknote,
} from 'lucide-react'
import {
  type StockItem,
  type StockTransaction,
  stockKeys,
  formatInt,
  formatBaht,
  authFetch,
} from './shared'

interface StockListResponse {
  data: StockItem[]
  pagination: { total: number }
  stats: { total: number; lowStock: number; totalValue: number; thisMonth: number }
}

interface PendingListResponse {
  data: StockTransaction[]
  pagination: { total: number }
}

interface ProductRow {
  productCode: string
  productName: string
  unit: string
  totalIn: number
  totalOut: number
  currentStock: number
  unitCost: number | null
  value: number
}

interface PersonRow {
  person: string
  inCount: number
  outCount: number
  adjustCount: number
  total: number
}

// ── Component ──────────────────────────────────────────────────────────

export function StockSummary() {
  const [fromDate, setFromDate] = React.useState('')
  const [toDate, setToDate] = React.useState('')

  const { data: stockData, isLoading: stockLoading } = useQuery<StockListResponse>({
    queryKey: stockKeys.list({ pageSize: 200, forSummary: true }),
    queryFn: () =>
      authFetch<StockListResponse>('/api/stock-items?activeOnly=0&pageSize=200'),
    staleTime: 30_000,
  })
  const stockItems = stockData?.data ?? []

  const { data: txnData, isLoading: txnLoading } = useQuery<PendingListResponse>({
    queryKey: stockKeys.pending({ status: 'all', pageSize: 500, forSummary: true }),
    queryFn: () =>
      authFetch<PendingListResponse>('/api/stock-items/pending?status=all&pageSize=500'),
    staleTime: 30_000,
  })
  const txns = txnData?.data ?? []

  // Apply date filter to txns
  const filteredTxns = React.useMemo(() => {
    return txns.filter((t) => {
      if (fromDate && t.txnDate < fromDate) return false
      if (toDate && t.txnDate > toDate) return false
      return true
    })
  }, [txns, fromDate, toDate])

  // ── Summary by product ───────────────────────────────────────────────
  const productRows = React.useMemo<ProductRow[]>(() => {
    const map = new Map<string, ProductRow>()
    // Seed from current stock list
    for (const it of stockItems) {
      map.set(it.productCode, {
        productCode: it.productCode,
        productName: it.productName,
        unit: it.unit,
        totalIn: 0,
        totalOut: 0,
        currentStock: it.quantity,
        unitCost: it.unitCost,
        value: (it.unitCost ?? 0) * it.quantity,
      })
    }
    // Aggregate from transactions
    for (const t of filteredTxns) {
      const code = t.productCode ?? t.stockItem?.productCode
      if (!code) continue
      const name = t.productName ?? t.stockItem?.productName ?? ''
      const unit = t.unit ?? t.stockItem?.unit ?? 'ชิ้น'
      if (!map.has(code)) {
        // Item not in active list (may be soft-deleted); still include
        map.set(code, {
          productCode: code,
          productName: name,
          unit,
          totalIn: 0,
          totalOut: 0,
          currentStock: 0,
          unitCost: null,
          value: 0,
        })
      }
      const row = map.get(code)!
      if (t.type === 'IN') row.totalIn += Math.abs(t.quantity)
      else if (t.type === 'OUT') row.totalOut += Math.abs(t.quantity)
    }
    return Array.from(map.values()).sort((a, b) => b.totalIn + b.totalOut - (a.totalIn + a.totalOut))
  }, [stockItems, filteredTxns])

  // ── Summary by person ────────────────────────────────────────────────
  const personRows = React.useMemo<PersonRow[]>(() => {
    const map = new Map<string, PersonRow>()
    for (const t of filteredTxns) {
      const person = (t.performedBy ?? t.requester ?? t.approver ?? 'ไม่ระบุ').trim() || 'ไม่ระบุ'
      if (!map.has(person)) {
        map.set(person, {
          person,
          inCount: 0,
          outCount: 0,
          adjustCount: 0,
          total: 0,
        })
      }
      const row = map.get(person)!
      row.total += 1
      if (t.type === 'IN') row.inCount += 1
      else if (t.type === 'OUT') row.outCount += 1
      else if (t.type === 'ADJUST') row.adjustCount += 1
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total)
  }, [filteredTxns])

  // ── Aggregate stats ──────────────────────────────────────────────────
  const totalStockValue = React.useMemo(
    () => stockItems.reduce((sum, it) => sum + (it.unitCost ?? 0) * it.quantity, 0),
    [stockItems],
  )
  const totalInQty = React.useMemo(
    () => filteredTxns.filter((t) => t.type === 'IN').reduce((s, t) => s + Math.abs(t.quantity), 0),
    [filteredTxns],
  )
  const totalOutQty = React.useMemo(
    () => filteredTxns.filter((t) => t.type === 'OUT').reduce((s, t) => s + Math.abs(t.quantity), 0),
    [filteredTxns],
  )

  const loading = stockLoading || txnLoading

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <BarChart3 className="h-6 w-6 text-[#f97316]" />
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">สรุปยอด</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            สรุปการเคลื่อนไหวสต็อกแยกตามสินค้าและบุคคล
          </p>
        </div>
      </div>

      {/* Date range filter */}
      <Card className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="grid grid-cols-2 items-end gap-2.5 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:gap-3 md:p-3.5">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="sum-from" className="text-[11px] font-medium text-slate-500 dark:text-slate-400">จากวันที่</Label>
            <Input
              id="sum-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-9 dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="sum-to" className="text-[11px] font-medium text-slate-500 dark:text-slate-400">ถึงวันที่</Label>
            <Input
              id="sum-to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-9 dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          {(fromDate || toDate) && (
            <button
              type="button"
              onClick={() => {
                setFromDate('')
                setToDate('')
              }}
              className="col-span-2 justify-self-start text-[11px] font-medium text-[#f97316] hover:underline sm:col-span-1 sm:mb-2"
            >
              ล้างช่วงวันที่
            </button>
          )}
        </CardContent>
      </Card>

      {/* Aggregate stat cards */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="flex items-center justify-between gap-3 p-3 md:p-3.5">
            <div className="flex min-w-0 items-center gap-2 text-emerald-600">
              <TrendingUp className="h-4 w-4" />
              <span className="text-xs font-medium">รับเข้ารวม</span>
            </div>
            <div className="shrink-0 text-xl font-bold text-slate-800 dark:text-slate-100 md:text-2xl">
              {loading ? <Skeleton className="h-6 w-16" /> : formatInt(totalInQty)}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="flex items-center justify-between gap-3 p-3 md:p-3.5">
            <div className="flex min-w-0 items-center gap-2 text-amber-600">
              <TrendingDown className="h-4 w-4" />
              <span className="text-xs font-medium">เบิกออกรวม</span>
            </div>
            <div className="shrink-0 text-xl font-bold text-slate-800 dark:text-slate-100 md:text-2xl">
              {loading ? <Skeleton className="h-6 w-16" /> : formatInt(totalOutQty)}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="flex items-center justify-between gap-3 p-3 md:p-3.5">
            <div className="flex min-w-0 items-center gap-2 text-[#0d9488]">
              <Banknote className="h-4 w-4" />
              <span className="text-xs font-medium">มูลค่าสต็อกรวม</span>
            </div>
            <div className="shrink-0 text-base font-bold text-slate-800 dark:text-slate-100 md:text-xl">
              {loading ? <Skeleton className="h-6 w-28" /> : formatBaht(totalStockValue)}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="flex items-center justify-between gap-3 p-3 md:p-3.5">
            <div className="flex min-w-0 items-center gap-2 text-[#f97316]">
              <Users className="h-4 w-4" />
              <span className="text-xs font-medium">ผู้ทำรายการ</span>
            </div>
            <div className="shrink-0 text-xl font-bold text-slate-800 dark:text-slate-100 md:text-2xl">
              {loading ? <Skeleton className="h-6 w-12" /> : formatInt(personRows.length)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 xl:grid-cols-2 xl:items-stretch">
      {/* Summary by product */}
      <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
        <CardHeader className="px-3 py-2.5 md:px-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Package className="h-4 w-4 text-[#0d9488]" />
            สรุปแยกตามสินค้า
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="itam-scroll max-h-[calc(100vh-22rem)] min-h-[260px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                  <TableRow className="h-9">
                    <TableHead className="w-28 py-2 text-[11px]">รหัสสินค้า</TableHead>
                    <TableHead className="min-w-[180px] py-2 text-[11px]">ชื่อสินค้า</TableHead>
                    <TableHead className="w-24 py-2 text-right text-[11px]">รับเข้า</TableHead>
                    <TableHead className="w-24 py-2 text-right text-[11px]">เบิกออก</TableHead>
                    <TableHead className="w-24 py-2 text-right text-[11px]">คงเหลือ</TableHead>
                    <TableHead className="w-20 py-2 text-[11px]">หน่วย</TableHead>
                    <TableHead className="w-32 py-2 text-right text-[11px]">มูลค่าคงเหลือ</TableHead>
                  </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell colSpan={7}><Skeleton className="h-7 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : productRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-14">
                      <div className="flex flex-col items-center gap-3 text-slate-400 dark:text-slate-500">
                        <Package className="h-12 w-12 opacity-30" />
                        <div className="text-sm">ไม่มีข้อมูลสินค้า</div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  productRows.map((row) => (
                    <TableRow key={row.productCode} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <TableCell className="py-1.5 font-mono text-[11px] text-slate-700 dark:text-slate-200">
                        {row.productCode}
                      </TableCell>
                      <TableCell className="py-1.5 text-xs text-slate-700 dark:text-slate-200">
                        {row.productName}
                      </TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-xs text-emerald-600">
                        +{formatInt(row.totalIn)}
                      </TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-xs text-amber-600">
                        -{formatInt(row.totalOut)}
                      </TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-xs font-bold text-slate-700 dark:text-slate-200">
                        {formatInt(row.currentStock)}
                      </TableCell>
                      <TableCell className="py-1.5 text-[11px] text-slate-500 dark:text-slate-400">{row.unit}</TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {formatBaht(row.value)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Summary by person */}
      <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
        <CardHeader className="px-3 py-2.5 md:px-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4 text-[#f97316]" />
            สรุปแยกตามผู้ทำรายการ
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="itam-scroll max-h-[calc(100vh-22rem)] min-h-[260px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                  <TableRow className="h-9">
                    <TableHead className="min-w-[180px] py-2 text-[11px]">ผู้ทำรายการ</TableHead>
                    <TableHead className="w-24 py-2 text-right text-[11px]">รับเข้า</TableHead>
                    <TableHead className="w-24 py-2 text-right text-[11px]">เบิกออก</TableHead>
                    <TableHead className="w-24 py-2 text-right text-[11px]">ปรับปรุง</TableHead>
                    <TableHead className="w-24 py-2 text-right text-[11px]">รวม</TableHead>
                  </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={`sp-${i}`}>
                      <TableCell colSpan={5}><Skeleton className="h-7 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : personRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-14">
                      <div className="flex flex-col items-center gap-3 text-slate-400 dark:text-slate-500">
                        <Users className="h-12 w-12 opacity-30" />
                        <div className="text-sm">ไม่มีข้อมูลผู้ทำรายการ</div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  personRows.map((row) => (
                    <TableRow key={row.person} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <TableCell className="py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                        {row.person}
                      </TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-xs text-emerald-600">
                        {formatInt(row.inCount)}
                      </TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-xs text-amber-600">
                        {formatInt(row.outCount)}
                      </TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-xs text-sky-600">
                        {formatInt(row.adjustCount)}
                      </TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-xs font-bold">
                        <Badge className="bg-[#0d9488]/10 text-[#0d9488] border-[#0d9488]/20 text-[10px]">
                          {formatInt(row.total)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  )
}
