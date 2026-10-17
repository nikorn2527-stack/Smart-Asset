import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'

// Lazy import db + audit to avoid OOM during cold-compile (sandbox 4GB memory pressure).
// The Prisma client bundle is large enough that loading it eagerly at module level
// + cold-compiling this route + already-cached auth + bcrypt = OOM.

/**
 * GET /api/organizations
 *   List all organizations (active + inactive).
 *   Permission: SYSTEM_CONFIG (admin only).
 *
 * POST /api/organizations
 *   Create a new organization. Validates uniqueness of `code`.
 */
export async function GET(req: NextRequest) {
  const { requireAuth } = await import('@/lib/auth-middleware')
  const { db } = await import('@/lib/db')
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const orgs = await db.organization.findMany({
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ organizations: orgs })
}

export async function POST(req: NextRequest) {
  const { requireAuth } = await import('@/lib/auth-middleware')
  const { db } = await import('@/lib/db')
  const { logAudit } = await import('@/lib/audit')
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const body = await req.json().catch(() => ({} as any))
  const { code, name, type, timezone, currency, address, phone, email, logoUrl } = body || {}

  if (!code || !name) {
    return NextResponse.json(
      { error: 'ต้องระบุ code และ name' },
      { status: 400 },
    )
  }

  const normalizedCode = String(code).toUpperCase().trim()
  if (!/^[A-Z0-9_-]{2,32}$/.test(normalizedCode)) {
    return NextResponse.json(
      { error: 'code ต้องเป็นตัวพิมพ์ใหญ่ ตัวเลข ขีด หรือ underscore (2-32 ตัวอักษร)' },
      { status: 400 },
    )
  }

  const existing = await db.organization.findUnique({ where: { code: normalizedCode } })
  if (existing) {
    return NextResponse.json(
      { error: `องค์กร ${normalizedCode} มีอยู่แล้ว` },
      { status: 409 },
    )
  }

  const org = await db.organization.create({
    data: {
      code: normalizedCode,
      name: String(name).trim(),
      type: type ?? null,
      timezone: timezone || 'Asia/Bangkok',
      currency: currency || 'THB',
      address: address ?? null,
      phone: phone ?? null,
      email: email ?? null,
      logoUrl: logoUrl ?? null,
    },
  })

  await logAudit(
    'ORGANIZATION_CREATE',
    'Organization',
    org.id,
    `สร้างองค์กรใหม่: ${org.code} (${org.name})`,
    { code: org.code, name: org.name, type: org.type },
    auth.row.username ?? auth.user.email,
  )

  return NextResponse.json({ organization: org }, { status: 201 })
}
