'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { ArrowUp, ArrowDown, Minus, TrendingUp, Activity, Inbox, Download } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { DashboardRangeKey } from './types'
import { DASHBOARD_RANGE_OPTIONS } from './types'
import { useAuthStore } from '@/store/auth-store'
import { useLang } from '@/store/i18n-store'
import { downloadCsv, dateStamp } from '@/lib/csv'
import { bearerHeaders } from '@/lib/http-headers'

interface MonthlyReading {
  month: string // YYYY-MM
  sheets: number
}
interface UtilizationDevice {
  deviceId: string
  assetCode: string
  name: string
  brand: string
  model: string
  site: string
  monthlyReadings: MonthlyReading[]
  totalSheets: number
  avgPerMonth: number
  maxMonth: { month: string; sheets: number } | null
  minMonth: { month: string; sheets: number } | null
  utilizationScore: number
  trend: 'up' | 'down' | 'stable'
}
interface UtilizationData {
  devices: UtilizationDevice[]
  summary: {
    avgUtilization: number
    topDevice: UtilizationDevice | null
    lowDevice: UtilizationDevice | null
  }
  months: string[]
}

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
]

function formatMonthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-')
  const idx = Number(m) - 1
  if (idx < 0 || idx > 11) return yyyymm
  return `${THAI_MONTHS_SHORT[idx]} ${y.slice(2)}`
}

/** Map a 0..1 intensity to a teal-shaded cell color, with separate
 * shades for light and dark modes via the `dark:` CSS var. We return
 * an inline-style bg based on teal with opacity. */
function cellColor(sheets: number, max: number): { background: string; border: string } {
  if (sheets <= 0 || max <= 0) {
    return {
      background: 'transparent',
      border: '1px dashed rgba(148,163,184,0.35)',
    }
  }
  const t = Math.min(1, sheets / max)
  // teal: #14b8a6 base; opacity grows with intensity
  const opacity = 0.12 + t * 0.78
  return {
    background: `rgba(20, 184, 166, ${opacity.toFixed(3)})`,
    border: '1px solid rgba(20, 184, 166, 0.35)',
  }
}

function TrendBadge({ trend }: { trend: UtilizationDevice['trend'] }) {
  if (trend === 'up') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
        <ArrowUp className="h-3 w-3" /> ขึ้น
      </span>
    )
  }
  if (trend === 'down') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
        <ArrowDown className="h-3 w-3" /> ลง
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
      <Minus className="h-3 w-3" /> คงที่
    </span>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400 dark:text-slate-500">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
        <Inbox className="h-6 w-6 text-slate-300 dark:text-slate-400" />
      </div>
      <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">{message}</div>
    </div>
  )
}

export interface UtilizationSectionProps {
  range: DashboardRangeKey
  onRangeChange: (r: DashboardRangeKey) => void
}

