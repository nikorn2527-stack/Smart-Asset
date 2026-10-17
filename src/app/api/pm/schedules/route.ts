import { pmAccess } from '@/lib/pm-access'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { computeNextRunDate, PMScheduleInputError, bangkokDate, serializePMChecklist } from '@/lib/pm-schedule'
import { isNumericShortQuery } from '@/lib/suffix-search'

/**
 * GET /api/pm/schedules?active=true&site=&deviceType=&search=
 *
 * Returns the list of PM schedules, optionally filtered.
 * Auth: VIEW_DASHBOARD (read-only for now).
 */
export async function GET(req: NextRequest) {
  const access = await pmAccess(req, 'VIEW_DASHBOARD')
  if (!access.ok) return access.response
  try {
    const { searchParams } = new URL(req.url)
    const active = searchParams.get('active')
    const site = searchParams.get('site')?.trim() ?? ''
    const deviceType = searchParams.get('deviceType')?.trim() ?? ''
    const search = searchParams.get('search')?.trim() ?? ''

    const where: Record<string, unknown> = { AND: [access.scope] }
    if (active === 'true') where.active = true
    if (active === 'false') where.active = false
    if (site) where.site = site
    if (deviceType) where.deviceType = deviceType
    if (search) {
      // SUFFIX-AWARE (SEARCH-FIX): for short numeric queries, scheduleNo
      // matches by SUFFIX.
      const isShort = isNumericShortQuery(search)
      const schedOp = isShort
        ? { endsWith: search, mode: 'insensitive' as const }
        : { contains: search, mode: 'insensitive' as const }
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { scheduleNo: schedOp },
        { description: { contains: search, mode: 'insensitive' } },
      ]
    }

    const schedules = await db.pMSchedule.findMany({
      where,
      orderBy: [{ active: 'desc' }, { nextRunDate: 'asc' }, { createdAt: 'desc' }],
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
        _count: {
          select: { executions: true },
        },
      },
    })

    return NextResponse.json({ data: schedules })
  } catch (err) {
    console.error('GET /api/pm/schedules', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to fetch PM schedules') : 'Internal server error' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/pm/schedules
 * Creates a new PM schedule + computes nextRunDate.
 */
export async function POST(req: NextRequest) {
  const access = await pmAccess(req, 'WO_CREATE')
  if (!access.ok) return access.response
  const { auth, ctx } = access
  try {
    const body = await req.json()
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200) {
      return NextResponse.json({ error: 'Missing required field: title' }, { status: 400 })
    }

    // Generate scheduleNo if not provided: PM-YYYYMM-NNN
    let scheduleNo = body.scheduleNo ? String(body.scheduleNo).trim() : null
    if (!scheduleNo) {
      const now = new Date()
      const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
      const prefix = `PM-${ym}-`
      const existing = await db.pMSchedule.findMany({
        where: { scheduleNo: { startsWith: prefix } },
        select: { scheduleNo: true },
      })
      let max = 0
      for (const s of existing) {
        if (!s.scheduleNo) continue
        const m = /^PM-\d{6}-(\d+)$/.exec(s.scheduleNo)
        if (m) {
          const n = parseInt(m[1], 10)
          if (Number.isFinite(n) && n > max) max = n
        }
      }
      scheduleNo = `${prefix}${String(max + 1).padStart(3, '0')}`
    }

    // Validate frequency
    const frequency = String(body.frequency ?? 'monthly')
    const validFrequencies = ['daily', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly', 'custom']
    if (!validFrequencies.includes(frequency)) {
      return NextResponse.json({ error: `Invalid frequency: ${frequency}` }, { status: 400 })
    }

    // Build the schedule object
    const scheduleData = {
      scheduleNo,
      title: String(body.title).trim(),
      description: body.description ? String(body.description).trim() : null,
      frequency,
      intervalDays: typeof body.intervalDays === 'number' ? body.intervalDays : (body.intervalDays ? Number(body.intervalDays) : null),
      dayOfMonth: typeof body.dayOfMonth === 'number' ? body.dayOfMonth : (body.dayOfMonth ? Number(body.dayOfMonth) : null),
      weekday: body.weekday ? String(body.weekday).trim() : null,
      startMonth: typeof body.startMonth === 'number' ? body.startMonth : (body.startMonth ? Number(body.startMonth) : null),
      deviceType: body.deviceType ? String(body.deviceType).trim() : null,
      site: body.site ? String(body.site).trim() : null,
      deviceId: body.deviceId ? String(body.deviceId).trim() : null,
      checklist: serializePMChecklist(body.checklist),
      active: body.active !== undefined ? Boolean(body.active) : true,
      startDate: body.startDate ? String(body.startDate).trim() : bangkokDate(),
      autoCreateWO: body.autoCreateWO === true,
      assignedTo: body.assignedTo ? String(body.assignedTo).trim() : null,
      createdBy: auth.user.email,
    }

    const device = scheduleData.deviceId ? await db.device.findFirst({ where: { id: scheduleData.deviceId, ...access.deviceScope } }) : null
    if (scheduleData.deviceId && !device) return NextResponse.json({ error: 'ไม่พบครุภัณฑ์หรือไม่มีสิทธิ์' }, { status: 404 })
    const organizationId = device?.organizationId || auth.row.organizationId
    if (!organizationId) return NextResponse.json({ error: 'กรุณาผูกบัญชีหรือครุภัณฑ์กับหน่วยงานก่อนสร้างแผน PM' }, { status: 409 })
    const site = device?.site || scheduleData.site
    if (!site || !ctx.canAtSite(site, 'WO_CREATE')) return NextResponse.json({ error: 'กรุณาเลือกสาขาที่มีสิทธิ์สร้างงาน' }, { status: 403 })
    if (device && scheduleData.site && scheduleData.site !== device.site) return NextResponse.json({ error: 'สาขาไม่ตรงกับครุภัณฑ์' }, { status: 400 })
    scheduleData.site = site

    // Compute nextRunDate
    const nextRunDate = computeNextRunDate({
      frequency: scheduleData.frequency,
      intervalDays: scheduleData.intervalDays,
      dayOfMonth: scheduleData.dayOfMonth,
      weekday: scheduleData.weekday,
      startMonth: scheduleData.startMonth,
      startDate: scheduleData.startDate,
    })

    const created = await db.pMSchedule.create({
      data: {
        ...scheduleData,
        organizationId,
        isDemo: auth.user.isDemo === true,
        nextRunDate,
      },
    })

    await logAudit(
      'CREATE',
      'PMSchedule',
      created.id,
      `สร้างตาราง PM ${created.scheduleNo} (${created.title})`,
      {
        scheduleNo: created.scheduleNo,
        title: created.title,
        frequency: created.frequency,
        nextRunDate,
      },
      auth.user.email,
    )

    return NextResponse.json({ data: created }, { status: 201 })
  } catch (err) {
    if (err instanceof PMScheduleInputError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('POST /api/pm/schedules', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to create PM schedule') : 'Internal server error' },
      { status: 500 },
    )
  }
}
