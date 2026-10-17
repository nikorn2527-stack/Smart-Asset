'use client'

import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { VisibleResponsiveContainer } from '@/components/itam/visible-responsive-container'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Cpu, CheckCircle2, AlertTriangle, XCircle, Activity, Layers, Building2, DollarSign, Gauge,
} from 'lucide-react'
import {
  SummaryCard, SectionCard, EmptyState,
  STATUS_COLORS_DEV, formatNumber, formatBaht, formatDate, chartStyles,
} from './shared'

export function DevicesReport({ data, isDark }: { data: any; isDark: boolean }) {
  const s = data.summary
  const cs = chartStyles(isDark)
  return (
    <>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        <SummaryCard title="อุปกรณ์ทั้งหมด" value={formatNumber(s.total)} icon={<Cpu className="h-5 w-5" />} accent="#f97316" hint="ในระบบ" />
        <SummaryCard title="ใช้งานอยู่" value={formatNumber(s.active)} icon={<CheckCircle2 className="h-5 w-5" />} accent="#10b981" hint={`${s.total > 0 ? Math.round((s.active / s.total) * 100) : 0}% ของทั้งหมด`} />
        <SummaryCard title="ประกันใกล้หมด" value={formatNumber(s.warrantyExpiringCount)} icon={<AlertTriangle className="h-5 w-5" />} accent="#f59e0b" hint="ภายใน 90 วัน" />
        <SummaryCard title="ประกันหมดแล้ว" value={formatNumber(s.warrantyExpiredCount)} icon={<XCircle className="h-5 w-5" />} accent="#ef4444" hint="หมดอายุแล้ว" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SectionCard title="สัดส่วนตามสถานะ" icon={<Activity className="h-4 w-4" />} accent="#f97316">
          <div className="h-64 w-full">
            <VisibleResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                  label={(e: any) => `${e.name}: ${e.value}`} labelLine={false}>
                  {data.byStatus.map((entry: any, i: number) => (
                    <Cell key={i} fill={STATUS_COLORS_DEV[entry.raw] ?? '#94a3b8'} />
                  ))}
                </Pie>
                <Tooltip contentStyle={cs.tooltipStyle} />
              </PieChart>
            </VisibleResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="จำนวนตามประเภท" icon={<Layers className="h-4 w-4" />} accent="#0d9488">
          <div className="h-64 w-full">
            <VisibleResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byType} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={cs.gridColor} />
                <XAxis dataKey="name" tick={{ fill: cs.textColor, fontSize: 11 }} />
                <YAxis tick={{ fill: cs.textColor, fontSize: 12 }} allowDecimals={false} />
                <Tooltip cursor={{ fill: cs.cursorFill }} contentStyle={cs.tooltipStyle} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="#0d9488" />
              </BarChart>
            </VisibleResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <SectionCard title="กระจายตามสาขา" icon={<Building2 className="h-4 w-4" />} accent="#f97316">
          <div className="space-y-2">
            {data.bySite.slice(0, 8).map((site: any, i: number) => {
              const max = data.bySite[0]?.value || 1
              const pct = (site.value / max) * 100
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{site.name}</span>
                    <span className="text-muted-foreground">{formatNumber(site.value)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-orange-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
            {data.bySite.length === 0 && <EmptyState label="ไม่มีข้อมูลสาขา" />}
          </div>
        </SectionCard>

        <SectionCard title="มูลค่าและค่าเสื่อม" icon={<DollarSign className="h-4 w-4" />} accent="#10b981">
          <div className="space-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">มูลค่ารับซื้อรวม</div>
              <div className="text-lg font-bold text-foreground">{formatBaht(s.totalPurchaseValue)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">ค่าเสื่อมสะสม</div>
              <div className="text-lg font-bold text-amber-600">{formatBaht(s.totalAccumDepreciation)}</div>
            </div>
            <div className="border-t pt-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">มูลค่าตามบัญชี (Book Value)</div>
              <div className="text-lg font-bold text-emerald-600">{formatBaht(s.totalBookValue)}</div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="สถานะรวบรัด" icon={<Gauge className="h-4 w-4" />} accent="#a855f7">
          <div className="space-y-2 text-xs">
            {data.byStatus.map((st: any, i: number) => (
              <div key={i} className="flex items-center justify-between rounded-md border px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLORS_DEV[st.raw] ?? '#94a3b8' }} />
                  <span className="font-medium">{st.name}</span>
                </div>
                <span className="font-bold">{formatNumber(st.value)}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="ประกันใกล้หมด (90 วัน)" icon={<AlertTriangle className="h-4 w-4" />} accent="#f59e0b">
        <div className="max-h-80 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="text-xs">รหัส</TableHead>
                <TableHead className="text-xs">ชื่อ</TableHead>
                <TableHead className="text-xs">สาขา</TableHead>
                <TableHead className="text-xs">หมดอายุ</TableHead>
                <TableHead className="text-right text-xs">เหลือ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.warrantyExpiringSoon.map((d: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{d.assetCode}</TableCell>
                  <TableCell className="text-xs">{d.name}</TableCell>
                  <TableCell className="text-xs">{d.site}</TableCell>
                  <TableCell className="text-xs">{formatDate(d.warrantyEnd)}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={d.daysLeft <= 30 ? 'destructive' : 'secondary'} className="text-xs">
                      {d.daysLeft} วัน
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {data.warrantyExpiringSoon.length === 0 && (
                <TableRow><TableCell colSpan={5}><EmptyState label="ไม่มีประกันใกล้หมดอายุ" /></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </SectionCard>
    </>
  )
}
