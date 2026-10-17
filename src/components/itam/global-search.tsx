'use client'

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Package,
  Database,
  Gauge,
  History,
  Building2,
  Boxes,
  ArrowRight,
  LayoutDashboard,
  Monitor,
  TrendingUp,
  Wrench,
  CalendarClock,
  FileText,
  Smartphone,
  Download,
  BarChart3,
  Coins,
  Settings,
  ScrollText,
} from 'lucide-react'
import { useAppStore, type ActivePage } from '@/store/app-store'
import { useAuthStore } from '@/store/auth-store'
import { useT } from '@/store/i18n-store'
import { isModuleEnabled, type ModuleName } from '@/config/modules'
import type { SearchResults } from './types'
import { bearerHeaders } from '@/lib/http-headers'

const ICON_CLASSES = 'h-4 w-4 shrink-0'

// ── Quick-navigation pages (mirrors the Sidebar nav; filtered by module
// availability the same way the sidebar is) ──
const QUICK_PAGES: { page: ActivePage; icon: React.ComponentType<{ className?: string }>; labelKey: string; descKey: string; module?: ModuleName }[] = [
  { page: 'dashboard', icon: LayoutDashboard, labelKey: 'menu.dashboard', descKey: 'desc.dashboard', module: 'dashboard' },
  { page: 'itam-devices', icon: Monitor, labelKey: 'menu.devices', descKey: 'desc.devices', module: 'devices' },
  { page: 'itam-meter-keyboard', icon: TrendingUp, labelKey: 'menu.meter', descKey: 'desc.meter', module: 'meters' },
  { page: 'itam-work-orders', icon: Wrench, labelKey: 'menu.work_orders', descKey: 'desc.work_orders', module: 'work-orders' },
  { page: 'pm-schedules', icon: CalendarClock, labelKey: 'menu.pm_schedules', descKey: 'desc.pm_schedules', module: 'work-orders' },
  { page: 'itam-stock', icon: Boxes, labelKey: 'menu.stock', descKey: 'desc.stock', module: 'stock' },
  { page: 'itam-paper-analytics', icon: FileText, labelKey: 'menu.paper_analytics', descKey: 'desc.paper_analytics', module: 'paper-analytics' },
  { page: 'reports-hub', icon: BarChart3, labelKey: 'menu.reports_hub', descKey: 'desc.reports_hub', module: 'reports' },
  { page: 'material-cost', icon: Coins, labelKey: 'menu.material_cost', descKey: 'desc.material_cost', module: 'reports' },
  { page: 'monthly-report', icon: CalendarClock, labelKey: 'menu.monthly_report', descKey: 'desc.monthly_report', module: 'reports' },
  { page: 'templates', icon: FileText, labelKey: 'menu.templates', descKey: 'desc.templates', module: 'templates' },
  { page: 'import', icon: Download, labelKey: 'menu.import', descKey: 'desc.import', module: 'import' },
  { page: 'itam-settings', icon: Settings, labelKey: 'menu.settings', descKey: 'desc.settings', module: 'settings' },
  { page: 'itam-audit', icon: ScrollText, labelKey: 'menu.audit', descKey: 'desc.audit', module: 'audit' },
  { page: 'mobile', icon: Smartphone, labelKey: 'menu.mobile', descKey: 'desc.mobile', module: 'work-orders' },
]

const GROUP_HEADING_CLASSES =
  '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-slate-400 dark:[&_[cmdk-group-heading]]:text-slate-500'

