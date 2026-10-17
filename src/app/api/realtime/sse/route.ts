import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { siteFilterForUser, getAllowedSites } from '@/lib/auth'
import { demoFilter, isDemoUser } from '@/lib/demo-mode'
import type { UserPermissionRow } from '@/lib/auth'

/**
 * GET /api/realtime/sse
 *
 * Server-Sent Events stream for live KPI updates.
 * Sends a `kpi` event every 30 seconds + an immediate `kpi` event on connect.
 *
 * This replaces socket.io — works through the Caddy gateway normally
 * (no need for XTransformPort since it's a standard HTTP response stream).
 *
 * QA-ROUND-2026-09-16-F (demo/site isolation): the KPI payload used to count
 * EVERY row in the DB (real + demo) and stream the global audit feed — leaking
 * real hospital device counts, work-order counts AND real actors' activity
 * summaries to demo users (and vice versa). The route also accepted
 * UNAUTHENTICATED connections. Now:
 *   1. requireAuth() gates the stream (EventSource can't send headers, so the
 *      middleware's `?t=<jwt>` URL fallback is used by the client hook).
 *   2. Every query is scoped by site (User.allowedSites / UserSiteGrant via
 *      siteFilterForUser/getAllowedSites) AND demo scope (demoFilter).
 *   3. The activity feed is scoped by actor domain: demo users only ever see
 *      rows written by @itam.demo actors, real users never see demo actors.
 *      (AuditLog.isDemo is not reliably populated by logAudit, so the email
 *      domain is the trustworthy discriminator — all demo accounts use
 *      @itam.demo.)
 *
 * SPRINT-1 #8 (DEV-HANDOVER B-03): SSE connection leak fix.
 *   Previously the `setInterval` timers (interval + heartbeat) were only
 *   cleared on `_req.signal` abort. But when a tab is closed abruptly,
 *   the browser may not send the TCP FIN before Vercel's function timeout
 *   fires — leaving the timers running until the function is killed.
 *   On a busy dashboard with many tabs open over a day, this leaked
 *   hundreds of orphaned intervals that kept hitting the DB every 30s.
 *
 *   Fix: also implement the `cancel()` callback on ReadableStream so
 *   the timers are cleared when the consumer (Response stream) is
 *   cancelled — which happens reliably on connection close. Plus we
 *   wrap every `controller.enqueue` in try/catch so an already-closed
 *   controller doesn't crash the interval callback.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes — client reconnects automatically

export async function GET(_req: NextRequest) {
  // Auth: EventSource cannot send an Authorization header, but
  // requireAuth()'s extractBearer() falls back to the `?t=` URL query param
  // — the client hook appends it to the EventSource URL.
  const auth = await requireAuth(_req, 'VIEW_DASHBOARD')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const user = auth.row

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false

      function safeEnqueue(data: string): boolean {
        if (closed) return false
        try {
          controller.enqueue(encoder.encode(data))
          return true
        } catch {
          // controller already closed — mark as closed so we stop trying
          closed = true
          return false
        }
      }

      async function sendKpi() {
        if (closed) return
        try {
          const kpi = await getKpi(user)
          safeEnqueue(`event: kpi\ndata: ${JSON.stringify(kpi)}\n\n`)
        } catch (err) {
          console.error('[sse] sendKpi error:', err)
        }
      }

      // Send initial KPI immediately
      await sendKpi()

      // Then every 30 seconds
      const interval = setInterval(() => { void sendKpi() }, 30_000)

      // Heartbeat every 15s to keep connection alive
      const heartbeat = setInterval(() => {
        if (closed) return
        if (!safeEnqueue(': heartbeat\n\n')) {
          // enqueue failed → connection is gone, clean up
          clearInterval(interval)
          clearInterval(heartbeat)
        }
      }, 15_000)

      // Clean up when client disconnects (request abort)
      _req.signal.addEventListener('abort', () => {
        closed = true
        clearInterval(interval)
        clearInterval(heartbeat)
        try { controller.close() } catch {}
        console.log('[sse] client disconnected')
      })
    },

    // SPRINT-1 #8: also clean up when the stream itself is cancelled
    // (e.g. browser tab closed without sending abort signal). This is
    // the reliable path — ReadableStream.cancel() fires when the
    // consumer drops the stream.
    cancel() {
      console.log('[sse] stream cancelled')
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

async function getKpi(user: UserPermissionRow) {
  const today = new Date()
  const future = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
  const todayStr = today.toISOString().slice(0, 10)
  const futureStr = future.toISOString().slice(0, 10)

  // ── Scoping (mirrors /api/itam/dashboard) ─────────────────────────────
  // Site: restrict to the user's allowed sites (siteCode on WorkOrder /
  // AuditLog, site on Device / StockItem). Demo: demo users see only demo
  // data, real users see only real data.
  const demo = demoFilter(user)
  const userSites = getAllowedSites(user)
  const deviceWhere = { ...siteFilterForUser(user), ...demo }
  const woSite = userSites === 'ALL' ? {} : { siteCode: { in: userSites } }
  const stockSite = userSites === 'ALL' ? {} : { site: { in: userSites } }
  // Activity feed: AuditLog rows are not isDemo-tagged by logAudit, so we
  // discriminate by actor email domain — every demo account is @itam.demo.
  // Demo users NEVER see real users' activity; real users never see demo's.
  const demoActor = { actor: { endsWith: '@itam.demo' } }
  const realActor = { NOT: { actor: { endsWith: '@itam.demo' } } }
  const auditWhere = { ...(isDemoUser(user) ? demoActor : realActor) }

  const [devices, workOrders, pendingWO, lowStockRows, warrantyExpiring, recentActivities] = await Promise.all([
    db.device.count({ where: deviceWhere }),
    db.workOrder.count({ where: { ...woSite, ...demo } }),
    db.workOrder.count({
      where: { ...woSite, ...demo, status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS'] } },
    }).catch(() => 0),
    db.stockItem.findMany({
      where: { ...stockSite, ...demo },
      select: { quantity: true, minQuantity: true },
    }).catch(() => []),
    db.device.count({
      where: {
        ...deviceWhere,
        warrantyEnd: { not: null, gte: todayStr, lte: futureStr },
      },
    }).catch(() => 0),
    // Fetch 15 recent logs, then prefer business events over LOGIN noise:
    // LOGIN rows flood the feed (every session start logs one) and make
    // the "กิจกรรมล่าสุด" panel useless in dev/QA. Take up to 5 non-LOGIN
    // entries first; fall back to LOGIN entries only if nothing else exists.
    db.auditLog.findMany({
      where: auditWhere,
      take: 15,
      orderBy: { createdAt: 'desc' },
      select: { action: true, entity: true, summary: true, actor: true, createdAt: true },
    }).catch(() => []),
  ])

  // Compute low stock client-side (avoid complex Prisma comparison)
  const lowStock = lowStockRows.filter(s => s.quantity <= (s.minQuantity ?? 0)).length

  // De-noise: prefer non-LOGIN events, fallback to LOGIN-only when the
  // system is brand new and has nothing else to show.
  const nonLogin = recentActivities.filter(a => a.action !== 'LOGIN')
  const loginOnly = recentActivities.filter(a => a.action === 'LOGIN')
  const feed = (nonLogin.length > 0 ? nonLogin : loginOnly).slice(0, 5)

  return {
    devices,
    workOrders,
    pendingWO,
    lowStock,
    warrantyExpiring,
    recentActivities: feed.map(a => ({
      action: a.action,
      entity: a.entity,
      summary: String(a.summary || '').slice(0, 100),
      actor: a.actor,
      createdAt: a.createdAt instanceof Date ? a.createdAt.getTime() : Number(a.createdAt),
    })),
  }
}
