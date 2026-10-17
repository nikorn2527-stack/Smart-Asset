import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { loadAuthorizedWorkOrder } from '@/lib/wo-authz'
import { suggestUsageForWoParts } from '@/lib/wo-usage'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * GET /api/work-orders/[id]/parts/suggest-usage?stockItemIds=id1,id2,id3
 *
 * Returns suggested usageHours + usagePages for each requested stockItem
 * based on the WO's assignment/completion timestamps + the device's meter
 * reading delta since the last part swap.
 *
 * Used by the parts picker UI to pre-fill the optional "ชั่วโมง" + "หน้าพิมพ์"
 * inputs with auto-calculated values. Technicians can override.
 *
 * Auth: requires WO_VIEW_ALL or WO_ASSIGN at the WO's site.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req)
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { id } = await params
    const result = await loadAuthorizedWorkOrder(req, id, 'WO_VIEW_ALL', { allowOwn: true })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const { searchParams } = new URL(req.url)
    const stockItemIdsParam = searchParams.get('stockItemIds') ?? ''
    const stockItemIds = stockItemIdsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    if (stockItemIds.length === 0) {
      return NextResponse.json({ data: {} })
    }

    const suggestions = await suggestUsageForWoParts(id, stockItemIds)

    return NextResponse.json({ data: suggestions })
  } catch (err) {
    console.error('GET /api/work-orders/[id]/parts/suggest-usage', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed') : 'Internal server error' },
      { status: 500 },
    )
  }
}
