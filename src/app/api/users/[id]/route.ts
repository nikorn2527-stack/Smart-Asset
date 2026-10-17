// ============================================================
// Users API — by ID (Task ID: RBAC-DASHBOARD)
// ============================================================
//   PUT    /api/users/[id]   — update user (admin only)
//   DELETE /api/users/[id]   — delete user (admin only)
//
// รองรับ role ใหม่: admin | manager | staff | coordinator | viewer | editor (legacy)
// รับ/คืน permissions + allowedSites + department
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { getUserPermissions, type AuthUser } from '@/lib/rbac'
import { getCurrentUser } from '@/lib/auth-session'

const VALID_ROLES = [
  'admin',
  'manager',
  'staff',
  'coordinator',
  'viewer',
  'editor', // legacy
] as const
type Role = (typeof VALID_ROLES)[number]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseRole(v: unknown): Role | null {
  if (typeof v !== 'string') return null
  return VALID_ROLES.includes(v as Role) ? (v as Role) : null
}

function parsePermissions(v: unknown): string[] | null {
  if (Array.isArray(v)) {
    return v.filter((p): p is string => typeof p === 'string')
  }
  if (typeof v === 'string' && v.trim().length > 0) {
    try {
      const parsed = JSON.parse(v)
      if (Array.isArray(parsed)) {
        return parsed.filter((p): p is string => typeof p === 'string')
      }
    } catch {
      return null
    }
  }
  return null
}

function serializePermissions(perms: string[] | null): string | null {
  if (!perms || perms.length === 0) return null
  return JSON.stringify(perms)
}

function publicUser(u: {
  id: string
  email: string
  username: string | null
  name: string | null
  role: string
  department: string | null
  permissions: string | null
  allowedSites: string | null
  active: boolean
  lastLoginAt: string | null
  createdAt: Date
  updatedAt: Date
}) {
  let customPerms: string[] | null = null
  if (u.permissions) {
    try {
      const parsed = JSON.parse(u.permissions)
      if (Array.isArray(parsed)) {
        customPerms = parsed.filter((p): p is string => typeof p === 'string')
      }
    } catch {
      customPerms = null
    }
  }
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    name: u.name,
    role: u.role,
    department: u.department,
    permissions: getUserPermissions(u.role, customPerms),
    customPermissions: customPerms,
    allowedSites: u.allowedSites,
    active: u.active,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  }
}

async function requireAdmin(req: NextRequest): Promise<AuthUser | null> {
  const user = await getCurrentUser(req)
  if (!user) return null
  if (user.role !== 'admin' && !user.permissions.includes('*')) return null
  return user
}

// ---- PUT /api/users/[id] ----
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const admin = await requireAdmin(req)
    if (!admin) {
      return NextResponse.json(
        { error: 'ต้องเข้าสู่ระบบในฐานะผู้ดูแลระบบ' },
        { status: 403 },
      )
    }
    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    const existing = await db.user.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'ไม่พบผู้ใช้' }, { status: 404 })
    }

    const email =
      typeof body.email === 'string'
        ? body.email.trim().toLowerCase()
        : existing.email
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: 'รูปแบบอีเมลไม่ถูกต้อง' },
        { status: 400 },
      )
    }
    if (email !== existing.email) {
      const dup = await db.user.findUnique({ where: { email } })
      if (dup) {
        return NextResponse.json(
          { error: 'อีเมลนี้มีอยู่ในระบบแล้ว' },
          { status: 409 },
        )
      }
    }

    const role = parseRole(body.role) ?? (existing.role as Role)
    const name =
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim()
        : existing.name
    const username =
      typeof body.username === 'string' && body.username.trim()
        ? body.username.trim()
        : existing.username
    const department =
      typeof body.department === 'string' && body.department.trim()
        ? body.department.trim()
        : existing.department
    const active =
      typeof body.active === 'boolean' ? body.active : existing.active
    const allowedSites =
      typeof body.allowedSites === 'string' && body.allowedSites.trim()
        ? body.allowedSites.trim()
        : existing.allowedSites
    const perms =
      body.permissions === null
        ? null
        : parsePermissions(body.permissions)

    // Prevent demoting the last active admin to a non-admin role
    if (
      existing.role === 'admin' &&
      role !== 'admin' &&
      existing.active === true
    ) {
      const adminCount = await db.user.count({
        where: { role: 'admin', active: true },
      })
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: 'ไม่สามารถเปลี่ยนบทบาทของผู้ดูแลคนสุดท้ายได้' },
          { status: 400 },
        )
      }
    }

    // Prevent deactivating the last active admin
    if (existing.role === 'admin' && existing.active === true && active === false) {
      const adminCount = await db.user.count({
        where: { role: 'admin', active: true },
      })
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: 'ไม่สามารถปิดการใช้งานผู้ดูแลคนสุดท้ายได้' },
          { status: 400 },
        )
      }
    }

    const updated = await db.user.update({
      where: { id },
      data: {
        email,
        name,
        username,
        role,
        department,
        active,
        allowedSites,
        permissions: serializePermissions(perms),
      },
    })
    await logAudit(
      'UPDATE',
      'User',
      updated.id,
      `แก้ไขผู้ใช้ ${updated.email} (${updated.role})`,
      {
        before: {
          email: existing.email,
          name: existing.name,
          role: existing.role,
          department: existing.department,
          allowedSites: existing.allowedSites,
          active: existing.active,
        },
        after: {
          email: updated.email,
          name: updated.name,
          role: updated.role,
          department: updated.department,
          allowedSites: updated.allowedSites,
          active: updated.active,
          permissions: perms,
        },
      },
    )
    return NextResponse.json({ user: publicUser(updated) })
  } catch (err) {
    console.error('PUT /api/users/[id]', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to update user') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ---- DELETE /api/users/[id] ----
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const admin = await requireAdmin(_req)
    if (!admin) {
      return NextResponse.json(
        { error: 'ต้องเข้าสู่ระบบในฐานะผู้ดูแลระบบ' },
        { status: 403 },
      )
    }
    const existing = await db.user.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'ไม่พบผู้ใช้' }, { status: 404 })
    }

    // Prevent deleting the last admin
    if (existing.role === 'admin' && existing.active === true) {
      const adminCount = await db.user.count({
        where: { role: 'admin', active: true },
      })
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: 'ไม่สามารถลบผู้ดูแลคนสุดท้ายได้' },
          { status: 400 },
        )
      }
    }

    await db.user.delete({ where: { id } })
    await logAudit(
      'DELETE',
      'User',
      existing.id,
      `ลบผู้ใช้ ${existing.email} (${existing.role})`,
      {
        email: existing.email,
        name: existing.name,
        role: existing.role,
        active: existing.active,
      },
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/users/[id]', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to delete user') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
