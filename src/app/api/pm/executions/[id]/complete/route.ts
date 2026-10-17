import { pmAccess } from '@/lib/pm-access'
import { NextRequest, NextResponse } from 'next/server'
import { db, getBaseClient } from '@/lib/db'
import { bangkokDate, computeNextRunDate } from '@/lib/pm-schedule'
import { normalizeSiteCode } from '@/lib/site-scope'

/**
 * Derive the effective Site code for a PM execution (via its schedule).
 * Returns null when the schedule is not tied to a specific Site.
 */
function derivePMExecutionSite(
  schedule: { site: string | null; device?: { site: string | null } | null } | null,
): string | null {
  if (!schedule) return null
  return normalizeSiteCode(schedule.site ?? schedule.device?.site ?? null)
}

/**
 * POST /api/pm/executions/[id]/complete
 *
 * Marks a PM execution as COMPLETED.
 * Body: {
 *   checklistResult?: Array<{ id, label, done, note? }>,
 *   remark?: string,
 *   performedBy?: string,
 *   images?: string[],  // base64 data URLs
 * }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await pmAccess(req, 'WO_CREATE')
  if (!access.ok) return access.response
  const { auth, ctx } = access
  try {
    const { id } = await params
    const before = await db.pMExecution.findFirst({
      where: { id, schedule: access.scope },
      include: { schedule: { include: { device: { select: { site: true } } } } },
    })
    if (!before) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    // P1 FIX (AUDIT-FINDINGS-FIX-018): Site-level access control — caller
    // must have WO_CREATE at the execution's schedule Site.
    const executionSite = derivePMExecutionSite(before.schedule)
    if (executionSite && !ctx.canAtSite(executionSite, 'WO_CREATE')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await req.json()
    const today = bangkokDate()
    if (before.status === 'COMPLETED') return NextResponse.json({ data: before })
    if (body.checklistResult !== undefined && !Array.isArray(body.checklistResult)) return NextResponse.json({ error: 'ผลการตรวจต้องเป็นรายการ' }, { status: 400 })

    // Validate checklist if schedule has one
    if (before.schedule?.checklist) {
      try {
        const requiredItems = JSON.parse(before.schedule.checklist) as Array<{
          id: string
          label: string
          required: boolean
        }>
        const requiredMissing = requiredItems.filter(
          (item) =>
            item.required &&
            !(body.checklistResult as Array<{ id: string; done: boolean }> | undefined)?.some(
              (r) => r && r.id === item.id && r.done === true,
            ),
        )
        if (requiredMissing.length > 0) {
          return NextResponse.json(
            {
              error: `ยังทำรายการบังคับไม่ครบ: ${requiredMissing.map((i) => i.label).join(', ')}`,
              missingItems: requiredMissing,
            },
            { status: 400 },
          )
        }
      } catch (parseErr) {
        console.error('Failed to parse checklist:', parseErr)
        return NextResponse.json({ error: 'รายการตรวจของแผนไม่ถูกต้อง กรุณาแก้ไขแผนก่อนปิดงาน' }, { status: 409 })
      }
    }

    const nextRunDate = computeNextRunDate({ ...before.schedule, startDate: before.schedule.startDate || bangkokDate(before.schedule.createdAt) }, new Date(Date.parse(before.scheduledDate + 'T00:00:00Z') + 86400000))
    const updated = await getBaseClient().$transaction(async tx => {
      const changed = await tx.pMExecution.updateMany({
      where: { id, status: before.status, schedule: access.scope },
      data: {
        status: 'COMPLETED',
        executedDate: today,
        checklistResult: body.checklistResult
          ? (typeof body.checklistResult === 'string'
              ? body.checklistResult
              : JSON.stringify(body.checklistResult))
          : null,
        remark: body.remark ? String(body.remark).trim() : null,
        performedBy: body.performedBy
          ? String(body.performedBy).trim()
          : auth.user.email,
        images: body.images
          ? (typeof body.images === 'string'
              ? body.images
              : JSON.stringify(body.images))
          : null,
      },
    })

      if (changed.count !== 1) throw new Error('PM_CONFLICT')
      const result = await tx.pMExecution.findUniqueOrThrow({ where: { id } })
      await tx.pMSchedule.updateMany({
        where: { id: before.scheduleId, OR: [{ nextRunDate: { lte: before.scheduledDate } }, { nextRunDate: null }] },
        data: { lastRunDate: today, nextRunDate },
      })
      await tx.auditLog.create({ data: {
        organizationId: before.schedule.organizationId, action: 'UPDATE', entity: 'PMExecution', entityId: id,
        summary: `ทำ PM เสร็จ: ${before.schedule.scheduleNo ?? ''} (${before.schedule.title}) — ${before.scheduledDate}`,
        detail: JSON.stringify({ scheduleId: before.scheduleId, scheduledDate: before.scheduledDate, executedDate: today }),
        actor: auth.user.email, userId: auth.row.id, siteCode: before.schedule.site, isDemo: before.isDemo,
      } })
      return result
    })


    return NextResponse.json({ data: updated })
  } catch (err) {
    if (err instanceof Error && err.message === 'PM_CONFLICT') return NextResponse.json({ error: 'งานถูกเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่' }, { status: 409 })
    console.error('POST /api/pm/executions/[id]/complete', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to complete execution') : 'Internal server error' },
      { status: 500 },
    )
  }
}
