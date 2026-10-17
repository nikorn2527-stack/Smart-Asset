import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { validateGuestContact } from '@/lib/guest-validation'
import { loadAuthorizedWorkOrder } from '@/lib/wo-authz'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// ============================================================
// PUT /api/work-orders/[id]/reporter-edit
// Lets staff with WO_ASSIGN edit a work order's reporter info.
//
// Auth: requires WO_ASSIGN at the WO's Site (staff-only). The
// original guest-edit flow is preserved as an additional
// identity-verification layer (the caller must still supply the
// reporter's name + phone, which is validated against the
// contactDirectory and cross-checked with the stored reporter).
//
// Required body:
//   - verifyName: string  (reporter name for identity check)
//   - verifyPhone: string (reporter phone for identity check)
//   - optional employeeCode for stricter match
//
// Editable fields (all optional):
//   - subject, building, location, details, tel
// ============================================================

async function logAudit(
  action: string,
  entityId: string | null,
  summary: string,
  detail: Record<string, unknown> | null,
  actor: string,
  siteCode?: string | null,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action,
        entity: 'WorkOrder',
        entityId,
        summary,
        detail: detail ? JSON.stringify(detail) : null,
        actor,
        siteCode: siteCode ?? null,
      },
    })
  } catch (err) {
    console.error('logAudit failed:', err)
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'WO_COMPLETE')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const { id } = await params

    // Authenticate + authorize — editing reporter info requires WO_ASSIGN
    const result = await loadAuthorizedWorkOrder(req, id, 'WO_ASSIGN')
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { wo, auth } = result

    const body = await req.json()
    const {
      verifyName,
      verifyPhone,
      employeeCode,
      subject,
      building,
      location,
      details,
      tel,
    } = body as Record<string, unknown>

    // Only allow editing while PENDING (before staff accepts)
    if (wo.status !== 'PENDING') {
      return NextResponse.json(
        {
          error: `แก้ไขเองได้เฉพาะใบงานที่ยังไม่ถูกรับ (สถานะปัจจุบัน: ${wo.status})`,
        },
        { status: 400 },
      )
    }

    // ── Verify identity ──
    // The caller must still supply the reporter's name + phone, which we
    // validate against the contactDirectory and cross-check with the WO's
    // stored reporter. This is an additional safety layer on top of auth.
    const nameStr = typeof verifyName === 'string' ? verifyName.trim() : ''
    const phoneStr = typeof verifyPhone === 'string' ? verifyPhone.trim() : ''
    const codeStr =
      typeof employeeCode === 'string' ? employeeCode.trim() : ''

    if (!nameStr || !phoneStr) {
      return NextResponse.json(
        { error: 'ต้องระบุชื่อและเบอร์โทรของผู้แจ้งเพื่อยืนยันตัวตนก่อนแก้ไข' },
        { status: 400 },
      )
    }

    // Re-validate against contactDirectory
    const validation = await validateGuestContact({
      name: nameStr,
      phone: phoneStr,
      employeeCode: codeStr || null,
    })
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error ?? 'ยืนยันตัวตนไม่สำเร็จ' },
        { status: 403 },
      )
    }

    // Cross-check: the verified identity must match the WO's stored reporter
    const canonicalName = (validation.canonicalName ?? '').trim()
    const canonicalPhone = (validation.canonicalPhone ?? '').trim()
    if (
      (wo.reporterName ?? '').trim() !== canonicalName ||
      (wo.tel ?? '').trim() !== canonicalPhone
    ) {
      return NextResponse.json(
        {
          error:
            'ชื่อ/เบอร์ที่ยืนยันไม่ตรงกับผู้แจ้งในใบงานนี้ ไม่สามารถแก้ไขได้',
        },
        { status: 403 },
      )
    }

    // ── Apply edits ──
    const data: Record<string, unknown> = {}
    if (typeof subject === 'string' && subject.trim()) {
      data.subject = subject.trim()
    }
    if (building !== undefined) {
      data.building = building ? String(building).trim() : null
    }
    if (location !== undefined) {
      data.location = location ? String(location).trim() : null
    }
    if (details !== undefined) {
      data.details = details ? String(details).trim() : null
    }
    if (tel !== undefined) {
      data.tel = tel ? String(tel).trim() : null
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: 'ไม่มีฟิลด์ที่ต้องการแก้ไข' },
        { status: 400 },
      )
    }

    const before = {
      subject: wo.subject,
      building: wo.building,
      location: wo.location,
      details: wo.details,
      tel: wo.tel,
    }
    const updated = await db.workOrder.update({ where: { id: wo.id }, data })

    await db.workOrderMessage.create({
      data: {
        workOrderId: wo.id,
        message: `แก้ไขรายละเอียดใบงานโดย ${auth.user.email}`,
        author: auth.user.email,
        authorRole: 'admin',
      },
    })

    // Audit-log actor = authenticated user (not the body-supplied reporter name).
    await logAudit(
      'WO_REPORTER_EDIT',
      wo.id,
      `${auth.user.email} แก้ไขใบงาน ${updated.woNumber ?? wo.id}`,
      { before, after: data, verifiedReporter: canonicalName },
      auth.user.email,
      result.woSite,
    )

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/work-orders/[id]/reporter-edit', err)
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to edit work order') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
