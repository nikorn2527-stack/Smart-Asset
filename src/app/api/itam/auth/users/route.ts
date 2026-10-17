import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { hashNewPassword, toAuthUser, isAdminRole, ALL_PERMISSION_KEYS } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

/**
 * /api/itam/auth/users — admin user-management endpoint (requires USER_MANAGE
 * permission). Supports GET (list), POST (create) and the [id] route supports
 * PUT/DELETE with "last admin" protection.
 *
 * Body fields (POST/PUT):
 *   • email, username, name, role, active, allowedSites, password
 *   • permissions: string[] — list of permission keys to MERGE with the role's
 *     defaults. Stored on User.permissions as a JSON array string.
 *
 * SPRINT-2 #8 (AUDIT-API-001 #072): added password validation (min 8 chars)
 * and audit log on every create/update/delete.
 */

const ROLE_CHOICES = ['superadmin', 'admin', 'editor', 'meter', 'viewer'] as const

// SPRINT-2 #8: password validation — min 8 chars, max 1000 (DoS guard),
// at least 1 letter + 1 digit (basic complexity — not enterprise-grade
// but enough to stop "password" / "12345678" which are common)
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 1000

function validatePassword(pw: string): { ok: true } | { ok: false; error: string } {
  if (pw.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `รหัสผ่านต้องมีอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร` }
  }
  if (pw.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, error: `รหัสผ่านยาวเกินไป (สูงสุด ${PASSWORD_MAX_LENGTH} ตัวอักษร)` }
  }
  if (!/[a-zA-Z]/.test(pw)) {
    return { ok: false, error: 'รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว' }
  }
  if (!/\d/.test(pw)) {
    return { ok: false, error: 'รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว' }
  }
  return { ok: true }
}

/** Normalize the incoming `permissions` value into a JSON string suitable
 *  for storage on User.permissions. Returns `null` for "no custom grants"
 *  (so the role defaults apply). */
function normalizePermissionsStorage(raw: unknown): string | null {
  if (raw == null) return null
  let arr: string[] = []
  if (Array.isArray(raw)) {
    arr = raw.map((p) => String(p ?? '').trim()).filter(Boolean)
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return null
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          arr = parsed.map((p) => String(p ?? '').trim()).filter(Boolean)
        }
      } catch {
        arr = trimmed.split(',').map((s) => s.trim()).filter(Boolean)
      }
    } else {
      arr = trimmed.split(',').map((s) => s.trim()).filter(Boolean)
    }
  }
  if (arr.length === 0) return null
  // Filter to known permission keys (silently drop unknown ones)
  const valid = new Set<string>(ALL_PERMISSION_KEYS)
  const filtered = arr.filter((p) => valid.has(p))
  if (filtered.length === 0) return null
  return JSON.stringify(filtered)
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, 'USER_MANAGE')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rows = await db.user.findMany({
    orderBy: [{ role: 'asc' }, { email: 'asc' }],
  })
  // Never leak hashes/salts to the client
  return NextResponse.json({ users: rows.map(toAuthUser), count: rows.length })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, 'USER_MANAGE')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => ({}))
  const email = String(body.email || '').trim().toLowerCase()
  const username = String(body.username || '').trim().toLowerCase() || null
  const name = String(body.name || '').trim() || null
  const role = String(body.role || '').trim().toLowerCase()
  const active = body.active !== false
  const allowedSites = String(body.allowedSites || '').trim() || 'ALL'
  const password = String(body.password || '')
  const permissions = normalizePermissionsStorage(body.permissions)

  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })
  if (!ROLE_CHOICES.includes(role as (typeof ROLE_CHOICES)[number])) {
    return NextResponse.json({ error: `role must be one of: ${ROLE_CHOICES.join(', ')}` }, { status: 400 })
  }

  // Non-superadmin cannot create superadmin
  if (role === 'superadmin' && auth.user.role !== 'superadmin') {
    return NextResponse.json({ error: 'เฉพาะ superadmin เท่านั้นที่สร้าง superadmin ได้' }, { status: 403 })
  }

  // Dup check
  const dup = await db.user.findFirst({
    where: { OR: [{ email }, ...(username ? [{ username }] : [])] },
  })
  if (dup) return NextResponse.json({ error: 'อีเมลหรือชื่อผู้ใช้ซ้ำกับที่มีอยู่' }, { status: 409 })

  let passwordHash: string | null = null
  let passwordSalt: string | null = null
  if (password) {
    // SPRINT-2 #8: validate password complexity before hashing
    const pwCheck = validatePassword(password)
    if (!pwCheck.ok) {
      return NextResponse.json({ error: pwCheck.error }, { status: 400 })
    }
    const { hash, salt } = hashNewPassword(password)
    passwordHash = hash
    passwordSalt = salt
  }

  const created = await db.user.create({
    data: {
      email,
      role,
      active,
      name,
      username,
      passwordHash,
      passwordSalt,
      allowedSites,
      permissions,
    },
  })
  // SPRINT-2 #8: audit log on user creation
  try {
    await logAudit(
      'CREATE',
      'User',
      created.id,
      `สร้างผู้ใช้ ${email} (role=${role})`,
      { email, role, active, allowedSites, createdBy: auth.user.email },
      auth.user.email,
    )
  } catch (e) {
    console.error('[users POST] audit log failed (non-fatal):', e)
  }
  return NextResponse.json({ user: toAuthUser(created) }, { status: 201 })
}

// Helper exported for the [id] route — checks "last admin" protection
export async function assertNotLastAdmin(targetId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const target = await db.user.findUnique({ where: { id: targetId } })
  if (!target) return { ok: false, status: 404, error: 'ไม่พบผู้ใช้' }
  if (!isAdminRole(target.role)) return { ok: true }
  // Count other active admins/superadmins
  const otherAdmins = await db.user.count({
    where: {
      id: { not: targetId },
      active: true,
      OR: [{ role: 'admin' }, { role: 'superadmin' }, { role: 'Admin' }, { role: 'Super Admin' }],
    },
  })
  if (otherAdmins === 0) {
    return {
      ok: false,
      status: 400,
      error: 'ไม่สามารถลบ/ปิดผู้ดูแลคนสุดท้ายได้ — ต้องมี admin หรือ superadmin อย่างน้อย 1 คนในระบบ',
    }
  }
  return { ok: true }
}

// Re-export the storage normalizer for the [id] PUT route.
export { normalizePermissionsStorage }
