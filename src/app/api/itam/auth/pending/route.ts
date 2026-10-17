import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { toAuthUser } from '@/lib/auth'

/**
 * GET /api/itam/auth/pending — admin: list pending users (active=false).
 *
 * Requires ADMIN permission.
 * Returns users where active=false, sorted by createdAt desc.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, 'USER_MANAGE')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const rows = await db.user.findMany({
    where: { active: false },
    orderBy: [{ createdAt: 'desc' }],
  })

  // Strip password hashes/salts
  const safe = rows.map((r) => ({
    id: r.id,
    email: r.email,
    username: r.username,
    name: r.name,
    role: r.role,
    department: r.department,
    phone: r.phone,
    createdAt: r.createdAt.toISOString(),
  }))

  return NextResponse.json({ users: safe, count: safe.length })
}
