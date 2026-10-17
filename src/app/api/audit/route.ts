import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'

export async function GET(req: NextRequest) {
  // ── P0 Security: require VIEW_AUDIT permission ──
  // Audit logs contain actor, entity, summary, and detail which can
  // expose internal activity. Previously this endpoint was unauthenticated.
  const auth = await requireAuth(req, 'VIEW_AUDIT')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(req.url)
    const limit = Math.min(
      Number(searchParams.get('limit') ?? '50') || 50,
      100,
    )
    const entity = searchParams.get('entity')?.trim() ?? ''
    const action = searchParams.get('action')?.trim() ?? ''
    const q = searchParams.get('q')?.trim() ?? ''

    const where: Record<string, unknown> = {}
    if (entity) where.entity = entity
    if (action) where.action = action
    if (q) {
      where.OR = [
        { summary: { contains: q } },
        { detail: { contains: q } },
        { actor: { contains: q } },
      ]
    }

    const logs = await db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return NextResponse.json({ logs })
  } catch (err) {
    console.error('GET /api/audit', err)
    return NextResponse.json(
      { error: 'Failed to fetch audit logs' },
      { status: 500 },
    )
  }
}
