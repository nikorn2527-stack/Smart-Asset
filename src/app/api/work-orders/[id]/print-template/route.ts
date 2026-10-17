// ============================================================
// PATCH /api/work-orders/[id]/print-template
// (Task ID: VISUAL-TEMPLATE-EDITOR, PART 2)
// ============================================================
// Saves the user's "remember this template for this WO" choice.
//
// Auth: requires WO_VIEW_ALL at the WO's Site (allowOwn so reporters
// can pin a template on their own WO).
//
// Body: { printTemplateId: string | null, setAsDefault?: boolean }
//   • printTemplateId — null clears the saved choice
//   • setAsDefault=true — also mark this template as the default
//     for its type (so other WOs use it too)
//
// Returns: { workOrder, template? }
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { loadAuthorizedWorkOrder } from '@/lib/wo-authz'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import type { DocumentTemplate } from '@prisma/client'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  try {
    const { id } = await params

    // Authenticate + authorize — saving the per-WO print template
    // choice requires WO_VIEW_ALL (allowOwn for reporters).
    const result = await loadAuthorizedWorkOrder(req, id, 'WO_VIEW_ALL', {
      allowOwn: true,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { wo, auth } = result

    const body = await req.json()
    const printTemplateId =
      typeof body.printTemplateId === 'string' && body.printTemplateId
        ? body.printTemplateId
        : null
    const setAsDefault = body.setAsDefault === true

    // Validate that the template exists (if a non-null id is provided).
    //
    // The type must be annotated: with a bare `let template = null` TypeScript
    // infers `null`, so after the `if (!template)` guard the variable narrows
    // to `never` and every `template.type` / `template.id` / `template.name`
    // access below fails to typecheck.
    let template: DocumentTemplate | null = null
    if (printTemplateId) {
      template = await db.documentTemplate.findUnique({
        where: { id: printTemplateId },
      })
      if (!template) {
        return NextResponse.json(
          { error: 'ไม่พบเทมเพลตที่เลือก' },
          { status: 404 },
        )
      }
    }

    const updated = await db.workOrder.update({
      where: { id: wo.id },
      data: { printTemplateId },
    })

    // Optionally promote template to default for its type
    if (setAsDefault && template) {
      await db.documentTemplate.updateMany({
        where: {
          type: template.type,
          isDefault: true,
          id: { not: template.id },
        },
        data: { isDefault: false },
      })
      await db.documentTemplate.update({
        where: { id: template.id },
        data: { isDefault: true },
      })
    }

    // Actor identity comes from the authenticated session.
    await logAudit(
      'UPDATE',
      'WorkOrder',
      wo.id,
      printTemplateId
        ? `ตั้งเทมเพลตพิมพ์ "${template?.name ?? ''}" สำหรับใบงาน ${wo.woNumber ?? wo.id}`
        : `ล้างการจำเทมเพลตพิมพ์ของใบงาน ${wo.woNumber ?? wo.id}`,
      { printTemplateId, setAsDefault },
      auth.user.email,
      result.woSite,
    )

    return NextResponse.json({ workOrder: updated, template })
  } catch (err) {
    console.error('PATCH /api/work-orders/[id]/print-template', err)
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'บันทึกเทมเพลตไม่สำเร็จ') : 'Internal server error',
      },
      { status: 500 },
    )
  }
}
