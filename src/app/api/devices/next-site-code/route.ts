import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { getNextAssetSiteCode, getSiteCodeForName } from '@/lib/asset-site-code'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * GET /api/devices/next-site-code?site=<siteName|siteCode>&assetNo=<assetCode>
 *
 * Returns the next available AssetSiteCode for the given site, using the
 * same algorithm as the Apps Script `getNextAssetSiteCode`:
 *   • Resolve the site prefix (e.g. "UDH") via SiteAttribute / MasterItem /
 *     existing devices.
 *   • Find MAX(assetSiteCode) for that site across all devices + history.
 *   • Return PREFIX-(MAX+1), zero-padded to 5 digits (e.g. "UDH-00042").
 */
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { searchParams } = new URL(req.url)
    const siteParam = searchParams.get('site')?.trim() ?? ''
    const assetNo = searchParams.get('assetNo')?.trim() || undefined

    if (!siteParam) {
      return NextResponse.json(
        { error: 'Missing required query param: site' },
        { status: 400 },
      )
    }

    // Resolve site name: accept either a site CODE (e.g. "UDH") or a site
    // NAME (e.g. "ชื่อสาขา (e.g. สำนักงานใหญ่)"). Look up via SiteAttribute first.
    let siteName = siteParam
    const upper = siteParam.toUpperCase()

    // 1. SiteAttribute — match by SiteCode
    const saByCode = await db.siteAttribute.findUnique({
      where: { SiteCode: upper },
      select: { SiteName: true, SiteCode: true },
    })
    if (saByCode?.SiteName) {
      siteName = saByCode.SiteName
    } else {
      // Try by SiteName
      const saByName = await db.siteAttribute.findFirst({
        where: { SiteName: siteParam },
        select: { SiteName: true },
      })
      if (saByName?.SiteName) siteName = saByName.SiteName
    }

    const prefix = await getSiteCodeForName(siteName)
    const nextCode = await getNextAssetSiteCode(siteName, { assetNo })

    if (!nextCode || !prefix) {
      return NextResponse.json(
        {
          error: `ไม่พบรหัส Site สำหรับ "${siteParam}" — กรุณาตั้งค่า SiteAttribute (SiteCode + SiteName) ก่อน`,
          site: siteName,
          prefix: null,
          code: null,
        },
        { status: 404 },
      )
    }

    return NextResponse.json({
      site: siteName,
      prefix,
      code: nextCode,
    })
  } catch (err) {
    console.error('GET /api/devices/next-site-code', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to compute next site code') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
