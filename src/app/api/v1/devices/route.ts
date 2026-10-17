/**
 * GET /api/v1/devices — list devices with search, filter, pagination, sort.
 *
 * Query params (standard v1):
 *   ?q=search                      — search assetNo, brand, model, serial
 *   ?page=1&limit=20               — pagination
 *   ?sort=-createdAt               — sort (prefix - for desc)
 *   ?filter[status]=Active         — exact match
 *   ?filter[deviceType]=in:A,B     — IN filter
 *   ?filter[site]=null             — IS NULL
 *   ?include=meterReadings         — expand relations
 *   ?fields=id,assetNo,brand       — sparse fieldset
 *
 * Response: { data: Device[], pagination: {...}, meta: {...} }
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { parseQuery, buildWhere, buildOrderBy, list, ok } from '@/lib/api/response'
import { requireApiAuth } from '@/lib/api/auth'

// API filter keys → Prisma field paths
const FIELD_MAP: Record<string, string> = {
  status: 'status',
  deviceType: 'deviceType',
  type: 'deviceType', // alias
  site: 'site',
  brand: 'brand',
  meterRequired: 'meterRequired',
  assetSiteCode: 'assetSiteCode',
}

const SEARCH_FIELDS = ['assetCode', 'brand', 'model', 'serialNumber', 'department', 'location']

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) return auth.response
  const { user } = auth.ctx

  const url = new URL(req.url)
  const query = parseQuery(url)

  // Site-level filter: restrict to user's allowed sites
  const siteFilter =
    auth.ctx.allowedSites === 'ALL'
      ? {}
      : { site: { in: auth.ctx.allowedSites } }

  const where = { ...buildWhere(query, FIELD_MAP, SEARCH_FIELDS), ...siteFilter }
  const orderBy = buildOrderBy(query, FIELD_MAP, {
    assetCode: 'asc',
  })

  // Parallel: count + fetch
  const [total, devices] = await Promise.all([
    db.device.count({ where }),
    db.device.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      // Expand relations if requested
      include:
        query.include.includes('meterReadings')
          ? { meterReadings: { take: 5, orderBy: { readingDate: 'desc' as const } } }
          : undefined,
    }),
  ])

  return list(devices, { page: query.page, limit: query.limit, total })
}

/**
 * POST /api/v1/devices — create a new device.
 * Body: Device fields (assetNo required, rest optional).
 * Response: 201 { data: Device, meta }
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, 'DEVICE_EDIT')
  if (!auth.ok) return auth.response

  try {
    const body = await req.json()
    if (!body.assetCode) {
      const { badRequest } = await import('@/lib/api/response')
      return badRequest('assetCode เป็นฟิลด์ที่ต้องการ', { field: 'assetCode' })
    }

    const created = await db.device.create({
      data: {
        assetCode: String(body.assetCode).trim(),
        name: body.name || String(body.assetCode).trim(),
        type: body.type ?? null,
        brand: body.brand ?? null,
        model: body.model ?? null,
        serialNumber: body.serialNumber ?? null,
        building: body.building ?? null,
        floor: body.floor ?? null,
        department: body.department ?? null,
        location: body.location ?? null,
        status: body.status ?? 'Active',
        site: body.site ?? null,
        meterRequired: Boolean(body.meterRequired),
        meterMode: body.meterMode ?? null,
        purchaseDate: body.purchaseDate ?? null,
        warrantyEnd: body.warrantyEnd ?? null,
        deviceGroup: body.deviceGroup ?? null,
        costCenter: body.costCenter ?? null,
        updatedBy: auth.ctx.user.email,
      },
    })

    // Audit log — use the shared logAudit helper so field names are correct
    // (AuditLog columns: action, entity, entityId, summary, detail, actor, siteCode, createdAt)
    await logAudit(
      'CREATE',
      'Device',
      created.id,
      `เพิ่มอุปกรณ์ ${created.assetCode}`,
      { entity: 'Device', assetCode: created.assetCode, ...body },
      auth.ctx.user.email,
    )

    const { created: createdResp } = await import('@/lib/api/response')
    return createdResp(created)
  } catch (err) {
    const { conflict, serverError } = await import('@/lib/api/response')
    if (err instanceof Error && err.message.includes('unique')) {
      return conflict('assetCode นี้มีอยู่แล้วในระบบ', { code: 'DUPLICATE_ASSET_NO', field: 'assetCode' })
    }
    console.error('POST /api/v1/devices', err)
    return serverError()
  }
}
