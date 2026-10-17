import { pmAccess } from '@/lib/pm-access'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { computeNextRunDate, PMScheduleInputError, serializePMChecklist } from '@/lib/pm-schedule'
import { normalizeSiteCode } from '@/lib/site-scope'

/**
 * Derive the effective Site code for a PM schedule.
 * Returns null when the schedule is not tied to a specific Site (treated as
 * "all sites" — no Site-scoped authorization check applies).
 */
function derivePMScheduleSite(
  schedule: { site: string | null; device?: { site: string | null } | null },
): string | null {
  return normalizeSiteCode(schedule.site ?? schedule.device?.site ?? null)
}

/** GET /api/pm/schedules/[id] — single schedule with recent executions */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await pmAccess(req, 'VIEW_DASHBOARD')
  if (!access.ok) return access.response
  const { auth, ctx } = access
  try {
    const { id } = await params
    const schedule = await db.pMSchedule.findFirst({
      where: { id, ...access.scope },
      include: {
        device: {
          select: {
            id: true,
            assetCode: true,
            name: true,
            type: true,
            site: true,
          },
        },
        executions: {
          orderBy: { scheduledDate: 'desc' },
          take: 10,
        },
      },
    })
    if (!schedule) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    // Site-level access control — deny (404 to avoid leaking existence) if
    // the user has no grant at the schedule's Site. Schedules with no Site
    // ("all sites") bypass this check.
    const scheduleSite = derivePMScheduleSite(schedule)
    if (scheduleSite && !ctx.canAccessSite(scheduleSite)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ data: schedule })
  } catch (err) {
    console.error('GET /api/pm/schedules/[id]', err)
    return NextResponse.json({ error: 'Failed to fetch schedule' }, { status: 500 })
  }
}

