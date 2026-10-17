import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { POST as postCanonicalTransfer } from '@/app/api/itam/devices/[id]/transfer/route'
import { moduleUnavailableResponse } from '@/lib/module-gate'

type TransferRow = {
  fromDepartment?: string | null
  toDepartment?: string | null
  fromDepartmentCode?: string | null
  toDepartmentCode?: string | null
  [key: string]: unknown
}

/** Keep legacy response aliases while persisting canonical Prisma field names. */
function toLegacyTransferShape<T extends TransferRow>(transfer: T) {
  return {
    ...transfer,
    fromDept: transfer.fromDepartment ?? null,
    toDept: transfer.toDepartment ?? null,
    fromDeptCode: transfer.fromDepartmentCode ?? null,
    toDeptCode: transfer.toDepartmentCode ?? null,
  }
}

function normalizeLegacyTransferBody(body: Record<string, unknown>) {
  return {
    ...body,
    // Legacy UI used toDept/toDeptCode; canonical route uses explicit names.
    toDepartment: body.toDepartment ?? body.toDept ?? null,
    toDepartmentCode: body.toDepartmentCode ?? body.toDeptCode ?? null,
    // The old route accepted transferDate and canonical route now preserves it.
    transferDate: body.transferDate ?? body.moveDate ?? null,
    // A legacy transfer is a location action, not an implicit status change.
    toStatus: body.toStatus ?? body.status ?? undefined,
  }
}

async function callCanonicalTransfer(
  req: NextRequest,
  params: { id: string },
  body: Record<string, unknown>,
) {
  const forwardedHeaders = new Headers(req.headers)
  forwardedHeaders.delete('content-length')
  const forwardedRequest = new NextRequest(req.url, {
    method: 'POST',
    headers: forwardedHeaders,
    body: JSON.stringify(normalizeLegacyTransferBody(body)),
  })
  return postCanonicalTransfer(forwardedRequest, { params: Promise.resolve(params) })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const transfers = await db.deviceTransfer.findMany({
      where: { deviceId: id },
      orderBy: [{ transferDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    })
    return NextResponse.json({
      transfers: transfers.map((transfer) => toLegacyTransferShape(transfer)),
    })
  } catch (err) {
    console.error('GET /api/devices/[id]/transfer', err)
    return NextResponse.json(
      { error: 'Failed to fetch transfers' },
      { status: 500 },
    )
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'DEVICE_TRANSFER')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const resolvedParams = await params
    const body = await req.json() as Record<string, unknown>
    const response = await callCanonicalTransfer(req, resolvedParams, body)
    const payload = await response.json() as Record<string, unknown>

    if (response.status >= 400) {
      return NextResponse.json(payload, { status: response.status })
    }

    const locationHistory = payload.locationHistory
    return NextResponse.json(
      {
        ...payload,
        // Preserve the response key expected by older Device callers.
        transfer: locationHistory && typeof locationHistory === 'object'
          ? toLegacyTransferShape(locationHistory as TransferRow)
          : locationHistory,
      },
      { status: response.status },
    )
  } catch (err) {
    console.error('POST /api/devices/[id]/transfer', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to transfer') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
