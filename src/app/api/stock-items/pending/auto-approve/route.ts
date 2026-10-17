import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { PendingBatchError, processPendingBatch } from '@/lib/stock-approval'
import { readStockApprovalSettings } from '@/lib/stock-approval-settings'
import { moduleUnavailableResponse } from '@/lib/module-gate'

function hasCronSecret(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false

  const header = req.headers.get('x-cron-secret')
  const authorization = req.headers.get('authorization')
  const supplied = header ?? (authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null)
  return Boolean(supplied && supplied === expected)
}

async function authorize(req: NextRequest): Promise<{ ok: true; actor: string } | NextResponse> {
  if (hasCronSecret(req)) return { ok: true, actor: 'vercel-cron' }
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  return { ok: true, actor: auth.user.email }
}

async function runAutoApproval(req: NextRequest) {
  const authorized = await authorize(req)
  if (authorized instanceof NextResponse) return authorized

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const settings = await readStockApprovalSettings()
    const dryRun = body.dryRun === true
    const requestedLimit = Number(body.limit ?? settings.autoApproveBatchLimit)
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(settings.autoApproveBatchLimit, Math.max(1, Math.round(requestedLimit)))
      : settings.autoApproveBatchLimit
    const now = new Date().toISOString()

    const eligible = await db.stockTransaction.findMany({
      where: {
        approvalStatus: 'PENDING',
        approvalMode: 'auto',
        autoApproveAt: { not: null, lte: now },
      },
      orderBy: [{ autoApproveAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: {
        id: true,
        txnNumber: true,
        productCode: true,
        quantity: true,
        stockItemId: true,
        autoApproveAt: true,
      },
    })

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        eligible,
        count: eligible.length,
        settings,
      })
    }

    const processed: Array<{ txnId: string; txnNumber: string | null; status: string }> = []
    const failures: Array<{ txnId: string; txnNumber: string | null; error: string }> = []

    for (const row of eligible) {
      try {
        const result = await processPendingBatch(
          [{
            txnId: row.id,
            action: 'approve',
            note: 'อนุมัติอัตโนมัติตาม SLA',
          }],
          authorized.actor,
        )
        processed.push({
          txnId: row.id,
          txnNumber: row.txnNumber,
          status: result[0]?.status ?? 'APPROVED',
        })
      } catch (error) {
        const message = error instanceof PendingBatchError
          ? error.failures[0]?.error ?? 'ไม่สามารถอนุมัติอัตโนมัติได้'
          : error instanceof Error
            ? error.message
            : 'ไม่สามารถอนุมัติอัตโนมัติได้'
        failures.push({ txnId: row.id, txnNumber: row.txnNumber, error: message })
      }
    }

    return NextResponse.json({
      dryRun: false,
      processed,
      failures,
      count: processed.length,
      failedCount: failures.length,
      settings,
    })
  } catch (error) {
    console.error('stock auto-approval failed', error)
    return NextResponse.json({ error: 'Failed to run stock auto-approval' }, { status: 500 })
  }
}

/** Vercel Cron invokes GET with Authorization: Bearer $CRON_SECRET. */
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  return runAutoApproval(req)
}

/** Admin/manual invocation supports POST with { dryRun?, limit? }. */
export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  return runAutoApproval(req)
}
