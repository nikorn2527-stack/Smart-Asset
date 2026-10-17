import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'

// POST /api/numbering/schemes/[id]/activate — ตั้งเป็นรูปแบบที่ใช้งานของ docType นั้น
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const scheme = await db.numberingScheme.findUnique({ where: { id } })
    if (!scheme) {
      return NextResponse.json({ error: 'ไม่พบรูปแบบ' }, { status: 404 })
    }
    // transaction: ปิดทุก scheme ของ docType เดียวกัน แล้วเปิดตัวนี้
    await db.$transaction([
      db.numberingScheme.updateMany({
        where: { docType: scheme.docType, isActive: true },
        data: { isActive: false },
      }),
      db.numberingScheme.update({
        where: { id },
        data: { isActive: true },
      }),
    ])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('POST /api/numbering/schemes/[id]/activate', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
