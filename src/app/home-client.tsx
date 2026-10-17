'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
// framer-motion removed — using CSS transitions instead (lighter, no jank)
import { Sidebar } from '@/components/itam/sidebar'
import { Footer } from '@/components/itam/footer'
import { GlobalSearch } from '@/components/itam/global-search'
import { TopBarClock } from '@/components/itam/top-bar-clock'
import { RealtimeProvider } from '@/hooks/use-realtime-updates'
import { PwaInstallButton } from '@/components/itam/pwa-registration'
import { PwaUpdatePrompt } from '@/components/itam/pwa-update-prompt'
// QrScannerDialog — dynamic import (jsqr is CommonJS, breaks SSR prerender)
const QrScannerDialog = dynamic(() =>
  import('@/components/itam/qr-scanner').then((m) => m.QrScannerDialog),
  { ssr: false },
)
import { useAppStore, type ActivePage } from '@/store/app-store'
import { useIsMobile } from '@/hooks/use-mobile-detect'
import {
  useAuthStore,
  hydrateAuthFromStorage,
} from '@/store/auth-store'
import { Loader2 } from 'lucide-react'
import { DemoBanner } from '@/components/itam/demo-banner'

// Capture the native fetch ONCE and store it on globalThis so it survives
// Fast Refresh module re-evaluations. Without this, each Fast Refresh would
// capture the already-patched fetch as "native", creating a chain of nested
// patched-fetches → stack overflow.
const G = globalThis as unknown as {
  __nativeFetch?: typeof fetch
  __itamFetchPatched?: boolean
}

// ── Lazy-load every page component so the initial compile only builds the
//    active page. This drastically reduces peak RAM during first compile
//    (prevents OOM crashes in the sandbox) and also speeds up navigation
//    because each page is compiled on demand and cached.
const ItamLogin = dynamic(() =>
  import('@/components/itam/itam-login').then((m) => m.ItamLogin),
)
// Unified dashboard — merges the legacy DashboardPage into ItamDashboard.
// 'dashboard' and 'itam' both render this single component (itam kept as
// backward-compat alias for any deep links / bookmarks).
const ItamDashboard = dynamic(() =>
  import('@/components/itam/itam-dashboard').then((m) => m.ItamDashboard),
)
const ItamMeterUnified = dynamic(() =>
  import('@/components/itam/itam-meter-unified').then((m) => m.ItamMeterUnified),
)
const ItamStickerEditor = dynamic(() =>
  import('@/components/itam/itam-sticker-editor').then((m) => m.ItamStickerEditor),
)
const ItamDocumentEditor = dynamic(() =>
  import('@/components/itam/itam-document-editor').then((m) => m.ItamDocumentEditor),
)
const ItamPaperAnalytics = dynamic(() =>
  import('@/components/itam/itam-paper-analytics').then((m) => m.ItamPaperAnalytics),
)
const ItamSettings = dynamic(() =>
  import('@/components/itam/itam-settings').then((m) => m.ItamSettings),
)
const ItamAudit = dynamic(() =>
  import('@/components/itam/itam-audit').then((m) => m.ItamAudit),
)
// REMOVED: SnapshotViewer dynamic import — feature disabled (Prisma models removed from schema)
const ItamRepairs = dynamic(() =>
  import('@/components/itam/itam-repairs').then((m) => m.ItamRepairs),
)
const ItamStock = dynamic(() =>
  import('@/components/itam/itam-stock').then((m) => m.ItamStock),
)
// ── Additional pages restored from feat branch (were missing from main) ──
const ImportPage = dynamic(() =>
  import('@/components/itam/import-page').then((m) => m.ImportPage),
)
const TemplatesPage = dynamic(() =>
  import('@/components/itam/templates-page').then((m) => m.TemplatesPage),
)
const MonthlyReport = dynamic(() =>
  import('@/components/itam/monthly-report').then((m) => m.MonthlyReport),
)
const ReportsHub = dynamic(() =>
  import('@/components/itam/reports-hub').then((m) => m.ReportsHub),
)
// ── Cost Analytics (COST-ANALYTICS-SPEC.md Phase 3) ──
const MaterialCostReport = dynamic(() =>
  import('@/components/itam/material-cost-report').then((m) => m.MaterialCostReport),
)
// ── PM (Preventive Maintenance) ──
const PMSchedulesPage = dynamic(() =>
  import('@/components/itam/pm-schedules-page').then((m) => m.PMSchedulesPage),
)
// MobileShell — static import (was dynamic, but dynamic failed to load on Vercel)
import { MobileShell } from '@/components/itam/mobile'
const WorkOrdersPage = dynamic(() =>
  import('@/components/itam/work-orders-page').then((m) => m.WorkOrdersPage),
)
const StockPage = dynamic(() =>
  import('@/components/itam/stock-page').then((m) => m.StockPage),
)
const DevicesPage = dynamic(() =>
  import('@/components/itam/devices-page').then((m) => m.DevicesPage),
)
const MeterPage = dynamic(() =>
  import('@/components/itam/meter-page').then((m) => m.MeterPage),
)
// NOTE: PaperAnalyticsPage (paper-analytics-page.tsx) is dead code — imported
// but never rendered anywhere. The live paper analytics UI is ItamPaperAnalytics
// (which now includes the Utilization tab that used to live only in the dead
// page). The file is kept for reference; the unused dynamic import is removed.
// ── Auth pages (from email links: ?token={token}) ──
const AuthRegisterPage = dynamic(() =>
  import('@/components/itam/auth-register-page').then((m) => m.AuthRegisterPage),
)
const AuthResetPage = dynamic(() =>
  import('@/components/itam/auth-reset-page').then((m) => m.AuthResetPage),
)

