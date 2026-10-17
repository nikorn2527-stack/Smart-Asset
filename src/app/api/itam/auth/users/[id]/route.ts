import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { hashNewPassword, toAuthUser, isAdminRole } from '@/lib/auth'
import { assertNotLastAdmin, normalizePermissionsStorage } from '../route'

const ROLE_CHOICES = ['superadmin', 'admin', 'editor', 'meter', 'viewer'] as const

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req, 'USER_MANAGE')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const existing = await db.user.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'ไม่พบผู้ใช้' }, { status: 404 })

  // ── Last-admin protection: deactivating/demoting last admin ──
  const newRoleRaw = body.role != null ? String(body.role).trim().toLowerCase() : existing.role
  const newActive = body.active != null ? !!body.active : existing.active
  const wasAdmin = isAdminRole(existing.role) && existing.active
  const willBeAdmin = isAdminRole(newRoleRaw) && newActive
  if (wasAdmin && !willBeAdmin) {
    const guard = await assertNotLastAdmin(id)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  // Non-superadmin cannot promote anyone to superadmin
  if (newRoleRaw === 'superadmin' && auth.user.role !== 'superadmin') {
    return NextResponse.json({ error: 'เฉพาะ superadmin เท่านั้นที่ตั้งบทบาท superadmin ได้' }, { status: 403 })
  }

  if (body.role != null && !ROLE_CHOICES.includes(newRoleRaw as (typeof ROLE_CHOICES)[number])) {
    return NextResponse.json({ error: `role must be one of: ${ROLE_CHOICES.join(', ')}` }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (body.role != null) data.role = newRoleRaw
  if (body.active != null) data.active = newActive
  if (body.name != null) data.name = String(body.name).trim() || null
  if (body.username != null) data.username = String(body.username).trim().toLowerCase() || null
  if (body.allowedSites != null) data.allowedSites = String(body.allowedSites).trim() || 'ALL'
  // `permissions` is optional — only updated when the field is explicitly
  // present in the body. Pass `null` to clear custom grants.
  if (body.permissions !== undefined) {
    data.permissions = normalizePermissionsStorage(body.permissions)
  }

  if (typeof body.password === 'string' && body.password.trim()) {
    const { hash, salt } = hashNewPassword(body.password)
    data.passwordHash = hash
    data.passwordSalt = salt
  }

  // username uniqueness check
  if (data.username && data.username !== existing.username) {
    const dup = await db.user.findFirst({
      where: { username: data.username as string, NOT: { id } },
    })
    if (dup) return NextResponse.json({ error: 'ชื่อผู้ใช้ซ้ำ' }, { status: 409 })
  }

  const updated = await db.user.update({ where: { id }, data })
  return NextResponse.json({ user: toAuthUser(updated) })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req, 'USER_MANAGE')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const existing = await db.user.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'ไม่พบผู้ใช้' }, { status: 404 })

  // Self-delete protection (admins cannot delete themselves)
  if (existing.email === auth.user.email) {
    return NextResponse.json({ error: 'ไม่สามารถลบบัญชีตัวเองได้' }, { status: 400 })
  }

  // Last-admin protection
  if (isAdminRole(existing.role) && existing.active) {
    const guard = await assertNotLastAdmin(id)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  await db.user.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
