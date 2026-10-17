'use client'

import { useAppStore } from '@/store/app-store'
import { useAuthStore } from '@/store/auth-store'
import { useT } from '@/store/i18n-store'
import { useQuery } from '@tanstack/react-query'
import { bearerHeaders } from '@/lib/http-headers'

// Footer page label i18n keys — one per ActivePage id.
const PAGE_LABEL_KEYS: Record<string, string> = {
  dashboard: 'menu.dashboard',
  devices: 'menu.devices',
  meter: 'menu.meter',
  'paper-analytics': 'menu.paper_analytics',
  settings: 'menu.settings',
  itam: 'menu.dashboard',
  'itam-devices': 'menu.devices',
  'itam-meter': 'menu.meter',
  'itam-meter-keyboard': 'menu.meter',
  'itam-settings': 'menu.settings',
  'itam-audit': 'menu.audit',
  'work-orders': 'menu.work_orders',
  'itam-work-orders': 'menu.work_orders',
  stock: 'menu.stock',
  'itam-stock': 'menu.stock',
  import: 'menu.import',
  'reports-hub': 'menu.reports_hub',
  'material-cost': 'menu.material_cost',
  'pm-schedules': 'menu.pm_schedules',
  templates: 'menu.templates',
  'monthly-report': 'menu.monthly_report',
  'paper-analytics-page': 'menu.paper_analytics',
  'meter-page': 'menu.meter',
  'itam-repairs': 'menu.work_orders',
  'itam-sticker-editor': 'menu.templates',
  'itam-document-editor': 'menu.templates',
  mobile: 'menu.mobile',
}

export function Footer() {
  const activePage = useAppStore((s) => s.activePage)
  const year = new Date().getFullYear()
  const t = useT()

  // Dynamic org name from OrgProfile (fallback to generic app name)
  const { data: orgProfile } = useQuery({
    queryKey: ['org-profile'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/settings/org-profile', {
          headers: bearerHeaders(useAuthStore.getState()?.token),
        })
        if (!res.ok) return null
        const j = await res.json()
        return j.profile ?? null
      } catch {
        return null
      }
    },
    staleTime: 60_000,
  })
  const orgName = orgProfile?.appName || t('footer.app_name')
  // Note: the live clock now lives in the top-right floating TopBarClock
  // (desktop) and inside the expanded sidebar header. The footer keeps a
  // minimal copyright + page label so it stays short.

  return (
    <footer className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          © {year} {orgName} — IT Asset Management
          {PAGE_LABEL_KEYS[activePage] && (
            <>
              {' · '}
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {t(PAGE_LABEL_KEYS[activePage])}
              </span>
            </>
          )}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#f97316]" />
        <span className="font-semibold text-[#f97316]">POWER BY PNG TEAM</span>
      </div>
    </footer>
  )
}
