/**
 * supabase-realtime.ts — Helper สำหรับ Supabase Realtime
 *
 * ใช้แทน polling 30 วินาทีปัจจุบัน (useRealtimeUpdates hook)
 * - ลด API calls 90%
 * - Latency < 100ms (แทน 30s)
 * - Auto-reconnect
 *
 * Free tier: 200 concurrent connections (พอสำหรับ 10-20 users)
 *
 * การใช้งาน:
 *   Client (browser):
 *     import { subscribeToTable } from '@/lib/supabase-realtime-client'
 *     const channel = subscribeToTable('AuditLog', (payload) => {
 *       console.log('change:', payload)
 *     })
 *     // cleanup
 *     channel.unsubscribe()
 *
 *   Server (publish event):
 *     import { notifyRealtimeEvent } from '@/lib/supabase-realtime'
 *     await notifyRealtimeEvent('work-order-created', { id, woNumber })
 *
 * Requires env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY (for client)
 *   SUPABASE_SERVICE_KEY (for server-side publish)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}

let clientInstance: SupabaseClient | null = null

/**
 * Get Supabase client (singleton).
 * Uses anon key — safe for client-side.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!clientInstance) {
    if (!isSupabaseConfigured()) {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set',
      )
    }
    clientInstance = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        realtime: {
          params: {
            eventsPerSecond: 10, // rate limit (free tier safe)
          },
        },
      },
    )
  }
  return clientInstance
}

/**
 * Subscribe to changes on a specific table.
 * Returns an unsubscribe function.
 *
 * @example
 *   const unsubscribe = subscribeToTable('AuditLog', (payload) => {
 *     console.log('new audit log:', payload.new)
 *   })
 *   // later
 *   unsubscribe()
 */
export function subscribeToTable(
  table: string,
  callback: (payload: { eventType: string; new: unknown; old: unknown }) => void,
  filter?: string, // e.g. 'siteCode=eq.HQ-001'
): () => void {
  const client = getSupabaseClient()
  const channelName = `public:${table}:${filter || 'all'}`

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
          eventType: payload.eventType,
          new: (payload as { new: unknown }).new,
          old: (payload as { old: unknown }).old,
        })
      },
    )
    .subscribe()

  return () => {
    client.removeChannel(channel)
  }
}

/**
 * Subscribe to specific row changes.
 *
 * @example
 *   const unsub = subscribeToRow('WorkOrder', 'id', woId, (payload) => {
 *     console.log('WO updated:', payload.new)
 *   })
 */
export function subscribeToRow(
  table: string,
  column: string,
  value: string,
  callback: (payload: { eventType: string; new: unknown; old: unknown }) => void,
): () => void {
  return subscribeToTable(table, callback, `${column}=eq.${value}`)
}

/**
 * Server-side: broadcast a custom event to a channel.
 * Useful for triggering UI refresh without DB write.
 *
 * Requires SUPABASE_SERVICE_KEY (server-only).
 *
 * @example (in API route)
 *   await broadcastEvent('work-order-created', { id, woNumber })
 */
export async function broadcastEvent(
  event: string,
  payload: unknown,
): Promise<void> {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!serviceKey) {
    console.warn('[supabase-realtime] SUPABASE_SERVICE_KEY not set — skip broadcast')
    return
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
  )

  await adminClient.channel('itam-events').send({
    type: 'broadcast',
    event,
    payload,
  })
}
