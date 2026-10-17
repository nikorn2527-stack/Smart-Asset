/**
 * GET /api/itam/auth/permissions — list all permissions (catalog)
 *
 * Task ID: PHASE1-AUTH-FOUNDATION
 *
 * Returns the Permission catalog grouped by resource. Used by the admin
 * UI to render permission management screens.
 *
 * Authorization: requires USER_MANAGE permission (only role admins need
 * to see the full permission catalog).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, 'USER_MANAGE')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const permissions = await db.permission.findMany({
      where: { active: true },
      select: {
        code: true,
        resource: true,
        action: true,
        description: true,
      },
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    })

    // Group by resource for UI convenience
    const byResource: Record<string, typeof permissions> = {}
    for (const p of permissions) {
      if (!byResource[p.resource]) byResource[p.resource] = []
      byResource[p.resource].push(p)
    }

    return NextResponse.json({
      permissions,
      byResource,
    })
  } catch (err) {
    console.error('GET /api/itam/auth/permissions', err)
    return NextResponse.json(
      { error: 'Failed to fetch permissions' },
      { status: 500 },
    )
  }
}
