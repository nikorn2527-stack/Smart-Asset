import { getLineSession } from '@/lib/line-session'
import { resolveDeviceQrIdentity as resolveDevice } from '@/lib/qr-identity'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalizeSiteCode } from '@/lib/site-scope'
import { withRetryOnUnique } from '@/lib/retry-unique'
import { notifyWorkOrderCreated } from '@/lib/notifications'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import {
  getActiveWoPattern,
  generateWoNumberFromPattern,
  ensureDefaultWoPatterns,
} from '@/lib/wo-number-pattern'

// ============================================================
// Public QR Scan → Repair Submission API (NO AUTH REQUIRED)
//   POST /api/public/repairs
//
// Submits a public repair request from a QR scan. Creates a
// PublicReporter (if first time) + WorkOrder. Anti-spam:
//   • per-phone daily limit (SiteAttribute.PublicRepairDailyLimit)
//   • per-IP daily limit   (SiteAttribute.PublicRepairIpDailyLimit)
//   • blocked reporter check (PublicReporter.isBlocked)
//
// Reporter tiers:
//   • Tier 1 — LINE Login + phone scope  → phoneVerified=true, WO PENDING
//   • Tier 2 — LINE Login, no phone      → phoneVerified=false, WO PENDING_REVIEW
//   • Tier 3 — Anonymous (phone+name)   → phoneVerified=false, WO PENDING_REVIEW
// ============================================================

export const dynamic = 'force-dynamic'

// ── In-memory IP rate-limit (per server instance, sufficient for Vercel) ──
// Map<key=`ip:${ip}`|`phone:${siteCode}:${phone}`, bucket={count, resetAt}>
// `resetAt` is the next midnight UTC (per-day window).
interface IpBucket {
  count: number
  resetAt: number
}
const ipBuckets = new Map<string, IpBucket>()

// Cleanup stale entries every 5 minutes to prevent memory leak.
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000
let lastCleanup = Date.now()
function cleanupBuckets() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  for (const [k, b] of ipBuckets) {
    if (b.resetAt <= now) ipBuckets.delete(k)
  }
}

/** Return the next UTC midnight timestamp (ms since epoch). */
function nextUtcMidnight(now = new Date()): number {
  const next = new Date(now)
  next.setUTCDate(next.getUTCDate() + 1)
  next.setUTCHours(0, 0, 0, 0)
  return next.getTime()
}

/** Return the start-of-today UTC timestamp (ms since epoch). */
function startOfTodayUtc(now = new Date()): Date {
  const d = new Date(now)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

// ── Helpers ─────────────────────────────────────────────────────────────

function getClientIP(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const xRealIP = req.headers.get('x-real-ip')
  if (xRealIP) return xRealIP.trim()
  return 'unknown'
}

/** Mask a phone for audit logs — keep only last 4 digits. */
function maskPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const s = String(phone).replace(/\D/g, '')
  if (s.length <= 4) return '****'
  return '****' + s.slice(-4)
}

/**
 * Resolve a short ID (last 8 chars of cuid) OR an assetCode to a Device.
 * Same logic as /api/public/devices/[shortId].
 */

/**
 * Generate the next woNumber.
 *
 * Priority:
 *   1. If there's an active WoNumberPattern → use it (PPIT-0001 etc.)
 *   2. Fallback: WO-YYYYMMDD-NNN (sequential per day)
 *   3. Last resort: WO-PUB-<timestamp>
 */
async function generateWoNumberForPublic(): Promise<string> {
  // ── 1. Try the active WoNumberPattern ──
  try {
    await ensureDefaultWoPatterns()
    const active = await getActiveWoPattern()
    if (active) {
      const generated = await generateWoNumberFromPattern(active)
      if (generated) return generated
    }
  } catch (err) {
    console.error('[public/repairs] WoNumberPattern generation failed:', err)
  }

  // ── 2. Fallback: WO-YYYYMMDD-NNN ──
  try {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const prefix = `WO-${y}${m}${d}-`
    const todays = await db.workOrder.findMany({
      where: { woNumber: { startsWith: prefix } },
      select: { woNumber: true },
    })
    let maxSeq = 0
    for (const t of todays) {
      if (!t.woNumber) continue
      const seq = parseInt(t.woNumber.slice(prefix.length), 10)
      if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq
    }
    const candidate = `${prefix}${String(maxSeq + 1).padStart(3, '0')}`
    // Verify uniqueness
    const exists = await db.workOrder.findFirst({
      where: { OR: [{ id: candidate }, { woNumber: candidate }] },
      select: { id: true },
    })
    if (!exists) return candidate
  } catch (err) {
    console.error('[public/repairs] WO-YYYYMMDD-NNN generation failed:', err)
  }

  // ── 3. Last-resort: WO-PUB-<timestamp> ──
  return `WO-PUB-${Date.now()}`
}

