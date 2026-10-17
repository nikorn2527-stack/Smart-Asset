'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { Sun, Moon, Search, LogOut, QrCode, Menu,
  LayoutDashboard, Monitor, TrendingUp, Wrench, CalendarClock,
  Package, FileText, Smartphone, Download, BarChart3, Coins,
  Lock, Settings, ScrollText, type LucideIcon,
} from 'lucide-react'
import { useAppStore, type ActivePage } from '@/store/app-store'
import { isModuleEnabled, type ModuleName } from '@/config/modules'
import { useClock, formatThaiTime, formatThaiDate } from '@/hooks/use-clock'
import { useAuthStore, useNavVisibility, useRole } from '@/store/auth-store'
import { ROLE_LABELS, type Role } from '@/lib/rbac'
import { useT, useLang } from '@/store/i18n-store'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { NotificationsPopover } from './notifications-popover'
import { useRealtimeStatus } from '@/hooks/use-realtime-updates'

// Map of role → Thai label (the auth store returns a normalized role string)
function roleLabel(role: string | undefined | null): string {
  if (!role) return 'ผู้ใช้'
  return ROLE_LABELS[role as Role] ?? role
}

/** Build fetch headers with the user's JWT (if logged in). */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const token = useAuthStore.getState()?.token
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

interface NavItemDef {
  page: ActivePage
  icon: LucideIcon
  // i18n keys for label + description. Resolved at render time via `t()`.
  labelKey: string
  descKey?: string
  module?: ModuleName
}

interface NavGroupDef {
  // i18n key for the group title.
  titleKey: string
  items: NavItemDef[]
}

// Single consolidated nav — no more duplicate "ITAM" vs non-"ITAM" sets.
// Legacy page ids (devices/meter/paper-analytics/settings) are intentionally
// NOT shown here; they are kept as aliases in page.tsx for backward-compatible
// deep links from the dashboard / notifications / global search.
const NAV_GROUPS: NavGroupDef[] = [
  {
    titleKey: 'group.overview',
    items: [
      { page: 'dashboard', icon: LayoutDashboard, labelKey: 'menu.dashboard', descKey: 'desc.dashboard', module: 'dashboard' },
    ],
  },
  {
    titleKey: 'group.operations',
    items: [
      { page: 'itam-devices', icon: Monitor, labelKey: 'menu.devices', descKey: 'desc.devices', module: 'devices' },
      { page: 'itam-meter-keyboard', icon: TrendingUp, labelKey: 'menu.meter', descKey: 'desc.meter', module: 'meters' },
      { page: 'itam-work-orders', icon: Wrench, labelKey: 'menu.work_orders', descKey: 'desc.work_orders', module: 'work-orders' },
      { page: 'pm-schedules', icon: CalendarClock, labelKey: 'menu.pm_schedules', descKey: 'desc.pm_schedules', module: 'work-orders' },
      { page: 'itam-stock', icon: Package, labelKey: 'menu.stock', descKey: 'desc.stock', module: 'stock' },
      { page: 'itam-paper-analytics', icon: FileText, labelKey: 'menu.paper_analytics', descKey: 'desc.paper_analytics', module: 'paper-analytics' },
      { page: 'mobile', icon: Smartphone, labelKey: 'menu.mobile', descKey: 'desc.mobile', module: 'work-orders' },
    ],
  },
  {
    titleKey: 'group.tools',
    items: [
      { page: 'templates', icon: FileText, labelKey: 'menu.templates', descKey: 'desc.templates', module: 'templates' },
      { page: 'import', icon: Download, labelKey: 'menu.import', descKey: 'desc.import', module: 'import' },
      { page: 'reports-hub', icon: BarChart3, labelKey: 'menu.reports_hub', descKey: 'desc.reports_hub', module: 'reports' },
      { page: 'material-cost', icon: Coins, labelKey: 'menu.material_cost', descKey: 'desc.material_cost', module: 'reports' },
      { page: 'monthly-report', icon: CalendarClock, labelKey: 'menu.monthly_report', descKey: 'desc.monthly_report', module: 'reports' },
      // ── REMOVED: Snapshots menu ──
      // The meterReportSnapshot / meterReportSnapshotRow Prisma models were
      // removed from schema.prisma in an earlier migration, but the 4 v1 API
      // routes (/api/v1/snapshots/*) + snapshot-viewer.tsx component still
      // referenced them → every call crashed with "Cannot read properties of
      // undefined (reading 'findFirst')" → users saw a blank/error page.
      // Feature is intentionally disabled (per existing TODO comments).
    ],
  },
  {
    titleKey: 'group.system',
    items: [
      { page: 'itam-settings', icon: Settings, labelKey: 'menu.settings', descKey: 'desc.settings', module: 'settings' },
      { page: 'itam-audit', icon: ScrollText, labelKey: 'menu.audit', descKey: 'desc.audit', module: 'audit' },
    ],
  },
]

