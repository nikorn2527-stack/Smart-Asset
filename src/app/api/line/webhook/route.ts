import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { findDeviceByCode } from '@/lib/device-lookup'
import { generateDeviceQrUrl } from '@/lib/smart-qr'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * POST /api/line/webhook
 *
 * LINE Messaging API webhook endpoint.
 *
 * SECURITY MODEL (post LINE-WEBHOOK-FIX-PHASES-1-2-4):
 *   The webhook NEVER creates a WorkOrder directly. Anyone who adds the
 *   LINE OA as a friend can send a message — so unverified input is
 *   treated as a hint, not as a WO. Instead, the webhook replies with
 *   one of:
 *     • A link to the Smart QR page (/qr/d/{shortId}?action=repair) when
 *       the user's text or scanned image resolves to a known device.
 *       The QR page hosts the PublicReporter verification pipeline
 *       (Tier 1 LINE+phone-scope → PENDING; Tier 2/3 → PENDING_REVIEW).
 *     • A quick-reply menu (scan QR / open /report/general) for free
 *       text that does not match a device.
 *     • A status lookup ("ติดตาม" / "สถานะ") for the user's latest WO.
 *     • A help menu ("แจ้งซ่อม") with instructions.
 *
 * Flow:
 *   1. Verify X-Line-Signature header against HMAC-SHA256 of the raw body
 *      (using the `line_channel_secret` AppSetting).
 *   2. Parse the events array.
 *   3. For each message event:
 *      - If text matches a Device serialNumber/assetCode → reply with
 *        the device's Smart QR repair link.
 *      - If text starts with "ติดตาม" or "สถานะ" → reply with the
 *        latest WO status for this lineUserId.
 *      - If text is "แจ้งซ่อม" / "แจ้ง" → reply with the help menu.
 *      - Otherwise → reply with a quick-reply menu offering "📷 สแกน QR
 *        ที่เครื่อง" and "📝 แจ้งซ่อมไม่ระบุเครื่อง" (/report/general).
 *      - Image (QR/barcode scan) → if device resolved, reply with the
 *        Smart QR repair link; otherwise reply with the help menu.
 *   4. follow events welcome the user with the same menu.
 *
 * Configuration (AppSetting keys):
 *   - line_channel_access_token  — required to call Reply API
 *   - line_channel_secret        — required to verify signature
 *
 * When the access token is not configured, the webhook still computes
 * the reply text and logs what would have been sent (useful for local
 * dev). It still NEVER creates a WorkOrder.
 */

// ============================================================
// Settings
// ============================================================

interface LineSettings {
  channelAccessToken?: string
  channelSecret?: string
}

async function loadLineSettings(): Promise<LineSettings> {
  try {
    const rows = await db.appSetting.findMany({
      where: {
        key: { in: ['line_channel_access_token', 'line_channel_secret'] },
      },
    })
    const get = (k: string) =>
      rows.find((r) => r.key === k)?.value || undefined
    return {
      channelAccessToken: get('line_channel_access_token'),
      channelSecret: get('line_channel_secret'),
    }
  } catch {
    return {}
  }
}

// ============================================================
// Signature verification (HMAC-SHA256 → base64)
// ============================================================

