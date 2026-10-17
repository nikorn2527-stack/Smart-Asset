import { NextRequest, NextResponse } from 'next/server'

/**
 * verifyCronSecret — shared auth helper for cron endpoints.
 *
 * P1 Security: In production, CRON_SECRET MUST be set. If missing,
 * the request is rejected with 403 (fail-closed).
 *
 * In development (NODE_ENV !== 'production'), allows access without
 * auth for manual testing via browser/curl.
 *
 * Vercel Cron automatically sends the CRON_SECRET as a Bearer token
 * in the Authorization header.
 */
export function verifyCronSecret(req: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET

  // Production: must have CRON_SECRET set
  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret) {
      console.error('[cron] CRON_SECRET not set in production — rejecting request')
      return NextResponse.json(
        { error: 'Server misconfigured: CRON_SECRET not set' },
        { status: 503 },
      )
    }
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      )
    }
    return null // auth passed
  }

  // Development: if CRON_SECRET is set, verify it; if not, allow
  if (cronSecret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      )
    }
  }
  // No CRON_SECRET in dev = allow for manual testing
  return null
}
