import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db, getBaseClient } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { notifyPartsRequested } from '@/lib/notifications'
import { loadAuthorizedWorkOrder } from '@/lib/wo-authz'
import { resolveRepairRequester } from '@/lib/repair-identity'
import { calculateCost, normalizeCostModel } from '@/lib/cost-model'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import type { Prisma } from '@prisma/client'

/** Parse an Int; returns 0 when missing/invalid. */
function optInt(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.round(n)
}

/** Parse a Decimal/fractional quantity (for usageQuantity). Returns null when missing. */
function optDecimal(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < 0) return null
  // Round to 3 decimal places (Decimal(10,3) precision).
  return Math.round(n * 1000) / 1000
}

/** Validate that usageSource is one of the allowed values. */
function normalizeUsageSource(v: unknown): 'new-bottle' | 'open-bottle' | 'new-and-open' | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  if (s === 'new-bottle' || s === 'open-bottle' || s === 'new-and-open') return s
  return null
}

/**
 * GET /api/work-orders/[id]/parts
 * List all stock transactions linked to this work order
 * (where workOrderNo = woNumber).
 *
 * Auth: requires WO_VIEW_ALL (allowOwn so reporters can see their WO's parts).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'WO_VIEW_ALL')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const { id } = await params

    const result = await loadAuthorizedWorkOrder(req, id, 'WO_VIEW_ALL', {
      allowOwn: true,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { wo } = result

    // Find transactions linked by the canonical id, system number, or legacy number.
    // Legacy imports may retain the old job number in StockTransaction.workOrderNo.
    const workOrderNumbers = [wo.woNumber, wo.systemJobNo, wo.legacyJobNo]
      .filter((value): value is string => Boolean(value && value.trim()))
      .filter((value, index, values) => values.indexOf(value) === index)
    const where = {
      OR: [
        { workOrderId: wo.id },
        ...workOrderNumbers.map((workOrderNo) => ({ workOrderNo })),
      ],
    }

    const txns = await db.stockTransaction.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      include: {
        stockItem: {
          select: {
            productCode: true,
            productName: true,
            unit: true,
            quantity: true,
            active: true,
          },
        },
      },
    })

    // Summary by approval status (for "all approved?" check)
    const summary = {
      total: txns.length,
      pending: txns.filter((t) => t.approvalStatus === 'PENDING').length,
      approved: txns.filter((t) => t.approvalStatus === 'APPROVED').length,
      rejected: txns.filter((t) => t.approvalStatus === 'REJECTED').length,
      immediate: txns.filter((t) => t.approvalStatus === null).length,
    }

    return NextResponse.json({ data: txns, summary })
  } catch (err) {
    console.error('GET /api/work-orders/[id]/parts', err)
    return NextResponse.json(
      { error: 'Failed to fetch parts' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/work-orders/[id]/parts
 * Request parts for this work order.
 * Body: { items: [{ productCode, quantity, remark? }], requester? }
 *
 * For each item: create a StockTransaction with type='OUT',
 * approvalStatus='PENDING', workOrderNo=woNumber.
 * If WorkOrder status is not IN_PROGRESS or WAITING_PARTS, set it to WAITING_PARTS.
 *
 * Auth: requires WO_ASSIGN at the WO's Site (technician/manager role).
 *
 * Returns: { created: N, workOrderStatus: 'WAITING_PARTS' | '<current>', transactions: [...] }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('work-orders')
  if (unavailable) return unavailable


  // Auth: loadAuthorizedWorkOrder does the site-scoped WO_ASSIGN check.
  // Basic auth here — wo-authz layer enforces the correct permission.
  const auth = await requireAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const { id } = await params

    // Authenticate + authorize — requesting parts requires WO_ASSIGN
    const result = await loadAuthorizedWorkOrder(req, id, 'WO_ASSIGN')
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { wo, auth } = result

    const body = await req.json()
    const items = Array.isArray(body.items) ? body.items : []
    if (items.length === 0) {
      return NextResponse.json(
        { error: 'ต้องเพิ่มอย่างน้อย 1 รายการอะไหล่' },
        { status: 400 },
      )
    }

    // ── Idempotency check (WO-PARTS-FLOW P1) ──────────────────────────
    // If clientMutationId is provided, look up any existing txn with the same
    // key linked to this WO. If found, return the existing txns instead of
    // creating duplicates (prevents retry storms when network is flaky).
    const clientMutationId =
      typeof body.clientMutationId === 'string' && body.clientMutationId.trim()
        ? body.clientMutationId.trim()
        : null
    if (clientMutationId) {
      const existing = await db.stockTransaction.findMany({
        where: { clientMutationId, workOrderId: wo.id },
        orderBy: { createdAt: 'desc' },
      })
      if (existing.length > 0) {
        // Replay — return the original txns, no new writes.
        return NextResponse.json(
          {
            data: {
              created: existing.length,
              workOrderStatus: wo.status,
              transactions: existing,
              idempotent: true,
            },
          },
          { status: 200 },
        )
      }
    }

    // Actor and requester identity come from the authenticated session.
    // Do not trust body.requester: a caller must not submit stock on behalf
    // of another user through a client-controlled field.
    const actorName = auth.user.email
    const requester = resolveRepairRequester(auth.user)

    // Validate all items first (fail fast)
    const validated: Array<{
      item: {
        id: string
        productCode: string
        productName: string
        unit: string
        unitCost: number | null
        quantity: number
        costModel?: string | null
        // Real column types (StockItem.ratePerPage is Prisma.Decimal), NOT
        // `unknown` — calculateCost() needs the Decimal|number|null union and
        // `unknown` erased the rate entirely at the call site.
        ratePerPage?: Prisma.Decimal | number | null
        ratePerHour?: Prisma.Decimal | number | null
        ratePerMonth?: Prisma.Decimal | number | null
        ratePerDevice?: Prisma.Decimal | number | null
      }
      quantity: number
      usageQuantity: number | null
      usageUnit: string | null
      usageSource: 'new-bottle' | 'open-bottle' | 'new-and-open' | null
      usageHours: number | null
      usagePages: number | null
      usageDevices: number | null
      remark: string | null
    }> = []
    for (const raw of items) {
      const productCode = String(raw?.productCode ?? '').trim()
      const qty = optInt(raw?.quantity, 0)
      const usageQty = optDecimal(raw?.usageQuantity)
      const usageHours = optDecimal(raw?.usageHours)
      const usagePages = optInt(raw?.usagePages, 0)
      const usageDevices = optInt(raw?.usageDevices, 0)
      const usageUnit =
        typeof raw?.usageUnit === 'string' && raw.usageUnit.trim()
          ? raw.usageUnit.trim()
          : null
      const usageSource = normalizeUsageSource(raw?.usageSource)
      const remark =
        raw?.remark && typeof raw.remark === 'string'
          ? raw.remark.trim()
          : null
      if (!productCode) {
        return NextResponse.json(
          { error: 'กรุณาระบุรหัสสินค้า (productCode) สำหรับทุกรายการ' },
          { status: 400 },
        )
      }
      // WO-PARTS-FLOW P0: allow qty=0 when usageQuantity>0 (used from open bottle,
      // no stock-out). Otherwise qty must be > 0 (regular stock-out).
      // If usageQuantity is null and qty>0, default usageQuantity = qty (1:1).
      // If usageSource is 'open-bottle', qty MUST be 0 (force no stock decrement).
      let effectiveQty = qty
      let effectiveUsage = usageQty
      let effectiveSource = usageSource

      if (effectiveSource === 'open-bottle') {
        // Force qty=0 — using from already-opened bottle, no stock decrement.
        effectiveQty = 0
        if (effectiveUsage === null) {
          return NextResponse.json(
            {
              error: `เมื่อ usageSource='open-bottle' ต้องระบุ usageQuantity สำหรับ ${productCode} (จำนวนที่ใช้จริงจากขวดเปิดแล้ว)`,
            },
            { status: 400 },
          )
        }
      } else {
        // 'new-bottle' (default) or 'new-and-open' → qty must be > 0.
        if (effectiveQty <= 0) {
          return NextResponse.json(
            { error: `จำนวนตัดสต็อกสำหรับ ${productCode} ต้องมากกว่า 0 (หรือใช้ usageSource='open-bottle' ถ้าใช้จากขวดเปิดแล้ว)` },
            { status: 400 },
          )
        }
        // Default usageQuantity = qty (1:1 backward compat).
        if (effectiveUsage === null) effectiveUsage = effectiveQty
        if (effectiveSource === null) effectiveSource = 'new-bottle'
      }
      if (effectiveUsage !== null && effectiveUsage <= 0) {
        return NextResponse.json(
          { error: `usageQuantity สำหรับ ${productCode} ต้องมากกว่า 0` },
          { status: 400 },
        )
      }
      const item = await db.stockItem.findUnique({
        where: { productCode },
      })
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
      validated.push({
        item: {
          id: item.id,
          productCode: item.productCode,
          productName: item.productName,
          unit: item.unit,
          unitCost: item.unitCost !== null ? Number(item.unitCost) : null,
          quantity: item.quantity,
          costModel: item.costModel,
          ratePerPage: item.ratePerPage,
          ratePerHour: item.ratePerHour,
          ratePerMonth: item.ratePerMonth,
          ratePerDevice: item.ratePerDevice,
        },
        quantity: effectiveQty,
        usageQuantity: effectiveUsage,
        usageUnit,
        usageSource: effectiveSource,
        usageHours,
        usagePages: usagePages > 0 ? usagePages : null,
        usageDevices: usageDevices > 0 ? usageDevices : null,
        remark,
      })
    }

    const txnDate = new Date().toISOString().slice(0, 10)
    // WO-PARTS-FLOW P0: only flip to WAITING_PARTS if at least one item needs
    // stock-out (qty > 0). open-bottle usages (qty=0) don't need approval,
    // so the WO should remain in its current status (e.g. IN_PROGRESS).
    const needsApproval = validated.some((v) => v.quantity > 0)
    const newStatus =
      !needsApproval
        ? wo.status  // open-bottle only → no status flip
        : wo.status === 'IN_PROGRESS' || wo.status === 'WAITING_PARTS'
          ? wo.status
          : 'WAITING_PARTS'

    // Create all pending transactions in a single transaction.
    // Also update the WO status if needed.
    const created = await getBaseClient().$transaction(async (tx) => {
      const txns: Array<Awaited<ReturnType<typeof db.stockTransaction.create>>> = []
      for (const v of validated) {
        const txnNumber = await (async () => {
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
          return `${prefix}${String(max + 1).padStart(3, '0')}`
        })()

        // Compute cost using the item's cost model (fixed/per-page/per-hour/monthly/per-device).
        // Falls back to unitCost × usageQuantity for backward compat (no costModel set).
        const costValue = calculateCost(v.item, {
          quantity: v.quantity,
          usageQuantity: v.usageQuantity,
          usageHours: v.usageHours,
          usagePages: v.usagePages,
          usageDevices: v.usageDevices,
        })

        const t = await tx.stockTransaction.create({
          data: {
            txnNumber,
            stockItemId: v.item.id,
            productCode: v.item.productCode,
            productName: v.item.productName,
            type: 'OUT',
            quantity: v.quantity,
            unit: v.item.unit,
            // balanceAfter stays at current quantity (NOT reduced until approved)
            balanceAfter: v.item.quantity,
            reason: `เบิกอะไหล่ใบงาน ${wo.woNumber ?? ''}`,
            requester,
            purpose: wo.subject,
            workOrderId: wo.id,
            workOrderNo: wo.woNumber,
            unitCost: v.item.unitCost !== null ? v.item.unitCost : null,
            // WO-PARTS-FLOW Level 2+: usage stats + cost model + idempotency
            usageQuantity: v.usageQuantity,
            usageUnit: v.usageUnit,
            usageSource: v.usageSource,
            usageHours: v.usageHours,
            usagePages: v.usagePages,
            usageDevices: v.usageDevices,
            clientMutationId,
            cost: costValue,
            txnDate,
            remark: v.remark,
            approvalStatus: 'PENDING',
            approvalMode: 'manual',
          },
        })
        txns.push(t)
      }

      // Update WO status if needed
      if (newStatus !== wo.status) {
        await tx.workOrder.update({
          where: { id: wo.id },
          data: { status: newStatus },
        })

        await tx.workOrderMessage.create({
          data: {
            workOrderId: wo.id,
            message: `เปลี่ยนสถานะเป็น "รออะไหล่" — มีคำขอเบิกอะไหล่ ${txns.length} รายการ`,
            author: actorName,
            authorRole: 'system',
          },
        })
      } else {
        await tx.workOrderMessage.create({
          data: {
            workOrderId: wo.id,
            message: `เพิ่มคำขอเบิกอะไหล่ ${txns.length} รายการ (รออนุมัติ)`,
            author: actorName,
            authorRole: 'system',
          },
        })
      }

      return txns
    })

    await logAudit(
      'WO_PARTS_REQUEST',
      'WorkOrder',
      wo.id,
      `เบิกอะไหล่ใบงาน ${wo.woNumber ?? wo.id} — ${created.length} รายการ`,
      {
        woNumber: wo.woNumber,
        count: created.length,
        items: created.map((t) => ({
          productCode: t.productCode,
          quantity: t.quantity,
          txnNumber: t.txnNumber,
        })),
        newStatus,
      },
      actorName,
      result.woSite,
    )

    // ── Notification trigger (Task ID: NOTIFY-LINE) ──
    // Send 'parts_requested' to the stock admin (LINE admin group + Telegram).
    // Send one notification per requested item, so the admin sees each part.
    try {
      for (const t of created) {
        await notifyPartsRequested(
          {
            id: wo.id,
            woNumber: wo.woNumber,
          },
          {
            productName: t.productName ?? '',
            quantity: t.quantity,
          },
          { channels: ['line-oa', 'telegram'], actor: actorName },
        )
      }
    } catch (e) {
      console.error('[notifications] parts_requested trigger failed:', e)
    }

    return NextResponse.json(
      {
        data: {
          created: created.length,
          workOrderStatus: newStatus,
          transactions: created,
        },
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('POST /api/work-orders/[id]/parts', err)
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to request parts') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
