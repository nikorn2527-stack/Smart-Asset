// ============================================================
// Asset Verification Sessions (Phase 5.3 + 5.4)
// ============================================================
// GET  /api/asset-verification        — list sessions (scope=DEVICE filter)
// POST /api/asset-verification        — create a new StockCountSession with
//                                       scope=DEVICE (a verification walk)
//
// Asset verification is conceptually the same as stock count — same schema
// (StockCountSession + StockCountItem), same items table — but the target
// is a Device instead of a StockItem, and the unit of measure is
// "device found at expected location" rather than "qty counted".
//
// Auth: VIEW_DEVICES (GET), DEVICE_EDIT (POST).
// Module gate: 'devices'.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { logAudit } from '@/lib/audit'
import { demoFilter, demoTag } from '@/lib/demo-mode'

export async function GET(req: NextRequest) {
  const moduleCheck = await moduleUnavailableResponse('devices')
  if (moduleCheck) return moduleCheck

  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')?.trim() ?? ''

    const where: Record<string, unknown> = {
      ...demoFilter(auth.user),
      scope: 'DEVICE', // hard-filter to device verifications only
    }
    if (status) where.status = status

    const sessions = await db.stockCountSession.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      include: { _count: { select: { items: true } } },
    })

    return NextResponse.json({ data: sessions })
  } catch (err) {
    console.error('GET /api/asset-verification', err)
    return NextResponse.json({ error: 'Failed to fetch asset verification sessions' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const moduleCheck = await moduleUnavailableResponse('devices')
  if (moduleCheck) return moduleCheck

  const auth = await requireAuth(req, 'DEVICE_EDIT')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const siteCode = typeof body.siteCode === 'string' ? body.siteCode.trim() : null
    const note = typeof body.note === 'string' ? body.note.trim() : null

    if (!name) {
      return NextResponse.json({ error: 'Missing required field: name' }, { status: 400 })
    }

    // Always DEVICE for asset verification.
    const scope = 'DEVICE'

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
      `เริ่มรอบตรวจนับอุปกรณ์ "${session.name}"${siteCode ? ` (site=${siteCode})` : ''}`,
      { sessionId: session.id, name, scope, siteCode },
      auth.user.email,
    )

    return NextResponse.json({ data: session }, { status: 201 })
  } catch (err) {
    console.error('POST /api/asset-verification', err)
    return NextResponse.json({ error: 'Failed to create asset verification session' }, { status: 500 })
  }
}
