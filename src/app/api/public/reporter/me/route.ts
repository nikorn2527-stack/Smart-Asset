import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLineSession } from '@/lib/line-session'

/**
 * GET /api/public/reporter/me
 *
 * Public endpoint (no staff auth required) that returns the calling
 * reporter's previously stored profile info, looked up by LINE userId.
 *
 * Used by the public repair form to auto-fill name/phone/email on
 * subsequent submissions (so the user doesn't have to re-type every
 * time).
 *
 * Auth: the caller must have a valid `line_session` cookie (set by
 * /api/auth/line/callback after LINE Login). We extract the LINE
 * userId from the session and look up the PublicReporter record by
 * (siteCode, lineUserId).
 *
 * Query params:
 *   ?siteCode=PPIT  — optional, narrows the lookup to a specific site.
 *                     If omitted, returns the most recently updated
 *                     reporter for this LINE userId across all sites.
 *
 * Response 200:
 *   { data: { id, siteCode, name, phone, email, phoneVerified, reportCount, lastReportAt, defaultDeviceId } }
 *
 * Response 401: no LINE session
 * Response 404: no matching PublicReporter (first-time user — data: null)
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const session = await getLineSession(req)
    if (!session) {
      return NextResponse.json(
        { error: 'Not authenticated', data: null },
        { status: 401 },
      )
    }

    const url = new URL(req.url)
    const siteCode = url.searchParams.get('siteCode')?.trim()

    // Look up the PublicReporter by (siteCode, lineUserId) if siteCode is
    // provided; otherwise return the most recently updated reporter for
    // this LINE userId across all sites.
    const reporter = siteCode
      ? await db.publicReporter.findUnique({
          where: {
            siteCode_lineUserId: {
              siteCode,
              lineUserId: session.userId,
            },
          },
          select: {
            id: true,
            siteCode: true,
            name: true,
            phone: true,
            email: true,
            phoneVerified: true,
            reportCount: true,
            lastReportAt: true,
            defaultDeviceId: true,
          },
        })
      : await db.publicReporter.findFirst({
          where: { lineUserId: session.userId },
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            siteCode: true,
            name: true,
            phone: true,
            email: true,
            phoneVerified: true,
            reportCount: true,
            lastReportAt: true,
            defaultDeviceId: true,
          },
        })

    if (!reporter) {
      // First-time user — they'll need to fill the form manually.
      return NextResponse.json(
        { data: null, isFirstTime: true },
        { status: 200 },
      )
    }

    return NextResponse.json({
      data: reporter,
      isFirstTime: false,
    })
  } catch (err) {
    console.error('GET /api/public/reporter/me', err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: 'Internal error', detail: message },
      { status: 500 },
    )
  }
}
