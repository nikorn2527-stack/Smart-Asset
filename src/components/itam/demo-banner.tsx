'use client'

/**
 * DemoBanner — sticky amber banner shown when the logged-in user is a demo
 * user (`User.isDemo === true`). The banner sits at the very top of the app
 * shell, above the sidebar, so it stays visible on every page.
 *
 * The banner is purely informational — it reminds the user that any data
 * they create will be tagged `isDemo: true` and can be wiped in one click
 * from Settings → สาธิตระบบ.
 */

import * as React from 'react'
import { useAuthStore } from '@/store/auth-store'
import { useT } from '@/store/i18n-store'

export function DemoBanner() {
  const isDemo = useAuthStore((s) => s.user?.isDemo === true)
  const t = useT()
  // Avoid rendering anything for real users — keeps the layout untouched.
  if (!isDemo) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-shrink-0 items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-center text-xs font-semibold text-white shadow-sm"
    >
      <span aria-hidden>⚠️</span>
      <span>{t('demo.banner')}</span>
    </div>
  )
}
