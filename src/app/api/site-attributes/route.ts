import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireAuth } from '@/lib/auth-middleware'

/**
 * GET /api/site-attributes
 *
 * Returns all SiteAttribute rows (site code + name + LINE OA + hotline +
 * paper rates). Used by the "ตั้งค่าสาขา" admin page and by the
 * /api/devices/next-site-code endpoint to resolve site prefixes.
 *
 * Auth: any authenticated user (staff need to see site info for selects).
 */
export async function GET(req: NextRequest) {
  // ── P0 Security: require authentication ──
  // Site attributes include LINE OA tokens, hotlines, and other contact info
  // that must not be publicly readable. Staff can view; ADMIN-only for writes.
  const auth = await requireAuth(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const sites = await db.siteAttribute.findMany({
      orderBy: { SiteCode: 'asc' },
    })
    return NextResponse.json({ sites })
  } catch (err) {
    console.error('GET /api/site-attributes', err)
    return NextResponse.json(
      { error: 'Failed to fetch site attributes' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/site-attributes
 *
 * Create a new SiteAttribute row. Also mirrors the site into MasterItem
 * (category='Site', code=SiteCode, label=SiteName) so it appears in the
 * unified master-data UI and search.
 *
 * Body:
 *   siteCode     — e.g. "UDH", "NKP" (required, unique, uppercase)
 *   siteName     — e.g. "ชื่อสาขา (e.g. สำนักงานใหญ่)" (required)
 *   lineOa       — LINE OA ID/Token (optional)
 *   hotline      — เบอร์ติดต่อ (optional)
 *   paperRateBw  — ฿/แผ่น ขาวดำ (optional, default 0.5)
 *   paperRateColor — ฿/แผ่น สี (optional, default 2.0)
 */
export async function POST(req: NextRequest) {
  // ── P0 Security: require ADMIN permission for writes ──
  // Creating a new site attribute row controls site routing + LINE OA + rates.
  // Only ADMIN users may create or modify these.
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await req.json()
    const siteCode = String(body.siteCode ?? '').trim().toUpperCase()
    const siteName = String(body.siteName ?? '').trim()

    if (!siteCode || !siteName) {
      return NextResponse.json(
        { error: 'Missing required fields: siteCode, siteName' },
        { status: 400 },
      )
    }

    // Check for duplicate
    const existing = await db.siteAttribute.findUnique({
      where: { SiteCode: siteCode },
    })
    if (existing) {
      return NextResponse.json(
        { error: `รหัสสาขา ${siteCode} มีอยู่แล้ว` },
        { status: 409 },
      )
    }

    const created = await db.siteAttribute.create({
      data: {
        SiteCode: siteCode,
        SiteName: siteName,
        LineOA: body.lineOa ? String(body.lineOa).trim() : null,
        Hotline: body.hotline ? String(body.hotline).trim() : null,
        TelegramChatId: body.telegramChatId ? String(body.telegramChatId).trim() : null,
        EmailAddress: body.emailAddress ? String(body.emailAddress).trim() : null,
        PaperRateBW: typeof body.paperRateBw === 'number' ? body.paperRateBw : 0.5,
        PaperRateColor: typeof body.paperRateColor === 'number' ? body.paperRateColor : 2.0,
      },
    })

    // Mirror into MasterItem so it appears in the master-data UI + search
    try {
      await db.masterItem.create({
        data: {
          category: 'Site',
          code: siteCode,
          label: siteName,
          siteCode: siteCode,
          displayLabel: siteName,
          active: true,
        },
      })
    } catch {
      // Mirror is best-effort — don't fail the whole request if it duplicates
    }

    await logAudit(
      'CREATE',
      'SiteAttribute',
      created.id,
      `เพิ่มสาขา ${siteCode} (${siteName})`,
      { siteCode, siteName },
    )

    return NextResponse.json({ site: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/site-attributes', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to create site attribute') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
