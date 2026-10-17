/**
 * server-i18n.ts — Server-side i18n helpers.
 *
 * I18N-04: server-side render routes (report, template, print) format
 * dates/numbers/labels server-side. The app is Thai-only now (Phase F),
 * so the language is always 'th' — the `?lang=` param, `itam-lang` cookie
 * and Accept-Language sniffing were removed with the client toggle, but
 * these helpers kept their signatures so existing call sites don't change.
 *
 * Usage in a route handler:
 *   import { getServerLang, serverTranslate, serverFormatDate } from '@/lib/server-i18n'
 *   const lang = getServerLang(req)
 *   const title = serverTranslate('reports.title', lang)
 *   const dateStr = serverFormatDate(wo.createdAt, lang)
 */

import type { NextRequest } from 'next/server'
import { translate, type Lang, GLOSSARY } from '@/lib/i18n'

// Re-exported so route handlers can type their own `lang` values by importing
// from this module — several print/report routes already try to do exactly that.
export type { Lang }

/**
 * Resolve the language for server-side rendering.
 *
 * The app is Thai-only now (Phase F) — this always returns 'th'. The
 * `?lang=` override, cookie parsing and Accept-Language sniffing were
 * removed together with the client-side toggle.
 */
export function getServerLang(_req: NextRequest | Request): Lang {
  return 'th'
}

/**
 * Server-side translate — same as client translate() but uses a lang
 * resolved from the request (not the Zustand store).
 */
export function serverTranslate(key: string, lang: Lang): string {
  return translate(key, lang)
}

/**
 * Server-side date formatter — locale-aware (th-TH Buddhist / en-GB Gregorian).
 *
 * Accepts `null`/`undefined` (rendering an em-dash) because print/report routes
 * print nullable WorkOrder columns — e.g. `workCompletedAt` is `DateTime?` —
 * and previously those call sites had to special-case the null themselves.
 */
export function serverFormatDate(
  iso: string | Date | null | undefined,
  lang: Lang = 'th',
): string {
  if (iso === null || iso === undefined || iso === '') return '—'
  try {
    const d = typeof iso === 'string' ? new Date(iso) : iso
    if (isNaN(d.getTime())) return String(iso)
    const locale = lang === 'th' ? 'th-TH' : 'en-GB'
    return new Intl.DateTimeFormat(locale, {
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
 * Server-side date+time formatter.
 */
export function serverFormatDateTime(iso: string | Date, lang: Lang = 'th'): string {
  try {
    const d = typeof iso === 'string' ? new Date(iso) : iso
    if (isNaN(d.getTime())) return String(iso)
    const locale = lang === 'th' ? 'th-TH' : 'en-GB'
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(lang === 'th' ? { calendar: 'buddhist' } : {}),
    }).format(d)
  } catch {
    return String(iso)
  }
}

/**
 * Server-side number formatter.
 */
export function serverFormatNumber(value: number, lang: Lang = 'th', options?: Intl.NumberFormatOptions): string {
  try {
    const locale = lang === 'th' ? 'th-TH' : 'en-GB'
    return new Intl.NumberFormat(locale, options).format(value)
  } catch {
    return String(value)
  }
}

/**
 * Server-side currency formatter (THB default).
 */
export function serverFormatCurrency(value: number, lang: Lang = 'th', currency = 'THB'): string {
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

/**
 * Get the full dictionary for a lang — useful for server-side report
 * generators that need to look up many keys (avoids repeated calls).
 */
export function getServerGlossary(lang: Lang): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(GLOSSARY)) {
    result[key] = entry[lang] ?? entry.th ?? key
  }
  return result
}
