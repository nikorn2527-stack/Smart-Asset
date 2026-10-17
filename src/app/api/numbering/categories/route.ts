import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'

// GET /api/numbering/categories?docType=device — ต้นไม้หมวดหมู่+รหัส
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const docType = new URL(req.url).searchParams.get('docType') ?? 'device'
    const rows = await db.categoryCode.findMany({
      where: { docType },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    })
    return NextResponse.json({ categories: rows })
  } catch (err) {
    console.error('GET /api/numbering/categories', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// POST /api/numbering/categories — เพิ่มหมวดหมู่
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const body = await req.json()
    const { docType, code, label, parentCode, matchKey, sortOrder } = body
    if (!code || !label) {
      return NextResponse.json({ error: 'code, label required' }, { status: 400 })
    }
    const dup = await db.categoryCode.findUnique({
      where: { docType_code: { docType: docType || 'device', code } },
    })
    if (dup) {
      return NextResponse.json(
        { error: `รหัส ${code} ถูกใช้แล้วในหมวดหมู่นี้` },
        { status: 400 },
      )
    }
    const created = await db.categoryCode.create({
      data: {
        docType: docType || 'device',
        code,
        label,
        parentCode: parentCode || null,
        matchKey: matchKey || null,
        sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
      },
    })
    return NextResponse.json({ category: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/numbering/categories', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
