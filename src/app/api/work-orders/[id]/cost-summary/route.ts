import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { loadAuthorizedWorkOrder } from '@/lib/wo-authz'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import {
  buildStockItemMap,
  calcWorkOrderCost,
  type WorkOrderCostSummary,
} from '@/lib/material-cost'

/**
 * GET /api/work-orders/[id]/cost-summary
 *
 * Spec: upload/COST-ANALYTICS-SPEC.md (Phase 2 — WO integration)
 *
 * Returns a material cost summary for a work order:
 *   - inkTotal (consumable: หมึก, ผงถ่าน)
 *   - sparePartTotal (อะไหล่)
 *   - serviceTotal (บริการ)
 *   - grandTotal
 *   - avgInkCostPerPage, totalInkCoveragePages
 *   - lines: per-transaction breakdown with costType, costPerPage, costPerMonth, etc.
 *
 * Only counts APPROVED transactions (those that actually consumed stock).
 * PENDING/REJECTED transactions are excluded from totals.
 *
 * Auth: WO_VIEW_ALL (allowOwn so reporters can see their WO's cost).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'WO_VIEW_ALL')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const { id } = await params

    const result = await loadAuthorizedWorkOrder(req, id, 'WO_VIEW_ALL', {
      allowOwn: true,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { wo } = result

    // Find transactions linked by the canonical id, system number, or legacy number.
    const workOrderNumbers = [wo.woNumber, wo.systemJobNo, wo.legacyJobNo]
      .filter((value): value is string => Boolean(value && value.trim()))
      .filter((value, index, values) => values.indexOf(value) === index)
    const where = {
      type: 'OUT',
      approvalStatus: 'APPROVED',
      OR: [
        { workOrderId: wo.id },
        ...workOrderNumbers.map((workOrderNo) => ({ workOrderNo })),
      ],
    }

    const [txns, stockItems] = await Promise.all([
      db.stockTransaction.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          stockItemId: true,
          productCode: true,
          productName: true,
          quantity: true,
          unitCost: true,
          cost: true,
          workOrderNo: true,
          deviceId: true,
          txnDate: true,
        },
      }),
      db.stockItem.findMany({
        select: {
          id: true,
          productCode: true,
          productName: true,
          category: true,
          unitCost: true,
          costType: true,
          yieldPerPage: true,
          depreciationMethod: true,
          usefulLifeMonths: true,
          usefulLifePages: true,
          unit: true,
        },
      }),
    ])

    const stockItemMap = buildStockItemMap(stockItems as never)

    const summary: WorkOrderCostSummary = calcWorkOrderCost(
      wo.woNumber,
      wo.id,
      txns,
      stockItemMap,
    )

    return NextResponse.json({ data: summary })
  } catch (err) {
    console.error('GET /api/work-orders/[id]/cost-summary', err)
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to compute WO cost') : 'Internal server error',
      },
      { status: 500 },
    )
  }
}
