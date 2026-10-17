'use client'

/**
 * Global Error Boundary — catches catastrophic errors that the route-level
 * error.tsx cannot catch (e.g. root layout failure, chunk load failure).
 *
 * Key feature: AUTO-RECOVERY from Turbopack stale cache.
 *
 * Symptom: After a Turbopack dev server restart (e.g. schema migration,
 * dependency update, .next cache clear), the browser still holds references
 * to old chunk URLs that no longer exist on the server. The browser throws:
 *   "Module was instantiated because it was required from ... but the
 *    module factory is not available. This is often caused by a stale
 *    browser cache, misconfigured Cache-Control headers, or a service
 *    worker serving outdated responses."
 *   (or: "Failed to fetch dynamically imported module", or "ChunkLoadError")
 *
 * Without this boundary, Next.js shows its default "This page couldn't load.
 * Reload to try again, or go back." screen — which the user must manually
 * reload. With this boundary, we AUTO-DETECT this class of error and reload
 * the page ONCE (with a cache-busting query param to force the browser to
 * re-fetch chunks). If the error persists after one auto-reload, we show
 * a clear Thai message with a manual reload button.
 */

import * as React from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

const AUTO_RELOAD_KEY = 'itam.auto-reloaded-at'
const AUTO_RELOAD_TTL_MS = 60_000 // 1 minute — if we reloaded < 1 min ago, don't auto-reload again

function isStaleCacheError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  // Turbopack "module factory is not available"
  if (/module factory is not available/i.test(msg)) return true
  // ChunkLoadError / dynamic import failure
  if (/ChunkLoadError/i.test(msg)) return true
  if (/Failed to fetch dynamically imported module/i.test(msg)) return true
  if (/Loading chunk \d+ failed/i.test(msg)) return true
  if (/Loading CSS chunk \d+ failed/i.test(msg)) return true
  // Generic "Importing a module script failed"
  if (/Importing a module script failed/i.test(msg)) return true
  return false
}

function shouldAutoReload(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const last = parseInt(window.sessionStorage.getItem(AUTO_RELOAD_KEY) ?? '0', 10)
    if (!last) return true // never reloaded
    const elapsed = Date.now() - last
    if (elapsed > AUTO_RELOAD_TTL_MS) return true // last reload was > 1 min ago — safe to retry
    return false // recently reloaded — don't loop
  } catch {
    return false
  }
}

function markAutoReload(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()))
  } catch {
    // ignore
  }
}

function clearAutoReloadMark(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(AUTO_RELOAD_KEY)
  } catch {
    // ignore
  }
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    // Log to console for debugging
    console.error('[GlobalError]', error)

    // If this is a stale-cache / chunk-load error, try ONE auto-reload
    // (with cache-busting) before showing the manual recovery UI.
    if (isStaleCacheError(error) && shouldAutoReload()) {
      markAutoReload()
      // Append a cache-busting query param so the browser re-fetches chunks
      // instead of serving them from HTTP cache.
      const url = new URL(window.location.href)
      url.searchParams.set('_r', String(Date.now()))
      window.location.replace(url.toString())
      return
    }

    // If we just recovered from a stale-cache error (auto-reload worked),
    // clear the mark so future errors can auto-reload again.
    clearAutoReloadMark()
  }, [error])

  const isChunkError = isStaleCacheError(error)

  return (
    <html lang="th">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
          color: '#e2e8f0',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          padding: '1.5rem',
        }}
      >
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <AlertTriangle
            size={56}
            strokeWidth={1.5}
            style={{ color: '#f97316', margin: '0 auto 1rem' }}
            aria-hidden
          />
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 600,
              margin: '0 0 0.5rem',
              color: '#f8fafc',
            }}
          >
            {isChunkError
              ? 'ระบบอัปเดตเวอร์ชันใหม่ — กรุณารีเฟรช'
              : 'เกิดข้อผิดพลาดในการโหลดหน้า'}
          </h1>
          <p
            style={{
              fontSize: '0.95rem',
              lineHeight: 1.6,
              color: '#94a3b8',
              margin: '0 0 1.5rem',
            }}
          >
            {isChunkError
              ? 'เบราว์เซอร์ยังใช้ไฟล์เก่าจากแคช กดปุ่มด้านล่างเพื่อโหลดเวอร์ชันล่าสุด'
              : 'เกิดปัญหาที่ไม่คาดคิด ลองโหลดหน้าใหม่อีกครั้ง หรือกลับหน้าหลัก'}
          </p>

          {process.env.NODE_ENV === 'development' && (
            <details
              style={{
                textAlign: 'left',
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: 8,
                padding: '0.75rem 1rem',
                margin: '0 0 1.5rem',
                fontSize: '0.8rem',
                color: '#cbd5e1',
              }}
            >
              <summary style={{ cursor: 'pointer', color: '#94a3b8' }}>
                รายละเอียดข้อผิดพลาด (dev only)
              </summary>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  margin: '0.5rem 0 0',
                  fontFamily: 'ui-monospace, monospace',
                }}
              >
                {error.message}
                {error.digest ? `\n\nDigest: ${error.digest}` : ''}
                {error.stack ? `\n\n${error.stack}` : ''}
              </pre>
            </details>
          )}

          <div
            style={{
              display: 'flex',
              gap: '0.75rem',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={() => {
                // Force a hard reload that bypasses cache
                if (typeof window !== 'undefined') {
                  const url = new URL(window.location.href)
                  url.searchParams.set('_r', String(Date.now()))
                  window.location.replace(url.toString())
                }
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: '#f97316',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '0.625rem 1.25rem',
                fontSize: '0.95rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={16} aria-hidden />
              โหลดหน้าใหม่
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                  window.location.href = '/'
                }
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: 'transparent',
                color: '#e2e8f0',
                border: '1px solid #334155',
                borderRadius: 8,
                padding: '0.625rem 1.25rem',
                fontSize: '0.95rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <Home size={16} aria-hidden />
              กลับหน้าหลัก
            </button>
          </div>

          {isChunkError && (
            <p
              style={{
                marginTop: '1.5rem',
                fontSize: '0.8rem',
                color: '#64748b',
              }}
            >
              💡 ถ้ากดแล้วยังเป็นอยู่ ให้กด{' '}
              <kbd
                style={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 4,
                  padding: '0.1rem 0.4rem',
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '0.75rem',
                }}
              >
                Ctrl + Shift + R
              </kbd>{' '}
              (Windows/Linux) หรือ{' '}
              <kbd
                style={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 4,
                  padding: '0.1rem 0.4rem',
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '0.75rem',
                }}
              >
                Cmd + Shift + R
              </kbd>{' '}
              (Mac) เพื่อล้างแคชแบบถาวร
            </p>
          )}
        </div>
      </body>
    </html>
  )
}
