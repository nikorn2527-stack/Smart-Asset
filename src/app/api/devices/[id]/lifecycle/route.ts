import { NextRequest, NextResponse } from 'next/server'
import { POST as postCanonicalLifecycle } from '@/app/api/itam/devices/[id]/lifecycle/route'
import { moduleUnavailableResponse } from '@/lib/module-gate'

function normalizeLegacyLifecycleBody(body: Record<string, unknown>) {
  return {
    ...body,
    toStatus: body.toStatus ?? body.status,
    toDepartment: body.toDepartment ?? body.toDept,
    toDepartmentCode: body.toDepartmentCode ?? body.toDeptCode,
    actionDate: body.actionDate ?? body.transferDate ?? body.moveDate,
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  try {
    const resolvedParams = await params
    const body = await req.json() as Record<string, unknown>
    const forwardedHeaders = new Headers(req.headers)
    forwardedHeaders.delete('content-length')
    const forwardedRequest = new NextRequest(req.url, {
      method: 'POST',
      headers: forwardedHeaders,
      body: JSON.stringify(normalizeLegacyLifecycleBody(body)),
    })
    const response = await postCanonicalLifecycle(forwardedRequest, {
      params: Promise.resolve(resolvedParams),
    })
    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch (err) {
    console.error('POST /api/devices/[id]/lifecycle', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Lifecycle update failed') : 'Internal server error' },
      { status: 500 },
    )
  }
}
