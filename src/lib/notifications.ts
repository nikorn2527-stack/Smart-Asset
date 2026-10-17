/**
 * Notification System — ระบบส่งการแจ้งเตือน 3 ช่องทาง
 *
 * ช่องทาง (channel):
 *   - line-oa   → ส่งผ่าน LINE Official Account (Push/Reply)
 *   - telegram  → ส่งผ่าน Telegram Bot
 *   - email     → ส่งผ่าน SMTP/API
 *
 * Template:
 *   เป็นรายการข้อความภาษาไทยสำเร็จรูป สำหรับเหตุการณ์ต่าง ๆ ในระบบ (แจ้งซ่อม,
 *   มอบหมาย, ปิดงาน, คำขอเบิกอะไหล่, สต็อกต่ำ ฯลฯ)
 *
 * การใช้งาน:
 *   import { sendNotification, renderTemplate } from '@/lib/notifications'
 *
 *   await sendNotification({
 *     template: 'wo_created',
 *     channels: ['line-oa', 'telegram'],
 *     data: { woNumber, subject, building, location, reporterName, tel, priority },
 *     lineUserId,
 *   })
 *
 * หมายเหตุ:
 *   - ตอนนี้ระบบจะ log ข้อความแทนการส่งจริง (console.log + AuditLog)
 *     สามารถเปิดการส่งจริงได้ภายหลังโดยตั้งค่า API keys ใน AppSetting
 *   - API keys ที่ต้องใช้ (เก็บในตาราง AppSetting):
 *       line_channel_access_token  → LINE Messaging API token
 *       line_channel_secret        → LINE channel secret (ใช้ตรวจ signature)
 *       line_admin_group_id        → LINE group/room ID สำหรับส่งแจ้งเตือนแอดมิน
 *       telegram_bot_token         → Telegram Bot API token
 *       telegram_chat_id           → Telegram chat ID เริ่มต้น (แอดมิน)
 *       smtp_host / smtp_port / smtp_user / smtp_pass
 *       email_from                 → อีเมลผู้ส่งเริ่มต้น
 */

import { db } from '@/lib/db'
import {
  createPendingLog,
  markSent,
  markFailed,
  markSkipped,
} from '@/lib/notification-log'
import { maybeDecrypt } from '@/lib/secret-crypto'

// ============================================================
// Types
// ============================================================

export type NotificationChannel = 'line-oa' | 'telegram' | 'email'

export type NotificationTemplate =
  | 'wo_created' // แจ้งซ่อมใหม่
  | 'wo_assigned' // มอบหมายงาน
  | 'wo_completed' // ปิดงานแล้ว
  | 'wo_cancelled' // ยกเลิกงาน
  | 'wo_message' // ข้อความใหม่ในใบงาน
  | 'parts_requested' // มีคำขอเบิกอะไหล่
  | 'parts_approved' // อนุมัติเบิกอะไหล่แล้ว
  | 'stock_low' // สต็อกต่ำ
  | 'stock_out' // สต็อกหมด
  | 'meter_reminder' // แจ้งเตือนจดมิเตอร์
  | 'device_added' // เพิ่มอุปกรณ์
  | 'device_updated' // แก้ไขอุปกรณ์
  | 'transfer' // ย้ายตำแหน่งอุปกรณ์
  | 'meter' // จดมิเตอร์
  | 'custom' // ข้อความกำหนดเอง

export interface NotificationData {
  template: NotificationTemplate
  channels: NotificationChannel[]
  /** Context data for template rendering */
  data: Record<string, unknown>
  /** LINE: lineUserId (optional, if known from WorkOrder reporter) */
  lineUserId?: string
  /** Telegram: chatId */
  telegramChatId?: string
  /** Email: address */
  email?: string
  /** Actor (for audit log). Default 'system' */
  actor?: string
  /** Optional entity reference for audit log */
  entityId?: string
  /** Optional entity type for audit log */
  entity?: string
}

export interface RenderedMessage {
  title: string
  body: string
}

export interface NotifyChannelConfig {
  email: boolean
  telegram: boolean
  lineNotify: boolean
  lineOA: boolean
}

