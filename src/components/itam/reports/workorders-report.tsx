'use client'

import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { VisibleResponsiveContainer } from '@/components/itam/visible-responsive-container'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Wrench, CheckCircle2, Star, Banknote, Activity, Users, Award,
} from 'lucide-react'
import {
  SummaryCard, SectionCard, EmptyState,
  STATUS_COLORS_WO, formatNumber, formatDate, chartStyles,
} from './shared'

export function WorkOrdersReport({ data, isDark }: { data: any; isDark: boolean }) {
  const s = data.summary
  const cs = chartStyles(isDark)
  return (
    <>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        <SummaryCard title="ใบงานทั้งหมด" value={formatNumber(s.total)} icon={<Wrench className="h-5 w-5" />} accent="#f97316" hint={`เดือน ${data.monthLabel}`} />
        <SummaryCard title="เสร็จแล้ว" value={formatNumber(s.completed)} icon={<CheckCircle2 className="h-5 w-5" />} accent="#10b981" hint={`${s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0}% ของทั้งหมด`} />
        <SummaryCard title="งาน 50 บาท" value={formatNumber(s.specialFeeCount)} icon={<Banknote className="h-5 w-5" />} accent="#a855f7" hint="งานพิเศษมีค่าใช้จ่าย" />
        <SummaryCard title="คะแนนเฉลี่ย" value={s.avgRating !== null ? s.avgRating.toFixed(2) : '—'} icon={<Star className="h-5 w-5" />} accent="#f59e0b" hint={`จาก ${s.reviewCount} รีวิว`} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SectionCard title="สถานะใบงาน" icon={<Activity className="h-4 w-4" />} accent="#f97316">
          <div className="h-64 w-full">
            <VisibleResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                  label={(e: any) => `${e.name}: ${e.value}`} labelLine={false}>
                  {data.byStatus.map((entry: any, i: number) => (
                    <Cell key={i} fill={STATUS_COLORS_WO[entry.raw] ?? '#94a3b8'} />
                  ))}
                </Pie>
                <Tooltip contentStyle={cs.tooltipStyle} />
              </PieChart>
            </VisibleResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="การกระจายคะแนนรีวิว" icon={<Star className="h-4 w-4" />} accent="#f59e0b">
          <div className="h-64 w-full">
            <VisibleResponsiveContainer width="100%" height="100%">
              <BarChart data={data.ratingBuckets} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={cs.gridColor} />
                <XAxis dataKey="star" tick={{ fill: cs.textColor, fontSize: 12 }} tickFormatter={(v) => `${v} ⭐`} />
                <YAxis tick={{ fill: cs.textColor, fontSize: 12 }} allowDecimals={false} />
                <Tooltip cursor={{ fill: cs.cursorFill }} contentStyle={cs.tooltipStyle} />
                <Bar dataKey="count" name="จำนวน" radius={[6, 6, 0, 0]} fill="#f59e0b" />
              </BarChart>
            </VisibleResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SectionCard title="ประวัติช่าง" icon={<Users className="h-4 w-4" />} accent="#0d9488">
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="text-xs">ช่าง</TableHead>
                  <TableHead className="text-right text-xs">รับ</TableHead>
                  <TableHead className="text-right text-xs">เสร็จ</TableHead>
                  <TableHead className="text-right text-xs">%</TableHead>
                  <TableHead className="text-right text-xs">คะแนน</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byStaff.slice(0, 20).map((s: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">{s.name}</TableCell>
                    <TableCell className="text-right text-xs">{s.count}</TableCell>
                    <TableCell className="text-right text-xs text-emerald-600">{s.completed}</TableCell>
                    <TableCell className="text-right text-xs">{s.count > 0 ? Math.round((s.completed / s.count) * 100) : 0}%</TableCell>
                    <TableCell className="text-right text-xs">
                      {s.avgRating !== null ? (
                        <span className="flex items-center justify-end gap-0.5">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                          {s.avgRating}
                        </span>
                      ) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
                {data.byStaff.length === 0 && (
                  <TableRow><TableCell colSpan={5}><EmptyState label="ไม่มีข้อมูลช่าง" /></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>

        <SectionCard title="หัวข้อยอดนิยม (Top 15)" icon={<Award className="h-4 w-4" />} accent="#a855f7">
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="text-xs">#</TableHead>
                  <TableHead className="text-xs">หัวข้อ</TableHead>
                  <TableHead className="text-right text-xs">จำนวน</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.bySubject.map((s: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="text-xs font-medium">{s.subject}</TableCell>
                    <TableCell className="text-right"><Badge variant="secondary" className="text-xs">{s.count}</Badge></TableCell>
                  </TableRow>
                ))}
                {data.bySubject.length === 0 && (
                  <TableRow><TableCell colSpan={3}><EmptyState label="ไม่มีข้อมูลหัวข้อ" /></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      </div>

      <SectionCard title={`งานพิเศษ / 50 บาท (${formatNumber(s.specialFeeCount)} เคส)`} icon={<Banknote className="h-4 w-4" />} accent="#a855f7">
        <div className="max-h-80 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="text-xs">เลขใบงาน</TableHead>
                <TableHead className="text-xs">หัวข้อ</TableHead>
                <TableHead className="text-xs">ช่าง</TableHead>
                <TableHead className="text-xs">สถานะ</TableHead>
                <TableHead className="text-xs">วันที่</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.specialFeeCases.slice(0, 50).map((w: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{w.woNumber ?? '-'}</TableCell>
                  <TableCell className="text-xs">{w.subject}</TableCell>
                  <TableCell className="text-xs">{w.assignedTo}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs"
                      style={{ borderColor: STATUS_COLORS_WO[w.status] ?? '#94a3b8', color: STATUS_COLORS_WO[w.status] ?? '#94a3b8' }}>
                      {w.statusLabel}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{formatDate(w.createdAt)}</TableCell>
                </TableRow>
              ))}
              {data.specialFeeCases.length === 0 && (
                <TableRow><TableCell colSpan={5}><EmptyState label="ไม่มีงานพิเศษในเดือนนี้" /></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </SectionCard>
    </>
  )
}
