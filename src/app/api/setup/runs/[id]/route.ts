import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireAuth } from '@/lib/auth-middleware'
import { getOrgScope } from '@/lib/org-scope'

/**
 * GET /api/setup/runs/[id]
 *   Get one SetupRun + its steps (scoped to caller's organization).
 *
 * PATCH /api/setup/runs/[id]
 *   Update status of the whole run (e.g. mark COMPLETED or CANCELLED).
 *   Body: { status?, currentStep?, errorMessage?, expectedVersion? }
 *
 * P1-04 fixes (per latest review):
 *   - GET/PATCH now enforce Organization Scope via getOrgScope()
 *   - Run is queried by (id AND organizationId) — non-superadmin users
 *     cannot read/modify another org's run even if they know the id
 *   - Removed `completedBy` from client input — it now comes from auth.row
 *     (the authenticated user) instead of request body
 *   - Added `expectedVersion` for optimistic concurrency (prevents two
 *     admins from updating the same run simultaneously)
 *   - Status transition validation: only IN_PROGRESS -> COMPLETED/CANCELLED/FAILED
 */

interface Params {
  params: Promise<{ id: string }>
}

/** Allowed status transitions. Anything else is rejected. */
const VALID_TRANSITIONS: Record<string, Set<string>> = {
  NOT_STARTED: new Set(['IN_PROGRESS', 'CANCELLED']),
  IN_PROGRESS: new Set(['COMPLETED', 'CANCELLED', 'FAILED']),
  // Terminal states — no transitions allowed
  COMPLETED: new Set(),
  CANCELLED: new Set(),
  FAILED: new Set(),
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id: runId } = await params
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  // P1-04: enforce Organization Scope
  const orgScope = getOrgScope(auth.user)
  if (!orgScope.ok) {
    return NextResponse.json(
      { error: orgScope.error.message },
      { status: orgScope.error.status },
    )
  }

  // Superadmin can see any org's runs; non-superadmin only their own
  const where =
    auth.user.role === 'superadmin'
      ? { id: runId }
      : { id: runId, organizationId: orgScope.organizationId }

  const run = await db.setupRun.findFirst({
    where,
    include: { steps: { orderBy: { stepKey: 'asc' } } },
  })
  if (!run) {
    return NextResponse.json(
      { error: 'ไม่พบ SetupRun ใน Organization ของคุณ' },
      { status: 404 },
    )
  }
  return NextResponse.json({ run })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id: runId } = await params
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  // P1-04: enforce Organization Scope
  const orgScope = getOrgScope(auth.user)
  if (!orgScope.ok) {
    return NextResponse.json(
      { error: orgScope.error.message },
      { status: orgScope.error.status },
    )
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const { status, currentStep, errorMessage, expectedVersion } = body as {
    status?: string
    currentStep?: string
    errorMessage?: string
    expectedVersion?: number
  }
  // P1-04: `completedBy` is NO LONGER accepted from client — derive from auth
  // (old behavior allowed client to forge any user id)

  // P1-04: scope query by org (superadmin bypass)
  const where =
    auth.user.role === 'superadmin'
      ? { id: runId }
      : { id: runId, organizationId: orgScope.organizationId }

  const existing = await db.setupRun.findFirst({ where })
  if (!existing) {
    return NextResponse.json(
      { error: 'ไม่พบ SetupRun ใน Organization ของคุณ' },
      { status: 404 },
    )
  }

  // P1-04: optimistic concurrency — if expectedVersion provided, must match
  if (expectedVersion !== undefined && existing.version !== expectedVersion) {
    return NextResponse.json(
      {
        error: 'ข้อมูลถูกแก้ไขโดยผู้ใช้อื่น — กรุณารีโหลดแล้วลองใหม่',
        code: 'VERSION_CONFLICT',
        currentVersion: existing.version,
      },
      { status: 409 },
    )
  }

  // P1-04: validate status transition
  if (status && !VALID_TRANSITIONS[existing.status]?.has(status)) {
    return NextResponse.json(
      {
        error: `ไม่อนุญาตให้เปลี่ยนสถานะจาก ${existing.status} เป็น ${status}`,
        code: 'INVALID_TRANSITION',
        currentStatus: existing.status,
      },
      { status: 422 },
    )
  }

  const data: Record<string, unknown> = {}
  if (status) data.status = status
  if (currentStep !== undefined) data.currentStep = currentStep
  if (errorMessage !== undefined) data.errorMessage = errorMessage

  // P1-04: derive completedBy from authenticated user (NOT from client)
  const actor = auth.row.username ?? auth.user.email
  if (status === 'COMPLETED' || status === 'CANCELLED' || status === 'FAILED') {
    data.completedBy = actor
    data.completedAt = new Date().toISOString()
  }

  // P1-04: compare-and-swap on `version` (same pattern as WorkOrder.version).
  // If a concurrent writer already bumped the row, this update affects 0 rows
  // and Prisma throws P2025 instead of silently clobbering their changes.
  // The request body carries no try/catch, so the P2025 MUST be handled here —
  // otherwise it escapes as an unhandled rejection and the client gets a 500
  // with no actionable information.
  let run
  try {
    run = await db.setupRun.update({
      where: { id: runId, version: existing.version },
      data: { ...data, version: { increment: 1 } },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      const current = await db.setupRun.findUnique({ where: { id: runId } })
      return NextResponse.json(
        {
          error: 'ข้อมูลถูกแก้ไขโดยผู้ใช้อื่น — กรุณารีโหลดแล้วลองใหม่',
          code: 'VERSION_CONFLICT',
          currentVersion: current?.version,
        },
        { status: 409 },
      )
    }
    throw err
  }

  await logAudit(
    'SETUP_RUN_UPDATE',
    'SetupRun',
    run.id,
    `อัปเดต SetupRun: status=${run.status}${currentStep ? ' step=' + currentStep : ''} by=${actor}`,
    {
      status: run.status,
      currentStep: run.currentStep,
      version: run.version,
      actor,
    },
    actor,
  )

  return NextResponse.json({ run })
}