export interface NotifyEventConfig {
  deviceAdded: boolean
  deviceUpdated: boolean
  transfer: boolean
  lifecycle: boolean
  meter: boolean
}

const DEFAULT_NOTIFY_CHANNELS: NotifyChannelConfig = {
  email: false,
  telegram: true,
  lineNotify: false,
  lineOA: true,
}

const DEFAULT_NOTIFY_EVENTS: NotifyEventConfig = {
  deviceAdded: true,
  deviceUpdated: true,
  transfer: true,
  lifecycle: true,
  meter: true,
}

// ============================================================
// Settings loader (AppSetting-backed)
// ============================================================

interface NotifySettings {
  lineChannelAccessToken?: string
  lineChannelSecret?: string
  lineAdminGroupId?: string
  telegramBotToken?: string
  telegramChatId?: string
  smtpHost?: string
  smtpPort?: string
  smtpUser?: string
  smtpPass?: string
  emailFrom?: string
  /** Master switch — when false, log only */
  notifyEnabled?: boolean
}

async function loadSettings(): Promise<NotifySettings> {
  try {
    const rows = await db.appSetting.findMany()
    // SPRINT-1 #5 (FIX-019): decrypt secret-pattern values at rest.
    // Non-secret values pass through maybeDecrypt() unchanged (no `enc:` prefix).
    const get = (key: string) => {
      const raw = rows.find((r) => r.key === key)?.value || undefined
      return raw ? maybeDecrypt(raw) : undefined
    }
    return {
      lineChannelAccessToken: get('line_channel_access_token'),
      lineChannelSecret: get('line_channel_secret'),
      lineAdminGroupId: get('line_admin_group_id'),
      telegramBotToken: get('telegram_bot_token'),
      telegramChatId: get('telegram_chat_id'),
      smtpHost: get('smtp_host'),
      smtpPort: get('smtp_port'),
      smtpUser: get('smtp_user'),
      smtpPass: get('smtp_pass'),
      emailFrom: get('email_from'),
      notifyEnabled: get('notify_enabled') !== 'false',
    }
  } catch (err) {
    console.error('[notifications] loadSettings failed:', err)
    return {}
  }
}

// ============================================================
// Template rendering — Thai messages with variable interpolation
// ============================================================

/**
 * Replace {var} placeholders with values from data.
 * Missing values resolve to '—' so the message is still readable.
 */
function interpolate(tpl: string, data: Record<string, unknown>): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = data[key]
    if (v === undefined || v === null || v === '') return '—'
    return String(v)
  })
}