export function HomePage() {
  const activePage = useAppStore((s) => s.activePage)
  // Helper: check if a page key is currently active (handles aliases)
  const isActive = React.useCallback(
    (page: ActivePage | ActivePage[]) => {
      const pages = Array.isArray(page) ? page : [page]
      return pages.includes(activePage)
    },
    [activePage],
  )
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isBooting = useAuthStore((s) => s.isBooting)
  const checkAuth = useAuthStore((s) => s.checkAuth)
  // ── Hydration guard ──
  // The server cannot know whether the browser holds a token in
  // localStorage, so the first client render (hydration) MUST produce the
  // exact same markup as the server render — otherwise React 19 throws a
  // hydration-mismatch error and re-mounts the whole tree (visible flash +
  // console errors for every logged-in page reload).
  // Strategy: render a neutral <BootScreen> on BOTH server and first client
  // render, then switch to the real UI (login / boot loader / app shell)
  // after mount, when localStorage is safely readable.
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => {
    setMounted(true)
  }, [])
  const [bootDone, setBootDone] = React.useState(() => {
    // If there's no token in the store at mount time, skip the boot screen
    // entirely — no need to wait for a network call that will just 401.
    if (typeof window !== 'undefined') {
      const stored = useAuthStore.getState()
      return !stored.token // bootDone = true if no token
    }
    return false
  })
  // Mobile detection hook — MUST be called before any early returns
  // (Rules of Hooks: hooks can't be conditional)
  const isMobileDevice = useIsMobile()
  const showMobileMode = activePage === 'mobile' || isMobileDevice

  // ── Detect ?token= from email links (register/reset) ──
  // When present, we render the appropriate auth page directly (bypassing
  // the normal auth check) so the user can complete registration or
  // password reset without being redirected to login first.
  const [authToken, setAuthToken] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const t = params.get('token')
    if (!t) return
    const task = window.setTimeout(() => setAuthToken(t), 0)
    return () => window.clearTimeout(task)
  }, [])

  // Boot: hydrate from localStorage then verify token validity with /me
  React.useEffect(() => {
    let cancelled = false
    async function boot() {
      // Skip boot entirely if window not available
      if (typeof window === 'undefined') {
        if (!cancelled) setBootDone(true)
        return
      }

      // hydrateAuthFromStorage reads token from localStorage
      // persist middleware auto-hydrates on mount, so token is available
      const hasToken = !!useAuthStore.getState().token

      if (hasToken) {
        // Token exists — verify with server
        await checkAuth()
      }
      // No token = no network call needed, just set boot done

      if (!cancelled) setBootDone(true)
    }
    // Use setTimeout(0) to ensure this runs AFTER React commit
    // (so persist middleware has finished rehydrating from localStorage)
    const timeoutId = window.setTimeout(() => { void boot() }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [checkAuth])

  // ── Global fetch interceptor: attach Bearer token to every /api/itam/* call
  //    so the existing components (which use raw `fetch`) don't need rewriting.
  //
  //    CRITICAL: We capture the NATIVE fetch ONCE at module load (not inside the
  //    effect) so that Fast Refresh re-runs of the effect don't create a chain
  //    of patched-fetches calling each other (which causes stack overflow).
  React.useEffect(() => {
    // Capture the true native fetch ONCE — stored on globalThis so it survives
    // Fast Refresh module re-evaluations. Without this guard, each re-eval
    // would capture the already-patched fetch, creating a chain of nested
    // patched-fetches → "Maximum call stack size exceeded".
    if (!G.__nativeFetch) {
      G.__nativeFetch = window.fetch.bind(window)
    }
    const nativeFetch = G.__nativeFetch
    // Don't double-patch: if already patched (e.g. by a previous mount that
    // wasn't cleaned up), just restore to native first.
    if (G.__itamFetchPatched) {
      window.fetch = nativeFetch
      G.__itamFetchPatched = false
    }
    const patchedFetch: typeof window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input as Request).url)
      // ── Match any authenticated ITAM API call ──
      // Includes /api/master, /api/sites, /api/meter, /api/cycles,
      // /api/reports, /api/notifications, /api/audit, /api/settings
      // so that legacy `fetch()` calls without explicit authHeaders() also
      // get the Bearer token attached.
      const isAuthUrl =
        url.includes('/api/itam/') ||
        url.includes('/api/v1/') ||
        url.includes('/api/work-orders') ||
        url.includes('/api/devices') ||
        url.includes('/api/stock-items') ||
        url.includes('/api/dashboard') ||
        url.includes('/api/sync/preview') ||
        url.includes('/api/master') ||
        url.includes('/api/sites') ||
        url.includes('/api/meter') ||
        url.includes('/api/cycles') ||
        url.includes('/api/reports') ||
        url.includes('/api/notifications') ||
        url.includes('/api/audit') ||
        url.includes('/api/settings') ||
        url.includes('/api/search') ||
        url.includes('/api/import') ||
        url.includes('/api/health')
      const isLoginUrl = url.includes('/api/itam/auth/login')
      if (isAuthUrl && !isLoginUrl) {
        const token = useAuthStore.getState().token
        if (token) {
          const headers = new Headers(init?.headers || {})
          // Only add Authorization if not already present (avoid double-setting)
          if (!headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${token}`)
          }
          if (!headers.has('Content-Type') && init?.body && typeof init.body === 'string') {
            headers.set('Content-Type', 'application/json')
          }
          return nativeFetch(input, { ...init, headers })
        }
      }
      return nativeFetch(input, init)
    }
    window.fetch = patchedFetch
    G.__itamFetchPatched = true
    return () => {
      window.fetch = nativeFetch
      G.__itamFetchPatched = false
    }
  }, [])

  // ── Phase 1: SSR + first client render (hydration) ──
  // Neutral boot screen — identical markup on server and client, so React
  // hydration always matches. Never touches localStorage during render.
  if (!mounted) {
    return <BootScreen label="กำลังตรวจสอบเซสชัน..." />
  }

  // ── Phase 2: client-only (post-mount). localStorage is readable now. ──
  // Boot screen — only show if we're actually waiting for a token check
  // (not when there's no token, which means login page should show)
  if (!bootDone) {
    // Check if there's actually a token — if not, skip boot screen
    const hasToken = typeof window !== 'undefined' && useAuthStore.getState().token
    if (!hasToken) {
      // No token — go straight to login
      return <ItamLogin />
    }
    return <BootScreen label="กำลังตรวจสอบเซสชัน..." />
  }

  // ── Auto-detect mobile device ──
  // showMobileMode is computed above (before early returns) to comply with
  // Rules of Hooks. It's true when:
  //   1. User explicitly clicks "โหมดมือถือ" button (activePage === 'mobile')
  //   2. Auto-detected as mobile device (isMobileDevice === true)

  // ── If URL has ?token=xxx → render the appropriate auth page ──
  // This takes priority over both "not authenticated" (login) and
  // "authenticated" (app shell) — the user clicked an email link and
  // should land on the register/reset form, not be redirected away.
  if (authToken) {
    return <TokenRouter token={authToken} />
  }

  // Not authenticated → show login
  if (!isAuthenticated) {
    return <ItamLogin />
  }

  // Authenticated → show app shell.
  //
  // Layout strategy (Issue 5): the whole app fits in one viewport.
  // - Outer wrapper: `h-screen overflow-hidden` — clips at viewport height
  // - Inner content wrapper: `flex-1 flex flex-col overflow-hidden` — column layout
  // - <main>: `flex-1 overflow-y-auto` — page scrolls internally if too tall
  // - <Footer>: `flex-shrink-0` — always pinned at the bottom of the viewport
  //
  // Pages with long content (2,378-row device table) scroll inside <main>;
  // pages with short content fit in one screen without scrolling.
  // ── Mobile mode: full-screen MobileShell (no desktop sidebar/footer) ──
  // Triggered when:
  //   1. User explicitly clicks "โหมดมือถือ" button (activePage === 'mobile')
  //   2. Auto-detected as mobile device (isMobileDevice === true)
  if (showMobileMode) {
    return (
      <RealtimeProvider>
        <MobileShell />
      </RealtimeProvider>
    )
  }

  return (
    <RealtimeProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background dark:bg-slate-950">
        <DemoBanner />
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden md:ml-14">
          <main className="flex-1 overflow-x-hidden overflow-y-auto pt-14 md:pt-0">
            {/* Keep-alive pattern: render all pages once, hide inactive with CSS.
                This preserves form state (search filters, draft inputs) when
                navigating between pages — no more "start over" when going back.
                Only render the active page on first visit (lazy mount) then keep. */}
            <KeepAlivePage active={isActive('dashboard') || isActive('itam')}>
              <ItamDashboard />
            </KeepAlivePage>
            <KeepAlivePage active={isActive('itam-devices') || isActive('devices') || isActive('devices-page')}>
              <DevicesPage />
            </KeepAlivePage>
            <KeepAlivePage active={isActive('itam-meter') || isActive('meter') || isActive('itam-meter-keyboard')}>
              <ItamMeterUnified />
            </KeepAlivePage>
            <KeepAlivePage active={isActive('itam-work-orders') || isActive('work-orders')}>
              <WorkOrdersPage />
            </KeepAlivePage>
            <KeepAlivePage active={isActive('itam-stock') || isActive('stock')}>
              <StockPage />
            </KeepAlivePage>
            <KeepAlivePage active={isActive('itam-paper-analytics') || isActive('paper-analytics') || isActive('paper-analytics-page')}>
              <ItamPaperAnalytics />
            </KeepAlivePage>
            <KeepAlivePage active={isActive('reports-hub')}>
              <ReportsHub />
            </KeepAlivePage>
            <KeepAlivePage active={isActive('material-cost')}>
              <MaterialCostReport />
            </KeepAlivePage>
            <KeepAlivePage active={isActive('monthly-report')}>
              <MonthlyReport />
            </KeepAlivePage>
            <KeepAlivePage active={isActive('pm-schedules')}>
              <PMSchedulesPage />
            </KeepAlivePage>
            <KeepAlivePage active={isActive('templates')}>
              <TemplatesPage />
            </KeepAlivePage>
            <KeepAlivePage active={isActive('import')}>
              <ImportPage />
            </KeepAlivePage>
            <KeepAlivePage active={isActive('itam-settings') || isActive('settings')}>
              <ItamSettings />
            </KeepAlivePage>
            <KeepAlivePage active={isActive('itam-audit')}>
              <ItamAudit />
            </KeepAlivePage>
            {/* REMOVED: Snapshots page — feature disabled (Prisma models removed from schema) */}
            <KeepAlivePage active={isActive('itam-repairs')}>
              <ItamRepairs />
            </KeepAlivePage>
            <KeepAlivePage active={isActive('itam-sticker-editor')}>
              <ItamStickerEditor />
            </KeepAlivePage>
            <KeepAlivePage active={isActive('itam-document-editor')}>
              <ItamDocumentEditor />
            </KeepAlivePage>
            <KeepAlivePage active={isActive('meter-page')}>
              <MeterPage />
            </KeepAlivePage>
          </main>
          <Footer />
        </div>
        <GlobalSearch />
        {/* QR scanner dialog — singleton, opened from sidebar/devices page */}
        <QrScannerDialog />
        {/* PWA install prompt — floating, only shows when installable */}
        <PwaInstallButton />
        {/* PWA update prompt — shows when a new SW version is waiting */}
        <PwaUpdatePrompt />
      </div>
    </RealtimeProvider>
  )
}

// ─── BootScreen ──────────────────────────────────────────────────────
// Full-screen neutral loader used during SSR/hydration and auth checks.
// Rendered identically on server and client (no localStorage reads), so it
// is safe to use as the hydration-phase fallback in HomePage and TokenRouter.
function BootScreen({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-[#f97316]" />
        <div className="text-sm text-slate-400">{label}</div>
      </div>
    </div>
  )
}

// ─── TokenRouter ─────────────────────────────────────────────────────
// Fetches the token type from /api/auth/verify-token and renders either
// AuthRegisterPage (for 'invite'/'register' tokens) or AuthResetPage
// (for 'reset' tokens). Falls back to login on any error.
function TokenRouter({ token }: { token: string }) {
  const [route, setRoute] = React.useState<'register' | 'reset' | 'loading' | 'error'>('loading')

  React.useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const res = await fetch(
          `/api/auth/verify-token?token=${encodeURIComponent(token)}`,
        )
        const j = (await res.json().catch(() => ({}))) as {
          valid?: boolean
          type?: string
        }
        if (cancelled) return
        if (!j.valid) {
          setRoute('error')
          return
        }
        if (j.type === 'reset') {
          setRoute('reset')
        } else if (j.type === 'invite' || j.type === 'register') {
          setRoute('register')
        } else {
          setRoute('error')
        }
      } catch {
        if (!cancelled) setRoute('error')
      }
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [token])

  if (route === 'loading') {
    return <BootScreen label="กำลังตรวจสอบลิงก์..." />
  }

  if (route === 'register') return <AuthRegisterPage token={token} />
  if (route === 'reset') return <AuthResetPage token={token} />

  // Error → fall back to login (which shows its own error UI)
  // Clear the broken token from the URL first.
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href)
    url.searchParams.delete('token')
    window.history.replaceState({}, '', url.toString())
  }
  return <ItamLogin />
}

// ─── KeepAlivePage ────────────────────────────────────────────────────
// Renders children once (lazy mount on first activation), then keeps
// them mounted but hidden (display: none) when inactive.
// This preserves component state (form inputs, scroll position, filters)
// when navigating between pages — no more "start over" when going back.
//
// Pattern: similar to Vue's <keep-alive> or React's Offscreen component.
// Uses CSS display:none (not visibility:hidden) so inactive pages don't
// consume layout/paint resources.
//
function KeepAlivePage({
  active,
  children,
}: {
  active: boolean
  children: React.ReactNode
}) {
  const [mounted, setMounted] = React.useState(active)
  // Mount on first activation, then keep mounted
  React.useEffect(() => {
    if (active && !mounted) setMounted(true)
  }, [active, mounted])

  if (!mounted) return null
  return (
    <div
      style={{ display: active ? 'block' : 'none' }}
      aria-hidden={!active}
      className={active ? 'h-full' : ''}
    >
      {children}
    </div>
  )
}
