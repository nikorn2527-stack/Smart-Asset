import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'

/**
 * POST /api/legacy-import/apply
 *
 * Apply a previously-previewed legacy import.
 * Only processes items with action = 'create' or 'update' (NOT skip, conflict, or unresolved).
 *
 * Body:
 *   { source: string
 *     entityType: 'Device' | 'WorkOrder' | 'MeterReading' | 'StockItem' | 'MasterItem'
 *     items: Array<{ row: Record<string, any>, action: 'create' | 'update', existingId?: string }>
 *     options?: { createLegacyReference?: boolean }
 *   }
 *
 * For each applied item:
 *   - Creates/updates the record with organizationId from auth context
 *   - Creates a LegacyReference entry (if createLegacyReference = true)
 *   - Audit logs the apply
 *
 * Returns:
 *   { applied: number, created: number, updated: number, errors: number, legacyReferences: number }
 */
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { requireAuth } = await import('@/lib/auth-middleware')
  const { db } = await import('@/lib/db')
  const { getOrgScope } = await import('@/lib/org-scope')
  const { logAudit } = await import('@/lib/audit')

  const auth = await requireAuth(req, 'IMPORT_DATA')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const orgScope = getOrgScope(auth.user)
  if (!orgScope.ok) {
    return NextResponse.json({ error: orgScope.error.message }, { status: orgScope.error.status })
  }

  const body = await req.json().catch(() => ({} as any))
  const { source, entityType, items, options } = body || {}

  if (!entityType || !Array.isArray(items)) {
    return NextResponse.json(
      { error: 'ต้องระบุ entityType และ items (array)' },
      { status: 400 },
    )
  }

  const validEntities = ['Device', 'WorkOrder', 'MeterReading', 'StockItem', 'MasterItem']
  if (!validEntities.includes(entityType)) {
    return NextResponse.json(
      { error: `entityType ต้องเป็นหนึ่งใน: ${validEntities.join(', ')}` },
      { status: 400 },
    )
  }

  // Only apply create + update items (reject skip, conflict, unresolved)
  const applyableItems = items.filter((item: any) => item.action === 'create' || item.action === 'update')

  if (applyableItems.length === 0) {
    return NextResponse.json({
      applied: 0,
      created: 0,
      updated: 0,
      errors: 0,
      message: 'ไม่มีรายการที่จะ apply (ทั้งหมดเป็น skip, conflict, หรือ unresolved)',
    })
  }

  // Limit batch size
  const MAX_BATCH = 500
  const batch = applyableItems.slice(0, MAX_BATCH)

  let created = 0, updated = 0, errors = 0, legacyRefs = 0

  for (const item of batch) {
    const row = item.row || item.data
    try {
      // Determine code field for this entity
      let codeField: string | null = null
      let codeValue: string | null = null

      switch (entityType) {
        case 'Device':
          codeField = 'assetCode'
          codeValue = row.assetCode || row.asset_no || null
          break
        case 'WorkOrder':
          codeField = 'woNumber'
          codeValue = row.woNumber || row.wo_number || row.id || null
          break
        case 'StockItem':
          codeField = 'productCode'
          codeValue = row.productCode || row.product_code || null
          break
        case 'MasterItem':
          codeField = 'code'
          codeValue = row.code || row.ItemID || null
          break
      }

      // ── H-01 fix: Field Allowlist — ตัด fields ที่ไม่ควรให้ Client ควบคุม ──
      const FORBIDDEN_FIELDS = new Set([
        'id', 'organizationId', 'createdAt', 'updatedAt', 'isDemo',
        'passwordHash', 'passwordSalt', 'totpSecret', 'googleSub', 'appleSub',
        'legacyAssetCode', 'legacySourceApp', 'legacySourceKey',
        'legacyProductCode',
      ])
      const safeRow: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(row)) {
        if (!FORBIDDEN_FIELDS.has(key)) {
          safeRow[key] = value
        }
      }

      // Add organizationId from auth context (NOT from client)
      const enrichedRow: any = { ...safeRow }
      enrichedRow.organizationId = orgScope.organizationId

      // Set legacy source fields
      if (entityType === 'Device') {
        enrichedRow.legacySourceApp = source || 'csv'
        if (codeValue && !enrichedRow.legacyAssetCode) {
          enrichedRow.legacyAssetCode = codeValue
        }
      } else if (entityType === 'StockItem') {
        enrichedRow.legacySourceApp = source || 'csv'
        if (codeValue && !enrichedRow.legacyProductCode) {
          enrichedRow.legacyProductCode = codeValue
        }
      } else if (entityType === 'WorkOrder') {
        enrichedRow.legacySourceApp = source || 'csv'
      }

      // Create or update
      if (item.action === 'update' && item.existingId) {
        // ── H-01 fix: ตรวจ existingId + organizationId ก่อน Update ──
        // ป้องกัน cross-org update (ผู้ใช้ส่ง ID ขององค์กรอื่น)
        const existingRecord = await (db as any)[entityType.charAt(0).toLowerCase() + entityType.slice(1)].findFirst({
          where: {
            id: item.existingId,
            ...orgScope.where, // กรองด้วย organizationId ด้วย
          },
        })
        if (!existingRecord) {
          errors++
          if (errors <= 3) console.error(`  ✗ Record ${item.existingId} not found in org ${orgScope.organizationId}`)
          continue // Skip — don't update cross-org
        }
        // Update existing (scoped)
        await (db as any)[entityType.charAt(0).toLowerCase() + entityType.slice(1)].update({
          where: { id: item.existingId },
          data: enrichedRow,
        })
        updated++
      } else {
        // Create new
        const newRecord = await (db as any)[entityType.charAt(0).toLowerCase() + entityType.slice(1)].create({
          data: enrichedRow,
        })

        // Create LegacyReference if enabled
        if (options?.createLegacyReference !== false && codeValue) {
          try {
            await db.legacyReference.create({
              data: {
                organizationId: orgScope.organizationId,
                sourceApp: source || 'csv',
                sourceEntity: entityType,
                legacyCode: codeValue,
                legacyLabel: row.name || row.label || row.subject || null,
                targetEntity: entityType,
                targetId: newRecord.id,
                targetCode: codeValue,
                mappingStatus: 'ACTIVE',
              },
            })
            legacyRefs++
          } catch {
            // Duplicate LegacyReference — skip
          }
        }
        created++
      }
    } catch (e: any) {
      errors++
      if (errors <= 3) console.error(`  ✗ row ${item.rowIndex || '?'}: ${e.message?.slice(0, 100)}`)
    }
  }

  // Audit the apply
  await logAudit(
    'LEGACY_IMPORT_APPLY',
    entityType,
    null,
    `Applied legacy import: ${source || 'unknown'} → ${entityType} (created: ${created}, updated: ${updated}, errors: ${errors}, legacyRefs: ${legacyRefs})`,
    {
      source,
      entityType,
      created,
      updated,
      errors,
      legacyRefs,
      organizationId: orgScope.organizationId,
    },
    auth.row.username ?? auth.user.email,
  )

  return NextResponse.json({
    applied: created + updated,
    created,
    updated,
    errors,
    legacyReferences: legacyRefs,
    truncated: applyableItems.length > MAX_BATCH,
    totalApplyable: applyableItems.length,
    appliedCount: batch.length,
  })
}
