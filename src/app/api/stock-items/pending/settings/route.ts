import { NextRequest, NextResponse } from 'next/server'
import { db, getBaseClient } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import {
  readStockApprovalSettings,
  type StockApprovalSettings,
} from '@/lib/stock-approval-settings'

/** GET /api/stock-items/pending/settings */
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    return NextResponse.json({ settings: await readStockApprovalSettings() })
  } catch (error) {
    console.error('GET /api/stock-items/pending/settings', error)
    return NextResponse.json({ error: 'Failed to fetch stock approval settings' }, { status: 500 })
  }
}

/** PUT /api/stock-items/pending/settings */
export async function PUT(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const current = await readStockApprovalSettings()
    const approvalMode: StockApprovalSettings['approvalMode'] =
      body.approvalMode === 'auto'
        ? 'auto'
        : body.approvalMode === 'manual'
          ? 'manual'
          : current.approvalMode
    const delayRaw = body.autoApproveDelayMinutes ?? current.autoApproveDelayMinutes
    const limitRaw = body.autoApproveBatchLimit ?? current.autoApproveBatchLimit
    const delay = Number(delayRaw)
    const limit = Number(limitRaw)

    if (!Number.isInteger(delay) || delay < 0 || delay > 10080) {
      return NextResponse.json(
        { error: 'autoApproveDelayMinutes ต้องอยู่ระหว่าง 0 ถึง 10080' },
        { status: 400 },
      )
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return NextResponse.json(
        { error: 'autoApproveBatchLimit ต้องอยู่ระหว่าง 1 ถึง 500' },
        { status: 400 },
      )
    }

    const values: Record<string, string> = {
      'stock.pendingApprovalMode': approvalMode,
      'stock.autoApproveDelayMinutes': String(delay),
      'stock.autoApproveBatchLimit': String(limit),
    }
    await getBaseClient().$transaction(
      Object.entries(values).map(([key, value]) =>
        db.appSetting.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        }),
      ),
    )

    return NextResponse.json({ settings: await readStockApprovalSettings() })
  } catch (error) {
    console.error('PUT /api/stock-items/pending/settings', error)
    return NextResponse.json({ error: 'Failed to update stock approval settings' }, { status: 500 })
  }
}