function computeSignature(body: Buffer, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64')
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

// ============================================================
// LINE API helpers
// ============================================================

/**
 * A LINE message — supports plain text plus the template/button messages
 * we use to offer quick-reply actions when the user's text does not match
 * a device. The shape mirrors LINE's Messaging API reply body.
 */
type LineMessage =
  | { type: 'text'; text: string }
  | {
      type: 'template'
      altText: string
      template: {
        type: 'buttons'
        text: string
        actions: Array<
          | {
              type: 'uri'
              label: string
              uri: string
            }
          | {
              type: 'message'
              label: string
              text: string
            }
        >
      }
    }

async function replyMessage(
  replyToken: string,
  messages: LineMessage[],
  accessToken?: string,
): Promise<void> {
  if (!accessToken) {
    console.log(
      `[line-webhook] (log only) reply token=${replyToken.slice(0, 8)}…\n` +
        messages
          .map((m) =>
            m.type === 'text'
              ? m.text
              : `[template] ${m.altText}\n${m.template.text}\n` +
                m.template.actions
                  .map((a) => `  - ${a.label}: ${a.type === 'uri' ? a.uri : a.text}`)
                  .join('\n'),
          )
          .join('\n---\n'),
    )
    return
  }
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ replyToken, messages }),
    })
    if (!res.ok) {
      const txt = await res.text()
      console.error(
        `[line-webhook] reply API error ${res.status}: ${txt}`,
      )
    }
  } catch (err) {
    console.error('[line-webhook] reply failed:', err)
  }
}

// ============================================================
// Helpers — Smart QR link construction
// ============================================================

/**
 * Build a public-origin base URL for the Smart QR link we send back to
 * the user. We try (in order):
 *   1. `NEXT_PUBLIC_PUBLIC_BASE_URL` env var (recommended — set to the
 *      public-facing site URL, e.g. https://itam.example.com).
 *   2. `NEXT_PUBLIC_SITE_URL` env var.
 *   3. `VERCEL_URL` (auto-set on Vercel deployments).
 *   4. '' (empty) — the /qr/d/{shortId}?action=repair link becomes a
 *      relative path. Most LINE clients open the link in an external
 *      browser, which then resolves the absolute URL via the Referer.
 *      (Last-resort fallback — set NEXT_PUBLIC_PUBLIC_BASE_URL to avoid.)
 */
function getPublicBaseUrl(): string {
  const env =
    process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
  return env.replace(/\/+$/, '')
}

/**
 * Build the Smart QR repair URL for a device. Uses generateDeviceQrUrl
 * with the server-side public base URL — the result is what we send to
 * LINE so the user can tap and land on the public repair flow.
 */
function buildDeviceRepairUrl(deviceId: string): string {
  return generateDeviceQrUrl(deviceId, 'repair', getPublicBaseUrl())
}

// ============================================================
// Helpers — WO number generation removed
// ------------------------------------------------------------
// The webhook no longer creates WorkOrders directly (see the security
// model in the file header). All WO creation now flows through the
// public repair form (POST /api/public/repairs) via the Smart QR link
// we send back to the user. That route handles its own WO-number
// generation and reporter verification.
// ============================================================

// ============================================================
// Helpers — sync LINE profile into PublicReporter
// ------------------------------------------------------------
// PHASE-3-LINEBINDING-MIGRATION:
//   The legacy `LineBinding` table is being retired. All "person who
//   reported via LINE" data now lives in `PublicReporter`, keyed by
//   `(siteCode, lineUserId)` unique — so one LINE user can be a
//   reporter at multiple sites.
//
//   The webhook doesn't know which site a LINE user is at (it has no
//   device/QR context until the user actually scans a sticker), so it
//   CANNOT create a PublicReporter record directly. PublicReporter
//   records are created on the public repair form submission (which
//   has the device/site context).
//
//   What the webhook CAN do is best-effort profile sync: when a LINE
//   user sends a message or follows the OA, look up any existing
//   PublicReporter rows matching this lineUserId and fill in their
//   `lineDisplayName` if it's currently null. This way, the welcome
//   displayName we get from the LINE profile gets backfilled into
//   any already-created PublicReporter rows.
//
//   See: scripts/migrate-linebinding-to-public-reporter.ts for the
//   one-time backfill of historical LineBinding rows.
// ============================================================

