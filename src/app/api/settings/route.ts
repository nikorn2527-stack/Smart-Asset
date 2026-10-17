import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { encryptSecret } from '@/lib/secret-crypto'
import { isGovernmentRegisterKey } from '@/lib/government/register'

/**
 * Secret-pattern deny-list for the public settings map.
 *
 * The AppSetting table stores arbitrary key/value pairs, including secrets
 * such as `line_channel_access_token`, `line_channel_secret`, OAuth
 * client secrets, API keys, etc. The generic `/api/settings` GET returns
 * the full map to the frontend so it can render non-sensitive UI flags
 * (orgName, cycleTemplate.*, mobileNavConfig, …).
 *
 * To prevent secret leakage via that endpoint, any key matching one of
 * the patterns below is OMITTED from the response map. Frontend code that
 * needs a secret value (e.g. notifications.ts loading LINE tokens) reads
 * it directly from the DB via the server-side lib, never through this API.
 */
const SECRET_KEY_PATTERNS: RegExp[] = [
  /token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /api[_-]?key/i,
  /apikey/i,
  /oauth/i,
  /credential/i,
  /private[_-]?key/i,
  /client[_-]?secret/i,
  /channel[_-]?secret/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /bearer/i,
  /jwt[_-]?secret/i,
  /session[_-]?secret/i,
  /encryption[_-]?key/i,
]

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((re) => re.test(key))
}

// Cache settings for 5 minutes — most config is static.
// Note: this only affects the GET response; writes (PUT) will
// invalidate the cache via revalidateTag or natural TTL expiry.
export const revalidate = 300

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const settings = await db.appSetting.findMany({
      select: { key: true, value: true },
    })
    const map: Record<string, string> = {}
    for (const s of settings) {
      // SECURITY: never expose secret-pattern keys via the public map.
      if (isSecretKey(s.key) || isGovernmentRegisterKey(s.key)) continue
      map[s.key] = s.value
    }
    return NextResponse.json({ settings: map })
  } catch (err) {
    console.error('GET /api/settings', err)
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 },
    )
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const body = (await req.json()) as Record<string, string>
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    if (Object.keys(body).some(isGovernmentRegisterKey)) return NextResponse.json({error: 'เอกสารราชการต้องแก้ผ่านหน้าทะเบียนคุมที่ตรวจสิทธิ์รายครุภัณฑ์'}, {status: 400})
    const ops = Object.entries(body).map(([key, value]) =>
      db.appSetting.upsert({
        where: { key },
        // SPRINT-1 #5 (FIX-019): encrypt secret-pattern keys at rest.
        // Reads decrypt via maybeDecrypt(); legacy plaintext rows still
        // work because isEncrypted() returns false for them.
        update: { value: isSecretKey(key) ? encryptSecret(String(value)) : String(value) },
        create: { key, value: isSecretKey(key) ? encryptSecret(String(value)) : String(value) },
      }),
    )
    await Promise.all(ops)
    const settings = await db.appSetting.findMany({
      select: { key: true, value: true },
    })
    const map: Record<string, string> = {}
    for (const s of settings) {
      if (isSecretKey(s.key) || isGovernmentRegisterKey(s.key)) continue
      map[s.key] = s.value
    }
    return NextResponse.json({ settings: map })
  } catch (err) {
    console.error('PUT /api/settings', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to update settings') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
