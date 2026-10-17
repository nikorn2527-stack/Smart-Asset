'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell, CheckCircle2, ShieldAlert, AlertTriangle, Gauge, History } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useAppStore, type SettingsTab } from '@/store/app-store'
import { useAuthStore } from '@/store/auth-store'
import { bearerHeaders } from '@/lib/http-headers'

type Severity = 'expired' | 'expiring' | 'warning' | 'info'

type NotifAction =
  | { page: 'devices'; deviceId?: string; warrantyFilter?: 'expiring' | 'expired' }
  | { page: 'meter'; meterAction?: string }
  | { page: 'settings'; settingsTab?: SettingsTab }

interface Notif {
  id: string
  type: 'warranty' | 'meter' | 'cycle' | 'audit'
  severity: Severity
  title: string
  subtitle: string
  timestamp: string
  action?: NotifAction
}

interface NotifsResponse {
  notifications: Notif[]
  counts: {
    total: number
    expired: number
    expiring: number
    warning: number
    info: number
  }
}

type FilterTab = 'all' | 'meter' | 'warranty' | 'system'

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'meter', label: 'รอบจดมิเตอร์' },
  { value: 'warranty', label: 'รับประกัน' },
  { value: 'system', label: 'ระบบ' },
]

const READ_KEY = 'itam.notif.lastReadAt'

function getLastReadAt(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = window.localStorage.getItem(READ_KEY)
    if (!raw) return 0
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

function setLastReadAt(ts: number) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(READ_KEY, String(ts))
  } catch {
    // ignore
  }
}

function severityBorder(sev: Severity): string {
  switch (sev) {
    case 'expired':
      return 'border-l-rose-500'
    case 'expiring':
    case 'warning':
      return 'border-l-amber-500'
    case 'info':
    default:
      return 'border-l-teal-500'
  }
}

function severityIconColor(sev: Severity): { bg: string; fg: string } {
  switch (sev) {
    case 'expired':
      return { bg: 'bg-rose-100 dark:bg-rose-950/60', fg: 'text-rose-600 dark:text-rose-400' }
    case 'expiring':
    case 'warning':
      return { bg: 'bg-amber-100 dark:bg-amber-950/60', fg: 'text-amber-600 dark:text-amber-400' }
    case 'info':
    default:
      return { bg: 'bg-teal-100 dark:bg-teal-950/60', fg: 'text-teal-600 dark:text-teal-400' }
  }
}

function notifIcon(type: Notif['type']): React.ReactNode {
  switch (type) {
    case 'warranty':
      return <ShieldAlert className="h-3.5 w-3.5" />
    case 'meter':
      return <Gauge className="h-3.5 w-3.5" />
    case 'cycle':
      return <AlertTriangle className="h-3.5 w-3.5" />
    case 'audit':
    default:
      return <History className="h-3.5 w-3.5" />
  }
}

