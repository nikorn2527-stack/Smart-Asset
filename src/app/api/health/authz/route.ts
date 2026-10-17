/**
 * GET /api/health/authz — Authorization config health check.
 *
 * Task ID: BLOCKER-FIXES-ROUND-2 (audit team finding #7)
 *
 * Surfaces the result of `validateProductionAuthzConfig()` so operators
 * can detect unsafe authorization configurations (e.g. non-superadmin
 * users with `allowedSites='ALL'`) from a single endpoint. This is the
 * runtime hook called by the startup validation step described in
 * `authorization-context.ts`.
 *
 * Behavior:
 *   • Requires SYSTEM_CONFIG permission (this endpoint reveals authz
 *     config issues, so it must itself be gated).
 *   • Returns 200 with `{ issues, status: 'pass' }` when no errors.
 *   • Returns 503 with `{ issues, status: 'fail' }` when one or more
 *     issues are at level 'error'. Liveness probes should treat 503 as
 *     "degraded but reachable" — the HTTP server is up, but the authz
 *     policy is in an unsafe state.
 *
 * In production, an external uptime check (or a startup hook in
 * `src/instrumentation.ts`) should call this endpoint and fail loudly
 * if it returns 503.
 */
import { NextResponse } from 'next/server'
import { validateProductionAuthzConfig } from '@/lib/authorization-context'
import { requireAuth } from '@/lib/auth-middleware'

export async function GET(req: Request) {
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const issues = await validateProductionAuthzConfig()
  const hasErrors = issues.some((i) => i.level === 'error')
  return NextResponse.json(
    { issues, status: hasErrors ? 'fail' : 'pass' },
    { status: hasErrors ? 503 : 200 },
  )
}
