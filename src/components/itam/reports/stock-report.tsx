'use client'

import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Package, DollarSign, AlertTriangle, XCircle, History,
} from 'lucide-react'
import {
  SummaryCard, SectionCard, EmptyState,
  formatNumber, formatBaht, formatDate,
} from './shared'

export function StockReport({ data }: { data: any }) {
  const s = data.summary
  return (
    <>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        <SummaryCard title="สินค้าทั้งหมด" value={formatNumber(s.totalItems)} icon={<Package className="h-5 w-5" />} accent="#0d9488" hint={`จำนวนรวม ${formatNumber(s.totalQuantity)} หน่วย`} />
        <SummaryCard title="มูลค่าสต็อก" value={formatBaht(s.totalValue)} icon={<DollarSign className="h-5 w-5" />} accent="#10b981" hint="รวมทุกสาขา" />
        <SummaryCard title="ของเหลือน้อย" value={formatNumber(s.lowStockCount)} icon={<AlertTriangle className="h-5 w-5" />} accent="#f59e0b" hint="ต่ำกว่าขั้นต่ำ" />
        <SummaryCard title="ของหมด" value={formatNumber(s.outOfStockCount)} icon={<XCircle className="h-5 w-5" />} accent="#ef4444" hint="qty = 0" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SectionCard title={`สต็อกต่ำ (${formatNumber(data.lowStock.length)})`} icon={<AlertTriangle className="h-4 w-4" />} accent="#f59e0b">
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="text-xs">รหัส</TableHead>
                  <TableHead className="text-xs">สินค้า</TableHead>
                  <TableHead className="text-right text-xs">คงเหลือ</TableHead>
                  <TableHead className="text-right text-xs">ขั้นต่ำ</TableHead>
                  <TableHead className="text-right text-xs">ขาด</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.lowStock.slice(0, 30).map((d: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{d.productCode}</TableCell>
                    <TableCell className="text-xs">{d.productName}</TableCell>
                    <TableCell className="text-right"><Badge variant="destructive" className="text-xs">{d.quantity} {d.unit}</Badge></TableCell>
                    <TableCell className="text-right text-xs">{d.minQuantity}</TableCell>
                    <TableCell className="text-right text-xs text-red-600">-{d.shortage}</TableCell>
                  </TableRow>
                ))}
                {data.lowStock.length === 0 && (
                  <TableRow><TableCell colSpan={5}><EmptyState label="ไม่มีสต็อกต่ำ ✅" /></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>

        <SectionCard title={`ของหมด (${formatNumber(data.outOfStock.length)})`} icon={<XCircle className="h-4 w-4" />} accent="#ef4444">
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="text-xs">รหัส</TableHead>
                  <TableHead className="text-xs">สินค้า</TableHead>
                  <TableHead className="text-xs">หมวด</TableHead>
                  <TableHead className="text-xs">สาขา</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.outOfStock.slice(0, 30).map((d: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{d.productCode}</TableCell>
                    <TableCell className="text-xs">{d.productName}</TableCell>
                    <TableCell className="text-xs">{d.category}</TableCell>
                    <TableCell className="text-xs">{d.site}</TableCell>
                  </TableRow>
                ))}
                {data.outOfStock.length === 0 && (
                  <TableRow><TableCell colSpan={4}><EmptyState label="ไม่มีสินค้าหมด ✅" /></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      </div>

      <SectionCard title={`รายการล่าสุด (${formatNumber(data.recentTransactions.length)})`} icon={<History className="h-4 w-4" />} accent="#3b82f6">
        <div className="max-h-96 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="text-xs">ประเภท</TableHead>
                <TableHead className="text-xs">สินค้า</TableHead>
                <TableHead className="text-right text-xs">จำนวน</TableHead>
                <TableHead className="text-xs">ผู้ขอ</TableHead>
                <TableHead className="text-xs">เลขใบงาน</TableHead>
                <TableHead className="text-xs">วันที่</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recentTransactions.slice(0, 50).map((t: any, i: number) => (
                <TableRow key={i}>
                  <TableCell>
                    <Badge variant="outline" className={t.type === 'IN'
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : t.type === 'OUT'
                        ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300'
                        : 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}>
                      {t.typeLabel}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{t.productName}</TableCell>
                  <TableCell className="text-right text-xs">{t.quantity} {t.unit}</TableCell>
                  <TableCell className="text-xs">{t.requester}</TableCell>
                  <TableCell className="font-mono text-xs">{t.workOrderNo}</TableCell>
                  <TableCell className="text-xs">{formatDate(t.txnDate)}</TableCell>
                </TableRow>
              ))}
              {data.recentTransactions.length === 0 && (
                <TableRow><TableCell colSpan={6}><EmptyState label="ไม่มีรายการล่าสุด" /></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </SectionCard>
    </>
  )
}