const TEMPLATES: Record<NotificationTemplate, { title: string; body: string }> = {
  wo_created: {
    title: 'แจ้งซ่อมใหม่',
    body: '🔧 แจ้งซ่อมใหม่ {woNumber}\nหัวข้อ: {subject}\nสถานที่: {building} {location}\nผู้แจ้ง: {reporterName}\nเบอร์: {tel}\nความเร่งด่วน: {priority}',
  },
  wo_assigned: {
    title: 'มอบหมายงาน',
    body: '📋 มอบหมายงาน {woNumber}\nมอบหมายให้: {assignedTo}\nหัวข้อ: {subject}',
  },
  wo_completed: {
    title: 'ปิดงานแล้ว',
    body: '✅ ปิดงานแล้ว {woNumber}\nหัวข้อ: {subject}\nผลการแก้ไข: {resolution}\nหมายเหตุ: {detailsAdmin}',
  },
  wo_cancelled: {
    title: 'ยกเลิกงาน',
    body: '❌ ยกเลิกงาน {woNumber}\nเหตุผล: {cancelReason}',
  },
  wo_message: {
    title: 'ข้อความใหม่ในใบงาน',
    body: '💬 ข้อความใหม่ในใบงาน {woNumber}\nจาก: {author}\nข้อความ: {message}',
  },
  parts_requested: {
    title: 'มีคำขอเบิกอะไหล่',
    body: '📦 มีคำขอเบิกอะไหล่\nใบงาน: {woNumber}\nสินค้า: {productName} × {quantity}\nรออนุมัติ',
  },
  parts_approved: {
    title: 'อนุมัติเบิกอะไหล่แล้ว',
    body: '✅ อนุมัติเบิกอะไหล่แล้ว\nสินค้า: {productName} × {quantity}\nคงเหลือ: {balanceAfter}',
  },
  stock_low: {
    title: 'สต็อกต่ำ',
    body: '⚠️ สต็อกต่ำ\nสินค้า: {productName} ({productCode})\nคงเหลือ: {quantity} {unit}\nจุดสั่งซื้อ: {minQuantity}',
  },
  stock_out: {
    title: 'สต็อกหมด',
    body: '🔴 สต็อกหมด\nสินค้า: {productName} ({productCode})',
  },
  meter_reminder: {
    title: 'แจ้งเตือนจดมิเตอร์',
    body: '📈 แจ้งเตือนจดมิเตอร์\nยังไม่ได้จด: {deviceName} ({assetCode})\nรอบ: {cycleName}',
  },
  device_added: {
    title: 'เพิ่มอุปกรณ์ใหม่',
    body: 'เพิ่มอุปกรณ์ {assetCode}\nประเภท: {deviceType}\nยี่ห้อ/รุ่น: {brand} {model}',
  },
  device_updated: {
    title: 'แก้ไขข้อมูลอุปกรณ์',
    body: 'แก้ไขอุปกรณ์ {assetCode}\nฟิลด์ที่เปลี่ยน: {changedFields}',
  },
  transfer: {
    title: 'ย้ายตำแหน่งอุปกรณ์',
    body: 'ย้ายอุปกรณ์ {assetCode}\nจาก: {fromSite}\nไปยัง: {toSite}\nผู้ดำเนินการ: {by}',
  },
  meter: {
    title: 'บันทึกมิเตอร์',
    body: 'บันทึกมิเตอร์อุปกรณ์ {assetCode}\nขาวดำ: {pagesBw} หน้า\nสี: {pagesColor} หน้า\nผู้บันทึก: {by}',
  },
  custom: {
    title: '{title}',
    body: '{message}',
  },
}

/**
 * Render a Thai message for the given template + data.
 */
export function renderTemplate(
  template: NotificationTemplate,
  data: Record<string, unknown>,
): RenderedMessage {
  const tpl = TEMPLATES[template]
  if (!tpl) {
    return {
      title: 'การแจ้งเตือน',
      body: `ไม่พบ template: ${template}`,
    }
  }
  return {
    title: tpl.title,
    body: interpolate(tpl.body, data),
  }
}

// ============================================================
// Audit helper — records every notification send (non-fatal)
// ============================================================

async function logNotificationAudit(
  channel: NotificationChannel,
  template: NotificationTemplate,
  rendered: RenderedMessage,
  target: { lineUserId?: string; telegramChatId?: string; email?: string },
  actor: string,
  entityId?: string,
  entity?: string,
  error?: string,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action: 'NOTIFY_SENT',
        entity: entity ?? 'Notification',
        entityId: entityId ?? null,
        summary: `[${channel}] ${rendered.title} — ${rendered.body
          .split('\n')[0]
          .slice(0, 80)}`,
        detail: JSON.stringify({
          channel,
          template,
          title: rendered.title,
          body: rendered.body,
          target,
          error: error ?? null,
        }),
        actor,
      },
    })
  } catch (err) {
    console.error('[notifications] audit log failed:', err)
  }
}

// ============================================================
// Channel senders
// ============================================================

/**
 * Send a LINE message via Push API.
 * - If `lineUserId` is provided → Push to that user.
 * - Otherwise → Push to the admin group/room configured in AppSetting.
 *
 * NOTE: For now this just logs (no API keys configured). When keys are
 * configured in AppSetting, real sending will be attempted.
 *
 * Returns true if delivered, false if failed/skipped.
 */
