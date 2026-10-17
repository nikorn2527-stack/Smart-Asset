import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { getCurrentUser } from '@/lib/auth-session'

/**
 * GET /api/users/pending — list users pending approval (active=false).
 *
 * Admin only. Returns users who registered but haven't been activated yet.
 *
 * Auth: Bearer token (ITAM JWT) or cookie session (legacy).
 */
export async function GET(req: NextRequest) {
  try {
    // Try Bearer token first
    const bearerAuth = await requireAuth(req, 'USER_MANAGE')
    if (!bearerAuth.ok) {
      // Fall back to cookie session
      const cookieUser = await getCurrentUser(req)
      if (!cookieUser || (cookieUser.role !== 'admin' && cookieUser.role !== 'superadmin' && !cookieUser.permissions.includes('*'))) {
        return NextResponse.json({ error: 'ต้องเข้าสู่ระบบในฐานะผู้ดูแลระบบ' }, { status: 401 })
      }
    }

    const pendingUsers = await db.user.findMany({
      where: { active: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        department: true,
        phone: true,
        allowedSites: true,
        source: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ users: pendingUsers })
  } catch (err) {
    console.error('GET /api/users/pending', err)
    return NextResponse.json(
      { error: 'Failed to fetch pending users' },
      { status: 500 },
    )
  }
}