export function NotificationsPopover() {
  const [open, setOpen] = React.useState(false)
  const [filter, setFilter] = React.useState<FilterTab>('all')
  const [lastReadAt, setLastReadAtState] = React.useState<number>(0)
  const [mounted, setMounted] = React.useState(false)

  const {
    setActivePage,
    setPendingDeviceId,
    setPendingSettingsTab,
    setPendingWarrantyFilter,
    setPendingMeterAction,
  } = useAppStore()

  React.useEffect(() => {
    setMounted(true)
    setLastReadAtState(getLastReadAt())
  }, [])

  const { data } = useQuery<NotifsResponse>({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res = await fetch('/api/notifications', {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) throw new Error('Failed to load notifications')
      return res.json()
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const notifications = data?.notifications ?? []
  const counts = data?.counts ?? { total: 0, expired: 0, expiring: 0, warning: 0, info: 0 }

  // Unread count = notifications whose timestamp is newer than lastReadAt
  const unreadCount = mounted
    ? notifications.filter((n) => new Date(n.timestamp).getTime() > lastReadAt).length
    : 0
  const hasCritical = counts.expired > 0

  const filtered = React.useMemo(() => {
    if (filter === 'all') return notifications
    if (filter === 'meter') return notifications.filter((n) => n.type === 'meter' || n.type === 'cycle')
    if (filter === 'warranty') return notifications.filter((n) => n.type === 'warranty')
    if (filter === 'system') return notifications.filter((n) => n.type === 'audit')
    return notifications
  }, [notifications, filter])

  function markAllRead() {
    const ts = Date.now()
    setLastReadAt(ts)
    setLastReadAtState(ts)
  }

  function handleAction(n: Notif) {
    if (!n.action) {
      setOpen(false)
      return
    }
    const a = n.action
    if (a.page === 'devices') {
      if (a.deviceId) setPendingDeviceId(a.deviceId)
      if (a.warrantyFilter) setPendingWarrantyFilter(a.warrantyFilter)
      setActivePage('devices')
    } else if (a.page === 'meter') {
      if (a.meterAction) setPendingMeterAction(a.meterAction)
      setActivePage('meter')
    } else if (a.page === 'settings') {
      if (a.settingsTab) setPendingSettingsTab(a.settingsTab)
      setActivePage('settings')
    }
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="การแจ้งเตือน"
          title="การแจ้งเตือน"
          className={cn(
            'relative flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/5 text-slate-200 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 focus-visible:ring-offset-[#0f172a]',
          )}
        >
          <Bell className="h-4 w-4" />
          {/* Pulsing red dot when there are critical (expired) alerts */}
          {mounted && hasCritical && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
            </span>
          )}
          {/* Badge count (orange) */}
          {mounted && unreadCount > 0 && (
            <span
              aria-hidden
              className="absolute -right-1.5 -top-1.5 flex min-w-[16px] h-4 items-center justify-center rounded-full bg-[#f97316] px-1 text-[10px] font-bold leading-none text-white shadow-sm"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="z-[300] w-80 p-0 dark:border-slate-800 dark:bg-slate-900"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              การแจ้งเตือน
            </span>
            <Badge className="border-[#f97316]/30 bg-[#f97316]/10 text-[#f97316] dark:border-[#fb923c]/30 dark:bg-[#fb923c]/10 dark:text-[#fb923c]">
              {counts.total}
            </Badge>
          </div>
          <button
            type="button"
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="text-[11px] font-medium text-[#f97316] transition-colors hover:text-[#ea580c] disabled:opacity-40 dark:text-[#fb923c] dark:hover:text-[#f97316]"
          >
            ทำเครื่องหมายว่าอ่านแล้ว
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 border-b border-slate-200 px-2 py-1.5 dark:border-slate-800">
          {FILTER_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setFilter(t.value)}
              className={cn(
                'flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316]',
                filter === t.value
                  ? 'bg-[#f97316]/10 text-[#f97316] dark:bg-[#fb923c]/15 dark:text-[#fb923c]'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="itam-scroll max-h-[360px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-slate-400 dark:text-slate-500">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                <CheckCircle2 className="h-6 w-6 text-emerald-500 dark:text-emerald-400" />
              </div>
              <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
                ไม่มีการแจ้งเตือน
              </div>
              <div className="text-xs text-slate-400 dark:text-slate-500">
                ระบบเป็นปกติ ไม่มีเหตุการณ์ที่ต้องตรวจสอบ
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((n) => {
                const ic = severityIconColor(n.severity)
                const isNew = mounted && new Date(n.timestamp).getTime() > lastReadAt
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleAction(n)}
                      className={cn(
                        'group flex w-full items-start gap-2.5 border-l-[3px] px-3 py-2.5 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-slate-50 dark:hover:bg-slate-800/50 dark:focus-visible:bg-slate-800/50',
                        severityBorder(n.severity),
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                          ic.bg,
                          ic.fg,
                        )}
                      >
                        {notifIcon(n.type)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="line-clamp-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
                            {n.title}
                          </span>
                          {isNew && (
                            <span
                              aria-hidden
                              className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#f97316]"
                            />
                          )}
                        </span>
                        <span className="mt-0.5 block line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">
                          {n.subtitle}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        {filtered.length > 0 && (
          <div className="border-t border-slate-200 px-3 py-2 text-center text-[10px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
            อัปเดตอัตโนมัติทุก 60 วินาที
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
