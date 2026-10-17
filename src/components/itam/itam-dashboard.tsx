'use client'

/**
 * ItamDashboard — the UNIFIED single dashboard for the ITAM app.
 *
 * Merges the best of both legacy dashboards:
 *  • Optimized /api/itam/dashboard API (faster, has bySite, paperTrend, heatmap, insights)
 *  • Count-up animation + glow KPI cards (from ITAM Dashboard)
 *  • Smart Insights (auto-generated alerts)
 *  • byType donut, bySite comparison, paperTrend area chart, heatmap modal
 *  • Quick Actions bar (from DashboardPage — Task 37)
 *  • Range selector + auto-refresh indicator (from DashboardPage)
 *  • Widget customization (drag-to-reorder) via DashboardWidgetLayout
 *  • Lifecycle section + warranty alerts (separate APIs)
 *  • Cycle Progress widget (real cycle data, no longer a placeholder)
 *  • PDF export
 *
 * The "seed" button was removed — we now have real data.
 */

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  PieChart, Pie, Cell, Tooltip as ReTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area, LabelList,
  ReferenceLine,
} from 'recharts'
import { VisibleResponsiveContainer } from '@/components/itam/visible-responsive-container'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  Package, CheckCircle2, Wrench, FileText, TrendingUp, Building2,
  FileDown, Flame, BarChart3, Trophy, RefreshCw, Loader2,
  AlertTriangle, Palette, ArrowUpRight, ArrowDownRight, CircleAlert, Wallet,
  CalendarClock, ArrowRight, History, Settings2, Inbox, MoreHorizontal,
  Printer, Wifi, WifiOff, Activity,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import type { ActivePage } from '@/store/app-store'
import { useAuthStore } from '@/store/auth-store'
import { useT, useFormatDateTime, useFormatDate, useLang } from '@/store/i18n-store'
import { useRealtime } from '@/hooks/use-realtime'
import type { Cycle, DashboardRangeKey } from './types'
import { DASHBOARD_RANGE_OPTIONS } from './types'
import { QuickActionsBar } from './quick-actions-bar'
import { LifecycleDashboard } from './lifecycle-dashboard'
import { DepreciationSection } from './depreciation-section'
import { ReportsSection } from './reports-section'
import {
  DashboardWidgetLayout,
  type WidgetId,
} from './dashboard-widget-layout'
import { PrintTemplateSelectionDialog } from './print-template-selection-dialog'
import { relativeTime } from './reports/shared'
import { bearerHeaders } from '@/lib/http-headers'

interface SiteRow {
  siteCode: string
  siteName: string | null
  deviceCount: number
  activeCount: number
  paperSheets: number
  paperBw?: number
  paperColor?: number
  paperCost?: number
}
interface DashboardData {
  totals: { total: number; active: number; inactive: number; spare: number; repair: number }
  byType: Array<{ name: string; value: number }>
  bySite: SiteRow[]
  paperThisMonth: number
  paperTrend: Array<{ month: string; sheets: number; cost?: number }>
  meterRequiredCount: number
  recentActivity: Array<{
    id: string; assetCode: string; deviceName: string
    readingDate: string; pagesBw: number; pagesColor: number; remark: string | null
  }>
  heatmap: Array<{ assetCode: string; deviceName: string; months: Array<{ month: string; pages: number }> }>
  heatmapMonths: string[]
  queryTimeMs: number
}

interface WarrantySummary {
  active: number
  expiring: number
  expired: number
  unknown: number
}

/** Per-device warranty row (subset of /api/devices/warranty's `devices`).
 *  Used by the warranty status widget for the distribution bar and the
 *  next-to-expire list (QA-ROUND-2026-09-16-E). */
interface WarrantyDevice {
  assetCode: string
  name: string
  brand: string | null
  model: string | null
  site: string | null
  warrantyExpiry: string | null
  status: 'active' | 'expiring' | 'expired' | 'unknown'
  daysUntilExpiry: number | null
}

interface WarrantyResponse {
  summary: WarrantySummary
  devices: WarrantyDevice[]
}

interface RemindersSummary {
  hasActiveCycle: boolean
  totalRead: number
  totalUnread: number
}

// ============== Count-up hook ==============
function useCountUp(value: number, durationMs = 600): number {
  const [display, setDisplay] = React.useState(value)
  const fromRef = React.useRef(value)
  const rafRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    const from = fromRef.current
    const to = value
    if (from === to) return
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(from + (to - from) * eased))
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [value, durationMs])
  return display
}

