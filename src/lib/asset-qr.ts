/**
 * Asset QR/Barcode parsing utilities.
 *
 * Shared between:
 *   • QrScannerDialog (camera + manual entry)
 *   • Replace-on-Withdraw flow (scan replacement device)
 *   • Work Orders field replacement
 *   • Anywhere a raw QR/barcode string needs to be normalised into an
 *     asset code or device identifier.
 *
 * Supported formats (in priority order):
 *   1) URL with ?asset= / ?assetNo= / ?id= → extract query param
 *   2) "ITAM:XXX" or "ITAM-XXX" prefix → strip prefix
 *   3) URL path segment /itam/devices/XXX or /devices/XXX → extract path
 *   4) Plain alphanumeric code (1-30 chars, digits/letters/dash/underscore)
 *   5) Fallback: return the whole trimmed string
 */

export type ParsedAssetCode = {
  /** The normalised asset code (or null if input was empty). */
  code: string | null
  /** Which pattern matched — useful for debugging / logging. */
  source: 'url-query' | 'itam-prefix' | 'url-path' | 'plain' | 'fallback' | 'empty'
}

/**
 * Extract an asset number from arbitrary QR/barcode text.
 *
 * Examples:
 *   "https://itam.example.com/?asset=2378"      → "2378"  (url-query)
 *   "ITAM:2378"                                   → "2378"  (itam-prefix)
 *   "ITAM-2378"                                   → "2378"  (itam-prefix)
 *   "https://itam.example.com/devices/2378"       → "2378"  (url-path)
 *   "2378"                                        → "2378"  (plain)
 *   "E81695B6N896795"                             → "E81695B6N896795" (plain)
 *   ""                                            → null    (empty)
 */
export function parseAssetNo(raw: string): string | null {
  return parseAssetNoDetailed(raw).code
}

/**
 * Detailed version of parseAssetNo that also reports which pattern matched.
 * Useful for telemetry / debugging when scans don't behave as expected.
 */
export function parseAssetNoDetailed(raw: string): ParsedAssetCode {
  const s = (raw ?? '').trim()
  if (!s) return { code: null, source: 'empty' }

  // 1) URL with ?asset= or ?assetNo= or ?id=
  const urlMatch = s.match(/[?&](?:asset|assetNo|id)=([^&]+)/i)
  if (urlMatch) {
    return { code: decodeURIComponent(urlMatch[1]), source: 'url-query' }
  }

  // 2) "ITAM:XXX" or "ITAM-XXX" prefix
  const prefixMatch = s.match(/^ITAM[:\-]\s*(.+)$/i)
  if (prefixMatch) {
    return { code: prefixMatch[1].trim(), source: 'itam-prefix' }
  }

  // 3) URL path segment /itam/devices/XXX
  const pathMatch = s.match(/\/(?:devices|asset|itam)\b[^/]*\/([^/?#]+)/i)
  if (pathMatch) {
    return { code: decodeURIComponent(pathMatch[1]), source: 'url-path' }
  }

  // 4) Plain alphanumeric code — accept if it looks like an asset number
  //    (digits + letters + dash + underscore, 1-30 chars, no spaces).
  if (/^[A-Za-z0-9\-_]{1,30}$/.test(s)) {
    return { code: s, source: 'plain' }
  }

  // 5) Fallback — return the whole string trimmed, caller can search
  return { code: s, source: 'fallback' }
}

/**
 * Quick sanity check — does this string look like a valid asset code
 * that could exist in the database? Used to enable/disable the "Apply"
 * button in replacement dialogs before a DB lookup confirms existence.
 */
export function looksLikeAssetCode(s: string): boolean {
  if (!s) return false
  const trimmed = s.trim()
  if (trimmed.length < 1 || trimmed.length > 30) return false
  // Allow digits, letters, dash, underscore. Disallow spaces / special chars.
  return /^[A-Za-z0-9\-_]+$/.test(trimmed)
}
