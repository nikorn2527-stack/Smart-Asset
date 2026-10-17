/**
 * notification-log.ts — Persistence layer for notification delivery.
 *
 * Bug B fix: previously notifications.ts was fire-and-forget. If a LINE
 * push, Telegram send, or SMTP delivery failed (rate limit, expired token,
 * network glitch), the message was silently lost — only console.error'd.
 *
 * This module wraps every send attempt in a NotificationLog row:
 *   1. createPendingLog() — record before send (status=PENDING)
 *   2. markSent() / markFailed() — update after send attempt
 *   3. retryFailed() — cron hook to re-attempt FAILED entries
 *
 * The retry cap (MAX_RETRIES = 3) prevents infinite loops on permanently
 * broken channels (e.g. revoked LINE token).
 */
import { db } from '@/lib/db'

export const MAX_RETRIES = 3
export const RETRY_BACKOFF_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000] // 5m, 15m, 1h

export interface CreateLogInput {
  channel: string
  template: string
  title: string
  body: string
  target?: string | null
  entityId?: string | null
  entity?: string | null
  actor?: string
}

/**
 * Create a PENDING log entry before attempting to send.
 * Returns the id so the caller can update status after the send.
 */
export async function createPendingLog(input: CreateLogInput): Promise<string | null> {
  try {
    const row = await db.notificationLog.create({
      data: {
        channel: input.channel,
        template: input.template,
        title: input.title.slice(0, 500),
        body: input.body,
        target: input.target ?? null,
        entityId: input.entityId ?? null,
        entity: input.entity ?? null,
        status: 'PENDING',
        actor: input.actor ?? 'system',
      },
    })
    return row.id
  } catch (err) {
    // Non-fatal: notification logging must never break the actual send.
    console.error('[notification-log] createPendingLog failed:', err)
    return null
  }
}

/**
 * Mark a log entry as SENT successfully.
 */
export async function markSent(id: string | null): Promise<void> {
  if (!id) return
  try {
    await db.notificationLog.update({
      where: { id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        lastAttemptAt: new Date(),
        errorMessage: null,
      },
    })
  } catch (err) {
    console.error('[notification-log] markSent failed:', err)
  }
}

/**
 * Mark a log entry as FAILED with the error message.
 * Does NOT increment retryCount — that happens in retryFailed().
 */
export async function markFailed(
  id: string | null,
  errorMessage: string,
): Promise<void> {
  if (!id) return
  try {
    await db.notificationLog.update({
      where: { id },
      data: {
        status: 'FAILED',
        lastAttemptAt: new Date(),
        errorMessage: errorMessage.slice(0, 1000),
      },
    })
  } catch (err) {
    console.error('[notification-log] markFailed failed:', err)
  }
}

/**
 * Mark a log entry as SKIPPED (intentionally not sent — e.g. no target
 * configured). Distinct from FAILED so retry cron ignores it.
 */
export async function markSkipped(
  id: string | null,
  reason: string,
): Promise<void> {
  if (!id) return
  try {
    await db.notificationLog.update({
      where: { id },
      data: {
        status: 'SKIPPED',
        lastAttemptAt: new Date(),
        errorMessage: reason.slice(0, 1000),
      },
    })
  } catch (err) {
    console.error('[notification-log] markSkipped failed:', err)
  }
}

/**
 * Cron hook: retry FAILED entries that haven't exceeded MAX_RETRIES.
 *
 * Picks the oldest N (default 50) FAILED rows where retryCount < MAX_RETRIES
 * AND enough time has passed since the last attempt (uses RETRY_BACKOFF_MS).
 *
 * Returns a summary of the retry pass.
 *
 * NOTE: the actual re-send logic is delegated to the caller via the
 * `resend` callback, so this module stays free of channel-specific imports
 * (LINE/Telegram/SMTP) — the cron route wires the callback.
 */
export interface RetrySummary {
  examined: number
  retried: number
  succeeded: number
  stillFailing: number
  permanentlyFailed: number
}

