import { NextRequest, NextResponse } from 'next/server'
import { db, getBaseClient } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { isDemoUser } from '@/lib/demo-mode'

/**
 * POST /api/itam/demo/reset — wipe every record tagged `isDemo: true`.
 *
 * Requires the `ADMIN` permission. Deleting in dependency order so
 * StockTransaction → Device relation (SetNull) doesn't choke — we delete
 * transactions first, then devices. WorkOrder deletes cascade to messages/
 * reviews/images via Prisma onDelete, so order matters less for them, but
 * we still go children-first for clarity.
 *
 * Demo USERS are NOT deleted by this endpoint — they're the login
 * identities for the demo flow. Run `scripts/create-demo-users.js` to
 * recreate them.
 *
 * Response: { deleted: { devices, workOrders, stockTransactions, meterReadings } }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req, 'ADMIN')
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Use a transaction so a failure in the middle rolls everything back.
    const result = await getBaseClient().$transaction(async (tx) => {
      // 1. StockTransactions (children — references Device + StockItem)
      const stockTxns = await tx.stockTransaction.deleteMany({
        where: { isDemo: true },
      })
      // 2. MeterReadings (children — references Device via onDelete: Cascade,
      //    but if any were tagged standalone, we wipe them explicitly.)
      const meterReadings = await tx.meterReading.deleteMany({
        where: { isDemo: true },
      })
      // 3. WorkOrders — cascade-deletes their messages/reviews/images
      const workOrders = await tx.workOrder.deleteMany({
        where: { isDemo: true },
      })
      // 4. Devices — last so child references are already gone
      const devices = await tx.device.deleteMany({
        where: { isDemo: true },
      })

      return {
        devices: devices.count,
        workOrders: workOrders.count,
        stockTransactions: stockTxns.count,
        meterReadings: meterReadings.count,
      }
    })

    // Best-effort audit log
    try {
      await db.auditLog.create({
        data: {
          action: 'DEMO_RESET',
          entity: 'Demo',
          entityId: null,
          summary: `ล้างข้อมูลสาธิต: devices=${result.devices} workOrders=${result.workOrders} stockTxns=${result.stockTransactions} meter=${result.meterReadings}`,
          detail: JSON.stringify(result),
          actor: auth.user.email + (isDemoUser(auth.user) ? ' (demo)' : ''),
        },
      })
    } catch (err) { console.error('[route]', err) }

    return NextResponse.json({ deleted: result })
  } catch (err) {
    console.error('POST /api/itam/demo/reset', err)
    return NextResponse.json(
      {
        error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to reset demo data') : 'Internal server error',
      },
      { status: 500 },
    )
  }
}

/**
 * GET /api/itam/demo/reset — preview the demo record counts without deleting.
 * Useful for the Settings → สาธิตระบบ tab to show "X records will be wiped".
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req, 'ADMIN')
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const [devices, workOrders, stockTransactions, meterReadings, users] =
      await Promise.all([
        db.device.count({ where: { isDemo: true } }),
        db.workOrder.count({ where: { isDemo: true } }),
        db.stockTransaction.count({ where: { isDemo: true } }),
        db.meterReading.count({ where: { isDemo: true } }),
        db.user.count({ where: { isDemo: true } }),
      ])

    return NextResponse.json({
      counts: {
        devices,
        workOrders,
        stockTransactions,
        meterReadings,
        users,
      },
    })
  } catch (err) {
    console.error('GET /api/itam/demo/reset', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to fetch demo counts') : 'Internal server error' },
      { status: 500 },
    )
  }
}
