/**
 * Null-safe locale formatting helpers.
 *
 * Production data may contain `null`/`undefined` numeric or date fields that
 * TypeScript types declare as non-null. Calling `.toLocaleString` directly with a
 * hard-coded 'th-TH' locale also ignores the user's language choice and
 * crashes the page with:
 *   `TypeError: Cannot read properties of undefined (reading 'toLocaleString')`
 * These helpers never throw — they return `'0'` for falsy numeric input and
 * `'—'` for falsy date input.
 *
 * NOTE: Most call sites still use inline `(value ?? 0).toLocaleString('th-TH')`
 * guards rather than this helper, to minimize regression risk. New code is
 * encouraged to use `safeLocaleNumber` / `safeLocaleDate` instead.
 */

/**
 * Safe number formatting — never crashes on undefined/null/NaN.
 * Returns '0' for falsy values instead of throwing TypeError.
 */
export function safeLocaleNumber(
  value: number | string | null | undefined,
  locale: string = 'th-TH',
  options?: Intl.NumberFormatOptions,
): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString(locale, options)
}

/**
 * Safe date formatting — never crashes on undefined/null/invalid input.
 * Returns '—' for falsy or un-parseable values.
 */
export function safeLocaleDate(
  iso: string | number | Date | null | undefined,
  locale: string = 'th-TH',
  options?: Intl.DateTimeFormatOptions,
): string {
  if (iso === null || iso === undefined || iso === '') return '—'
  try {
    const d = iso instanceof Date ? iso : new Date(iso as string)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleString(locale, options)
  } catch {
    return '—'
  }
}
