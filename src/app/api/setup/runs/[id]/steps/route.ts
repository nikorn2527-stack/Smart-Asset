import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireAuth } from '@/lib/auth-middleware'

/**
 * POST /api/setup/runs/[id]/steps
 *   Upsert a SetupStep (idempotent).
 *   Body: {
 *     stepKey: string, // 'preflight' | 'organization' | 'modules' | ... | 'activate'
 *     status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'SKIPPED',
 *     inputHash?: string, // hash of user input — if matches existing, skip
 *     resultJson?: string, // JSON string with step result
 *     errorMessage?: string,
 *     completedBy?: string,
 *   }
 *
 * Returns { step, skipped: boolean } — skipped=true if inputHash matched
 * (idempotent re-run).
 */
/**
 * Next.js 15+ (and 16, which this app runs) deliver dynamic route `params` as a
 * PROMISE. Declaring them synchronously made `runId` `undefined` at runtime
 * — every query below looked up `id: undefined`. See GET/PATCH in
 * /api/setup/runs/[id]/route.ts for the same convention.
 */
interface Params { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id: runId } = await params
  const { requireAuth } = await import('@/lib/auth-middleware')
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const run = await db.setupRun.findUnique({ where: { id: runId } })
  if (!run) {
    return NextResponse.json({ error: 'ไม่พบ SetupRun' }, { status: 404 })
  }
  if (run.status !== 'IN_PROGRESS') {
    return NextResponse.json(
      { error: `SetupRun ไม่ได้กำลังดำเนินการ (status=${run.status})` },
      { status: 400 },
    )
  }

  // ── H-02 fix: ตรวจ Organization Scope ของ Run ──
  // ป้องกัน user จาก org A ส่ง step update ไปยัง run ของ org B
  const { getOrgScope } = await import('@/lib/org-scope')
  const orgScope = getOrgScope(auth.user)
  if (!orgScope.ok) {
    return NextResponse.json({ error: orgScope.error.message }, { status: orgScope.error.status })
  }
  // Superadmin สามารถเข้าถึงได้ทุก org — skip check
  if (auth.user.role !== 'superadmin' && run.organizationId !== orgScope.organizationId) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์เข้าถึง SetupRun ขององค์กรอื่น' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({} as any))
  const { stepKey, status, inputHash, resultJson, errorMessage } = body || {}

  // ── H-02 fix: ไม่รับ completedBy จาก Client — ใช้จาก Auth Context เท่านั้น ──
  const resolvedCompletedBy = auth.row.username ?? auth.user.email

  if (!stepKey || !status) {
    return NextResponse.json(
      { error: 'ต้องระบุ stepKey และ status' },
      { status: 400 },
    )
  }

  // Idempotency check
  const existing = await db.setupStep.findUnique({
    where: { setupRunId_stepKey: { setupRunId: runId, stepKey } },
  })

  if (existing && inputHash && existing.inputHash === inputHash && existing.status === 'COMPLETED') {
    // Input unchanged — skip re-apply
    return NextResponse.json({ step: existing, skipped: true })
  }

  const now = new Date()
  const data: any = {
    status,
    startedAt: existing?.startedAt ?? now,
    completedAt: (status === 'COMPLETED' || status === 'FAILED' || status === 'SKIPPED') ? now : null,
  }
  if (inputHash !== undefined) data.inputHash = inputHash
  if (resultJson !== undefined) data.resultJson = resultJson
  if (errorMessage !== undefined) data.errorMessage = errorMessage
  if (status === 'COMPLETED') data.completedBy = resolvedCompletedBy

  const step = await db.setupStep.upsert({
    where: { setupRunId_stepKey: { setupRunId: runId, stepKey } },
    create: { setupRunId: runId, stepKey, ...data },
    update: data,
  })

  // Update the run's currentStep pointer
  if (status === 'COMPLETED') {
    await db.setupRun.update({
      where: { id: runId },
      data: { currentStep: stepKey },
    })
  }

  await logAudit(
    'SETUP_STEP_UPDATE',
    'SetupStep',
    step.id,
    `อัปเดต step ${stepKey} → ${status}`,
    { stepKey, status, runId: runId },
    auth.row.username ?? auth.user.email,
  )

  return NextResponse.json({ step, skipped: false })
}
