import { NextRequest, NextResponse } from 'next/server'
import { retryFailedEntries } from '@/lib/notification-log'
import { sendLINE, sendTelegram, sendEmail } from '@/lib/notifications'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { verifyCronSecret } from '@/lib/cron-auth'

/**
 * GET /api/cron/notification-retry
 *
 * Bug B fix — retry FAILED notification log entries up to MAX_RETRIES (3).
 *
 * Schedule (suggested): every 5 minutes via vercel.json crons or external
 * cron service. Backoff between retries: 5m → 15m → 1h (see RETRY_BACKOFF_MS).
 *
 * Security: requires CRON_SECRET header (set in Vercel env vars).
 * In development (no CRON_SECRET set), allows access without auth.
 *
 * Behavior:
 *   1. Query NotificationLog where status=FAILED AND retryCount < MAX_RETRIES
 *   2. For each row: increment retryCount, attempt resend, mark SENT/FAILED
 *   3. Permanent failures (retryCount >= MAX_RETRIES) stay FAILED for admin review
 *
 * The resend callback dispatches to the right channel based on row.channel.
 * Logs the summary to console for observability.
 */
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('notifications')
  if (unavailable) return unavailable

  const auth = verifyCronSecret(req)
  if (auth) return auth

  const startedAt = Date.now()
  console.log('[notification-retry] starting retry pass')

  const summary = await retryFailedEntries(async (row) => {
    // Re-dispatch based on the original channel.
    // The body is already rendered (stored in NotificationLog.body),
    // so we just resend it as-is.
    try {
      switch (row.channel) {
        case 'line-oa':
          return await sendLINE(row.body, row.target ?? undefined)
        case 'telegram':
          return await sendTelegram(row.body, row.target ?? undefined)
        case 'email':
          if (!row.target) return false
          // For email, we don't have the subject/body split in the log,
          // so we use the title as subject and body as body.
          return await sendEmail(row.target, row.title, row.body)
        default:
          console.warn(`[notification-retry] unknown channel: ${row.channel}`)
          return false
      }
    } catch (err) {
      console.error(`[notification-retry] resend threw for ${row.channel}:`, err)
      return false
    }
  })

  const elapsedMs = Date.now() - startedAt
  console.log(
    `[notification-retry] done in ${elapsedMs}ms — ` +
      `examined=${summary.examined} retried=${summary.retried} ` +
      `succeeded=${summary.succeeded} stillFailing=${summary.stillFailing} ` +
      `permanentlyFailed=${summary.permanentlyFailed}`,
  )

  return NextResponse.json({
    ok: true,
    ts: Date.now(),
    // `true` when no CRON_SECRET is configured, i.e. the route is running
    // in open dev mode (verifyCronSecret allows unauthenticated access).
    dev: !process.env.CRON_SECRET,
    elapsedMs,
    summary,
  })
}
