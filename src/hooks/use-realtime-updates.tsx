'use client'

/**
 * useRealtimeUpdates — Hybrid realtime hook.
 *
 * Primary: Supabase Realtime (latency < 100ms, no polling).
 * Fallback: Polling every 60s (if Supabase not configured or disconnected).
 *
 * Why hybrid:
 *   - Supabase Free: 200 concurrent connections (enough for 10-20 users)
 *   - If realtime disabled (env not set) → falls back to polling
 *   - If connection drops → polling kicks in automatically
 *
 * Returns:
 *   • status: 'realtime' | 'polling' | 'closed'
 *   • lastEvent: the most recent RealtimeEvent | null
 *   • lastEventAt: epoch ms
 */

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth-store'
import {
  isRealtimeEnabled,
  subscribeToTables,
} from '@/lib/supabase-realtime-client'

export type RealtimeStatus = 'realtime' | 'polling' | 'closed'

export interface RealtimeEventPayload {
  type:
    | 'device-added'
    | 'device-updated'
    | 'device-deleted'
    | 'meter-reading'
    | 'work-order'
    | 'stock'
    | 'cycle'
    | 'audit'
  entity?: string
  id?: string
  ts?: number
}

interface RealtimeState {
  status: RealtimeStatus
  lastEvent: RealtimeEventPayload | null
  lastEventAt: number
}

const POLL_INTERVAL = 60_000 // 60 seconds (fallback only)
const POLL_FALLBACK_DELAY = 5_000 // wait 5s before falling back to polling

// Map DB table names → realtime event types + query keys to invalidate
const TABLE_CONFIG: Record<string, {
  events: RealtimeEventPayload['type'][]
  invalidate: string[][]
}> = {
  Device: {
    events: ['device-added', 'device-updated', 'device-deleted'],
    invalidate: [['devices'], ['dashboard']],
  },
  MeterReading: {
    events: ['meter-reading'],
    invalidate: [['meter'], ['devices'], ['dashboard']],
  },
  WorkOrder: {
    events: ['work-order'],
    invalidate: [['work-orders'], ['dashboard']],
  },
  StockItem: {
    events: ['stock'],
    invalidate: [['stock-items'], ['dashboard']],
  },
  StockTransaction: {
    events: ['stock'],
    invalidate: [['stock-items'], ['stock-transactions']],
  },
  Cycle: {
    events: ['cycle'],
    invalidate: [['active-cycle'], ['cycles']],
  },
  AuditLog: {
    events: ['audit'],
    invalidate: [['audit'], ['notifications']],
  },
}

