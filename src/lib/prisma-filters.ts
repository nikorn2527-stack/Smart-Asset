/**
 * prisma-filters.ts — Provider-agnostic Prisma string filters.
 *
 * WHY THIS EXISTS
 * ---------------
 * `prisma/schema.prisma`'s datasource provider is switched automatically by
 * `scripts/set-prisma-provider.mjs`:
 *
 *   • dev / Windows  → `sqlite`
 *   • production/CI  → `postgresql`
 *
 * `mode: 'insensitive'` is a **PostgreSQL-only** Prisma feature, so the
 * generated `StringFilter` type includes it only when the client was generated
 * against PostgreSQL. Writing `{ email: { equals: e, mode: 'insensitive' } }`
 * inline therefore type-checks on a Postgres-generated client but fails with
 *
 *   TS2353: 'mode' does not exist in type 'StringFilter<"User">'
 *
 * on a SQLite-generated client — even though the runtime is fine, because
 * `src/lib/db.ts` installs an `$extends` interceptor that strips `mode` before
 * the query reaches SQLite.
 *
 * THE FIX
 * -------
 * Build the filter through these helpers instead of an inline object literal.
 * TypeScript's excess-property check only fires on *fresh object literals*, so
 * returning a wider, provider-agnostic type from a function keeps call sites
 * assignable to whichever `StringFilter` the active provider generated — with
 * no `as any` / `as unknown as` casts at the call site.
 *
 * USAGE
 * -----
 *   // before — fails typecheck under the SQLite client
 *   where: { email: { equals: email, mode: 'insensitive' } }
 *
 *   // after — works under both providers
 *   where: { email: ciEquals(email) }
 *
 *   const q = search.trim()
 *   where: { OR: [
 *     { name: ciContains(q) },
 *     { assetCode: isNumericShortQuery(q) ? ciEndsWith(q) : ciContains(q) },
 *   ] }
 *
 * RUNTIME BEHAVIOUR (unchanged)
 * ------------------------------
 *   • PostgreSQL — `mode: 'insensitive'` is passed through, so matching is
 *     genuinely case-insensitive.
 *   • SQLite     — `src/lib/db.ts` strips `mode` before the query runs. SQLite's
 *     default LIKE is already case-insensitive for ASCII, and Thai has no case,
 *     so behaviour is unchanged.
 */

/**
 * A string filter valid on BOTH providers.
 *
 * Superset of the SQLite `StringFilter`: every key the SQLite client knows
 * about, plus the PostgreSQL-only `mode`. Because all properties are optional
 * and there are no excess-property checks on non-literal values, this is
 * assignable to either generated `StringFilter<...>`.
 */
export interface ProviderAgnosticStringFilter {
  equals?: string
  not?: string
  in?: string[]
  notIn?: string[]
  contains?: string
  startsWith?: string
  endsWith?: string
  /** PostgreSQL only; stripped by the SQLite interceptor in `src/lib/db.ts`. */
  mode?: 'default' | 'insensitive'
}

/** Case-insensitive exact match — e.g. `{ email: { equals: x } }`. */
export function ciEquals(value: string): ProviderAgnosticStringFilter {
  return { equals: value, mode: 'insensitive' }
}

/** Case-insensitive substring match. */
export function ciContains(value: string): ProviderAgnosticStringFilter {
  return { contains: value, mode: 'insensitive' }
}

/** Case-insensitive prefix match. */
export function ciStartsWith(value: string): ProviderAgnosticStringFilter {
  return { startsWith: value, mode: 'insensitive' }
}

/** Case-insensitive suffix match. */
export function ciEndsWith(value: string): ProviderAgnosticStringFilter {
  return { endsWith: value, mode: 'insensitive' }
}

/** Case-insensitive `IN` match. */
export function ciIn(values: string[]): ProviderAgnosticStringFilter {
  return { in: values, mode: 'insensitive' }
}

/**
 * Combine several filters with OR for one field.
 *
 * Useful when a value may appear in more than one column form, e.g. an asset
 * code searched as a whole and as a numeric suffix.
 */
export function ciAnyOf(
  ...filters: ProviderAgnosticStringFilter[]
): ProviderAgnosticStringFilter {
  return { OR: filters } as ProviderAgnosticStringFilter & { OR: ProviderAgnosticStringFilter[] }
}