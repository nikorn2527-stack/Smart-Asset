import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'
import { inviteLinkEmail, APP_BASE_URL } from '@/lib/auth-email-templates'

/**
 * POST /api/auth/request-invite — Method 2: request invite link.
 *
 * Body: { email }
 *
 *  - Generates a token (UUID), stores in PasswordResetToken with type='invite'
 *  - Sends email with link: {APP_BASE_URL}/?token={token}
 *  - Token expires in 24 hours
 *
 * Returns: { ok: true, message: "ส่งลิงก์ไปยังอีเมลแล้ว" }
 * (When SMTP is not configured, returns the link in the response for testing)
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

    // ── If user already exists & active → tell them to log in instead ──
    const existing = await db.user.findUnique({ where: { email } })
    if (existing && existing.active) {
      return NextResponse.json(
        {
          error:
            'อีเมลนี้มีบัญชีในระบบแล้ว กรุณาเข้าสู่ระบบ หรือใช้ลิงก์ "ลืมรหัสผ่าน"',
        },
        { status: 409 },
      )
    }

    // ── Generate token + store ─────────────────────────────────────
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    await db.passwordResetToken.create({
      data: {
        email,
        token,
        type: 'invite',
        expiresAt,
      },
    })

    // ── Send invite email ──────────────────────────────────────────
    const inviteUrl = `${APP_BASE_URL}/?token=${token}`
    const tpl = inviteLinkEmail(inviteUrl)
    const sent = await sendEmail(email, tpl.subject, tpl.html)

    // ── Audit log ──────────────────────────────────────────────────
    try {
      await db.auditLog.create({
        data: {
          action: 'INVITE_REQUEST',
          entity: 'PasswordResetToken',
          entityId: token,
          summary: `ส่งคำเชิญลงทะเบียนไปยัง ${email}`,
          detail: JSON.stringify({ email, expiresAt: expiresAt.toISOString() }),
          actor: email,
        },
      })
    } catch (err) { console.error('[route]', err) }

    return NextResponse.json({
      ok: true,
      message: 'ส่งลิงก์ไปยังอีเมลแล้ว',
      // For testing when SMTP is not configured — return the link
      ...(sent ? {} : { testLink: inviteUrl }),
    })
  } catch (err) {
    console.error('POST /api/auth/request-invite', err)
    return NextResponse.json(
      {
        error: 'Internal server error',
        detail: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : String(err)) : 'Internal server error',
      },
      { status: 500 },
    )
  }
}
