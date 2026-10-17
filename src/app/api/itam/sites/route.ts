import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { getAllowedSites } from '@/lib/auth'

// GET /api/itam/sites — list all sites with device count
export async function GET(req: Request) {
  try {
    const auth = await requireAuth(req, 'VIEW_DEVICES')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row

    const userSites = getAllowedSites(user)
    const sites = await db.siteAttribute.findMany({
      orderBy: { SiteCode: 'asc' },
    })
    // Site-level filter — restrict the visible site list
    const visibleSites = userSites === 'ALL' ? sites : sites.filter((s) => userSites.includes(s.SiteName || ''))

    const sitesWithCounts = await Promise.all(
      visibleSites.map(async (s) => {
        const deviceCount = await db.device.count({ where: { site: s.SiteName || '' } })
        const activeCount = await db.device.count({
          where: { site: s.SiteName || '', status: 'Active' },
        })
        // Normalize field names for front-end (lowercase aliases) + return original
        // SiteAttribute fields (SiteCode, SiteName, PaperRateBW, PaperRateColor).
        // Bug Group E fix: include lowercase paperRateBw/paperRateColor aliases
        // so the "สาขา (ภาพรวม)" tab in Settings reads the SAME rate that
        // "จัดการสาขา" writes — both source from SiteAttribute (single source
        // of truth). Previously "สาขา (ภาพรวม)" used 0.5/2 fallback because
        // the lowercase alias was missing.
        return {
          ...s,
          siteCode: s.SiteCode,
          siteName: s.SiteName,
          paperRateBw: s.PaperRateBW,
          paperRateColor: s.PaperRateColor,
          deviceCount,
          activeCount,
        }
      }),
    )

    return NextResponse.json({ sites: sitesWithCounts })
  } catch (err) {
    console.error('GET /api/itam/sites', err)
    return NextResponse.json({ error: 'Failed to fetch sites' }, { status: 500 })
  }
}