export function UtilizationSection({
  range,
  onRangeChange,
}: UtilizationSectionProps) {
  const { data, isLoading } = useQuery<UtilizationData>({
    queryKey: ['devices-utilization', range],
    queryFn: async () => {
      const res = await fetch(`/api/devices/utilization?range=${range}`, {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) throw new Error('Failed to load utilization')
      return res.json()
    },
  })

  const devices = data?.devices ?? []
  const months = data?.months ?? []
  const summary = data?.summary

  // Compute the max sheet value across all monthly cells for color normalization
  const { lang } = useLang()
  const maxCell = React.useMemo(() => {
    let m = 0
    for (const d of devices) {
      for (const r of d.monthlyReadings) {
        if (r.sheets > m) m = r.sheets
      }
    }
    return m
  }, [devices])

  const top5 = React.useMemo(
    () => [...devices].sort((a, b) => b.utilizationScore - a.utilizationScore).slice(0, 5),
    [devices],
  )
  const low5 = React.useMemo(() => {
    // Devices with the lowest non-zero utilization, else by lowest score
    return [...devices]
      .filter((d) => d.totalSheets > 0)
      .sort((a, b) => a.utilizationScore - b.utilizationScore)
      .slice(0, 5)
  }, [devices])

  /** Export the current heatmap matrix (device × months + totals) as CSV.
   * Mirrors the export pattern used by the ranking/compare3 tabs. */
  function exportCsv() {
    if (devices.length === 0) {
      toast.info('ยังไม่มีข้อมูลให้ส่งออก')
      return
    }
    const trendLabel: Record<UtilizationDevice['trend'], string> = {
      up: 'ขึ้น', down: 'ลง', stable: 'คงที่',
    }
    const rows = devices.map((d) => {
      const row: Record<string, unknown> = {
        assetCode: d.assetCode,
        device: d.name,
        brand: d.brand,
        model: d.model,
        site: d.site,
      }
      for (const m of d.monthlyReadings) {
        row[formatMonthLabel(m.month)] = m.sheets
      }
      row['รวม (แผ่น)'] = d.totalSheets
      row['เฉลี่ย/เดือน'] = d.avgPerMonth
      row['คะแนน'] = d.utilizationScore
      row['แนวโน้ม'] = trendLabel[d.trend]
      return row
    })
    const rangeLabel = DASHBOARD_RANGE_OPTIONS.find((o) => o.value === range)?.label ?? range
    downloadCsv(`utilization-${rangeLabel}-${dateStamp()}.csv`, rows)
    toast.success(`ส่งออก ${rows.length} อุปกรณ์เรียบร้อย`)
  }

  return (
    <Card className="border-teal-200/60 dark:border-teal-800/40 dark:bg-slate-900">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base text-slate-800 dark:text-slate-100">
          <Activity className="h-4 w-4 text-[#14b8a6]" />
          📈 การใช้งานอุปกรณ์ (Utilization)
          <span className="ml-1 text-xs font-normal text-slate-400 dark:text-slate-500">
            Heatmap รายเดือน · Trend · Top/Low
          </span>
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={(v) => onRangeChange(v as DashboardRangeKey)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="ช่วงเวลา" />
            </SelectTrigger>
            <SelectContent>
              {DASHBOARD_RANGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={isLoading || devices.length === 0}
            title="ส่งออกข้อมูลการใช้งานเป็น CSV (device × month matrix)"
            className="gap-1 whitespace-nowrap dark:bg-slate-800 dark:border-slate-700"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary KPIs */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="text-xs text-slate-500 dark:text-slate-400">คะแนนเฉลี่ย</div>
            {isLoading ? (
              <Skeleton className="mt-1 h-6 w-16 dark:bg-slate-800" />
            ) : (
              <div className="text-lg font-bold text-slate-800 dark:text-slate-100">
                {summary?.avgUtilization ?? 0}
                <span className="ml-0.5 text-xs font-normal text-slate-400">/100</span>
              </div>
            )}
          </div>
          <div className="rounded-md border border-teal-200 bg-teal-50/70 p-3 dark:border-teal-800 dark:bg-teal-950/30">
            <div className="flex items-center gap-1 text-xs text-teal-700 dark:text-teal-300">
              <TrendingUp className="h-3 w-3" /> ใช้งานสูงสุด
            </div>
            {isLoading ? (
              <Skeleton className="mt-1 h-6 w-32 dark:bg-slate-800" />
            ) : summary?.topDevice ? (
              <div className="mt-0.5 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                {summary.topDevice.assetCode}
                <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">
                  · {summary.topDevice.totalSheets.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น
                </span>
              </div>
            ) : (
              <div className="mt-0.5 text-sm text-slate-400">—</div>
            )}
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            <div className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
              <ArrowDown className="h-3 w-3" /> ใช้งานต่ำสุด
            </div>
            {isLoading ? (
              <Skeleton className="mt-1 h-6 w-32 dark:bg-slate-800" />
            ) : summary?.lowDevice ? (
              <div className="mt-0.5 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                {summary.lowDevice.assetCode}
                <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">
                  · {summary.lowDevice.totalSheets.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น
                </span>
              </div>
            ) : (
              <div className="mt-0.5 text-sm text-slate-400">—</div>
            )}
          </div>
        </div>

        {/* Heatmap */}
        {isLoading ? (
          <Skeleton className="h-72 w-full dark:bg-slate-800" />
        ) : devices.length === 0 ? (
          <EmptyState message="ยังไม่มีข้อมูลการใช้งาน" />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-slate-600 dark:text-slate-300">
                Heatmap การใช้งานรายเดือน
              </div>
              {/* Legend */}
              <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                <span>ต่ำ</span>
                <div
                  className="h-3 w-20 rounded-sm border border-slate-200 dark:border-slate-700"
                  style={{
                    background:
                      'linear-gradient(to right, rgba(20,184,166,0.12), rgba(20,184,166,0.9))',
                  }}
                />
                <span>สูง</span>
              </div>
            </div>
            <div className="itam-scroll overflow-x-auto">
              <div className="min-w-[640px]">
                {/* Header row */}
                <div
                  className="grid gap-1"
                  style={{
                    gridTemplateColumns: `minmax(180px, 1fr) repeat(${months.length}, minmax(72px, 1fr)) 84px`,
                  }}
                >
                  <div className="px-2 py-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    อุปกรณ์
                  </div>
                  {months.map((m) => (
                    <div
                      key={m}
                      className="px-1 py-1 text-center text-[10px] font-medium text-slate-500 dark:text-slate-400"
                    >
                      {formatMonthLabel(m)}
                    </div>
                  ))}
                  <div className="px-2 py-1 text-right text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    รวม
                  </div>
                </div>
                {/* Rows */}
                <div className="space-y-1">
                  {devices.map((d) => (
                    <div
                      key={d.deviceId}
                      className="grid items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      style={{
                        gridTemplateColumns: `minmax(180px, 1fr) repeat(${months.length}, minmax(72px, 1fr)) 84px`,
                      }}
                    >
                      <div className="min-w-0 px-2">
                        <div className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                          {d.assetCode}
                        </div>
                        <div className="truncate text-[10px] text-slate-400 dark:text-slate-500">
                          {d.site} · {d.brand} {d.model}
                        </div>
                      </div>
                      {d.monthlyReadings.map((r) => {
                        const c = cellColor(r.sheets, maxCell)
                        return (
                          <div
                            key={r.month}
                            title={`${d.assetCode} · ${formatMonthLabel(r.month)}\n${r.sheets.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น`}
                            className="mx-auto h-9 w-full max-w-[88px] rounded-md transition-colors"
                            style={{
                              background: c.background,
                              border: c.border,
                            }}
                          >
                            {r.sheets > 0 ? (
                              <div className="flex h-full items-center justify-center text-[10px] font-medium tabular-nums text-slate-700 dark:text-slate-100">
                                {r.sheets >= 1000
                                  ? `${(r.sheets / 1000).toFixed(1)}k`
                                  : r.sheets}
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                      <div className="px-2 text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                        {d.totalSheets.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Top 5 + Low 5 */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Top 5 */}
          <div className="rounded-md border border-teal-200 bg-teal-50/40 p-3 dark:border-teal-800 dark:bg-teal-950/20">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
              <TrendingUp className="h-4 w-4 text-[#14b8a6]" />
              TOP 5 การใช้งานสูง
            </div>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={`t-${i}`} className="h-8 w-full dark:bg-slate-800" />
                ))}
              </div>
            ) : top5.length === 0 ? (
              <EmptyState message="ยังไม่มีข้อมูล" />
            ) : (
              <ol className="space-y-1.5">
                {top5.map((d, i) => (
                  <li
                    key={d.deviceId}
                    className="flex items-center gap-2 rounded-md bg-white/70 px-2 py-1.5 dark:bg-slate-800/40"
                  >
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[10px] font-bold text-teal-700 dark:bg-teal-900 dark:text-teal-300">
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                          {d.assetCode}
                        </span>
                        <TrendBadge trend={d.trend} />
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-teal-400 to-teal-600"
                          style={{ width: `${Math.max(4, d.utilizationScore)}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                        {d.totalSheets.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                      </div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500">
                        {d.utilizationScore}/100
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Low 5 */}
          <div className="rounded-md border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-800 dark:bg-amber-950/20">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
              <ArrowDown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              5 การใช้งานต่ำ (แคนดิเดตย้ายเครื่อง)
            </div>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={`l-${i}`} className="h-8 w-full dark:bg-slate-800" />
                ))}
              </div>
            ) : low5.length === 0 ? (
              <EmptyState message="ยังไม่มีข้อมูล" />
            ) : (
              <ol className="space-y-1.5">
                {low5.map((d, i) => (
                  <li
                    key={d.deviceId}
                    className="flex items-center gap-2 rounded-md bg-white/70 px-2 py-1.5 dark:bg-slate-800/40"
                  >
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                          {d.assetCode}
                        </span>
                        <TrendBadge trend={d.trend} />
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500"
                          style={{ width: `${Math.max(4, d.utilizationScore)}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                        {d.totalSheets.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                      </div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500">
                        {d.utilizationScore}/100
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        <div className="text-xs text-slate-400 dark:text-slate-500">
          คะแนนคำนวณจาก <span className="font-medium">{`totalSheets / maxTotalSheets × 100`}</span>{' '}
          ในช่วงที่เลือก · เซลล์เข้ม = ใช้งานสูง · Trend เปรียบเทียบ 2 เดือนสุดท้าย
        </div>
      </CardContent>
    </Card>
  )
}
