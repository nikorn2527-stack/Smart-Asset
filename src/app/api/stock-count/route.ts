// ============================================================
// Stock Count Sessions (Phase 5.2 + 5.4)
// ============================================================
// GET  /api/stock-count               — list sessions (filter by scope/status)
// POST /api/stock-count               — create a new StockCountSession
//                                        (scope defaults to STOCK_ITEM for
//                                         this route; asset-verification uses
//                                         /api/asset-verification/* with
//                                         scope=DEVICE)
//
// Both endpoints are gated by the 'stock' module + STOCK_VIEW / STOCK_IN
// auth. Returns JSON.
//
// Phase 5.4 summary (computed on close in /api/stock-count/[id] PUT):
//   totalCount, countedCount, notFoundCount, wrongLocationCount,
//   varianceValue (sum of |variance × unitCost|)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { logAudit } from '@/lib/audit'
import { demoTag, demoFilter } from '@/lib/demo-mode'

export async function GET(req: NextRequest) {
  const moduleCheck = await moduleUnavailableResponse('stock')
  if (moduleCheck) return moduleCheck

  const auth = await requireAuth(req, 'STOCK_VIEW')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')?.trim() ?? '' // OPEN | CLOSED | CANCELLED
    const scopeParam = searchParams.get('scope')?.trim() ?? ''

    const where: Record<string, unknown> = { ...demoFilter(auth.user) }
    if (status) where.status = status
    if (scopeParam) where.scope = scopeParam

    const sessions = await db.stockCountSession.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      include: {
        _count: { select: { items: true } },
      },
    })

    return NextResponse.json({ data: sessions })
  } catch (err) {
    console.error('GET /api/stock-count', err)
    return NextResponse.json({ error: 'Failed to fetch stock count sessions' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const moduleCheck = await moduleUnavailableResponse('stock')
  if (moduleCheck) return moduleCheck

  const auth = await requireAuth(req, 'STOCK_IN')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const siteCode = typeof body.siteCode === 'string' ? body.siteCode.trim() : null
    const note = typeof body.note === 'string' ? body.note.trim() : null

    if (!name) {
      return NextResponse.json({ error: 'Missing required field: name' }, { status: 400 })
    }

    // Always STOCK_ITEM for this route (asset-verification uses its own route).
    const scope = 'STOCK_ITEM'

    // Create the session. Items are seeded when the user adds them via
    // POST /api/stock-count/[id] (scan/enter counted qty) — NOT seeded
    // automatically, so the session can be opened with a curated subset
    // (e.g. only items at one site) rather than the full stock list.
    const session = await db.stockCountSession.create({
      data: {
        name,
        scope,
        siteCode,
        status: 'OPEN',
        note,
        createdBy: auth.user.email,
        ...demoTag(auth.user),
      },
    })

    await logAudit(
      'CREATE',
      'StockCountSession',
      session.id,
      `เริ่มรอบนับสต็อก "${session.name}" (scope=${scope}${siteCode ? `, site=${siteCode}` : ''})`,
      { sessionId: session.id, name, scope, siteCode },
      auth.user.email,
    )

    return NextResponse.json({ data: session }, { status: 201 })
  } catch (err) {
    console.error('POST /api/stock-count', err)
    return NextResponse.json({ error: 'Failed to create stock count session' }, { status: 500 })
  }
}
