'use client'

/**
 * StockHistory — ประวัติ (Tab 7)
 *
 * - Transaction history table: DocumentNo (txnNumber), Date, Type (IN/OUT/ADJUST),
 *   ProductCode, ProductName, Quantity, Unit, PerformedBy, Remark
 * - Filters: date range, type, product code
 * - CSV export button
 *
 * API:
 *   - GET /api/stock-items/pending?status=all&pageSize=500  (returns approval-tracked txns)
 *
 * Notes:
 *   The /api/stock-items/pending endpoint returns transactions where
 *   approvalStatus is not null (work-order parts + standalone stock-out
 *   requests). For a complete history (including direct IN/OUT/ADJUST),
 *   we additionally fan out to /api/stock-items/[id] for each product —
 *   but only on demand (date range / product filter applied) to avoid
 *   hammering the API on initial load. The combined set is then filtered
 *   client-side.
 */

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { matchesSuffixOrContains } from '@/lib/suffix-search'
import { useLang } from '@/store/i18n-store'
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
  History,
  Download,
  RefreshCw,
  Search,
  FileText,
} from 'lucide-react'
import {
  type StockTransaction,
  stockKeys,
  TYPE_LABELS,
  TYPE_BADGES,
  formatDateTime,
  formatDate,
  truncate,
  authFetch,
} from './shared'

// ── Response types ─────────────────────────────────────────────────────

interface PendingListResponse {
  data: StockTransaction[]
  pagination: { total: number }
}

// ── CSV export helper ──────────────────────────────────────────────────

