import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * GET /api/cycles?status=active&site=UDH
 *
 * When `status=active` is passed, also auto-closes any cycles whose endDate
 * is in the past — this ensures the "active" cycle list always reflects
 * reality (the countdown reset fix from Issue 4).
 */
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('meters')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'VIEW_DASHBOARD')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')?.trim() ?? ''
    const site = searchParams.get('site')?.trim() ?? ''

    // ── Auto-close expired active cycles ──
    // Any cycle with status='active' AND endDate < today → mark 'closed'.
    // Non-fatal: if this fails (e.g. race with another request), the next
    // GET will retry.
    try {
      const todayISO = new Date().toISOString().slice(0, 10)
      await db.cycle.updateMany({
        where: {
          status: 'active',
          endDate: { lt: todayISO },
        },
        data: { status: 'closed' },
      })
    } catch (e) {
      console.error('auto-close expired cycles failed:', e)
    }

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (site) {
      // Match either the exact site OR null (all-sites / global cycles)
      where.OR = [{ site }, { site: null }]
    }
    const cycles = await db.cycle.findMany({
      where,
      orderBy: { startDate: 'desc' },
    })
    return NextResponse.json({ cycles })
  } catch (err) {
    console.error('GET /api/cycles', err)
    return NextResponse.json(
      { error: 'Failed to fetch cycles' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('meters')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'METER_WRITE')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const body = await req.json()
    const { name, startDate, endDate, status, site } = body as {
      name?: string
      startDate?: string
      endDate?: string
      status?: string
      site?: string | null
    }
    if (!name || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'Missing required fields: name, startDate, endDate' },
        { status: 400 },
      )
    }
    const finalStatus = (status ?? 'active').trim()
    // Normalize site: empty string / "ALL" / "all" → null (global cycle)
    let siteValue: string | null = null
    if (typeof site === 'string' && site.trim() && site.trim().toUpperCase() !== 'ALL') {
      siteValue = site.trim().toUpperCase()
    }

    // If creating an active cycle, mark other active cycles as ended —
    // SCOPED to the same site (or both global when siteValue is null).
    // This way, UDH and NKP can each have their own active cycle simultaneously.
    if (finalStatus === 'active') {
      await db.cycle.updateMany({
        where: { status: 'active', ...(siteValue ? { site: siteValue } : { site: null }) },
        data: { status: 'ended' },
      })
    }

    const created = await db.cycle.create({
      data: {
        name: String(name).trim(),
        startDate: String(startDate),
        endDate: String(endDate),
        status: finalStatus,
        site: siteValue,
      },
    })
    await logAudit(
      'CYCLE_START',
      'Cycle',
      created.id,
      `สร้างรอบจดมิเตอร์ ${created.name} (${created.startDate} → ${created.endDate})${created.site ? ` @ ${created.site}` : ' (ทุกสาขา)'}`,
      { name: created.name, startDate: created.startDate, endDate: created.endDate, site: created.site },
      auth.user.email, // FIX-026: actor
    )
    return NextResponse.json({ cycle: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/cycles', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to create cycle') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
