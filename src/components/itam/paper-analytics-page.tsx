'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { motion } from 'framer-motion'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  Legend,
} from 'recharts'
import { VisibleResponsiveContainer } from '@/components/itam/visible-responsive-container'
import { useAuthStore } from '@/store/auth-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  FileText,
  TrendingUp,
  Gauge,
  CalendarDays,
  Inbox,
  Coins,
  Building2,
  Trophy,
  Medal,
} from 'lucide-react'
import type { CostAnalyticsData, DashboardRangeKey } from './types'
import { DASHBOARD_RANGE_OPTIONS, formatBaht } from './types'
import { UtilizationSection } from './utilization-section'
import { useT, useLang } from '@/store/i18n-store'
import { bearerHeaders } from '@/lib/http-headers'

interface KpiProps {
  title: string
  value: string
  icon: React.ReactNode
  accent: string
  loading?: boolean
  hint?: string
}

function KpiCard({ title, value, icon, accent, loading, hint }: KpiProps) {
  return (
    <Card className="group relative overflow-hidden shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-transparent to-black/[0.02] opacity-0 transition-opacity group-hover:opacity-100 dark:to-white/[0.03]"
      />
      <CardContent className="relative flex items-center gap-4 p-4">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-105"
          style={{ background: `${accent}1a`, color: accent }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">
            {title}
          </div>
          {loading ? (
            <Skeleton className="mt-1 h-6 w-20 dark:bg-slate-800" />
          ) : (
            <div className="text-xl font-bold text-slate-800 dark:text-slate-100">{value}</div>
          )}
          {hint && <div className="truncate text-xs text-slate-400 dark:text-slate-500">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  )
}

const THAI_MONTHS_SHORT = [
  '', '..', 'Has', '..', '', '..',
  '', '', '..', '', '..', '',
]

function formatMonthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-')
  const idx = Number(m) - 1
  if (idx < 0 || idx > 11) return yyyymm
  return `${THAI_MONTHS_SHORT[idx]} ${y}`
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

/* ---------- Site comparison types ---------- */
interface SiteRow {
  siteCode: string
  siteName: string
  deviceCount: number
  activeCount: number
  spareCount: number
  repairCount: number
  totalSheets: number
  totalCost: number
  avgSheetsPerDevice: number
  lastReadingDate: string | null
  unreadInCycle: number
}
interface SiteComparisonData {
  sites: SiteRow[]
  ranked: SiteRow[]
  totalDevices: number
  totalSheets: number
  totalCost: number
  range: { key: string; start: string | null; end: string | null }
}

const MEDAL_EMOJIS = ['🥇', '🥈', '🥉']
const MEDAL_BG = [
  'from-amber-100 to-amber-50 dark:from-amber-950/40 dark:to-amber-900/20 border-amber-200 dark:border-amber-800',
  'from-slate-100 to-slate-50 dark:from-slate-800/60 dark:to-slate-800/30 border-slate-200 dark:border-slate-700',
  'from-orange-100 to-orange-50 dark:from-orange-950/40 dark:to-orange-900/20 border-orange-200 dark:border-orange-800',
]

export function PaperAnalyticsPage() {
  const t = useT()
  const { lang } = useLang()
  const { theme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const isDark = mounted && theme === 'dark'

  // Unified range state shared by Site Comparison, Utilization, and Cost.
  const [range, setRange] = React.useState<DashboardRangeKey>('month')

  const axisTickColor = '#64748b'
  const gridStroke = isDark ? '#334155' : '#e2e8f0'
  const tooltipBorder = isDark ? '#334155' : '#e2e8f0'
  const tooltipBg = isDark ? '#0f172a' : '#ffffff'
  const tooltipFg = isDark ? '#e2e8f0' : '#1e293b'

  const { data: monthly, isLoading: monthlyLoading } = useQuery<
    Array<{ month: string; value: number }>
  >({
    queryKey: ['meter-monthly'],
    queryFn: async () => {
      const token = useAuthStore.getState()?.token
      const res = await fetch('/api/meter?aggregate=monthly', {
        headers: bearerHeaders(token),
      })
      if (!res.ok) throw new Error('Failed to load monthly')
      const json = await res.json()
      return (json.monthly ?? []) as Array<{ month: string; value: number }>
    },
  })

  const { data: byDevice, isLoading: deviceLoading } = useQuery<
    Array<{ id: string; name: string; assetCode: string; value: number }>
  >({
    queryKey: ['meter-byDevice'],
    queryFn: async () => {
      const token = useAuthStore.getState()?.token
      const res = await fetch('/api/meter?aggregate=byDevice', {
        headers: bearerHeaders(token),
      })
      if (!res.ok) throw new Error('Failed to load byDevice')
      const json = await res.json()
      return (json.byDevice ?? []) as Array<{
        id: string
        name: string
        assetCode: string
        value: number
      }>
    },
  })

  const { data: costData, isLoading: costLoading } = useQuery<CostAnalyticsData>({
    queryKey: ['cost-analytics', range],
    queryFn: async () => {
      const token = useAuthStore.getState()?.token
      const res = await fetch(`/api/cost-analytics?range=${range}`, {
        headers: bearerHeaders(token),
      })
      if (!res.ok) throw new Error('Failed to load cost analytics')
      return res.json()
    },
  })

  const { data: comparisonData, isLoading: comparisonLoading } =
    useQuery<SiteComparisonData>({
      queryKey: ['sites-comparison', range],
      queryFn: async () => {
        const token = useAuthStore.getState()?.token
        const res = await fetch(`/api/sites/comparison?range=${range}`, {
          headers: bearerHeaders(token),
        })
        if (!res.ok) throw new Error('Failed to load site comparison')
        return res.json()
      },
    })

  const monthlyData = React.useMemo(
    () =>
      (monthly ?? [])
        .slice()
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((d) => ({ ...d, label: formatMonthLabel(d.month) })),
    [monthly],
  )

  const topDevices = React.useMemo(
    () => (byDevice ?? []).filter((d) => d.value > 0).slice(0, 8),
    [byDevice],
  )

  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const thisMonthSheets = (monthly ?? [])
    .filter((m) => m.month === currentMonth)
    .reduce((sum, m) => sum + m.value, 0)
  const totalSheets = (monthly ?? []).reduce((sum, m) => sum + m.value, 0)
  const activeDeviceCount = (byDevice ?? []).filter((d) => d.value > 0).length
  const avgPerDevice = activeDeviceCount > 0
    ? Math.round(totalSheets / activeDeviceCount)
    : 0
  const dayOfMonth = now.getDate()
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate()
  const projected =
    dayOfMonth > 0
      ? Math.round((thisMonthSheets / dayOfMonth) * daysInMonth)
      : 0

  const lineData = monthlyData.map((d) => ({ name: d.label, value: d.value }))
  const barData = topDevices.map((d) => ({ name: d.assetCode, value: d.value, full: d.name }))

  // Cost chart data — top 8 devices by cost
  const costBarData = React.useMemo(
    () =>
      (costData?.devices ?? [])
        .filter((d) => d.cost > 0)
        .slice(0, 8)
        .map((d) => ({
          name: d.assetCode,
          value: d.cost,
          full: d.name,
        })),
    [costData],
  )

  const totalCost = costData?.totalCost ?? 0
  const costActiveCount = (costData?.devices ?? []).filter((d) => d.cost > 0).length
  const avgCostPerDevice = costActiveCount > 0
    ? Math.round((totalCost / costActiveCount) * 100) / 100
    : 0

  const rangeLabel =
    DASHBOARD_RANGE_OPTIONS.find((o) => o.value === range)?.label ?? t('lifecycle.month_unit')

  const costTooltipFormatter = (v: number) => [formatBaht(v), 'ต้นทุนกระดาษ']

  // Site comparison chart data: one entry per site with sheets + cost
  const comparisonChart = React.useMemo(
    () =>
      (comparisonData?.sites ?? [])
        .filter((s) => s.totalSheets > 0 || s.totalCost > 0)
        .map((s) => ({
          name: s.siteCode,
          full: s.siteName,
          sheets: s.totalSheets,
          cost: Math.round(s.totalCost),
        })),
    [comparisonData],
  )

  const rankedTop3 = (comparisonData?.ranked ?? [])
    .filter((s) => s.totalSheets > 0)
    .slice(0, 3)
  const topSiteCode = (comparisonData?.ranked ?? []).find(
    (s) => s.totalSheets > 0,
  )?.siteCode

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">การใช้กระดาษ</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          วิเคราะห์ปริมาณการใช้กระดาษจากการจดมิเตอร์รายเดือน · คำนวณต้นทุนด้วยอัตราค่าใช้จ่ายของแต่ละสาขา
        </p>
      </div>

      {/* Usage KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          title="Usemonths"
          value={`${thisMonthSheets.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น`}
          icon={<FileText className="h-6 w-6" />}
          accent="#f97316"
          loading={monthlyLoading}
          hint={formatMonthLabel(currentMonth)}
        />
        <KpiCard
          title="เฉลี่ยต่อเครื่อง"
          value={`${avgPerDevice.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น`}
          icon={<Gauge className="h-6 w-6" />}
          accent="#14b8a6"
          loading={deviceLoading}
          hint={`จาก ${activeDeviceCount} เครื่อง`}
        />
        <KpiCard
          title="คาดว่าจะถึงสิ้นเดือน"
          value={`${projected.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น`}
          icon={<TrendingUp className="h-6 w-6" />}
          accent="#0d9488"
          loading={monthlyLoading}
          hint={`ณ วันที่ ${dayOfMonth}/${daysInMonth}`}
        />
        <KpiCard
          title="รวมทั้งหมด"
          value={`${totalSheets.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น`}
          icon={<CalendarDays className="h-6 w-6" />}
          accent="#0f172a"
          loading={monthlyLoading}
        />
      </div>

      {/* Line chart */}
      <Card className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardHeader>
          <CardTitle className="text-base text-slate-800 dark:text-slate-100">แนวโน้มการใช้กระดาษรายเดือน</CardTitle>
        </CardHeader>
        <CardContent>
          {monthlyLoading ? (
            <Skeleton className="h-72 w-full dark:bg-slate-800" />
          ) : lineData.length === 0 ? (
            <EmptyState message="ยังไม่มีข้อมูลการจดมิเตอร์" />
          ) : (
            <VisibleResponsiveContainer width="100%" height={300}>
              <LineChart data={lineData}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: axisTickColor }} />
                <YAxis tick={{ fontSize: 12, fill: axisTickColor }} />
                <Tooltip
                  formatter={(v: number) => [`${v.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น`, 'การใช้กระดาษ']}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: `1px solid ${tooltipBorder}`,
                    background: tooltipBg,
                    color: tooltipFg,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#f97316"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#f97316' }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </VisibleResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Bar chart - top devices by sheets */}
      <Card className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardHeader>
          <CardTitle className="text-base text-slate-800 dark:text-slate-100">อุปกรณ์ที่ใช้กระดาษสูงสุด</CardTitle>
        </CardHeader>
        <CardContent>
          {deviceLoading ? (
            <Skeleton className="h-72 w-full dark:bg-slate-800" />
          ) : barData.length === 0 ? (
            <EmptyState message="ยังไม่มีข้อมูลการใช้งาน" />
          ) : (
            <VisibleResponsiveContainer width="100%" height={300}>
              <BarChart data={barData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis type="number" tick={{ fontSize: 12, fill: axisTickColor }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={100}
                  tick={{ fontSize: 11, fill: axisTickColor }}
                />
                <Tooltip
                  formatter={(v: number) => [`${v.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น`, 'การใช้กระดาษ']}
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload as { full?: string } | undefined
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
                <Bar dataKey="value" fill="#14b8a6" radius={[0, 6, 6, 0]} />
              </BarChart>
            </VisibleResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ===== Site Comparison ===== */}
      <Card className="border-teal-200/60 dark:border-teal-800/40 dark:bg-slate-900">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base text-slate-800 dark:text-slate-100">
            <Building2 className="h-4 w-4 text-[#0d9488]" />
            🏗️ compareSite
            <span className="ml-1 text-xs font-normal text-slate-400 dark:text-slate-500">
              compareAmountPaper · Cost · StatusDevice · StillNoReadinCycle
            </span>
          </CardTitle>
          <Select value={range} onValueChange={(v) => setRange(v as DashboardRangeKey)}>
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
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Comparison KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <KpiCard
              title="อุปกรณ์ทั้งหมด"
              value={`${comparisonData?.totalDevices ?? 0} units`}
              icon={<Building2 className="h-6 w-6" />}
              accent="#0d9488"
              loading={comparisonLoading}
              hint={`Period: ${rangeLabel}`}
            />
            <KpiCard
              title="กระดาษรวม (ช่วง)"
              value={`${(comparisonData?.totalSheets ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น`}
              icon={<FileText className="h-6 w-6" />}
              accent="#14b8a6"
              loading={comparisonLoading}
              hint={`Period: ${rangeLabel}`}
            />
            <KpiCard
              title="ต้นทุนรวม (ช่วง)"
              value={formatBaht(comparisonData?.totalCost ?? 0)}
              icon={<Coins className="h-6 w-6" />}
              accent="#f97316"
              loading={comparisonLoading}
              hint={`Period: ${rangeLabel}`}
            />
            <KpiCard
              title="จำนวนสาขา"
              value={`${comparisonData?.sites.length ?? 0} Site`}
              icon={<Trophy className="h-6 w-6" />}
              accent="#f59e0b"
              loading={comparisonLoading}
            />
          </div>

          {/* Comparison table */}
          {comparisonLoading ? (
            <Skeleton className="h-64 w-full dark:bg-slate-800" />
          ) : (comparisonData?.sites ?? []).length === 0 ? (
            <EmptyState message="ยังไม่มีข้อมูลสาขา" />
          ) : (
            <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-800">
              <div className="itam-scroll overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">{t('devices.filter.site_placeholder')}</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">{t('dash.heatmap.device')}</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">{t('devices.status.active')}</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">Paper ({rangeLabel})</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">Cost (THB)</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">Average/units</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">StillNoRead</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(comparisonData?.sites ?? []).map((s) => {
                      const isTop = s.siteCode === topSiteCode
                      return (
                        <tr
                          key={s.siteCode}
                          className={`border-t border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50 ${
                            isTop
                              ? 'bg-orange-50 dark:bg-orange-950/30'
                              : ''
                          }`}
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              {isTop ? (
                                <span className="text-base" aria-label="rank 1">
                                  🥇
                                </span>
                              ) : null}
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                                  {s.siteName}
                                </div>
                                <div className="text-[10px] text-slate-400 dark:text-slate-500">
                                  {s.siteCode}
                                  {s.lastReadingDate ? ` · Latest ${s.lastReadingDate}` : ''}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                            {s.deviceCount}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                            {s.activeCount}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-teal-600 dark:text-teal-400">
                            {(s.totalSheets ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#f97316] dark:text-[#fb923c]">
                            {formatBaht(s.totalCost)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                            {(s.avgSheetsPerDevice ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {s.unreadInCycle > 0 ? (
                              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                                {s.unreadInCycle} units
                              </span>
                            ) : (
                              <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ complete</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Grouped comparison chart + leaderboard */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                Paper vs Cost itemSite
              </div>
              {comparisonLoading ? (
                <Skeleton className="h-64 w-full dark:bg-slate-800" />
              ) : comparisonChart.length === 0 ? (
                <EmptyState message="ยังไม่มีข้อมูลในช่วงนี้" />
              ) : (
                <VisibleResponsiveContainer width="100%" height={300}>
                  <BarChart data={comparisonChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: axisTickColor }}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 11, fill: axisTickColor }}
                      tickFormatter={(v) =>
                        Number(v).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { notation: 'compact' })
                      }
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 11, fill: axisTickColor }}
                      tickFormatter={(v) =>
                        Number(v).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { notation: 'compact' })
                      }
                    />
                    <Tooltip
                      formatter={(v: number, name: string) =>
                        name === t('common.cost')
                          ? [formatBaht(v as number), t('common.cost')]
                          : [`${(Number(v) || 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น`, 'กระดาษ']
                      }
                      labelFormatter={(_, payload) => {
                        const p = payload?.[0]?.payload as { full?: string } | undefined
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
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar
                      yAxisId="left"
                      dataKey="sheets"
                      name="กระดาษ"
                      fill="#14b8a6"
                      radius={[6, 6, 0, 0]}
                      isAnimationActive
                    />
                    <Bar
                      yAxisId="right"
                      dataKey="cost"
                      name="Cost"
                      fill="#f97316"
                      radius={[6, 6, 0, 0]}
                      isAnimationActive
                    />
                  </BarChart>
                </VisibleResponsiveContainer>
              )}
            </div>

            {/* Leaderboard */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
                <Medal className="h-4 w-4 text-[#f59e0b]" />
                TOP Site
              </div>
              {comparisonLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={`lb-${i}`} className="h-16 w-full dark:bg-slate-800" />
                  ))}
                </div>
              ) : rankedTop3.length === 0 ? (
                <EmptyState message="No data" />
              ) : (
                <motion.ol
                  initial="hidden"
                  animate="show"
                  variants={{
                    hidden: {},
                    show: { transition: { staggerChildren: 0.08 } },
                  }}
                  className="space-y-2"
                >
                  {rankedTop3.map((s, i) => (
                    <motion.li
                      key={s.siteCode}
                      variants={{
                        hidden: { opacity: 0, y: 8 },
                        show: { opacity: 1, y: 0 },
                      }}
                      className={`flex items-center gap-3 rounded-lg border bg-gradient-to-br p-3 ${MEDAL_BG[i] ?? MEDAL_BG[2]}`}
                    >
                      <div className="text-2xl">{MEDAL_EMOJIS[i] ?? '🏆'}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                            #{i + 1}
                          </span>
                          <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                            {s.siteName}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          <span className="font-semibold tabular-nums text-teal-600 dark:text-teal-400">
                            {(s.totalSheets ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                          </span>{' '}
                          แผ่น ·{' '}
                          <span className="tabular-nums text-[#f97316]">
                            {formatBaht(s.totalCost)}
                          </span>
                        </div>
                      </div>
                    </motion.li>
                  ))}
                </motion.ol>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== Utilization section ===== */}
      <UtilizationSection range={range} onRangeChange={setRange} />

      {/* ===== Cost analytics section ===== */}
      <Card className="border-amber-200/60 dark:border-amber-800/40 dark:bg-slate-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-slate-800 dark:text-slate-100">
            <Coins className="h-4 w-4 text-[#f97316]" />
            💰 ต้นทุนกระดาษ
            <span className="ml-2 text-xs font-normal text-slate-400 dark:text-slate-500">
              คำนวณจากอัตราค่าใช้จ่ายต่อแผ่นของแต่ละสาขา × จำนวนแผ่นที่ใช้
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Range selector — same `range` as comparison/utilization */}
          <div className="flex items-center justify-end">
            <Select value={range} onValueChange={(v) => setRange(v as DashboardRangeKey)}>
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
          </div>

          {/* Cost KPIs */}
          <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard
              title="ต้นทุนกระดาษ (ช่วง)"
              value={formatBaht(totalCost)}
              icon={<Coins className="h-6 w-6" />}
              accent="#f97316"
              loading={costLoading}
              hint={`Period: ${rangeLabel}`}
            />
            <KpiCard
              title="ต้นทุนเฉลี่ย/เครื่อง"
              value={formatBaht(avgCostPerDevice)}
              icon={<Gauge className="h-6 w-6" />}
              accent="#f59e0b"
              loading={costLoading}
              hint={`จาก ${costActiveCount} เครื่องที่ใช้งานอยู่`}
            />
            <KpiCard
              title="จำนวนแผ่นรวม (ช่วง)"
              value={`${(costData?.totalSheets ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น`}
              icon={<FileText className="h-6 w-6" />}
              accent="#0d9488"
              loading={costLoading}
              hint={`Period: ${rangeLabel}`}
            />
          </div>

          {/* Cost bar chart — orange→amber gradient */}
          <div>
            <div className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">
              CostbyDevice (8 first)
            </div>
            {costLoading ? (
              <Skeleton className="h-72 w-full dark:bg-slate-800" />
            ) : costBarData.length === 0 ? (
              <EmptyState message="ยังไม่มีข้อมูลต้นทุนในช่วงนี้" />
            ) : (
              <VisibleResponsiveContainer width="100%" height={300}>
                <BarChart data={costBarData} layout="vertical">
                  <defs>
                    <linearGradient id="costBarFill" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#f97316" stopOpacity={0.85} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.95} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: axisTickColor }}
                    tickFormatter={(v) =>
                      Number(v).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
                        notation: 'compact',
                      })
                    }
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={100}
                    tick={{ fontSize: 11, fill: axisTickColor }}
                  />
                  <Tooltip
                    formatter={costTooltipFormatter}
                    labelFormatter={(_, payload) => {
                      const p = payload?.[0]?.payload as { full?: string } | undefined
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
                  <Bar dataKey="value" fill="url(#costBarFill)" radius={[0, 6, 6, 0]}>
                    {costBarData.map((entry, idx) => (
                      <Cell key={`cell-${idx}`} fill="url(#costBarFill)" />
                    ))}
                  </Bar>
                </BarChart>
              </VisibleResponsiveContainer>
            )}
          </div>

          {/* Cost by site */}
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
              <Building2 className="h-4 w-4 text-[#0d9488]" />
              CostbySite
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {costLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={`cs-${i}`} className="h-20 dark:bg-slate-800" />
                ))
              ) : (costData?.bySite ?? []).length === 0 ? (
                <div className="col-span-full">
                  <EmptyState message="ยังไม่มีข้อมูลต้นทุนตามสาขา" />
                </div>
              ) : (
                (costData?.bySite ?? []).map((s) => (
                  <div
                    key={s.site}
                    className="rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
                        <Building2 className="h-3.5 w-3.5 text-[#0d9488]" />
                        {s.site}
                      </div>
                    </div>
                    <div className="mt-1 text-lg font-bold tabular-nums text-[#f97316]">
                      {formatBaht(s.cost)}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {(s.sheets ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