export async function sendLINE(
  message: string,
  lineUserId?: string,
): Promise<boolean> {
  const settings = await loadSettings()
  const target = lineUserId ?? settings.lineAdminGroupId
  if (!target) {
    console.warn(
      '[notifications][line-oa] no target (lineUserId or line_admin_group_id) — log only',
    )
    console.log('[notifications][line-oa] message:\n' + message)
    return false
  }

  if (!settings.lineChannelAccessToken || !settings.notifyEnabled) {
    console.log(
      `[notifications][line-oa] (log only) → ${target}\n${message}`,
    )
    return false
  }

  // ── Real LINE Push API call ──
  // When API keys are configured, perform the actual HTTP request.
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.lineChannelAccessToken}`,
      },
      body: JSON.stringify({
        to: target,
        messages: [{ type: 'text', text: message }],
      }),
    })
    if (!res.ok) {
      const txt = await res.text()
      console.error(
        `[notifications][line-oa] LINE API error ${res.status}: ${txt}`,
      )
      return false
    }
    return true
  } catch (err) {
    console.error('[notifications][line-oa] send failed:', err)
    return false
  }
}

/**
 * Send a Telegram message via Bot API.
 * - If `chatId` is provided → send to that chat.
 * - Otherwise → send to the default admin chat from AppSetting.
 *
 * Returns true if delivered, false if failed/skipped.
 */
export async function sendTelegram(
  message: string,
  chatId?: string,
): Promise<boolean> {
  const settings = await loadSettings()
  const target = chatId ?? settings.telegramChatId
  if (!target) {
    console.warn(
      '[notifications][telegram] no chatId (telegram_chat_id) — log only',
    )
    console.log('[notifications][telegram] message:\n' + message)
    return false
  }

  if (!settings.telegramBotToken || !settings.notifyEnabled) {
    console.log(
      `[notifications][telegram] (log only) → ${target}\n${message}`,
    )
    return false
  }

  // ── Real Telegram Bot API call ──
  try {
    const url = `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: target,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })
    if (!res.ok) {
      const txt = await res.text()
      console.error(
        `[notifications][telegram] API error ${res.status}: ${txt}`,
      )
      return false
    }
    return true
  } catch (err) {
    console.error('[notifications][telegram] send failed:', err)
    return false
  }
}

/**
 * Send an email. For now this just logs; when SMTP settings are
 * configured it would perform a real send (e.g. via nodemailer).
 *
 * Returns true if delivered, false if failed/skipped.
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  const settings = await loadSettings()
  if (!settings.smtpHost || !settings.notifyEnabled) {
    console.log(
      `[notifications][email] (log only) → ${to}\nSubject: ${subject}\n${body}`,
    )
    return false
  }

  // ── Real SMTP send would go here ──
  // (Implementation deferred — requires a nodemailer dependency.)
  console.log(
    `[notifications][email] SMTP configured but not implemented → ${to}\nSubject: ${subject}\n${body}`,
  )
  return false
}

// ============================================================
// Top-level orchestrator
// ============================================================

/**
 * Send a notification to all specified channels.
 * Renders the template, then dispatches to each channel in parallel.
 *
 * Bug B fix: every send is now recorded in NotificationLog with status
 * PENDING → SENT/FAILED/SKIPPED. Failed sends can be retried by the
 * notification-retry cron. The existing AuditLog entry is preserved
 * for backwards compatibility (NOTIFY_SENT action).
 */
