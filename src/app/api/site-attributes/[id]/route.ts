import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireAuth } from '@/lib/auth-middleware'

/**
 * PUT /api/site-attributes/[id]
 *
 * Update a SiteAttribute row. Also syncs the change into MasterItem
 * (category='Site') so the master-data UI stays consistent.
 *
 * Auth: ADMIN only — site attributes include LINE OA tokens, hotlines,
 * and other contact info that should only be modified by admins.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // P0 Security: require ADMIN — site attributes include LINE OA + hotline
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const body = await req.json()

    const before = await db.siteAttribute.findUnique({ where: { id } })
    if (!before) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const updated = await db.siteAttribute.update({
      where: { id },
      data: {
        SiteCode: body.siteCode ? String(body.siteCode).trim().toUpperCase() : undefined,
        SiteName: body.siteName !== undefined ? (body.siteName ? String(body.siteName).trim() : null) : undefined,
        LineOA: body.lineOa !== undefined ? (body.lineOa ? String(body.lineOa).trim() : null) : undefined,
        Hotline: body.hotline !== undefined ? (body.hotline ? String(body.hotline).trim() : null) : undefined,
        TelegramChatId: body.telegramChatId !== undefined ? (body.telegramChatId ? String(body.telegramChatId).trim() : null) : undefined,
        EmailAddress: body.emailAddress !== undefined ? (body.emailAddress ? String(body.emailAddress).trim() : null) : undefined,
        PaperRateBW: typeof body.paperRateBw === 'number' ? body.paperRateBw : undefined,
        PaperRateColor: typeof body.paperRateColor === 'number' ? body.paperRateColor : undefined,
      },
    })

    // Sync into MasterItem (category='Site')
    try {
      await db.masterItem.updateMany({
        where: { category: 'Site', code: before.SiteCode },
        data: {
          code: updated.SiteCode,
          label: updated.SiteName ?? before.SiteName ?? updated.SiteCode,
          siteCode: updated.SiteCode,
          displayLabel: updated.SiteName ?? before.SiteName ?? null,
        },
      })
    } catch {
      // best-effort sync
    }

    await logAudit(
      'UPDATE',
      'SiteAttribute',
      id,
      `แก้ไขสาขา ${updated.SiteCode} (${updated.SiteName ?? '-'})`,
      { from: before, to: updated },
    )

    return NextResponse.json({ site: updated })
  } catch (err) {
    console.error('PUT /api/site-attributes/[id]', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to update site attribute') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * DELETE /api/site-attributes/[id]
 *
 * Remove a SiteAttribute row. Also deactivates (not deletes) the
 * corresponding MasterItem row so historical references stay intact.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const site = await db.siteAttribute.findUnique({ where: { id } })
    if (!site) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await db.siteAttribute.delete({ where: { id } })

    // Deactivate the mirror MasterItem (don't delete — keep history)
    try {
      await db.masterItem.updateMany({
        where: { category: 'Site', code: site.SiteCode },
        data: { active: false },
      })
    } catch {
      // best-effort
    }

    await logAudit(
      'DELETE',
      'SiteAttribute',
      id,
      `ลบสาขา ${site.SiteCode} (${site.SiteName ?? '-'})`,
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/site-attributes/[id]', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to delete site attribute') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
