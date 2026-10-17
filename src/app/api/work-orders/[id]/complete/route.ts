import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db, getBaseClient } from '@/lib/db'
import { notifyWorkOrderCompleted } from '@/lib/notifications'
import { loadAuthorizedWorkOrder } from '@/lib/wo-authz'
import { getRepairJobReferences } from '@/lib/repair-job-references'
import { validateRepairCompletionInput } from '@/lib/repair-completion-contract'
import { resolveRepairRequester } from '@/lib/repair-identity'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/** Parse an Int; returns 0 when missing/invalid. */
function optInt(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.round(n)
}

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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  // Auth: loadAuthorizedWorkOrder does the site-scoped WO_COMPLETE check.
  // Basic auth here — wo-authz layer enforces the correct permission.
  const auth = await requireAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const { id } = await params

    // Authenticate + authorize — completing a WO requires WO_COMPLETE at its Site
    const result = await loadAuthorizedWorkOrder(req, id, 'WO_COMPLETE')
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { wo, auth } = result

    const body = await req.json()
    const {
      note,
      picAfter,
      picOnsite,
      resolution,
      resolutionGroup,
      parts,
      autoApproveParts,
    } = body as {
      note?: unknown
      picAfter?: unknown
      picOnsite?: unknown
      resolution?: unknown
      resolutionGroup?: unknown
      parts?: unknown
      autoApproveParts?: unknown
    }

    const completionInput = validateRepairCompletionInput({
      note,
      picAfter,
      picOnsite,
      resolution,
      resolutionGroup,
    })
    if (!completionInput.ok) {
      return NextResponse.json(
        {
          error: `ข้อมูลปิดงานไม่ถูกต้อง: ${completionInput.field}`,
          code: completionInput.code,
          field: completionInput.field,
        },
        { status: 400 },
      )
    }
    const {
      note: normalizedNote,
      picAfter: normalizedPicAfter,
      picOnsite: normalizedPicOnsite,
      resolution: normalizedResolution,
      resolutionGroup: normalizedResolutionGroup,
    } = completionInput.value

    if (wo.status === 'COMPLETED') {
      return NextResponse.json(
        { error: 'ใบงานนี้ปิดไปแล้ว ไม่สามารถทำเครื่องหมายเสร็จได้อีก' },
        { status: 400 },
      )
    }
    if (wo.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'ใบงานนี้ถูกยกเลิก ไม่สามารถทำเครื่องหมายเสร็จได้' },
        { status: 400 },
      )
    }

    // ── Step 2: เบิกอะไหล่ตอนปิดงาน ──
    // Optional parts[] + autoApproveParts payload submitted from the
    // CompleteDialog. When `parts[]` is non-empty:
    //   - autoApproveParts=true  → create APPROVED stock-outs (reduce stock
    //     immediately) so the WO can still complete in this request.
    //   - autoApproveParts=false → create PENDING requests, flip the WO to
    //     WAITING_PARTS, and return early WITHOUT completing (the existing
    //     pendingPartsCount guard below would otherwise block completion).
    const actorName = auth.user.email
    const requesterLabel = resolveRepairRequester(auth.user)
    const partsList = Array.isArray(parts) ? parts : []
    const shouldAutoApproveParts = Boolean(autoApproveParts)

    type ValidatedPart = {
      item: {
        id: string
        productCode: string
        productName: string
        unit: string
        unitCost: number | null
        quantity: number
      }
      quantity: number
      remark: string | null
    }
    const validatedParts: ValidatedPart[] = []
    for (const raw of partsList) {
      const productCode = String((raw as { productCode?: unknown })?.productCode ?? '').trim()
      const qty = optInt((raw as { quantity?: unknown })?.quantity, 0)
      const remarkRaw = (raw as { remark?: unknown })?.remark
      const remark =
        typeof remarkRaw === 'string' && remarkRaw.trim() ? remarkRaw.trim() : null
      if (!productCode) {
        return NextResponse.json(
          { error: 'กรุณาระบุรหัสสินค้า (productCode) สำหรับทุกรายการอะไหล่' },
          { status: 400 },
        )
      }
      if (qty <= 0) {
        return NextResponse.json(
          { error: `จำนวนสำหรับ ${productCode} ต้องมากกว่า 0` },
          { status: 400 },
        )
      }
      const item = await db.stockItem.findUnique({ where: { productCode } })
      if (!item) {
        return NextResponse.json(
          { error: `ไม่พบสินค้ารหัส ${productCode}` },
          { status: 400 },
        )
      }
      if (!item.active) {
        return NextResponse.json(
          { error: `สินค้า ${productCode} ถูกปิดใช้งานแล้ว` },
          { status: 400 },
        )
      }
      if (shouldAutoApproveParts && qty > item.quantity) {
        return NextResponse.json(
          {
            error: `สต็อกไม่เพียงพอสำหรับ ${productCode} (คงเหลือ ${item.quantity} ${item.unit} ต้องการ ${qty})`,
          },
          { status: 400 },
        )
      }
      // StockItem.unitCost is a Prisma `Decimal`; ValidatedPart.unitCost is typed
      // `number | null` and is multiplied / summed later — coerce at the
      // boundary so DecimalJs instances never leak into the arithmetic.
      validatedParts.push({
        item: {
          id: item.id,
          productCode: item.productCode,
          productName: item.productName,
          unit: item.unit,
          unitCost: item.unitCost !== null ? Number(item.unitCost) : null,
          quantity: item.quantity,
        },
        quantity: qty,
        remark,
      })
    }

    // Create parts transactions (if any were submitted) inside a single tx.
    if (validatedParts.length > 0) {
      const txnDate = new Date().toISOString().slice(0, 10)
      await getBaseClient().$transaction(async (tx) => {
        for (const v of validatedParts) {
          // Generate SP-YYYYMMDD-NNN (shared counter with /parts route).
          const ymd = txnDate.replace(/-/g, '').slice(0, 8)
          const prefix = `SP-${ymd}-`
          const existing = await tx.stockTransaction.findMany({
            where: { txnNumber: { startsWith: prefix } },
            select: { txnNumber: true },
          })
          let max = 0
          for (const t of existing) {
            if (!t.txnNumber) continue
            const m = /^SP-\d{8}-(\d+)$/.exec(t.txnNumber)
            if (m) {
              const n = parseInt(m[1], 10)
              if (Number.isFinite(n) && n > max) max = n
            }
          }
          const txnNumber = `${prefix}${String(max + 1).padStart(3, '0')}`

          if (shouldAutoApproveParts) {
            const newBalance = v.item.quantity - v.quantity
            await tx.stockItem.update({
              where: { id: v.item.id },
              data: { quantity: newBalance },
            })
            await tx.stockTransaction.create({
              data: {
                txnNumber,
                stockItemId: v.item.id,
                productCode: v.item.productCode,
                productName: v.item.productName,
                type: 'OUT',
                quantity: v.quantity,
                unit: v.item.unit,
                balanceAfter: newBalance,
                reason: `เบิกอะไหล่ใบงาน ${wo.woNumber ?? ''} (ปิดงาน-อนุมัติอัตโนมัติ)`,
                requester: requesterLabel,
                purpose: wo.subject,
                workOrderId: wo.id,
                workOrderNo: wo.woNumber,
                unitCost: v.item.unitCost,
                cost:
                  v.item.unitCost !== null
                    ? v.item.unitCost * v.quantity
                    : null,
                txnDate,
                remark: v.remark,
                approvalStatus: 'APPROVED',
                approvalMode: 'auto',
                approver: actorName,
                approvedAt: new Date().toISOString(),
                autoApproveAt: new Date().toISOString(),
              },
            })
          } else {
            await tx.stockTransaction.create({
              data: {
                txnNumber,
                stockItemId: v.item.id,
                productCode: v.item.productCode,
                productName: v.item.productName,
                type: 'OUT',
                quantity: v.quantity,
                unit: v.item.unit,
                balanceAfter: v.item.quantity,
                reason: `เบิกอะไหล่ใบงาน ${wo.woNumber ?? ''}`,
                requester: requesterLabel,
                purpose: wo.subject,
                workOrderId: wo.id,
                workOrderNo: wo.woNumber,
                unitCost: v.item.unitCost,
                cost:
                  v.item.unitCost !== null
                    ? v.item.unitCost * v.quantity
                    : null,
                txnDate,
                remark: v.remark,
                approvalStatus: 'PENDING',
                approvalMode: 'manual',
              },
            })
          }
        }

        // System message summarizing the parts added during completion.
        await tx.workOrderMessage.create({
          data: {
            workOrderId: wo.id,
            message: shouldAutoApproveParts
              ? `เบิกอะไหล่ ${validatedParts.length} รายการ (อนุมัติอัตโนมัติพร้อมปิดงาน)`
              : `เพิ่มคำขอเบิกอะไหล่ ${validatedParts.length} รายการ (รออนุมัติ) — เปลี่ยนสถานะใบงานเป็น "รออะไหล่"`,
            author: actorName,
            authorRole: 'system',
          },
        })
      })

      try {
        await db.auditLog.create({
          data: {
            action: 'WO_PARTS_REQUEST',
            entity: 'WorkOrder',
            entityId: wo.id,
            summary: `เบิกอะไหล่ใบงาน ${wo.woNumber ?? wo.id} — ${validatedParts.length} รายการ${
              shouldAutoApproveParts ? ' (อนุมัติอัตโนมัติ)' : ''
            }`,
            detail: JSON.stringify({
              woNumber: wo.woNumber,
              count: validatedParts.length,
              autoApprove: shouldAutoApproveParts,
              items: validatedParts.map((v) => ({
                productCode: v.item.productCode,
                quantity: v.quantity,
              })),
            }),
            actor: actorName,
            siteCode: result.woSite,
          },
        })
      } catch (e) {
        console.error('audit log failed (parts on complete)', e)
      }

      // When autoApproveParts=false: do NOT complete the WO. Move it to
      // WAITING_PARTS so the existing pending-parts guard below would
      // also block any race-condition completions, and return early with
      // a friendly "moved to WAITING_PARTS" message.
      if (!shouldAutoApproveParts) {
        if (wo.status !== 'WAITING_PARTS') {
          await db.workOrder.update({
            where: { id: wo.id },
            data: { status: 'WAITING_PARTS' },
          })
        }
        return NextResponse.json({
          data: {
            id: wo.id,
            woNumber: wo.woNumber,
            status: 'WAITING_PARTS',
          },
          partsCreated: validatedParts.length,
          autoApproved: false,
          message:
            'เพิ่มคำขอเบิกอะไหล่แล้ว — ใบงานเปลี่ยนสถานะเป็น "รออะไหล่" รอการอนุมัติก่อนปิดงาน',
        })
      }
    }

    // ── PART 2: Check for pending parts requests ──
    // Block completion if there are PENDING parts requests linked to this WO.
    // Legacy imports may retain only a raw job reference, so match all stable
    // identifiers while keeping the direct WorkOrder relation authoritative.
    //
    // WO-PARTS-FLOW P0: only PENDING txns with quantity > 0 block completion.
    // open-bottle usages (qty=0) don't need stock-out approval — they're
    // recorded-usage-only and shouldn't prevent closing the WO. Awaiting
    // qty=0 + usageQuantity>0 rows are auto-skipped.
    const jobReferences = getRepairJobReferences(wo)
    const pendingPartsWhere = {
      AND: [
        { approvalStatus: 'PENDING' },
        { quantity: { gt: 0 } },  // Skip qty=0 (open-bottle, no approval needed)
        {
          OR: [
            { workOrderId: wo.id },
            ...(jobReferences.length > 0
              ? [{ workOrderNo: { in: jobReferences } }]
              : []),
          ],
        },
      ],
    }
    const pendingPartsCount = await db.stockTransaction.count({
      where: pendingPartsWhere,
    })
    if (pendingPartsCount > 0) {
      return NextResponse.json(
        {
          error:
            'ยังปิดงานไม่ได้ เนื่องจากมีรายการเบิกอะไหล่ที่ยังรออนุมัติ',
          pendingPartsCount,
        },
        { status: 400 },
      )
    }

    // Use the authenticated user's email as the actor — never trust
    // a body-supplied `actor` field, which could be spoofed.
    const now = new Date()

    const resolutionTrim = normalizedResolution ?? ''
    const resolutionGroupTrim = normalizedResolutionGroup ?? ''

    const updated = await db.workOrder.update({
      where: { id: wo.id },
      data: {
        status: 'COMPLETED',
        workCompletedAt: now,
        closedAt: now,
        picAfter: normalizedPicAfter ?? wo.picAfter,
        picOnsite: normalizedPicOnsite ?? wo.picOnsite,
        resolution: resolutionTrim || null,
        resolutionGroup: resolutionTrim ? (resolutionGroupTrim || null) : null,
        detailsAdmin: normalizedNote
          ? (wo.detailsAdmin ? wo.detailsAdmin + '\n' : '') + normalizedNote
          : wo.detailsAdmin,
      },
    })

    const completionMsg = resolutionTrim
      ? `ปิดงานเรียบร้อย — ผลการแก้ไข: ${resolutionTrim}${normalizedNote ? ` (${normalizedNote})` : ''}`
      : `ปิดงานเรียบร้อย${normalizedNote ? ` — ${normalizedNote}` : ''}`

    await db.workOrderMessage.create({
      data: {
        workOrderId: wo.id,
        message: completionMsg,
        author: actorName,
        authorRole: 'admin',
      },
    })

    await logAudit(
      'WO_COMPLETE',
      wo.id,
      `ปิดงาน ${updated.woNumber ?? wo.id}`,
      {
        note: normalizedNote,
        resolution: resolutionTrim || null,
        resolutionGroup: resolutionGroupTrim || null,
      },
      actorName,
      result.woSite,
    )

    // ── Notification trigger (Task ID: NOTIFY-LINE) ──
    // Send 'wo_completed' to the reporter (LINE if lineUserId is known,
    // otherwise fall back to admin channels).
    try {
      await notifyWorkOrderCompleted(
        {
          id: updated.id,
          woNumber: updated.woNumber,
          subject: updated.subject,
          resolution: updated.resolution,
          detailsAdmin: updated.detailsAdmin,
          lineUserId: updated.lineUserId,
          reporterEmail: updated.reporterEmail,
        },
        { channels: ['line-oa', 'telegram'], actor: actorName },
      )
    } catch (e) {
      console.error('[notifications] wo_completed trigger failed:', e)
    }

    return NextResponse.json({
      data: updated,
      partsCreated: validatedParts.length,
      autoApproved: shouldAutoApproveParts && validatedParts.length > 0,
    })
  } catch (err) {
    console.error('POST /api/work-orders/[id]/complete', err)
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to complete work order') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
