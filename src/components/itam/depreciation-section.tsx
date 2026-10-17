'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from 'recharts'
import { VisibleResponsiveContainer } from '@/components/itam/visible-responsive-container'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Coins, TrendingDown, Wallet, AlertOctagon } from 'lucide-react'
import type {
  DepreciationData,
  DepreciationStatus,
} from './types'
import {
  formatBaht,
  depreciationBadgeClass,
  depreciationLabel,
} from './types'
import { useAppStore } from '@/store/app-store'
import { useAuthStore } from '@/store/auth-store'
import { useT } from '@/store/i18n-store'
import { bearerHeaders } from '@/lib/http-headers'

interface MiniCardProps {
  label: string
  value: string
  icon: React.ReactNode
  accent: string
  loading?: boolean
}

function MiniCard({ label, value, icon, accent, loading }: MiniCardProps) {
  return (
    <Card className="group relative overflow-hidden shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: accent }}
      />
      <CardContent className="flex items-center gap-3 p-3 sm:p-4">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-105"
          style={{ background: `${accent}1a`, color: accent }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">
            {label}
          </div>
          {loading ? (
            <Skeleton className="mt-1 h-6 w-24 dark:bg-slate-800" />
          ) : (
            <div className="truncate text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100 sm:text-xl">
              {value}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/** Convert a 0-100 depreciation % to a teal→amber→rose gradient color. */
function progressColor(pct: number): string {
  // 0% = teal, 50% = amber, 100% = rose
  const stops = [
    { p: 0, c: [20, 184, 166] }, // teal-500 #14b8a6
    { p: 50, c: [245, 158, 11] }, // amber-500 #f59e0b
    { p: 100, c: [244, 63, 94] }, // rose-500 #f43f5e
  ]
  let lo = stops[0]
  let hi = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (pct >= stops[i].p && pct <= stops[i + 1].p) {
      lo = stops[i]
      hi = stops[i + 1]
      break
    }
  }
  const span = Math.max(1, hi.p - lo.p)
  const t = (pct - lo.p) / span
  const r = Math.round(lo.c[0] + (hi.c[0] - lo.c[0]) * t)
  const g = Math.round(lo.c[1] + (hi.c[1] - lo.c[1]) * t)
  const b = Math.round(lo.c[2] + (hi.c[2] - lo.c[2]) * t)
  return `rgb(${r}, ${g}, ${b})`
}

function formatShortBaht(v: number): string {
  if (Math.abs(v) >= 1_000_000) {
    return `฿${(v / 1_000_000).toFixed(2)}M`
  }
  if (Math.abs(v) >= 1_000) {
    return `฿${(v / 1_000).toFixed(1)}K`
  }
  return formatBaht(v)
}

export function DepreciationSection() {
  const { theme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const isDark = mounted && theme === 'dark'
  const gridStroke = isDark ? '#334155' : '#e2e8f0'
  const tooltipBorder = isDark ? '#334155' : '#e2e8f0'
  const tooltipBg = isDark ? '#0f172a' : '#ffffff'
  const tooltipFg = isDark ? '#e2e8f0' : '#1e293b'
  const axisTickColor = '#64748b'
  const t = useT()

  const setActivePage = useAppStore((s) => s.setActivePage)

  const { data, isLoading } = useQuery<DepreciationData>({
    queryKey: ['depreciation'],
    queryFn: async () => {
      const res = await fetch('/api/devices/depreciation', {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) throw new Error('Failed to fetch depreciation')
      return res.json()
    },
    staleTime: 60_000,
  })

  const devices = (data?.devices ?? []).slice(0, 8)
  const chartData = devices.map((d) => ({
    name: d.assetCode,
    full: `${d.assetCode} · ${d.name}`,
    currentValue: Math.round(d.currentValue),
    depreciation: Math.round(d.accumulatedDepreciation),
  }))

  const summary = data?.summary
  const hasData = (data?.devices ?? []).length > 0

  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-slate-800 dark:text-slate-100">
          <Coins className="h-4 w-4 text-[#f97316]" />
          {t('depreciation.title')}
          <span className="ml-2 text-xs font-normal text-slate-400 dark:text-slate-500">
            {t('depreciation.track_devices')} ({t('depreciation.method')})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 dark:bg-slate-800" />
              ))}
            </div>
            <Skeleton className="h-72 w-full dark:bg-slate-800" />
          </>
        ) : !hasData ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-slate-400 dark:text-slate-500">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
              <Coins className="h-6 w-6 text-slate-300 dark:text-slate-400" />
            </div>
            <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">
              {t('depreciation.empty')}
            </div>
            <div className="text-xs text-slate-400 dark:text-slate-500">
              {t('depreciation.empty_hint')}
            </div>
            <Button
              size="sm"
              className="mt-2 bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
              onClick={() => setActivePage('devices')}
            >
              {t('depreciation.view_devices')}
            </Button>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniCard
                label={t('depreciation.total_value')}
                value={formatBaht(summary?.totalValue ?? 0)}
                icon={<Wallet className="h-5 w-5" />}
                accent="#0d9488"
              />
              <MiniCard
                label={t('depreciation.current_value')}
                value={formatBaht(summary?.totalOriginal ?? 0)}
                icon={<Coins className="h-5 w-5" />}
                accent="#f97316"
              />
              <MiniCard
                label={t('depreciation.col.acc_dep')}
                value={formatBaht(summary?.totalDepreciated ?? 0)}
                icon={<TrendingDown className="h-5 w-5" />}
                accent="#f59e0b"
              />
              <MiniCard
                label={t('depreciation.expired_count')}
                value={`${summary?.fullyDepreciatedCount ?? 0} ${t('depreciation.unit.device')}`}
                icon={<AlertOctagon className="h-5 w-5" />}
                accent="#f43f5e"
              />
            </div>

            {/* Stacked bar: current value + depreciation per device */}
            <div>
              <div className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                {t('depreciation.current_value')} vs {t('depreciation.col.acc_dep')} ({chartData.length} {t('depreciation.first_add')})
              </div>
              <VisibleResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <defs>
                    <linearGradient
                      id="deprCurrentFill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#14b8a6"
                        stopOpacity={0.95}
                      />
                      <stop
                        offset="100%"
                        stopColor="#0d9488"
                        stopOpacity={0.7}
                      />
                    </linearGradient>
                    <linearGradient
                      id="deprAccumFill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#fb923c"
                        stopOpacity={0.95}
                      />
                      <stop
                        offset="100%"
                        stopColor="#f97316"
                        stopOpacity={0.75}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={gridStroke}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: axisTickColor }}
                    tickLine={false}
                    axisLine={{ stroke: gridStroke }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: axisTickColor }}
                    tickLine={false}
                    axisLine={{ stroke: gridStroke }}
                    width={70}
                    tickFormatter={(v) => formatShortBaht(Number(v))}
                  />
                  <Tooltip
                    cursor={{ fill: isDark ? '#ffffff10' : '#0f172a08' }}
                    formatter={(v: number, name: string) => [
                      formatBaht(Number(v)),
                      name === 'currentValue' ? t('depreciation.current_value') : t('depreciation.col.acc_dep'),
                    ]}
                    labelFormatter={(_, payload) => {
                      const p = payload?.[0]?.payload as {
                        full?: string
                      } | undefined
                      return p?.full ?? ''
                    }}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: `1px solid ${tooltipBorder}`,
                      background: tooltipBg,
                      color: tooltipFg,
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12 }}
                    formatter={(v) =>
                      v === 'currentValue'
                        ? t('depreciation.current_value')
                        : t('depreciation.col.acc_dep')
                    }
                  />
                  <Bar
                    dataKey="currentValue"
                    stackId="a"
                    fill="url(#deprCurrentFill)"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="depreciation"
                    stackId="a"
                    fill="url(#deprAccumFill)"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </VisibleResponsiveContainer>
            </div>

            {/* Device table */}
            <div>
              <div className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                {t('depreciation.device_list')} ({devices.length} {t('depreciation.from')} {data?.devices.length ?? 0})
              </div>
              <div className="itam-scroll max-h-[50vh] overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                    <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
                      <th className="px-3 py-2 font-medium">{t('depreciation.col.device')}</th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t('depreciation.col.purchase_price')}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t('depreciation.col.current_value')}
                      </th>
                      <th className="px-3 py-2 font-medium">{t('depreciation.col.annual_dep')} %</th>
                      <th className="px-3 py-2 font-medium">{t('depreciation.col.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((d) => {
                      const pct = Math.min(
                        100,
                        Math.max(0, d.depreciationPercent),
                      )
                      const barColor = progressColor(pct)
                      return (
                        <tr
                          key={d.id}
                          className="border-t border-slate-100 transition-colors hover:bg-slate-50/70 dark:border-slate-800 dark:hover:bg-slate-800/40"
                        >
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-700 dark:text-slate-200">
                              {d.name}
                            </div>
                            <div className="font-mono text-xs text-slate-400 dark:text-slate-500">
                              {d.assetCode}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                            {formatBaht(d.purchasePrice)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#0d9488] dark:text-[#14b8a6]">
                            {formatBaht(d.currentValue)}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="relative h-2 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                <div
                                  className="absolute inset-y-0 left-0 rounded-full transition-all"
                                  style={{
                                    width: `${pct}%`,
                                    background: barColor,
                                  }}
                                />
                              </div>
                              <span className="w-9 text-right font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                                {pct}%
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <Badge
                              className={depreciationBadgeClass(
                                d.status as DepreciationStatus,
                              )}
                            >
                              {depreciationLabel(d.status as DepreciationStatus)}
                            </Badge>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
              <Coins className="h-3 w-3" />
              {t('depreciation.avg_annual_dep')}:{' '}
              <span className="font-medium text-slate-500 dark:text-slate-400">
                {formatBaht(
                  summary
                    ? (summary.totalDepreciated ?? 0)
                    : 0,
                )}
              </span>
              · {t('depreciation.avg_dep')}:{' '}
              <span className="font-medium text-slate-500 dark:text-slate-400">
                {summary?.avgDepreciationPercent ?? 0}%
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