/** PUT /api/pm/schedules/[id] — update schedule + recompute nextRunDate */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await pmAccess(req, 'WO_CREATE')
  if (!access.ok) return access.response
  const { auth, ctx } = access
  try {
    const { id } = await params
    const before = await db.pMSchedule.findFirst({
      where: { id, ...access.scope },
      include: { device: { select: { site: true } } },
    })
    if (!before) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    // Site-level access control — caller must have WO_CREATE at the
    // schedule's current Site. If the body changes `site` to a different
    // Site, the caller must also have WO_CREATE at the NEW Site.
    const currentSite = derivePMScheduleSite(before)
    if (currentSite && !ctx.canAtSite(currentSite, 'WO_CREATE')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await req.json()
    const frequency = body.frequency ? String(body.frequency) : before.frequency

    const updateData: Record<string, unknown> = {}
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200) throw new PMScheduleInputError('ชื่องานต้องมี 1–200 ตัวอักษร')
      updateData.title = body.title.trim()
    }
    if (body.description !== undefined) updateData.description = body.description ? String(body.description).trim() : null
    if (body.frequency !== undefined) updateData.frequency = frequency
    if (body.intervalDays !== undefined) updateData.intervalDays = body.intervalDays === null ? null : Number(body.intervalDays)
    if (body.dayOfMonth !== undefined) updateData.dayOfMonth = body.dayOfMonth === null ? null : Number(body.dayOfMonth)
    if (body.weekday !== undefined) updateData.weekday = body.weekday ? String(body.weekday).trim() : null
    if (body.startMonth !== undefined) updateData.startMonth = body.startMonth === null ? null : Number(body.startMonth)
    if (body.deviceType !== undefined) updateData.deviceType = body.deviceType ? String(body.deviceType).trim() : null
    if (body.site !== undefined) updateData.site = body.site ? String(body.site).trim() : null
    // P1 FIX (AUDIT-FINDINGS-FIX-018): if the schedule is being moved to a
    // different Site, the caller must have WO_CREATE at the NEW Site too.
    if (updateData.site !== undefined) {
      const newSite = normalizeSiteCode(updateData.site as string | null)
      if (newSite && newSite !== currentSite && !ctx.canAtSite(newSite, 'WO_CREATE')) {
        return NextResponse.json(
          { error: 'ไม่มีสิทธิ์ย้ายตาราง PM ไปยังสาขาที่ระบุ' },
          { status: 403 },
        )
      }
    }
    if (body.deviceId !== undefined) updateData.deviceId = body.deviceId ? String(body.deviceId).trim() : null
    if (body.checklist !== undefined) updateData.checklist = serializePMChecklist(body.checklist)
    if (body.active !== undefined) updateData.active = Boolean(body.active)
    if (body.startDate !== undefined) updateData.startDate = body.startDate ? String(body.startDate).trim() : null
    if (body.autoCreateWO !== undefined) updateData.autoCreateWO = Boolean(body.autoCreateWO)
    if (body.assignedTo !== undefined) updateData.assignedTo = body.assignedTo ? String(body.assignedTo).trim() : null

    const effectiveDeviceId = body.deviceId !== undefined ? updateData.deviceId as string | null : before.deviceId
    const device = effectiveDeviceId ? await db.device.findFirst({ where: { id: effectiveDeviceId, ...access.deviceScope, organizationId: before.organizationId } }) : null
    if (effectiveDeviceId && !device) return NextResponse.json({ error: 'ไม่พบครุภัณฑ์หรือไม่มีสิทธิ์' }, { status: 404 })
    const targetSite = body.site !== undefined ? updateData.site as string | null : before.site
    const effectiveSite = targetSite || device?.site
    if (!effectiveSite || !ctx.canAtSite(effectiveSite, 'WO_CREATE')) return NextResponse.json({ error: 'กรุณาเลือกสาขาที่มีสิทธิ์' }, { status: 403 })
    if (device && targetSite && targetSite !== device.site) return NextResponse.json({ error: 'สาขาไม่ตรงกับครุภัณฑ์' }, { status: 400 })
    updateData.site = effectiveSite

    // Recompute nextRunDate if frequency-related fields changed
    const frequencyChanged = ['frequency', 'intervalDays', 'dayOfMonth', 'weekday', 'startMonth', 'startDate'].some(
      (k) => body[k] !== undefined,
    )
    if (frequencyChanged) {
      const mergedSchedule = {
        frequency: (body.frequency !== undefined ? updateData.frequency : before.frequency) as string,
        intervalDays: (body.intervalDays !== undefined ? updateData.intervalDays : before.intervalDays) as number | null,
        dayOfMonth: (body.dayOfMonth !== undefined ? updateData.dayOfMonth : before.dayOfMonth) as number | null,
        weekday: (body.weekday !== undefined ? updateData.weekday : before.weekday) as string | null,
        startMonth: (body.startMonth !== undefined ? updateData.startMonth : before.startMonth) as number | null,
        startDate: (body.startDate !== undefined ? updateData.startDate : before.startDate) as string | null,
      }
      updateData.nextRunDate = computeNextRunDate(mergedSchedule)
    }

    const updated = await db.pMSchedule.update({
      where: { id },
      data: updateData,
    })

    await logAudit(
      'UPDATE',
      'PMSchedule',
      id,
      `แก้ไขตาราง PM ${updated.scheduleNo} (${updated.title})`,
      { changes: Object.keys(updateData) },
      auth.user.email,
    )

    return NextResponse.json({ data: updated })
  } catch (err) {
    if (err instanceof PMScheduleInputError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('PUT /api/pm/schedules/[id]', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to update PM schedule') : 'Internal server error' },
      { status: 500 },
    )
  }
}

/** DELETE /api/pm/schedules/[id] — soft delete by setting active=false */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await pmAccess(req, 'WO_CREATE')
  if (!access.ok) return access.response
  const { auth, ctx } = access
  try {
    const { id } = await params
    const before = await db.pMSchedule.findFirst({
      where: { id, ...access.scope },
      include: { device: { select: { site: true } } },
    })
    if (!before) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    // Site-level access control — caller must have WO_CREATE at the
    // schedule's Site.
    const scheduleSite = derivePMScheduleSite(before)
    if (scheduleSite && !ctx.canAtSite(scheduleSite, 'WO_CREATE')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Soft-delete: set active=false (keep the row for audit trail)
    const updated = await db.pMSchedule.update({
      where: { id },
      data: { active: false },
    })

    await logAudit(
      'DELETE',
      'PMSchedule',
      id,
      `ปิดใช้งานตาราง PM ${updated.scheduleNo} (${updated.title})`,
      { before },
      auth.user.email,
    )

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('DELETE /api/pm/schedules/[id]', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to delete PM schedule') : 'Internal server error' },
      { status: 500 },
    )
  }
}