// ============== KPI Card with count-up + glow ==============
function KpiCard({
  title, value, icon, accent, loading, glow, trend, unit,
}: {
  title: string; value: number; icon: React.ReactNode
  accent: string; loading?: boolean; glow?: boolean
  trend?: string; unit?: string
}) {
  const animated = useCountUp(value)
  const { lang } = useLang()
  return (
    <Card
      className={[
        'relative overflow-hidden shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
        'dark:border-slate-800 dark:bg-slate-900',
        glow ? 'itam-glow' : '',
      ].join(' ')}
    >
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />
      <CardContent className="p-2.5 sm:p-3">
        <div className="flex items-center gap-2 sm:gap-2.5">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-9 sm:w-9"
            style={{ background: `${accent}1a`, color: accent }}
          >
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">{title}</div>
            {loading ? (
              <Skeleton className="mt-1 h-6 w-20" />
            ) : (
              <div className="flex items-baseline gap-1 flex-wrap">
                <span className="text-base font-bold tabular-nums text-slate-800 dark:text-slate-100 sm:text-lg break-all">
                  {(animated ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                </span>
                {unit && (
                  <span className="shrink-0 text-xs font-medium text-slate-400 dark:text-slate-500">{unit}</span>
                )}
              </div>
            )}
            {trend && !loading && (
              <div className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-500" title={trend}>
                {trend}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

const MEDALS = ['🥇', '🥈', '🥉']

// ============== CostSparkline (QA-ROUND-2026-09-16-D) ==============
// Tiny inline SVG line chart for the paper-cost KPI card — shows the 6-month
// cost trend at a glance. Pure SVG (no recharts) to keep the card light.
// Color follows the last segment: falling cost = emerald (savings), rising =
// rose (more spend). The final point gets a dot + value tooltip.
function CostSparkline({ points, width = 112, height = 30 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return null
  const max = Math.max(...points)
  const min = Math.min(...points)
  const range = max - min || 1
  const step = width / (points.length - 1)
  const y = (v: number) => height - 3 - ((v - min) / range) * (height - 6)
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(p).toFixed(1)}`)
    .join(' ')
  const area = `${path} L${width},${height} L0,${height} Z`
  const last = points[points.length - 1]
  const prev = points[points.length - 2]
  const falling = last < prev
  const stroke = falling ? '#10b981' : '#f43f5e'
  const gradId = `costSpark${falling ? 'Down' : 'Up'}`
  const tip = points
    .map((p, i) => `${i === points.length - 1 ? 'ล่าสุด' : `-${points.length - 1 - i} เดือน`}: ฿${p.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`)
    .join('  ·  ')
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      role="img"
      aria-label={`แนวโน้มต้นทุนกระดาษ 6 เดือน: ${tip}`}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={y(last)} r={2.8} fill={stroke} />
      <circle cx={width} cy={y(last)} r={5.5} fill={stroke} opacity={0.25} />
    </svg>
  )
}

function heatColor(intensity: number): string {
  const i = Math.max(0, Math.min(1, intensity))
  const alpha = 0.08 + i * 0.85
  return `rgba(13, 148, 136, ${alpha.toFixed(2)})`
}

// Status palette for donut — orange, teal, amber, rose, slate
const STATUS_COLORS = ['#f97316', '#0d9488', '#f59e0b', '#ef4444', '#94a3b8']

// ============== EmptyState helper ==============
function EmptyState({
  message, subtitle, icon,
}: {
  message: string; subtitle?: string; icon?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400 dark:text-slate-500">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
        {icon ?? <Inbox className="h-6 w-6 text-slate-300 dark:text-slate-400" />}
      </div>
      <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">{message}</div>
      {subtitle && <div className="text-xs text-slate-400 dark:text-slate-500">{subtitle}</div>}
    </div>
  )
}

// ============== Cycle Progress Widget (ported from dashboard-page.tsx) ==============
function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24),
  )
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

interface CycleProgressWidgetProps {
  activeCycle: Cycle | null
  cycleLoading: boolean
  remindersSummary: RemindersSummary | null
  onManageCycle: () => void
  onCreateCycle: () => void
}

function CycleProgressWidget({
  activeCycle, cycleLoading, remindersSummary, onManageCycle, onCreateCycle,
}: CycleProgressWidgetProps) {
  const t = useT()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => {
    const tid = window.setTimeout(() => setMounted(true), 60)
    return () => window.clearTimeout(tid)
  }, [])

  if (cycleLoading) {
    return (
      <Card className="overflow-hidden border-[#f97316]/20 bg-gradient-to-br from-orange-50 to-white dark:border-[#f97316]/30 dark:from-slate-900 dark:to-slate-800/50">
        <CardContent className="p-4">
          <Skeleton className="h-24 w-full dark:bg-slate-800" />
        </CardContent>
      </Card>
    )
  }

  if (!activeCycle) {
    return (
      <Card className="relative overflow-hidden border-amber-200 bg-gradient-to-br from-amber-50 to-white dark:border-amber-800/60 dark:from-amber-950/30 dark:to-slate-900">
        <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-amber-400 to-[#f97316]" />
        <CardContent className="relative flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 transition-transform group-hover:scale-105 dark:bg-amber-900/40 dark:text-amber-300">
              <CalendarClock className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                {t('dash.cycle.no_active')}
              </div>
              <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-300/80">
                {t('dash.cycle.no_active_hint')}
              </div>
            </div>
          </div>
          <Button type="button"
            size="sm"
            onClick={onCreateCycle}
            className="shrink-0 bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
          >
            <CalendarClock className="h-4 w-4" />
            {t('dash.cycle.create_new')}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </CardContent>
      </Card>
    )
  }

  const totalDays = Math.max(1, daysBetween(activeCycle.startDate, activeCycle.endDate))
  const elapsed = Math.max(0, daysBetween(activeCycle.startDate, todayISO()))
  const daysRemaining = Math.max(0, daysBetween(todayISO(), activeCycle.endDate))
  const elapsedPct = Math.min(100, Math.round((elapsed / totalDays) * 100))

  const totalRead = remindersSummary?.totalRead ?? 0
  const totalMeterable =
    (remindersSummary?.totalRead ?? 0) + (remindersSummary?.totalUnread ?? 0)
  const readPct =
    totalMeterable > 0 ? Math.round((totalRead / totalMeterable) * 100) : 0

  const animElapsedPct = mounted ? elapsedPct : 0
  const animReadPct = mounted ? readPct : 0

  return (
    <Card className="group relative overflow-hidden border-[#f97316]/20 bg-gradient-to-br from-orange-50 to-white shadow-sm transition-shadow hover:shadow-md dark:border-[#f97316]/30 dark:from-slate-900 dark:to-slate-800/50">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#fb923c] to-[#f97316]" />
      <span
        aria-hidden
        className="pointer-events-none absolute -right-2 -top-2 select-none text-[100px] leading-none text-[#f97316]/5 dark:text-[#fb923c]/10"
      >
        <CalendarClock className="h-24 w-24" />
      </span>

      <CardContent className="relative p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#f97316] dark:text-[#fb923c]">
              <CalendarClock className="h-3.5 w-3.5" />
              {t('dash.cycle.current')}
            </div>
            <div className="truncate text-base font-bold text-slate-800 dark:text-slate-100 sm:text-lg">
              {activeCycle.name}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono">
                📅 {activeCycle.startDate} → {activeCycle.endDate}
              </span>
              <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 transition-colors hover:scale-105 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                {t('dash.cycle.in_progress')}
              </Badge>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-4">
            <div className="flex flex-col items-center justify-center rounded-lg bg-white/70 px-4 py-2 text-center shadow-sm dark:bg-slate-800/60">
              <div className="text-3xl font-bold tabular-nums leading-tight text-[#f97316] dark:text-[#fb923c]">
                {daysRemaining}
              </div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {t('dash.cycle.days_left')}
              </div>
            </div>

            <div className="flex w-auto flex-1 flex-col gap-2">
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span>{t('dash.cycle.progress')}</span>
                  <span className="font-mono tabular-nums">{elapsedPct}%</span>
                </div>
                <Progress
                  value={animElapsedPct}
                  className="h-1.5 [&>div]:bg-gradient-to-r [&>div]:from-[#fb923c] [&>div]:to-[#f97316]"
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span>{t('dash.cycle.meter_progress')}</span>
                  <span className="font-mono tabular-nums">
                    {totalRead}/{totalMeterable} ({readPct}%)
                  </span>
                </div>
                <Progress
                  value={animReadPct}
                  className="h-1.5 [&>div]:bg-[#0d9488]"
                />
              </div>
              <Button type="button"
                size="sm"
                onClick={onManageCycle}
                className="mt-1 self-end bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
              >
                {t('dash.cycle.manage')}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// SPRINT-3 #6: Role-based task banner — shows different "what to do now"
// call-to-action based on the logged-in user's role. Meter-only users
// see pending meter readings; technicians see assigned WOs; admins/managers
// see the full KPI dashboard (no banner — they want the overview).
function RoleTaskBanner({
  pendingMeterCount,
  pendingWoCount,
  setActivePage,
  setPendingMeterAction,
}: {
  pendingMeterCount: number
  pendingWoCount: number
  // Typed as ActivePage (not `string`) so the store's setActivePage is
  // assignable — an arrow taking the union is a subtype of one taking string,
  // but not vice versa.
  setActivePage: (page: ActivePage) => void
  setPendingMeterAction: (action: string | null) => void
}) {
  const authUser = useAuthStore((s) => s.user)
  if (!authUser) return null
  const role = (authUser.role || '').toLowerCase()

  // Meter-only role: show pending meter readings
  if (role === 'meter' || role === 'meter_only') {
    if (pendingMeterCount === 0) return null
    return (
      <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-[#f97316]/30 bg-[#f97316]/5 p-3 dark:border-[#f97316]/40 dark:bg-[#f97316]/10">
        <div className="flex items-center gap-2">
          <span className="text-lg">📋</span>
          <div>
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              คุณมี {pendingMeterCount} เครื่องที่ยังไม่ได้จดมิเตอร์เดือนนี้
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              กดปุ่มข้างเคียงเพื่อเริ่มจดมิเตอร์
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setActivePage('meter')
            setPendingMeterAction('open-cycle')
          }}
          className="rounded-md bg-[#f97316] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#ea580c]"
        >
          ไปจดมิเตอร์ →
        </button>
      </div>
    )
  }

  // Technician role: show assigned WOs pending review
  if (role === 'technician' || role === 'editor') {
    if (pendingWoCount === 0) return null
    return (
      <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/50 dark:bg-amber-950/30">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔧</span>
          <div>
            <div className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              คุณมี {pendingWoCount} ใบงานรอตรวจสอบ
            </div>
            <div className="text-[11px] text-amber-600 dark:text-amber-400">
              กดปุ่มข้างเคียงเพื่อดูรายการ
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setActivePage('work-orders')}
          className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-600"
        >
          ไปดูใบงาน →
        </button>
      </div>
    )
  }

  // Admin/manager/superadmin: no banner — they want the KPI overview
  return null
}

export function ItamDashboard() {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const setActivePage = useAppStore((s) => s.setActivePage)
  const setPendingDeviceType = useAppStore((s) => s.setPendingDeviceType)
  const setPendingDeviceStatus = useAppStore((s) => s.setPendingDeviceStatus)
  const setPendingWarrantyFilter = useAppStore((s) => s.setPendingWarrantyFilter)
  const setPendingMeterAction = useAppStore((s) => s.setPendingMeterAction)

  // i18n — t() for labels; lang to re-trigger date formatting + chart label
  // memos when the user toggles TH/EN. (See donut/area chart useMemos.)
  const t = useT()
  const { lang } = useLang()
  const formatDateTime = useFormatDateTime()
  const formatDate = useFormatDate()

  // Realtime (Socket.io on port 3003 via Caddy XTransformPort gateway).
  // Purely additive: the dashboard's React Query polling still runs every
  // 5 min as a fallback. When the realtime server emits a fresh KPI, we
  // proactively invalidate the relevant query caches so the user sees
  // updated counts within seconds instead of minutes.
  const qc = useQueryClient()
  const realtime = useRealtime()
  // Track the previous KPI counts so we can detect "delta" pushes and
  // only invalidate when a value actually changed (saves a refetch when
  // the server re-broadcasts identical counts every 30s).
  const prevRealtimeRef = React.useRef<{ devices?: number; workOrders?: number } | null>(null)
  // Avoid spamming toasts on the initial KPI snapshot — we only surface
  // a toast for row events that arrive AFTER the dashboard mounts.
  const realtimeReadyRef = React.useRef(false)
  React.useEffect(() => {
    realtimeReadyRef.current = true
  }, [])

  // KPI → cache invalidation. When the realtime server reports a new
  // device/workOrder/meter count, mark those query keys as stale so
  // React Query refetches them. The dashboard's existing `refetchInterval`
  // still runs in the background; this just makes the UI refresh sooner.
  React.useEffect(() => {
    if (!realtime.kpi) return
    const prev = prevRealtimeRef.current
    const cur: { devices?: number; workOrders?: number } = {
      devices: realtime.kpi.devices,
      workOrders: realtime.kpi.workOrders,
    }
    if (prev) {
      const deviceChanged = prev.devices !== cur.devices
      const woChanged = prev.workOrders !== cur.workOrders
      if (deviceChanged || woChanged) {
        // Invalidate the heavy dashboard query + the listing queries.
        // This makes the KPI cards, by-type donut, and by-site table all
        // pull fresh data on the next render cycle.
        qc.invalidateQueries({ queryKey: ['itam-dashboard'] })
        if (deviceChanged) qc.invalidateQueries({ queryKey: ['devices'] })
        if (woChanged) qc.invalidateQueries({ queryKey: ['work-orders'] })
        qc.invalidateQueries({ queryKey: ['warranty-summary'] })
      }
    }
    prevRealtimeRef.current = cur
  }, [realtime.kpi, qc])

  // Surface a toast when a brand-new row lands (only after the initial
  // ready signal, so we don't fire on the first KPI snapshot).
  //
  // NOTE: the KPI broadcast carries only `{ count, delta }` — there is no
  // row id / assetCode / woNumber on the wire. The previous code guarded on
  // `e.id`, so these effects returned early every time and the "live update"
  // toast never fired. Describe the change using `delta` instead, which is
  // the data we actually receive.
  React.useEffect(() => {
    if (!realtimeReadyRef.current) return
    const e = realtime.lastDeviceCreated
    if (!e || !(e.delta && e.delta > 0)) return
    toast.success(t('dash.realtime.live'), {
      description: `+${e.delta} device${e.delta > 1 ? 's' : ''} (${e.count} total)`,
      duration: 4000,
    })
  }, [realtime.lastDeviceCreated, t])

  React.useEffect(() => {
    if (!realtimeReadyRef.current) return
    const e = realtime.lastWorkOrderCreated
    if (!e || !(e.delta && e.delta > 0)) return
    toast.success(t('dash.realtime.live'), {
      description: `+${e.delta} work order${e.delta > 1 ? 's' : ''} (${e.count} total)`,
      duration: 4000,
    })
  }, [realtime.lastWorkOrderCreated, t])

  React.useEffect(() => {
    if (!realtimeReadyRef.current) return
    const e = realtime.lastMeterRecorded
    if (!e || !(e.delta && e.delta > 0)) return
    toast.success(t('dash.realtime.live'), {
      description: `+${e.delta} meter reading${e.delta > 1 ? 's' : ''} (${e.count} total)`,
      duration: 4000,
    })
  }, [realtime.lastMeterRecorded, t])

  const [sitesOpen, setSitesOpen] = React.useState(false)
  const [heatOpen, setHeatOpen] = React.useState(false)
  // Print template selection dialog state (Task ID: FIX-1-2-EXPORT-PRINT)
  const [printTemplateOpen, setPrintTemplateOpen] = React.useState(false)
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null)
  const [glowKey, setGlowKey] = React.useState<string | null>(null)
  const [range, setRangeState] = React.useState<DashboardRangeKey>(() => {
    // Persist range in localStorage so it survives page refresh.
    // NOTE: the key is '30d' (per DashboardRangeKey / DASHBOARD_RANGE_OPTIONS),
    // NOT '30days' — the old check compared against '30days', so a persisted
    // 30-day range was rejected on reload and silently fell back to 'month'.
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('itam-dashboard-range')
      if (saved === 'month' || saved === '30d' || saved === 'quarter' || saved === 'all') {
        return saved
      }
    }
    return 'month'
  })
  const setRange = React.useCallback((r: DashboardRangeKey) => {
    setRangeState(r)
    if (typeof window !== 'undefined') {
      localStorage.setItem('itam-dashboard-range', r)
    }
  }, [])

  // Track previous totals to know which KPI changed
  const prevTotalsRef = React.useRef<{ total: number; active: number; spare: number; repair: number; meter: number } | null>(null)

  // Primary dashboard data (optimized /api/itam/dashboard API).
  // NOTE: The ITAM dashboard API doesn't support range — we send it for
  // forward-compat and display purposes; the API ignores unknown params.
  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery<DashboardData>({
    queryKey: ['itam-dashboard', range],
    queryFn: async () => {
      const res = await fetch(`/api/itam/dashboard?range=${range}`, {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    // Polling: 5 min (reduced from 60s to save Vercel Hobby CPU quota).
    // SSE is being removed — polling is the only update source now.
    refetchInterval: 300_000,
    refetchOnWindowFocus: false,
    staleTime: 300_000,
    placeholderData: (prev) => prev,
  })

  // Update "last updated" + glow flash when data changes
  const firstLoadRef = React.useRef(true)
  React.useEffect(() => {
    if (!data) return
    setLastUpdated(new Date(dataUpdatedAt))
    if (firstLoadRef.current) {
      firstLoadRef.current = false
      prevTotalsRef.current = {
        total: data.totals.total,
        active: data.totals.active,
        spare: data.totals.spare,
        repair: data.totals.repair,
        meter: data.meterRequiredCount,
      }
      return
    }
    const prev = prevTotalsRef.current
    if (prev) {
      const changes: { key: string; val: number }[] = [
        { key: 'total', val: data.totals.total },
        { key: 'active', val: data.totals.active },
        { key: 'spare', val: data.totals.spare },
        { key: 'repair', val: data.totals.repair },
        { key: 'meter', val: data.meterRequiredCount },
      ]
      const changed = changes.find(c => c.val !== prev[c.key as keyof typeof prev])
      if (changed) {
        setGlowKey(changed.key)
        const tid = setTimeout(() => setGlowKey(null), 1000)
        prevTotalsRef.current = {
          total: data.totals.total,
          active: data.totals.active,
          spare: data.totals.spare,
          repair: data.totals.repair,
          meter: data.meterRequiredCount,
        }
        return () => clearTimeout(tid)
      }
    }
  }, [data, dataUpdatedAt])

  // Heatmap (only fetched when its modal opens — heavy query)
  const { data: heatData, isLoading: heatLoading } = useQuery<DashboardData>({
    queryKey: ['itam-dashboard-extra', range],
    queryFn: async () => {
      const res = await fetch(`/api/itam/dashboard?extra=1&range=${range}`, {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: heatOpen,
  })

  // Smart insights
  interface InsightItem {
    type: string
    message: string
    priority?: number
    costImpactBath?: number
    recommendation?: string
    actionLabel?: string
    percent?: number
    count?: number
    total?: number
    month?: string
    prevMonth?: string
    current?: number
    prev?: number
    assetNo?: string
    [k: string]: unknown
  }
  interface InsightsResponse {
    insights: InsightItem[]
    meta?: {
      currentMonth?: string
      prevMonth?: string
      totals?: {
        currentMonthSheets?: number
        prevMonthSheets?: number
        meterRequiredActive?: number
        readThisMonth?: number
      }
    }
  }
  const { data: insightsData, isLoading: insightsLoading } = useQuery<InsightsResponse>({
    queryKey: ['itam-dashboard-insights'],
    queryFn: async () => {
      const res = await fetch('/api/itam/dashboard/insights', {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    // Insights: 3 min instead of 1 min — they don't change quickly
    refetchInterval: 600_000,
    staleTime: 120_000,
  })
  const insights = insightsData?.insights ?? []
  const insightsMeta = insightsData?.meta
  const insightsTotals = insightsMeta?.totals

  // Active cycle (for the Cycle Progress widget)
  const { data: activeCycle, isLoading: cycleLoading } = useQuery<Cycle | null>({
    queryKey: ['active-cycle'],
    queryFn: async () => {
      const res = await fetch('/api/cycles?status=active', {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) return null
      const json = await res.json()
      return (json.cycles?.[0] as Cycle | undefined) ?? null
    },
    staleTime: 120_000,
    // Cycle info: 5 min instead of 2 min — cycles change daily, not minute-by-minute
    refetchInterval: 300_000,
  })

  // Reading progress for the active cycle
  const { data: remindersSummary } = useQuery<RemindersSummary>({
    queryKey: ['meter-reminders-summary'],
    queryFn: async () => {
      const res = await fetch('/api/meter/reminders', {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) return { hasActiveCycle: false, totalRead: 0, totalUnread: 0 }
      const json = await res.json()
      return {
        hasActiveCycle: Boolean(json.hasActiveCycle),
        totalRead: Number(json.totalRead ?? 0),
        totalUnread: Number(json.totalUnread ?? 0),
      }
    },
    staleTime: 60_000,
    // Reminders: 2 min instead of 1 min
    refetchInterval: 600_000,
  })

  // Work-order status counts for the role task banner ("N jobs awaiting your
  // review"). The dashboard payload does NOT include WO stats, so this is a
  // separate lightweight query against /api/work-orders (pageSize=1 — we only
  // read the `stats` aggregate, not the rows).
  const { data: woStatsData } = useQuery<{ stats: Record<string, number> }>({
    queryKey: ['work-orders', 'stats'],
    queryFn: async () => {
      const res = await fetch('/api/work-orders?page=1&pageSize=1', {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) return { stats: {} }
      const json = await res.json()
      return { stats: (json?.stats ?? {}) as Record<string, number> }
    },
    staleTime: 60_000,
    refetchInterval: 600_000,
  })

  // Warranty summary + per-device rows (feeds the warranty status widget)
  const { data: warrantyData, isLoading: warrantyLoading } = useQuery<WarrantyResponse>({
    queryKey: ['warranty-summary'],
    queryFn: async () => {
      const res = await fetch('/api/devices/warranty', {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) throw new Error('Failed to load warranty')
      const json = await res.json() as {
        summary: WarrantySummary
        devices?: Array<Record<string, unknown>>
      }
      // Keep only the fields the widget needs (devices can be ~2k rows on
      // real installs — don't hold the full objects in the query cache).
      const devices: WarrantyDevice[] = (json.devices ?? []).map((d) => ({
        assetCode: String(d.assetCode ?? ''),
        name: String(d.name ?? ''),
        brand: (d.brand as string | null) ?? null,
        model: (d.model as string | null) ?? null,
        site: (d.site as string | null) ?? null,
        warrantyExpiry: (d.warrantyExpiry as string | null) ?? null,
        status: (d.status as WarrantyDevice['status']) ?? 'unknown',
        daysUntilExpiry: (d.daysUntilExpiry as number | null) ?? null,
      }))
      return { summary: json.summary, devices }
    },
    staleTime: 60_000,
  })

  function exportPdf() {
    const win = window.open('', '_blank', 'width=900,height=1200')
    if (!win) {
      toast.warning(t('dash.export.popup_blocked'))
      return
    }
    const totals = data?.totals
    const total = totals?.total ?? 0
    const active = totals?.active ?? 0
    const spare = totals?.spare ?? 0
    const repair = totals?.repair ?? 0
    const paper = data?.paperThisMonth ?? 0
    const meterReq = data?.meterRequiredCount ?? 0
    const byType = data?.byType ?? []
    const bySite = data?.bySite ?? []
    const warrantyExpiring = warrantyData?.summary.expiring ?? 0
    const warrantyExpired = warrantyData?.summary.expired ?? 0
    const generatedAt = new Date().toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'long', timeStyle: 'short' })

    const esc = (s: string) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c))

    const kpiHtml = `
      <div class="kpi-grid">
        <div class="kpi"><div class="label">อุปกรณ์ทั้งหมด</div><div class="value">${total.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}<span class="unit">เครื่อง</span></div></div>
        <div class="kpi t-active"><div class="label">ใช้งานอยู่</div><div class="value">${active.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}<span class="unit">เครื่อง</span></div></div>
        <div class="kpi t-spare"><div class="label">สำรอง</div><div class="value">${spare.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}<span class="unit">เครื่อง</span></div></div>
        <div class="kpi t-repair"><div class="label">ส่งซ่อม</div><div class="value">${repair.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}<span class="unit">เครื่อง</span></div></div>
        <div class="kpi t-paper"><div class="label">กระดาษเดือนนี้</div><div class="value">${paper.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}<span class="unit">แผ่น</span></div></div>
      </div>
      <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);margin-top:8px">
        <div class="kpi"><div class="label">ต้องจดมิเตอร์</div><div class="value">${meterReq.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}<span class="unit">เครื่อง</span></div></div>
        <div class="kpi"><div class="label">รับประกันใกล้หมด/หมดแล้ว</div><div class="value">${(warrantyExpiring + warrantyExpired).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}<span class="unit">เครื่อง</span></div></div>
      </div>`

    const typeRows = byType.map(ty => `<tr><td>${esc(ty.name)}</td><td class="num">${ty.value.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</td><td class="num">${total > 0 ? Math.round((ty.value / total) * 100) : 0}%</td></tr>`).join('')
    const siteRows = bySite.map(s => `<tr><td>${esc(s.siteCode)}</td><td>${esc(s.siteName || '')}</td><td class="num">${(s.deviceCount ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</td><td class="num">${(s.activeCount ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</td><td class="num">${(s.paperSheets ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</td></tr>`).join('')

    const html = `<!doctype html><html lang="th"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ITAM Dashboard Report</title>
<style>
@page { size: A4; margin: 15mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; font-family: 'Sukhumvit Set', 'Thonburi', 'Tahoma', sans-serif; color: #1e293b; font-size: 12px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.header { border-bottom: 3px solid #f97316; padding-bottom: 10px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-start; }
.header .org { font-size: 18px; font-weight: 700; color: #0f172a; }
.header .subtitle { font-size: 13px; color: #475569; margin-top: 2px; }
.header .meta { text-align: right; font-size: 11px; color: #64748b; }
h2.section { font-size: 13px; font-weight: 700; color: #0f172a; margin: 22px 0 8px; padding: 6px 10px; background: linear-gradient(90deg, #fff7ed 0%, #ffffff 100%); border-left: 4px solid #f97316; border-radius: 3px; }
table { width: 100%; border-collapse: collapse; margin-top: 4px; }
th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; font-size: 11px; vertical-align: top; }
th { background: #f8fafc; color: #475569; font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr:nth-child(even) td { background: #fafbfc; }
.kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 6px 0 4px; }
.kpi { border: 1px solid #e2e8f0; border-top: 3px solid #f97316; border-radius: 4px; padding: 10px; background: #ffffff; }
.kpi .label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
.kpi .value { font-size: 22px; font-weight: 700; color: #0f172a; line-height: 1.1; margin-top: 4px; font-variant-numeric: tabular-nums; }
.kpi .unit { font-size: 11px; color: #94a3b8; margin-left: 3px; font-weight: 500; }
.kpi.t-active { border-top-color: #10b981; } .kpi.t-active .value { color: #10b981; }
.kpi.t-spare { border-top-color: #f59e0b; } .kpi.t-spare .value { color: #d97706; }
.kpi.t-repair { border-top-color: #f97316; } .kpi.t-repair .value { color: #ea580c; }
.kpi.t-paper { border-top-color: #0d9488; } .kpi.t-paper .value { color: #0d9488; }
.footer { margin-top: 28px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; }
.footer .brand { color: #f97316; font-weight: 700; letter-spacing: 0.04em; }
.print-btn { position: fixed; top: 12px; right: 12px; background: #f97316; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
.print-btn:hover { background: #ea580c; }
@media print { .no-print { display: none; } .header { page-break-after: avoid; } h2.section { page-break-after: avoid; } table { page-break-inside: avoid; } }
</style></head><body>
<button class="print-btn no-print" onclick="window.print()">🖨 พิมพ์ / บันทึก PDF</button>
<div class="header">
  <div><div class="org">องค์กร</div><div class="subtitle">ITAM Dashboard Report <span style="color:#f97316;font-weight:600">⚡ ${data?.queryTimeMs ?? 0}ms</span></div></div>
  <div class="meta"><div>วันที่ออกรายงาน: ${esc(generatedAt)}</div><div>ออกโดย: admin@example.com</div></div>
</div>
<h2 class="section">📊 สรุปตัวชี้วัดหลัก (KPI)</h2>
${kpiHtml}
<h2 class="section">💻 จำนวนอุปกรณ์ตามประเภท</h2>
<table><thead><tr><th>ประเภท</th><th class="num">จำนวน</th><th class="num">สัดส่วน</th></tr></thead><tbody>${typeRows || '<tr><td colspan="3" class="num">—</td></tr>'}</tbody></table>
<h2 class="section">🏢 อุปกรณ์ตามสาขา</h2>
<table><thead><tr><th>รหัสสาขา</th><th>ชื่อสาขา</th><th class="num">ทั้งหมด</th><th class="num">ใช้งาน</th><th class="num">กระดาษ (แผ่น)</th></tr></thead><tbody>${siteRows || '<tr><td colspan="5" class="num">—</td></tr>'}</tbody></table>
<div class="footer"><div><span class="brand">องค์กร</span> — IT Asset Management</div><div>หน้า 1 · ${esc(generatedAt)}</div></div>
<script>window.addEventListener('load', function () { setTimeout(function () { try { window.print(); } catch (e) {} }, 250); });</script>
</body></html>`
    win.document.open()
    win.document.write(html)
    win.document.close()
    toast.success(t('dash.export.opening_pdf'))
  }

  // Site comparison sorted by devices
  const sortedSites = React.useMemo(() => {
    return [...(data?.bySite ?? [])].sort((a, b) => b.deviceCount - a.deviceCount)
  }, [data?.bySite])
  const maxDevices = sortedSites[0]?.deviceCount ?? 1

  // Heatmap
  const heat = heatData?.heatmap ?? []
  const heatMonths = heatData?.heatmapMonths ?? []
  const maxPages = React.useMemo(() => {
    let m = 0
    for (const r of heat) for (const c of r.months) if (c.pages > m) m = c.pages
    return m || 1
  }, [heat])

  // Donut chart data: status distribution.
  // NOTE: We store `nameKey` instead of the translated string so that the
  // useMemo doesn't have to recompute when the user toggles TH/EN. The
  // translated `name` is appended at render time below.
  const donutBaseData = React.useMemo(() => {
    if (!data) return []
    const totals = data.totals
    return [
      { value: totals.active, color: STATUS_COLORS[0], statusKey: 'Active', nameKey: 'status.active' },
      { value: totals.spare, color: STATUS_COLORS[1], statusKey: 'In Stock', nameKey: 'status.in_stock' },
      { value: totals.repair, color: STATUS_COLORS[2], statusKey: 'Pending Repair', nameKey: 'status.pending_repair' },
      { value: totals.inactive, color: STATUS_COLORS[3], statusKey: 'Inactive', nameKey: 'status.inactive' },
    ].filter(d => d.value > 0)
  }, [data])

  // Resolve translated names at render time — recomputed every render, so
  // toggling language updates the chart labels immediately.
  const donutData = donutBaseData.map(d => ({ ...d, name: t(d.nameKey) }))

  const donutTotal = donutData.reduce((sum, d) => sum + d.value, 0)

  // Bar chart: by type (top 8)
  const barData = React.useMemo(() => (data?.byType ?? []).slice(0, 8), [data])

  // Area chart: paper trend + linear-regression forecast for next month.
  // We append a 7th "คาดการณ์" point and split the chart data into two
  // dataKeys so the forecast segment is rendered with a dashed amber line.
  interface AreaPoint {
    month: string
    sheets: number | null
    forecastSheets: number | null
    isForecast?: boolean
  }
  const { areaData, forecastSheets, forecastReliability } = React.useMemo(() => {
    const base = (data?.paperTrend ?? []).map((p) => ({
      month: p.month,
      sheets: p.sheets as number | null,
      forecastSheets: null as number | null,
      isForecast: false,
    }))
    if (base.length < 3) {
      return { areaData: base as AreaPoint[], forecastSheets: null as number | null, forecastReliability: 'insufficient' as 'insufficient' }
    }
    // Exclude the LAST month from the regression if it looks like an
    // incomplete/partial month (e.g., current month where only a few devices
    // have been read so far). Heuristic: if the last value is < 20% of the
    // second-to-last value, treat it as partial and exclude from regression.
    const ys0 = base.map((pt) => pt.sheets ?? 0)
    let regStart = 0
    let regEnd = base.length // exclusive
    if (base.length >= 4) {
      const lastVal = ys0[ys0.length - 1]
      const prevVal = ys0[ys0.length - 2]
      if (prevVal > 0 && lastVal < prevVal * 0.2) {
        // Last month is likely partial — exclude from regression.
        regEnd = base.length - 1
      }
    }
    const regPoints = ys0.slice(regStart, regEnd)
    const n = regPoints.length
    if (n < 3) {
      return { areaData: base as AreaPoint[], forecastSheets: null as number | null, forecastReliability: 'insufficient' as 'insufficient' }
    }
    // Simple linear regression: y = mx + b over the regression points
    const xs = regPoints.map((_, i) => i)
    const ys = regPoints
    const sumX = xs.reduce((a, b) => a + b, 0)
    const sumY = ys.reduce((a, b) => a + b, 0)
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0)
    const sumXX = xs.reduce((s, x) => s + x * x, 0)
    const denom = n * sumXX - sumX * sumX
    if (denom === 0) {
      return { areaData: base as AreaPoint[], forecastSheets: null as number | null, forecastReliability: 'insufficient' as 'insufficient' }
    }
    const m = (n * sumXY - sumX * sumY) / denom
    const b = (sumY - m * sumX) / n
    // Predict the NEXT month (index = n, since regression used indices 0..n-1)
    const rawForecast = Math.round(m * n + b)

    // Compute R² to gauge forecast reliability
    const meanY = sumY / n
    let ssTot = 0
    let ssRes = 0
    for (let i = 0; i < n; i++) {
      const predicted = m * i + b
      ssTot += (ys[i] - meanY) ** 2
      ssRes += (ys[i] - predicted) ** 2
    }
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0
    let reliability: 'high' | 'medium' | 'low' = 'low'
    if (r2 >= 0.7) reliability = 'high'
    else if (r2 >= 0.4) reliability = 'medium'

    // Sanity check: if the linear forecast is suspiciously low (less than 30%
    // of the recent 3-month average), fall back to the 3-month moving average.
    // This handles cases where an outlier (e.g., a bulk data import in March)
    // makes the linear regression predict an unrealistic near-zero value.
    const recentSlice = ys.slice(-3)
    const recentAvg = recentSlice.length > 0
      ? Math.round(recentSlice.reduce((a, c) => a + c, 0) / recentSlice.length)
      : 0
    let forecast = Math.max(0, rawForecast)
    if (recentAvg > 0 && forecast < recentAvg * 0.3) {
      // Linear forecast is unrealistic — use 3-month moving average instead
      forecast = recentAvg
      reliability = reliability === 'high' ? 'medium' : 'low'
    }

    // Bridge: repeat the last actual value on the forecast series so the
    // dashed line connects from the last real point to the projection.
    if (base.length > 0) {
      const last = base[base.length - 1]
      base[base.length - 1] = {
        ...last,
        forecastSheets: last.sheets,
      }
    }
    const forecastPoint: AreaPoint = {
      month: t('dash.forecast'),
      sheets: null,
      forecastSheets: forecast,
      isForecast: true,
    }
    return {
      areaData: [...base, forecastPoint],
      forecastSheets: forecast,
      forecastReliability: reliability,
    }
  }, [data, t, lang])

  // Drill-down handlers
  function drillDownStatus(statusKey: string) {
    setPendingDeviceStatus(statusKey)
    setPendingDeviceType(null)
    setActivePage('itam-devices')
    toast.info(t('dash.drill.status').replace('{status}', statusKey))
  }
  function drillDownType(typeName: string) {
    setPendingDeviceType(typeName)
    setPendingDeviceStatus(null)
    setActivePage('itam-devices')
    toast.info(t('dash.drill.type').replace('{type}', typeName))
  }

  // Recharts tooltip styles — polished for mobile legibility + hover depth.
  const tooltipStyle: React.CSSProperties = {
    background: isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)',
    border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
    borderRadius: '10px',
    fontSize: '12px',
    color: isDark ? '#f1f5f9' : '#1e293b',
    boxShadow: '0 8px 24px -4px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.06)',
    padding: '8px 12px',
    transition: 'transform 120ms ease-out, box-shadow 120ms ease-out',
    backdropFilter: 'blur(6px)',
  }

  const gridColor = isDark ? '#1e293b' : '#e2e8f0'
  const axisColor = isDark ? '#64748b' : '#64748b'

  function formatLastUpdated(): string {
    if (!lastUpdated) return '—'
    // Time-only formatting using the current language's locale.
    return lastUpdated.toLocaleTimeString(lang === 'th' ? 'th-TH' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  // Derived values for KPI widget
  const total = data?.totals.total ?? 0
  const active = data?.totals.active ?? 0
  const spare = data?.totals.spare ?? 0
  const repair = data?.totals.repair ?? 0
  const paperThisMonth = data?.paperThisMonth ?? 0
  // QA-ROUND-2026-09-16-C: paper-cost KPI + per-site breakdown (from the
  // extended bySite rows: paperBw/paperColor/paperCost per site).
  const siteCostRows = (data?.bySite ?? [])
    .filter((s) => (s.paperCost ?? 0) > 0)
    .map((s) => ({ name: s.siteName || s.siteCode, cost: s.paperCost ?? 0 }))
    .sort((a, b) => b.cost - a.cost)
  const paperCostTotal = siteCostRows.reduce((a, r) => a + r.cost, 0)
  // QA-ROUND-2026-09-16-D: 6-month paper-cost trend (dashboard API now prices
  // each month at per-site rates). Feeds the sparkline in the cost KPI card.
  const allCostPoints = (data?.paperTrend ?? []).map((p) => p.cost ?? 0)
  const costTrendPoints = allCostPoints.some((v) => v > 0) ? allCostPoints : []
  const costTrendLast = costTrendPoints.length >= 2 ? costTrendPoints[costTrendPoints.length - 1] : null
  const costTrendPrev = costTrendPoints.length >= 2 ? costTrendPoints[costTrendPoints.length - 2] : null
  const costMomPct =
    costTrendLast != null && costTrendPrev != null && costTrendPrev > 0
      ? Math.round(((costTrendLast - costTrendPrev) / costTrendPrev) * 100)
      : null
  const warrantyAlerts =
    (warrantyData?.summary.expiring ?? 0) +
    (warrantyData?.summary.expired ?? 0)
  // ── Warranty status widget derived data (QA-ROUND-2026-09-16-E) ──
  const warrantySegments = React.useMemo(() => {
    const s = warrantyData?.summary
    return [
      { key: 'active', count: s?.active ?? 0, color: '#10b981' },
      { key: 'expiring', count: s?.expiring ?? 0, color: '#f59e0b' },
      { key: 'expired', count: s?.expired ?? 0, color: '#f43f5e' },
      { key: 'unknown', count: s?.unknown ?? 0, color: '#94a3b8' },
    ]
  }, [warrantyData?.summary])
  const warrantyTotal = warrantySegments.reduce((a, seg) => a + seg.count, 0)
  const warrantyCoverage = warrantyTotal > 0 ? Math.round(((warrantyData?.summary.active ?? 0) / warrantyTotal) * 100) : null
  // Soonest FUTURE expiries (still covered today) — replacement planning list.
  const nextExpiries = React.useMemo(() => {
    return (warrantyData?.devices ?? [])
      .filter((d) => d.daysUntilExpiry != null && d.daysUntilExpiry >= 0)
      .sort((a, b) => (a.daysUntilExpiry ?? 0) - (b.daysUntilExpiry ?? 0))
      .slice(0, 3)
  }, [warrantyData?.devices])
  // Resolve the active range's labels via i18n so they flip with TH/EN.
  const rangeOpt = DASHBOARD_RANGE_OPTIONS.find((o) => o.value === range)
  const rangeInfoLabel = rangeOpt ? t(rangeOpt.labelKey) : t('dash.range.month')
  const paperKpiLabel = rangeOpt ? t(rangeOpt.kpiLabelKey) : t('dash.range.kpi_month')

  // ============== Widget content blocks ==============
  const kpiWidget = (
    <>
      {/* KPI row — 5 cards on lg */}
      <div className="grid grid-cols-2 gap-1.5 sm:gap-2 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
        <KpiCard
          title={t('dash.kpi.total')}
          value={total}
          icon={<Package className="h-4 w-4" />}
          accent="#0f172a"
          loading={isLoading}
          glow={glowKey === 'total'}
          trend={total > 0 ? t('dash.kpi.types_count').replace('{count}', String((data?.byType ?? []).length)) : undefined}
        />
        <KpiCard
          title={t('dash.kpi.active')}
          value={active}
          icon={<CheckCircle2 className="h-4 w-4" />}
          accent="#10b981"
          loading={isLoading}
          glow={glowKey === 'active'}
          trend={total > 0 ? t('dash.kpi.pct_of_total').replace('{pct}', String(Math.round((active / total) * 100))) : undefined}
        />
        <KpiCard
          title={t('dash.kpi.spare')}
          value={spare}
          icon={<Package className="h-4 w-4" />}
          accent="#f59e0b"
          loading={isLoading}
          glow={glowKey === 'spare'}
          trend={total > 0 ? t('dash.kpi.pct_of_total').replace('{pct}', String(Math.round((spare / total) * 100))) : undefined}
        />
        <KpiCard
          title={t('dash.kpi.repair')}
          value={repair}
          icon={<Wrench className="h-4 w-4" />}
          accent="#f97316"
          loading={isLoading}
          glow={glowKey === 'repair'}
          trend={repair > 0 ? t('dash.kpi.trend_repair_pending') : t('dash.kpi.trend_repair_ok')}
        />
        <KpiCard
          title={t('dash.kpi.meter_required')}
          value={data?.meterRequiredCount ?? 0}
          icon={<FileText className="h-4 w-4" />}
          accent="#0d9488"
          loading={isLoading}
          glow={glowKey === 'meter'}
          unit={t('dash.unit.device')}
        />
      </div>

      {/* Warranty status widget (QA-ROUND-2026-09-16-E) — upgraded from the
          old amber count-only bar. Shows the full coverage distribution
          (active/expiring/expired/unknown) as a segmented bar plus the next
          3 devices whose warranty ends soonest. Whole card still jumps to the
          devices page with the warranty filter applied. */}
      <div
        role="button"
        tabIndex={warrantyAlerts > 0 ? 0 : -1}
        onClick={() => {
          if (warrantyAlerts === 0) return
          setActivePage('devices')
          // Jump to whichever bucket actually has devices — filtering by
          // 'expiring' when only 'expired' rows exist would land on an
          // empty list (admin's common case: 0 expiring, 8 expired).
          setPendingWarrantyFilter((warrantyData?.summary.expiring ?? 0) > 0 ? 'expiring' : 'expired')
        }}
        onKeyDown={(e) => {
          if (warrantyAlerts === 0) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setActivePage('devices')
            setPendingWarrantyFilter((warrantyData?.summary.expiring ?? 0) > 0 ? 'expiring' : 'expired')
          }
        }}
        className={cn(
          'group relative w-full overflow-hidden rounded-lg border text-left shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950',
          warrantyAlerts > 0
            ? 'cursor-pointer border-amber-200 bg-amber-50/60 hover:-translate-y-0.5 hover:shadow-md dark:border-amber-800/60 dark:bg-amber-950/20'
            : 'cursor-default border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
        )}
      >
        {warrantyAlerts > 0 && (
          <div
            className="absolute inset-x-0 top-0 h-[3px]"
            style={{ background: 'linear-gradient(90deg, #f59e0b, #f97316)' }}
          />
        )}
        <div className="p-2.5 sm:p-3">
          {/* Loading state — skeletons instead of misleading zeros */}
          {warrantyLoading ? (
            <div className="space-y-2 py-0.5">
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-lg sm:h-9 sm:w-9" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-5 w-16" />
                </div>
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
              <div className="space-y-1.5 pt-1">
                <Skeleton className="h-2.5 w-full" />
                <Skeleton className="h-2.5 w-5/6" />
                <Skeleton className="h-2.5 w-2/3" />
              </div>
            </div>
          ) : (
          <>
          {/* Row 1: header — icon, alert count (or coverage), view-list hint */}
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-105 sm:h-9 sm:w-9',
                warrantyAlerts > 0 ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
              )}
            >
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {t('dash.warranty.status_title')}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-bold tabular-nums leading-tight text-slate-800 dark:text-slate-100 sm:text-xl">
                  {warrantyAlerts > 0 ? warrantyAlerts : `${warrantyCoverage ?? 0}%`}
                </span>
                <span className="shrink-0 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                  {warrantyAlerts > 0
                    ? t('dash.unit.device')
                    : t('dash.warranty.coverage')}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500">
                {warrantyAlerts > 0
                  ? `${t('dash.warranty.expiring_count').replace('{count}', String(warrantyData?.summary.expiring ?? 0))} · ${t('dash.warranty.expired_count').replace('{count}', String(warrantyData?.summary.expired ?? 0))}`
                  : (warrantyData?.summary.active ?? 0) === 0 && (warrantyData?.summary.unknown ?? 0) > 0
                    ? t('dash.warranty.no_data')
                    : t('dash.warranty.all_covered')}
              </div>
            </div>
            {warrantyAlerts > 0 && (
              <span className="shrink-0 rounded-md border border-amber-200 bg-white px-2 py-1 text-xs font-medium text-amber-600 opacity-0 transition-opacity group-hover:opacity-100 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-400">
                {t('dash.warranty.view_list')}
              </span>
            )}
          </div>

          {/* Row 2: segmented distribution bar + legend counts */}
          {warrantyTotal > 0 && (
            <div className="mt-2.5">
              <div
                className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                role="img"
                aria-label={`${t('dash.warranty.status_title')}: ${t('dash.warranty.active_count').replace('{count}', String(warrantyData?.summary.active ?? 0))}, ${t('dash.warranty.expiring_count').replace('{count}', String(warrantyData?.summary.expiring ?? 0))}, ${t('dash.warranty.expired_count').replace('{count}', String(warrantyData?.summary.expired ?? 0))}, ${t('dash.warranty.unknown_count').replace('{count}', String(warrantyData?.summary.unknown ?? 0))}`}
              >
                {warrantySegments.map((seg) =>
                  seg.count > 0 ? (
                    <div
                      key={seg.key}
                      className="h-full transition-all first:rounded-l-full last:rounded-r-full"
                      style={{
                        width: `${(seg.count / warrantyTotal) * 100}%`,
                        background: seg.color,
                        opacity: seg.key === 'active' ? 0.9 : 1,
                      }}
                      title={`${seg.key}: ${seg.count}`}
                    />
                  ) : null,
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                {warrantySegments.map((seg) => (
                  <span key={seg.key} className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: seg.color }} />
                    {seg.count.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                  </span>
                ))}
                {warrantyCoverage != null && (
                  <span className="ml-auto font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                    {t('dash.warranty.coverage')} {warrantyCoverage}%
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Row 3: next-to-expire list (soonest future expiries) */}
          {nextExpiries.length > 0 && (
            <div className="mt-2.5 border-t border-slate-200/70 pt-2 dark:border-slate-800/70">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {t('dash.warranty.next_expiry')}
              </div>
              <div className="space-y-1">
                {nextExpiries.map((d) => {
                  const days = d.daysUntilExpiry ?? 0
                  const urgent = days <= 30
                  return (
                    <div key={d.assetCode} className="flex items-center gap-2 text-[11px]">
                      <span className="w-24 shrink-0 truncate font-mono text-slate-600 dark:text-slate-300" title={`${d.assetCode} · ${d.site ?? ''}`}>
                        {d.assetCode}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-slate-500 dark:text-slate-400" title={`${d.name} ${d.brand ?? ''} ${d.model ?? ''}`}>
                        {d.name}
                      </span>
                      <span className="shrink-0 text-slate-400 dark:text-slate-500">{d.site}</span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                          urgent
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            : 'bg-slate-500/10 text-slate-500 dark:text-slate-400',
                        )}
                        title={d.warrantyExpiry ?? undefined}
                      >
                        {t('dash.warranty.days_left').replace('{count}', String(days))}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          </>
          )}
        </div>
      </div>

      {/* Paper-this-month mini card under the warranty bar */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3 2xl:grid-cols-4">
        <Card className="shadow-sm border-slate-200 transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="flex items-center justify-between p-2.5 sm:p-3">
            <div className="flex items-center gap-2 sm:gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-600 dark:text-teal-400 sm:h-9 sm:w-9">
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <div className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">{paperKpiLabel}</div>
                {isLoading ? (
                  <Skeleton className="mt-1 h-6 w-24" />
                ) : (
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100 sm:text-xl">
                      {(paperThisMonth ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                    </span>
                    <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">{t('dash.unit.sheet')}</span>
                  </div>
                )}
                <div className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500">
                  {t('dash.range.short')} {rangeInfoLabel}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* QA-ROUND-2026-09-16-C: paper COST card — money view of paper usage.
            bySite now carries per-site BW/color + cost (dashboard API), so the
            card shows the total plus a per-site breakdown when space allows. */}
        <Card className="shadow-sm border-emerald-200/70 transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-emerald-900/40 dark:bg-slate-900">
          <CardContent className="p-2.5 sm:p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 sm:gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 sm:h-9 sm:w-9">
                  <Wallet className="h-4 w-4" />
                </div>
                <div>
                  <div className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    ต้นทุนกระดาษ {paperKpiLabel.replace(/^กระดาษ\s*/, '')}
                  </div>
                  {isLoading ? (
                    <Skeleton className="mt-1 h-6 w-24" />
                  ) : (
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400 sm:text-xl">
                        ฿{paperCostTotal.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { maximumFractionDigits: 0 })}
                      </span>
                      <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                        ≈ {(paperCostTotal / Math.max(1, paperThisMonth)).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { maximumFractionDigits: 2 })} ฿/แผ่น
                      </span>
                    </div>
                  )}
                  <div className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500">
                    คิดตามอัตราค่ากระดาษรายสาขา
                  </div>
                </div>
              </div>
              {/* 6-month cost trend sparkline + MoM badge (desktop only —
                  the card is too narrow on phones). Rising cost = red arrow
                  (more spend), falling = green (savings). */}
              {!isLoading && costTrendPoints.length >= 2 && (
                <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                  {costMomPct != null && (
                    <span
                      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                        costMomPct > 0
                          ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                          : costMomPct < 0
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'bg-slate-500/10 text-slate-500 dark:text-slate-400'
                      }`}
                      title="การเปลี่ยนแปลงต้นทุนกระดาษเทียบเดือนก่อน"
                    >
                      {costMomPct > 0 ? '▲' : costMomPct < 0 ? '▼' : '•'} {Math.abs(costMomPct)}%
                    </span>
                  )}
                  <CostSparkline points={costTrendPoints} />
                </div>
              )}
            </div>
            {/* Per-site cost breakdown bars (hidden on very small screens) */}
            {!isLoading && siteCostRows.length > 1 && (
              <div className="mt-2 hidden space-y-1 sm:block">
                {siteCostRows.map((row) => {
                  const pct = paperCostTotal > 0 ? Math.round((row.cost / paperCostTotal) * 100) : 0
                  return (
                    <div key={row.name} className="flex items-center gap-2 text-[10px]">
                      <span className="w-20 shrink-0 truncate text-slate-500 dark:text-slate-400" title={row.name}>
                        {row.name}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all"
                          style={{ width: `${Math.max(pct, 2)}%` }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                        ฿{row.cost.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { maximumFractionDigits: 0 })}
                      </span>
                      <span className="w-8 shrink-0 text-right tabular-nums text-slate-400">{pct}%</span>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm border-slate-200 transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="flex items-center justify-between p-2.5 sm:p-3">
            <div className="flex items-center gap-2 sm:gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-500/15 text-orange-600 dark:text-orange-400 sm:h-9 sm:w-9">
                <Building2 className="h-4 w-4" />
              </div>
              <div>
                <div className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('dash.kpi.sites')}</div>
                {isLoading ? (
                  <Skeleton className="mt-1 h-6 w-16" />
                ) : (
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100 sm:text-xl">
                      {(data?.bySite ?? []).length}
                    </span>
                    <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">{t('dash.unit.site')}</span>
                  </div>
                )}
                <div className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500">
                  ⚡ {data?.queryTimeMs ?? 0}ms
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Realtime extras — pulled from the socket.io push, not the REST API.
            Visible only while the realtime service is connected. When it's
            offline, the existing KPIs above still cover the dashboard's core
            counts via polling. */}
        {realtime.isConnected && realtime.kpi && (
          <Card className="shadow-sm border-emerald-200/70 bg-emerald-50/40 transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <CardContent className="p-2.5 sm:p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                <span>● {t('dash.realtime.live')}</span>
                <span className="ml-auto text-slate-400 dark:text-slate-500">
                  {new Date(realtime.lastUpdate ?? Date.now()).toLocaleTimeString(
                    lang === 'th' ? 'th-TH' : 'en-GB',
                    { hour: '2-digit', minute: '2-digit', second: '2-digit' },
                  )}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t('dash.realtime.kpi_pending_wo')}
                  </div>
                  <div className="text-base font-bold tabular-nums text-slate-800 dark:text-slate-100 sm:text-lg">
                    {(realtime.kpi.pendingWO ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                  </div>
                </div>
                <div>
                  <div className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t('dash.realtime.kpi_low_stock')}
                  </div>
                  <div className="text-base font-bold tabular-nums text-slate-800 dark:text-slate-100 sm:text-lg">
                    {(realtime.kpi.lowStock ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                  </div>
                </div>
                <div>
                  <div className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t('dash.realtime.kpi_warranty_60d')}
                  </div>
                  <div className="text-base font-bold tabular-nums text-slate-800 dark:text-slate-100 sm:text-lg">
                    {(realtime.kpi.warrantyExpiring ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                  </div>
                </div>
              </div>
              {realtime.kpi.recentActivities && realtime.kpi.recentActivities.length > 0 && (
                <div className="mt-2 border-t border-emerald-200/60 pt-1.5 dark:border-emerald-900/40">
                  <div className="flex items-center gap-1 mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <Activity className="h-3 w-3" /> {t('dash.realtime.recent_events')}
                  </div>
                  <ul className="max-h-24 overflow-y-auto pr-1 space-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                    {realtime.kpi.recentActivities.slice(0, 5).map((a, idx) => (
                      <li key={`${a.createdAt}-${a.action}-${idx}`} className="flex items-center gap-1.5 truncate">
                        <span className={cn(
                          'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                          a.entity === 'Device' ? 'bg-teal-500'
                            : a.entity === 'WorkOrder' ? 'bg-orange-500'
                              : a.entity === 'MeterReading' ? 'bg-sky-500'
                                : a.entity === 'StockItem' ? 'bg-amber-500'
                                  : 'bg-violet-500',
                        )} />
                        <span className="truncate font-medium">{a.summary || a.action}</span>
                        <span className="ml-auto flex shrink-0 items-center gap-1 text-slate-400 dark:text-slate-500">
                          {a.actor && <span className="hidden max-w-24 truncate lg:inline" title={a.actor}>· {a.actor}</span>}
                          <time
                            className="rounded bg-slate-100 px-1 py-0.5 text-[9px] tabular-nums dark:bg-slate-800 dark:text-slate-400"
                            dateTime={new Date(a.createdAt).toISOString()}
                            title={new Date(a.createdAt).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                          >
                            {relativeTime(new Date(a.createdAt).toISOString())}
                          </time>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )

  const cycleWidget = (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <CycleProgressWidget
        activeCycle={activeCycle ?? null}
        cycleLoading={cycleLoading}
        remindersSummary={remindersSummary ?? null}
        onManageCycle={() => {
          setPendingMeterAction('open-cycle')
          setActivePage('meter')
        }}
        onCreateCycle={() => {
          setPendingMeterAction('open-cycle')
          setActivePage('meter')
        }}
      />
    </motion.div>
  )

  const insightsWidget = (
    <Card className="shadow-sm border-slate-200 transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CircleAlert className="h-4 w-4 text-[#f97316]" /> {t('dash.widget.insights')}
          {insightsLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        </CardTitle>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('dash.widget.insights_desc')}
        </p>
      </CardHeader>
      <CardContent>
        {/* Compact totals strip — surfaces meta.totals from the API */}
        {insightsTotals && (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-slate-100 bg-slate-50/60 px-3 py-1.5 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
            <span>
              {t('dash.insights.paper_this_month')}{' '}
              <span className="font-semibold tabular-nums">
                {(insightsTotals.currentMonthSheets ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
              </span>{' '}
              {t('dash.unit.sheet')}
            </span>
            <span className="text-slate-300 dark:text-slate-400">·</span>
            <span>
              {t('dash.insights.prev_month')}{' '}
              <span className="font-semibold tabular-nums">
                {(insightsTotals.prevMonthSheets ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
              </span>{' '}
              {t('dash.unit.sheet')}
            </span>
            <span className="text-slate-300 dark:text-slate-400">·</span>
            <span>
              {t('dash.insights.meter_done')}{' '}
              <span className="font-semibold tabular-nums">
                {insightsTotals.readThisMonth ?? 0}/{insightsTotals.meterRequiredActive ?? 0}
              </span>{' '}
              {t('dash.unit.device')}
            </span>
          </div>
        )}
        {insightsLoading ? (
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-md" />
            ))}
          </div>
        ) : insights.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-sm text-slate-400">
            <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            <div>{t('dash.widget.no_anomaly')}</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-3">
            {insights.slice(0, 6).map((ins, idx) => {
              const priority = Number(ins.priority ?? 5)
              const priorityColors: Record<number, string> = {
                1: 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30',
                2: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30',
                3: 'border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30',
                4: 'border-teal-300 bg-teal-50 dark:border-teal-800 dark:bg-teal-950/30',
              }
              const priorityLabelKeys = [
                'dash.insights.prio.critical',
                'dash.insights.prio.major',
                'dash.insights.prio.check',
                'dash.insights.prio.opportunity',
              ]
              const priorityLabel = (priority >= 1 && priority <= 4)
                ? t(priorityLabelKeys[priority - 1])
                : t('dash.insights.prio.info')
              const cardClass =
                priorityColors[priority] ||
                'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40'

              // Heading label per insight type (concise)
              const headingLabel =
                ins.type === 'high_usage'
                  ? t('dash.insights.heading.high_usage')
                  : ins.type === 'color_heavy'
                    ? t('dash.insights.heading.color_heavy')
                    : ins.type === 'not_read'
                      ? t('dash.insights.heading.not_read')
                      : ins.type === 'mom_change'
                        ? t('dash.insights.heading.mom_change')
                        : t('dash.insights.prio.info')

              const headingIcon =
                ins.type === 'high_usage' ? (
                  <AlertTriangle className="h-3.5 w-3.5" />
                ) : ins.type === 'color_heavy' ? (
                  <Palette className="h-3.5 w-3.5" />
                ) : ins.type === 'not_read' ? (
                  <FileText className="h-3.5 w-3.5" />
                ) : ins.type === 'mom_change' ? (
                  Number(ins.percent) > 0 ? (
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5" />
                  )
                ) : (
                  <CircleAlert className="h-3.5 w-3.5" />
                )

              // Cost impact: green if saving, red if cost
              const isSaving =
                ins.type === 'color_heavy' ||
                (ins.type === 'mom_change' && Number(ins.percent) < 0)
              const costValue = Number(ins.costImpactBath ?? 0)
              const showCost = costValue > 0
              const costColorClass = isSaving
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
              const costSign = isSaving ? '−' : '+'

              // Action handler — route to the right page
              function handleInsightAction() {
                if (ins.type === 'not_read') {
                  setActivePage('itam-meter-keyboard')
                } else if (ins.type === 'mom_change') {
                  setActivePage('itam-paper-analytics')
                } else {
                  setActivePage('itam-paper-analytics')
                }
              }

              return (
                <motion.div
                  key={`${ins.type}-${idx}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: idx * 0.04 }}
                  className={`rounded-md border ${cardClass} p-2.5`}
                >
                  {/* Row 1: priority badge + heading */}
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-sm bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-900/70 dark:text-slate-300">
                      {t('dash.insights.priority_label').replace('{n}', String(priority)).replace('{label}', priorityLabel)}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {headingIcon}
                      <span className="uppercase tracking-wide">{headingLabel}</span>
                    </span>
                  </div>
                  {/* Row 2: main message */}
                  <div className="text-xs text-slate-700 dark:text-slate-200">{ins.message}</div>
                  {/* Row 3: recommendation */}
                  {ins.recommendation && (
                    <div className="mt-1 flex items-start gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <span aria-hidden>💡</span>
                      <span>{ins.recommendation}</span>
                    </div>
                  )}
                  {/* Row 4: cost impact + action button */}
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    {showCost ? (
                      <span className={`text-xs font-semibold tabular-nums ${costColorClass}`}>
                        ≈ {costSign}
                        {costValue.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} {t('dash.insights.baht_per_month')}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">{t('dash.insights.no_cost_impact')}</span>
                    )}
                    {ins.actionLabel && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleInsightAction}
                        className="h-7 border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        {ins.actionLabel}
                        <ArrowRight className="ml-0.5 h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )

  const chartsWidget = (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {/* Donut chart — status distribution */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        <Card className="h-full shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
          <CardHeader>
            <CardTitle className="text-base">{t('dash.widget.status_distribution')}</CardTitle>
            <p className="sr-only">{t('dash.chart.click_sector')}</p>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-56 w-full rounded-md" />
            ) : donutData.length === 0 ? (
              <EmptyState message={t('dash.no_data')} />
            ) : (
              <div className="relative h-56 w-full">
                <VisibleResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={56}
                      outerRadius={84}
                      paddingAngle={2}
                      isAnimationActive
                      animationDuration={800}
                      animationEasing="ease-out"
                      stroke={isDark ? '#0f172a' : '#ffffff'}
                      strokeWidth={2}
                      onClick={(payload: { statusKey?: string }) => {
                        if (payload?.statusKey) drillDownStatus(payload.statusKey)
                      }}
                      cursor="pointer"
                      label={false}
                      labelLine={false}
                    >
                      {donutData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.color} />
                      ))}
                    </Pie>
                    <ReTooltip
                      contentStyle={tooltipStyle}
                      formatter={(v: number, n: string) => {
                        const pct = donutTotal > 0 ? ((v / donutTotal) * 100).toFixed(1) : '0'
                        return [`${(Number(v) || 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} ${t('dash.unit.device')} (${pct}%)`, n]
                      }}
                    />
                  </PieChart>
                </VisibleResponsiveContainer>
                {/* Center label */}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
                    {(donutTotal ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{t('dash.chart.total_devices')}</div>
                </div>
              </div>
            )}
            {donutData.length > 0 && !isLoading && (
              <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
                {donutData.map((d, i) => (
                  <button
                    key={i}
                    onClick={() => drillDownStatus(d.statusKey)}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:underline dark:text-slate-300"
                  >
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
                    {d.name} <span className="font-semibold tabular-nums">{(d.value ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Bar chart — by type top 8 */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut', delay: 0.05 }}
      >
        <Card className="h-full shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
          <CardHeader>
            <CardTitle className="text-base">{t('dash.widget.by_type_top8')}</CardTitle>
            <p className="sr-only">{t('dash.chart.click_bar')}</p>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-56 w-full rounded-md" />
            ) : barData.length === 0 ? (
              <EmptyState message={t('dash.no_data')} />
            ) : (
              <div className="h-56 w-full">
                <VisibleResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} margin={{ top: 12, right: 8, left: -10, bottom: 4 }}>
                    <defs>
                      <linearGradient id="barTealGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.98} />
                        <stop offset="55%" stopColor="#14b8a6" stopOpacity={0.92} />
                        <stop offset="100%" stopColor="#0d9488" stopOpacity={0.85} />
                      </linearGradient>
                      <linearGradient id="barOrangeActiveGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#fb923c" stopOpacity={0.98} />
                        <stop offset="55%" stopColor="#f97316" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="#ea580c" stopOpacity={0.9} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: axisColor, fontSize: 10 }}
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                      height={50}
                    />
                    <YAxis tick={{ fill: axisColor, fontSize: 11 }} allowDecimals={false} />
                    <ReTooltip
                      contentStyle={tooltipStyle}
                      cursor={{ fill: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}
                      formatter={(v: number) => [`${(Number(v) || 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} ${t('dash.unit.device')}`, t('dash.chart.count_label')]}
                    />
                    <Bar
                      dataKey="value"
                      radius={[6, 6, 0, 0]}
                      fill="url(#barTealGrad)"
                      isAnimationActive
                      animationDuration={800}
                      animationEasing="ease-out"
                      activeBar={{ fill: 'url(#barOrangeActiveGrad)', stroke: '#f97316', strokeWidth: 1 }}
                      onClick={(payload: { name?: string }) => {
                        if (payload?.name) drillDownType(payload.name)
                      }}
                      cursor="pointer"
                    >
                      <LabelList
                        dataKey="value"
                        position="top"
                        style={{ fill: isDark ? '#cbd5e1' : '#475569', fontSize: 10, fontWeight: 600 }}
                      />
                    </Bar>
                  </BarChart>
                </VisibleResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )

  const paperTrendWidget = (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut', delay: 0.1 }}
    >
      <Card className="shadow-sm border-slate-200 transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
        <CardHeader>
          <CardTitle className="text-base">{t('dash.widget.paper_trend_6m')}</CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('dash.widget.paper_trend_desc')}</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-56 w-full rounded-md" />
          ) : areaData.length === 0 ? (
            <EmptyState message={t('dash.no_data')} />
          ) : (
            <>
              <div className="h-56 w-full">
                <VisibleResponsiveContainer width="100%" height="100%">
                  <AreaChart data={areaData} margin={{ top: 10, right: 12, left: -8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="areaTealGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0d9488" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#0d9488" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="areaForecastGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                    <XAxis dataKey="month" tick={{ fill: axisColor, fontSize: 11 }} />
                    <YAxis tick={{ fill: axisColor, fontSize: 11 }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`} />
                    <ReTooltip
                      contentStyle={tooltipStyle}
                      formatter={(v: number, _n: string, p: { payload?: { month?: string; isForecast?: boolean } }) => [
                        `${(Number(v) || 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} ${t('dash.unit.sheet')}`,
                        `${p?.payload?.isForecast ? t('dash.forecast') : (p?.payload?.month ?? '')}`,
                      ]}
                      labelFormatter={() => ''}
                    />
                    {forecastSheets !== null && (
                      <ReferenceLine
                        x={t('dash.forecast')}
                        stroke="#f59e0b"
                        strokeDasharray="4 4"
                        label={{
                          value: t('dash.forecast_label'),
                          position: 'top',
                          fill: '#f59e0b',
                          fontSize: 10,
                          fontWeight: 600,
                        }}
                      />
                    )}
                    {/* Actual sheets — solid teal line + teal dots */}
                    <Area
                      type="monotone"
                      dataKey="sheets"
                      stroke="#0d9488"
                      strokeWidth={2.5}
                      fill="url(#areaTealGrad)"
                      isAnimationActive
                      animationDuration={800}
                      animationEasing="ease-out"
                      connectNulls={false}
                      dot={(props: {
                        cx?: number
                        cy?: number
                        payload?: { isForecast?: boolean }
                      }) => {
                        const { cx, cy, payload } = props
                        if (typeof cx !== 'number' || typeof cy !== 'number') {
                          return <g key={`empty-${cx}-${cy}`} />
                        }
                        // Skip dot on the forecast point (it has sheets=null)
                        if (payload?.isForecast) return <g key={`skip-${cx}-${cy}`} />
                        return (
                          <circle
                            key={`dot-${cx}-${cy}`}
                            cx={cx}
                            cy={cy}
                            r={4}
                            fill={isDark ? '#0f172a' : '#ffffff'}
                            stroke="#0d9488"
                            strokeWidth={2}
                          />
                        )
                      }}
                      activeDot={{ r: 6, fill: '#0d9488', stroke: isDark ? '#0f172a' : '#fff', strokeWidth: 2 }}
                    />
                    {/* Forecast — dashed amber line, only visible between the
                        last actual point and the projection (bridge value
                        repeats the last actual to connect the segment). */}
                    {forecastSheets !== null && (
                      <Area
                        type="monotone"
                        dataKey="forecastSheets"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        fill="url(#areaForecastGrad)"
                        isAnimationActive
                        animationDuration={800}
                        animationEasing="ease-out"
                        connectNulls={false}
                        dot={(props: {
                          cx?: number
                          cy?: number
                          payload?: { isForecast?: boolean; forecastSheets?: number | null }
                        }) => {
                          const { cx, cy, payload } = props
                          if (typeof cx !== 'number' || typeof cy !== 'number') {
                            return <g key={`empty-${cx}-${cy}`} />
                          }
                          // Skip the bridge dot on the last actual point
                          if (!payload?.isForecast) return <g key={`bridge-${cx}-${cy}`} />
                          return (
                            <g key="forecast-dot">
                              <circle
                                cx={cx}
                                cy={cy}
                                r={6}
                                fill="#f59e0b"
                                stroke={isDark ? '#0f172a' : '#fff'}
                                strokeWidth={2}
                              />
                              <circle
                                cx={cx}
                                cy={cy}
                                r={3}
                                fill="none"
                                stroke={isDark ? '#fde68a' : '#fffbeb'}
                                strokeWidth={1}
                                strokeDasharray="2 1"
                              />
                            </g>
                          )
                        }}
                        activeDot={{ r: 6, fill: '#f59e0b', stroke: isDark ? '#0f172a' : '#fff', strokeWidth: 2 }}
                      />
                    )}
                  </AreaChart>
                </VisibleResponsiveContainer>
              </div>
              {forecastSheets !== null && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <span aria-hidden>🔮</span>
                  <span>
                    {t('dash.forecast_next_month')}{' '}
                    <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                      ~{(forecastSheets ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} {t('dash.unit.sheet')}
                    </span>{' '}
                    <span className="text-slate-400">
                      ({forecastReliability === 'high'
                        ? t('dash.forecast.high')
                        : forecastReliability === 'medium'
                          ? t('dash.forecast.medium')
                          : forecastReliability === 'low'
                            ? t('dash.forecast.low')
                            : t('dash.forecast.insufficient')})
                    </span>
                  </span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )

  const bySiteWidget = (
    <Card className="shadow-sm border-slate-200 transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-[#f97316]" /> {t('dash.widget.by_site')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        ) : (data?.bySite ?? []).length === 0 ? (
          <EmptyState message={t('dash.no_site_data')} />
        ) : (
          <div className="itam-scroll max-h-72 space-y-2 overflow-y-auto pr-1">
            {(data?.bySite ?? []).map((s, idx) => (
              <div
                key={s.siteCode || `site-${idx}`}
                className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2 dark:border-slate-800"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{s.siteCode}</span>
                  <span className="ml-2 text-xs text-slate-400">{s.siteName}</span>
                </div>
                <Badge className="border-teal-300 bg-teal-100 text-teal-800 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300">
                  {s.deviceCount} {t('dash.unit.device')}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )

  const recentActivityWidget = (
    <Card className="shadow-sm border-slate-200 transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-[#f97316]" /> {t('dash.widget.recent_activity')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        ) : (data?.recentActivity ?? []).length === 0 ? (
          <EmptyState message={t('dash.no_activity')} />
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {(data?.recentActivity ?? []).map((a) => (
                <motion.div
                  key={a.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{a.deviceName}</div>
                    <div className="text-xs text-slate-400">{a.assetCode} · {formatDate(a.readingDate)}</div>
                  </div>
                  <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    {((a.pagesBw ?? 0) + (a.pagesColor ?? 0)).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} {t('dash.unit.sheet')}
                  </Badge>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </CardContent>
    </Card>
  )

  const lifecycleWidget = <LifecycleDashboard />
  const depreciationWidget = <DepreciationSection />
  const reportsWidget = <ReportsSection />

  function renderWidget(id: WidgetId): React.ReactNode {
    switch (id) {
      case 'kpi': return kpiWidget
      case 'cycle': return cycleWidget
      case 'insights': return insightsWidget
      case 'charts': return chartsWidget
      case 'paperTrend': return paperTrendWidget
      case 'bySite': return bySiteWidget
      case 'recentActivity': return recentActivityWidget
      case 'lifecycle': return lifecycleWidget
      case 'depreciation': return depreciationWidget
      case 'reports': return reportsWidget
      // 'topDevices' is not available with the ITAM dashboard API (no topUsage field).
      case 'topDevices': return null
      default: return null
    }
  }

  return (
    <div className="flex h-full flex-col p-3 md:p-4">
      {/* SPRINT-3 #6: Role-based "my tasks" banner for meter/technician roles
          — shows pending meter readings or assigned WOs at the top so the
          user sees what to do immediately without scrolling past KPI cards
          that are more relevant to admins/managers. */}
      <RoleTaskBanner
        // Unread meters come from /api/meter/reminders (totalUnread), NOT from
        // the dashboard payload — `data.meterUnread` never existed, so the
        // banner previously always rendered "0 devices need a meter reading".
        pendingMeterCount={remindersSummary?.totalUnread ?? 0}
        pendingWoCount={woStatsData?.stats?.PENDING_REVIEW ?? 0}
        setActivePage={setActivePage}
        setPendingMeterAction={setPendingMeterAction}
      />
      {/* Page header — FIXED, never scrolls away */}
      <div className="flex-shrink-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{t('dash.title')}</h1>
            {/* Realtime (Socket.io) status badge.
                ● Live  = server reachable, KPIs push every 30s
                ○ Offline = server down; dashboard falls back to 5-min polling */}
            <span
              role="status"
              aria-live="polite"
              title={realtime.isConnected ? t('dash.realtime.live_hint') : t('dash.realtime.offline_hint')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors',
                realtime.isConnected
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-400'
                  : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400',
              )}
            >
              {realtime.isConnected ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  <span>● {t('dash.realtime.live')}</span>
                  {realtime.kpi && (
                    <span className="ml-1 hidden text-emerald-600/70 dark:text-emerald-400/70 sm:inline">
                      · {realtime.kpi.devices.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} dev · {realtime.kpi.workOrders.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} wo
                    </span>
                  )}
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3" />
                  <span>○ {t('dash.realtime.offline')}</span>
                </>
              )}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('dash.subtitle')}
            {data && <span className="ml-2 text-xs text-emerald-600">⚡ {data.queryTimeMs}ms</span>}
            <span className="ml-2 text-xs text-slate-400">· {t('dash.range.short')} <span className="font-medium">{rangeInfoLabel}</span></span>
            {realtime.lastUpdate && (
              <span className="ml-2 text-xs text-slate-400">
                · {t('dash.realtime.last_push')} <span className="font-mono tabular-nums">
                  {new Date(realtime.lastUpdate).toLocaleTimeString(lang === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </span>
            )}
          </p>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span>{t('dash.last_updated')} <span className="font-mono tabular-nums">{formatLastUpdated()}</span></span>
            <span className="text-slate-300">· auto 30s</span>
            {isFetching && (
              <span className="ml-1 inline-flex items-center gap-1 text-orange-500">
                <Loader2 className="h-3 w-3 animate-spin" /> {t('dash.syncing')}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={range} onValueChange={(v) => setRange(v as DashboardRangeKey)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder={t('dash.range')} />
            </SelectTrigger>
            <SelectContent>
              {DASHBOARD_RANGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {t(o.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button"
            variant="outline"
            size="sm"
            onClick={async () => { await refetch(); toast.success(t('dash.refreshed')) }}
            disabled={isFetching}
            className="dark:bg-slate-800 dark:border-slate-700"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> {t('dash.refresh')}
          </Button>
          {/* Secondary actions — visible inline on sm+, collapsed into a
              "⋯ เพิ่มเติม" dropdown on mobile to keep the first row to
              Range + Refresh + More. */}
          <Button type="button"
            variant="outline"
            size="sm"
            onClick={exportPdf}
            disabled={isLoading || total === 0}
            title={isLoading || total === 0 ? t('dash.export_pdf.disabled_hint') : t('dash.export_pdf')}
            className="hidden border-[#0d9488] text-[#0d9488] hover:bg-[#0d9488]/10 dark:border-[#14b8a6] dark:text-[#14b8a6] sm:inline-flex"
          >
            <FileDown className="h-4 w-4" /> PDF
          </Button>
          {/* พิมพ์ (เทมเพลต) — Task ID: FIX-1-2-EXPORT-PRINT */}
          <Button type="button"
            variant="outline"
            size="sm"
            onClick={() => setPrintTemplateOpen(true)}
            className="hidden border-[#f97316] text-[#f97316] hover:bg-[#f97316]/10 dark:border-[#fb923c] dark:text-[#fb923c] sm:inline-flex"
            title={t('dash.print.template_hint')}
          >
            <Printer className="h-4 w-4" /> {t('dash.print')}
          </Button>
          <Button type="button"
            variant="outline"
            size="sm"
            onClick={() => setSitesOpen(true)}
            className="hidden dark:bg-slate-800 dark:border-slate-700 sm:inline-flex"
          >
            <Building2 className="h-4 w-4" /> {t('dash.sites')}
          </Button>
          <Button type="button"
            variant="outline"
            size="sm"
            onClick={() => setHeatOpen(true)}
            className="hidden dark:bg-slate-800 dark:border-slate-700 sm:inline-flex"
          >
            <Flame className="h-4 w-4" /> {t('dash.heatmap')}
          </Button>
          <Button type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('dashboard:open-customize'))
              }
            }}
            className="hidden border-[#f97316] text-[#f97316] hover:bg-[#f97316]/10 dark:border-[#fb923c] dark:text-[#fb923c] sm:inline-flex"
            title={t('dash.customize_widgets')}
          >
            <Settings2 className="h-4 w-4" /> {t('dash.widget.customize')}
          </Button>
          {/* Mobile-only overflow dropdown for secondary actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button"
                variant="outline"
                size="sm"
                className="sm:hidden"
                aria-label={t('dash.more_actions')}
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="ml-1">{t('dash.more')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={exportPdf}
                disabled={isLoading || total === 0}
              >
                <FileDown className="mr-2 h-4 w-4" />
                PDF
              </DropdownMenuItem>
              {/* พิมพ์ (เทมเพลต) — Task ID: FIX-1-2-EXPORT-PRINT */}
              <DropdownMenuItem
                onClick={() => setPrintTemplateOpen(true)}
              >
                <Printer className="mr-2 h-4 w-4" />
                {t('dash.print')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSitesOpen(true)}>
                <Building2 className="mr-2 h-4 w-4" />
                {t('dash.sites')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setHeatOpen(true)}>
                <Flame className="mr-2 h-4 w-4" />
                {t('dash.heatmap')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('dashboard:open-customize'))
                  }
                }}
              >
                <Settings2 className="mr-2 h-4 w-4" />
                {t('dash.customize_widgets')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      </div>

      {/* Content — scrolls internally, header stays visible */}
      <div className="min-h-0 flex-1 overflow-y-auto">

      {/* Quick Actions bar — 1-click access to the 4 most common tasks */}
      <QuickActionsBar
        unreadCount={remindersSummary?.totalUnread ?? 0}
        hasActiveCycle={remindersSummary?.hasActiveCycle ?? false}
        onGoMeter={() => setActivePage('itam-meter-keyboard')}
        onGoDevices={() => setActivePage('itam-devices')}
        onGoPaper={() => setActivePage('itam-paper-analytics')}
        onScan={() => useAppStore.getState().setQrScannerOpen(true)}
      />

      {/* Widget layout — drag-to-reorder + show/hide via "ปรับแต่ง" popover */}
      <DashboardWidgetLayout renderWidget={renderWidget} />

      </div>

      {/* Site comparison modal */}
      <Dialog open={sitesOpen} onOpenChange={setSitesOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <Trophy className="h-5 w-5 text-[#f97316]" /> {t('dash.widget.compare_sites')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-md" />
                ))}
              </div>
            ) : sortedSites.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">{t('dash.no_data')}</div>
            ) : (
              sortedSites.map((s, i) => {
                const pct = Math.max(2, (s.deviceCount / maxDevices) * 100)
                return (
                  <div key={s.siteCode || `site-${i}`} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                    <div className="mb-1.5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {i < 3 ? <span className="text-lg">{MEDALS[i]}</span> : <span className="inline-block w-4 text-center text-xs font-bold text-slate-400">{i + 1}</span>}
                        <span className="font-semibold text-slate-700 dark:text-slate-200">{s.siteCode}</span>
                        <span className="text-xs text-slate-400">{s.siteName}</span>
                      </div>
                      <Badge className="border-teal-300 bg-teal-100 text-teal-800 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300">
                        {s.deviceCount} {t('dash.unit.device')}
                      </Badge>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                      <motion.div
                        className="h-full rounded bg-gradient-to-r from-orange-400 to-orange-600"
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                      />
                    </div>
                    <div className="mt-1.5 flex justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span>{t('dash.compare.active').replace('{count}', String(s.activeCount ?? 0))}</span>
                      <span>{t('dash.compare.paper').replace('{count}', (s.paperSheets ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB'))}</span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Heatmap modal */}
      <Dialog open={heatOpen} onOpenChange={setHeatOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <Flame className="h-5 w-5 text-[#0d9488]" /> {t('dash.widget.heatmap')}
            </DialogTitle>
          </DialogHeader>
          {heatLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full rounded" />
              ))}
            </div>
          ) : heat.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">{t('dash.no_data')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-slate-100/95 px-2 py-1.5 text-left text-slate-600 dark:bg-slate-900/80 dark:text-slate-300">{t('dash.heatmap.device')}</th>
                    {heatMonths.map(m => (
                      <th key={m} className="px-2 py-1.5 text-center font-mono text-slate-500">{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heat.map(row => (
                    <tr key={row.assetCode}>
                      <td className="sticky left-0 z-10 max-w-[180px] truncate bg-slate-100/95 px-2 py-1 text-slate-700 dark:bg-slate-900/80 dark:text-slate-200" title={row.deviceName}>
                        <span className="font-mono text-[10px] text-slate-400">{row.assetCode}</span>
                        <div className="truncate">{row.deviceName}</div>
                      </td>
                      {row.months.map(c => {
                        const intensity = (c.pages ?? 0) / maxPages
                        const txtColor = intensity > 0.55 ? 'text-white' : 'text-slate-700 dark:text-slate-200'
                        return (
                          <td
                            key={c.month}
                            className={`px-2 py-1.5 text-center font-mono tabular-nums ${txtColor}`}
                            style={{ background: heatColor(intensity) }}
                            title={`${row.assetCode} · ${c.month}: ${(c.pages ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} ${t('dash.unit.sheet')}`}
                          >
                            {(c.pages ?? 0) > 0 ? (c.pages ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB') : '·'}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                <span>{t('dash.heatmap.less')}</span>
                {[0.1, 0.3, 0.5, 0.7, 0.9].map(i => (
                  <span key={i} className="h-3 w-8 rounded-sm" style={{ background: heatColor(i) }} />
                ))}
                <span>{t('dash.heatmap.more')}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Print Template Selection Dialog — Task ID: FIX-1-2-EXPORT-PRINT */}
      <PrintTemplateSelectionDialog
        open={printTemplateOpen}
        onOpenChange={setPrintTemplateOpen}
        templateType="work-order"
        actionLabel={t('dash.print')}
        onSelect={(template) => {
          toast.success(t('dash.print.template_selected').replace('{name}', template.name))
          if (typeof window !== 'undefined') window.print()
        }}
      />
    </div>
  )
}