function SearchResultSkeleton() {
  return (
    <div className="space-y-2 p-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <Skeleton className="h-4 w-4 rounded dark:bg-slate-800" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-1/2 dark:bg-slate-800" />
            <Skeleton className="h-2.5 w-2/3 dark:bg-slate-800" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function GlobalSearch() {
  const {
    searchOpen,
    setSearchOpen,
    setActivePage,
    setPendingDeviceId,
    setPendingSettingsTab,
  } = useAppStore()

  const [q, setQ] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const t = useT()

  // Reset query when palette closes
  React.useEffect(() => {
    if (!searchOpen) {
      const t = setTimeout(() => {
        setQ('')
        setDebounced('')
      }, 200)
      return () => clearTimeout(t)
    }
  }, [searchOpen])

  // Debounce search query
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  // NOTE: the keyboard shortcut (Ctrl+K / Cmd+K) listener lives in the Sidebar
  // component, which calls setSearchOpen(true). Closing is handled by the Dialog
  // itself (Esc key + click-outside) and the close button.

  const { data, isFetching } = useQuery<{ results: SearchResults; total: number }>({
    queryKey: ['global-search', debounced],
    queryFn: async () => {
      if (debounced.length < 2) {
        return { results: { devices: [], master: [], workOrders: [], stock: [], meter: [], audit: [], sites: [] }, total: 0 }
      }
      const res = await fetch(`/api/search?q=${encodeURIComponent(debounced)}`, {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) throw new Error('Search failed')
      return res.json()
    },
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  })

  const results = data?.results ?? {
    devices: [],
    master: [],
    workOrders: [],
    stock: [],
    meter: [],
    audit: [],
    sites: [],
  }
  const total = data?.total ?? 0
  const hasQuery = debounced.length >= 2
  const showLoading = hasQuery && isFetching
  const hasDataResults =
    results.devices.length + results.master.length + results.workOrders.length + results.stock.length > 0

  // Pages visible to THIS user (module availability — same gate the sidebar uses)
  const pages = React.useMemo(
    () => QUICK_PAGES.filter((p) => !p.module || isModuleEnabled(p.module)),
    [],
  )

  function handleSelect(type: string, id: string, deviceId?: string) {
    setSearchOpen(false)
    if (type === 'device') {
      setActivePage('devices')
      // Defer setting the pending device id so the devices page mounts first
      setTimeout(() => setPendingDeviceId(id), 50)
    } else if (type === 'master') {
      setActivePage('settings')
      setPendingSettingsTab('master')
    } else if (type === 'meter') {
      setActivePage('devices')
      if (deviceId) {
        setTimeout(() => setPendingDeviceId(deviceId), 50)
      }
    } else if (type === 'audit') {
      setActivePage('settings')
      setPendingSettingsTab('audit')
    } else if (type === 'site') {
      setActivePage('settings')
      setPendingSettingsTab('sites')
    } else if (type === 'workorder') {
      setActivePage('itam-work-orders')
    } else if (type === 'stock') {
      setActivePage('itam-stock')
    }
  }

  function handlePageSelect(page: ActivePage) {
    setSearchOpen(false)
    setActivePage(page)
  }

  // Custom cmdk filter: quick-nav items ("page:" prefix) are matched
  // client-side against the typed query; server results are already filtered
  // server-side and always pass.
  const commandFilter = React.useCallback((value: string, search: string) => {
    if (!value.startsWith('page:')) return 1
    const s = search.trim().toLowerCase()
    if (!s) return 1
    return value.toLowerCase().includes(s) ? 1 : 0
  }, [])

  return (
    <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
      <DialogContent
        className="overflow-hidden p-0 sm:max-w-xl dark:border-slate-800 dark:bg-slate-900"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t('search.title')}</DialogTitle>
          <DialogDescription>{t('search.placeholder')}</DialogDescription>
        </DialogHeader>
        <AnimatePresence>
          <motion.div
            key="search-content"
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <Command
              className="bg-white dark:bg-slate-900"
              filter={commandFilter}
            >
              <div className="relative">
                <CommandInput
                  placeholder={t('search.placeholder')}
                  value={q}
                  onValueChange={setQ}
                  autoFocus
                />
                <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 select-none rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 sm:block dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500">
                  ESC
                </kbd>
              </div>
              <CommandList className="itam-scroll max-h-[60vh]">
                {/* ── Quick navigation (always available; filtered as you type) ── */}
                {pages.length > 0 && (
                  <CommandGroup
                    heading={t('search.group.pages')}
                    className={GROUP_HEADING_CLASSES}
                  >
                    {pages.map((p) => {
                      const Icon = p.icon
                      return (
                        <CommandItem
                          key={`p-${p.page}`}
                          value={`page:${p.page} ${t(p.labelKey)}`}
                          onSelect={() => handlePageSelect(p.page)}
                          className="hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Icon className={`${ICON_CLASSES} text-slate-500 dark:text-slate-400`} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                              {t(p.labelKey)}
                            </div>
                            <div className="truncate text-xs text-slate-400 dark:text-slate-500">
                              {t(p.descKey)}
                            </div>
                          </div>
                          <ArrowRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" />
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                )}

                {showLoading && <SearchResultSkeleton />}

                {!showLoading && hasQuery && !hasDataResults && (
                  <CommandEmpty>{t('search.empty')}: &quot;{debounced}&quot;</CommandEmpty>
                )}

                {!hasQuery && (
                  <div className="px-4 pb-3 pt-1 text-center text-xs text-slate-400 dark:text-slate-500">
                    {t('search.pages_hint')}
                  </div>
                )}

                {results.devices.length > 0 && (
                  <CommandGroup
                    heading={t('search.group.devices')}
                    className={GROUP_HEADING_CLASSES}
                  >
                    {results.devices.map((d) => (
                      <CommandItem
                        key={`d-${d.id}`}
                        value={`device ${d.id} ${d.title}`}
                        onSelect={() => handleSelect('device', d.id)}
                        className="hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Package className={`${ICON_CLASSES} text-[#f97316]`} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                            {d.title}
                          </div>
                          <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                            {d.subtitle}
                          </div>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-400" />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {results.workOrders.length > 0 && (
                  <CommandGroup
                    heading={t('search.group.workorders')}
                    className={GROUP_HEADING_CLASSES}
                  >
                    {results.workOrders.map((w) => (
                      <CommandItem
                        key={`w-${w.id}`}
                        value={`workorder ${w.id} ${w.title}`}
                        onSelect={() => handleSelect('workorder', w.id)}
                        className="hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Wrench className={`${ICON_CLASSES} text-[#f43f5e]`} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                            {w.title}
                          </div>
                          <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                            {w.subtitle}
                          </div>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-400" />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {results.stock.length > 0 && (
                  <CommandGroup
                    heading={t('search.group.stock')}
                    className={GROUP_HEADING_CLASSES}
                  >
                    {results.stock.map((s) => (
                      <CommandItem
                        key={`s-${s.id}`}
                        value={`stock ${s.id} ${s.title}`}
                        onSelect={() => handleSelect('stock', s.id)}
                        className="hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Boxes className={`${ICON_CLASSES} text-[#10b981]`} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                            {s.title}
                          </div>
                          <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                            {s.subtitle}
                          </div>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-400" />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {results.master.length > 0 && (
                  <CommandGroup
                    heading={t('search.group.master')}
                    className={GROUP_HEADING_CLASSES}
                  >
                    {results.master.map((m) => (
                      <CommandItem
                        key={`m-${m.id}`}
                        value={`master ${m.id} ${m.title}`}
                        onSelect={() => handleSelect('master', m.id)}
                        className="hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Database className={`${ICON_CLASSES} text-[#0d9488]`} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                            {m.title}
                          </div>
                          <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                            {m.subtitle}
                          </div>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-400" />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {results.meter.length > 0 && (
                  <CommandGroup
                    heading={t('search.group.meter')}
                    className={GROUP_HEADING_CLASSES}
                  >
                    {results.meter.map((m) => (
                      <CommandItem
                        key={`r-${m.id}`}
                        value={`meter ${m.id} ${m.title}`}
                        onSelect={() => handleSelect('meter', m.id, m.deviceId)}
                        className="hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Gauge className={`${ICON_CLASSES} text-[#f59e0b]`} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                            {m.title}
                          </div>
                          <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                            {m.subtitle}
                          </div>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-400" />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {results.audit.length > 0 && (
                  <CommandGroup
                    heading={t('search.group.audit')}
                    className={GROUP_HEADING_CLASSES}
                  >
                    {results.audit.map((a) => (
                      <CommandItem
                        key={`a-${a.id}`}
                        value={`audit ${a.id} ${a.title}`}
                        onSelect={() => handleSelect('audit', a.id)}
                        className="hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <History className={`${ICON_CLASSES} text-slate-500 dark:text-slate-400`} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                            {a.title}
                          </div>
                          <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                            {a.subtitle}
                          </div>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-400" />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {results.sites.length > 0 && (
                  <CommandGroup
                    heading={t('search.group.sites')}
                    className={GROUP_HEADING_CLASSES}
                  >
                    {results.sites.map((s) => (
                      <CommandItem
                        key={`site-${s.id}`}
                        value={`site ${s.id} ${s.title}`}
                        onSelect={() => handleSelect('site', s.id)}
                        className="hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Building2 className={`${ICON_CLASSES} text-[#0d9488]`} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                            {s.title}
                          </div>
                          <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                            {s.subtitle}
                          </div>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-400" />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {hasQuery && hasDataResults && (
                  <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
                    {t('search.hint_kbd')}
                  </div>
                )}
              </CommandList>
            </Command>
          </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}
