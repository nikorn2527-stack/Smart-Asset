/**
 * image-url.ts — helpers for normalizing/transforming image URLs.
 *
 * Handles 3 sources of WO images:
 *   1. Direct uploads — `image_data` is a base64 data URL (`data:image/jpeg;base64,...`)
 *   2. Google Drive URLs from legacy Google Sheets import — patterns:
 *      - `https://lh5.googleusercontent.com/d/FILE_ID`
 *      - `https://drive.google.com/file/d/FILE_ID/view`
 *      - `https://drive.google.com/open?id=FILE_ID`
 *   3. Other public URLs (https://...) — used as-is.
 *
 * For Google Drive URLs, we transform to the public thumbnail endpoint:
 *   `https://drive.google.com/thumbnail?id=FILE_ID&sz=w1000`
 *
 * This endpoint serves a public preview without requiring Google auth,
 * as long as the file's sharing setting is "Anyone with the link can view".
 * If the file is private, the thumbnail returns a generic Google Drive
 * icon — better than a broken image (we show a fallback overlay).
 *
 * The thumbnail endpoint accepts a `sz` param (width in pixels). We use
 * `w1000` for the main preview, `w200` for thumbnails.
 */

const GOOGLE_DRIVE_PATTERNS = [
  // lh5.googleusercontent.com/d/FILE_ID
  /https?:\/\/lh[0-9]+\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/,
  // drive.google.com/file/d/FILE_ID/view?...
  /https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)(?:\/view)?/,
  // drive.google.com/open?id=FILE_ID
  /https?:\/\/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,
  // drive.google.com/uc?id=FILE_ID (legacy)
  /https?:\/\/drive\.google\.com\/uc\?id=([a-zA-Z0-9_-]+)/,
]

/**
 * Extract the Google Drive file ID from a URL, if it matches any Drive pattern.
 * Returns null for non-Drive URLs (including base64 data URLs).
 */
export function extractGoogleDriveFileId(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null
  // Data URLs are not Drive URLs.
  if (url.startsWith('data:')) return null
  for (const pattern of GOOGLE_DRIVE_PATTERNS) {
    const m = url.match(pattern)
    if (m && m[1]) return m[1]
  }
  return null
}

/**
 * Check whether a URL is a Google Drive URL (any pattern).
 */
export function isGoogleDriveUrl(url: string | null | undefined): boolean {
  return extractGoogleDriveFileId(url) !== null
}

/**
 * Normalize an image URL for display.
 *
 *   - For Google Drive URLs → returns the public thumbnail endpoint
 *     (`https://drive.google.com/thumbnail?id=FILE_ID&sz=w1000`).
 *   - For other URLs (https, data:, etc.) → returns the URL as-is.
 *
 * @param url - the raw image URL or data URL from the database
 * @param size - thumbnail width (default 1000px). Use `200` for small previews.
 */
export function normalizeImageUrl(
  url: string | null | undefined,
  size: number = 1000,
): string | null {
  if (!url) return null
  const fileId = extractGoogleDriveFileId(url)
  if (fileId) {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`
  }
  return url
}

/**
 * Same as `normalizeImageUrl` but for thumbnails (smaller preview).
 */
export function normalizeImageUrlThumb(
  url: string | null | undefined,
): string | null {
  return normalizeImageUrl(url, 200)
}

/**
 * Get the original (full-resolution) Google Drive URL for "open in new tab".
 * Returns the `uc?export=download` endpoint which redirects to the actual file.
 * For non-Drive URLs, returns the URL as-is.
 */
export function getOriginalImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const fileId = extractGoogleDriveFileId(url)
  if (fileId) {
    return `https://drive.google.com/uc?export=view&id=${fileId}`
  }
  return url
}
