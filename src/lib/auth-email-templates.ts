/**
 * auth-email-templates.ts — HTML email templates for the registration +
 * password reset flows. All copy is Thai. Templates are kept simple,
 * self-contained (no external CSS) so they render in any mail client.
 */

export const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  'https://itam-next-js-png-team.vercel.app'

function emailShell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0f172a;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;padding:24px 0;">
      <tr>
        <td align="center">
          <table width="560" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.06);">
            <tr>
              <td style="background:linear-gradient(135deg,#f97316,#c2410c);padding:20px 24px;color:#ffffff;">
                <div style="font-size:18px;font-weight:700;">📦 ITAM — ระบบจัดการสินทรัพย์ไอที</div>
                <div style="font-size:12px;opacity:0.85;margin-top:2px;">IT Asset Management</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#0f172a;">${title}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;background:#f1f5f9;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
                อีเมลนี้ส่งโดยระบบอัตโนมัติ — กรุณาอย่าตอบกลับ<br />
                หากคุณไม่ได้เป็นผู้ร้องขอ กรุณาเพิกเฉยอีเมลนี้
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

/** 1. Registration received — awaiting admin approval. */
export function registerReceivedEmail(name: string): {
  subject: string
  html: string
} {
  const subject = 'คำขอขอใช้งานระบบ ITAM ได้รับแล้ว รอผู้ดูแลอนุมัติ'
  const body = `
    <p style="margin:0 0 12px;line-height:1.6;color:#334155;">สวัสดี <strong>${name}</strong>,</p>
    <p style="margin:0 0 12px;line-height:1.6;color:#334155;">
      ทางเราได้รับคำขอขอใช้งานระบบจัดการสินทรัพย์ไอที (ITAM) ของท่านเรียบร้อยแล้ว
      ขณะนี้คำขอของท่านอยู่ระหว่างการพิจารณาโดยผู้ดูแลระบบ
      ท่านจะได้รับอีเมลแจ้งอีกครั้งเมื่อบัญชีของท่านได้รับการอนุมัติ
    </p>
    <p style="margin:0;line-height:1.6;color:#334155;">ขอบคุณครับ/ค่ะ</p>`
  return { subject, html: emailShell(subject, body) }
}

/** 2. Invite link — admin invites a new user via email. */
export function inviteLinkEmail(url: string): { subject: string; html: string } {
  const subject = 'คุณได้รับเชิญให้ลงทะเบียนใช้งานระบบ ITAM'
  const body = `
    <p style="margin:0 0 12px;line-height:1.6;color:#334155;">สวัสดีครับ/ค่ะ,</p>
    <p style="margin:0 0 12px;line-height:1.6;color:#334155;">
      ท่านได้รับเชิญให้ลงทะเบียนใช้งานระบบจัดการสินทรัพย์ไอที (ITAM)
      กรุณาคลิกลิงก์ด้านล่างเพื่อกรอกข้อมูลและตั้งรหัสผ่าน
    </p>
    <p style="margin:16px 0;">
      <a href="${url}" style="display:inline-block;background:#f97316;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
        ลงทะเบียนใช้งาน
      </a>
    </p>
    <p style="margin:0 0 8px;line-height:1.6;color:#334155;">
      หรือคัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์:
    </p>
    <p style="margin:0 0 12px;word-break:break-all;">
      <code style="background:#f1f5f9;padding:8px 12px;border-radius:6px;font-size:13px;color:#0f172a;">${url}</code>
    </p>
    <p style="margin:0;line-height:1.6;color:#64748b;font-size:13px;">
      ⏱ ลิงก์นี้จะหมดอายุใน 24 ชั่วโมง
    </p>`
  return { subject, html: emailShell(subject, body) }
}

/** 3. Password reset link. */
export function passwordResetEmail(url: string): {
  subject: string
  html: string
} {
  const subject = 'รีเซ็ตรหัสผ่าน — ระบบจัดการสินทรัพย์ ITAM'
  const body = `
    <p style="margin:0 0 12px;line-height:1.6;color:#334155;">สวัสดีครับ/ค่ะ,</p>
    <p style="margin:0 0 12px;line-height:1.6;color:#334155;">
      ท่าน (หรือผู้อื่นที่อ้างอีเมลนี้) ได้ร้องขอการรีเซ็ตรหัสผ่านสำหรับบัญชี ITAM ของท่าน
      กรุณาคลิกลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่
    </p>
    <p style="margin:16px 0;">
      <a href="${url}" style="display:inline-block;background:#f97316;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
        รีเซ็ตรหัสผ่าน
      </a>
    </p>
    <p style="margin:0 0 8px;line-height:1.6;color:#334155;">
      หรือคัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์:
    </p>
    <p style="margin:0 0 12px;word-break:break-all;">
      <code style="background:#f1f5f9;padding:8px 12px;border-radius:6px;font-size:13px;color:#0f172a;">${url}</code>
    </p>
    <p style="margin:0;line-height:1.6;color:#64748b;font-size:13px;">
      ⏱ ลิงก์นี้จะหมดอายุใน 1 ชั่วโมง — หากท่านไม่ได้เป็นผู้ร้องขอ กรุณาเพิกเฉยอีเมลนี้
    </p>`
  return { subject, html: emailShell(subject, body) }
}

/** 4. Account approved — user can now log in. */
export function accountApprovedEmail(
  name: string,
  loginUrl: string,
): { subject: string; html: string } {
  const subject = 'บัญชีของคุณได้รับการอนุมัติแล้ว — ระบบจัดการสินทรัพย์ ITAM'
  const body = `
    <p style="margin:0 0 12px;line-height:1.6;color:#334155;">สวัสดี <strong>${name}</strong>,</p>
    <p style="margin:0 0 12px;line-height:1.6;color:#334155;">
      บัญชีของท่านได้รับการอนุมัติจากผู้ดูแลระบบเรียบร้อยแล้ว
      ขณะนี้ท่านสามารถเข้าสู่ระบบจัดการสินทรัพย์ไอที (ITAM) ได้ทันที
    </p>
    <p style="margin:16px 0;">
      <a href="${loginUrl}" style="display:inline-block;background:#f97316;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
        เข้าสู่ระบบ
      </a>
    </p>
    <p style="margin:0;line-height:1.6;color:#334155;">ขอบคุณครับ/ค่ะ</p>`
  return { subject, html: emailShell(subject, body) }
}

/** 5. New registration request — notification to admin (Telegram/email). */
export function adminNotifyNewRegistrationText(opts: {
  name: string
  email: string
  phone?: string
  department?: string
  roleRequest?: string
}): string {
  const lines = [
    '🔔 มีคำขอใช้งานระบบ ITAM ใหม่',
    `ชื่อ: ${opts.name}`,
    `อีเมล: ${opts.email}`,
  ]
  if (opts.phone) lines.push(`เบอร์: ${opts.phone}`)
  if (opts.department) lines.push(`แผนก: ${opts.department}`)
  if (opts.roleRequest) lines.push(`สิทธิ์ที่ขอ: ${opts.roleRequest}`)
  lines.push('— กรุณาเข้าระบบเพื่ออนุมัติ/ปฏิเสธ')
  return lines.join('\n')
}
