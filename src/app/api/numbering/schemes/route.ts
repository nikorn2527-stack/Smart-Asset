import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { ensureDefaultSchemes } from '@/lib/numbering-engine'

// GET /api/numbering/schemes?docType=device — ดึงรูปแบบทั้งหมดของ docType
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const docType = new URL(req.url).searchParams.get('docType') ?? 'device'
    await ensureDefaultSchemes(docType)
    const schemes = await db.numberingScheme.findMany({
      where: { docType },
      orderBy: { createdAt: 'asc' },
    })
    const active = schemes.find((s) => s.isActive) ?? null
    return NextResponse.json({ schemes, active })
  } catch (err) {
    console.error('GET /api/numbering/schemes', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// POST /api/numbering/schemes — สร้างรูปแบบใหม่
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const body = await req.json()
    const { docType, name, pattern, prefix, description, resetPolicy } = body
    if (!docType || !name || !pattern) {
      return NextResponse.json(
        { error: 'docType, name, pattern required' },
        { status: 400 },
      )
    }
    // ตรวจ pattern ต้องมี {seq} อย่างน้อย 1 จุด
    if (!/\{seq(:\d+)?\}/.test(pattern)) {
      return NextResponse.json(
        { error: 'รูปแบบต้องมีเลขลำดับ {seq} อย่างน้อย 1 จุด' },
        { status: 400 },
      )
    }
    const created = await db.numberingScheme.create({
      data: {
        docType,
        name,
        pattern,
        prefix: prefix || null,
        description: description || null,
        resetPolicy: ['never', 'yearly', 'monthly'].includes(resetPolicy)
          ? resetPolicy
          : 'never',
        isActive: false,
      },
    })
    return NextResponse.json({ scheme: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/numbering/schemes', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
