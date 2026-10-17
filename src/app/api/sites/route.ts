import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireAuth } from '@/lib/auth-middleware'

/**
 * GET /api/sites — list all sites from the SiteAttribute table.
 * Returns the camelCase fields the SiteAttribute model uses:
 *   SiteCode, SiteName, LineOA, Hotline, PaperRateBW, PaperRateColor
 *
 * (Previously this read from the legacy `Site` table which has 0 rows in
 * Supabase — the real source of truth for sites lives in SiteAttribute.)
 *
 * Response shape (intentionally flat — matches what the device form +
 * sidebar filter expect):
 *   { sites: [{ id, code: SiteCode, name: SiteName, paperRateBw, paperRateColor, hotline, lineOa }] }
 *
 * Auth: any authenticated user can list Sites, but sensitive fields
 * (LINE OA token, Telegram chat ID, email address) are stripped for
 * non-admin callers. Previously this endpoint was completely public —
 * anyone (including unauthenticated callers) could enumerate every
 * Site and harvest contact tokens.
 */
// Cache sites for 5 minutes — list changes infrequently.
export const revalidate = 300

export async function GET(req: NextRequest) {
  // ── Require authentication ──
  // Even read-only access to the Site list is gated because the table
  // contains LINE OA tokens and other integration secrets.
  const auth = await requireAuth(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  // Master-data editors and admins see the full Site record (incl. tokens).
  // Everyone else gets a redacted shape (no LineOA / TelegramChatId / Email).
  const canSeeSensitive =
    auth.user.role === 'superadmin' ||
    auth.user.role === 'admin' ||
    auth.user.permissions.includes('MASTER_DATA_EDIT') ||
    auth.user.permissions.includes('SYSTEM_CONFIG')

  try {
    const rows = await db.siteAttribute.findMany({
      orderBy: { SiteCode: 'asc' },
    })
    const sites = rows.map((s) => ({
      id: s.id,
      code: s.SiteCode,
      name: s.SiteName ?? s.SiteCode,
      // Only expose integration tokens to master-data editors / admins.
      lineOa: canSeeSensitive ? (s.LineOA ?? null) : null,
      hotline: s.Hotline ?? null,
      paperRateBw: s.PaperRateBW ?? null,
      paperRateColor: s.PaperRateColor ?? null,
    }))
    return NextResponse.json({ sites })
  } catch (err) {
    console.error('GET /api/sites', err)
    return NextResponse.json({ error: 'Failed to fetch sites' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // ── Require MASTER_DATA_EDIT or SYSTEM_CONFIG ──
  // Site creation/upsert is master-data administration. Previously this
  // endpoint was completely public — anyone could create a Site row,
  // which would then be picked up by every Site-scoped query in the app.
  const auth = await requireAuth(req, 'MASTER_DATA_EDIT')
  if (!auth.ok) {
    // Try SYSTEM_CONFIG as a fallback (superadmins route through this).
    const auth2 = await requireAuth(req, 'SYSTEM_CONFIG')
    if (!auth2.ok) {
      return NextResponse.json(
        { error: auth2.error || auth.error },
        { status: auth2.status },
      )
    }
  }
  try {
    const body = await req.json()
    const code = String(body.code || '').trim().toUpperCase()
    const name = String(body.name || '').trim()
    if (!code || !name) {
      return NextResponse.json(
        { error: 'Missing required fields: code, name' },
        { status: 400 },
      )
    }
    // Upsert by SiteCode — if the row already exists, just update SiteName.
    const created = await db.siteAttribute.upsert({
      where: { SiteCode: code },
      update: { SiteName: name },
      create: { SiteCode: code, SiteName: name },
    })
    await logAudit(
      'CREATE',
      'Site',
      created.id,
      `เพิ่มสาขา ${created.SiteCode} (${created.SiteName})`,
      { code: created.SiteCode, name: created.SiteName },
      auth.ok ? auth.user.email : 'system',
    )
    return NextResponse.json(
      {
        site: {
          id: created.id,
          code: created.SiteCode,
          name: created.SiteName ?? created.SiteCode,
        },
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('POST /api/sites', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to create site') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
