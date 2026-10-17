'use client'

/**
 * PwaUpdatePrompt — shows a toast-like banner when a new service worker
 * version is waiting to activate.
 *
 * Per consultant blueprint ข้อ 5.2:
 *   "เพิ่ม 'update available, กดรีเฟรช' prompt เมื่อ SW เวอร์ชันใหม่พร้อม
 *    กัน user ค้างเวอร์ชันเก่าโดยไม่รู้ตัวหลัง deploy"
 *
 * The SW already calls self.skipWaiting() on install, so the new version
 * activates immediately. This component detects when a new SW has taken
 * control (controllerchange event) and shows a non-intrusive banner
 * suggesting the user refresh to get the latest UI.
 *
 * Uses the global i18n store for TH/EN labels.
 */

import * as React from 'react'
import { RefreshCw, X } from 'lucide-react'
import { useT } from '@/store/i18n-store'

export function PwaUpdatePrompt() {
  const t = useT()
  const [showUpdate, setShowUpdate] = React.useState(false)
  const dismissedRef = React.useRef(false)

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    // Skip in dev mode (SW not registered)
    if (process.env.NODE_ENV === 'development') return

    // Check if a new SW is already waiting
    function checkWaiting() {
      navigator.serviceWorker.getRegistration('/').then((reg) => {
        if (reg?.waiting && !dismissedRef.current) {
          setShowUpdate(true)
        }
      }).catch(() => null)
    }

    // Check on mount
    checkWaiting()

    // Listen for new SW installation
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // New SW took control — suggest refresh if not already dismissed
      if (!dismissedRef.current) {
        setShowUpdate(true)
      }
    })

    // Check periodically (every 5 min, same as reg.update() interval)
    const interval = setInterval(checkWaiting, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  function handleRefresh() {
    // Tell the waiting SW to skip waiting (activates immediately)
    navigator.serviceWorker.getRegistration('/').then((reg) => {
      if (reg?.waiting) {
        reg.waiting.postMessage('SKIP_WAITING')
      }
    }).catch(() => null)
    // Reload after a short delay to let the SW activate
    setTimeout(() => window.location.reload(), 500)
  }

  function handleDismiss() {
    setShowUpdate(false)
    dismissedRef.current = true
    // Don't show again for this session
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('itam.pwa-update-dismissed', '1')
    }
  }

  // Check if dismissed this session
  React.useEffect(() => {
    if (typeof sessionStorage !== 'undefined' &&
        sessionStorage.getItem('itam.pwa-update-dismissed') === '1') {
      dismissedRef.current = true
    }
  }, [])

  if (!showUpdate) return null

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-[400] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-[#f97316]/30 bg-white px-4 py-3 shadow-lg dark:border-[#fb923c]/30 dark:bg-slate-900"
    >
      <RefreshCw className="h-4 w-4 flex-shrink-0 text-[#f97316]" />
      <div className="text-sm text-slate-700 dark:text-slate-200">
        {t('pwa.update_available')}
      </div>
      <button
        type="button"
        onClick={handleRefresh}
        className="flex-shrink-0 rounded-md bg-[#f97316] px-3 py-1 text-xs font-medium text-white transition hover:bg-[#ea580c]"
      >
        {t('pwa.refresh_now')}
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t('common.close')}
        className="flex-shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
