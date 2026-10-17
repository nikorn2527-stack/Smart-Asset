import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  // `auth.user` is the sanitized AuthUser shape (no secrets, no primary key).
  // The User row PK lives on `auth.row`.
  const creds = await db.webAuthnCredential.findMany({
    where: { userId: auth.row.id },
    select: { id: true, deviceType: true, name: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ credentials: creds })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const credId = new URL(req.url).searchParams.get('id')
  if (!credId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const cred = await db.webAuthnCredential.findUnique({ where: { id: credId } })
  if (!cred || cred.userId !== auth.row.id) return NextResponse.json({ error: 'ไม่พบPasskey หรือไม่ใช่ของคุณ' }, { status: 404 })
  await db.webAuthnCredential.delete({ where: { id: credId } })
  return NextResponse.json({ ok: true })
}
