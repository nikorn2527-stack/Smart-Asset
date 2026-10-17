/**
 * /api/v1/meter-readings — list + create meter readings (v1 standardized shape).
 *
 * ════════════════════════════════════════════════════════════════════════
 * METER ROUTE DECISION (Phase 4.6) — DO NOT MERGE
 * ════════════════════════════════════════════════════════════════════════
 * There are three meter-related route trees in this codebase. They look
 * redundant but serve DISTINCT purposes — see the header comment in
 * /api/meter/route.ts for the full table.
 *
 * This file is the EXTERNAL API (v1) — stable contract for third-party
 * integrations. Uses the standardized `{ data, pagination, meta }`
 * envelope via `@/lib/api/response`. Internally reuses the same write
 * helpers (findValidPrevReading, assertMeterMonthWritable) as the main
 * /api/itam/meter-readings route so business rules stay consistent.
 *
 * DO NOT collapse this with /api/itam/meter-readings/* — different
 * auth helpers (requireApiAuth vs requireAuth), different response
 * envelopes, different versioning promises.
 * ════════════════════════════════════════════════════════════════════════
 *
 * ════════════════════════════════════════════════════════════════════════
 * GET /api/v1/meter-readings
 * ════════════════════════════════════════════════════════════════════════
 *   Auth: VIEW_DEVICES
 *
 *   Standard query params:
 *     ?q=search                    — search assetCode, remark, readBy
 *     ?page=1&limit=20             — pagination
 *     ?sort=-readingDate           — sort (prefix - for desc)
 *     ?filter[assetCode]=X           — exact match
 *     ?filter[readingMonth]=2026-08
 *     ?filter[readingType]=MONTHLY
 *     ?filter[readBy]=someone
 *     ?include=device              — expand device relation
 *
 *   Site-level filter: if the user's `allowedSites !== 'ALL'`, only readings
 *   whose device.site ∈ allowedSites are returned.
 *
 *   Response: { data: MeterReading[], pagination, meta }
 *
 * ════════════════════════════════════════════════════════════════════════
 * POST /api/v1/meter-readings
 * ════════════════════════════════════════════════════════════════════════
 *   Auth: METER_WRITE
 *
 *   Body: { assetCode, meterBw, meterColor?, prevMeterBw?, prevMeterColor?,
 *           readingDate?, readingMonth?, readingType?, remark?,
 *           locationAtReading?, siteAtReading?, buildingAtReading?,
 *           floorAtReading?, departmentAtReading?, departmentCodeAtReading? }
 *
 *   • assetCode required (else 400 BAD_REQUEST).
 *   • Device must exist (else 404 NOT_FOUND 'device').
 *   • User must have site access to device.site (else 403 FORBIDDEN).
 *   • If prevMeter* not provided → look up device's last reading.
 *   • page-delta via calcPagesBw / calcPagesColor (lifecycle-reading-type).
 *   • Auto-detect RESET: meter < prev and no explicit readingType → 'RESET'.
 *   • Write-lock: assertMeterMonthWritable → 409 CONFLICT { code: 'CYCLE_CLOSED' }.
 *   • Creates AuditLog (action='METER_WRITE').
 *   • Best-effort: notifyMeter + publishRealtimeEvent (fire-and-forget).
 *
 *   Response: 201 { data: MeterReading, meta }
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
  notFound,
  forbidden,
  conflict,
  serverError,
} from '@/lib/api/response'
import { requireApiAuth } from '@/lib/api/auth'
import { canAccessSite } from '@/lib/auth'
import { calcPagesBw, calcPagesColor } from '@/lib/lifecycle-reading-type'
import { assertMeterMonthWritable } from '@/lib/meter-snapshot'
import { notifyMeter } from '@/lib/notifications'
import { publishRealtimeEvent } from '@/lib/realtime'
import { findValidPrevReading, resolveReadingLocationSnapshot } from '@/lib/meter-logic'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// ── GET field map ──────────────────────────────────────────────────────
const FIELD_MAP: Record<string, string> = {
  assetCode: 'assetCode',
  readingMonth: 'readingMonth',
  readingType: 'readingType',
  readBy: 'readBy',
}

const SEARCH_FIELDS = ['assetCode', 'remark', 'readBy']

// ── GET ────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('meters')
  if (unavailable) return unavailable


  const auth = await requireApiAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const query = parseQuery(url)

  // Site-level filter: restrict to readings whose device belongs to one of
  // the user's allowed sites. Admins (allowedSites === 'ALL') see everything.
  const siteFilter =
    auth.ctx.allowedSites === 'ALL'
      ? {}
      : { device: { site: { in: auth.ctx.allowedSites } } }

  const where = { ...buildWhere(query, FIELD_MAP, SEARCH_FIELDS), ...siteFilter }
  const orderBy = buildOrderBy(query, FIELD_MAP, { readingDate: 'desc' })

  // Expand device relation when ?include=device
  const include =
    query.include.includes('device')
      ? {
          device: {
            select: {
              assetCode: true,
              brand: true,
              model: true,
              site: true,
              type: true,
            },
          },
        }
      : undefined

  const [total, readings] = await Promise.all([
    db.meterReading.count({ where }),
    db.meterReading.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include,
    }),
  ])

  return list(readings, { page: query.page, limit: query.limit, total })
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
    if (!body?.assetCode || body.meterBw === undefined || body.meterBw === null) {
      return badRequest('assetCode และ meterBw เป็นฟิลด์ที่ต้องการ', { field: 'assetCode' })
    }

    // ── Validate device exists + site access ──────────────────────────
    const device = await db.device.findUnique({ where: { assetCode: String(body.assetCode).trim() } })
    if (!device) return notFound('device')

    if (!canAccessSite(user, device.site)) {
      return forbidden('ไม่มีสิทธิ์เข้าถึงอุปกรณ์ในสาขานี้')
    }

    // ── Coerce meter values to integers ───────────────────────────────
    const meterBw = Math.floor(Number(body.meterBw))
    const meterColor = Math.floor(Number(body.meterColor || 0))

    // ── Resolve prev values — use findValidPrevReading (PROTECTED rules) ──
    // BUGFIX: Previously used a direct query (orderBy readingDate desc)
    // which bypassed the PROTECTED rules in meter-logic.ts:
    //   1. Skip FINAL/SEND_REPAIR readings (disposed/repaired devices)
    //   2. Skip same-month + future readings
    //   3. Sort by readingMonth desc (not just readingDate)
    // This caused incorrect prevMeter values when a device was recently
    // sent for repair or disposed — the v1 API would pick up the
    // FINAL/SEND_REPAIR reading as "previous", producing wrong page counts.
    const hasPrevBw = body.prevMeterBw !== undefined && body.prevMeterBw !== null
    const hasPrevColor = body.prevMeterColor !== undefined && body.prevMeterColor !== null

    // NOTE: every branch below assigns BOTH prevMeterBw and prevMeterColor, so
    // neither is ever read uninitialized. (The previous if/else-if chain left
    // TS2454 on `prevMeterColor` because the "prevColor omitted" case was
    // covered by a *nested* condition rather than by the outer branch.)
    let prevMeterBw: number
    let prevMeterColor: number
    if (hasPrevBw) {
      prevMeterBw = Math.floor(Number(body.prevMeterBw))
      // prevBw was explicitly provided but prevColor was not → default 0
      // (don't re-probe; the explicit value signals the caller knows the
      // device's meter mode).
      prevMeterColor = hasPrevColor ? Math.floor(Number(body.prevMeterColor)) : 0
    } else {
      // Use the PROTECTED findValidPrevReading function
      const targetMonth = body.readingMonth || new Date().toISOString().slice(0, 7)
      const prevReading = await findValidPrevReading(
        device.assetCode,
        targetMonth,
      )
      prevMeterBw = prevReading?.meterBw ?? 0
      // (else: both were omitted → prevMeterColor comes from the probe above)
      prevMeterColor = hasPrevColor
        ? Math.floor(Number(body.prevMeterColor))
        : (prevReading?.meterColor ?? 0)
    }

    // ── Auto-detect RESET + page-delta calc (lifecycle-reading-type) ──
    const isReset = meterBw < prevMeterBw || meterColor < prevMeterColor
    const explicitType = body.readingType || null
    const readingType = explicitType || (isReset ? 'RESET' : 'MONTHLY')
    const pagesBw = calcPagesBw(meterBw, prevMeterBw, readingType)
    const pagesColor = calcPagesColor(meterColor, prevMeterColor, readingType)

    // ── Write-lock: reject writes to CLOSED-cycle months ──────────────
    const finalReadingMonth =
      body.readingMonth || new Date().toISOString().slice(0, 7)
    try {
      await assertMeterMonthWritable(finalReadingMonth, 'บันทึกมิเตอร์')
    } catch (lockErr) {
      return conflict(
        lockErr instanceof Error ? lockErr.message : 'รอบจดมิเตอร์ถูกปิดแล้ว',
        { code: 'CYCLE_CLOSED' },
      )
    }

    // Freeze WHERE the device was when the meter was read — explicit body values
    // win (this is how the v1 contract restores a historical snapshot),
    // otherwise snapshot the device's current location. Computed before any
    // lifecycle/transfer write. See resolveReadingLocationSnapshot().
    const locationSnapshot = resolveReadingLocationSnapshot(body, device)

    // ── Create the MeterReading record ────────────────────────────────
    const reading = await db.meterReading.create({
      data: {
        deviceId: device.id,
        assetCode: device.assetCode,
        readingDate: body.readingDate || new Date().toISOString().slice(0, 10),
        readingMonth: finalReadingMonth,
        meterBw,
        meterColor,
        pagesBw,
        pagesColor,
        prevMeterBw,
        prevMeterColor,
        readBy: user.username || user.email,
        remark: body.remark || null,
        readingType,
        // ⚠️ FREEZE THE FULL LOCATION, not just the site — see the note above.
        locationAtReading: locationSnapshot.location,
        siteAtReading: locationSnapshot.site,
        buildingAtReading: locationSnapshot.building,
        floorAtReading: locationSnapshot.floor,
        departmentAtReading: locationSnapshot.department,
        departmentCodeAtReading: locationSnapshot.departmentCode,
      },
    })

    // ── Audit log (best-effort) ───────────────────────────────────────
    try {
      await db.auditLog.create({
        data: {
          action: 'METER_WRITE',
          entity: 'MeterReading',
          // METER-REDESIGN: was `saved.id` (undefined variable). The actual
          // variable holding the newly created reading is `reading` (defined
          // above on the `db.meterReading.create` call).
          entityId: reading.id,
          summary: `จดมิเตอร์ ${device.assetCode}: BW=${meterBw} สี=${meterColor} (${readingType})`,
          detail: JSON.stringify({
            assetCode: device.assetCode,
            meterBw,
            meterColor,
            prevMeterBw,
            prevMeterColor,
            pagesBw,
            pagesColor,
            readingType,
            reset: isReset,
            readingMonth: finalReadingMonth,
          }),
          actor: user.email,
        },
      })
    } catch (err) { console.error('[route]', err) }

    // ── Best-effort: notification + realtime push ─────────────────────
    void notifyMeter({
      assetCode: device.assetCode,
      pagesBw,
      pagesColor,
      by: user.username || user.email,
    })
    publishRealtimeEvent({
      type: 'meter-written',
      assetCode: device.assetCode,
      site: device.site ?? null,
      payload: { pagesBw, pagesColor, reset: isReset },
    })

    return created(reading, { reset: isReset, pagesBw, pagesColor })
  } catch (err) {
    console.error('POST /api/v1/meter-readings', err)
    return serverError()
  }
}
