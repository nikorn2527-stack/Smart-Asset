import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'

/**
 * POST /api/itam/auth/reject/[id] — admin: reject pending user.
 *
 * Requires USER_MANAGE permission.
 *  - Deletes the user record (since they were never active, deletion is safe)
 *
 * Returns: { ok: true }
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req, 'USER_MANAGE')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { id } = await ctx.params
  const target = await db.user.findUnique({ where: { id } })
  if (!target) {
    return NextResponse.json({ error: 'ไม่พบผู้ใช้' }, { status: 404 })
  }

  // Safety: only allow rejecting users who are still pending (active=false)
  if (target.active) {
    return NextResponse.json(
      { error: 'ไม่สามารถปฏิเสธบัญชีที่เปิดใช้งานแล้ว — ใช้ "ลบ" หรือ "ปิดใช้งาน" แทน' },
      { status: 400 },
    )
  }

  // ── Delete user ────────────────────────────────────────────────
  await db.user.delete({ where: { id } })

  // ── Audit log ──────────────────────────────────────────────────
  try {
    await db.auditLog.create({
      data: {
        action: 'USER_REJECT',
        entity: 'User',
        entityId: target.id,
        summary: `ปฏิเสธคำขอ: ${target.email}`,
        detail: JSON.stringify({
          email: target.email,
          name: target.name,
          rejectedBy: auth.user.email,
        }),
        actor: auth.user.email,
      },
    })
  } catch (err) { console.error('[route]', err) }

  return NextResponse.json({ ok: true })
}
