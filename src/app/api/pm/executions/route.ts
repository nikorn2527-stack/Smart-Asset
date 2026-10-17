import { generateScheduledDatesForMonth } from '@/lib/pm-schedule'
import { pmAccess } from '@/lib/pm-access'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { normalizeSiteCode } from '@/lib/site-scope'

/**
 * Derive the effective Site code for a PM schedule.
 * Returns null when the schedule is not tied to a specific Site.
 */
function derivePMScheduleSite(
  schedule: { site: string | null; device?: { site: string | null } | null },
): string | null {
  return normalizeSiteCode(schedule.site ?? schedule.device?.site ?? null)
}

/**
 * GET /api/pm/executions?scheduleId=&status=&from=&to=
 *
 * Returns executions, optionally filtered.
 */
export async function GET(req: NextRequest) {
  const access = await pmAccess(req, 'VIEW_DASHBOARD')
  if (!access.ok) return access.response
  try {
    const { searchParams } = new URL(req.url)
    const scheduleId = searchParams.get('scheduleId')?.trim() ?? ''
    const status = searchParams.get('status')?.trim() ?? ''
    const from = searchParams.get('from')?.trim() ?? ''
    const to = searchParams.get('to')?.trim() ?? ''
    const limit = Math.min(100, Number(searchParams.get('limit') ?? 50))

    const where: Record<string, unknown> = {}
    if (scheduleId) where.scheduleId = scheduleId
    if (status) where.status = status
    if (from || to) {
      where.scheduledDate = {}
      if (from) (where.scheduledDate as Record<string, unknown>).gte = from
      if (to) (where.scheduledDate as Record<string, unknown>).lte = to
    }
    where.schedule = access.scope

    const executions = await db.pMExecution.findMany({
      where,
      orderBy: { scheduledDate: 'desc' },
      take: limit,
      include: {
        schedule: {
          select: {
            id: true,
            scheduleNo: true,
            title: true,
            frequency: true,
            deviceType: true,
            site: true,
            assignedTo: true,
            checklist: true,
            device: { select: { id: true, assetCode: true, name: true, type: true, site: true } },
          },
        },
      },
    })

    return NextResponse.json({ data: executions })
  } catch (err) {
    console.error('GET /api/pm/executions', err)
    return NextResponse.json({ error: 'Failed to fetch executions' }, { status: 500 })
  }
}

/**
 * POST /api/pm/executions
 * Creates a new PMExecution (typically called when starting a PM).
 * Body: { scheduleId, scheduledDate, workOrderId? }
 */
export async function POST(req: NextRequest) {
  const access = await pmAccess(req, 'WO_CREATE')
  if (!access.ok) return access.response
  const { auth, ctx } = access
  try {
    const body = await req.json()
    if (!body.scheduleId || !body.scheduledDate) {
      return NextResponse.json(
        { error: 'Missing required fields: scheduleId, scheduledDate' },
        { status: 400 },
      )
    }

    // Verify schedule exists (include device.site to derive Site)
    const schedule = await db.pMSchedule.findFirst({
      where: { id: body.scheduleId, ...access.scope },
      include: { device: { select: { site: true } } },
    })
    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }
    // P1 FIX (AUDIT-FINDINGS-FIX-018): Site-level access control — caller
    // must have WO_CREATE at the schedule's Site. Schedules with no Site
    // ("all sites") bypass this check.
    const scheduleSite = derivePMScheduleSite(schedule)
    if (scheduleSite && !ctx.canAtSite(scheduleSite, 'WO_CREATE')) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    const scheduledDate = String(body.scheduledDate)
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(scheduledDate)
    if (!parts) return NextResponse.json({ error: 'วันที่ไม่ถูกต้อง' }, { status: 400 })
    let dates: string[]
    try { dates = generateScheduledDatesForMonth({ ...schedule, startDate: schedule.startDate || schedule.createdAt.toISOString().slice(0,10) }, Number(parts[1]), Number(parts[2])) }
    catch { return NextResponse.json({ error: 'รอบ PM หรือวันที่ไม่ถูกต้อง' }, { status: 400 }) }
    if (!dates.includes(scheduledDate)) return NextResponse.json({ error: 'วันที่ไม่ตรงกับรอบ PM ของแผน' }, { status: 400 })
    if (body.workOrderId) {
      const wo = await db.workOrder.findFirst({ where: { id: String(body.workOrderId), organizationId: schedule.organizationId, isDemo: schedule.isDemo } })
      if (!wo || (schedule.site && normalizeSiteCode(wo.siteCode) !== normalizeSiteCode(schedule.site)) || (schedule.deviceId && wo.deviceId !== schedule.deviceId)) return NextResponse.json({ error: 'ใบงานไม่ตรงกับแผน PM' }, { status: 400 })
    }

    // Check if execution already exists for this schedule+date
    const existing = await db.pMExecution.findFirst({
      where: {
        scheduleId: body.scheduleId,
        scheduledDate: body.scheduledDate,
      },
    })
    if (existing) {
      return NextResponse.json({ data: existing })
    }

    const created = await db.pMExecution.create({
      data: {
        scheduleId: body.scheduleId,
        scheduledDate: body.scheduledDate,
        workOrderId: body.workOrderId ? String(body.workOrderId) : null,
        status: 'PENDING',
        isDemo: schedule.isDemo,
      },
    })

    await logAudit(
      'CREATE',
      'PMExecution',
      created.id,
      `สร้าง PM execution สำหรับ ${schedule.scheduleNo} (${schedule.title}) — ${body.scheduledDate}`,
      { scheduleId: body.scheduleId, scheduledDate: body.scheduledDate },
      auth.user.email,
    )

    return NextResponse.json({ data: created }, { status: 201 })
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') {
      // A simultaneous start may have created the same occurrence. Do not create a second job.
      return NextResponse.json({ error: 'รอบ PM นี้มีงานแล้ว กรุณาโหลดข้อมูลล่าสุด' }, { status: 409 })
    }
    console.error('POST /api/pm/executions', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to create execution') : 'Internal server error' },
      { status: 500 },
    )
  }
}
