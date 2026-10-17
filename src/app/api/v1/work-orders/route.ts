/**
 * ⚠️ DEPRECATED (Phase 0): This v1 API is kept for backward compatibility
 * but the frontend uses /api/work-orders/* instead. The v1 routes have
 * been hardened with site-level authz (loadAuthorizedWorkOrderV1 in
 * _shared.ts) but should be considered legacy.
 *
 * Decision pending: either migrate frontend to v1 (which has better
 * audit logging) or remove v1 entirely. See ITAM-NextJS-roadmap-
 * depreciation-consistency.md Phase 0.
 *
 * Work Orders API — list + create.
 *
 * GET /api/v1/work-orders
 *   Auth: VIEW_DEVICES  (or Bearer token for specialFee=true public filter)
 *   Query: ?status=&priority=&assignedTo=&q=search&page=1&limit=20
 *          ?specialFee=true&from=YYYY-MM-DD&to=YYYY-MM-DD  (public filter for
 *            งานพิเศษ — returns minimal projection for external apps)
 *          (also supports standard v1: ?sort=, ?filter[...]=, ?include=)
 *   Search fields: subject, building, location, reporterName, woNumber
 *   Response: { data: WorkOrder[], pagination, meta }
 *
 * POST /api/v1/work-orders
 *   Auth: DEVICE_EDIT — OR guest submission (no auth) if reporterName + tel provided.
 *   Body: { subject, building?, location?, details?, priority?,
 *           reporterName?, tel?, employeeCode?, assetNo?,
 *           externalMeta?, picBefore?, requestId?,
 *           isSpecialFee?: boolean }
 *   - Auto-generates woNumber: WO-YYYYMMDD-NNN (sequential per day)
 *   - submissionSource = 'session' if authenticated, 'guest' otherwise
 *   - trackable = !!tel
 *   - If requestId provided, check for duplicate (return existing if found)
 *   - Default status = PENDING, priority = ปกติ
 *   Response: 201 { data: WorkOrder, meta }
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { withRetryOnUnique } from '@/lib/retry-unique'
import { requireApiAuth } from '@/lib/api/auth'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import {
  parseQuery,
  buildWhere,
  buildOrderBy,
  ok,
  created,
  list,
  badRequest,
  conflict,
  serverError,
} from '@/lib/api/response'
import {
  VALID_PRIORITIES,
  generateWoNumber,
} from './_shared'

// ── Field map: API filter keys → Prisma field paths ─────────────────────
// Note: trackable is a Boolean — the v1 buildWhere helper emits string
// equality which won't match a Boolean column, so we omit it here. Use
// ?filter[trackable]=notnull / null if needed via the standard mechanism
// (also string-based, so treat that as best-effort).
// Note: WorkOrder has no `assetNo` field — removed from FIELD_MAP to
// prevent Prisma "Unknown argument" 500 errors when filtering.
const FIELD_MAP: Record<string, string> = {
  status: 'status',
  priority: 'priority',
  assignedTo: 'assignedTo',
  submissionSource: 'submissionSource',
}

const SEARCH_FIELDS = [
  'subject',
  'building',
  'location',
  'reporterName',
  'woNumber',
]

// ── GET ─────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  const url = new URL(req.url)
  const sp = url.searchParams

  // ── Public งานพิเศษ endpoint (Bearer token auth) ──
  // GET /api/v1/work-orders?specialFee=true&from=YYYY-MM-DD&to=YYYY-MM-DD
  // Returns a minimal projection of WOs where isSpecialFee=true, suitable for
  // external apps (e.g. billing/finance) to pull a list of paid work.
  const specialFeeParam = sp.get('specialFee')?.trim().toLowerCase()
  const wantsSpecialFee =
    specialFeeParam === 'true' || specialFeeParam === '1'
  if (wantsSpecialFee) {
    // Bearer token auth — any valid user token is accepted.
    const auth = await requireApiAuth(req).catch(() => null)
    if (!auth || !auth.ok) {
      return auth?.response ?? serverError('auth failed')
    }

    const from = sp.get('from')?.trim() || null
    const to = sp.get('to')?.trim() || null
    const page = Math.max(1, Number(sp.get('page') ?? '1') || 1)
    const limit = Math.min(
      100,
      Math.max(1, Number(sp.get('limit') ?? '100') || 100),
    )

    const where: Record<string, unknown> = { isSpecialFee: true }
    if (from || to) {
      const range: Record<string, Date> = {}
      if (from) range.gte = new Date(`${from}T00:00:00+07:00`)
      if (to) range.lte = new Date(`${to}T23:59:59+07:00`)
      where.createdAt = range
    }

    const [total, rows] = await Promise.all([
      db.workOrder.count({ where }),
      db.workOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          woNumber: true,
          subject: true,
          status: true,
          assignedTo: true,
          building: true,
          location: true,
          createdAt: true,
          closedAt: true,
          workCompletedAt: true,
          isSpecialFee: true,
        },
      }),
    ])

    // Compose a `site` field from building/location so external apps get a
    // single column. (Real site data lives on the device relation.)
    const data = rows.map((r) => {
      const site = r.building ?? r.location ?? null
      const closedAt = r.closedAt ?? r.workCompletedAt ?? null
      return {
        id: r.id,
        woNumber: r.woNumber,
        subject: r.subject,
        status: r.status,
        assignedTo: r.assignedTo,
        site,
        createdAt: r.createdAt,
        closedAt,
        isSpecialFee: r.isSpecialFee,
      }
    })

    return list(data, { page, limit, total })
  }

  // ── Standard authenticated list ──
  const auth = await requireApiAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) return auth.response

  const query = parseQuery(url)

  // Merge the shortcut query params (?status=&priority=&assignedTo=) into
  // the standard filter[] mechanism so buildWhere can process them.
  const mergedFilters: Record<string, string> = { ...query.filters }
  const statusParam = sp.get('status')?.trim()
  if (statusParam && !mergedFilters.status) mergedFilters.status = statusParam
  const priorityParam = sp.get('priority')?.trim()
  if (priorityParam && !mergedFilters.priority) mergedFilters.priority = priorityParam
  const assignedParam = sp.get('assignedTo')?.trim()
  if (assignedParam && !mergedFilters.assignedTo) mergedFilters.assignedTo = assignedParam

  const mergedQuery = { ...query, filters: mergedFilters }
  const where = buildWhere(mergedQuery, FIELD_MAP, SEARCH_FIELDS)

  // ── Site scope: restrict to user's allowed sites ──
  // WorkOrder has a `siteCode` field (FK-less reference). If the user's
  // allowedSites !== 'ALL', filter to WOs whose siteCode is in their list.
  // (Null siteCode = external/unassigned — only visible to admins.)
  const siteFilter =
    auth.ctx.allowedSites === 'ALL'
      ? {}
      : { siteCode: { in: auth.ctx.allowedSites } }
  const scopedWhere = { ...where, ...siteFilter }

  const orderBy = buildOrderBy(query, FIELD_MAP, { createdAt: 'desc' })

  const [total, orders] = await Promise.all([
    db.workOrder.count({ where: scopedWhere }),
    db.workOrder.findMany({
      where: scopedWhere,
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ])

  return list(orders, { page: query.page, limit: query.limit, total })
}

// ── POST ────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  // Try auth first — but allow guest submission if reporterName + tel provided.
  const auth = await requireApiAuth(req, 'DEVICE_EDIT')
  const isAuthed = auth.ok
  // If auth failed AND it's not a "missing token / forbidden" situation that
  // could be a guest submission, return the error.
  // We treat missing-token (401) as "guest attempt" and let it through if
  // guest fields are provided. A 403 (insufficient permission for a logged-in
  // user) is still returned to the user — we never silently down-grade perms.
  if (!isAuthed) {
    // Only 401 (missing/expired token) may fall through to guest. 403 stays forbidden.
    const status = auth.response.status
    if (status !== 401) return auth.response
  }

  try {
    const body = await req.json()
    const subject = String(body.subject ?? '').trim()
    const reporterName = String(body.reporterName ?? '').trim()
    const tel = String(body.tel ?? '').trim()
    const employeeCode = String(body.employeeCode ?? '').trim() || null

    // Guest submissions require reporterName + tel
    if (!isAuthed) {
      if (!reporterName || !tel) {
        return badRequest(
          'การแจ้งซ่อมโดยไม่ล็อกอินต้องระบุชื่อผู้แจ้งและเบอร์โทรศัพท์',
          { field: 'reporterName' },
        )
      }
    }

    if (!subject) {
      return badRequest('subject (ประเภทปัญหา) เป็นฟิลด์ที่ต้องการ', {
        field: 'subject',
      })
    }

    const priorityRaw = body.priority ? String(body.priority).trim() : 'ปกติ'
    if (!VALID_PRIORITIES.has(priorityRaw)) {
      return badRequest(
        `priority ต้องเป็นหนึ่งใน: ${[...VALID_PRIORITIES].join(', ')}`,
        { field: 'priority' },
      )
    }

    // Dedup by client-provided requestId
    const requestId = body.requestId ? String(body.requestId).trim() : null
    if (requestId) {
      const existing = await db.workOrder.findFirst({
        where: { requestId },
      })
      if (existing) {
        // Return existing — idempotent submission
        return ok(existing)
      }
    }

    const submissionSource = isAuthed ? 'session' : 'guest'

    // Authed user context (if any)
    const userRow = isAuthed ? auth.ctx.user : null
    const userEmail = userRow?.email ?? null

    // reporterEmail — when authed, defaults to user's email
    const reporterEmail = body.reporterEmail
      ? String(body.reporterEmail).trim()
      : isAuthed
        ? userEmail
        : null

    // externalMeta — store as JSON string (Prisma scalar)
    let externalMeta: string | null = null
    if (body.externalMeta && typeof body.externalMeta === 'object') {
      externalMeta = JSON.stringify(body.externalMeta)
    } else if (typeof body.externalMeta === 'string' && body.externalMeta.trim()) {
      externalMeta = body.externalMeta.trim()
    }

    // QA FIX: WorkOrder has no assetCode column. Look up Device by assetCode.
    let deviceId: string | null = null
    const rawAssetCode = typeof body.assetCode === 'string' ? body.assetCode.trim() : ''
    if (rawAssetCode) {
      const device = await db.device.findUnique({ where: { assetCode: rawAssetCode }, select: { id: true } })
      deviceId = device?.id ?? null
    }
    // FIX-024: wrap create with retry-on-P2002 — the auto-generated
    // `WO-YYYYMMDD-NNN` number races under concurrent inserts. On a unique
    // violation, re-generate the woNumber (the winner's row is now visible
    // to generateWoNumber's max-seq lookup) and retry.
    const order = await withRetryOnUnique(async () => {
      const freshWoNumber = await generateWoNumber()
      return db.workOrder.create({
        data: {
          woNumber: freshWoNumber,
          requestId,
          subject,
          building: body.building ? String(body.building).trim() : null,
          location: body.location ? String(body.location).trim() : null,
          details: body.details ? String(body.details) : null,
          priority: priorityRaw,
          reporterName: reporterName || null,
          reporterEmail,
          tel: tel || null,
          employeeCode,
          submissionSource,
          trackable: !!tel,
          externalMeta,
          picBefore: body.picBefore ? String(body.picBefore) : null,
          status: 'PENDING',
          deviceId,
          isSpecialFee: body.isSpecialFee === true,
        },
      })
    })

    // Audit log
    await logAudit(
      'WO_CREATE',
      'WorkOrder',
      order.id,
      `สร้างใบแจ้งซ่อม ${order.woNumber} (${order.subject}) โดย ${
        isAuthed ? userEmail : 'ผู้แจ้งภายนอก'
      }`,
      {
        woNumber: order.woNumber,
        subject: order.subject,
        priority: order.priority,
        submissionSource: order.submissionSource,
        trackable: order.trackable,
        assetCode: rawAssetCode || null,
      deviceId: order.deviceId,
      },
      userEmail,
    )

    return created(order)
  } catch (err) {
    console.error('POST /api/v1/work-orders', err)
    if (err instanceof Error && err.message.includes('unique')) {
      return conflict('woNumber ซ้ำ กรุณาลองใหม่อีกครั้ง', {
        code: 'DUPLICATE_WO_NUMBER',
      })
    }
    return serverError()
  }
}
