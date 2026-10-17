import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireAuth } from '@/lib/auth-middleware'

/**
 * GET /api/setup/runs
 *   List all SetupRun records (for admin to resume past runs).
 *
 * POST /api/setup/runs
 *   Create a new SetupRun (start the wizard).
 *   Body: { organizationId, startedBy }
 *   Idempotent: if there's an active (IN_PROGRESS) run for this org, return it
 *   instead of creating a new one.
 *
 * GET /api/setup/runs/[id]
 *   Get one SetupRun + its steps.
 *
 * PATCH /api/setup/runs/[id]
 *   Update a step status: { stepKey, status, inputHash?, resultJson?, errorMessage? }
 *   Idempotent: if inputHash matches existing, skip (return current state).
 */

export async function GET(req: NextRequest) {
  const { requireAuth } = await import('@/lib/auth-middleware')
  const { getOrgScope } = await import('@/lib/org-scope')
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // ── H-04 fix: GET กรอง SetupRun ตาม Organization Scope ──
  const orgScope = getOrgScope(auth.user)
  if (!orgScope.ok) {
    return NextResponse.json({ error: orgScope.error.message }, { status: orgScope.error.status })
  }

  const runs = await db.setupRun.findMany({
    where: orgScope.where, // กรองด้วย organizationId
    include: { steps: { orderBy: { stepKey: 'asc' } } },
    orderBy: { startedAt: 'desc' },
    take: 50,
  })
  return NextResponse.json({ runs })
}

export async function POST(req: NextRequest) {
  const { requireAuth } = await import('@/lib/auth-middleware')
  const { getOrgScope } = await import('@/lib/org-scope')
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // ── H-04 fix: ใช้ organizationId จาก auth context เท่านั้น ──
  // ไม่รับจาก Client body (ยกเว้น Superadmin ที่ระบุเป้าหมายได้)
  const orgScope = getOrgScope(auth.user)
  if (!orgScope.ok) {
    return NextResponse.json({ error: orgScope.error.message }, { status: orgScope.error.status })
  }

  // Superadmin สามารถระบุ organizationId จาก body ได้ (สำหรับ cross-org admin)
  let targetOrgId = orgScope.organizationId
  if (auth.user.role === 'superadmin') {
    const body = await req.json().catch(() => ({} as any))
    if (body.organizationId) {
      // ตรวจว่า organization มีจริง
      const targetOrg = await db.organization.findUnique({ where: { id: body.organizationId } })
      if (!targetOrg) {
        return NextResponse.json({ error: 'ไม่พบองค์กรที่ระบุ' }, { status: 404 })
      }
      targetOrgId = body.organizationId
    }
  }

  // Idempotency: return active run if exists
  const activeRun = await db.setupRun.findFirst({
    where: { organizationId: targetOrgId, status: 'IN_PROGRESS' },
    include: { steps: true },
  })
  if (activeRun) {
    return NextResponse.json({ run: activeRun, message: 'มี SetupRun ที่กำลังดำเนินการอยู่ ส่งกลับเพื่อ resume' })
  }

  // P1-05: Lock check — if a COMPLETED run exists, reject new runs.
  // This prevents re-running the wizard after initial setup is locked.
  // Superadmin can bypass with ITAM_ALLOW_SETUP_RESET=1 env var (explicit recovery mode).
  const completedRun = await db.setupRun.findFirst({
    where: { organizationId: targetOrgId, status: 'COMPLETED' },
    select: { id: true, completedAt: true },
  })
  if (completedRun && process.env.ITAM_ALLOW_SETUP_RESET !== '1') {
    return NextResponse.json(
      {
        error: 'Setup Wizard ถูกล็อกแล้ว — การตั้งค่าเริ่มต้นเสร็จสิ้นแล้ว',
        code: 'SETUP_LOCKED',
        completedRunId: completedRun.id,
        completedAt: completedRun.completedAt,
        hint: 'หากต้องการรันใหม่ ให้ตั้ง ITAM_ALLOW_SETUP_RESET=1 (recovery mode เท่านั้น)',
      },
      { status: 423 }, // 423 Locked
    )
  }

  const run = await db.setupRun.create({
    data: {
      organizationId: targetOrgId,
      status: 'IN_PROGRESS',
      currentStep: 'preflight',
      startedBy: auth.row.username ?? auth.user.email,
    },
    include: { steps: true },
  })

  await logAudit(
    'SETUP_RUN_START',
    'SetupRun',
    run.id,
    `เริ่ม Setup Wizard สำหรับองค์กร ${targetOrgId}`,
    { organizationId: targetOrgId, initiatedBy: auth.user.role === 'superadmin' ? 'superadmin' : 'self' },
    auth.row.username ?? auth.user.email,
  )

  return NextResponse.json({ run }, { status: 201 })
}
