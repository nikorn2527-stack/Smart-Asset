import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'

/**
 * POST /api/master-items/merge
 *
 * รวมรายการ MasterItem ที่ซ้ำกัน (section 16: Merge รายการเดิมมี Audit)
 *
 * Body:
 *   { canonicalId: string, duplicateIds: string[], reason: string }
 *
 * Flow:
 *   1. Validate: canonicalId ไม่อยู่ใน duplicateIds
 *   2. ย้าย LegacyReference จาก duplicate → canonical
 *   3. ปิดใช้งาน duplicate (active=false, ไม่ลบ)
 *   4. Audit log การ merge พร้อม reason
 */
export async function POST(req: NextRequest) {
  const { requireAuth } = await import('@/lib/auth-middleware')
  const { db } = await import('@/lib/db')
  const { logAudit } = await import('@/lib/audit')

  const auth = await requireAuth(req, 'MASTER_DATA_EDIT')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await req.json().catch(() => ({} as any))
  const { canonicalId, duplicateIds, reason } = body || {}

  if (!canonicalId || !Array.isArray(duplicateIds) || duplicateIds.length === 0) {
    return NextResponse.json(
      { error: 'ต้องระบุ canonicalId และ duplicateIds (array)' },
      { status: 400 },
    )
  }

  if (duplicateIds.includes(canonicalId)) {
    return NextResponse.json(
      { error: 'canonicalId ต้องไม่อยู่ใน duplicateIds' },
      { status: 400 },
    )
  }

  if (!reason || reason.trim().length < 5) {
    return NextResponse.json(
      { error: 'ต้องระบุเหตุผลในการรวม (อย่างน้อย 5 ตัวอักษร)' },
      { status: 400 },
    )
  }

  // Get canonical item
  const canonical = await db.masterItem.findUnique({ where: { id: canonicalId } })
  if (!canonical) {
    return NextResponse.json({ error: 'ไม่พบรายการหลัก' }, { status: 404 })
  }

  let merged = 0
  let deactivated = 0

  // Process each duplicate
  for (const dupId of duplicateIds) {
    const duplicate = await db.masterItem.findUnique({ where: { id: dupId } })
    if (!duplicate) continue

    // 1. Move LegacyReferences from duplicate → canonical
    const refs = await db.legacyReference.updateMany({
      where: { targetId: dupId, targetEntity: 'MasterItem' },
      data: {
        targetId: canonicalId,
        targetCode: canonical.code,
        mappingStatus: 'MERGED',
        mappingNote: `Merged to ${canonical.code} (${canonical.label}). Reason: ${reason}`,
      },
    })
    merged += refs.count

        // 2. Deactivate duplicate (soft delete — don't delete).
    // NOTE: MasterItem has no `remark` column (only Active+isDemo as mutable
    // state), so the merge rationale lives in the AuditLog entry below and in
    // the LegacyReference.mappingNote written above — writing `remark` here
    // would have thrown and aborted the whole merge transaction.
    await db.masterItem.update({
      where: { id: dupId },
      data: { active: false },
    })
    deactivated++

    // 3. Audit log each merge
    await logAudit(
      'MASTER_ITEM_MERGE',
      'MasterItem',
      canonicalId,
      `รวมรายการ ${duplicate.code} (${duplicate.label}) → ${canonical.code} (${canonical.label})`,
      {
        canonicalId,
        canonicalCode: canonical.code,
        duplicateId: dupId,
        duplicateCode: duplicate.code,
        reason,
        legacyReferencesMoved: refs.count,
      },
      auth.row.username ?? auth.user.email,
    )
  }

  return NextResponse.json({
    merged,
    deactivated,
    canonicalId,
    canonicalCode: canonical.code,
  })
}
