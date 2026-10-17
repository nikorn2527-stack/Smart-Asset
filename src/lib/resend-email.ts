/**
 * resend-email.ts — Email sending via Resend API.
 *
 * Free tier: 3,000 emails/month + 100 emails/day
 *
 * Setup:
 *   1. Set RESEND_API_KEY env var (in Vercel + .env)
 *   2. Optionally set RESEND_FROM_EMAIL (default: onboarding@resend.dev)
 *   3. For custom domain: verify in Resend dashboard, then set RESEND_FROM_EMAIL
 *
 * Usage:
 *   import { sendEmail, sendPasswordResetEmail, sendNotificationEmail } from '@/lib/resend-email'
 *
 *   await sendPasswordResetEmail('user@example.com', 'John', 'https://app.com/reset?token=xxx')
 *   await sendNotificationEmail('admin@org.com', 'WO ใหม่', 'แจ้งซ่อมใหม่ PPIT-001')
 */

import { Resend } from 'resend'

const apiKey = process.env.RESEND_API_KEY
const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'

let client: Resend | null = null

function getClient(): Resend | null {
  if (!apiKey) {
    console.warn('[resend] RESEND_API_KEY not set — email sending disabled')
    return null
  }
  if (!client) {
    client = new Resend(apiKey)
  }
  return client
}

export function isEmailConfigured(): boolean {
  return !!apiKey
}

interface SendEmailOptions {
  to: string | string[]
  subject: string
  /** HTML body. At least one of `html` / `text` must be provided. */
  html?: string
  text?: string
  replyTo?: string
}

/**
 * Send an email via Resend.
 * Returns { ok: boolean, id?: string, error?: string }
 */
export async function sendEmail(
  options: SendEmailOptions,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const c = getClient()
  if (!c) {
    return { ok: false, error: 'Email not configured (RESEND_API_KEY not set)' }
  }

  const { to, subject, html, text, replyTo } = options
  const base = {
    from: fromEmail,
    to,
    subject,
    // NOTE: the SDK option is `replyTo` (camelCase). The previous `reply_to`
    // was silently dropped by the SDK, so replies were never threaded back.
    replyTo,
  }

  // Resend's CreateEmailOptions is a union that requires exactly ONE body:
  // `template`, `react`, `html` or `text`. Branching here makes the variant we
  // send unambiguous at compile time, and rejects a bodyless send up front
  // instead of letting the SDK fail on it at runtime.
  let payload: Parameters<typeof c.emails.send>[0]
  if (html) {
    payload = { ...base, html, ...(text !== undefined ? { text } : {}) }
  } else if (text) {
    payload = { ...base, text }
  } else {
    return { ok: false, error: 'Email body is required (html หรือ text)' }
  }

  try {
    const { data, error } = await c.emails.send(payload)

    if (error) {
      console.error('[resend] Send failed:', error.message)
      return { ok: false, error: error.message }
    }

    return { ok: true, id: data?.id }
  } catch (err) {
    console.error('[resend] Error:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/**
 * Send password reset email.
 */
export async function sendPasswordResetEmail(
  to: string,
  name: string,
  resetUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #f97316;">ระบบจัดการสินทรัพย์ IT</h2>
      <p>สวัสดี ${name},</p>
      <p>คุณได้รับอีเมลนี้เนื่องจากมีการขอรีเซ็ตรหัสผ่าน</p>
      <p>คลิกปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่:</p>
      <p style="margin: 20px 0;">
        <a href="${resetUrl}" style="display: inline-block; background: #f97316; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          ตั้งรหัสผ่านใหม่
        </a>
      </p>
      <p style="font-size: 12px; color: #64748b;">
        ลิงก์นี้จะหมดอายุใน 1 ชั่วโมง<br/>
        หากคุณไม่ได้ขอรีเซ็ตรหัสผ่าน โปรดเพิกเฉยอีเมลนี้
      </p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      <p style="font-size: 12px; color: #94a3b8;">
        IT Asset Management — Powered by PNG TEAM
      </p>
    </div>
  `

  return sendEmail({
    to,
    subject: 'รีเซ็ตรหัสผ่าน — IT Asset Management',
    html,
  })
}

/**
 * Send notification email (e.g. new WO created, low stock alert).
 */
export async function sendNotificationEmail(
  to: string,
  subject: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #f97316;">IT Asset Management</h2>
      <p>${message}</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      <p style="font-size: 12px; color: #94a3b8;">
        Powered by PNG TEAM
      </p>
    </div>
  `

  return sendEmail({
    to,
    subject,
    html,
  })
}

/**
 * Send registration confirmation email.
 */
export async function sendRegistrationEmail(
  to: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #f97316;">ยินดีต้อนรับสู่ระบบจัดการสินทรัพย์ IT</h2>
      <p>สวัสดี ${name},</p>
      <p>บัญชีของคุณได้รับการสร้างแล้ว และกำลังรอการอนุมัติจากผู้ดูแลระบบ</p>
      <p>เมื่อผู้ดูแลอนุมัติแล้ว คุณจะสามารถเข้าสู่ระบบได้</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      <p style="font-size: 12px; color: #94a3b8;">
        Powered by PNG TEAM
      </p>
    </div>
  `

  return sendEmail({
    to,
    subject: 'ยินดีต้อนรับ — รอการอนุมัติ — IT Asset Management',
    html,
  })
}
