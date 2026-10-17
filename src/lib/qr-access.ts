import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { getOrgScope } from '@/lib/org-scope'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { demoFilter } from '@/lib/demo-mode'

export async function qrAccess(req: Request) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return { ok: false as const, response: unavailable }
  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) return { ok: false as const, response: NextResponse.json({ error: auth.error }, { status: auth.status }) }
  const org = getOrgScope(auth.user)
  if (!org.ok) return { ok: false as const, response: NextResponse.json({ error: org.error.message }, { status: org.error.status }) }
  const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)
  return { ok: true as const, ctx, scope: { ...org.where, ...demoFilter(auth.user), ...ctx.siteWhere() } }
}