export function useRealtimeUpdates() {
  const qc = useQueryClient()
  const token = useAuthStore((s) => s.token)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [state, setState] = React.useState<RealtimeState>({
    status: 'closed',
    lastEvent: null,
    lastEventAt: 0,
  })

  React.useEffect(() => {
    if (!isAuthenticated || !token) {
      setState((s) => ({ ...s, status: 'closed' }))
      return
    }

    let closed = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let realtimeUnsub: (() => void) | null = null
    let lastTs = Date.now()

    function handleTableChange(
      table: string,
      payload: {
        eventType: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
        new: Record<string, unknown>
        old: Record<string, unknown>
      },
    ) {
      const config = TABLE_CONFIG[table]
      if (!config) return

      // Build event payload
      const eventType = config.events[0] // primary event for this table
      const id = String(payload.new?.id ?? payload.old?.id ?? '')
      const event: RealtimeEventPayload = {
        type: eventType,
        entity: table,
        id,
        ts: Date.now(),
      }

      setState((s) => ({
        ...s,
        status: 'realtime',
        lastEvent: event,
        lastEventAt: Date.now(),
      }))

      // Invalidate relevant query caches
      for (const queryKey of config.invalidate) {
        qc.invalidateQueries({ queryKey })
      }
    }

    async function poll() {
      if (closed || !token) return

      try {
        const res = await fetch(
          `/api/itam/updates?since=${lastTs}`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        if (!res.ok) return
        const data = await res.json()
        const events: RealtimeEventPayload[] = data.events ?? []

        if (events.length > 0) {
          const latest = events[events.length - 1]
          lastTs = latest.ts ?? Date.now()
          setState((s) => ({
            ...s,
            status: 'polling',
            lastEvent: latest,
            lastEventAt: Date.now(),
          }))

          // Invalidate caches based on event types
          const types = new Set(events.map((e) => e.type))
          if (types.has('device-added') || types.has('device-updated') || types.has('device-deleted')) {
            qc.invalidateQueries({ queryKey: ['devices'] })
            qc.invalidateQueries({ queryKey: ['dashboard'] })
          }
          if (types.has('meter-reading')) {
            qc.invalidateQueries({ queryKey: ['meter'] })
            qc.invalidateQueries({ queryKey: ['devices'] })
          }
          if (types.has('work-order')) {
            qc.invalidateQueries({ queryKey: ['work-orders'] })
          }
          if (types.has('stock')) {
            qc.invalidateQueries({ queryKey: ['stock-items'] })
          }
          if (types.has('cycle')) {
            qc.invalidateQueries({ queryKey: ['active-cycle'] })
          }
          if (types.has('audit')) {
            qc.invalidateQueries({ queryKey: ['audit'] })
            qc.invalidateQueries({ queryKey: ['notifications'] })
          }
        }
      } catch {
        // Network error — try again next cycle
      }

      if (!closed) {
        pollTimer = setTimeout(poll, POLL_INTERVAL)
      }
    }

    function startPolling() {
      if (closed) return
      setState((s) => ({ ...s, status: 'polling' }))
      poll()
    }

    // ── Primary: Try Supabase Realtime ──
    if (isRealtimeEnabled()) {
      const tables = Object.keys(TABLE_CONFIG)
      realtimeUnsub = subscribeToTables(tables, handleTableChange)

      // Fallback: also poll every 60s in case realtime misses something
      // (Supabase Free can drop connections under load)
      pollTimer = setTimeout(poll, POLL_INTERVAL)

      // If realtime doesn't connect within 5s, mark status as polling
      setTimeout(() => {
        if (!closed) {
          setState((s) => ({
            ...s,
            status: s.status === 'realtime' ? 'realtime' : 'polling',
          }))
        }
      }, POLL_FALLBACK_DELAY)
    } else {
      // ── Fallback: Polling only (Supabase not configured) ──
      startPolling()
    }

    return () => {
      closed = true
      if (pollTimer) clearTimeout(pollTimer)
      if (realtimeUnsub) realtimeUnsub()
      setState((s) => ({ ...s, status: 'closed' }))
    }
  }, [isAuthenticated, token, qc])

  return state
}

/**
 * Singleton hook — keeps ONE realtime/polling loop alive for the whole app
 * (mounted once in `RealtimeProvider` at the AppShell level).
 *
 * Other components (e.g. the Sidebar status indicator) can read the
 * status without each opening their own connection.
 *
 * Implementation: a tiny external store backed by module-level state
 * updated by the single `useRealtimeUpdates()` instance inside
 * `RealtimeProvider`.
 */
const statusListeners = new Set<() => void>()
let statusSnapshot: RealtimeStatus = 'closed'

export function useRealtimeStatus(): RealtimeStatus {
  return React.useSyncExternalStore(
    (cb) => {
      statusListeners.add(cb)
      return () => statusListeners.delete(cb)
    },
    () => statusSnapshot,
    () => 'closed' as RealtimeStatus,
  )
}

/**
 * Mount once at the app shell (wrap the authenticated app).
 *
 * Wires the single `useRealtimeUpdates()` loop into the
 * module-level external store so every `useRealtimeStatus()` subscriber
 * sees the same status without each running its own fetcher.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { status } = useRealtimeUpdates()
  React.useEffect(() => {
    if (status !== statusSnapshot) {
      statusSnapshot = status
      for (const cb of statusListeners) cb()
    }
  }, [status])
  return <>{children}</>
}
