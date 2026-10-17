/**
 * POST /api/settings/asset-categories/import
 *
 * SPRINT-4 #7 (IMPORT-SPEC-009): bulk import asset categories from a
 * JSON array. Supports upsert (by code) so re-importing the same file
 * updates existing rows instead of failing.
 *
 * Body: { categories: Array<{ code, name, usefulLifeYears?, ... }> }
 * Returns: { imported, updated, errors }
 *
 * Auth: ADMIN (creating master data requires admin)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { logAudit } from '@/lib/audit'

interface ImportRow {
  code: string
  name?: string
  usefulLifeYears?: number
  depreciationMethod?: string
  decliningRate?: number
  minCapitalizeValue?: number
  salvageValuePct?: number
  active?: boolean
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await req.json()
    const rows: ImportRow[] = Array.isArray(body.categories) ? body.categories : []
    if (rows.length === 0) {
      return NextResponse.json({ error: 'กรุณาส่ง array ของ categories (อย่างน้อย 1 รายการ)' }, { status: 400 })
    }
    if (rows.length > 500) {
      return NextResponse.json({ error: 'import ได้สูงสุด 500 รายการต่อครั้ง' }, { status: 413 })
    }

    let imported = 0
    let updated = 0
    const errors: Array<{ row: number; code: string; error: string }> = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const code = String(row.code || '').trim().toUpperCase()
      if (!code) {
        errors.push({ row: i + 1, code: '', error: 'code is required' })
        continue
      }

      try {
        const data = {
          code,
          name: String(row.name || code),
          usefulLifeYears: Number(row.usefulLifeYears) || 5,
          depreciationMethod: String(row.depreciationMethod || 'STRAIGHT_LINE'),
          decliningRate: row.decliningRate ? Number(row.decliningRate) : null,
          minCapitalizeValue: row.minCapitalizeValue ? Number(row.minCapitalizeValue) : 10000,
          salvageValuePct: row.salvageValuePct ? Number(row.salvageValuePct) : 0,
          active: row.active !== false,
        }

        const existing = await db.assetCategory.findUnique({ where: { code } })
        if (existing) {
          await db.assetCategory.update({ where: { code }, data })
          updated++
        } else {
          await db.assetCategory.create({ data })
          imported++
        }
      } catch (err) {
        errors.push({
          row: i + 1,
          code,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    await logAudit(
      'BULK_IMPORT',
      'AssetCategory',
      null,
      `Bulk import หมวดหมู่สินทรัพย์: ${imported} ใหม่, ${updated} อัปเดต, ${errors.length} error`,
      { imported, updated, errorCount: errors.length },
      auth.row.email,
    )

    return NextResponse.json({ imported, updated, errors })
  } catch (err) {
    console.error('POST /api/settings/asset-categories/import', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Import failed') : 'Internal server error' },
      { status: 500 },
    )
  }
}