export async function sendNotification(data: NotificationData): Promise<void> {
  const { template, channels, data: ctx, lineUserId, telegramChatId, email } =
    data

  if (!channels.length) {
    console.warn('[notifications] no channels specified — skipping')
    return
  }

  const rendered = renderTemplate(template, ctx)
  const actor = data.actor ?? 'system'

  // Build the combined message (title + body) for channel senders
  const fullMessage = `${rendered.title}\n${rendered.body}`

  await Promise.all(
    channels.map(async (channel) => {
      // Determine the target identifier for this channel
      let target: string | undefined
      switch (channel) {
        case 'line-oa':
          target = lineUserId
          break
        case 'telegram':
          target = telegramChatId
          break
        case 'email':
          target = email
          break
      }

      // Bug B: create a PENDING log entry before attempting to send
      const logId = await createPendingLog({
        channel,
        template,
        title: rendered.title,
        body: rendered.body,
        target: target ?? null,
        entityId: data.entityId,
        entity: data.entity,
        actor,
      })

      try {
        let ok = false
        switch (channel) {
          case 'line-oa':
            ok = await sendLINE(fullMessage, lineUserId)
            break
          case 'telegram':
            ok = await sendTelegram(fullMessage, telegramChatId)
            break
          case 'email':
            if (!email) {
              console.warn(
                '[notifications][email] no email address — skipping',
              )
              await markSkipped(logId, 'no email address provided')
            } else {
              ok = await sendEmail(email, rendered.title, rendered.body)
            }
            break
        }

        // Bug B: update the log entry based on the send result
        if (ok) {
          await markSent(logId)
        } else {
          // The senders return false both for "skipped" (no target/token)
          // and for "failed". Distinguish by checking settings.
          await markFailed(logId, 'send returned false (see console logs)')
        }

        await logNotificationAudit(
          channel,
          template,
          rendered,
          { lineUserId, telegramChatId, email },
          actor,
          data.entityId,
          data.entity,
        )
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`[notifications][${channel}] dispatch failed:`, err)
        await markFailed(logId, errMsg)
        await logNotificationAudit(
          channel,
          template,
          rendered,
          { lineUserId, telegramChatId, email },
          actor,
          data.entityId,
          data.entity,
          errMsg,
        )
      }
    }),
  )
}

// ============================================================
// Convenience helpers — for common workflows
// ============================================================

/**
 * Notify on new work order creation.
 * Sends to LINE admin group + Telegram admin chat by default.
 */
export async function notifyWorkOrderCreated(
  wo: {
    id: string
    woNumber?: string | null
    subject: string
    building?: string | null
    location?: string | null
    reporterName?: string | null
    tel?: string | null
    priority: string
    lineUserId?: string | null
    reporterEmail?: string | null
  },
  opts: { channels?: NotificationChannel[]; actor?: string } = {},
): Promise<void> {
  await sendNotification({
    template: 'wo_created',
    channels: opts.channels ?? ['line-oa', 'telegram'],
    data: {
      woNumber: wo.woNumber ?? '—',
      subject: wo.subject,
      building: wo.building ?? '',
      location: wo.location ?? '',
      reporterName: wo.reporterName ?? '—',
      tel: wo.tel ?? '—',
      priority: wo.priority,
    },
    lineUserId: wo.lineUserId ?? undefined,
    email: wo.reporterEmail ?? undefined,
    actor: opts.actor,
    entityId: wo.id,
    entity: 'WorkOrder',
  })
}

/**
 * Notify the assigned technician of a new assignment.
 */
export async function notifyWorkOrderAssigned(
  wo: {
    id: string
    woNumber?: string | null
    subject: string
    assignedTo?: string | null
    lineUserId?: string | null
    reporterEmail?: string | null
  },
  opts: { channels?: NotificationChannel[]; actor?: string } = {},
): Promise<void> {
  await sendNotification({
    template: 'wo_assigned',
    channels: opts.channels ?? ['line-oa', 'telegram'],
    data: {
      woNumber: wo.woNumber ?? '—',
      assignedTo: wo.assignedTo ?? '—',
      subject: wo.subject,
    },
    lineUserId: wo.lineUserId ?? undefined,
    email: wo.reporterEmail ?? undefined,
    actor: opts.actor,
    entityId: wo.id,
    entity: 'WorkOrder',
  })
}

/**
 * Notify the reporter that their work order is completed.
 * Prefers LINE if the reporter's lineUserId is known.
 */
export async function notifyWorkOrderCompleted(
  wo: {
    id: string
    woNumber?: string | null
    subject: string
    resolution?: string | null
    detailsAdmin?: string | null
    lineUserId?: string | null
    reporterEmail?: string | null
  },
  opts: { channels?: NotificationChannel[]; actor?: string } = {},
): Promise<void> {
  await sendNotification({
    template: 'wo_completed',
    channels: opts.channels ?? (wo.lineUserId ? ['line-oa'] : ['line-oa']),
    data: {
      woNumber: wo.woNumber ?? '—',
      subject: wo.subject,
      resolution: wo.resolution ?? '—',
      detailsAdmin: wo.detailsAdmin ?? '—',
    },
    lineUserId: wo.lineUserId ?? undefined,
    email: wo.reporterEmail ?? undefined,
    actor: opts.actor,
    entityId: wo.id,
    entity: 'WorkOrder',
  })
}

