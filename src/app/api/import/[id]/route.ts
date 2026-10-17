/**
 * GET /api/import/[id] — fetch a single ImportJob
 *
 * Phase 3: refactored to thin adapter — no @/lib/db imports.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { importJobRepository } from '@/modules/import'
import { moduleUnavailableResponse } from '@/lib/module-gate'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('import')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'IMPORT_DATA')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params
    const job = await importJobRepository.findById(id)
    if (!job) {
      return NextResponse.json(
        { error: 'ไม่พบ ImportJob ที่ระบุ' },
        { status: 404 },
      )
    }
    return NextResponse.json({ job })
  } catch (err) {
    console.error('GET /api/import/[id]', err)
    return NextResponse.json(
      { error: 'Failed to fetch import job' },
      { status: 500 },
    )
  }
}