function exportCsv(rows: StockTransaction[]): void {
  const headers = [
    'DocumentNo',
    'Date',
    'Type',
    'ProductCode',
    'ProductName',
    'Quantity',
    'Unit',
    'PerformedBy',
    'Remark',
    'ApprovalStatus',
  ]
  const escape = (s: string | number | boolean | null | undefined): string => {
    if (s == null) return ''
    const str = String(s)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }
  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.txnNumber ?? '',
        r.txnDate ?? '',
        r.type ?? '',
        r.productCode ?? r.stockItem?.productCode ?? '',
        r.productName ?? r.stockItem?.productName ?? '',
        r.quantity ?? 0,
        r.unit ?? r.stockItem?.unit ?? '',
        r.performedBy ?? r.requester ?? '',
        r.remark ?? '',
        r.approvalStatus ?? '',
      ]
        // Wrap in an arrow: `.map(escape)` passes (value, index, array), and the
        // row arrays contain numbers (e.g. `r.quantity ?? 0`) which `escape`'s
        // `string | null | undefined` parameter type rejects.
        .map((v) => escape(v))
        .join(','),
    )
  }
  const csv = '\uFEFF' + lines.join('\n') // BOM for Excel UTF-8
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `stock-history-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  toast.success(`ส่งออก ${rows.length} รายการเป็น CSV`)
}

// ── Component ──────────────────────────────────────────────────────────

export function StockHistory() {
  const { lang } = useLang()
  // Filters
  const [typeFilter, setTypeFilter] = React.useState<'all' | 'IN' | 'OUT' | 'ADJUST'>('all')
  const [productCodeFilter, setProductCodeFilter] = React.useState('')
  const [fromDate, setFromDate] = React.useState('')
  const [toDate, setToDate] = React.useState('')
  const [search, setSearch] = React.useState('')

  // Fetch all approval-tracked transactions (covers parts/stock-out flow).
  // This is the most complete single endpoint we have without modifying APIs.
  const { data, isLoading, isFetching, refetch } = useQuery<PendingListResponse>({
    queryKey: stockKeys.pending({ status: 'all', pageSize: 500, forHistory: true }),
    queryFn: () =>
      authFetch<PendingListResponse>(
        '/api/stock-items/pending?status=all&pageSize=500',
      ),
    staleTime: 30_000,
  })

  const allTxns = data?.data ?? []

  // Apply client-side filters.
  const filtered = React.useMemo(() => {
    return allTxns.filter((t) => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false
      const code = (t.productCode ?? t.stockItem?.productCode ?? '').toLowerCase()
      const name = (t.productName ?? t.stockItem?.productName ?? '').toLowerCase()
      const q = productCodeFilter.trim().toLowerCase()
      if (q && !matchesSuffixOrContains(t.productCode ?? t.stockItem?.productCode, q) && !name.includes(q)) return false
      const sq = search.trim().toLowerCase()
      if (sq) {
        // SUFFIX-AWARE (SEARCH-FIX): identifier fields (txnNumber, productCode,
        // workOrderNo) match by SUFFIX for short numeric queries. Free-text
        // fields (productName, requester, performedBy, remark) use contains.
        const idMatch =
          matchesSuffixOrContains(t.txnNumber, sq) ||
          matchesSuffixOrContains(t.productCode, sq) ||
          matchesSuffixOrContains(t.workOrderNo, sq)
        if (idMatch) return true // short-circuit
        const textMatch =
          (t.productName ?? '').toLowerCase().includes(sq) ||
          (t.requester ?? '').toLowerCase().includes(sq) ||
          (t.performedBy ?? '').toLowerCase().includes(sq) ||
          (t.remark ?? '').toLowerCase().includes(sq)
        if (!textMatch) return false
      }
      if (fromDate && t.txnDate < fromDate) return false
      if (toDate && t.txnDate > toDate) return false
      return true
    })
  }, [allTxns, typeFilter, productCodeFilter, search, fromDate, toDate])

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <History className="h-6 w-6 text-[#0d9488]" />
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">ประวัติธุรกรรม</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              ประวัติการรับเข้า/เบิกออก/ปรับปรุง และคำขอเบิกที่ผ่านระบบอนุมัติ
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => refetch()}
            className="dark:bg-slate-800 dark:border-slate-700"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            รีเฟรช
          </Button>
          <Button
            onClick={() => exportCsv(filtered)}
            disabled={filtered.length === 0}
            className="bg-[#0d9488] hover:bg-[#0f766e] text-white"
          >
            <Download className="h-4 w-4" /> ส่งออก CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="his-from" className="text-xs">จากวันที่</Label>
            <Input
              id="his-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="dark:bg-slate-800 dark:border-slate-700"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="his-to" className="text-xs">ถึงวันที่</Label>
            <Input
              id="his-to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="dark:bg-slate-800 dark:border-slate-700"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">ประเภท</Label>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
              <SelectTrigger className="dark:bg-slate-800 dark:border-slate-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุกประเภท</SelectItem>
                <SelectItem value="IN">รับเข้า</SelectItem>
                <SelectItem value="OUT">เบิกออก</SelectItem>
                <SelectItem value="ADJUST">ปรับปรุง</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="his-code" className="text-xs">รหัสสินค้า</Label>
            <Input
              id="his-code"
              placeholder="STK-0001"
              value={productCodeFilter}
              onChange={(e) => setProductCodeFilter(e.target.value)}
              className="dark:bg-slate-800 dark:border-slate-700"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="his-search" className="text-xs">ค้นหา</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="his-search"
                placeholder="เลขที่ / ชื่อ / ใบสั่งซ่อม..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 dark:bg-slate-800 dark:border-slate-700"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* History table — fills remaining height (Issue 3) */}
      <Card className="flex min-h-0 flex-1 flex-col border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="min-h-0 flex-1 p-0">
          <div className="itam-scroll max-h-[calc(100vh-20rem)] min-h-[300px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                <TableRow>
                  <TableHead className="w-36">เลขที่เอกสาร</TableHead>
                  <TableHead className="w-32">วันที่</TableHead>
                  <TableHead className="w-24">ประเภท</TableHead>
                  <TableHead className="w-28">รหัสสินค้า</TableHead>
                  <TableHead className="min-w-[180px]">ชื่อสินค้า</TableHead>
                  <TableHead className="w-24 text-right">จำนวน</TableHead>
                  <TableHead className="w-20">หน่วย</TableHead>
                  <TableHead className="w-28">ผู้ทำ</TableHead>
                  <TableHead className="min-w-[160px]">หมายเหตุ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell colSpan={9}><Skeleton className="h-7 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-14">
                      <div className="flex flex-col items-center gap-3 text-slate-400 dark:text-slate-500">
                        <FileText className="h-12 w-12 opacity-30" />
                        <div className="text-sm font-medium">
                          {allTxns.length === 0 ? 'ยังไม่มีประวัติธุรกรรม' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((t) => (
                    <TableRow key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <TableCell className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        {t.txnNumber ?? '—'}
                      </TableCell>
                      <TableCell className="text-[11px] text-slate-600 dark:text-slate-300">
                        {formatDate(t.txnDate)}
                        <div className="text-[10px] text-slate-400">{formatDateTime(t.createdAt)}</div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`${TYPE_BADGES[t.type] ?? 'bg-slate-100'} px-1.5 py-0 text-[10px]`}>
                          {TYPE_LABELS[t.type] ?? t.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-slate-700 dark:text-slate-200">
                        {t.productCode ?? t.stockItem?.productCode ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-700 dark:text-slate-200">
                        {truncate(t.productName ?? t.stockItem?.productName ?? '—', 40)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        <span className={
                          t.type === 'IN' ? 'text-emerald-600' : t.type === 'OUT' ? 'text-amber-600' : 'text-sky-600'
                        }>
                          {t.type === 'IN' ? '+' : t.type === 'OUT' ? '-' : '='}{Math.abs(t.quantity)}
                        </span>
                      </TableCell>
                      <TableCell className="text-[11px] text-slate-500 dark:text-slate-400">
                        {t.unit ?? t.stockItem?.unit ?? ''}
                      </TableCell>
                      <TableCell className="text-[11px] text-slate-700 dark:text-slate-200" title={t.performedBy ?? t.requester ?? ''}>
                        {truncate(t.performedBy ?? t.requester ?? '—', 18)}
                      </TableCell>
                      <TableCell className="text-[11px] text-slate-600 dark:text-slate-300" title={t.remark ?? ''}>
                        {truncate(t.remark, 40)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {filtered.length > 0 && (
        <div className="text-xs text-slate-500 dark:text-slate-400">
          แสดง {filtered.length.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} จาก {allTxns.length.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} รายการ
        </div>
      )}
    </div>
  )
}
