/**
 * POST /api/v1/work-orders/[id]/assign — assign a work order to a technician.
 *
 * Auth: WO_ASSIGN (checked at the WO's Site via loadAuthorizedWorkOrderV1).
 * Body: { assignedTo, assignmentNote? }
 *   - Set assignedTo, assignedBy = current user, assignedAt = now
 *   - If status was PENDING, change to IN_PROGRESS
 *   - Audit log: WO_ASSIGN
 * Response: { data: WorkOrder, meta }
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import {
  ok,
  badRequest,
  conflict,
  serverError,
} from '@/lib/api/response'
import { TERMINAL_STATUSES, loadAuthorizedWorkOrderV1 } from '../../_shared'
import { moduleUnavailableResponse } from '@/lib/module-gate'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  const { id } = await params

  try {
    // P0 Security: loadAuthorizedWorkOrderV1 authenticates the caller AND
    // checks WO_ASSIGN at the WO's Site in one shot, preventing cross-site
    // privilege escalation (a staff member at Site A can no longer assign
    // technicians to WOs at Site B — previously any caller with ADMIN or
    // DEVICE_EDIT could assign at any Site).
    const result = await loadAuthorizedWorkOrderV1(req, id, 'WO_ASSIGN')
    if (!result.ok) return result.response
    const { wo: existing, auth } = result
    const user = auth.user
    const userEmail = user.email

    if (TERMINAL_STATUSES.has(existing.status)) {
      return conflict(
        `ใบแจ้งซ่อมนี้อยู่ในสถานะ ${existing.status} ไม่สามารถมอบหมายได้`,
        { code: 'WO_LOCKED', field: 'status' },
      )
    }

    const body = await req.json().catch(() => ({}))
    const assignedTo = String(body.assignedTo ?? '').trim()
    if (!assignedTo) {
      return badRequest('assignedTo เป็นฟิลด์ที่ต้องการ', {
        field: 'assignedTo',
      })
    }
    const assignmentNote =
      body.assignmentNote !== undefined && body.assignmentNote !== null
        ? String(body.assignmentNote)
        : null

    const now = new Date()
    const wasPending = existing.status === 'PENDING'

    const updated = await db.workOrder.update({
      where: { id: existing.id },
      data: {
        assignedTo,
        assignedBy: userEmail,
        assignedAt: now,
        assignmentNote,
        // Auto-promote PENDING → IN_PROGRESS on assignment.
        ...(wasPending ? { status: 'IN_PROGRESS', acceptStatus: 'accepted' } : {}),
      },
    })

    await logAudit(
      'WO_ASSIGN',
      'WorkOrder',
      updated.id,
      `มอบหมายใบแจ้งซ่อม ${updated.woNumber} ให้ ${assignedTo} โดย ${userEmail}${
        wasPending ? ' (เปลี่ยนสถานะ PENDING → IN_PROGRESS)' : ''
      }`,
      {
        woNumber: updated.woNumber,
        oldStatus: existing.status,
        newStatus: updated.status,
        assignedTo,
        assignedBy: userEmail,
      },
      userEmail,
    )

    return ok(updated)
  } catch (err) {
    console.error('POST /api/v1/work-orders/[id]/assign', err)
    return serverError()
  }
}
