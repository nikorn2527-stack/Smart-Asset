import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { isAdminRole } from '@/lib/auth'

/**
 * GET /api/itam/audit?action=&actor=&q=&startDate=&endDate=&page=1&limit=50
 *
 * AuditLog schema columns (PostgreSQL camelCase):
 *   id, action, entity, entityId, summary, detail, actor, createdAt
 *
 * Non-admins (no `VIEW_AUDIT` permission, or non-admin role) only see
 * audit entries they themselves produced (`actor === user.email`).
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req, 'VIEW_AUDIT')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row

    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action')?.trim() ?? ''
    const actorQ = searchParams.get('actor')?.trim() ?? ''
    const entityQ = searchParams.get('entity')?.trim() ?? ''
    const q = searchParams.get('q')?.trim() ?? ''
    const startDate = searchParams.get('startDate')?.trim() ?? ''
    const endDate = searchParams.get('endDate')?.trim() ?? ''
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))

    const andClauses: Record<string, unknown>[] = []

    // Non-admins (no ADMIN perm) can only see their OWN audit entries.
    if (!isAdminRole(user.role)) {
      andClauses.push({ actor: user.email })
    } else if (actorQ) {
      // admins can filter by any actor
      andClauses.push({ actor: { contains: actorQ, mode: 'insensitive' } })
    }

    if (action) andClauses.push({ action })
    if (entityQ) andClauses.push({ entity: { contains: entityQ, mode: 'insensitive' } })
    if (q) {
      andClauses.push({
        OR: [
          { summary: { contains: q, mode: 'insensitive' } },
          { detail: { contains: q, mode: 'insensitive' } },
          { actor: { contains: q, mode: 'insensitive' } },
        ],
      })
    }
    if (startDate) {
      // (QA-ROUND-2026-09-16-C) ISO strings, not Date objects — Date
      // instances in Prisma filter args break under Bun ("_ref missing").
      andClauses.push({ createdAt: { gte: startDate + 'T00:00:00.000Z' } })
    }
    if (endDate) {
      // Include the entire end day (≤ end-of-day)
      andClauses.push({ createdAt: { lte: endDate + 'T23:59:59.999Z' } })
    }

    const where: Record<string, unknown> =
      andClauses.length > 0 ? { AND: andClauses } : {}

    const [logs, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      db.auditLog.count({ where }),
    ])

    // Also fetch the distinct set of actions currently present in the table
    // (drives the client-side filter dropdown).
    const actionAgg = await db.auditLog.groupBy({
      by: ['action'],
      _count: { _all: true },
      orderBy: { action: 'asc' },
    })

    return NextResponse.json({
      logs,
      count: logs.length,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      actions: actionAgg.map((a) => ({ action: a.action, count: a._count._all })),
    })
  } catch (err) {
    console.error('GET /api/itam/audit', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// Reference imports to keep the bundle from stripping them in dead-code paths
void isAdminRole
