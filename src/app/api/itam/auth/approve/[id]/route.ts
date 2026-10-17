import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { sendEmail } from '@/lib/notifications'
import { accountApprovedEmail, APP_BASE_URL } from '@/lib/auth-email-templates'

/**
 * POST /api/itam/auth/approve/[id] — admin: approve pending user.
 *
 * Requires USER_MANAGE permission.
 *  - Sets `active: true`
 *  - Sends email to user: "บัญชีของคุณได้รับการอนุมัติแล้ว"
 *
 * Returns: { ok: true, user }
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
  if (target.active) {
    return NextResponse.json(
      { error: 'บัญชีนี้เปิดใช้งานแล้ว' },
      { status: 400 },
    )
  }

  // ── Approve ────────────────────────────────────────────────────
  const updated = await db.user.update({
    where: { id },
    data: { active: true, updatedAt: new Date() },
  })

  // ── Send approval email (best-effort) ──────────────────────────
  const loginUrl = `${APP_BASE_URL}`
  const tpl = accountApprovedEmail(target.name || target.email, loginUrl)
  const sent = await sendEmail(target.email, tpl.subject, tpl.html)

  // ── Audit log ──────────────────────────────────────────────────
  try {
    await db.auditLog.create({
      data: {
        action: 'USER_APPROVE',
        entity: 'User',
        entityId: target.id,
        summary: `อนุมัติบัญชี: ${target.email} (role=${target.role})`,
        detail: JSON.stringify({
          email: target.email,
          role: target.role,
          approvedBy: auth.user.email,
        }),
        actor: auth.user.email,
      },
    })
  } catch (err) { console.error('[route]', err) }

  return NextResponse.json({
    ok: true,
    email: target.email,
    emailSent: sent,
  })
}
