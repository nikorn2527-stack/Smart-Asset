import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { setActivePattern } from '@/lib/asset-number-pattern'

// POST /api/settings/asset-patterns/[id]/activate — ตั้งเป็นรูปแบบที่ใช้งาน
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
    await setActivePattern(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('POST activate pattern', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
