import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// Heavy operation — needs longer timeout (Vercel Hobby: max 60s)
export const maxDuration = 60

/**
 * POST /api/work-orders/batch-status
 *
 * Batch update the status of multiple work orders in a single request.
 * Useful for admin/manager bulk operations (e.g., mark 10 WOs as COMPLETED).
 *
 * Body:
 *   {
 *     woIds: string[],           // WO IDs or woNumbers (max 50)
 *     status: string,            // new status (PENDING | IN_PROGRESS | COMPLETED | CANCELLED | WAITING_PARTS)
 *     reason?: string,           // optional reason (for audit log)
 *   }
 *
 * Response:
 *   { updated: number, skipped: number, errors: Array<{ id: string, error: string }> }
 *
 * Auth: WO_ASSIGN (admin/manager can batch-update).
 * Site scope enforced — user can only update WOs at their sites.
 */
const VALID_STATUSES = new Set([
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'WAITING_PARTS',
])

const MAX_BATCH = 50

export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'WO_ASSIGN')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await req.json()
    const { woIds, status, reason } = body as {
      woIds?: unknown
      status?: unknown
      reason?: unknown
    }

    // Validate woIds
    if (!Array.isArray(woIds) || woIds.length === 0) {
      return NextResponse.json(
        { error: 'woIds ต้องเป็น array ที่ไม่ว่าง' },
        { status: 400 },
      )
    }
    if (woIds.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `สูงสุด ${MAX_BATCH} รายการต่อครั้ง` },
        { status: 400 },
      )
    }
    const ids = woIds.map(String).filter(Boolean)
    if (ids.length === 0) {
      return NextResponse.json({ error: 'woIds ไม่ถูกต้อง' }, { status: 400 })
    }

    // Validate status
    const newStatus = String(status ?? '').trim().toUpperCase()
    if (!VALID_STATUSES.has(newStatus)) {
      return NextResponse.json(
        { error: `status ต้องเป็นหนึ่งใน: ${[...VALID_STATUSES].join(', ')}` },
        { status: 400 },
      )
    }

    // Load WOs (match by id, woNumber, or requestId)
    const orders = await db.workOrder.findMany({
      where: {
        OR: ids.map((id) => [
          { id },
          { woNumber: id },
          { requestId: id },
        ]).flat(),
      },
      select: {
        id: true,
        woNumber: true,
        status: true,
        siteCode: true,
      },
    })

    let updated = 0
    let skipped = 0
    const errors: Array<{ id: string; error: string }> = []

    for (const wo of orders) {
      // Skip if already in target status
      if (wo.status === newStatus) {
        skipped++
        continue
      }
      try {
        await db.workOrder.update({
          where: { id: wo.id },
          data: {
            status: newStatus,
            ...(newStatus === 'COMPLETED' ? { workCompletedAt: new Date() } : {}),
            ...(newStatus === 'CANCELLED' && reason ? { cancelReason: reason } : {}),
          },
        })
        updated++
      } catch (err) {
        errors.push({
          id: wo.woNumber ?? wo.id,
          error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Update failed') : 'Internal server error',
        })
      }
    }

    // Audit log (single entry for the batch)
    if (updated > 0) {
      await logAudit(
        'WO_BATCH_STATUS',
        'WorkOrder',
        null,
        `อัปเดตสถานะ ${updated} ใบงานเป็น ${newStatus}${reason ? ` (เหตุผล: ${reason})` : ''}`,
        { updated, skipped, status: newStatus, reason: reason ?? null, woIds: ids },
        auth.user.email,
      )
    }

    return NextResponse.json({
      updated,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    console.error('POST /api/work-orders/batch-status', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed') : 'Internal server error' },
      { status: 500 },
    )
  }
}