/**
 * Notify that a work order has been cancelled.
 */
export async function notifyWorkOrderCancelled(
  wo: {
    id: string
    woNumber?: string | null
    cancelReason?: string | null
    lineUserId?: string | null
    reporterEmail?: string | null
  },
  opts: { channels?: NotificationChannel[]; actor?: string } = {},
): Promise<void> {
  await sendNotification({
    template: 'wo_cancelled',
    channels: opts.channels ?? ['line-oa', 'telegram'],
    data: {
      woNumber: wo.woNumber ?? '—',
      cancelReason: wo.cancelReason ?? '—',
    },
    lineUserId: wo.lineUserId ?? undefined,
    email: wo.reporterEmail ?? undefined,
    actor: opts.actor,
    entityId: wo.id,
    entity: 'WorkOrder',
  })
}

/**
 * Notify the other party of a new chat message in a work order.
 */
export async function notifyWorkOrderMessage(
  wo: {
    id: string
    woNumber?: string | null
    author?: string | null
    message: string
    lineUserId?: string | null
    reporterEmail?: string | null
  },
  opts: { channels?: NotificationChannel[]; actor?: string } = {},
): Promise<void> {
  await sendNotification({
    template: 'wo_message',
    channels: opts.channels ?? ['line-oa', 'telegram'],
    data: {
      woNumber: wo.woNumber ?? '—',
      author: wo.author ?? '—',
      message: wo.message,
    },
    lineUserId: wo.lineUserId ?? undefined,
    email: wo.reporterEmail ?? undefined,
    actor: opts.actor,
    entityId: wo.id,
    entity: 'WorkOrder',
  })
}

/**
 * Notify the stock admin of a new parts request.
 */
export async function notifyPartsRequested(
  wo: {
    id: string
    woNumber?: string | null
    lineUserId?: string | null
    reporterEmail?: string | null
  },
  item: { productName: string; quantity: number },
  opts: { channels?: NotificationChannel[]; actor?: string } = {},
): Promise<void> {
  await sendNotification({
    template: 'parts_requested',
    channels: opts.channels ?? ['line-oa', 'telegram'],
    data: {
      woNumber: wo.woNumber ?? '—',
      productName: item.productName,
      quantity: item.quantity,
    },
    lineUserId: wo.lineUserId ?? undefined,
    email: wo.reporterEmail ?? undefined,
    actor: opts.actor,
    entityId: wo.id,
    entity: 'WorkOrder',
  })
}

/**
 * Notify the WO assignee that a parts request has been approved.
 */
export async function notifyPartsApproved(
  item: {
    productName: string
    quantity: number
    balanceAfter: number
  },
  opts: {
    channels?: NotificationChannel[]
    actor?: string
    lineUserId?: string
    telegramChatId?: string
    entityId?: string
  } = {},
): Promise<void> {
  await sendNotification({
    template: 'parts_approved',
    channels: opts.channels ?? ['line-oa', 'telegram'],
    data: {
      productName: item.productName,
      quantity: item.quantity,
      balanceAfter: item.balanceAfter,
    },
    lineUserId: opts.lineUserId,
    telegramChatId: opts.telegramChatId,
    actor: opts.actor,
    entityId: opts.entityId,
    entity: 'WorkOrder',
  })
}

/**
 * Notify that a stock item has dropped to/below its reorder point.
 */
export async function notifyStockLow(
  item: {
    id: string
    productCode: string
    productName: string
    quantity: number
    unit: string
    minQuantity: number
  },
  opts: { channels?: NotificationChannel[]; actor?: string } = {},
): Promise<void> {
  await sendNotification({
    template: 'stock_low',
    channels: opts.channels ?? ['line-oa', 'telegram'],
    data: {
      productName: item.productName,
      productCode: item.productCode,
      quantity: item.quantity,
      unit: item.unit,
      minQuantity: item.minQuantity,
    },
    actor: opts.actor,
    entityId: item.id,
    entity: 'StockItem',
  })
}

