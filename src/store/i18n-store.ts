/**
 * i18n-store.ts — language state for the ITAM app.
 *
 * Thai-only (Phase F): the TH/EN toggle was removed, so the store is a
 * fixed `lang: 'th'` singleton — no persistence and no cookie sync.
 *
 * Exports:
 *   - useI18nStore     — store hook (lang, t)
 *   - useT             — convenience hook returning the bound translate fn
 *   - formatDate       — locale-aware date formatter (พ.ศ./เดือนไทย when TH)
 *   - formatDateTime   — same but with time
 */

'use client'

import * as React from 'react'
import { create } from 'zustand'
import { translate, type Lang } from '@/lib/i18n'
import { getStatusLabel } from '@/lib/status-labels'

interface I18nState {
  lang: Lang
  t: (key: string) => string
}

export const useI18nStore = create<I18nState>()(() => ({
  lang: 'th',
  t: (key: string) => translate(key, 'th'),
}))

/**
 * Convenience hook: returns a translate function bound to the current lang.
 *
 * Implementation note: this subscribes to `s.lang`, NOT to `s.t`, so if
 * the language source ever changes again (e.g. a future toggle returns),
 * components using only useT() still re-render and all strings flip.
 *
 * Usage:
 *   const t = useT()
 *   <button>{t('menu.dashboard')}</button>
 */
export function useT(): (key: string) => string {
  const lang = useI18nStore((s) => s.lang)
  return React.useCallback((key: string) => translate(key, lang), [lang])
}

/**
 * Convenience hook for components that need the current lang.
 *
 * Usage:
 *   const { lang } = useLang()
 */
export function useLang() {
  const lang = useI18nStore((s) => s.lang)
  return { lang }
}

/**
 * Read the current language WITHOUT React (imperative, non-reactive).
 *
 * Use this from module-scope helper functions (`formatDate`, `formatBaht`, …)
 * that are exported alongside components but are not themselves components.
 * Those helpers cannot call hooks, so they previously referenced a bare
 * `lang` identifier that only existed inside a component body — producing
 * `TS2304: Cannot find name 'lang'` and, worse, forcing a hard-coded locale.
 *
 * IMPORTANT: this is NOT reactive. If a module-scope formatter is called
 * during render, prefer passing `lang` down from a component that used
 * `useLang()`. Use this helper for:
 *   • pure formatters invoked on user action / in callbacks,
 *   • non-React contexts (server code, event handlers),
 *   • locale selection where the previous behaviour was hard-coded.
 *
 * It is always safe on the server: the store's default `lang` is 'th'.
 */
export function getCurrentLang(): Lang {
  return useI18nStore.getState().lang
}

/**
 * Get a translate function bound to the CURRENT language, WITHOUT React.
 *
 * Same use cases as `getCurrentLang()`: module-scope helpers such as
 * `summaryLabel(key)`, `jobTypeLabel(type)`, `statusText(code)` that are
 * exported next to components but cannot call hooks.
 *
 * The returned function is a plain closure — it is not memoized, so do not
 * put it in a dependency array expecting identity stability. Inside React
 * components always prefer the `useT()` hook instead.
 */
export function getTranslator(): (key: string) => string {
  return (key: string) => translate(key, useI18nStore.getState().lang)
}

/**
 * Resolve the active BCP-47 locale from a language code.
 *
 * Central place so locale selection stays consistent between hooks,
 * module-scope formatters, and server-rendered output.
 */
export function localeFor(lang: Lang): string {
  return lang === 'th' ? 'th-TH' : 'en-GB'
}

// ── Locale-aware date formatters ─────────────────────────────────
//
// TH = Buddhist Era (พ.ศ.) + Thai short month names (e.g. "ก.ย.")
// EN = Gregorian (ค.ศ.) + English short month names (e.g. "Sept")
//
// Both use 24-hour HH:mm. Both are defensive against bad input.