// ── Validation ──────────────────────────────────────────────────────────

interface RepairRequestBody {
  deviceShortId: string
  siteCode: string
  subject: string
  name?: string | null
  phone?: string | null
  email?: string | null
  details?: string | null
  problemCategories?: string[]
  lineUserId?: string | null
  lineDisplayName?: string | null
  linePictureUrl?: string | null
  lineScopePhone?: string | null
}

interface ValidationResult {
  ok: boolean
  status: number
  error?: string
  data?: RepairRequestBody
}

function validateBody(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, status: 400, error: 'Invalid request body' }
  }
  const body = raw as Record<string, unknown>

  const deviceShortId =
    typeof body.deviceShortId === 'string' ? body.deviceShortId.trim() : ''
  if (!deviceShortId) {
    return { ok: false, status: 400, error: 'กรุณาระบุรหัสอุปกรณ์ (deviceShortId)' }
  }

  const siteCode =
    typeof body.siteCode === 'string' ? body.siteCode.trim().toUpperCase() : ''
  if (!siteCode) {
    return { ok: false, status: 400, error: 'กรุณาระบุรหัสสาขา (siteCode)' }
  }

  const lineUserId =
    typeof body.lineUserId === 'string' && body.lineUserId.trim()
      ? body.lineUserId.trim()
      : null
  const lineDisplayName =
    typeof body.lineDisplayName === 'string' && body.lineDisplayName.trim()
      ? body.lineDisplayName.trim()
      : null
  const linePictureUrl =
    typeof body.linePictureUrl === 'string' && body.linePictureUrl.trim()
      ? body.linePictureUrl.trim()
      : null
  const lineScopePhone =
    typeof body.lineScopePhone === 'string' && body.lineScopePhone.trim()
      ? body.lineScopePhone.trim()
      : null

  const isTier1 = !!lineUserId && !!lineScopePhone
  const isTier2 = !!lineUserId && !lineScopePhone
  // Tier 3: no lineUserId

  const phone =
    typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : ''
  const name =
    typeof body.name === 'string' && body.name.trim() ? body.name.trim() : ''

  // Tier 3 requires phone + name
  if (!lineUserId) {
    if (!phone) {
      return {
        ok: false,
        status: 400,
        error: 'กรุณาระบุเบอร์โทรศัพท์ (phone)',
      }
    }
    if (!name) {
      return {
        ok: false,
        status: 400,
        error: 'กรุณาระบุชื่อ-สกุล (name)',
      }
    }
  }

  const subject =
    typeof body.subject === 'string' ? body.subject.trim() : ''
  if (!subject) {
    return { ok: false, status: 400, error: 'กรุณาระบุหัวข้อปัญหา (subject)' }
  }
  if (subject.length < 5) {
    return {
      ok: false,
      status: 400,
      error: 'หัวข้อปัญหาต้องมีอย่างน้อย 5 ตัวอักษร',
    }
  }

  const details =
    typeof body.details === 'string' ? body.details.trim() : ''

  let problemCategories: string[] = []
  if (Array.isArray(body.problemCategories)) {
    problemCategories = body.problemCategories
      .map((c) => (typeof c === 'string' ? c.trim() : ''))
      .filter(Boolean)
      .slice(0, 10)
  }

  const email =
    typeof body.email === 'string' && body.email.trim()
      ? body.email.trim()
      : null

  return {
    ok: true,
    status: 200,
    data: {
      deviceShortId,
      siteCode,
      name: name || null,
      phone: phone || (isTier1 ? lineScopePhone! : ''),
      email: email ?? undefined,
      subject,
      details,
      problemCategories,
      lineUserId: lineUserId ?? undefined,
      lineDisplayName: lineDisplayName ?? undefined,
      linePictureUrl: linePictureUrl ?? undefined,
      lineScopePhone: lineScopePhone ?? undefined,
    },
  }
}

