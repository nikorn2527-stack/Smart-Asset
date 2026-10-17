/**
 * http-headers.ts — build `fetch()` request headers with the caller's JWT.
 *
 * WHY THIS EXISTS
 * ---------------
 * This pattern appears ~30 times across the ITAM components:
 *
 *   headers: token ? { Authorization: `Bearer ${token}` } : {}
 *
 * It type-errors under the DOM `fetch` typings:
 *
 *   TS2769: No overload matches this call.
 *     Type '{ Authorization: string; } | { Authorization?: undefined; }'
 *     is not assignable to type 'HeadersInit | undefined'.
 *
 * The ternary widens to a union whose false branch is `{ Authorization?: undefined }`.
 * Because `HeadersInit` includes `Record<string, string>`, that optional-`undefined`
 * property is not assignable — and unlike the `{ ...(cond ? {x} : {}) }` spread
 * form, an object literal in the false branch position keeps the bad type.
 *
 * This helper returns a single concrete `Record<string, string>`, which is
 * assignable to `HeadersInit` on every overload.
 *
 * USAGE
 * -----
 *   // before — TS2769
 *   fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
 *
 *   // after
 *   fetch(url, { headers: bearerHeaders(token) })
 *
 *   fetch(url, {
 *     method: 'POST',
 *     headers: bearerHeaders(token, { 'Content-Type': 'application/json' }),
 *     body: JSON.stringify(payload),
 *   })
 */
export function bearerHeaders(
  token: string | null | undefined,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}