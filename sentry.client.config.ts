import * as Sentry from '@sentry/nextjs'

/**
 * Sentry initialization — error tracking.
 *
 * Free tier: 5,000 errors/month + 50 session replays/month
 * Dashboard: https://sentry.io/organizations/your-org/projects/
 *
 * Setup:
 *   1. SENTRY_DSN env var (required — set in Vercel)
 *   2. Optional: SENTRY_AUTH_TOKEN for source maps (better stack traces)
 *
 * Captures:
 *   - Unhandled exceptions (client + server)
 *   - API route errors (500s)
 *   - Performance traces (optional — slows down requests slightly)
 *
 * Privacy: No PII captured by default. Errors include:
 *   - Stack trace
 *   - Request URL (not body)
 *   - User agent (not IP)
 */

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN

if (SENTRY_DSN && SENTRY_DSN.startsWith('http')) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 0.1, // 10% of transactions traced (free tier friendly)
    environment: process.env.NODE_ENV || 'development',
    // Don't capture in development (too noisy)
    enabled: process.env.NODE_ENV === 'production',
    // Ignore common noisy errors
    ignoreErrors: [
      'NEXT_NOT_FOUND',
      'NEXT_REDIRECT',
      'resize observer loop',
      'Non-Error promise rejection',
    ],
    beforeSend(event) {
      // Strip sensitive data before sending
      if (event.request?.headers) {
        delete event.request.headers.authorization
        delete event.request.headers.cookie
      }
      if (event.request?.cookies) {
        delete event.request.cookies
      }
      return event
    },
  })
}
