'use client'

/**
 * use-line-session.ts — Client hook to read the public LINE session.
 *
 * The `line_session` cookie set by `/api/auth/line/callback` is HTTP-only,
 * so client-side JS can't read it directly. This hook fetches
 * `/api/auth/line/me` on mount (and on demand via `refresh()`) and returns
 * the current LINE session — used by public QR repair components to:
 *   • Decide which tier (1 / 2 / 3) to render.
 *   • Pre-fill name + avatar on the repair form.
 *   • Attach lineUserId + lineScopePhone to POST /api/public/repairs.
 *
 * Usage:
 *   const { session, loading, error, refresh } = useLineSession()
 *   if (loading) return <Spinner />
 *   if (!session) return <PublicDeviceCard tier="anonymous" />
 *   return <PublicDeviceCard tier="line" session={session} />
 */

import * as React from 'react'

// ── Types ────────────────────────────────────────────────────────────────

export interface LineSession {
  userId: string
  displayName: string
  pictureUrl?: string | null
  scopePhone?: string | null
  expiresAt?: string | null
}

interface UseLineSessionResult {
  /** The current LINE session, or null if not logged in. */
  session: LineSession | null
  /** True on first fetch (initial mount). False afterwards. */
  loading: boolean
  /** Set if /api/auth/line/me returned a non-401 error (network, 5xx). */
  error: string | null
  /** Re-fetch the session (e.g. after a LINE Login redirect returns). */
  refresh: () => Promise<void>
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function useLineSession(): UseLineSessionResult {
  const [session, setSession] = React.useState<LineSession | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const fetchSession = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/line/me', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })
      if (res.status === 401) {
        setSession(null)
        return
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setSession(null)
        setError(j.error ?? `HTTP ${res.status}`)
        return
      }
      const json = (await res.json()) as { data?: LineSession }
      setSession(json.data ?? null)
    } catch (e) {
      // Network error / JSON parse error — surface to UI.
      setSession(null)
      setError(e instanceof Error ? e.message : 'Failed to load LINE session')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchSession()
  }, [fetchSession])

  return { session, loading, error, refresh: fetchSession }
}
