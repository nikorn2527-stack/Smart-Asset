import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { getWebAuthnConfig, beginRegistration } from '@/lib/webauthn'
import { setChallenge } from '@/lib/webauthn-challenge-store'

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const user = auth.row
  try {
    const body = await req.json().catch(() => ({})) as { name?: string }
    const config = getWebAuthnConfig(req)
    const existing = await db.webAuthnCredential.findMany({
      where: { userId: user.id }, select: { id: true, transports: true },
    })
    const options = await beginRegistration({
      userId: user.id, userEmail: user.email,
      userName: user.name ?? user.username ?? user.email,
      // Pass the RAW column value: WebAuthnCredential.transports is a
      // comma-separated String ("internal,hybrid"), and beginRegistration()
      // normalizes it internally via parseTransports(). Passing a pre-split
      // array here violates that contract (parseTransports would call .split()
//      on an array at runtime).
      existingCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
      config,
    })
    setChallenge(`reg:${user.id}`, options.challenge)
    return NextResponse.json({ options, credentialName: body.name ?? null })
  } catch (err) {
    console.error('POST /api/auth/webauthn/register/begin', err)
    return NextResponse.json({ error: 'Failed to start registration' }, { status: 500 })
  }
}
