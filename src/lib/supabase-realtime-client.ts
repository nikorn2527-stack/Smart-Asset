/**
 * supabase-realtime-client.ts — Client-side Supabase Realtime wrapper.
 *
 * Safe to import in client components ('use client').
 * Falls back gracefully if Supabase is not configured (dev mode without env).
 *
 * Usage:
 *   'use client'
 *   import { subscribeToTable, subscribeToEvent, isRealtimeEnabled } from '@/lib/supabase-realtime-client'
 *
 *   useEffect(() => {
 *     if (!isRealtimeEnabled()) return // graceful fallback to polling
 *     const unsub = subscribeToTable('WorkOrder', (payload) => {
 *       if (payload.eventType === 'INSERT') {
 *         queryClient.invalidateQueries({ queryKey: ['work-orders'] })
 *       }
 *     })
 *     return unsub
 *   }, [])
 */

import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js'
import { isSupabaseConfigured } from './supabase-realtime'

export { isSupabaseConfigured as isRealtimeEnabled }

let clientInstance: SupabaseClient | null = null

/**
 * Get Supabase client (singleton, client-side).
 * Uses anon key — safe for browser.
 */
function getClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null
  if (!clientInstance) {
    clientInstance = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        realtime: {
          params: {
            eventsPerSecond: 10, // rate limit (free tier safe — 200 concurrent)
          },
        },
      },
    )
  }
  return clientInstance
}

/**
 * Subscribe to Postgres changes on a table.
 * Returns unsubscribe function (or null if realtime disabled).
 *
 * @example
 *   const unsub = subscribeToTable('WorkOrder', (payload) => {
 *     console.log('change:', payload.eventType, payload.new)
 *   }, 'siteCode=eq.HQ')
 *   // later
 *   unsub?.()
 */
export function subscribeToTable(
  table: string,
  callback: (payload: {
    eventType: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
    new: Record<string, unknown>
    old: Record<string, unknown>
  }) => void,
  filter?: string,
): (() => void) | null {
  const client = getClient()
  if (!client) return null

  const channelName = `table:${table}:${filter || 'all'}`

  const channel = client
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        ...(filter ? { filter } : {}),
      },
      (payload) => {
        callback({
          eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE' | '*',
          new: (payload as { new: Record<string, unknown> }).new ?? {},
          old: (payload as { old: Record<string, unknown> }).old ?? {},
        })
      },
    )
    .subscribe()

  return () => {
    client.removeChannel(channel)
  }
}

/**
 * Subscribe to a broadcast event (custom realtime channel).
 * Returns unsubscribe function (or null if realtime disabled).
 *
 * @example
 *   const unsub = subscribeToEvent('work-order-created', (data) => {
 *     toast.success(`WO ${data.woNumber} สร้างใหม่`)
 *   })
 */
export function subscribeToEvent(
  event: string,
  callback: (payload: unknown) => void,
): (() => void) | null {
  const client = getClient()
  if (!client) return null

  const channel = client.channel('itam-events')

  channel
    .on('broadcast', { event }, (msg) => {
      // The broadcast envelope is an open record; route it through `unknown`
    // because the supabase-js channel type has no declared overlap with our
    // `{ payload }` shape.
    callback((msg as unknown as { payload: unknown }).payload)
    })
    .subscribe()

  return () => {
    client.removeChannel(channel)
  }
}

/**
 * Subscribe to multiple tables at once.
 * Returns unsubscribe function (or null if realtime disabled).
 *
 * @example
 *   const unsub = subscribeToTables(
 *     ['WorkOrder', 'Device', 'MeterReading'],
 *     (table, payload) => {
 *       queryClient.invalidateQueries({ queryKey: [table.toLowerCase()] })
 *     }
 *   )
 */
export function subscribeToTables(
  tables: string[],
  callback: (table: string, payload: {
    eventType: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
    new: Record<string, unknown>
    old: Record<string, unknown>
  }) => void,
): (() => void) | null {
  const client = getClient()
  if (!client) return null

  const channels: RealtimeChannel[] = []

  for (const table of tables) {
    const channel = client
      .channel(`table:${table}:multi`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          callback(table, {
            eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE' | '*',
            new: (payload as { new: Record<string, unknown> }).new ?? {},
            old: (payload as { old: Record<string, unknown> }).old ?? {},
          })
        },
      )
      .subscribe()
    channels.push(channel)
  }

  return () => {
    for (const ch of channels) {
      client.removeChannel(ch)
    }
  }
}
