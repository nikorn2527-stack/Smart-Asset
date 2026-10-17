import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { getOrgProfile, updateOrgProfile } from '@/lib/org-profile'
import { financialProfileError } from '@/lib/government/profile-validation'

// GET /api/settings/org-profile — ดึง profile ขององค์กร
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const profile = await getOrgProfile()
    return NextResponse.json({ profile })
  } catch (err) {
    console.error('GET org-profile', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// PUT /api/settings/org-profile — อัปเดต profile
export async function PUT(req: NextRequest) {
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({error: 'รูปแบบข้อมูลไม่ถูกต้อง'}, {status: 400})
    const invalid = financialProfileError(body)
    if (invalid) return NextResponse.json({error: invalid}, {status: 400})
    const profile = await updateOrgProfile(body)
    // Audit log
    await db.auditLog.create({
      data: {
        action: 'UPDATE',
        entity: 'OrgProfile',
        summary: `อัปเดตข้อมูลองค์กร: ${profile.appName}`,
        detail: JSON.stringify(body),
        actor: 'admin',
      },
    })
    return NextResponse.json({ profile })
  } catch (err) {
    console.error('PUT org-profile', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
