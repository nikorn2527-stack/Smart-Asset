'use client'

import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Clock, CheckCheck, XCircle, Banknote, Package, Wrench, History,
} from 'lucide-react'
import {
  SummaryCard, SectionCard, EmptyState,
  STATUS_COLORS_WO, formatNumber, formatDate, relativeTime,
} from './shared'

export function ApprovalsReport({ data }: { data: any }) {
  const s = data.summary
  return (
    <>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        <SummaryCard title="รออนุมัติทั้งหมด" value={formatNumber(s.totalPending)} icon={<Clock className="h-5 w-5" />} accent="#f59e0b" hint="สต็อก + ใบงาน + งานพิเศษ" />
        <SummaryCard title="อนุมัติแล้ว" value={formatNumber(s.approvedCount)} icon={<CheckCheck className="h-5 w-5" />} accent="#10b981" hint={`เดือน ${data.monthLabel}`} />
        <SummaryCard title="ไม่อนุมัติ" value={formatNumber(s.rejectedCount)} icon={<XCircle className="h-5 w-5" />} accent="#ef4444" hint={`เดือน ${data.monthLabel}`} />
        <SummaryCard title="งานพิเศษ" value={formatNumber(s.specialFeeCount)} icon={<Banknote className="h-5 w-5" />} accent="#a855f7" hint="50 บาท" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SectionCard title={`รออนุมัติสต็อก (${formatNumber(data.pendingStock.length)})`} icon={<Package className="h-4 w-4" />} accent="#f59e0b">
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="text-xs">เลข</TableHead>
                  <TableHead className="text-xs">สินค้า</TableHead>
                  <TableHead className="text-right text-xs">จำนวน</TableHead>
                  <TableHead className="text-xs">ผู้ขอ</TableHead>
                  <TableHead className="text-xs">รอแล้ว</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.pendingStock.slice(0, 30).map((t: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{t.txnNumber}</TableCell>
                    <TableCell className="text-xs">{t.productName}</TableCell>
                    <TableCell className="text-right text-xs">{t.quantity} {t.unit}</TableCell>
                    <TableCell className="text-xs">{t.requester}</TableCell>
                    <TableCell className="text-xs text-amber-600">{relativeTime(t.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {data.pendingStock.length === 0 && (
                  <TableRow><TableCell colSpan={5}><EmptyState label="ไม่มีรายการรออนุมัติ ✅" /></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>

        <SectionCard title={`ใบงานรอดำเนินการ (${formatNumber(data.pendingWO.length)})`} icon={<Wrench className="h-4 w-4" />} accent="#3b82f6">
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="text-xs">เลขใบงาน</TableHead>
                  <TableHead className="text-xs">หัวข้อ</TableHead>
                  <TableHead className="text-xs">สถานะ</TableHead>
                  <TableHead className="text-xs">ช่าง</TableHead>
                  <TableHead className="text-xs">รอแล้ว</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.pendingWO.slice(0, 30).map((w: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{w.woNumber}</TableCell>
                    <TableCell className="text-xs">{w.subject}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs"
                        style={{ borderColor: STATUS_COLORS_WO[w.status] ?? '#94a3b8', color: STATUS_COLORS_WO[w.status] ?? '#94a3b8' }}>
                        {w.statusLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{w.assignedTo}</TableCell>
                    <TableCell className="text-xs text-amber-600">{relativeTime(w.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {data.pendingWO.length === 0 && (
                  <TableRow><TableCell colSpan={5}><EmptyState label="ไม่มีใบงานรอดำเนินการ ✅" /></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SectionCard title={`งานพิเศษเดือนนี้ (${formatNumber(data.specialFeeCases.length)})`} icon={<Banknote className="h-4 w-4" />} accent="#a855f7">
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="text-xs">เลขใบงาน</TableHead>
                  <TableHead className="text-xs">หัวข้อ</TableHead>
                  <TableHead className="text-xs">ช่าง</TableHead>
                  <TableHead className="text-xs">สถานะ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.specialFeeCases.slice(0, 30).map((w: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{w.woNumber}</TableCell>
                    <TableCell className="text-xs">{w.subject}</TableCell>
                    <TableCell className="text-xs">{w.assignedTo}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs"
                        style={{ borderColor: STATUS_COLORS_WO[w.status] ?? '#94a3b8', color: STATUS_COLORS_WO[w.status] ?? '#94a3b8' }}>
                        {w.statusLabel}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {data.specialFeeCases.length === 0 && (
                  <TableRow><TableCell colSpan={4}><EmptyState label="ไม่มีงานพิเศษในเดือนนี้" /></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>

        <SectionCard title={`ประวัติการอนุมัติ (${formatNumber(data.approvalHistory.length)})`} icon={<History className="h-4 w-4" />} accent="#0d9488">
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="text-xs">การกระทำ</TableHead>
                  <TableHead className="text-xs">รายละเอียด</TableHead>
                  <TableHead className="text-xs">ผู้ทำ</TableHead>
                  <TableHead className="text-xs">เมื่อ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.approvalHistory.slice(0, 30).map((l: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Badge variant="outline" className={l.action === 'APPROVE'
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : l.action === 'REJECT'
                          ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300'
                          : 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}>
                        {l.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{l.summary}</TableCell>
                    <TableCell className="text-xs">{l.actor}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{relativeTime(l.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {data.approvalHistory.length === 0 && (
                  <TableRow><TableCell colSpan={4}><EmptyState label="ไม่มีประวัติการอนุมัติ" /></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      </div>

      <SectionCard title={`การอนุมัติเดือนนี้ (${formatNumber(data.approvedTransactions.length)})`} icon={<CheckCheck className="h-4 w-4" />} accent="#10b981">
        <div className="max-h-80 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="text-xs">สถานะ</TableHead>
                <TableHead className="text-xs">เลข</TableHead>
                <TableHead className="text-xs">สินค้า</TableHead>
                <TableHead className="text-right text-xs">จำนวน</TableHead>
                <TableHead className="text-xs">ผู้อนุมัติ</TableHead>
                <TableHead className="text-xs">วันที่</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.approvedTransactions.slice(0, 30).map((t: any, i: number) => (
                <TableRow key={i}>
                  <TableCell>
                    <Badge variant="outline" className={t.approvalStatus === 'APPROVED'
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300'}>
                      {t.approvalStatus === 'APPROVED' ? 'อนุมัติ' : 'ไม่อนุมัติ'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{t.txnNumber}</TableCell>
                  <TableCell className="text-xs">{t.productName}</TableCell>
                  <TableCell className="text-right text-xs">{t.quantity}</TableCell>
                  <TableCell className="text-xs">{t.approver}</TableCell>
                  <TableCell className="text-xs">{formatDate(t.approvedAt)}</TableCell>
                </TableRow>
              ))}
              {data.approvedTransactions.length === 0 && (
                <TableRow><TableCell colSpan={6}><EmptyState label="ไม่มีการอนุมัติในเดือนนี้" /></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </SectionCard>
    </>
  )
}