interface CycleInfo {
  id: string
  name: string
  startDate: string
  endDate: string
  status: string
  site?: string | null
}

function useCountdown(startDate?: string, endDate?: string) {
  return React.useMemo(() => {
    if (!endDate) return null
    const end = new Date(endDate).getTime()
    const start = startDate ? new Date(startDate).getTime() : end - 30 * 24 * 60 * 60 * 1000
    const now = Date.now()
    const diff = end - now
    const total = Math.max(1, end - start)
    const pct = Math.min(100, Math.max(0, ((now - start) / total) * 100))

    const bangkokNow = new Date(now + 7 * 60 * 60 * 1000)
    const todayStr = bangkokNow.toISOString().slice(0, 10)
    const todayDate = new Date(todayStr + 'T00:00:00')
    const startDateObj = startDate ? new Date(startDate + 'T00:00:00') : todayDate
    const endDateObj = new Date(endDate + 'T00:00:00')

    const startDiffMs = startDateObj.getTime() - todayDate.getTime()
    const daysUntilStart = Math.round(startDiffMs / (1000 * 60 * 60 * 24))

    const endDiffMs = endDateObj.getTime() - todayDate.getTime()
    const daysUntilEnd = Math.round(endDiffMs / (1000 * 60 * 60 * 24)) + 1

    const isPending = daysUntilStart > 0
    const isOverdue = daysUntilEnd < 0
    const isDeadlineDay = daysUntilEnd === 0
    const phase: 'pending' | 'active' | 'deadline' | 'overdue' =
      isPending ? 'pending' : isOverdue ? 'overdue' : isDeadlineDay ? 'deadline' : 'active'

    if (phase === 'pending') {
      return {
        days: daysUntilStart,
        hours: 0,
        pct: 0,
        ended: false,
        warning: false,
        phase,
        overdueDays: 0,
      }
    }

    if (isOverdue || isDeadlineDay) {
      const overdueDays = isOverdue ? Math.abs(daysUntilEnd) : 0
      return {
        days: 0,
        hours: 0,
        pct: 100,
        ended: true,
        warning: true,
        phase,
        overdueDays,
      }
    }

    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    const warning = daysUntilEnd <= 3
    return { days: daysUntilEnd, hours, minutes, pct, ended: false, warning, phase, overdueDays: 0 }
  }, [startDate, endDate])
}

