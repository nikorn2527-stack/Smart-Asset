'use client'

/**
 * TopBarClock — small live clock that floats at the top-right of the screen
 * (desktop only, md+). Renders the time + a compact Thai Buddhist date so
 * users can glance at the current time without scrolling to the footer.
 *
 * Format: "14:23:05 · วันพุธ 13 ส.ค. 68"
 *   - 14:23:05   — 24-hour time, tabular-nums for stable width
 *   - วันพุธ     — short weekday
 *   - 13 ส.ค.    — day + abbreviated month
 *   - 68         — Buddhist year modulo 100 (2568 → 68)
 *
 * SSR-safe: renders a stable placeholder until mounted (no hydration warning).
 */
import * as React from 'react'
import { useClock } from '@/hooks/use-clock'
import { useLang, useT } from '@/store/i18n-store'

// Compact formatters — lang-aware ('th' = Buddhist year, 'en' = Gregorian).
function timeFmt(lang: 'th' | 'en') {
  return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function dateFmt(lang: 'th' | 'en') {
  return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  })
}

export function TopBarClock() {
  const now = useClock()
  const t = useT()
  const { lang } = useLang()
  if (!now) {
    // Stable placeholder so the layout width doesn't jump on mount.
    return (
      <div
        className="hidden h-9 items-center gap-2 rounded-md border border-slate-200 bg-white/90 px-2.5 text-[11px] text-slate-400 shadow-sm backdrop-blur md:flex dark:border-white/10 dark:bg-slate-900/80 dark:text-slate-500"
        aria-hidden
      >
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
        <span className="font-mono tabular-nums">--:--:--</span>
        <span className="text-slate-300 dark:text-slate-400">·</span>
        <span className="whitespace-nowrap">{t('common.loading')}</span>
      </div>
    )
  }

  const timeStr = timeFmt(lang).format(now)
  // Intl weekday:short returns e.g. "พุธ" (no "วัน" prefix). Prefix with
  // "วัน" for natural Thai reading; EN keeps the raw short form.
  const rawDate = dateFmt(lang).format(now)
  const dateStr = lang === 'th' && !rawDate.startsWith('วัน') ? `วัน${rawDate}` : rawDate
  const clockLabel = t('clock.now')

  return (
    <div
      className="hidden h-9 items-center gap-2 rounded-md border border-slate-200 bg-white/90 px-2.5 text-[11px] text-slate-700 shadow-sm backdrop-blur md:flex dark:border-white/10 dark:bg-slate-900/80 dark:text-slate-200"
      role="status"
      aria-label={`${clockLabel} ${timeStr} ${dateStr}`}
      title={`${clockLabel} ${timeStr} ${dateStr}`}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#f97316]"
      />
      <span className="font-mono font-semibold tabular-nums tracking-tight">
        {timeStr}
      </span>
      <span className="text-slate-300 dark:text-slate-400">·</span>
      <span className="whitespace-nowrap text-slate-500 dark:text-slate-400">
        {dateStr}
      </span>
    </div>
  )
}
