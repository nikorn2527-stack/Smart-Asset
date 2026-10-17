'use client'

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { VisibleResponsiveContainer } from '@/components/itam/visible-responsive-container'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Activity, DollarSign, CalendarDays, Clock, TrendingUp, Building2, Award,
} from 'lucide-react'
import {
  SummaryCard, SectionCard, EmptyState,
  formatNumber, formatBaht, formatDate, chartStyles,
} from './shared'

export function MaintenanceReport({ data, isDark }: { data: any; isDark: boolean }) {
  const s = data.summary
  const cs = chartStyles(isDark)
  return (
    <>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        <SummaryCard title="งานซ่อมทั้งหมด" value={formatNumber(s.totalLogs)} icon={<Activity className="h-5 w-5" />} accent="#f97316" hint="ตลอดกาล" />
        <SummaryCard title="ค่าซ่อมรวม" value={formatBaht(s.totalCost)} icon={<DollarSign className="h-5 w-5" />} accent="#10b981" hint={`เฉลี่ย ${formatBaht(s.avgCostPerRepair)}/ครั้ง`} />
        <SummaryCard title="ค่าซ่อมเดือนนี้" value={formatBaht(s.currentMonthCost)} icon={<CalendarDays className="h-5 w-5" />} accent="#3b82f6" hint={data.monthLabel} />
        <SummaryCard title="เปิดอยู่" value={formatNumber(s.openCount)} icon={<Clock className="h-5 w-5" />} accent="#f59e0b" hint={`เสร็จแล้ว ${formatNumber(s.completedCount)}`} />
      </div>

      <SectionCard title="ค่าซ่อม 6 เดือนล่าสุด" icon={<TrendingUp className="h-4 w-4" />} accent="#10b981">
        <div className="h-64 w-full">
          <VisibleResponsiveContainer width="100%" height="100%">
            <LineChart data={data.costByMonth} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={cs.gridColor} />
              <XAxis dataKey="label" tick={{ fill: cs.textColor, fontSize: 11 }} />
              <YAxis tick={{ fill: cs.textColor, fontSize: 12 }} />
              <Tooltip contentStyle={cs.tooltipStyle} formatter={(v: number) => formatBaht(v)} />
              <Line type="monotone" dataKey="cost" name="ค่าซ่อม" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', r: 4 }} />
            </LineChart>
          </VisibleResponsiveContainer>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SectionCard title="ค่าซ่อมต่อสาขา" icon={<Building2 className="h-4 w-4" />} accent="#f97316">
          <div className="max-h-64 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="text-xs">สาขา</TableHead>
                  <TableHead className="text-right text-xs">จำนวนครั้ง</TableHead>
                  <TableHead className="text-right text-xs">ค่าซ่อมรวม</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.costBySite.map((d: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">{d.site}</TableCell>
                    <TableCell className="text-right text-xs">{formatNumber(d.count)}</TableCell>
                    <TableCell className="text-right text-xs font-semibold text-orange-600">{formatBaht(d.cost)}</TableCell>
                  </TableRow>
                ))}
                {data.costBySite.length === 0 && (
                  <TableRow><TableCell colSpan={3}><EmptyState label="ไม่มีข้อมูล" /></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>

        <SectionCard title="อะไหล่ยอดนิยม (Top 10)" icon={<Award className="h-4 w-4" />} accent="#a855f7">
          <div className="max-h-64 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="text-xs">#</TableHead>
                  <TableHead className="text-xs">รหัส</TableHead>
                  <TableHead className="text-xs">ชื่อ</TableHead>
                  <TableHead className="text-right text-xs">เบิก</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.topParts.map((p: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{p.productCode}</TableCell>
                    <TableCell className="text-xs">{p.productName}</TableCell>
                    <TableCell className="text-right"><Badge variant="secondary" className="text-xs">{formatNumber(p.quantity)}</Badge></TableCell>
                  </TableRow>
                ))}
                {data.topParts.length === 0 && (
                  <TableRow><TableCell colSpan={4}><EmptyState label="ไม่มีข้อมูล" /></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="ประวัติซ่อมต่อเครื่อง (Top 50)" icon={<Activity className="h-4 w-4" />} accent="#f97316">
        <div className="max-h-96 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="text-xs">รหัส</TableHead>
                <TableHead className="text-xs">ชื่อ</TableHead>
                <TableHead className="text-xs">สาขา</TableHead>
                <TableHead className="text-right text-xs">ซ่อมครั้ง</TableHead>
                <TableHead className="text-right text-xs">ค่าซ่อมรวม</TableHead>
                <TableHead className="text-xs">ซ่อมล่าสุด</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byDevice.slice(0, 50).map((d: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{d.assetCode}</TableCell>
                  <TableCell className="text-xs">{d.name}</TableCell>
                  <TableCell className="text-xs">{d.site}</TableCell>
                  <TableCell className="text-right"><Badge variant="outline" className="text-xs">{d.repairCount}</Badge></TableCell>
                  <TableCell className="text-right text-xs font-semibold text-orange-600">{formatBaht(d.totalCost)}</TableCell>
                  <TableCell className="text-xs">{formatDate(d.lastRepairDate)}</TableCell>
                </TableRow>
              ))}
              {data.byDevice.length === 0 && (
                <TableRow><TableCell colSpan={6}><EmptyState label="ไม่มีประวัติซ่อมบำรุง" /></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </SectionCard>
    </>
  )
}
