import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'

/**
 * POST /api/legacy-import/preview
 *
 * Preview a legacy import without writing any data.
 * Returns a list of items with their proposed action:
 *   - create: new item (no existing match)
 *   - update: existing item with changes
 *   - skip: existing item, no changes
 *   - conflict: code collision or FK unresolved
 *   - unresolved: parent entity (Site, Brand, etc.) not found
 *
 * Body:
 *   { source: 'itam' | 'services' | 'stock' | 'csv'
 *     entityType: 'Device' | 'WorkOrder' | 'MeterReading' | 'StockItem' | 'MasterItem'
 *     rows: Array<Record<string, string>>  // raw rows from CSV/Sheet
 *     options?: { upsert?: boolean, skipDuplicates?: boolean }
 *   }
 *
 * Returns:
 *   { preview: Array<{ row, action, existingId?, reason? }>, summary: { create, update, skip, conflict, unresolved } }
 *
 * IMPORTANT: This endpoint NEVER writes to the database.
 * It only reads to check for existing records and returns a preview.
 */
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { requireAuth } = await import('@/lib/auth-middleware')
  const { db } = await import('@/lib/db')
  const { getOrgScope } = await import('@/lib/org-scope')

  const auth = await requireAuth(req, 'IMPORT_DATA')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const orgScope = getOrgScope(auth.user)
  if (!orgScope.ok) {
    return NextResponse.json({ error: orgScope.error.message }, { status: orgScope.error.status })
  }

  const body = await req.json().catch(() => ({} as any))
  const { source, entityType, rows, options } = body || {}

  if (!entityType || !Array.isArray(rows)) {
    return NextResponse.json(
      { error: 'ต้องระบุ entityType และ rows (array)' },
      { status: 400 },
    )
  }

  // Valid entity types for import
  const validEntities = ['Device', 'WorkOrder', 'MeterReading', 'StockItem', 'MasterItem']
  if (!validEntities.includes(entityType)) {
    return NextResponse.json(
      { error: `entityType ต้องเป็นหนึ่งใน: ${validEntities.join(', ')}` },
      { status: 400 },
    )
  }

  // Limit preview size
  const MAX_PREVIEW_ROWS = 5000
  const previewRows = rows.slice(0, MAX_PREVIEW_ROWS)

  const preview: Array<{
    rowIndex: number
    action: 'create' | 'update' | 'skip' | 'conflict' | 'unresolved'
    existingId?: string
    existingCode?: string
    proposedCode?: string
    reason?: string
    data: Record<string, unknown>
  }> = []

  const summary = {
    create: 0,
    update: 0,
    skip: 0,
    conflict: 0,
    unresolved: 0,
    total: previewRows.length,
  }

  for (let i = 0; i < previewRows.length; i++) {
    const row = previewRows[i]
    const entry: any = {
      rowIndex: i + 1, // 1-indexed for display
      action: 'create',
      data: row,
    }

    try {
      // Determine the "code" field for this entity type
      let codeField: string | null = null
      let codeValue: string | null = null

      switch (entityType) {
        case 'Device':
          codeField = 'assetCode'
          codeValue = row.assetCode || row.asset_no || row.assetCode || null
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
          codeValue = row.code || row.ItemID || row.itemId || null
          break
        case 'MeterReading':
          codeField = 'id'
          codeValue = row.reading_id || row.id || null
          break
      }

      // Check if existing record matches (by code, scoped to org)
      if (codeValue && codeField) {
        const existing = await (db as any)[entityType.charAt(0).toLowerCase() + entityType.slice(1)].findFirst({
          where: {
            [codeField]: codeValue,
            ...orgScope.where,
          },
        })

        if (existing) {
          // Compare to see if there are changes
          const hasChanges = Object.keys(row).some(k => {
            const newVal = row[k]
            const oldVal = (existing as any)[k]
            return newVal !== oldVal && newVal != null && newVal !== ''
          })

          if (hasChanges) {
            entry.action = 'update'
            entry.existingId = existing.id
            entry.existingCode = codeValue
            summary.update++
          } else {
            entry.action = 'skip'
            entry.existingId = existing.id
            entry.existingCode = codeValue
            summary.skip++
          }
        } else {
          // Check for conflicts — code exists but in different org
          const conflictCheck = codeField === 'assetCode' || codeField === 'productCode' || codeField === 'woNumber'
          if (conflictCheck) {
            const conflict = await (db as any)[entityType.charAt(0).toLowerCase() + entityType.slice(1)].findFirst({
              where: { [codeField]: codeValue },
            })
            if (conflict && conflict.organizationId !== orgScope.organizationId) {
              entry.action = 'conflict'
              entry.reason = `Code "${codeValue}" มีอยู่แล้วในองค์กรอื่น`
              entry.existingCode = codeValue
              summary.conflict++
              preview.push(entry)
              continue
            }
          }
          entry.action = 'create'
          entry.proposedCode = codeValue
          summary.create++
        }
      } else {
        // No code field — can't match, treat as create
        entry.action = 'create'
        summary.create++
      }
    } catch (e: any) {
      entry.action = 'unresolved'
      entry.reason = e.message?.slice(0, 100) || 'Unknown error'
      summary.unresolved++
    }

    preview.push(entry)
  }

  // Audit the preview (read-only, no data change)
  const { logAudit } = await import('@/lib/audit')
  await logAudit(
    'LEGACY_IMPORT_PREVIEW',
    entityType,
    null,
    `Preview legacy import: ${source || 'unknown'} → ${entityType} (${summary.total} rows, ${summary.create} create, ${summary.update} update, ${summary.skip} skip, ${summary.conflict} conflict, ${summary.unresolved} unresolved)`,
    { source, entityType, summary, organizationId: orgScope.organizationId },
    auth.row.username ?? auth.user.email,
  )

  return NextResponse.json({
    preview,
    summary,
    truncated: rows.length > MAX_PREVIEW_ROWS,
    totalRows: rows.length,
    previewedRows: previewRows.length,
  })
}