/**
 * Notify that a stock item has run out.
 */
export async function notifyStockOut(
  item: {
    id: string
    productCode: string
    productName: string
  },
  opts: { channels?: NotificationChannel[]; actor?: string } = {},
): Promise<void> {
  await sendNotification({
    template: 'stock_out',
    channels: opts.channels ?? ['line-oa', 'telegram'],
    data: {
      productName: item.productName,
      productCode: item.productCode,
    },
    actor: opts.actor,
    entityId: item.id,
    entity: 'StockItem',
  })
}

/**
 * Notify that a device meter has not been read in the current cycle.
 */
export async function notifyMeterReminder(
  ctx: {
    deviceId: string
    deviceName: string
    assetCode: string
    cycleName: string
  },
  opts: { channels?: NotificationChannel[]; actor?: string } = {},
): Promise<void> {
  await sendNotification({
    template: 'meter_reminder',
    channels: opts.channels ?? ['line-oa', 'telegram'],
    data: {
      deviceName: ctx.deviceName,
      assetCode: ctx.assetCode,
      cycleName: ctx.cycleName,
    },
    actor: opts.actor,
    entityId: ctx.deviceId,
    entity: 'Device',
  })
}

// ============================================================
// ITAM compatibility helpers and persisted notification settings
// ============================================================

const CHANNEL_KEYS = {
  email: 'notify_channel_email',
  telegram: 'notify_channel_telegram',
  lineNotify: 'notify_channel_line_notify',
  lineOA: 'notify_channel_line_oa',
} as const

const EVENT_KEYS = {
  deviceAdded: 'notify_event_device_added',
  deviceUpdated: 'notify_event_device_updated',
  transfer: 'notify_event_transfer',
  lifecycle: 'notify_event_lifecycle',
  meter: 'notify_event_meter',
} as const

async function readBooleanSetting(key: string, fallback: boolean): Promise<boolean> {
  const row = await db.appSetting.findUnique({ where: { key } })
  if (row?.value == null) return fallback
  return row.value !== 'false'
}

async function writeBooleanSetting(key: string, value: boolean): Promise<void> {
  await db.appSetting.upsert({
    where: { key },
    create: { key, value: String(value) },
    update: { value: String(value) },
  })
}

export async function getNotifyChannels(): Promise<NotifyChannelConfig> {
  const [email, telegram, lineNotify, lineOA] = await Promise.all([
    readBooleanSetting(CHANNEL_KEYS.email, DEFAULT_NOTIFY_CHANNELS.email),
    readBooleanSetting(CHANNEL_KEYS.telegram, DEFAULT_NOTIFY_CHANNELS.telegram),
    readBooleanSetting(CHANNEL_KEYS.lineNotify, DEFAULT_NOTIFY_CHANNELS.lineNotify),
    readBooleanSetting(CHANNEL_KEYS.lineOA, DEFAULT_NOTIFY_CHANNELS.lineOA),
  ])
  return { email, telegram, lineNotify, lineOA }
}

export async function saveNotifyChannels(config: NotifyChannelConfig): Promise<void> {
  await Promise.all([
    writeBooleanSetting(CHANNEL_KEYS.email, Boolean(config.email)),
    writeBooleanSetting(CHANNEL_KEYS.telegram, Boolean(config.telegram)),
    writeBooleanSetting(CHANNEL_KEYS.lineNotify, Boolean(config.lineNotify)),
    writeBooleanSetting(CHANNEL_KEYS.lineOA, Boolean(config.lineOA)),
  ])
}

