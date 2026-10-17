import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { setActiveWoPattern } from '@/lib/wo-number-pattern'

// POST /api/settings/wo-patterns/[id]/activate — ตั้งเป็นรูปแบบที่ใช้งาน
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    await setActiveWoPattern(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('POST activate wo-pattern', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
