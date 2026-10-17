import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashNewPassword } from '@/lib/auth'
import { sendEmail, sendTelegram } from '@/lib/notifications'
import {
  registerReceivedEmail,
  adminNotifyNewRegistrationText,
  APP_BASE_URL,
} from '@/lib/auth-email-templates'

/**
 * POST /api/auth/register — registration request (Method 1).
 *
 * Body: { name, email, phone?, department?, roleRequest?, password, token? }
 *
 *  - When `token` is provided, it must be a valid 'invite' token (Method 2)
 *    and the email must match. The token will be marked as used.
 *  - Creates a User with `active: false` (pending admin approval).
 *  - Sends a confirmation email to the user ("รอผู้ดูแลอนุมัติ").
 *  - Notifies admins via Telegram ("มีคำขอใช้งานใหม่").
 *
 * Returns: { ok: true, message: "รอผู้ดูแลอนุมัติ" }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: string
      email?: string
      phone?: string
      department?: string
      roleRequest?: string
      password?: string
      token?: string
    }

    const name = String(body.name || '').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const phone = String(body.phone || '').trim() || null
    const department = String(body.department || '').trim() || null
    const roleRequest = String(body.roleRequest || '').trim().toLowerCase() || 'viewer'
    const password = String(body.password || '')
    const token = body.token ? String(body.token).trim() : null

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'กรุณากรอกชื่อ, อีเมล และรหัสผ่าน' },
        { status: 400 },
      )
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' },
        { status: 400 },
      )
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'รูปแบบอีเมลไม่ถูกต้อง' },
        { status: 400 },
      )
    }

    // ── Validate invite token if provided ──────────────────────────
    if (token) {
      const row = await db.passwordResetToken.findUnique({ where: { token } })
      if (!row || row.type !== 'invite' || row.used) {
        return NextResponse.json(
          { error: 'ลิงก์เชิญไม่ถูกต้องหรือถูกใช้แล้ว' },
          { status: 400 },
        )
      }
      if (row.expiresAt.getTime() < Date.now()) {
        return NextResponse.json(
          { error: 'ลิงก์เชิญหมดอายุแล้ว' },
          { status: 400 },
        )
      }
      if (row.email.toLowerCase() !== email) {
        return NextResponse.json(
          { error: 'อีเมลไม่ตรงกับลิงก์เชิญ' },
          { status: 400 },
        )
      }
    }

    // ── Duplicate check ────────────────────────────────────────────
    const existing = await db.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        {
          error:
            'อีเมลนี้มีอยู่ในระบบแล้ว หากลืมรหัสผ่าน กรุณาใช้ลิงก์ "ลืมรหัสผ่าน"',
        },
        { status: 409 },
      )
    }

    // ── Hash password ──────────────────────────────────────────────
    const { hash, salt } = hashNewPassword(password)

    // ── Create user (pending — active=false) ───────────────────────
    // Map roleRequest → valid role
    const ROLE_MAP: Record<string, string> = {
      viewer: 'viewer',
      staff: 'editor',
      coordinator: 'editor',
      manager: 'admin',
      admin: 'admin',
      editor: 'editor',
      meter: 'meter',
      superadmin: 'admin',
    }
    const finalRole = ROLE_MAP[roleRequest] || 'viewer'

    const created = await db.user.create({
      data: {
        email,
        name,
        username: email, // use email as username by default
        phone,
        department,
        role: finalRole,
        active: false, // pending approval
        passwordHash: hash,
        passwordSalt: salt,
        allowedSites: 'ALL',
      },
    })

    // ── Mark invite token as used (if Method 2) ────────────────────
    if (token) {
      await db.passwordResetToken.update({
        where: { token },
        data: { used: true },
      })
    }

    // ── Send confirmation email to user (best-effort) ──────────────
    const userEmail = registerReceivedEmail(name)
    const sentUserEmail = await sendEmail(email, userEmail.subject, userEmail.html)

    // ── Notify admins via Telegram (best-effort) ───────────────────
    const adminMsg = adminNotifyNewRegistrationText({
      name,
      email,
      phone: phone || undefined,
      department: department || undefined,
      roleRequest,
    })
    await sendTelegram(adminMsg).catch(() => undefined)

    // ── Audit log ──────────────────────────────────────────────────
    try {
      await db.auditLog.create({
        data: {
          action: 'REGISTER_REQUEST',
          entity: 'User',
          entityId: created.id,
          summary: `คำขอลงทะเบียนใหม่: ${name} <${email}> (role=${finalRole})`,
          detail: JSON.stringify({
            name,
            email,
            role: finalRole,
            method: token ? 'invite' : 'direct',
          }),
          actor: email,
        },
      })
    } catch (err) { console.error('[route]', err) }

    return NextResponse.json({
      ok: true,
      message: 'รอผู้ดูแลอนุมัติ',
      userId: created.id,
      loginUrl: `${APP_BASE_URL}`,
      emailSent: sentUserEmail,
    })
  } catch (err) {
    console.error('POST /api/auth/register', err)
    return NextResponse.json(
      {
        error: 'Internal server error',
        detail: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : String(err)) : 'Internal server error',
      },
      { status: 500 },
    )
  }
}
