import * as Sentry from '@sentry/nextjs'

/**
 * Sentry server-side initialization.
 *
 * Captures errors from:
 *   - API routes (serverless functions)
 *   - Server components (SSR)
 *   - Middleware (Edge runtime)
 *
 * Same DSN as client-side (NEXT_PUBLIC_SENTRY_DSN).
 */

export const register = () => {
  const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN

  if (SENTRY_DSN && SENTRY_DSN.startsWith('http')) {
    Sentry.init({
      dsn: SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.NODE_ENV || 'development',
      enabled: process.env.NODE_ENV === 'production',
      ignoreErrors: [
        'NEXT_NOT_FOUND',
        'NEXT_REDIRECT',
      ],
      beforeSend(event) {
        if (event.request?.headers) {
          delete event.request.headers.authorization
          delete event.request.headers.cookie
        }
        return event
      },
    })
  }
}

export const onRequestError = Sentry.captureRequestError
