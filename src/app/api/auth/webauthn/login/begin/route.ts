import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ciEquals } from '@/lib/prisma-filters'
import { getWebAuthnConfig, beginAuthentication } from '@/lib/webauthn'
import { setChallenge } from '@/lib/webauthn-challenge-store'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { email?: string }
    const config = getWebAuthnConfig(req)
    // `transports` mirrors the DB column: a comma-separated String or null.
    let allowedCredentials: Array<{ id: string; transports?: string | null }> | undefined
    if (body.email) {
      const user = await db.user.findFirst({
        where: { email: ciEquals(body.email) },
        select: { id: true, email: true, active: true, webauthnCredentials: { select: { id: true, transports: true } } },
      })
      if (!user) {
        const options = await beginAuthentication({ config })
        setChallenge('auth:anon', options.challenge)
        return NextResponse.json({ options })
      }
      if (!user.active) return NextResponse.json({ error: 'บัญชีถูกระงับการใช้งาน' }, { status: 403 })
      if (user.webauthnCredentials.length === 0) return NextResponse.json({ error: 'บัญชีนี้ยังไม่ได้ลงทะเบียนPasskey — กรุณา login ด้วย password แล้วลงทะเบียนก่อน' }, { status: 400 })
      allowedCredentials = user.webauthnCredentials.map((c) => ({
        id: c.id,
        transports: c.transports,
      }))
    }
    const options = await beginAuthentication({ config, allowedCredentials })
    const challengeKey = body.email ? `auth:${body.email.toLowerCase()}` : 'auth:anon'
    setChallenge(challengeKey, options.challenge)
    return NextResponse.json({ options })
  } catch (err) {
    console.error('POST /api/auth/webauthn/login/begin', err)
    return NextResponse.json({ error: 'Failed to start authentication' }, { status: 500 })
  }
}
