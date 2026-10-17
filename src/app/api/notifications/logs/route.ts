import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { getNotificationLogStats, MAX_RETRIES } from '@/lib/notification-log'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * GET /api/notifications/logs
 *
 * Bug B fix — admin-facing stats for the notification log dashboard.
 *
 * Returns:
 *   - total / pending / sent / failed / skipped counts
 *   - permanentlyFailed (retryCount >= MAX_RETRIES)
 *   - byChannel: per-channel breakdown (sent + failed)
 *   - recentFailures: last 10 FAILED entries with error details
 *
 * Requires VIEW_DASHBOARD permission (admin-level visibility).
 */
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('notifications')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'VIEW_DASHBOARD')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const stats = await getNotificationLogStats()
    return NextResponse.json({
      ...stats,
      maxRetries: MAX_RETRIES,
    })
  } catch (err) {
    console.error('GET /api/notifications/logs', err)
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === 'development'
            ? err instanceof Error
              ? err.message
              : 'Failed'
            : 'Internal server error',
      },
      { status: 500 },
    )
  }
}
