'use client'

/**
 * PWA registration + install prompt.
 *
 * Registers /sw.js on mount (skipped during SSR / dev to avoid caching dev
 * assets that change on every HMR).
 *
 * Exposes two helpers via the React tree:
 *   • <PwaRegistration />   — registers the service worker
 *   • <PwaInstallButton />  — renders an "ติดตั้งแอป" button when the
 *                              `beforeinstallprompt` event has fired
 */

import * as React from 'react'

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  prompt: () => Promise<void>
}

function useServiceWorker() {
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    // Skip registration during Next dev mode — SW caching fights HMR and
    // causes stale JS to be served, leading to "Application error" crashes.
    if (process.env.NODE_ENV === 'development') {
      console.info('[PWA] dev mode — skipping /sw.js registration (prevents stale cache)')
      // ── AGGRESSIVE SW CLEANUP IN DEV MODE ──
      // If the user previously visited the production site, a service worker
      // is still registered in their browser. That SW intercepts requests to
      // the dev server and serves stale chunks, causing "This page couldn't
      // load" crashes. We must UNREGISTER it + clear all caches on every
      // page load in dev mode.
      ;(async () => {
        try {
          const regs = await navigator.serviceWorker.getRegistrations()
          if (regs.length > 0) {
            console.info(`[PWA] dev mode — unregistering ${regs.length} stale SW(s)`)
            await Promise.all(regs.map((r) => r.unregister()))
          }
          // Clear all caches (itam-shell-*, itam-api-*, etc.)
          if ('caches' in window) {
            const keys = await caches.keys()
            if (keys.length > 0) {
              console.info(`[PWA] dev mode — clearing ${keys.length} cache(s):`, keys)
              await Promise.all(keys.map((k) => caches.delete(k)))
            }
          }
          // Force a clean reload if we just unregistered a SW (the SW won't
          // be fully gone until the next navigation).
          if (regs.length > 0) {
            console.info('[PWA] dev mode — forcing clean reload after SW unregister')
            // Use a flag in sessionStorage to avoid infinite reload loops.
            const reloadFlag = 'itam.sw-cleared'
            if (!sessionStorage.getItem(reloadFlag)) {
              sessionStorage.setItem(reloadFlag, '1')
              window.location.reload()
            } else {
              // Already reloaded once but SW still existed — clear flag and
              // let the user manually reload if needed.
              sessionStorage.removeItem(reloadFlag)
            }
          }
        } catch (err) {
          console.warn('[PWA] dev mode — SW cleanup failed:', err)
        }
      })()
      return
    }
    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          // Check for updates every 5 minutes.
          setInterval(() => reg.update().catch(() => null), 5 * 60 * 1000)
        })
        .catch((err) => {
          console.warn('[PWA] SW registration failed:', err)
        })
    }
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
    return () => window.removeEventListener('load', register)
  }, [])
}

export function PwaRegistration() {
  useServiceWorker()
  return null
}

/**
 * Install button — listens for `beforeinstallprompt` (Chrome/Edge/Android),
 * renders an "ติดตั้งแอป" button when installable. On iOS Safari there is no
 * programmatic prompt; we show a hint banner instead.
 */
export function PwaInstallButton({ className }: { className?: string }) {
  const [deferred, setDeferred] = React.useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = React.useState(false)
  const [iosHint, setIosHint] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === 'undefined') return

    // Already installed? (standalone display mode)
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    if (standalone) {
      setInstalled(true)
      return
    }

    function onBeforeInstall(e: Event) {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    function onInstalled() {
      setInstalled(true)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall as EventListener)
    window.addEventListener('appinstalled', onInstalled)

    // iOS detection — no beforeinstallprompt available
    const ua = window.navigator.userAgent
    const isIos = /iPad|iPhone|iPod/.test(ua)
    const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua)
    if (isIos && isSafari) {
      // Show hint after 3 seconds (only once per session)
      const seen = window.sessionStorage.getItem('itam.pwa-ios-hint-seen')
      if (!seen) {
        const t = setTimeout(() => {
          setIosHint(true)
          window.sessionStorage.setItem('itam.pwa-ios-hint-seen', '1')
        }, 3000)
        return () => {
          clearTimeout(t)
          window.removeEventListener('beforeinstallprompt', onBeforeInstall as EventListener)
          window.removeEventListener('appinstalled', onInstalled)
        }
      }
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall as EventListener)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function handleInstall() {
    if (!deferred) return
    await deferred.prompt()
    const choice = await deferred.userChoice
    if (choice.outcome === 'accepted') setInstalled(true)
    setDeferred(null)
  }

  if (installed) return null

  // iOS hint — small toast-like banner with share+add instructions
  if (iosHint) {
    return (
      <div
        role="dialog"
        aria-live="polite"
        className={
          'pointer-events-auto fixed bottom-4 right-4 z-[300] flex max-w-xs items-start gap-2 rounded-lg border border-orange-200 bg-white p-3 text-xs text-slate-700 shadow-lg dark:border-orange-800 dark:bg-slate-900 dark:text-slate-200 ' +
          (className ?? '')
        }
      >
        <span className="text-base" aria-hidden>📲</span>
        <div className="flex-1">
          <div className="font-semibold text-slate-800 dark:text-slate-100">ติดตั้งแอปบน iPhone</div>
          <div className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
            แต่ปุ่ม <span className="font-semibold">แชร์</span> ด้านล่าง → เลือก &quot;เพิ่มไปยังหน้าจอหลัก&quot;
          </div>
        </div>
        <button
          type="button"
          aria-label="ปิด"
          onClick={() => setIosHint(false)}
          className="ml-1 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
        >
          ✕
        </button>
      </div>
    )
  }

  if (!deferred) return null

  return (
    <button
      type="button"
      onClick={handleInstall}
      className={
        'pointer-events-auto inline-flex items-center gap-1.5 rounded-md border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 transition hover:border-orange-400 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-300 dark:hover:bg-orange-950/60 ' +
        (className ?? '')
      }
      title="ติดตั้งแอปลงบนอุปกรณ์นี้เพื่อใช้งานแบบออฟไลน์"
    >
      <span aria-hidden>📲</span>
      ติดตั้งแอป
    </button>
  )
}
