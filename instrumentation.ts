/**
 * instrumentation.ts — Next.js instrumentation hook.
 *
 * Required by Sentry for server-side error tracking.
 * This file is automatically called by Next.js on server startup.
 *
 * It imports the Sentry server config which initializes error tracking.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}
