import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'
import { passwordResetEmail, APP_BASE_URL } from '@/lib/auth-email-templates'

/**
 * POST /api/auth/forgot-password — request password reset.
 *
 * Body: { email }
 *
 *  - Generates token, stores with type='reset'
 *  - Sends email with link: {APP_BASE_URL}/?token={token}
 *  - Token expires in 1 hour
 *
 * Returns: { ok: true } (always, even if email doesn't exist — security)
 * (When SMTP is not configured AND the email exists, returns testLink for testing)
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: string }
    const email = String(body.email || '').trim().toLowerCase()

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'กรุณาระบุอีเมลที่ถูกต้อง' },
        { status: 400 },
      )
    }

    // ── Look up user (but always return ok to avoid account enumeration) ─
    const user = await db.user.findUnique({ where: { email } })

    if (!user) {
      // Log + return ok (don't leak that the email doesn't exist)
      console.log(
        `[forgot-password] requested for unknown email: ${email} — silently returning ok`,
      )
      return NextResponse.json({ ok: true })
    }

    // ── Generate token + store ─────────────────────────────────────
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    await db.passwordResetToken.create({
      data: {
        email,
        token,
        type: 'reset',
        expiresAt,
      },
    })

    // ── Send reset email ───────────────────────────────────────────
    const resetUrl = `${APP_BASE_URL}/?token=${token}`
    const tpl = passwordResetEmail(resetUrl)
    const sent = await sendEmail(email, tpl.subject, tpl.html)

    // ── Audit log ──────────────────────────────────────────────────
    try {
      await db.auditLog.create({
        data: {
          action: 'PASSWORD_RESET_REQUEST',
          entity: 'User',
          entityId: user.id,
          summary: `ร้องขอรีเซ็ตรหัสผ่านสำหรับ ${email}`,
          detail: JSON.stringify({ email, expiresAt: expiresAt.toISOString() }),
          actor: email,
        },
      })
    } catch (err) { console.error('[route]', err) }

    return NextResponse.json({
      ok: true,
      // For testing when SMTP is not configured — return the link
      ...(sent ? {} : { testLink: resetUrl }),
    })
  } catch (err) {
    console.error('POST /api/auth/forgot-password', err)
    return NextResponse.json(
      {
        error: 'Internal server error',
        detail: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : String(err)) : 'Internal server error',
      },
      { status: 500 },
    )
  }
}
