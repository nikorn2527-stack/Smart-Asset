'use client'

/**
 * StockDashboard — ภาพรวม (Tab 1)
 *
 * - KPI cards: สินค้าทั้งหมด, สต็อกต่ำ, สต็อกหมด, มูลค่ารวม, รออนุมัติ
 * - Low stock alert list (quantity <= minQuantity)
 * - Recent transactions (last 5) — pulled from /api/stock-items/pending?status=all
 */

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
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
  Package,
  AlertTriangle,
  PackageX,
  Banknote,
  Clock,
  ArrowDownCircle,
} from 'lucide-react'
import {
  type StockItem,
  type StockTransaction,
  stockKeys,
  TYPE_LABELS,
  TYPE_BADGES,
  APPROVAL_LABELS,
  APPROVAL_BADGES,
  formatInt,
  formatBaht,
  formatDate,
  formatDateTime,
  authFetch,
  isLow,
  isOutOfStock,
} from './shared'

// ── Response types ─────────────────────────────────────────────────────

interface StockListResponse {
  data: StockItem[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  stats: {
    total: number
    lowStock: number
    totalValue: number
    thisMonth: number
  }
}

interface PendingListResponse {
  data: StockTransaction[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

// ── Component ──────────────────────────────────────────────────────────

export function StockDashboard() {
  // List all active stock items — we use a high pageSize to cover everything
  // in one request for the dashboard summary.
  const { data, isLoading } = useQuery<StockListResponse>({
    queryKey: stockKeys.list({ pageSize: 200 }),
    queryFn: () =>
      authFetch<StockListResponse>(
        '/api/stock-items?activeOnly=1&pageSize=200',
      ),
    staleTime: 30_000,
  })

  const items = data?.data ?? []
  const stats = data?.stats ?? { total: 0, lowStock: 0, totalValue: 0, thisMonth: 0 }

  const lowStockItems = React.useMemo(
    () => items.filter(isLow).sort((a, b) => a.quantity - b.quantity),
    [items],
  )
  const outOfStockCount = React.useMemo(
    () => items.filter(isOutOfStock).length,
    [items],
  )

  // Recent pending list (status=all → returns approval-tracked transactions).
  const { data: pendingData, isLoading: pendingLoading } = useQuery<PendingListResponse>({
    queryKey: stockKeys.pending({ status: 'all', pageSize: 5 }),
    queryFn: () =>
      authFetch<PendingListResponse>(
        '/api/stock-items/pending?status=all&pageSize=5',
      ),
    staleTime: 30_000,
  })
  const recentTxns = pendingData?.data ?? []
  const pendingCount = React.useMemo(
    () => recentTxns.filter((t) => t.approvalStatus === 'PENDING').length,
    [recentTxns],
  )

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          label="สินค้าทั้งหมด"
          value={isLoading ? null : formatInt(stats.total)}
          icon={<Package className="h-4 w-4" />}
          iconClass="text-[#0d9488]"
          loading={isLoading}
        />
        <KpiCard
          label="สต็อกต่ำ"
          value={isLoading ? null : formatInt(stats.lowStock)}
          icon={<AlertTriangle className="h-4 w-4" />}
          iconClass="text-amber-500"
          badge={stats.lowStock > 0 ? 'ต้องเติม' : undefined}
          loading={isLoading}
        />
        <KpiCard
          label="สต็อกหมด"
          value={isLoading ? null : formatInt(outOfStockCount)}
          icon={<PackageX className="h-4 w-4" />}
          iconClass="text-rose-500"
          loading={isLoading}
        />
        <KpiCard
          label="มูลค่ารวม"
          value={isLoading ? null : formatBaht(stats.totalValue)}
          icon={<Banknote className="h-4 w-4" />}
          iconClass="text-emerald-600"
          loading={isLoading}
        />
        <KpiCard
          label="รออนุมัติ"
          value={pendingLoading ? null : formatInt(pendingCount)}
          icon={<Clock className="h-4 w-4" />}
          iconClass="text-[#f97316]"
          badge={pendingCount > 0 ? 'PENDING' : undefined}
          loading={pendingLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
        {/* Low stock alert list */}
        <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  รายการสต็อกต่ำ
                </h3>
              </div>
              <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
                {lowStockItems.length} รายการ
              </Badge>
            </div>
            <div className="itam-scroll max-h-96 overflow-auto rounded-md border border-slate-200 dark:border-slate-700">
              <Table className="w-full min-w-[500px]">
                <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                  <TableRow>
                    <TableHead className="h-8 whitespace-nowrap text-xs">รหัส</TableHead>
                    <TableHead className="h-8 whitespace-nowrap text-xs">ชื่อสินค้า</TableHead>
                    <TableHead className="h-8 whitespace-nowrap text-right text-xs">คงเหลือ</TableHead>
                    <TableHead className="h-8 whitespace-nowrap text-right text-xs">ต่ำสุด</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={`sk-${i}`}>
                        <TableCell colSpan={4}><Skeleton className="h-7 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : lowStockItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                        <Package className="mx-auto mb-2 h-8 w-8 opacity-30" />
                        ไม่มีรายการสต็อกต่ำ
                      </TableCell>
                    </TableRow>
                  ) : (
                    lowStockItems.map((item) => (
                      <TableRow key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <TableCell className="whitespace-nowrap font-mono text-[11px] text-slate-600 dark:text-slate-300">
                          {item.productCode}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="max-w-[200px] truncate font-medium text-slate-800 dark:text-slate-100" title={item.productName ?? ''}>
                            {item.productName}
                          </div>
                          {item.brand && (
                            <div className="max-w-[200px] truncate text-[10px] text-slate-500" title={item.brand}>{item.brand} {item.model}</div>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono text-xs font-bold text-rose-600 dark:text-rose-400">
                          {formatInt(item.quantity)}
                          <span className="ml-1 text-[10px] font-normal text-slate-400">{item.unit}</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono text-xs text-slate-500 dark:text-slate-400">
                          {formatInt(item.minQuantity)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Recent transactions */}
        <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowDownCircle className="h-4 w-4 text-[#0d9488]" />
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  รายการล่าสุด
                </h3>
              </div>
              <Badge className="bg-[#0d9488]/10 text-[#0d9488] border-[#0d9488]/20">
                {recentTxns.length} รายการ
              </Badge>
            </div>
            <div className="itam-scroll max-h-96 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                  <TableRow>
                    <TableHead className="h-8 text-xs">เลขที่</TableHead>
                    <TableHead className="h-8 text-xs">วันที่</TableHead>
                    <TableHead className="h-8 text-xs">ประเภท</TableHead>
                    <TableHead className="h-8 text-xs">สินค้า</TableHead>
                    <TableHead className="h-8 text-xs text-right">จำนวน</TableHead>
                    <TableHead className="h-8 text-xs">สถานะ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={`tx-${i}`}>
                        <TableCell colSpan={6}><Skeleton className="h-7 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : recentTxns.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                        <Clock className="mx-auto mb-2 h-8 w-8 opacity-30" />
                        ยังไม่มีรายการเคลื่อนไหว
                      </TableCell>
                    </TableRow>
                  ) : (
                    recentTxns.map((t) => (
                      <TableRow key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <TableCell className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                          {t.txnNumber ?? '—'}
                        </TableCell>
                        <TableCell className="text-[11px] text-slate-600 dark:text-slate-300">
                          {formatDateTime(t.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge className={`${TYPE_BADGES[t.type] ?? 'bg-slate-100'} px-1.5 py-0 text-[10px]`}>
                            {TYPE_LABELS[t.type] ?? t.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-medium text-slate-800 dark:text-slate-100">
                            {t.productName ?? t.stockItem?.productName ?? '—'}
                          </div>
                          <div className="font-mono text-[10px] text-slate-500">
                            {t.productCode ?? t.stockItem?.productCode ?? ''}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          <span className={
                            t.type === 'IN' ? 'text-emerald-600' : t.type === 'OUT' ? 'text-amber-600' : 'text-sky-600'
                          }>
                            {t.type === 'IN' ? '+' : t.type === 'OUT' ? '-' : '='}{Math.abs(t.quantity)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {t.approvalStatus && (
                            <Badge className={`${APPROVAL_BADGES[t.approvalStatus] ?? 'bg-slate-100'} px-1.5 py-0 text-[10px]`}>
                              {APPROVAL_LABELS[t.approvalStatus] ?? t.approvalStatus}
                            </Badge>
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
      </div>
    </div>
  )
}

// ── KPI card subcomponent ──────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  iconClass,
  badge,
  loading,
}: {
  label: string
  value: string | null
  icon: React.ReactNode
  iconClass?: string
  badge?: string
  loading?: boolean
}) {
  return (
    <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
      <CardContent className="p-4">
        <div className={`flex items-center gap-2 ${iconClass ?? 'text-slate-500'}`}>
          {icon}
          <span className="text-xs font-medium">{label}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-xl font-bold text-slate-800 dark:text-slate-100">
            {loading ? <Skeleton className="h-6 w-16" /> : (value ?? '—')}
          </span>
          {badge && !loading && (
            <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px] dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
              {badge}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// Re-export formatDate to satisfy bundlers that tree-shake named exports.
export { formatDate }
