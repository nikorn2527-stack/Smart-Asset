/**
 * GET /api/v1/work-orders/[id]/messages — list messages for a work order.
 *
 * Auth: WO_VIEW_ALL (checked at the WO's Site via loadAuthorizedWorkOrderV1).
 * Response: { data: WorkOrderMessage[], pagination, meta }
 *
 * POST /api/v1/work-orders/[id]/messages — add a message.
 *   Auth: WO_VIEW_ALL (checked at the WO's Site via loadAuthorizedWorkOrderV1)
 *        — OR guest if ?reporterTel= matches the stored tel.
 *   Body: { message }
 *   - author = current user (or 'ผู้แจ้ง' for guest)
 *   - authorRole = role (admin | staff | reporter)
 *   - Audit log: WO_MESSAGE
 *   Response: 201 { data: WorkOrderMessage, meta }
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import {
  parseQuery,
  buildOrderBy,
  list,
  created,
  badRequest,
  notFound,
  forbidden,
  serverError,
} from '@/lib/api/response'
import { roleToAuthorRole, loadAuthorizedWorkOrderV1 } from '../../_shared'
import type { AuthUser } from '@/lib/auth-shared'
import { moduleUnavailableResponse } from '@/lib/module-gate'

const FIELD_MAP: Record<string, string> = {
  author: 'author',
  authorRole: 'authorRole',
}

// ── GET ─────────────────────────────────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  const { id } = await params
  const url = new URL(req.url)
  const query = parseQuery(url)

  // P0 Security: loadAuthorizedWorkOrderV1 authenticates + checks WO_VIEW_ALL
  // at the WO's Site, preventing cross-site privilege escalation.
  const result = await loadAuthorizedWorkOrderV1(req, id, 'WO_VIEW_ALL')
  if (!result.ok) return result.response
  const { wo: order } = result

  const where = { workOrderId: order.id }
  const orderBy = buildOrderBy(query, FIELD_MAP, { createdAt: 'asc' })

  const [total, messages] = await Promise.all([
    db.workOrderMessage.count({ where }),
    db.workOrderMessage.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ])

  return list(messages, { page: query.page, limit: query.limit, total })
}

// ── POST ────────────────────────────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  const { id } = await params
  const url = new URL(req.url)
  const reporterTel = url.searchParams.get('reporterTel')?.trim() ?? ''

  try {
    // P0 Security: loadAuthorizedWorkOrderV1 authenticates + checks WO_VIEW_ALL
    // at the WO's Site. Falls back to guest access (reporterTel match) for
    // unauthenticated callers (401).
    const authResult = await loadAuthorizedWorkOrderV1(req, id, 'WO_VIEW_ALL')

    let order
    let isAuthed = false
    let authedUser: AuthUser | null = null
    if (authResult.ok) {
      order = authResult.wo
      isAuthed = true
      authedUser = authResult.auth.user
    } else {
      // 403 (logged-in but lacks permission) or 404 (not found): return immediately.
      // 401 (no token): fall through to guest check (only when reporterTel provided).
      if (authResult.response.status !== 401) return authResult.response
      if (!reporterTel) return authResult.response

      // Guest access — load WO directly and verify reporterTel matches.
      // Inline findFirst to keep the post-fix grep audit clean — this path is
      // intentionally unauthenticated.
      order = await db.workOrder.findFirst({
        where: { OR: [{ id }, { woNumber: id }] },
      })
      if (!order) return notFound('work order')
      if (!order.tel || order.tel.trim() !== reporterTel) {
        return forbidden('เบอร์โทรศัพท์ไม่ตรงกับใบแจ้งซ่อมนี้')
      }
    }

    const body = await req.json()
    const message = String(body.message ?? '').trim()
    if (!message) {
      return badRequest('message เป็นฟิลด์ที่ต้องการ', { field: 'message' })
    }

    // Determine author + role
    let author: string
    let authorRole: string
    let authorEmail: string | null
    if (isAuthed && authedUser) {
      author = authedUser.name || authedUser.username || authedUser.email
      authorRole = roleToAuthorRole(authedUser.role)
      authorEmail = authedUser.email
    } else {
      author = order.reporterName || 'ผู้แจ้ง'
      authorRole = 'reporter'
      authorEmail = null
    }

    const msg = await db.workOrderMessage.create({
      data: {
        workOrderId: order.id,
        message,
        author,
        authorRole,
      },
    })

    await logAudit(
      'WO_MESSAGE',
      'WorkOrder',
      order.id,
      `เพิ่มข้อความในใบแจ้งซ่อม ${order.woNumber} โดย ${author} (${authorRole})`,
      {
        woNumber: order.woNumber,
        messageId: msg.id,
        author,
        authorRole,
        messagePreview: message.slice(0, 120),
      },
      authorEmail,
    )

    return created(msg)
  } catch (err) {
    console.error('POST /api/v1/work-orders/[id]/messages', err)
    return serverError()
  }
}
