import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * GET /api/cycles/[id]/amendments
 *
 * Bug L foundation — list all amendments for a given cycle.
 *
 * Returns an array of MeterReportAmendment rows ordered by amendedAt desc.
 * Requires METER_WRITE permission (same as reopening a cycle — amendments
 * affect closed billing data).
 *
 * NOTE: This is a foundation endpoint. The actual amendment creation +
 * snapshot revision is a follow-up task (QA report: "งานออกแบบ+สร้างใหม่
 * วางแผนเป็น sprint แยก ไม่เร่งด่วน").
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('meters')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'VIEW_DASHBOARD')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params
    const amendments = await db.meterReportAmendment.findMany({
      where: { cycleId: id },
      orderBy: { amendedAt: 'desc' },
    })
    return NextResponse.json({ amendments })
  } catch (err) {
    console.error('GET /api/cycles/[id]/amendments', err)
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === 'development'
            ? err instanceof Error
              ? err.message
              : 'Failed'
            : 'Internal server error',
      },
      { status: 500 },
    )
  }
}