// ── POST handler ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  try {
    // ── Parse + validate body ──
    const raw = await req.json().catch(() => null)
    const session = await getLineSession(req)
    if (raw?.lineUserId && (!session || raw.lineUserId !== session.userId)) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ LINE ใหม่ก่อนแจ้งซ่อม' }, { status: 401 })
    const trusted = raw && typeof raw === 'object' ? {
      ...raw,
      lineUserId: session?.userId ?? null,
      lineDisplayName: session?.displayName ?? null,
      linePictureUrl: session?.pictureUrl ?? null,
      lineScopePhone: session?.scopePhone ?? null,
    } : raw
    const validation = validateBody(trusted)
    if (!validation.ok || !validation.data) {
      return NextResponse.json(
        { error: validation.error ?? 'Invalid request' },
        { status: validation.status },
      )
    }
    const body = validation.data
    const clientIP = getClientIP(req)

    // ── Resolve device ──
    const device = await resolveDevice(body.deviceShortId!)
    if (!device) {
      return NextResponse.json(
        { error: 'ไม่พบอุปกรณ์ — กรุณาสแกน QR ใหม่อีกครั้ง' },
        { status: 404 },
      )
    }

    if (!device.organizationId) return NextResponse.json({ error: 'ครุภัณฑ์ยังไม่ผูกหน่วยงาน กรุณาติดต่อเจ้าหน้าที่' }, { status: 409 })

    // ── Verify siteCode matches device.site ──
    const normalizedSite = normalizeSiteCode(device.site)
    if (normalizedSite !== body.siteCode) {
      return NextResponse.json(
        {
          error:
            'รหัสสาขาไม่ตรงกับอุปกรณ์ — กรุณาสแกน QR บนอุปกรณ์ที่ต้องการแจ้งซ่อม',
        },
        { status: 400 },
      )
    }

    // ── Load SiteAttribute for rate-limit config + LINE OA ──
    const siteAttr = await db.siteAttribute.findUnique({
      where: { SiteCode: body.siteCode },
    })
    if (!siteAttr) {
      // siteCode is required to exist in SiteAttribute (foreign key)
      return NextResponse.json(
        { error: `ไม่พบข้อมูลสาขา '${body.siteCode}'` },
        { status: 400 },
      )
    }

    const phoneDailyLimit = siteAttr.PublicRepairDailyLimit || 3
    const ipDailyLimit = siteAttr.PublicRepairIpDailyLimit || 10

    // ── Disposed device — refuse ──
    if (device.status === 'Disposed') {
      return NextResponse.json(
        { error: 'อุปกรณ์นี้ถูกตัดจำหน่ายแล้ว ไม่รับแจ้งซ่อม' },
        { status: 400 },
      )
    }

    // ── Replaced device — tell client to scan the new device ──
    if (device.replacedById) {
      const replacement = await db.device.findUnique({
        where: { id: device.replacedById },
        select: { id: true, assetCode: true, name: true, brand: true, model: true },
      })
      return NextResponse.json(
        {
          error: 'อุปกรณ์นี้ถูกเปลี่ยนเครื่องใหม่แล้ว กรุณาสแกน QR บนเครื่องใหม่',
          redirect: 'scan_new_device',
          replacedBy: replacement
            ? {
                shortId: replacement.id,
                assetCode: replacement.assetCode,
                name: replacement.name,
                brand: replacement.brand,
                model: replacement.model,
              }
            : null,
        },
        { status: 400 },
      )
    }

    // ── Determine reporter tier + verification status ──
    const isTier1 = !!body.lineUserId && !!body.lineScopePhone
    const phoneVerified = isTier1
    const verifiedMethod = isTier1 ? 'line_phone_scope' : null
    const submissionSource = body.lineUserId ? 'line_liff' : 'public_qr'
    // Tier 1 → PENDING (auto-verified). Tier 2/3 → PENDING_REVIEW.
    const woStatus = phoneVerified ? 'PENDING' : 'PENDING_REVIEW'

    // ── Resolve or create PublicReporter ──
    // Tier 1/2 → upsert by (siteCode, lineUserId)
    // Tier 3   → upsert by (siteCode, phone)
    let reporter: { id: string; isBlocked: boolean; blockedReason: string | null; phone: string | null; reportCount: number } | null = null

    if (body.lineUserId) {
      // Upsert by (siteCode, lineUserId)
      const phoneForReport = isTier1 ? body.lineScopePhone! : null
      const updateData = {
        lastReportAt: new Date(),
        reportCount: { increment: 1 },
        // Tier 1 — also set phone + verification status
        ...(isTier1
          ? {
              phone: phoneForReport,
              phoneVerified: true,
              verifiedMethod: 'line_phone_scope' as const,
              verifiedAt: new Date(),
            }
          : {}),
        // Tier 2 — leave phone as-is (NULL if new, unchanged if exists)
        // Don't downgrade verification on subsequent Tier 2 logins
        lineDisplayName: body.lineDisplayName ?? null,
        linePictureUrl: body.linePictureUrl ?? null,
        lineScopePhone: body.lineScopePhone ?? null,
        name: body.name ?? null,
        email: body.email ?? null,
        defaultDeviceId: device.id,
        isDemo: device.isDemo,
      }
      reporter = await db.publicReporter.upsert({
        where: {
          siteCode_lineUserId: {
            siteCode: body.siteCode,
            lineUserId: body.lineUserId,
          },
        },
        create: {
          siteCode: body.siteCode,
          lineUserId: body.lineUserId,
          lineDisplayName: body.lineDisplayName ?? null,
          linePictureUrl: body.linePictureUrl ?? null,
          lineScopePhone: body.lineScopePhone ?? null,
          phone: phoneForReport,
          name: body.name ?? null,
          email: body.email ?? null,
          phoneVerified,
          verifiedMethod,
          verifiedAt: phoneVerified ? new Date() : null,
          reportCount: 0,
          lastReportAt: new Date(),
          defaultDeviceId: device.id,
          isDemo: device.isDemo,
        },
        update: updateData,
        select: {
          id: true,
          isBlocked: true,
          blockedReason: true,
          phone: true,
          reportCount: true,
        },
      })
    } else {
      // Tier 3 — upsert by (siteCode, phone)
      reporter = await db.publicReporter.upsert({
        where: {
          siteCode_phone: {
            siteCode: body.siteCode,
            phone: body.phone!,
          },
        },
        create: {
          siteCode: body.siteCode,
          phone: body.phone!,
          name: body.name ?? null,
          email: body.email ?? null,
          phoneVerified: false,
          reportCount: 0,
          lastReportAt: new Date(),
          defaultDeviceId: device.id,
          isDemo: device.isDemo,
        },
        update: {
          lastReportAt: new Date(),
          reportCount: { increment: 1 },
          name: body.name ?? null,
          email: body.email ?? null,
          defaultDeviceId: device.id,
        },
        select: {
          id: true,
          isBlocked: true,
          blockedReason: true,
          phone: true,
          reportCount: true,
        },
      })
    }

    if (!reporter) {
      return NextResponse.json(
        { error: 'ไม่สามารถสร้าง/อัปเดตข้อมูลผู้แจ้งได้' },
        { status: 500 },
      )
    }

    // ── Blocked reporter check ──
    if (reporter.isBlocked) {
      return NextResponse.json(
        {
          error:
            reporter.blockedReason ||
            'เบอร์/บัญชีของคุณถูกระงับการใช้งาน กรุณาติดต่อเจ้าหน้าที่',
        },
        { status: 403 },
      )
    }

    // ── Anti-spam: per-phone daily limit (Tier 1 and 3 only, since they have phone) ──
    const todayStart = startOfTodayUtc()
    if (reporter.phone) {
      const phoneTodayCount = await db.workOrder.count({
        where: {
          siteCode: normalizedSite ?? undefined,
          createdAt: { gte: todayStart },
          publicReporter: { phone: reporter.phone },
        },
      })
      if (phoneTodayCount >= phoneDailyLimit) {
        return NextResponse.json(
          {
            error: `คุณแจ้งซ่อมครบ ${phoneDailyLimit} ครั้งในวันนี้แล้ว กรุณาติดต่อเจ้าหน้าที่หากมีปัญหาเร่งด่วน`,
          },
          { status: 429, headers: { 'Retry-After': '86400' } },
        )
      }
    }

    // ── Anti-spam: per-IP daily limit (in-memory bucket) ──
    cleanupBuckets()
    const ipKey = `ip:${clientIP}:${body.siteCode}`
    const now = Date.now()
    let ipBucket = ipBuckets.get(ipKey)
    if (!ipBucket || ipBucket.resetAt <= now) {
      ipBucket = { count: 0, resetAt: nextUtcMidnight() }
      ipBuckets.set(ipKey, ipBucket)
    }
    if (ipBucket.count >= ipDailyLimit) {
      const retryAfterSec = Math.ceil((ipBucket.resetAt - now) / 1000)
      return NextResponse.json(
        {
          error: `IP ของคุณแจ้งซ่อมครบ ${ipDailyLimit} ครั้งในวันนี้แล้ว กรุณาลองใหม่ในวันพรุ่งนี้ หรือติดต่อเจ้าหน้าที่`,
        },
        { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
      )
    }

    // ── Increment IP bucket (count this submission) ──
    ipBucket.count += 1

    // ── Generate WO number (with retry-on-unique) ──
    // `withRetryOnUnique` re-invokes the function on P2002 — our generator
    // re-scans the DB on each call so the next attempt picks the next seq.
    const wo = await withRetryOnUnique(async () => {
      const woNumber = await generateWoNumberForPublic()
      // Build a combined details string: original details + problem
      // categories + LINE display name (for staff context).
      const detailParts: string[] = []
      if (body.details) detailParts.push(body.details)
      if (body.problemCategories && body.problemCategories.length > 0) {
        detailParts.push(
          'หมวดปัญหา: ' + body.problemCategories.join(', '),
        )
      }
      if (body.lineDisplayName) {
        detailParts.push(`LINE: ${body.lineDisplayName}`)
      }
      const combinedDetails = detailParts.join('\n\n')

      const reporterName = body.lineDisplayName ?? body.name ?? 'ผู้แจ้งซ่อม'
      const reporterTel = body.phone || body.lineScopePhone || null
      // Use lineUserId from body OR fall back to the reporter's stored lineUserId
      // (defensive — in case the client forgets to send it)
      const effectiveLineUserId =
        body.lineUserId ?? (reporter as { lineUserId?: string | null }).lineUserId ?? null

      return db.workOrder.create({
        data: {
          id: woNumber, // Preserve current primary-key compatibility
          woNumber,
          systemJobNo: woNumber,
          subject: body.subject,
          details: combinedDetails || null,
          priority: 'ปกติ',
          status: woStatus,
          submissionSource,
          deviceId: device.id,
          organizationId: device.organizationId,
          siteCode: normalizedSite,
          publicReporterId: reporter.id,
          reporterName,
          reporterEmail: body.email ?? null,
          tel: reporterTel,
          lineUserId: effectiveLineUserId,
          building: device.building,
          location: device.location,
          trackable: true, // Public users get tracking
          isDemo: device.isDemo,
        },
      })
    })

    // ── Audit log (best-effort) ──
    try {
      await db.auditLog.create({
        data: {
          organizationId: device.organizationId,
          action: 'public_repair_submit',
          entity: 'WorkOrder',
          entityId: wo.id,
          summary: `แจ้งซ่อมสาธารณะ ${wo.woNumber} — ${wo.subject} (${submissionSource})`,
          detail: JSON.stringify({
            ip: clientIP,
            phone_masked: maskPhone(reporter.phone),
            source: submissionSource,
            deviceShortId: body.deviceShortId,
            deviceAssetCode: device.assetCode,
            siteCode: body.siteCode,
            publicReporterId: reporter.id,
            tier: isTier1 ? 1 : body.lineUserId ? 2 : 3,
            phoneVerified,
            woStatus,
            userAgent: req.headers.get('user-agent') || null,
          }),
          actor: body.lineDisplayName ?? body.name ?? 'public_reporter',
          siteCode: body.siteCode,
          ipAddress: clientIP,
          userAgent: req.headers.get('user-agent') || null,
          isDemo: device.isDemo,
        },
      })
    } catch (auditErr) {
      console.error('[public/repairs] audit log failed:', auditErr)
    }

    // ── Notification (best-effort, non-blocking) ──
    try {
      await notifyWorkOrderCreated(
        {
          id: wo.id,
          woNumber: wo.woNumber,
          subject: wo.subject,
          building: wo.building,
          location: wo.location,
          reporterName: wo.reporterName,
          tel: wo.tel,
          priority: wo.priority,
          lineUserId: wo.lineUserId,
        },
        { channels: ['line-oa', 'telegram'], actor: 'public_reporter' },
      )
    } catch (notifyErr) {
      console.error('[public/repairs] notification failed:', notifyErr)
    }

    // ── Response ──
    const requiresVerification = !phoneVerified
    const message = requiresVerification
      ? 'ส่งเรื่องแจ้งซ่อมสำเร็จ กรุณารอเจ้าหน้าที่ติดต่อกลับ'
      : 'ส่งเรื่องแจ้งซ่อมสำเร็จ ติดตามสถานะได้ที่นี่'

    return NextResponse.json(
      {
        data: {
          woNumber: wo.woNumber,
          status: wo.status,
          trackableUrl: `/wo/${wo.woNumber}`,
          requiresVerification,
          message,
        },
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('POST /api/public/repairs', err)
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 },
    )
  }
}
