/**
 * SSE endpoint — `/api/itam/events?token=<jwt>
 *
 * Why a query-string token? EventSource (the browser API) cannot set custom
 * headers, so we can't send `Authorization: Bearer ...`. The token is passed
 * via ?token= instead, validated once at connection time. The same JWT used
 * for every other API call is reused.
 *
 * Protocol:
 *   • 200 OK with `Content-Type: text/event-stream`
 *   • `event: hello\ndata: { user }\n\n` immediately on connect
 *   • `:heartbeat\n\n` every 25s (proxy-friendly keep-alive)
 *   • `event: <type>\nid: <n>\ndata: {json}\n\n` for every published event
 *   • Connection closed by client → controller closed → unsubscribe()
 *
 * Why SSE not WebSocket? SSE is unidirectional (server→client), fits the
 * "data changed → refetch" pattern, plays nicely through Caddy/nginx, and
 * auto-reconnects with Last-Event-ID resumption.
 */

import { NextRequest } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { subscribe, type RealtimeEvent } from '@/lib/realtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HEARTBEAT_MS = 25_000

export async function GET(req: NextRequest) {
  // ── Auth: token must come from ?token= (EventSource can't send headers)
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  if (!token) {
    return new Response('Missing token', { status: 401 })
  }
  const payload = await verifyToken(token)
  if (!payload) {
    return new Response('Invalid or expired token', { status: 401 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      function send(payload: string) {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(payload))
        } catch {
          closed = true
        }
      }

      // 1) Hello event — confirms the connection is wired up.
      send(
        `event: hello\n` +
          `data: ${JSON.stringify({
            email: payload.email,
            role: payload.role,
            allowedSites: payload.allowedSites,
            ts: Date.now(),
          })}\n\n`,
      )

      // 2) Subscribe to realtime events — forward each as an SSE message.
      const unsubscribe = subscribe(payload, (event: RealtimeEvent) => {
        send(
          `event: ${event.type}\n` +
            `id: ${event.ts}\n` +
            `data: ${JSON.stringify(event)}\n\n`,
        )
      })

      // 3) Heartbeat every 25s — proxies may close idle connections at 30-60s.
      const heartbeat = setInterval(() => {
        send(`:heartbeat ${Date.now()}\n\n`)
      }, HEARTBEAT_MS)

      // 4) Clean up on close.
      const cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        unsubscribe()
        try {
          controller.close()
        } catch (err) { console.error('[route]', err) }
      }
      req.signal.addEventListener('abort', cleanup)
      // Safety: force-close after 10 minutes (clients reconnect automatically).
      setTimeout(cleanup, 10 * 60 * 1000)
    },
    cancel() {
      // Stream consumer (browser) cancelled — nothing extra to do; start()
      // already wired up the abort listener.
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable proxy buffering (Caddy, nginx, Cloudflare) so events flush
      // immediately instead of being batched.
      'X-Accel-Buffering': 'no',
      'CF-Buffering': 'no',
    },
  })
}
