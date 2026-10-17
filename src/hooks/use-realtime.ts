'use client'

/**
 * use-realtime.ts — Hook for connecting to the SSE realtime endpoint.
 *
 * Connects to /api/realtime/sse (Server-Sent Events via Next.js API route).
 * Falls back gracefully if connection fails: returns null kpi and isConnected=false,
 * app still works via existing polling.
 *
 * QA-ROUND-2026-09-16-F: the SSE route is now authenticated + demo/site-scoped.
 * EventSource cannot send an Authorization header, so the JWT is passed via
 * the `?t=` URL query param (supported by requireAuth()'s extractBearer).
 * The connection only opens while authenticated; on logout the stream is
 * closed by the effect cleanup. When the server refuses auth (401 → the
 * browser sets readyState CLOSED and fires error once, with NO auto-reconnect),
 * we must not schedule our own retry loop.
 */
import { useEffect, useState, useRef, useCallback } from 'react'
import { useAuthStore } from '@/store/auth-store'

export interface RealtimeKpi {
  devices: number
  workOrders: number
  pendingWO: number
  lowStock: number
  warrantyExpiring: number
  recentActivities: Array<{
    action: string
    entity: string
    summary: string
    actor: string
    createdAt: number
  }>
}

export interface RealtimeEvent {
  count: number
  delta: number
}

export interface RealtimeState {
  kpi: RealtimeKpi | null
  lastUpdate: number | null
  isConnected: boolean
  lastDeviceCreated: RealtimeEvent | null
  lastWorkOrderCreated: RealtimeEvent | null
  lastMeterRecorded: RealtimeEvent | null
}

export function useRealtime(): RealtimeState {
  const [kpi, setKpi] = useState<RealtimeKpi | null>(null)
  const [lastUpdate, setLastUpdate] = useState<number | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [lastDeviceCreated, setLastDeviceCreated] = useState<RealtimeEvent | null>(null)
  const [lastWorkOrderCreated, setLastWorkOrderCreated] = useState<RealtimeEvent | null>(null)
  const [lastMeterRecorded, setLastMeterRecorded] = useState<RealtimeEvent | null>(null)
  const prevCountsRef = useRef<{ devices: number; workOrders: number; meterReadings: number }>({ devices: 0, workOrders: 0, meterReadings: 0 })
  const esRef = useRef<EventSource | null>(null)

  const token = useAuthStore((s) => s.token)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  const handleKpi = useCallback((data: RealtimeKpi) => {
    setKpi(data)
    setLastUpdate(Date.now())

    // Detect changes by comparing with previous counts
    const prev = prevCountsRef.current
    if (data.devices > prev.devices) {
      setLastDeviceCreated({ count: data.devices, delta: data.devices - prev.devices })
    }
    if (data.workOrders > prev.workOrders) {
      setLastWorkOrderCreated({ count: data.workOrders, delta: data.workOrders - prev.workOrders })
    }
    // meterReadings not in KPI, but we can infer from recentActivities
    prevCountsRef.current = { devices: data.devices, workOrders: data.workOrders, meterReadings: prev.meterReadings }
  }, [])

  useEffect(() => {
    // Only open the (authenticated) stream while logged in. When logged out
    // or still booting, previous state is cleared below and no connection is made.
    if (!isAuthenticated || !token) {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      setIsConnected(false)
      return
    }

    let retryTimer: ReturnType<typeof setTimeout> | null = null

    // Capture the narrowed token: it is a mutable binding from the store, so the
    // `!token` guard above does not narrow inside the nested connect() closure.
    const streamToken = token

    function connect() {
      try {
        const es = new EventSource(`/api/realtime/sse?t=${encodeURIComponent(streamToken)}`)
        esRef.current = es

        es.onopen = () => {
          setIsConnected(true)
          console.log('[realtime] SSE connected')
        }

        es.addEventListener('kpi', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data) as RealtimeKpi
            handleKpi(data)
          } catch (err) {
            console.warn('[realtime] parse error:', err)
          }
        })

        es.onerror = () => {
          setIsConnected(false)
          // readyState CLOSED means the SERVER refused the connection
          // (e.g. 401 after logout elsewhere / expired token) and the
          // browser will NOT auto-reconnect — don't start our own retry
          // loop either, it would hammer the server with 401s forever.
          // CONNECTING = transient network error, browser retries itself;
          // our 5s backstop below only covers the init-exception path.
          if (es.readyState === EventSource.CLOSED) {
            console.warn('[realtime] SSE closed by server — not retrying (auth required)')
            return
          }
          console.warn('[realtime] SSE error — will retry in 5s')
          es.close()
          // Auto-retry after 5 seconds
          retryTimer = setTimeout(connect, 5000)
        }
      } catch (err) {
        console.warn('[realtime] EventSource init failed:', err)
        setIsConnected(false)
        retryTimer = setTimeout(connect, 5000)
      }
    }

    connect()

    return () => {
      if (retryTimer) clearTimeout(retryTimer)
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
    }
  }, [handleKpi, isAuthenticated, token])

  return { kpi, lastUpdate, isConnected, lastDeviceCreated, lastWorkOrderCreated, lastMeterRecorded }
}
