import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { blacklistToken } from '@/lib/auth'

/** POST /api/itam/auth/logout — invalidate the current JWT. */
export async function POST(req: Request) {
  const auth = await requireAuth(req)
  if (!auth.ok) {
    // Even if the token is already invalid/expired, return 200 so the client
    // can safely clear local state.
    return NextResponse.json({ ok: true, alreadyLoggedOut: true })
  }
  // Add token to blacklist
  const h = req.headers.get('authorization') || ''
  const m = h.match(/^Bearer\s+(.+)$/i)
  if (m) blacklistToken(m[1].trim())

  // Audit log (best-effort)
  try {
    await db.auditLog.create({
      data: {
        action: 'LOGOUT',
        entity: 'User',
        entityId: auth.row.id,
        summary: `ออกจากระบบ: ${auth.user.email}`,
        detail: JSON.stringify({ method: 'password' }),
        actor: auth.user.email,
      },
    })
  } catch (err) { console.error('[route]', err) }
  return NextResponse.json({ ok: true })
}
