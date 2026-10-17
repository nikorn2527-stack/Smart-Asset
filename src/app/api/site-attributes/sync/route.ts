import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// Heavy operation — needs longer timeout (Vercel Hobby: max 60s)
export const maxDuration = 60

/**
 * POST /api/site-attributes/sync
 *
 * One-shot sync: for every SiteAttribute row, ensure a matching MasterItem
 * (category='Site', code=SiteCode, label=SiteName) exists. Used after
 * importing data from Apps Script when SiteAttribute rows exist but
 * MasterItem category='Site' rows don't.
 *
 * Idempotent — safe to call multiple times.
 */
export async function POST(_req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('sync')
  if (unavailable) return unavailable


  try {
    const sites = await db.siteAttribute.findMany({
      select: { id: true, SiteCode: true, SiteName: true, PaperRateBW: true, PaperRateColor: true },
    })
    let created = 0
    let updated = 0
    let skipped = 0

    for (const s of sites) {
      if (!s.SiteCode) {
        skipped++
        continue
      }
      const existing = await db.masterItem.findFirst({
        where: { category: 'Site', code: s.SiteCode },
      })
      if (!existing) {
        await db.masterItem.create({
          data: {
            category: 'Site',
            code: s.SiteCode,
            label: s.SiteName ?? s.SiteCode,
            siteCode: s.SiteCode,
            displayLabel: s.SiteName,
            active: true,
          },
        })
        created++
      } else {
        // Update label/siteCode if drifted
        if (existing.label !== (s.SiteName ?? s.SiteCode) || !existing.siteCode) {
          await db.masterItem.update({
            where: { id: existing.id },
            data: {
              label: s.SiteName ?? s.SiteCode,
              siteCode: s.SiteCode,
              displayLabel: s.SiteName,
            },
          })
          updated++
        } else {
          skipped++
        }
      }
    }

    await logAudit(
      'SYNC',
      'SiteAttribute',
      'sync',
      `Sync SiteAttribute → MasterItem: ${created} created, ${updated} updated, ${skipped} skipped`,
      { created, updated, skipped, total: sites.length },
    )

    return NextResponse.json({
      ok: true,
      total: sites.length,
      created,
      updated,
      skipped,
    })
  } catch (err) {
    console.error('POST /api/site-attributes/sync', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to sync site attributes') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
