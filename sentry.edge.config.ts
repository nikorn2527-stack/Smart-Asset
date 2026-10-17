import * as Sentry from '@sentry/nextjs'

/**
 * Sentry Edge runtime initialization.
 *
 * Captures errors from:
 *   - Edge proxy (src/proxy.ts)
 *   - Edge API routes (runtime = 'edge')
 *
 * Edge runtime has limited API — no Node.js modules.
 */

export const register = () => {
  const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN

  if (SENTRY_DSN && SENTRY_DSN.startsWith('http')) {
    Sentry.init({
      dsn: SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.NODE_ENV || 'development',
      enabled: process.env.NODE_ENV === 'production',
    })
  }
}

export const onRequestError = Sentry.captureRequestError
