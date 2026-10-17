'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { VisibleResponsiveContainer } from '@/components/itam/visible-responsive-container'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  FileText, DollarSign, Gauge, AlertTriangle, TrendingUp, Building2, Users,
} from 'lucide-react'
import {
  SummaryCard, SectionCard, EmptyState,
  formatNumber, formatBaht, chartStyles,
} from './shared'

export function MetersReport({ data, isDark }: { data: any; isDark: boolean }) {
  const s = data.summary
  const cs = chartStyles(isDark)
  return (
    <>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        <SummaryCard title="กระดาษรวม" value={formatNumber(s.totalSheets)} icon={<FileText className="h-5 w-5" />} accent="#0d9488" hint={`ขาวดำ ${formatNumber(s.totalBw)} + สี ${formatNumber(s.totalColor)}`} />
        <SummaryCard title="ค่าใช้จ่ายรวม" value={formatBaht(s.totalCost)} icon={<DollarSign className="h-5 w-5" />} accent="#f97316" hint={`อัตรา BW ฿${data.rates?.avgBwRate ?? data.rates?.bwRate ?? 0} / สี ฿${data.rates?.avgColorRate ?? data.rates?.colorRate ?? 0}`} />
        <SummaryCard title="เครื่องที่ต้องจด" value={formatNumber(s.meterRequiredCount)} icon={<Gauge className="h-5 w-5" />} accent="#0d9488" hint={`จาก ${formatNumber(s.deviceCount)} เครื่อง`} />
        <SummaryCard title="ยังไม่จดมิเตอร์" value={formatNumber(s.unmeteredCount)} icon={<AlertTriangle className="h-5 w-5" />} accent="#ef4444" hint="ค้างจดในเดือนนี้" />
      </div>

      <SectionCard
        title="เปรียบเทียบรายเดือน"
        icon={<TrendingUp className="h-4 w-4" />}
        accent="#0d9488"
        action={
          s.growthPct !== 0 && (
            <Badge variant="outline" className={s.growthPct > 0
              ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300'
              : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'}>
              {s.growthPct > 0 ? '+' : ''}{s.growthPct}%
            </Badge>
          )
        }
      >
        <div className="h-64 w-full">
          <VisibleResponsiveContainer width="100%" height="100%">
            <BarChart data={data.monthlyComparison} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={cs.gridColor} />
              <XAxis dataKey="label" tick={{ fill: cs.textColor, fontSize: 12 }} />
              <YAxis tick={{ fill: cs.textColor, fontSize: 12 }} allowDecimals={false} />
              <Tooltip cursor={{ fill: cs.cursorFill }} contentStyle={cs.tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="bw" name="ขาวดำ" stackId="a" fill="#475569" />
              <Bar dataKey="color" name="สี" stackId="a" fill="#f97316" radius={[6, 6, 0, 0]} />
            </BarChart>
          </VisibleResponsiveContainer>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SectionCard title="ค่าใช้จ่ายต่อสาขา" icon={<Building2 className="h-4 w-4" />} accent="#f97316">
          <div className="h-64 w-full">
            <VisibleResponsiveContainer width="100%" height="100%">
              <BarChart data={data.costBySite} layout="vertical" margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={cs.gridColor} horizontal={false} />
                <XAxis type="number" tick={{ fill: cs.textColor, fontSize: 11 }} />
                <YAxis type="category" dataKey="site" tick={{ fill: cs.textColor, fontSize: 11 }} width={50} />
                <Tooltip cursor={{ fill: cs.cursorFill }} contentStyle={cs.tooltipStyle} formatter={(v: number) => formatBaht(v)} />
                <Bar dataKey="cost" name="ค่าใช้จ่าย" radius={[0, 6, 6, 0]} fill="#f97316" />
              </BarChart>
            </VisibleResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="ค่าใช้จ่ายต่อแผนก (Top 10)" icon={<Users className="h-4 w-4" />} accent="#a855f7">
          <div className="max-h-64 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="text-xs">แผนก</TableHead>
                  <TableHead className="text-right text-xs">ขาวดำ</TableHead>
                  <TableHead className="text-right text-xs">สี</TableHead>
                  <TableHead className="text-right text-xs">รวม</TableHead>
                  <TableHead className="text-right text-xs">ค่าใช้จ่าย</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.costByDepartment.slice(0, 10).map((d: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">{d.department}</TableCell>
                    <TableCell className="text-right text-xs">{formatNumber(d.bw)}</TableCell>
                    <TableCell className="text-right text-xs">{formatNumber(d.color)}</TableCell>
                    <TableCell className="text-right text-xs">{formatNumber(d.total)}</TableCell>
                    <TableCell className="text-right text-xs font-semibold text-orange-600">{formatBaht(d.cost)}</TableCell>
                  </TableRow>
                ))}
                {data.costByDepartment.length === 0 && (
                  <TableRow><TableCell colSpan={5}><EmptyState label="ไม่มีข้อมูลการใช้กระดาษ" /></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      </div>

      <SectionCard title={`อุปกรณ์ที่ยังไม่จดมิเตอร์ (${formatNumber(data.unmeteredDevices.length)})`} icon={<AlertTriangle className="h-4 w-4" />} accent="#ef4444">
        <div className="max-h-80 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="text-xs">รหัส</TableHead>
                <TableHead className="text-xs">ชื่อ</TableHead>
                <TableHead className="text-xs">สาขา</TableHead>
                <TableHead className="text-xs">แผนก</TableHead>
                <TableHead className="text-right text-xs">มิเตอร์ล่าสุด BW</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.unmeteredDevices.slice(0, 30).map((d: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{d.assetCode}</TableCell>
                  <TableCell className="text-xs">{d.name}</TableCell>
                  <TableCell className="text-xs">{d.site}</TableCell>
                  <TableCell className="text-xs">{d.department}</TableCell>
                  <TableCell className="text-right text-xs">{formatNumber(d.lastMeterBw)}</TableCell>
                </TableRow>
              ))}
              {data.unmeteredDevices.length === 0 && (
                <TableRow><TableCell colSpan={5}><EmptyState label="ครบทุกเครื่องแล้ว 🎉" /></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </SectionCard>
    </>
  )
}
