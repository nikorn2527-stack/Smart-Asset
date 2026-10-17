import { pmAccess } from '@/lib/pm-access'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateScheduledDatesForMonth, bangkokDate } from '@/lib/pm-schedule'

/**
 * GET /api/pm/calendar?month=YYYY-MM&site=
 *
 * Returns the PM calendar for a given month:
 *   - For each active schedule, computes the scheduled dates in that month
 *   - For each scheduled date, finds or creates a PMExecution (PENDING)
 *   - Returns executions grouped by date for calendar rendering
 *
 * Auth: VIEW_DASHBOARD
 */
export async function GET(req: NextRequest) {
  const access = await pmAccess(req, 'VIEW_DASHBOARD')
  if (!access.ok) return access.response
  const { scope } = access
  try {
    const { searchParams } = new URL(req.url)
    const monthParam = searchParams.get('month')?.trim() ?? ''
    const now = new Date()
    const month = monthParam || bangkokDate(now).slice(0, 7)
    const siteFilter = searchParams.get('site')?.trim() ?? 'all'

    if (!/^(19\d{2}|20\d{2}|21\d{2}|2200)-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json(
        { error: 'Invalid month format. Use YYYY-MM.' },
        { status: 400 },
      )
    }

    const [yearStr, monthStr] = month.split('-')
    const year = Number(yearStr)
    const monthIdx = Number(monthStr) - 1 // 0-11

    // Fetch all active schedules (optionally filtered by site)
    const scheduleWhere: Record<string, unknown> = { AND: [scope], active: true }
    if (siteFilter !== 'all') {
      // Site filter: schedule.site === siteFilter OR schedule.site IS NULL (all sites)
      scheduleWhere.OR = [{ site: siteFilter }, { site: null }]
    }
    const schedules = await db.pMSchedule.findMany({
      where: scheduleWhere,
      include: {
        device: {
          select: { id: true, assetCode: true, name: true, type: true, site: true },
        },
      },
    })

    const monthStart = `${month}-01`
    const monthEnd = `${month}-${String(new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate()).padStart(2, '0')}`
    const executions = schedules.length ? await db.pMExecution.findMany({
      where: { scheduleId: { in: schedules.map(schedule => schedule.id) }, scheduledDate: { gte: monthStart, lte: monthEnd } },
      select: { id: true, scheduleId: true, scheduledDate: true, status: true, executedDate: true },
    }) : []
    const executionIndex = new Map(executions.map(execution => [`${execution.scheduleId}:${execution.scheduledDate}`, execution]))

    // For each schedule, compute scheduled dates in the month
    const executionsByDate: Record<string, Array<{
      executionId: string | null
      scheduleId: string
      scheduleNo: string | null
      title: string
      frequency: string
      deviceType: string | null
      site: string | null
      deviceId: string | null
      deviceName: string | null
      deviceAssetCode: string | null
      assignedTo: string | null
      status: string
      scheduledDate: string
      executedDate: string | null
    }>> = {}

    for (const schedule of schedules) {
      const dates = generateScheduledDatesForMonth(
        {
          frequency: schedule.frequency,
          intervalDays: schedule.intervalDays,
          dayOfMonth: schedule.dayOfMonth,
          weekday: schedule.weekday,
          startMonth: schedule.startMonth,
          startDate: schedule.startDate || bangkokDate(schedule.createdAt),
        },
        year,
        monthIdx + 1,
      )

      for (const date of dates) {
        // Check if a PMExecution already exists for this schedule+date
        const existing = executionIndex.get(`${schedule.id}:${date}`)

        if (!executionsByDate[date]) executionsByDate[date] = []
        executionsByDate[date].push({
          executionId: existing?.id ?? null,
          scheduleId: schedule.id,
          scheduleNo: schedule.scheduleNo,
          title: schedule.title,
          frequency: schedule.frequency,
          deviceType: schedule.deviceType,
          site: schedule.site,
          deviceId: schedule.deviceId,
          deviceName: schedule.device?.name ?? null,
          deviceAssetCode: schedule.device?.assetCode ?? null,
          assignedTo: schedule.assignedTo,
          status: existing?.status ?? 'PENDING',
          scheduledDate: date,
          executedDate: existing?.executedDate ?? null,
        })
      }
    }

    // Compute summary stats
    const allDates = Object.keys(executionsByDate).sort()
    const totalExecutions = allDates.reduce(
      (sum, date) => sum + executionsByDate[date].length,
      0,
    )
    const completedCount = allDates.reduce(
      (sum, date) => sum + executionsByDate[date].filter((e) => e.status === 'COMPLETED').length,
      0,
    )
    const pendingCount = allDates.reduce(
      (sum, date) => sum + executionsByDate[date].filter((e) => e.status === 'PENDING').length,
      0,
    )

    return NextResponse.json({
      month,
      schedules: schedules.length,
      total: totalExecutions,
      completed: completedCount,
      pending: pendingCount,
      byDate: executionsByDate,
      dates: allDates,
    })
  } catch (err) {
    console.error('GET /api/pm/calendar', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to fetch PM calendar') : 'Internal server error' },
      { status: 500 },
    )
  }
}
