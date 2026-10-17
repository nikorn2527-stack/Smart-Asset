import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashNewPassword } from '@/lib/auth'

/**
 * POST /api/auth/reset-password — set new password with token.
 *
 * Body: { token, password }
 *
 *  - Verifies token (valid + not expired + not used + type='reset')
 *  - Updates User.passwordHash + passwordSalt
 *  - Marks token as used
 *
 * Returns: { ok: true }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      token?: string
      password?: string
    }

    const token = String(body.token || '').trim()
    const password = String(body.password || '')

    if (!token || !password) {
      return NextResponse.json(
        { error: 'กรุณาระบุ token และรหัสผ่านใหม่' },
        { status: 400 },
      )
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' },
        { status: 400 },
      )
    }

    // ── Find + validate token ──────────────────────────────────────
    const row = await db.passwordResetToken.findUnique({ where: { token } })
    if (!row || row.type !== 'reset' || row.used) {
      return NextResponse.json(
        { error: 'ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือถูกใช้แล้ว' },
        { status: 400 },
      )
    }
    if (row.expiresAt.getTime() < Date.now()) {
      return NextResponse.json(
        { error: 'ลิงก์รีเซ็ตรหัสผ่านหมดอายุแล้ว' },
        { status: 400 },
      )
    }

    // ── Find user by email (token.email) ───────────────────────────
    const user = await db.user.findUnique({ where: { email: row.email } })
    if (!user) {
      return NextResponse.json(
        { error: 'ไม่พบบัญชีที่ตรงกับลิงก์นี้' },
        { status: 404 },
      )
    }

    // ── Hash new password + update ─────────────────────────────────
    const { hash, salt } = hashNewPassword(password)
    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hash,
        passwordSalt: salt,
        updatedAt: new Date(),
      },
    })

    // ── Mark token as used ─────────────────────────────────────────
    await db.passwordResetToken.update({
      where: { token },
      data: { used: true },
    })

    // ── Audit log ──────────────────────────────────────────────────
    try {
      await db.auditLog.create({
        data: {
          action: 'PASSWORD_RESET',
          entity: 'User',
          entityId: user.id,
          summary: `รีเซ็ตรหัสผ่านสำเร็จสำหรับ ${user.email}`,
          detail: JSON.stringify({ email: user.email }),
          actor: user.email,
        },
      })
    } catch (err) { console.error('[route]', err) }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('POST /api/auth/reset-password', err)
    return NextResponse.json(
      {
        error: 'Internal server error',
        detail: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : String(err)) : 'Internal server error',
      },
      { status: 500 },
    )
  }
}
