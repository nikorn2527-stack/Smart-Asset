/**
 * suffix-search.ts — shared suffix-aware search helper.
 *
 * Design (USER-FEEDBACK):
 *   When a user types a SHORT NUMERIC query like "123" in a search box, they
 *   usually mean "ending in 123" (the last 3 digits of a serial/assetCode/
 *   PO number they read off a sticker). Previously the code used `.includes()`
 *   which matched "123" anywhere — so "123" returned "1240", "1241", "1234",
 *   etc. (every code containing the substring "123"). The user expected
 *   only codes that END with "123" (e.g. "X8H2029123" → ends with "123" ✓,
 *   "ABC-123" → word-boundary match ✓).
 *
 * Rules:
 *   • Numeric short query (1-6 digits, no letters):
 *       - Identifier fields (assetCode, serialNumber, assetSiteCode, productCode,
 *         woNumber, poNumber, txnNumber, etc.): match if value ENDS WITH the
 *         needle, OR contains it as a word-boundary segment (e.g. "ABC-123").
 *       - Text fields (brand, model, department, name): fall back to contains
 *         so users can still search by brand/model.
 *   • Non-numeric OR longer queries (e.g. "EPSON", "L5290", full asset codes):
 *       - Use legacy `.includes()` (contains anywhere) — these are
 *         intentional text searches where contains is correct.
 *
 * Usage:
 *   • Client-side filter:
 *       import { matchesSuffixOrContains } from '@/lib/suffix-search'
 *       const filtered = devices.filter(d => matchesSuffixOrContains(d.assetCode, q))
 *
 *   • Server-side (Prisma) route:
 *       import { isNumericShortQuery } from '@/lib/suffix-search'
 *       if (isNumericShortQuery(search)) {
 *         where.OR = [{ assetCode: { endsWith: search } }, ...]
 *       } else {
 *         where.OR = [{ assetCode: { contains: search } }, ...]
 *       }
 *
 * NOTE: Prisma's `endsWith` is case-sensitive on PostgreSQL by default.
 * For case-insensitive suffix matching, you'd need a `mode: 'insensitive'`
 * option (PostgreSQL only). We pass through `mode: 'insensitive'` in the
 * helper below so callers don't have to remember.
 */

/**
 * Detects whether a search query should be treated as a "numeric short"
 * suffix query. Returns true if the query is 1-6 digits with no letters or
 * special characters.
 */
export function isNumericShortQuery(q: string): boolean {
  if (!q) return false
  return /^\d{1,6}$/.test(q.trim())
}

/**
 * Suffix-or-boundary match for client-side filtering.
 *
 * Returns true if `value` matches `needle`:
 *   • value ENDS WITH needle (suffix match — e.g. "X8H2029123" ends with "123")
 *   • OR value contains needle as a word-boundary segment
 *     (e.g. "ABC-123" contains "123" between "-" and end-of-string)
 *
 * Both checks are case-insensitive.
 *
 * @param value - the field value to search in (e.g. device.assetCode)
 * @param needle - the user's search query (e.g. "123")
 */
export function suffixOrBoundaryMatch(
  value: string | null | undefined,
  needle: string,
): boolean {
  if (!value || !needle) return false
  const v = String(value).toLowerCase()
  const n = needle.toLowerCase()
  // Suffix match (most common — user read the last N digits off a sticker)
  if (v.endsWith(n)) return true
  // Word-boundary match (handles compound codes like "ABC-123" or "IT/M-123")
  // The regex matches the needle when preceded AND followed by a non-alphanumeric
  // character (or start/end of string).
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i')
  return re.test(v)
}

/**
 * Combined matcher: applies suffix-or-boundary match for numeric-short queries,
 * falls back to `.includes()` for everything else.
 *
 * Use this as a drop-in replacement for `String(v).toLowerCase().includes(q)`.
 *
 * @param value - field value (e.g. device.assetCode)
 * @param query - user's search query
 * @param options.identifierField - if true (default), treat as an identifier
 *   field (apply suffix match for numeric-short queries). If false, always use
 *   contains (for free-text fields like brand/model/department/name).
 */
export function matchesSuffixOrContains(
  value: string | null | undefined,
  query: string,
  options: { identifierField?: boolean } = {},
): boolean {
  const { identifierField = true } = options
  if (!value || !query) return false
  const v = String(value).toLowerCase()
  const q = query.trim().toLowerCase()
  if (!q) return false

  if (identifierField && isNumericShortQuery(q)) {
    return suffixOrBoundaryMatch(v, q)
  }
  // Free-text or non-numeric query: legacy contains behavior.
  return v.includes(q)
}

/**
 * Build a Prisma where-clause fragment for a single field that applies
 * suffix-aware matching when the query is numeric-short.
 *
 * For numeric-short queries: use `endsWith` (case-insensitive).
 * For everything else: use `contains` (case-insensitive).
 *
 * Caller is responsible for combining the returned fragment into the
 * overall where-clause (e.g. wrapping in an `OR` array).
 *
 * @example
 *   const where = {
 *     OR: [
 *       suffixWhereFragment('assetCode', search),
 *       suffixWhereFragment('serialNumber', search),
 *       { brand: { contains: search, mode: 'insensitive' } },
 *     ],
 *   }
 */
export function suffixWhereFragment(
  field: string,
  query: string,
): Record<string, { endsWith?: string; contains?: string; mode?: 'insensitive' }> {
  const q = query.trim()
  if (isNumericShortQuery(q)) {
    return { [field]: { endsWith: q, mode: 'insensitive' } }
  }
  return { [field]: { contains: q, mode: 'insensitive' } }
}

/**
 * Build a Prisma OR-clause for a list of identifier fields, applying
 * suffix-aware matching to each. For numeric-short queries, this emits
 * `endsWith` for each field; otherwise `contains`.
 *
 * @example
 *   const where = {
 *     OR: buildSuffixOrClause(['assetCode', 'serialNumber'], search),
 *   }
 */
export function buildSuffixOrClause(
  fields: string[],
  query: string,
): Array<Record<string, { endsWith?: string; contains?: string; mode?: 'insensitive' }>> {
  return fields.map((f) => suffixWhereFragment(f, query))
}
