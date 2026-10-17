import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import type { Permission } from '@/lib/auth-shared'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { getOrgScope } from '@/lib/org-scope'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { demoFilter } from '@/lib/demo-mode'

export async function pmAccess(req: Request, permission: Permission = 'VIEW_DASHBOARD') {
  const disabled = await moduleUnavailableResponse('pm')
  if (disabled) return { ok: false as const, response: disabled }
  const auth = await requireAuth(req, permission)
  if (!auth.ok) return { ok: false as const, response: NextResponse.json({ error: auth.error }, { status: auth.status }) }
  const org = getOrgScope(auth.user)
  if (!org.ok) return { ok: false as const, response: NextResponse.json({ error: org.error.message }, { status: org.error.status }) }
  const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)
  // An unassigned legacy plan is never inferred to belong to the caller's organization.
  const scope = { ...org.where, ...demoFilter(auth.user), deletedAt: null, ...ctx.siteWhere() }
  return { ok: true as const, auth, ctx, scope, deviceScope: { ...org.where, ...demoFilter(auth.user), deletedAt: null, ...ctx.siteWhere() } }
}
