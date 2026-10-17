// ============================================================
// Users API (Task ID: RBAC-DASHBOARD)
// ============================================================
//   GET    /api/users          — list all users (admin only)
//   POST   /api/users          — create user (admin only)
//   PUT    /api/users          — update user (admin only, body.id required)
//
// - ตรวจสอบสิทธิ์ admin ผ่าน cookie session (getCurrentUser)
// - รองรับ role ใหม่: admin | manager | staff | coordinator | viewer | editor (legacy)
// - รับ/คืน permissions (JSON array) + allowedSites + department
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import {
  getUserPermissions,
  type AuthUser,
} from '@/lib/rbac'
import { getCurrentUser } from '@/lib/auth-session'
import { requireAuth } from '@/lib/auth-middleware'

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

/** Parse permissions field — accepts string[] or JSON string. Returns null if invalid. */
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

/** Public shape for API responses — never expose passwordHash */
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

/** Require admin — returns AuthUser or null. */
async function requireAdmin(req: NextRequest): Promise<AuthUser | null> {
  // Try Bearer token first (ITAM JWT auth)
  const bearerAuth = await requireAuth(req, 'USER_MANAGE')
  if (bearerAuth.ok) {
    return bearerAuth.user as unknown as AuthUser
  }
  // Fall back to cookie session (legacy auth)
  const user = await getCurrentUser(req)
  if (!user) return null
  // Accept both 'admin' and 'superadmin' roles
  if (user.role !== 'admin' && user.role !== 'superadmin' && !user.permissions.includes('*')) return null
  return user
}

/** Lazily seed demo users when none exist (idempotent). */
async function ensureSeedUsers() {
  const count = await db.user.count()
  if (count > 0) return
  await db.user.createMany({
    data: [
      {
        email: 'admin@example.com',
        name: 'ผู้ดูแลระบบ',
        role: 'admin',
        active: true,
        allowedSites: 'ALL',
        permissions: JSON.stringify(['*']),
      },
      {
        email: 'manager@example.com',
        name: 'ผู้จัดการ',
        role: 'manager',
        active: true,
        allowedSites: 'ALL',
      },
      {
        email: 'staff@example.com',
        name: 'ช่างเทคนิค',
        role: 'staff',
        active: true,
        allowedSites: 'ALL',
      },
      {
        email: 'coordinator@example.com',
        name: 'ผู้ประสานงาน',
        role: 'coordinator',
        active: true,
        allowedSites: 'ALL',
      },
      {
        email: 'viewer@example.com',
        name: 'ผู้ดู',
        role: 'viewer',
        active: true,
        allowedSites: 'ALL',
      },
    ],
  })
  await logAudit(
    'SEED',
    'User',
    null,
    'เพิ่มผู้ใช้ตัวอย่าง 5 รายการ (admin/manager/staff/coordinator/viewer)',
    { count: 5 },
  )
}

// ---- GET /api/users ----
export async function GET(req: NextRequest) {
  try {
    await ensureSeedUsers()
    const admin = await requireAdmin(req)
    // ถ้าไม่ใช่ admin → คืนแค่ตัวเอง (เพื่อให้ UI ยังแสดง user info ได้)
    if (!admin) {
      const me = await getCurrentUser(req)
      if (!me) {
        return NextResponse.json(
          { error: 'ต้องเข้าสู่ระบบ', users: [] },
          { status: 401 },
        )
      }
            // Re-fetch rather than trusting `me`: this is a second, separate query, so
      // the row can be deleted/soft-deleted between the two. The old
      // `findUnique(...)!` asserted non-null and would have thrown a TypeError
      // (500) instead of returning a clean 401.
      const self = await db.user.findUnique({ where: { id: me.id } })
      if (!self) {
        return NextResponse.json(
          { error: 'ต้องเข้าสู่ระบบ', users: [] },
          { status: 401 },
        )
      }
      return NextResponse.json({
        users: [publicUser(self)],
        limited: true,
      })
    }
    const users = await db.user.findMany({
      orderBy: { createdAt: 'asc' },
      take: 100, // bounded — prevent unbounded query on Vercel Hobby
    })
    return NextResponse.json({ users: users.map(publicUser) })
  } catch (err) {
    console.error('GET /api/users', err)
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 },
    )
  }
}

// ---- POST /api/users (create) ----
export async function POST(req: NextRequest) {
  try {
    await ensureSeedUsers()
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
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: 'รูปแบบอีเมลไม่ถูกต้อง' },
        { status: 400 },
      )
    }
    const role = parseRole(body.role)
    if (!role) {
      return NextResponse.json(
        {
          error:
            'บทบาทต้องเป็น admin / manager / staff / coordinator / viewer',
        },
        { status: 400 },
      )
    }
    const name =
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim()
        : null
    const username =
      typeof body.username === 'string' && body.username.trim()
        ? body.username.trim()
        : null
    const department =
      typeof body.department === 'string' && body.department.trim()
        ? body.department.trim()
        : null
    const active = body.active === false ? false : true
    const allowedSites =
      typeof body.allowedSites === 'string' && body.allowedSites.trim()
        ? body.allowedSites.trim()
        : 'ALL'
    const perms = parsePermissions(body.permissions)

    const existing = await db.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        { error: 'อีเมลนี้มีอยู่ในระบบแล้ว' },
        { status: 409 },
      )
    }

    const created = await db.user.create({
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
      'CREATE',
      'User',
      created.id,
      `เพิ่มผู้ใช้ ${created.email} (${created.role})`,
      {
        email: created.email,
        name: created.name,
        role: created.role,
        department: created.department,
        allowedSites: created.allowedSites,
        permissions: perms,
        active: created.active,
      },
    )
    return NextResponse.json(
      { user: publicUser(created) },
      { status: 201 },
    )
  } catch (err) {
    console.error('POST /api/users', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to create user') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ---- PUT /api/users (update by body.id) ----
export async function PUT(req: NextRequest) {
  try {
    await ensureSeedUsers()
    const admin = await requireAdmin(req)
    if (!admin) {
      return NextResponse.json(
        { error: 'ต้องเข้าสู่ระบบในฐานะผู้ดูแลระบบ' },
        { status: 403 },
      )
    }
    const body = await req.json().catch(() => null)
    if (!body || typeof body.id !== 'string') {
      return NextResponse.json(
        { error: 'ต้องระบุ id ใน body' },
        { status: 400 },
      )
    }
    const id = body.id as string
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

    // Prevent demoting the last active admin
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
    console.error('PUT /api/users', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to update user') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

