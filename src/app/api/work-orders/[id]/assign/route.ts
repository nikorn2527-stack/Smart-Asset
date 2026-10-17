import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { notifyWorkOrderAssigned } from '@/lib/notifications'
import { loadAuthorizedWorkOrder } from '@/lib/wo-authz'
import { moduleUnavailableResponse } from '@/lib/module-gate'

async function logAudit(
  action: string,
  entityId: string | null,
  summary: string,
  detail: Record<string, unknown> | null,
  actor: string,
  siteCode?: string | null,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action,
        entity: 'WorkOrder',
        entityId,
        summary,
        detail: detail ? JSON.stringify(detail) : null,
        actor,
        siteCode: siteCode ?? null,
      },
    })
  } catch (err) {
    console.error('logAudit failed:', err)
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  // Auth: loadAuthorizedWorkOrder does the site-scoped WO_ASSIGN check.
  // We only need a basic auth here (any logged-in user) — the wo-authz
  // layer enforces the correct permission at the WO's Site.
  const auth = await requireAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const { id } = await params

    // Authenticate + authorize — assigning a WO requires WO_ASSIGN at its Site
    const result = await loadAuthorizedWorkOrder(req, id, 'WO_ASSIGN')
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { wo, auth } = result

    const body = await req.json()
    const { assignedTo, assignmentNote } = body as {
      assignedTo?: string
      assignmentNote?: string | null
    }

    if (!assignedTo || !String(assignedTo).trim()) {
      return NextResponse.json(
        { error: 'ต้องระบุชื่อช่าง (assignedTo)' },
        { status: 400 },
      )
    }

    // Use the authenticated user's email as the actor — never trust
    // a body-supplied `actor` field, which could be spoofed.
    const actorName = auth.user.email
    const tech = String(assignedTo).trim()
    const note = assignmentNote ? String(assignmentNote).trim() : null
    const now = new Date()

    const updated = await db.workOrder.update({
      where: { id: wo.id },
      data: {
        assignedTo: tech,
        assignedBy: actorName,
        assignedAt: now,
        assignmentNote: note,
        // Auto-advance PENDING → IN_PROGRESS when first assigned
        status: wo.status === 'PENDING' ? 'IN_PROGRESS' : wo.status,
      },
    })

    await db.workOrderMessage.create({
      data: {
        workOrderId: wo.id,
        message: `มอบหมายช่าง: ${tech}${note ? ` — ${note}` : ''}`,
        author: actorName,
        authorRole: 'admin',
      },
    })

    await logAudit(
      'WO_ASSIGN',
      wo.id,
      `มอบหมาย ${updated.woNumber ?? wo.id} ให้ ${tech}`,
      { assignedTo: tech, assignedBy: actorName, note },
      actorName,
      result.woSite,
    )

    // ── Notification trigger (Task ID: NOTIFY-LINE) ──
    // Send 'wo_assigned' to the assigned staff (LINE/Telegram if known).
    try {
      await notifyWorkOrderAssigned(
        {
          id: updated.id,
          woNumber: updated.woNumber,
          subject: updated.subject,
          assignedTo: updated.assignedTo,
        },
        { channels: ['line-oa', 'telegram'], actor: actorName },
      )
    } catch (e) {
      console.error('[notifications] wo_assigned trigger failed:', e)
    }

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('POST /api/work-orders/[id]/assign', err)
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to assign work order') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