export function formatDateTime(iso: string, lang: Lang = 'th'): string {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    const intlLocale = lang === 'th' ? 'th-TH' : 'en-GB'
    return new Intl.DateTimeFormat(intlLocale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(lang === 'th' ? { calendar: 'buddhist' } : {}),
    }).format(d)
  } catch {
    return iso
  }
}

/**
 * Formats a date for display.
 *
 * Accepts a Prisma `DateTime` as well as an ISO string: API routes print
 * WorkOrder.createdAt / assignedAt / workCompletedAt (all `DateTime`) directly
 * through this helper, and `new Date(dateObj)` is valid at runtime — only the
 * signature needed widening.
 */
export function formatDate(
  iso: Date | string | null | undefined,
  lang: Lang = 'th',
): string {
  if (iso === null || iso === undefined || iso === '') return '-'
  try {
    const d = iso instanceof Date ? iso : new Date(iso)
    if (isNaN(d.getTime())) return String(iso)
    const intlLocale = lang === 'th' ? 'th-TH' : 'en-GB'
    return new Intl.DateTimeFormat(intlLocale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      ...(lang === 'th' ? { calendar: 'buddhist' } : {}),
    }).format(d)
  } catch {
    return String(iso)
  }
}

/**
 * Hook-bound date formatters — these re-render the component when the
 * language changes. Use in components instead of the bare `formatDate`
 * / `formatDateTime` exports.
 */
export function useFormatDate() {
  const lang = useI18nStore((s) => s.lang)
  return React.useCallback(
    (iso: string) => formatDate(iso, lang),
    [lang],
  )
}

export function useFormatDateTime() {
  const lang = useI18nStore((s) => s.lang)
  return React.useCallback(
    (iso: string) => formatDateTime(iso, lang),
    [lang],
  )
}

// ── Locale-aware Number / Currency formatters (I18N-05 fix) ────────────────
//
// Components should use these hooks INSTEAD of calling `.toLocaleString('th-TH')`
// directly. Direct locale calls ignore the user's language choice and produce
// Thai-formatted numbers even when English is selected.
//
// Usage:
//   const fmtNum = useFormatNumber()
//   const fmtMoney = useFormatCurrency()
//   <span>{fmtNum(1234567)}</span>           // th: 1,234,567  | en: 1,234,567
//   <span>{fmtMoney(199.5)}</span>           // th: ฿199.50    | en: ฿199.50

export function formatNumber(value: number, lang: Lang = 'th', options?: Intl.NumberFormatOptions): string {
  try {
    const locale = lang === 'th' ? 'th-TH' : 'en-GB'
    return new Intl.NumberFormat(locale, options).format(value)
  } catch {
    return String(value)
  }
}

export function formatCurrency(value: number, lang: Lang = 'th', currency = 'THB'): string {
  try {
    const locale = lang === 'th' ? 'th-TH' : 'en-GB'
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(value)
  } catch {
    return String(value)
  }
}

export function useFormatNumber() {
  const lang = useI18nStore((s) => s.lang)
  return React.useCallback(
    (value: number, options?: Intl.NumberFormatOptions) => formatNumber(value, lang, options),
    [lang],
  )
}

export function useFormatCurrency() {
  const lang = useI18nStore((s) => s.lang)
  return React.useCallback(
    (value: number, currency?: string) => formatCurrency(value, lang, currency),
    [lang],
  )
}

// ── Status / enum label resolver (I18N-08) ───────────────────────────────────
//
// Components should call this instead of rendering raw DB status codes
// (`PENDING`, `Active`, `COMPLETED`, …) so the displayed label follows the
// user's selected language.
//
// Usage:
//   const status = useStatusLabel()
//   <Badge>{status(device.status)}</Badge>        // th: "ใช้งานอยู่" | en: "Active"
//   <span>{status(wo.status)}</span>              // th: "รอดำเนินการ" | en: "Pending"
//
// Unknown codes fall through to the raw string (so we don't hide data).

export function useStatusLabel() {
  const lang = useI18nStore((s) => s.lang)
  return React.useCallback(
    (code: string | null | undefined) => getStatusLabel(code, lang),
    [lang],
  )
}
