'use client'

/**
 * useClock — a tiny hook that returns a `Date` object which updates every
 * second. Used by the sidebar header + footer to show a live Thai time/date.
 *
 * The hook is SSR-safe: it starts with `null` on the server (and during the
 * first client render), then sets the real time in `useEffect`. Callers
 * should render a stable placeholder while `now === null` to avoid hydration
 * mismatch warnings.
 */
import * as React from 'react'

export function useClock(intervalMs = 1000): Date | null {
  const [now, setNow] = React.useState<Date | null>(null)
  React.useEffect(() => {
    // Set immediately so we don't wait a full tick before showing the time.
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

// ─── Locale-aware formatting helpers ────────────────────────────────────────
// Default 'th' preserves the old behaviour (th-TH + Buddhist year).
// Pass lang='en' to get Gregorian en-GB output — the sidebar clock and the
// TopBarClock do this via useLang() so the time/date flip with the toggle.

function timeFormatter(lang: 'th' | 'en') {
  return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function dateFormatter(lang: 'th' | 'en') {
  return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** "14:23:05" — empty string until mounted (avoids hydration mismatch). */
export function formatThaiTime(now: Date | null, lang: 'th' | 'en' = 'th'): string {
  if (!now) return ''
  return timeFormatter(lang).format(now)
}

/** "วันพุธที่ 13 สิงหาคม 2568" — empty string until mounted. */
export function formatThaiDate(now: Date | null, lang: 'th' | 'en' = 'th'): string {
  if (!now) return ''
  return dateFormatter(lang).format(now)
}
