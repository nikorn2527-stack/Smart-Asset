import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getServerLang, type Lang } from '@/lib/server-i18n'
import { checkRateLimit, getClientIP } from '@/lib/rate-limit-kv'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// ============================================================
// Public QR Scan-to-View (Feature 5)
//   GET /api/public/work-orders/[id]
//
// NO AUTH REQUIRED — this endpoint is designed for public QR code
// scanning. It returns ONLY a sanitized subset of WO fields safe for
// public consumption:
//
//   woNumber, subject, status, building, location, createdAt, closedAt
//
// Deliberately EXCLUDED for privacy:
//   - reporterName / reporterEmail / tel / employeeCode
//
// Rate limit: 60 requests/hour per IP (prevents enumeration of
// all work orders across all sites).
// ============================================================

const WO_VIEW_RATE_LIMIT = 60 // per hour per IP
//   - detailsAdmin / dateAdmin / resolution / resolutionGroup
//   - assignmentNote / assignedTo / assignedBy
//   - externalMeta (client contact info, phone, serials)
//   - messages / reviews / images / audit logs
//   - deviceId (the cuid; we DO return device.assetCode + name only)
//
// The `id` path segment may be either:
//   • a WorkOrder.id (cuid) — primary
//   • a WorkOrder.woNumber (e.g. WO-20241201-001) — fallback for
//     short URLs in printed QR codes
// ============================================================

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'รอดำเนินการ',
  IN_PROGRESS: 'กำลังซ่อม',
  WAITING_PARTS: 'รออะไหล่',
  COMPLETED: 'เสร็จแล้ว',
  CANCELLED: 'ยกเลิก',
}

function formatThaiDateTime(iso: Date | string | null | undefined, lang: Lang): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return String(iso)
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // I18N-04: resolve the caller's language server-side.
  const lang = getServerLang(req)

  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  try {
    // Rate limit — prevents enumeration of work orders
    const clientIP = getClientIP(req)
    const rlKey = `public-wo-view:${clientIP}`
    const rl = await checkRateLimit(rlKey, { maxRequests: WO_VIEW_RATE_LIMIT, windowMs: 60 * 60 * 1000 })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'คำขอเกินขีดจำกัด — กรุณาลองใหม่ภายหลัง' },
        { status: 429, headers: { 'Retry-After': '3600' } },
      )
    }

    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Try by id (cuid) first, then by woNumber
    const wo = await db.workOrder.findFirst({
      where: {
        OR: [{ id }, { woNumber: id }],
      },
      select: {
        id: true,
        woNumber: true,
        subject: true,
        status: true,
        priority: true,
        building: true,
        location: true,
        createdAt: true,
        workCompletedAt: true,
        closedAt: true,
        canceledAt: true,
        cancelReason: true,
        device: {
          select: {
            assetCode: true,
            name: true,
            brand: true,
            model: true,
            site: true,
          },
        },
      },
    })

    if (!wo) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Sanitized public payload — no PII, no admin notes, no messages.
    return NextResponse.json({
      data: {
        woNumber: wo.woNumber,
        subject: wo.subject,
        status: wo.status,
        statusLabel: STATUS_LABELS[wo.status] ?? wo.status,
        priority: wo.priority,
        building: wo.building,
        location: wo.location,
        createdAt: formatThaiDateTime(wo.createdAt, lang),
        closedAt: formatThaiDateTime(wo.closedAt, lang),
        canceledAt: formatThaiDateTime(wo.canceledAt, lang),
        cancelReason: wo.status === 'CANCELLED' ? wo.cancelReason : null,
        device: wo.device
          ? {
              assetCode: wo.device.assetCode,
              name: wo.device.name,
              brand: wo.device.brand,
              model: wo.device.model,
              site: wo.device.site,
            }
          : null,
      },
    })
  } catch (err) {
    console.error('GET /api/public/work-orders/[id]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
