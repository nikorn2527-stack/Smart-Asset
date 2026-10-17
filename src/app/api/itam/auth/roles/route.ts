/**
 * GET /api/itam/auth/roles — list all roles + their permissions
 *
 * Task ID: PHASE1-AUTH-FOUNDATION
 *
 * Returns the Role catalog with associated permissions. Used by the
 * admin UI to render the user-management and grant-management screens.
 *
 * Authorization: requires VIEW_DASHBOARD (any authenticated user can see
 * the role list, since it's needed for UI labels). Permission details
 * are only shown to users with USER_MANAGE.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { hasResolvedPermission } from '@/lib/auth'

export async function GET(req: NextRequest) {
  // ── Authentication: require VIEW_DASHBOARD (any authenticated user can
  // see the role list for UI labels, but only USER_MANAGE sees permission details) ──
  // Previously the comment said VIEW_DASHBOARD but the code only called
  // requireAuth(req) without a permission, which was inconsistent.
  const auth = await requireAuth(req, 'VIEW_DASHBOARD')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const canManageUsers = hasResolvedPermission(auth.user.permissions, 'USER_MANAGE')
    const roles = await db.role.findMany({
      where: { active: true },
      include: {
        permissions: {
          include: {
            // Always select all fields to avoid TS union type issues;
            // we filter the output in the map() below based on canManageUsers
            permission: {
              select: { code: true, resource: true, action: true, description: true },
            },
          },
        },
      },
      orderBy: { code: 'asc' },
    })

    const formatted = roles.map((r) => ({
      code: r.code,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissions: r.permissions.map((rp) =>
        canManageUsers
          ? {
              code: rp.permission.code,
              resource: rp.permission.resource,
              action: rp.permission.action,
              description: rp.permission.description,
            }
          : { code: rp.permission.code },
      ),
    }))

    return NextResponse.json({ roles: formatted })
  } catch (err) {
    console.error('GET /api/itam/auth/roles', err)
    return NextResponse.json(
      { error: 'Failed to fetch roles' },
      { status: 500 },
    )
  }
}