async function syncLineProfileToPublicReporter(
  lineUserId: string,
  displayName?: string,
): Promise<void> {
  // No displayName → nothing to sync (lineUserId alone is already
  // captured when the PublicReporter record was created via the
  // public repair form).
  if (!displayName) return
  try {
    // Update all PublicReporter rows for this lineUserId (a user may
    // be a reporter at multiple sites). Only fills in null display
    // names — never overwrites an existing value.
    const result = await db.publicReporter.updateMany({
      where: {
        lineUserId,
        lineDisplayName: null,
      },
      data: {
        lineDisplayName: displayName,
      },
    })
    if (result.count > 0) {
      console.debug(
        `[line-webhook] synced lineDisplayName into ${result.count} PublicReporter row(s)`,
      )
    }
  } catch (err) {
    console.error(
      '[line-webhook] syncLineProfileToPublicReporter failed:',
      err,
    )
  }
}

// ============================================================
// Helpers — text classification
// ============================================================

const STATUS_KEYWORDS = ['ติดตาม', 'สถานะ', 'status', 'Status', 'STATUS']
const REPORT_KEYWORDS = ['แจ้งซ่อม', 'แจ้ง']

function startsWithAny(text: string, prefixes: string[]): boolean {
  return prefixes.some((p) => text.startsWith(p))
}

/**
 * Resolve an arbitrary user-typed code (assetCode OR serialNumber) to a
 * device, returning the small subset of fields the webhook needs for
 * the reply text. Returns `null` if no device matches.
 *
 * Delegates to the shared `findDeviceByCode` helper in
 * `src/lib/device-lookup.ts` (assetCode-first, serialNumber-fallback,
 * deterministic tiebreaker on duplicates).
 */
async function resolveDeviceForReply(
  text: string,
): Promise<{
  id: string
  assetCode: string
  name: string
  site: string
  building: string | null
  location: string | null
  department: string | null
} | null> {
  const match = await findDeviceByCode(text)
  if (!match) return null
  const d = match.device
  return {
    id: d.id,
    assetCode: d.assetCode,
    name: d.name,
    site: d.site,
    building: d.building,
    location: d.location,
    department: d.department,
  }
}

/**
 * Format a WorkOrder's status in Thai for LINE reply.
 */
function formatWoStatus(wo: {
  woNumber: string | null
  subject: string
  status: string
  assignedTo: string | null
  resolution: string | null
}): string {
  const statusMap: Record<string, string> = {
    PENDING: 'รอรับเรื่อน',
    IN_PROGRESS: 'กำลังดำเนินการ',
    WAITING_PARTS: 'รออะไหล่',
    COMPLETED: 'เสร็จเรียบร้อย',
    CANCELLED: 'ยกเลิกแล้ว',
  }
  const s = statusMap[wo.status] ?? wo.status
  let msg =
    `📋 ใบงาน ${wo.woNumber ?? '-'}\n` +
    `หัวข้อ: ${wo.subject}\n` +
    `สถานะ: ${s}`
  if (wo.assignedTo) msg += `\nมอบหมายให้: ${wo.assignedTo}`
  if (wo.status === 'COMPLETED' && wo.resolution) {
    msg += `\nผลการแก้ไข: ${wo.resolution}`
  }
  return msg
}

// ============================================================
// Helpers — audit
// ============================================================

async function logAuditLine(
  action: string,
  entityId: string | null,
  summary: string,
  detail: Record<string, unknown>,
  lineUserId: string,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action,
        entity: 'WorkOrder',
        entityId,
        summary,
        detail: JSON.stringify({ ...detail, lineUserId }),
        actor: `line:${lineUserId}`,
      },
    })
  } catch (err) {
    console.error('[line-webhook] audit log failed:', err)
  }
}

// ============================================================
// Main handler
// ============================================================

