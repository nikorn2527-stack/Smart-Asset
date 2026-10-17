import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { getWebAuthnConfig, finishRegistration, serializeTransports } from '@/lib/webauthn'
import type { AuthenticatorTransport } from '@simplewebauthn/server'
import { getChallenge, deleteChallenge } from '@/lib/webauthn-challenge-store'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const user = auth.row
  try {
    const body = await req.json().catch(() => ({})) as { credential?: unknown; deviceType?: string; name?: string }
    if (!body.credential) return NextResponse.json({ error: 'Missing credential' }, { status: 400 })
    const config = getWebAuthnConfig(req)
    const expectedChallenge = getChallenge(`reg:${user.id}`)
    if (!expectedChallenge) return NextResponse.json({ error: 'Challenge expired — กรุณาเริ่มใหม่' }, { status: 400 })
    const verification = await finishRegistration({ body: body.credential, expectedChallenge, config })
    if (!verification.verified || !verification.registrationInfo) return NextResponse.json({ error: 'การยืนยันPasskeyล้มเหลว' }, { status: 400 })
    const info = verification.registrationInfo
    // @simplewebauthn v14 nests the credential under `registrationInfo.credential`
    // (`credentialID` / `credentialPublicKey` / `counter` were the v13 shape).
    const credentialId = info.credential.id
    const credentialName = body.name ?? body.deviceType ?? 'Passkey'
    // Transports are reported by the *client* in the assertion response, not by
    // `credentialDeviceType` (that is 'singleDevice' | 'multiDevice'). Storing
    // it there previously wrote a non-transport enum value into the column.
    const clientTransports = (body.credential as { response?: { transports?: AuthenticatorTransport[] } })
      ?.response?.transports
    await db.webAuthnCredential.create({
      data: {
        id: credentialId,
        userId: user.id,
        publicKey: Buffer.from(info.credential.publicKey),
        counter: info.credential.counter,
        deviceType: body.deviceType ?? null,
        transports: serializeTransports(clientTransports),
        name: credentialName,
      },
    })
    deleteChallenge(`reg:${user.id}`)
    await logAudit('AUTH_FALLBACK', 'User', user.id, `ลงทะเบียนPasskeyสำเร็จ: "${credentialName}"`, { credentialId, deviceType: body.deviceType }, user.email).catch(() => {})
    return NextResponse.json({ verified: true, credentialId, name: credentialName })
  } catch (err) {
    console.error('POST /api/auth/webauthn/register/finish', err)
    return NextResponse.json({ error: 'Failed to verify registration' }, { status: 500 })
  }
}