export function Sidebar() {
  const {
    activePage,
    setActivePage,
    sidebarOpen,
    closeSidebar,
    toggleSidebar,
    searchOpen,
    setSearchOpen,
    setQrScannerOpen,
  } = useAppStore()
  const authUser = useAuthStore((s) => s.user)
  const authLogout = useAuthStore((s) => s.logout)
  // Demo banner (rendered in-flow at the top of the app shell in page.tsx)
  // is ~30px tall. When it's showing, push the mobile hamburger down so it
  // doesn't overlap the banner.
  const isDemoBannerShowing = useAuthStore((s) => s.user?.isDemo === true)
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const realtimeStatus = useRealtimeStatus()
  // i18n — t() for labels; lang drives the localized clock/date (the app
  // is Thai-only since Phase F — no language toggle anymore).
  const t = useT()
  const { lang } = useLang()

  // ── Hover-expand state (desktop only) ──
  // Collapsed (56px) by default → expands to 240px on mouseenter.
  // Mirrors Supabase's sidebar behavior: overlays content, doesn't push it.
  const [hovered, setHovered] = React.useState(false)

  async function handleLogout() {
    await authLogout()
    // After logout, the AppShell boot effect will re-render and show the login
    // page (authStore.isAuthenticated flips to false).
  }

  // ── Auth + permissions (Task ID: RBAC-DASHBOARD) ──
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const authInitialized = useAuthStore((s) => s.initialized)
  const navVisibility = useNavVisibility()
  const role = useRole()

  // Fetch /api/auth/me once on mount (silently — falls back to preview user)
  React.useEffect(() => {
    if (!authInitialized) {
      void fetchMe()
    }
  }, [authInitialized, fetchMe])

  // Flatten NAV_GROUPS for visibility checks — and FILTER by the user's
  // permissions (granular RBAC). Each `page` id maps to one or more
  // navVisibility keys; the item is shown when ANY matches.
  const pageToVisibilityKey: Partial<Record<ActivePage, keyof typeof navVisibility>> = {
    dashboard: 'dashboard',
    'itam-devices': 'devices',
    'itam-meter-keyboard': 'meter',
    'itam-meter': 'meter',
    meter: 'meter',
    'itam-work-orders': 'workOrders',
    'work-orders': 'workOrders',
    'itam-stock': 'stock',
    stock: 'stock',
    'itam-paper-analytics': 'paperAnalytics',
    'paper-analytics': 'paperAnalytics',
    templates: 'templates',
    import: 'import',
    'monthly-report': 'paperAnalytics',
    // Removed: 'itam-snapshot-viewer': 'audit', (snapshot feature disabled — models removed from schema)
    'itam-settings': 'settings',
    settings: 'settings',
    'itam-audit': 'audit',
  }
  const visibleNavItems = React.useMemo(() => {
    return NAV_GROUPS.flatMap((g) => g.items).filter((item) => {
      if (item.module && !isModuleEnabled(item.module)) return false
      const key = pageToVisibilityKey[item.page]
      // Items without an explicit mapping default to visible (preserves
      // existing behavior for any nav id not yet wired to a permission).
      if (!key) return true
      return Boolean(navVisibility[key])
    })
  }, [navVisibility])

  // ── Mobile/Desktop menu filtering ──
  // Admin can configure which nav items each role sees on mobile vs desktop.
  // Stored in AppSetting key 'mobileNavConfig' as JSON: { [role]: { [page]: true|false } }
  // Default: all items visible on desktop, only essential items on mobile.
  const [isMobile, setIsMobile] = React.useState(false)
  React.useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const { data: mobileNavConfig } = useQuery<Record<string, Record<string, boolean>>>({
    queryKey: ['mobile-nav-config'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/settings', { headers: authHeaders() })
        if (!res.ok) return {}
        const json = await res.json()
        const raw = json.settings?.find((s: { key: string; value: string }) => s.key === 'mobileNavConfig')
        if (!raw?.value) return {}
        return JSON.parse(raw.value)
      } catch {
        return {}
      }
    },
    staleTime: 30_000,
  })

  // Default mobile-visible pages (when no config is set for this role)
  const DEFAULT_MOBILE_PAGES: string[] = [
    'dashboard',
    'itam-work-orders',
    'work-orders',
    'itam-meter-keyboard',
    'itam-stock',
    'mobile',
    'pm-schedules',
  ]

  // Filtered NAV_GROUPS — preserves group ordering/structure but hides items
  // the user doesn't have permission to see. Empty groups are skipped.
  // On mobile, also filter by mobileNavConfig (or default mobile pages).
  const filteredNavGroups = React.useMemo(() => {
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((item) => {
        if (item.module && !isModuleEnabled(item.module)) return false
        const key = pageToVisibilityKey[item.page]
        if (!key) return true
        if (!Boolean(navVisibility[key])) return false

        // ── Mobile/Desktop filtering ──
        if (isMobile) {
          // Check role-specific config first
          const roleConfig = mobileNavConfig?.[role]
          if (roleConfig && typeof roleConfig[item.page] === 'boolean') {
            return roleConfig[item.page]
          }
          // Fall back to default mobile pages
          return DEFAULT_MOBILE_PAGES.includes(item.page)
        }
        // Desktop: show all (unless explicitly hidden by config)
        const desktopConfig = mobileNavConfig?.[role]
        if (desktopConfig && typeof desktopConfig[item.page] === 'boolean') {
          // On desktop, if config explicitly hides a page, respect it
          // But only if there's a config — otherwise show everything
          return desktopConfig[item.page] || true
        }
        return true
      }),
    })).filter((g) => g.items.length > 0)
  }, [navVisibility, isMobile, mobileNavConfig, role])

  // ── Organization Profile (flexible: ชื่อ/โลโก้/tagline เปลี่ยนได้) ──
  const { data: orgProfile } = useQuery({
    queryKey: ['org-profile'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/settings/org-profile')
        if (!res.ok) return null
        const j = await res.json()
        return j?.profile ?? null
      } catch {
        return null
      }
    },
    staleTime: 60_000,
  })
  const appName = orgProfile?.appName || 'ระบบจัดการสินทรัพย์'
  const appTagline = orgProfile?.appTagline || 'Asset Management System'
  const logoUrl = orgProfile?.logoUrl || ''
  // Asset terminology (e.g. "ครุภัณฑ์" / "ทรัพย์สิน") from the org profile —
  // used to substitute the `{{assetTerminology}}` placeholder in nav item
  // `desc` strings (e.g. "{{assetTerminology}}ทั้งหมด"). Falls back to
  // "ครุภัณฑ์" when the profile is unavailable.
  const assetTerminologyLabel = orgProfile?.assetTerminology || 'ครุภัณฑ์'

  // Resolve `{{assetTerminology}}` placeholder in a nav item desc, so the
  // sidebar's "Manage Devices" tooltip adapts to the org's terminology
  // (e.g. shows "ทรัพย์สินทั้งหมด" when the org uses "ทรัพย์สิน").
  function resolveNavDesc(desc: string | undefined): string | undefined {
    if (!desc) return desc
    if (!desc.includes('{{assetTerminology}}')) return desc
    return desc.split('{{assetTerminology}}').join(assetTerminologyLabel)
  }

  // Live clock moved to a fixed TopBarClock at the top-right of the screen
  // (see src/app/page.tsx + src/components/itam/top-bar-clock.tsx). The
  // sidebar header is now a clean logo + app name + tagline only.

  const isDark = mounted && theme === 'dark'
  function toggleTheme() {
    setTheme(isDark ? 'light' : 'dark')
  }

  // Global keyboard shortcut: Ctrl+K / Cmd+K — toggles the search palette
  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        setSearchOpen(!searchOpen)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [searchOpen, setSearchOpen])

  const { data: activeCycle } = useQuery<CycleInfo | null>({
    queryKey: ['active-cycle'],
    queryFn: async () => {
      const res = await fetch('/api/cycles?status=active')
      if (!res.ok) return null
      const json = await res.json()
      return (json.cycles?.[0] as CycleInfo | undefined) ?? null
    },
    staleTime: 60_000,
  })

  const countdown = useCountdown(activeCycle?.startDate, activeCycle?.endDate)
  const clockNow = useClock()

  const handleNav = (page: ActivePage) => {
    setActivePage(page)
    closeSidebar()
  }

  // Display name + role label
  const displayName =
    authUser?.name || authUser?.email || 'admin@example.com'
  const roleLabelText = ROLE_LABELS[role] ?? role

  // ── Shared content renderer ──
  // Used by BOTH the desktop hover-expand aside and the mobile drawer aside.
  // `expanded` controls whether labels / section titles / descriptions are
  // visible. On desktop it follows the `hovered` state; on mobile it's always
  // true (drawer is full-width when open).
  //
  // COMPACT LAYOUT (Issue 2):
  // - Group titles → thin divider line (saves vertical space)
  // - Nav item padding reduced (py-1.5)
  // - Quick actions (search, QR, realtime dot) moved into the header row
  // - Cycle countdown → compact single-line bar inside user area
  // - Footer: theme toggle + notifications only (no "Powered by" text when collapsed)
  //
  // COLLAPSED LAYOUT (Issue 1):
  // - Every element is centered horizontally with justify-center
  // - Icon span: w-7 h-7 (28px) when collapsed
  // - No left/right padding when collapsed (px-0)
  // - Touch target: h-10 (40px)
  // - Icons larger: text-lg when collapsed
  const renderContent = (expanded: boolean) => (
    <>
      {/* ── Header (top section) ──
          Clean top: just logo + app name + tagline.
          The live clock moved to a fixed TopBarClock (top-right of screen).
          The bell + theme toggle moved to the bottom (above the user section)
          so the top stays uncluttered and the nav items get more room. */}
      <div
        className={cn(
          'flex items-center gap-2 border-b border-slate-200 dark:border-white/10',
          expanded ? 'px-3 py-3' : 'justify-center px-0 py-2',
        )}
      >
        {logoUrl && (logoUrl.startsWith('http') || logoUrl.startsWith('data:image/')) ? (
          <img
            src={logoUrl}
            alt={appName}
            className="h-7 w-7 flex-shrink-0 rounded object-contain"
          />
        ) : (
          <span
            className={cn(
              'flex-shrink-0',
              expanded ? 'text-lg' : 'text-xl',
            )}
            aria-hidden
          >
            {logoUrl || '📦'}
          </span>
        )}
        <div
          className={cn(
            'min-w-0 flex-1 transition-opacity duration-150',
            expanded ? 'opacity-100' : 'pointer-events-none absolute opacity-0',
          )}
        >
          <div className="truncate text-sm font-bold leading-tight text-slate-900 dark:text-white">
            {appName}
          </div>
          <div className="truncate text-[10px] leading-tight text-slate-500 dark:text-slate-400">
            {appTagline}
          </div>
          {/* Clock — compact, below tagline */}
          {clockNow && (
            <div className="mt-1 flex items-center gap-1 text-[10px] font-mono text-slate-400 dark:text-slate-500">
              <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-[#f97316]" />
              <span>{formatThaiTime(clockNow, lang)}</span>
              <span className="text-slate-300 dark:text-slate-400">·</span>
              <span className="whitespace-nowrap">{formatThaiDate(clockNow, lang)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Nav menu — navigation items only (no search/QR here anymore) */}
      <nav
        className="flex-1 overflow-y-auto overflow-x-hidden py-2"
        aria-label="Main navigation"
      >
        {filteredNavGroups.map((group, gi) => (
          <div key={group.titleKey}>
            {/* Thin divider between groups instead of section title */}
            {gi > 0 && (
              <div
                className={cn(
                  'mx-3 my-1.5 border-t border-slate-200 dark:border-white/10',
                )}
                aria-hidden
              />
            )}
            {group.items.map((item) => {
              const active = activePage === item.page
              const label = t(item.labelKey)
              const desc = item.descKey ? t(item.descKey) : ''
              return (
                <button
                  key={item.page}
                  type="button"
                  onClick={() => handleNav(item.page)}
                  aria-current={active ? 'page' : undefined}
                  aria-label={label}
                  title={expanded ? undefined : `${label}${desc ? ' — ' + desc : ''}`}
                  className={cn(
                    'group relative flex w-full cursor-pointer items-center text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0f172a]',
                    expanded
                      ? 'gap-3 px-4 py-2.5'
                      : 'h-11 w-full justify-center px-0',
                    active
                      ? 'bg-[#f97316]/10 text-[#f97316] dark:bg-[#f97316]/20'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white',
                  )}
                >
                  {/* Active indicator — left edge bar */}
                  <span
                    aria-hidden
                    className={cn(
                      'pointer-events-none absolute left-0 top-1/2 h-6 -translate-y-1/2 rounded-r bg-[#f97316] transition-all duration-200',
                      active ? 'w-[3px] opacity-100' : 'w-0 opacity-0',
                    )}
                  />
                  <span
                    className={cn(
                      'inline-flex flex-shrink-0 items-center justify-center rounded-lg transition-colors',
                      expanded ? 'h-7 w-7' : 'h-8 w-8',
                      active
                        ? 'bg-[#f97316]/15 text-[#f97316] dark:bg-[#fb923c]/15 dark:text-[#fb923c]'
                        : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300',
                    )}
                    aria-hidden
                  >
                    <item.icon className={expanded ? 'h-4 w-4' : 'h-5 w-5'} />
                  </span>
                  <span
                    className={cn(
                      'flex-1 whitespace-nowrap text-left transition-opacity duration-150',
                      expanded ? 'opacity-100' : 'pointer-events-none absolute opacity-0',
                    )}
                  >
                    {label}
                  </span>
                </button>
              )
            })}
          </div>
        ))}

        {visibleNavItems.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-slate-400 dark:text-slate-500">
            คุณไม่มีสิทธิ์เข้าถึงเมนูใด ๆ
            <br />
            กรุณาติดต่อผู้ดูแลระบบ
          </div>
        )}
      </nav>

      {/* ── Cycle countdown — compact single-line bar (only when expanded) ──
          Two-phase display (Issue 1: FIX-COUNTDOWN-LAYOUT-SETTINGS):
            • before   → "อีก X วัน ถึงกำหนดจดมิเตอร์" (green/orange/red)
            • deadline → "⚠️ ถึงกำหนดจดมิเตอร์แล้ว! เหลือ X ชม." (red, pulsing)
            • overdue  → "เลยกำหนดแล้ว X วัน" (red, pulsing) */}
      {activeCycle && countdown && expanded && (
        <div
          className={cn(
            'border-t px-3 py-2 text-[11px] dark:border-white/10',
            countdown.phase === 'overdue' || countdown.phase === 'deadline'
              ? 'border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'
              : countdown.warning
                ? 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                : 'border-slate-200 bg-slate-100 text-slate-700 dark:bg-white/[0.04] dark:text-slate-200',
            (countdown.phase === 'overdue' || countdown.phase === 'deadline') && 'itam-deadline-pulse',
          )}
          title={
            countdown.phase === 'overdue'
              ? `เลยกำหนดแล้ว ${countdown.overdueDays} วัน — ${activeCycle.name}${activeCycle.site ? ` @ ${activeCycle.site}` : ''}`
              : countdown.phase === 'deadline'
                ? `ถึงกำหนดจดมิเตอร์แล้ว! เหลือ ${countdown.hours} ชม. ${countdown.minutes ?? 0} นาที — ${activeCycle.name}${activeCycle.site ? ` @ ${activeCycle.site}` : ''}`
                : `เหลืออีก ${countdown.days} วัน ${countdown.hours} ชม. ถึงกำหนดจดมิเตอร์ — ${activeCycle.name}${activeCycle.site ? ` @ ${activeCycle.site}` : ''}`
          }
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 truncate whitespace-nowrap">
              <span aria-hidden>
                {countdown.phase === 'overdue' || countdown.phase === 'deadline' ? '⚠️' : '⏰'}
              </span>
              <span className="truncate">
                {countdown.phase === 'overdue'
                  ? `เลยกำหนดแล้ว ${countdown.overdueDays} วัน`
                  : countdown.phase === 'deadline'
                    ? countdown.ended
                      ? 'ถึงกำหนดจดมิเตอร์แล้ว! ปิดรอบได้เลย'
                      : `ถึงกำหนดจดมิเตอร์! เหลือ ${countdown.hours} ชม. ${countdown.minutes ?? 0} นาที`
                    : countdown.warning
                      ? `อีก ${countdown.days} วัน ${countdown.hours} ชม. ถึงกำหนด`
                      : `อีก ${countdown.days} วัน ถึงกำหนดจดมิเตอร์`}
              </span>
              {activeCycle.site && (
                <Badge className="ml-1 shrink-0 border-slate-300 bg-white/60 px-1 text-[9px] text-slate-600 dark:bg-white/10 dark:text-slate-300">
                  {activeCycle.site}
                </Badge>
              )}
            </span>
            <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
              {Math.round(countdown.pct)}%
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${countdown.pct}%`,
                background:
                  countdown.phase === 'overdue' || countdown.phase === 'deadline'
                    ? '#e11d48'
                    : countdown.warning
                      ? '#f59e0b'
                      : '#f97316',
              }}
            />
          </div>
        </div>
      )}

      {/* ── Bottom action section — Global Search + QR Scanner ──
          Moved here from the top so wider buttons have room when expanded.
          When collapsed: two small icon buttons stacked centered.
          When expanded: full-width search input + QR button row. */}
      <div
        className={cn(
          'border-t border-slate-200 dark:border-white/10',
          expanded ? 'px-3 py-2.5' : 'px-0 py-2',
        )}
      >
        {expanded ? (
          <div className="flex flex-col gap-1.5">
            {/* Global search button — full width */}
            <button
              type="button"
              onClick={() => {
                closeSidebar()
                setSearchOpen(true)
              }}
              aria-label="Search"
              title="Search (Ctrl+K)"
              className="group flex w-full items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-white/20 dark:hover:bg-white/10 dark:hover:text-white dark:focus-visible:ring-offset-[#0f172a]"
            >
              <Search className="h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-colors group-hover:text-slate-900 dark:group-hover:text-white" />
              <span className="flex-1 whitespace-nowrap text-left text-xs">Search...</span>
              <kbd
                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-mono text-slate-400 dark:border-white/10 dark:bg-white/5"
                aria-hidden
              >
                ⌘K
              </kbd>
            </button>

            {/* QR scanner — full width */}
            <button
              type="button"
              onClick={() => {
                closeSidebar()
                setQrScannerOpen(true)
              }}
              aria-label="Scan QR Code"
              title="Scan QR Code"
              className="group flex w-full items-center gap-2 rounded-md border border-[#f97316]/40 bg-[#f97316]/10 px-2.5 py-1.5 text-xs font-medium text-[#fb923c] transition-colors hover:border-[#f97316]/70 hover:bg-[#f97316]/20 hover:text-orange-600 dark:hover:text-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0f172a]"
            >
              <QrCode className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="whitespace-nowrap text-left">📱 Scan QR</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            {/* Search icon (collapsed) */}
            <button
              type="button"
              onClick={() => {
                closeSidebar()
                setSearchOpen(true)
              }}
              aria-label="Search"
              title="Search (Ctrl+K)"
              className="group flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-white/20 dark:hover:bg-white/10 dark:hover:text-white dark:focus-visible:ring-offset-[#0f172a]"
            >
              <Search className="h-4 w-4" />
            </button>
            {/* QR icon (collapsed) */}
            <button
              type="button"
              onClick={() => {
                closeSidebar()
                setQrScannerOpen(true)
              }}
              aria-label="Scan QR Code"
              title="Scan QR Code"
              className="group flex h-9 w-9 items-center justify-center rounded-md border border-[#f97316]/40 bg-[#f97316]/10 text-[#fb923c] transition-colors hover:border-[#f97316]/70 hover:bg-[#f97316]/20 hover:text-orange-600 dark:hover:text-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0f172a]"
            >
              <QrCode className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* ── Quick controls section — bell (notifications) + theme toggle +
          realtime status dot. Moved here (above the user section) so the
          top header stays clean with just the logo + app name.
          When collapsed: three small icon-sized elements stacked centered.
          When expanded: a single row with all three side by side. */}
      <div
        className={cn(
          'flex flex-shrink-0 items-center gap-1.5 border-t border-slate-200 dark:border-white/10',
          expanded ? 'justify-between px-3 py-2' : 'flex-col justify-center px-0 py-2',
        )}
      >
        <NotificationsPopover />
        <div
          className={cn(
            'flex items-center gap-1.5',
            expanded ? '' : '',
          )}
        >
          {/* Theme toggle — switches between light/dark (sidebar follows theme) */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? t('control.light_mode') : t('control.dark_mode')}
            title={isDark ? t('control.light_mode') : t('control.dark_mode')}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10 dark:hover:text-white dark:focus-visible:ring-offset-[#0f172a]"
          >
            {mounted ? (
              isDark ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )
            ) : (
              <span className="block h-4 w-4" />
            )}
          </button>
          {/* Realtime status dot — small indicator (always visible) */}
          <div
            role="status"
            aria-label={`${t('rt.label')}: ${realtimeStatus === 'realtime' ? t('rt.connected') : realtimeStatus === 'polling' ? t('rt.connecting') : t('rt.disconnected')}`}
            title={
              realtimeStatus === 'realtime'
                ? `🟢 ${t('rt.connected')}`
                : realtimeStatus === 'polling'
                  ? `🟡 ${t('rt.connecting')}`
                  : `🔴 ${t('rt.disconnected')}`
            }
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5"
          >
            <span
              className={[
                'rounded-full',
                expanded ? 'h-2 w-2' : 'h-2.5 w-2.5',
                realtimeStatus === 'realtime'
                  ? 'bg-emerald-400 itam-rt-dot'
                  : realtimeStatus === 'polling'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-slate-500',
              ].join(' ')}
            />
          </div>
        </div>
      </div>

      {/* ── Footer — current user: avatar + name + role + logout ──
          Uses lighter border (border-slate-100) than the quick controls
          section above (border-slate-200) so the two bottom sections feel
          like one connected group, not two separate zones. */}
      <div
        className={cn(
          'flex flex-shrink-0 items-center gap-2 border-t border-slate-100 py-2 dark:border-white/5',
          expanded ? 'px-3' : 'justify-center px-0',
        )}
        title={authUser?.email ?? ''}
      >
        {/* Avatar — รูปโปรไฟล์หรือ initials */}
        {authUser?.avatarUrl && authUser.avatarUrl.startsWith('http') ? (
          <img
            src={authUser.avatarUrl}
            alt={displayName}
            className="h-8 w-8 flex-shrink-0 rounded-full object-cover ring-2 ring-slate-200 dark:ring-white/20"
          />
        ) : (
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#f97316] to-[#ea580c] text-xs font-bold text-white ring-2 ring-slate-200 dark:ring-white/20">
            {displayName.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div
          className={cn(
            'min-w-0 flex-1 transition-opacity duration-150',
            expanded ? 'opacity-100' : 'pointer-events-none absolute opacity-0',
          )}
        >
          <div className="truncate text-[11px] font-medium leading-tight text-slate-900 dark:text-white/90">
            {displayName}
          </div>
          <div className="mt-0.5 truncate text-[10px] leading-tight text-slate-500 dark:text-slate-400">
            {roleLabelText}
          </div>
        </div>
        {/* Logout button — only shown when expanded */}
        <button
          type="button"
          onClick={handleLogout}
          aria-label="ออกจากระบบ"
          title={expanded ? undefined : `ออกจากระบบ (${displayName})`}
          className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:bg-slate-100 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-red-400 dark:focus-visible:ring-offset-[#0f172a]',
            expanded ? 'opacity-100' : 'opacity-0 pointer-events-none absolute',
          )}
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </>
  )

  return (
    <>
      {/* Mobile menu button */}
      <button
        type="button"
        aria-label="เปิดเมนู"
        onClick={toggleSidebar}
        className={cn(
          'fixed left-3 z-[200] flex h-11 w-11 items-center justify-center rounded-md bg-[#0f172a] text-white shadow-md dark:bg-[#f97316] md:hidden',
          // When the DemoBanner is showing (in-flow at the top of the app
          // shell, ~30px tall), push the hamburger below it so they don't
          // overlap. Without banner → top-3 (12px); with banner → top-12 (48px).
          isDemoBannerShowing ? 'top-12' : 'top-3',
        )}
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-[90] bg-black/40 md:hidden"
          onClick={closeSidebar}
          aria-hidden
        />
      )}

      {/* Desktop sidebar — collapsed (56px) by default, expands to 240px on hover.
          Overlays content (fixed + z-100); main content keeps md:ml-14.
          Light mode: bg-slate-50 with border-slate-300 (3-tier hierarchy — page bg slate-50,
          sidebar slate-50, cards white). */}
      <aside
        // Bug UX-01 fix: pointer events fire for both mouse + touch (Touch ID).
        // onMouseEnter/Leave don't fire on touch devices, causing sidebar to
        // expand but not change content (require double-click).
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        aria-label="Main navigation (desktop)"
        className={cn(
          'fixed bottom-0 left-0 top-0 z-[100] hidden flex-col overflow-hidden border-r border-slate-300 bg-slate-50 text-slate-900 transition-all duration-200 ease-out md:flex dark:border-white/10 dark:bg-[#0f172a] dark:text-white',
          hovered ? 'w-60 shadow-2xl' : 'w-14',
        )}
      >
        {renderContent(hovered)}
      </aside>

      {/* Mobile sidebar — full-width drawer (240px), slides in/out.
          Always renders content in expanded mode when open. */}
      <aside
        aria-label="Main navigation (mobile)"
        className={cn(
          'fixed bottom-0 left-0 top-0 z-[100] flex w-60 flex-col border-r border-slate-300 bg-slate-50 text-slate-900 transition-transform duration-300 md:hidden dark:border-white/10 dark:bg-[#0f172a] dark:text-white',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {renderContent(true)}
      </aside>
    </>
  )
}