export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('notifications')
  if (unavailable) return unavailable


  // 1. Read raw body for signature verification.
  const rawBody = Buffer.from(await req.arrayBuffer())

  // 2. Verify signature.
  // SECURITY FIX: Previously, if line_channel_secret was not configured,
  // the webhook accepted requests without signature verification (fail-open).
  // Now, in production, missing secret = reject. In development
  // (NODE_ENV !== 'production'), we allow it with a warning for local testing.
  const settings = await loadLineSettings()
  const signature = req.headers.get('x-line-signature') ?? ''
  if (!settings.channelSecret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[line-webhook] line_channel_secret not configured — rejecting request (production mode)')
      return NextResponse.json(
        { error: 'Webhook secret not configured' },
        { status: 503 },
      )
    }
    console.warn(
      '[line-webhook] line_channel_secret not configured — accepting request without verification (DEV MODE ONLY)',
    )
  } else {
    if (!signature) {
      return NextResponse.json(
        { error: 'missing X-Line-Signature' },
        { status: 401 },
      )
    }
    const computed = computeSignature(rawBody, settings.channelSecret)
    if (!safeEqual(computed, signature)) {
      console.error('[line-webhook] signature mismatch')
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
    }
  }

  // 3. Parse the payload.
  let payload: {
    events?: Array<Record<string, unknown>>
  }
  try {
    payload = JSON.parse(rawBody.toString('utf8'))
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const events = Array.isArray(payload.events) ? payload.events : []
  if (events.length === 0) {
    return NextResponse.json({ ok: true, handled: 0 })
  }

  let handled = 0
  for (const evt of events) {
    try {
      const type = String(evt.type ?? '')
      const source = (evt.source ?? {}) as Record<string, unknown>
      const lineUserId = String(source.userId ?? '')
      const replyToken = String(evt.replyToken ?? '')

      if (!lineUserId) continue

      if (type === 'follow') {
        // ── Welcome message ──
        // Best-effort sync of the LINE displayName we just received into
        // any pre-existing PublicReporter rows for this user. The
        // webhook itself never creates PublicReporter records (it has no
        // siteCode context — that comes from the QR/device scan in the
        // public repair form). See syncLineProfileToPublicReporter docs.
        await syncLineProfileToPublicReporter(
          lineUserId,
          (evt as { profile?: { displayName?: string } }).profile
            ?.displayName,
        )
        const welcome =
          'ยินดีต้อนรับสู่ระบบแจ้งซ่อม 🙌\n\n' +
          'คุณสามารถ:\n' +
          '• พิมพ์ "แจ้งซ่อม" เพื่อดูวิธีแจ้งงานใหม่\n' +
          '• พิมพ์ "ติดตาม" หรือ "สถานะ" เพื่อดูสถานะใบงานล่าสุด\n' +
          '• พิมพ์รหัสทรัพย์สิน หรือ เลขซีเรียล (เช่น IT-00001) เพื่อเปิดลิงก์แจ้งซ่อมเฉพาะเครื่อง\n' +
          '• ส่งรูป QR code ที่ติดอยู่บนเครื่อง ระบบจะส่งลิงก์แจ้งซ่อมกลับมา\n' +
          '• หรือพิมพ์ปัญหาโดยไม่ระบุรหัสเครื่อง — ระบบจะตอบด้วยเมนูให้เลือกวิธีแจ้งซ่อม'
        if (replyToken) {
          await replyMessage(
            replyToken,
            [{ type: 'text', text: welcome }],
            settings.channelAccessToken,
          )
        }
        await logAuditLine(
          'LINE_FOLLOW',
          null,
          `ผู้ใช้ LINE ใหม่เพิ่มเป็นเพื่อน`,
          { displayName: 'unknown' },
          lineUserId,
        )
        handled++
        continue
      }

      if (type === 'message') {
        const msg = (evt.message ?? {}) as Record<string, unknown>
        const messageId = String(msg.id ?? '')

        // ── Deduplicate LINE messages by messageId ──
        // LINE may retry webhook delivery if it doesn't receive a 200 in
        // time. We previously deduped by checking for a WorkOrder with
        // this lineMessageId — but the webhook no longer creates WOs.
        // LINE's replyToken is single-use (one reply per token), so a
        // retried webhook would simply fail on replyMessage. We accept
        // this minor double-processing risk (the user gets one reply per
        // successful reply API call; the duplicate fails silently).

        // ── IMAGE: QR/barcode scan from device sticker ──
        // SECURITY: previously this branch created a WorkOrder directly
        // (status=PENDING, submissionSource='line') — bypassing the
        // PublicReporter verification pipeline. Now it ONLY resolves the
        // scanned code to a device and replies with the Smart QR repair
        // link, so the user lands on the same public repair form as a
        // QR-scanned user (Tier 1/2/3 verification applies).
        if (msg.type === 'image') {
          if (settings.channelAccessToken) {
            try {
              const { processLineImage } = await import('@/lib/line-image-handler')

              const result = await processLineImage(
                messageId,
                settings.channelAccessToken,
              )

              let replyText: string
              if (result.device) {
                const d = result.device
                const repairUrl = buildDeviceRepairUrl(d.id)
                replyText =
                  `✅ พบอุปกรณ์: ${d.name ?? '-'} (${d.assetCode ?? '-'})\n` +
                  `กดลิงก์เพื่อแจ้งซ่อมอุปกรณ์นี้:\n${repairUrl}`
                await logAuditLine(
                  'LINE_IMAGE_DEVICE_FOUND',
                  d.id,
                  `LINE webhook: image scan resolved to device ${d.assetCode} — replied with repair link`,
                  {
                    method: result.method,
                    code: result.code ?? null,
                    assetCode: d.assetCode,
                  },
                  lineUserId,
                )
              } else {
                // Image didn't resolve to a device — offer the menu
                replyText =
                  `⚠️ ${result.error ?? 'ไม่พบอุปกรณ์จากรูปภาพ'}\n\n` +
                  `คุณสามารถ:\n` +
                  `• พิมพ์รหัสทรัพย์สิน หรือ เลขซีเรียลของเครื่อง\n` +
                  `• พิมพ์ "แจ้งซ่อม" เพื่อดูวิธีแจ้งงานใหม่\n` +
                  `• หรือกดปุ่มด้านล่างเพื่อแจ้งซ่อมไม่ระบุเครื่อง`
                await logAuditLine(
                  'LINE_IMAGE_NO_DEVICE',
                  null,
                  `LINE webhook: image scan did not resolve to a device`,
                  {
                    method: result.method,
                    code: result.code ?? null,
                    error: result.error ?? null,
                  },
                  lineUserId,
                )
              }

              if (replyToken) {
                const messages: LineMessage[] = result.device
                  ? [
                      {
                        type: 'template',
                        altText: `พบอุปกรณ์ ${result.device.name ?? '-'} — กดเพื่อแจ้งซ่อม`,
                        template: {
                          type: 'buttons',
                          text: replyText,
                          actions: [
                            {
                              type: 'uri',
                              label: '🔧 แจ้งซ่อมอุปกรณ์นี้',
                              uri: buildDeviceRepairUrl(result.device.id),
                            },
                          ],
                        },
                      },
                    ]
                  : [
                      {
                        type: 'template',
                        altText: 'เลือกวิธีแจ้งซ่อม',
                        template: {
                          type: 'buttons',
                          text: replyText,
                          actions: [
                            {
                              type: 'uri',
                              label: '📝 แจ้งซ่อมไม่ระบุเครื่อง',
                              uri: `${getPublicBaseUrl()}/report/general`,
                            },
                            {
                              type: 'message',
                              label: '📷 สแกน QR ที่เครื่อง',
                              text: 'แจ้งซ่อม',
                            },
                          ],
                        },
                      },
                    ]
                await replyMessage(
                  replyToken,
                  messages,
                  settings.channelAccessToken,
                )
              }
              handled++
            } catch (err) {
              console.error('[line-webhook] Image processing failed:', err)
              if (replyToken) {
                await replyMessage(
                  replyToken,
                  [
                    {
                      type: 'text',
                      text: '⚠️ ไม่สามารถประมวลผลรูปภาพได้ กรุณาลองอีกครั้งหรือพิมพ์รหัสเครื่องแทน',
                    },
                  ],
                  settings.channelAccessToken,
                )
              }
            }
          }
          continue
        }

        // Sticker/audio/video → ignore (only text + image supported)
        if (msg.type !== 'text') {
          continue
        }

        const text = String(msg.text ?? '').trim()
        if (!text) continue

        // Best-effort profile sync (no displayName available for plain
        // text messages — LINE only sends the profile on follow/unfollow
        // events. This is a no-op for the text-message branch; kept here
        // as a placeholder so future code that fetches the profile from
        // the LINE API can plug in here without restructuring the call
        // site).
        // See syncLineProfileToPublicReporter() docs above.

        // ── Branch 1: status lookup ──
        if (startsWithAny(text, STATUS_KEYWORDS)) {
          const latestWo = await db.workOrder.findFirst({
            where: { lineUserId },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              woNumber: true,
              subject: true,
              status: true,
              assignedTo: true,
              resolution: true,
            },
          })
          if (!latestWo) {
            const reply =
              'คุณยังไม่มีใบงานในระบบ\nพิมพ์ "แจ้งซ่อม" หรือบอกอาการเครื่องเพื่อเริ่มแจ้งซ่อมได้เลยครับ'
            if (replyToken) {
              await replyMessage(
                replyToken,
                [{ type: 'text', text: reply }],
                settings.channelAccessToken,
              )
            }
          } else {
            if (replyToken) {
              await replyMessage(
                replyToken,
                [{ type: 'text', text: formatWoStatus(latestWo) }],
                settings.channelAccessToken,
              )
            }
          }
          handled++
          continue
        }

        // ── Branch 2: report keyword → send quick-reply menu ──
        if (REPORT_KEYWORDS.includes(text)) {
          const menu =
            'กรุณาเลือกวิธีแจ้งซ่อม หรือพิมพ์รายละเอียดเพิ่มเติม:\n\n' +
            '• พิมพ์รหัสทรัพย์สิน หรือ เลขซีเรียล (เช่น IT-00001) เพื่อแจ้งซ่อมเฉพาะเครื่อง\n' +
            '• พิมพ์ "ติดตาม" เพื่อดูสถานะใบงานล่าสุด\n' +
            '• หรือกดปุ่มด้านล่างเพื่อแจ้งซ่อมโดยไม่ระบุเครื่อง'
          if (replyToken) {
            const messages: LineMessage[] = [
              {
                type: 'template',
                altText: 'เลือกวิธีแจ้งซ่อม',
                template: {
                  type: 'buttons',
                  text: menu,
                  actions: [
                    {
                      type: 'uri',
                      label: '📝 แจ้งซ่อมไม่ระบุเครื่อง',
                      uri: `${getPublicBaseUrl()}/report/general`,
                    },
                    {
                      type: 'message',
                      label: '📷 สแกน QR ที่เครื่อง',
                      text: 'แจ้งซ่อม',
                    },
                  ],
                },
              },
            ]
            await replyMessage(
              replyToken,
              messages,
              settings.channelAccessToken,
            )
          }
          handled++
          continue
        }

        // ── Branch 3: text matches a device code → reply with Smart QR link ──
        // SECURITY: previously this branch created a WorkOrder directly
        // (status=PENDING, submissionSource='line'). Now it ONLY resolves
        // the code to a device and replies with the Smart QR repair link,
        // so the user lands on the public repair form (PublicReporter
        // verification pipeline applies — Tier 1 → PENDING, Tier 2/3 →
        // PENDING_REVIEW).
        const device = await resolveDeviceForReply(text)
        if (device) {
          const repairUrl = buildDeviceRepairUrl(device.id)
          const replyText =
            `✅ พบอุปกรณ์: ${device.name} (${device.assetCode})\n` +
            `สาขา: ${device.site}${device.building ? ` • ${device.building}` : ''}${device.location ? ` • ${device.location}` : ''}\n\n` +
            `กดลิงก์เพื่อแจ้งซ่อมอุปกรณ์นี้:\n${repairUrl}`
          if (replyToken) {
            const messages: LineMessage[] = [
              {
                type: 'template',
                altText: `พบอุปกรณ์ ${device.name} (${device.assetCode}) — กดเพื่อแจ้งซ่อม`,
                template: {
                  type: 'buttons',
                  text: replyText,
                  actions: [
                    {
                      type: 'uri',
                      label: '🔧 แจ้งซ่อมอุปกรณ์นี้',
                      uri: repairUrl,
                    },
                  ],
                },
              },
            ]
            await replyMessage(
              replyToken,
              messages,
              settings.channelAccessToken,
            )
          }
          await logAuditLine(
            'LINE_TEXT_DEVICE_FOUND',
            device.id,
            `LINE webhook: text resolved to device ${device.assetCode} — replied with repair link`,
            {
              assetCode: device.assetCode,
              site: device.site,
              rawText: text,
            },
            lineUserId,
          )
          handled++
          continue
        }

        // ── Branch 4: free text, no device match → quick-reply menu ──
        // SECURITY: previously this branch created a WorkO directly with
        // status=PENDING. Now it offers the user two safe paths:
        //   1. Open /report/general (Phase 2 page) to find their device
        //      by assetCode/serial and submit via the verified form.
        //   2. Scan the QR sticker on the device (replies with the help
        //      menu so they can send an image).
        if (replyToken) {
          const menuText =
            `ไม่พบอุปกรณ์ที่ตรงกับ "${text.slice(0, 60)}"\n\n` +
            `คุณสามารถ:\n` +
            `• พิมพ์รหัสทรัพย์สิน หรือ เลขซีเรียลของเครื่องใหม่อีกครั้ง\n` +
            `• พิมพ์ "ติดตาม" เพื่อดูสถานะใบงานล่าสุด\n` +
            `• หรือกดปุ่มด้านล่างเพื่อแจ้งซ่อมโดยไม่ระบุเครื่อง`
          const messages: LineMessage[] = [
            {
              type: 'template',
              altText: 'เลือกวิธีแจ้งซ่อม',
              template: {
                type: 'buttons',
                text: menuText,
                actions: [
                  {
                    type: 'uri',
                    label: '📝 แจ้งซ่อมไม่ระบุเครื่อง',
                    uri: `${getPublicBaseUrl()}/report/general`,
                  },
                  {
                    type: 'message',
                    label: '📷 สแกน QR ที่เครื่อง',
                    text: 'แจ้งซ่อม',
                  },
                ],
              },
            },
          ]
          await replyMessage(
            replyToken,
            messages,
            settings.channelAccessToken,
          )
        }
        await logAuditLine(
          'LINE_TEXT_NO_DEVICE',
          null,
          `LINE webhook: free-text did not match a device — replied with menu`,
          { rawText: text.slice(0, 200) },
          lineUserId,
        )
        handled++
        continue
      }

      if (type === 'postback') {
        // Postback events come from template buttons / rich menu.
        // For now we just acknowledge and log.
        const data = String((evt.postback as { data?: string })?.data ?? '')
        await logAuditLine(
          'LINE_POSTBACK',
          null,
          `ได้รับ postback จาก LINE: ${data}`,
          { data },
          lineUserId,
        )
        if (replyToken) {
          await replyMessage(
            replyToken,
            [
              {
                type: 'text',
                text: `ได้รับเรียบร้อย (postback: ${data || '-'})`,
              },
            ],
            settings.channelAccessToken,
          )
        }
        handled++
        continue
      }
    } catch (err) {
      console.error('[line-webhook] event handling failed:', err)
    }
  }

  return NextResponse.json({ ok: true, handled })
}
