import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// GET a single cycle with stats (reading count, total sheets)
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
    const cycle = await db.cycle.findUnique({ where: { id } })
    if (!cycle) {
      return NextResponse.json({ error: 'Cycle not found' }, { status: 404 })
    }
    // METER-REDESIGN: MeterReading has no cycleId column (cycles and readings
    // are linked by date-range overlap). Filter by readingDate BETWEEN
    // cycle.startDate AND cycle.endDate, and sum pagesBw + pagesColor (not
    // a nonexistent `delta` column).
    const readings = await db.meterReading.findMany({
      where: {
        readingDate: { gte: cycle.startDate, lte: cycle.endDate },
      },
      select: { pagesBw: true, pagesColor: true },
    })
    const readingCount = readings.length
    const totalSheets = readings.reduce(
      (s, r) => s + (r.pagesBw ?? 0) + (r.pagesColor ?? 0),
      0,
    )
    return NextResponse.json({ cycle, readingCount, totalSheets })
  } catch (err) {
    console.error('GET /api/cycles/[id]', err)
    return NextResponse.json({ error: 'Failed to fetch cycle' }, { status: 500 })
  }
}

// PUT — update cycle status (end / cancel / reopen) or edit dates
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('meters')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'METER_WRITE')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const user = auth.row
  try {
    const { id } = await params
    const body = await req.json()
    const {
      status,
      name,
      startDate,
      endDate,
    } = body as {
      status?: string
      name?: string
      startDate?: string
      endDate?: string
    }
    // `user` is set above from requireAuth for audit attribution
    const existing = await db.cycle.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Cycle not found' }, { status: 404 })
    }

    // `closedAt` doesn't exist on the Cycle table — removed to avoid Prisma
    // validation errors when transitioning to CLOSED.

    const data: Record<string, unknown> = {}
    if (status !== undefined) {
      const s = String(status).trim()
      // Accept both legacy (active|ended|cancelled) and V5 (OPEN|QUEUED|CLOSED) statuses
      if (!['active', 'ended', 'cancelled', 'closed', 'OPEN', 'QUEUED', 'CLOSED', 'NONE'].includes(s)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
      // V5 cycle lock (Apps Script commit 67f8e54):
      //   Only OPEN cycles can be transitioned to CLOSED. Reject if not OPEN.
      if (s === 'CLOSED' && existing.status !== 'OPEN' && existing.status !== 'active') {
        return NextResponse.json(
          { error: `ไม่สามารถปิดรอบได้: รอบปัจจุบันมีสถานะ "${existing.status}" (ต้องเป็น OPEN หรือ active ก่อน)` },
          { status: 400 },
        )
      }
      data.status = s
    }
    if (name !== undefined) data.name = String(name).trim()
    if (startDate !== undefined) data.startDate = String(startDate)
    if (endDate !== undefined) data.endDate = String(endDate)
    // site: pass `null` (or "ALL") to make the cycle global, otherwise set the
    // site code. Validate against SiteAttribute when provided.
    if (body.site !== undefined) {
      const sRaw = String(body.site ?? '').trim()
      if (!sRaw || sRaw.toUpperCase() === 'ALL') {
        data.site = null
      } else {
        data.site = sRaw.toUpperCase()
      }
    }

    // ── Snapshot-on-close (Apps Script MeterSnapshotService commit 67f8e54) ──
    // When transitioning to CLOSED/ended, create an immutable snapshot of all
    // meter readings for this cycle's month BEFORE writing the CLOSED status.
    // If snapshot creation fails, the cycle stays OPEN (atomic).
    let snapshotResult: { snapshotId: string; contentHash: string; rowCount: number } | null = null
    const isClosing =
      status === 'CLOSED' || status === 'ended'
    if (isClosing && existing.status !== 'CLOSED' && existing.status !== 'ended') {
      const cycleMonth = existing.startDate.slice(0, 7)
      try {
        const { createMeterReportSnapshot } = await import('@/lib/meter-snapshot')
        snapshotResult = await createMeterReportSnapshot(cycleMonth, user?.email || 'system')
      } catch (snapErr) {
        console.error('Snapshot creation failed — cycle stays OPEN:', snapErr)
        return NextResponse.json(
          {
            error: 'สร้าง snapshot ไม่สำเร็จ — รอบจดมิเตอร์ยังคงเปิดอยู่เพื่อความปลอดภัย',
            detail: snapErr instanceof Error ? snapErr.message : 'Unknown error',
          },
          { status: 500 },
        )
      }
    }

    const updated = await db.cycle.update({ where: { id }, data })

    // Audit log with Thai summary
    let action = 'UPDATE'
    let summary = `แก้ไขรอบจดมิเตอร์ ${updated.name}`
    if (status === 'ended' || status === 'CLOSED') {
      action = 'CYCLE_END'
      summary = `จบรอบจดมิเตอร์ ${updated.name}`
      if (snapshotResult) {
        summary += ` (snapshot: ${snapshotResult.snapshotId}, ${snapshotResult.rowCount} rows, hash: ${snapshotResult.contentHash.slice(0, 12)}...)`
      }
    } else if (status === 'cancelled') {
      action = 'CYCLE_CANCEL'
      summary = `ยกเลิกรอบจดมิเตอร์ ${updated.name}`
    } else if (status === 'active' || status === 'OPEN') {
      action = 'CYCLE_REOPEN'
      summary = `เปิดใช้งานรอบจดมิเตอร์ ${updated.name} อีกครั้ง`
    }
    await logAudit(action, 'Cycle', id, summary, {
      name: updated.name,
      oldStatus: existing.status,
      newStatus: updated.status,
      snapshot: snapshotResult
        ? {
            snapshotId: snapshotResult.snapshotId,
            contentHash: snapshotResult.contentHash,
            rowCount: snapshotResult.rowCount,
          }
        : null,
    })

    return NextResponse.json({
      cycle: updated,
      snapshot: snapshotResult
        ? {
            snapshotId: snapshotResult.snapshotId,
            contentHash: snapshotResult.contentHash,
            rowCount: snapshotResult.rowCount,
          }
        : null,
    })
  } catch (err) {
    console.error('PUT /api/cycles/[id]', err)
    return NextResponse.json({ error: 'Failed to update cycle' }, { status: 500 })
  }
}

// DELETE — remove a cycle (only if not active and has no readings)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('meters')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'METER_WRITE')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const cycle = await db.cycle.findUnique({ where: { id } })
    if (!cycle) {
      return NextResponse.json({ error: 'Cycle not found' }, { status: 404 })
    }
    if (cycle.status === 'active' || cycle.status === 'OPEN') {
      return NextResponse.json(
        { error: 'ไม่สามารถลบรอบที่กำลังดำเนินการได้ — กรุณาจบรอบก่อน' },
        { status: 400 },
      )
    }
    // Count readings by date range (no cycleId field on MeterReading)
    const readingCount = await db.meterReading.count({
      where: {
        readingDate: { gte: cycle.startDate, lte: cycle.endDate },
      },
    })
    if (readingCount > 0) {
      return NextResponse.json(
        {
          error: `ไม่สามารถลบรอบที่มีการจดมิเตอร์แล้ว (${readingCount} รายการ) — กรุณายกเลิกรอบแทน`,
          code: 'CYCLE_HAS_READINGS',
          readingCount,
        },
        { status: 400 },
      )
    }
    await db.cycle.delete({ where: { id } })
    await logAudit('DELETE', 'Cycle', id, `ลบรอบจดมิเตอร์ ${cycle.name}`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/cycles/[id]', err)
    return NextResponse.json({ error: 'Failed to delete cycle' }, { status: 500 })
  }
}
