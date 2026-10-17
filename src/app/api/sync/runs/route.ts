// ============================================================
// GET /api/sync/runs — List sync runs (history)
// ============================================================
// I-04: AuthorizationContext + Site filter + ownership check
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { moduleUnavailableResponse } from '@/lib/module-gate'

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('sync')
  if (unavailable) return unavailable


  // 1. Auth + AuthorizationContext
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const user = auth.user
  const ctx = await buildAuthorizationContext(user, auth.row.id, auth.row.allowedSites)

  const url = new URL(req.url)
  const source = url.searchParams.get('source')
  const mode = url.searchParams.get('mode')
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100)

  // 2. Build Site filter for non-superadmin (I-04)
  const where: Record<string, unknown> = {}
  if (source) where.source = source
  if (mode) where.mode = mode

  if (user.role !== 'superadmin') {
    // Non-superadmin: only show runs for sites they have access to
    // siteScope is stored as comma-joined string or null (for superadmin multi-site)
    // We filter at application level since siteScope is comma-joined
    const allowedSites = ctx.siteScope?.siteCodes || []

    if (allowedSites.length > 0) {
      // Filter: runs with matching siteScope OR null siteScope (legacy)
      // Since siteScope is comma-joined, we need application-level filter
      const allRuns = await db.syncRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit * 3, // fetch more to filter
        select: {
          id: true,
          source: true,
          target: true,
          mode: true,
          status: true,
          totalRows: true,
          createRows: true,
          updateRows: true,
          skipRows: true,
          errorRows: true,
          startedAt: true,
          completedAt: true,
          durationMs: true,
          triggeredBy: true,
          siteScope: true,
          errorMessage: true,
          retryOf: true,
          createdAt: true,
        },
      })

      // Filter by siteScope
      const filteredRuns = allRuns.filter((run) => {
        if (!run.siteScope) return false // null = superadmin run, skip for non-superadmin
        const runSites = run.siteScope.split(',').map((s) => s.trim()).filter(Boolean)
        return runSites.some((site) => allowedSites.includes(site))
      })

      return NextResponse.json({ runs: filteredRuns.slice(0, limit) })
    }

    // No allowed sites — return empty
    return NextResponse.json({ runs: [] })
  }

  // Superadmin: no filter
  const runs = await db.syncRun.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      source: true,
      target: true,
      mode: true,
      status: true,
      totalRows: true,
      createRows: true,
      updateRows: true,
      skipRows: true,
      errorRows: true,
      startedAt: true,
      completedAt: true,
      durationMs: true,
      triggeredBy: true,
      siteScope: true,
      errorMessage: true,
      retryOf: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ runs })
}
