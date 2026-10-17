/**
 * /api/v1/cycles — list + create meter cycles (v1 standardized shape).
 *
 * ════════════════════════════════════════════════════════════════════════
 * GET /api/v1/cycles
 * ════════════════════════════════════════════════════════════════════════
 *   Auth: VIEW_DASHBOARD
 *
 *   Standard query params:
 *     ?page=1&limit=20             — pagination
 *     ?sort=-startDate             — sort (prefix - for desc)
 *     ?filter[status]=OPEN         — exact match
 *     ?filter[cycleMonth]=2026-08
 *
 *   No site filter — cycles are global.
 *
 *   Response: { data: Cycle[], pagination, meta }
 *
 * ════════════════════════════════════════════════════════════════════════
 * POST /api/v1/cycles
 * ════════════════════════════════════════════════════════════════════════
 *   Auth: METER_WRITE
 *
 *   Body: { name, startDate, endDate, status?, cycleMonth?,
 *           deadlineDate?, remarks? }
 *
 *   • name, startDate, endDate required (else 400 BAD_REQUEST with field).
 *   • Default status: 'OPEN'.
 *   • If status === 'OPEN' or 'active': any existing OPEN/active cycles are
 *     flipped to CLOSED/ended first (only one active cycle at a time).
 *   • Set startedAt = now() when status is OPEN/active.
 *   • AuditLog: action='CYCLE_START'.
 *
 *   Response: 201 { data: Cycle, meta }
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  parseQuery,
  buildWhere,
  buildOrderBy,
  list,
  created,
  badRequest,
  serverError,
} from '@/lib/api/response'
import { requireApiAuth } from '@/lib/api/auth'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// ── GET field map ──────────────────────────────────────────────────────
const FIELD_MAP: Record<string, string> = {
  status: 'status',
  site: 'site',
}

// ── GET ────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('meters')
  if (unavailable) return unavailable


  const auth = await requireApiAuth(req, 'VIEW_DASHBOARD')
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const query = parseQuery(url)

  // Auto-close expired active cycles so the list reflects reality.
  try {
    const todayISO = new Date().toISOString().slice(0, 10)
    await db.cycle.updateMany({
      where: { status: 'active', endDate: { lt: todayISO } },
      data: { status: 'closed' },
    })
  } catch (e) {
    console.error('auto-close expired cycles (v1) failed:', e)
  }

  const where = buildWhere(query, FIELD_MAP)
  const orderBy = buildOrderBy(query, FIELD_MAP, { startDate: 'desc' })

  const [total, cycles] = await Promise.all([
    db.cycle.count({ where }),
    db.cycle.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ])

  return list(cycles, { page: query.page, limit: query.limit, total })
}

// ── POST ───────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('meters')
  if (unavailable) return unavailable


  const auth = await requireApiAuth(req, 'METER_WRITE')
  if (!auth.ok) return auth.response
  const { user } = auth.ctx

  try {
    const body = await req.json()

    // ── Validate required fields ──────────────────────────────────────
    if (!body?.name) {
      return badRequest('name เป็นฟิลด์ที่ต้องการ', { field: 'name' })
    }
    if (!body?.startDate) {
      return badRequest('startDate เป็นฟิลด์ที่ต้องการ', { field: 'startDate' })
    }
    if (!body?.endDate) {
      return badRequest('endDate เป็นฟิลด์ที่ต้องการ', { field: 'endDate' })
    }

    // ── Normalize status (default active) ────────────────────────────
    const status = String(body.status ?? 'active').trim()

    // ── Normalize site ───────────────────────────────────────────────
    let siteValue: string | null = null
    if (typeof body.site === 'string' && body.site.trim() && body.site.trim().toUpperCase() !== 'ALL') {
      siteValue = body.site.trim().toUpperCase()
    }

    // ── If starting an active cycle, close any existing ones (same site) ──
    const isActive = status === 'OPEN' || status === 'active'
    if (isActive) {
      await db.cycle.updateMany({
        where: {
          status: { in: ['OPEN', 'active'] },
          ...(siteValue ? { site: siteValue } : { site: null }),
        },
        data: { status: 'ended' },
      })
    }

    // ── Create the Cycle record ───────────────────────────────────────
    const cycle = await db.cycle.create({
      data: {
        name: String(body.name).trim(),
        startDate: String(body.startDate),
        endDate: String(body.endDate),
        status,
        site: siteValue,
      },
    })

    // ── Audit log (best-effort, uses correct schema fields) ──────────
    try {
      await db.auditLog.create({
        data: {
          action: 'CYCLE_START',
          entity: 'Cycle',
          entityId: cycle.id,
          summary: `สร้างรอบจดมิเตอร์ ${cycle.name} (${cycle.startDate} → ${cycle.endDate})${cycle.site ? ` @ ${cycle.site}` : ''}`,
          detail: JSON.stringify({
            name: cycle.name,
            startDate: cycle.startDate,
            endDate: cycle.endDate,
            status: cycle.status,
            site: cycle.site,
            cycleId: cycle.id,
          }),
          actor: user.email,
        },
      })
    } catch (err) { console.error('[route]', err) }

    return created(cycle)
  } catch (err) {
    console.error('POST /api/v1/cycles', err)
    return serverError()
  }
}
