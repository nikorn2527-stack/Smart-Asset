/**
 * PATCH  /api/itam/auth/site-grants/[id]   — update a grant (role, active, validUntil)
 * DELETE /api/itam/auth/site-grants/[id]   — delete a grant
 *
 * Task ID: PHASE1-AUTH-FOUNDATION
 *
 * `id` is the composite key `userId@siteCode` (URL-safe encoded).
 *
 * Authorization: requires USER_MANAGE permission.
 * Every change is audited with previous + new values.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'

function parseGrantId(id: string): { userId: string; siteCode: string } | null {
  // id format: userId@siteCode — the @ separator is safe because cuid() doesn't contain @
  const idx = id.indexOf('@')
  if (idx < 1) return null
  const userId = id.slice(0, idx)
  const siteCode = id.slice(idx + 1)
  if (!userId || !siteCode) return null
  return { userId, siteCode }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req, 'USER_MANAGE')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const ctx = await buildAuthorizationContext(
      auth.user,
      auth.row.id,
      auth.row.allowedSites,
    )
    const { id } = await params
    const parsed = parseGrantId(id)
    if (!parsed) {
      return NextResponse.json(
        { error: 'รูปแบบ id ไม่ถูกต้อง (ต้องเป็น userId@siteCode)' },
        { status: 400 },
      )
    }
    const { userId, siteCode } = parsed

    // Load existing grant
    const existing = await db.userSiteGrant.findUnique({
      where: { userId_siteCode: { userId, siteCode } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'ไม่พบ grant ที่ระบุ' }, { status: 404 })
    }

    // Authorization: non-superadmin can only update grants for Sites in their scope
    if (!ctx.isSuperAdmin && !ctx.canAccessSite(siteCode)) {
      return NextResponse.json(
        { error: `คุณไม่มีสิทธิ์จัดการ grant ของ Site '${siteCode}'` },
        { status: 403 },
      )
    }

    const body = await req.json()
    const data: Record<string, unknown> = {}
    if (typeof body.roleCode === 'string' && body.roleCode.trim()) {
      // Validate role exists
      const role = await db.role.findUnique({
        where: { code: body.roleCode.trim() },
        select: { code: true, active: true },
      })
      if (!role || !role.active) {
        return NextResponse.json(
          { error: `ไม่พบ Role '${body.roleCode}' หรือ Role ถูกปิดใช้งาน` },
          { status: 400 },
        )
      }
      // ── Privilege escalation guard (same as POST) ──
      const PRIVILEGED_ROLES = new Set(['admin', 'superadmin'])
      if (!ctx.isSuperAdmin && PRIVILEGED_ROLES.has(body.roleCode.trim())) {
        return NextResponse.json(
          { error: `ไม่มีสิทธิ์มอบหมาย Role '${body.roleCode.trim()}' — เฉพาะ superadmin เท่านั้น` },
          { status: 403 },
        )
      }
      data.roleCode = body.roleCode.trim()
    }
    if (typeof body.active === 'boolean') data.active = body.active
    if (body.validFrom !== undefined) {
      const vf = body.validFrom ? new Date(body.validFrom) : null
      if (vf && isNaN(vf.getTime())) {
        return NextResponse.json(
          { error: 'วันที่ validFrom ไม่ถูกต้อง' },
          { status: 400 },
        )
      }
      data.validFrom = vf
    }
    if (body.validUntil !== undefined) {
      const vu = body.validUntil ? new Date(body.validUntil) : null
      if (vu && isNaN(vu.getTime())) {
        return NextResponse.json(
          { error: 'วันที่ validUntil ไม่ถูกต้อง' },
          { status: 400 },
        )
      }
      data.validUntil = vu
    }

    // ── Validate validFrom <= validUntil after merge ──
    const finalValidFrom = (data.validFrom as Date | null) ?? existing.validFrom
    const finalValidUntil = (data.validUntil as Date | null) ?? existing.validUntil
    if (finalValidFrom && finalValidUntil && finalValidFrom > finalValidUntil) {
      return NextResponse.json(
        { error: 'validFrom ต้องเป็นวันที่ก่อนหรือเท่ากับ validUntil' },
        { status: 400 },
      )
    }

    const updated = await db.userSiteGrant.update({
      where: { userId_siteCode: { userId, siteCode } },
      data,
    })

    await logAudit(
      'GRANT_UPDATE',
      'UserSiteGrant',
      id,
      `อัปเดต grant: ${userId} → ${siteCode}`,
      {
        userId,
        siteCode,
        previous: {
          roleCode: existing.roleCode,
          active: existing.active,
          validFrom: existing.validFrom?.toISOString() ?? null,
          validUntil: existing.validUntil?.toISOString() ?? null,
        },
        new: data,
      },
      auth.user.email,
    )

    return NextResponse.json({ grant: updated })
  } catch (err) {
    console.error('PATCH /api/itam/auth/site-grants/[id]', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to update grant') : 'Internal server error' },
      { status: 500 },
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req, 'USER_MANAGE')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const ctx = await buildAuthorizationContext(
      auth.user,
      auth.row.id,
      auth.row.allowedSites,
    )
    const { id } = await params
    const parsed = parseGrantId(id)
    if (!parsed) {
      return NextResponse.json(
        { error: 'รูปแบบ id ไม่ถูกต้อง' },
        { status: 400 },
      )
    }
    const { userId, siteCode } = parsed

    const existing = await db.userSiteGrant.findUnique({
      where: { userId_siteCode: { userId, siteCode } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'ไม่พบ grant ที่ระบุ' }, { status: 404 })
    }

    // Authorization: non-superadmin can only delete grants for Sites in their scope
    if (!ctx.isSuperAdmin && !ctx.canAccessSite(siteCode)) {
      return NextResponse.json(
        { error: `คุณไม่มีสิทธิ์จัดการ grant ของ Site '${siteCode}'` },
        { status: 403 },
      )
    }

    await db.userSiteGrant.delete({
      where: { userId_siteCode: { userId, siteCode } },
    })

    await logAudit(
      'GRANT_DELETE',
      'UserSiteGrant',
      id,
      `ลบ grant: ${userId} → ${siteCode} (${existing.roleCode})`,
      {
        userId,
        siteCode,
        deleted: {
          roleCode: existing.roleCode,
          active: existing.active,
        },
      },
      auth.user.email,
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/itam/auth/site-grants/[id]', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to delete grant') : 'Internal server error' },
      { status: 500 },
    )
  }
}
