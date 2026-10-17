import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import {
  PendingBatchError,
  processPendingBatch,
  type PendingBatchInput,
} from '@/lib/stock-approval'

const MAX_BATCH_SIZE = 100

function parseInput(value: unknown): PendingBatchInput[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const row = item && typeof item === 'object'
      ? (item as Record<string, unknown>)
      : {}
    return {
      txnId: typeof row.txnId === 'string' ? row.txnId : '',
      action: row.action === 'reject' ? 'reject' : 'approve',
      note: typeof row.note === 'string' ? row.note : null,
      reason: typeof row.reason === 'string' ? row.reason : null,
    }
  })
}

/**
 * POST /api/stock-items/pending/batch
 * Body: { items: [{ txnId, action: 'approve'|'reject', note?, reason? }] }
 *
 * The batch is atomic: if any item is invalid or an approval has insufficient
 * stock, every change is rolled back and the response includes row failures.
 */
export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('stock')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const items = parseInput(body.items ?? body.transactions)
    if (items.length === 0) {
      return NextResponse.json(
        { error: 'items ต้องเป็น array ที่มีอย่างน้อยหนึ่งรายการ' },
        { status: 400 },
      )
    }
    if (items.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        { error: `รองรับ batch ได้ไม่เกิน ${MAX_BATCH_SIZE} รายการ` },
        { status: 400 },
      )
    }

    const data = await processPendingBatch(items, auth.user.email)
    return NextResponse.json({
      data,
      count: data.length,
      atomic: true,
    })
  } catch (error) {
    if (error instanceof PendingBatchError) {
      return NextResponse.json(
        {
          error: 'ไม่สามารถประมวลผล batch ได้ จึง rollback ทุกรายการ',
          failures: error.failures,
          atomic: true,
        },
        { status: 409 },
      )
    }
    console.error('POST /api/stock-items/pending/batch', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process batch' },
      { status: 500 },
    )
  }
}