export async function getNotifyEvents(): Promise<NotifyEventConfig> {
  const [deviceAdded, deviceUpdated, transfer, lifecycle, meter] = await Promise.all([
    readBooleanSetting(EVENT_KEYS.deviceAdded, DEFAULT_NOTIFY_EVENTS.deviceAdded),
    readBooleanSetting(EVENT_KEYS.deviceUpdated, DEFAULT_NOTIFY_EVENTS.deviceUpdated),
    readBooleanSetting(EVENT_KEYS.transfer, DEFAULT_NOTIFY_EVENTS.transfer),
    readBooleanSetting(EVENT_KEYS.lifecycle, DEFAULT_NOTIFY_EVENTS.lifecycle),
    readBooleanSetting(EVENT_KEYS.meter, DEFAULT_NOTIFY_EVENTS.meter),
  ])
  return { deviceAdded, deviceUpdated, transfer, lifecycle, meter }
}

export async function saveNotifyEvents(config: NotifyEventConfig): Promise<void> {
  await Promise.all([
    writeBooleanSetting(EVENT_KEYS.deviceAdded, Boolean(config.deviceAdded)),
    writeBooleanSetting(EVENT_KEYS.deviceUpdated, Boolean(config.deviceUpdated)),
    writeBooleanSetting(EVENT_KEYS.transfer, Boolean(config.transfer)),
    writeBooleanSetting(EVENT_KEYS.lifecycle, Boolean(config.lifecycle)),
    writeBooleanSetting(EVENT_KEYS.meter, Boolean(config.meter)),
  ])
}

async function channelsForEvent(event: keyof NotifyEventConfig): Promise<NotificationChannel[]> {
  const [channels, events] = await Promise.all([getNotifyChannels(), getNotifyEvents()])
  if (!events[event]) return []

  const selected: NotificationChannel[] = []
  if (channels.telegram) selected.push('telegram')
  if (channels.lineOA) selected.push('line-oa')
  if (channels.email) selected.push('email')
  // LINE Notify is retained in the settings UI, but has no sender in the
  // current implementation; do not silently send it through a different API.
  return selected
}

export async function notifyDeviceAdded(
  device: {
    assetCode?: string | null
    deviceType?: string | null
    brand?: string | null
    model?: string | null
  },
  actor = 'system',
): Promise<void> {
  await sendNotification({
    template: 'device_added',
    channels: await channelsForEvent('deviceAdded'),
    data: {
      assetCode: device.assetCode ?? '—',
      deviceType: device.deviceType ?? '—',
      brand: device.brand ?? '—',
      model: device.model ?? '—',
    },
    actor,
    entityId: device.assetCode ?? undefined,
    entity: 'Device',
  })
}

export async function notifyDeviceUpdated(
  device: { assetCode?: string | null; brand?: string | null; model?: string | null },
  actor = 'system',
  changedFields: string[] = [],
): Promise<void> {
  await sendNotification({
    template: 'device_updated',
    channels: await channelsForEvent('deviceUpdated'),
    data: {
      assetCode: device.assetCode ?? '—',
      brand: device.brand ?? '—',
      model: device.model ?? '—',
      changedFields: changedFields.length ? changedFields.join(', ') : '—',
    },
    actor,
    entityId: device.assetCode ?? undefined,
    entity: 'Device',
  })
}

export async function notifyTransfer(ctx: {
  assetCode: string
  fromSite?: string | null
  toSite?: string | null
  by?: string | null
}): Promise<void> {
  await sendNotification({
    template: 'transfer',
    channels: await channelsForEvent('transfer'),
    data: {
      assetCode: ctx.assetCode,
      fromSite: ctx.fromSite ?? '—',
      toSite: ctx.toSite ?? '—',
      by: ctx.by ?? '—',
    },
    actor: ctx.by ?? 'system',
    entityId: ctx.assetCode,
    entity: 'Device',
  })
}

export async function notifyMeter(ctx: {
  assetCode: string
  pagesBw: number
  pagesColor: number
  by?: string | null
}): Promise<void> {
  await sendNotification({
    template: 'meter',
    channels: await channelsForEvent('meter'),
    data: {
      assetCode: ctx.assetCode,
      pagesBw: ctx.pagesBw,
      pagesColor: ctx.pagesColor,
      by: ctx.by ?? '—',
    },
    actor: ctx.by ?? 'system',
    entityId: ctx.assetCode,
    entity: 'Device',
  })
}