export async function retryFailedEntries(
  resend: (row: {
    id: string
    channel: string
    template: string
    title: string
    body: string
    target: string | null
  }) => Promise<boolean>,
  batchSize = 50,
): Promise<RetrySummary> {
  const summary: RetrySummary = {
    examined: 0,
    retried: 0,
    succeeded: 0,
    stillFailing: 0,
    permanentlyFailed: 0,
  }

  let rows: Array<{
    id: string
    channel: string
    template: string
    title: string
    body: string
    target: string | null
    retryCount: number
    lastAttemptAt: Date | null
  }>

  try {
    rows = await db.notificationLog.findMany({
      where: {
        status: 'FAILED',
        retryCount: { lt: MAX_RETRIES },
      },
      orderBy: { lastAttemptAt: 'asc' },
      take: batchSize,
      select: {
        id: true,
        channel: true,
        template: true,
        title: true,
        body: true,
        target: true,
        retryCount: true,
        lastAttemptAt: true,
      },
    })
  } catch (err) {
    console.error('[notification-log] retryFailedEntries query failed:', err)
    return summary
  }

  summary.examined = rows.length

  for (const row of rows) {
    // Backoff check — skip if not enough time has passed since last attempt.
    if (row.lastAttemptAt) {
      const backoffIdx = Math.min(row.retryCount, RETRY_BACKOFF_MS.length - 1)
      const elapsed = Date.now() - row.lastAttemptAt.getTime()
      if (elapsed < RETRY_BACKOFF_MS[backoffIdx]) continue
    }

    summary.retried++

    // Increment retryCount BEFORE sending, so a crash mid-send doesn't
    // cause infinite retries.
    try {
      await db.notificationLog.update({
        where: { id: row.id },
        data: {
          retryCount: { increment: 1 },
          lastAttemptAt: new Date(),
        },
      })
    } catch (err) {
      console.error('[notification-log] increment retryCount failed:', err)
      continue
    }

    let ok = false
    try {
      ok = await resend({
        id: row.id,
        channel: row.channel,
        template: row.template,
        title: row.title,
        body: row.body,
        target: row.target,
      })
    } catch (err) {
      ok = false
      console.error('[notification-log] resend threw:', err)
    }

    if (ok) {
      summary.succeeded++
      await markSent(row.id)
    } else {
      // Reload to check the new retryCount (we incremented above).
      const fresh = await db.notificationLog.findUnique({
        where: { id: row.id },
        select: { retryCount: true },
      })
      if ((fresh?.retryCount ?? 0) >= MAX_RETRIES) {
        summary.permanentlyFailed++
      } else {
        summary.stillFailing++
      }
      await markFailed(row.id, 'retry attempt failed')
    }
  }

  return summary
}

/**
 * Admin-facing stats for the notification log dashboard.
 */
export interface NotificationLogStats {
  total: number
  pending: number
  sent: number
  failed: number
  skipped: number
  permanentlyFailed: number
  byChannel: Array<{ channel: string; total: number; sent: number; failed: number }>
  recentFailures: Array<{
    id: string
    channel: string
    template: string
    title: string
    errorMessage: string | null
    retryCount: number
    lastAttemptAt: Date | null
    createdAt: Date
  }>
}

export async function getNotificationLogStats(): Promise<NotificationLogStats> {
  const [total, pending, sent, failed, skipped, permanentlyFailed, byChannelRaw, recentFailures] =
    await Promise.all([
      db.notificationLog.count(),
      db.notificationLog.count({ where: { status: 'PENDING' } }),
      db.notificationLog.count({ where: { status: 'SENT' } }),
      db.notificationLog.count({ where: { status: 'FAILED' } }),
      db.notificationLog.count({ where: { status: 'SKIPPED' } }),
      db.notificationLog.count({
        where: { status: 'FAILED', retryCount: { gte: MAX_RETRIES } },
      }),
      db.notificationLog.groupBy({
        by: ['channel'],
        _count: { _all: true },
      }),
      db.notificationLog.findMany({
        where: { status: 'FAILED' },
        orderBy: { lastAttemptAt: 'desc' },
        take: 10,
        select: {
          id: true,
          channel: true,
          template: true,
          title: true,
          errorMessage: true,
          retryCount: true,
          lastAttemptAt: true,
          createdAt: true,
        },
      }),
    ])

  // For per-channel sent/failed counts, run a second groupBy pass.
  const channelStats = await Promise.all(
    byChannelRaw.map(async (c) => {
      const [s, f] = await Promise.all([
        db.notificationLog.count({ where: { channel: c.channel, status: 'SENT' } }),
        db.notificationLog.count({ where: { channel: c.channel, status: 'FAILED' } }),
      ])
      return { channel: c.channel, total: c._count._all, sent: s, failed: f }
    }),
  )

  return {
    total,
    pending,
    sent,
    failed,
    skipped,
    permanentlyFailed,
    byChannel: channelStats,
    recentFailures,
  }
}
