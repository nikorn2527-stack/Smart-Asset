import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { previewNextNumber, type NumberingSchemeRow } from '@/lib/numbering-engine'

/**
 * POST /api/numbering/preview — พรีวิวเลขถัดไปโดยไม่กินเลข
 * body: { docType?: string, schemeId?: string, context?: { type, site, purchaseDate, departmentCode, categoryCode } }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, 'SYSTEM_CONFIG')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const body = await req.json().catch(() => ({}))
    const docType = body.docType ?? 'device'
    const ctx = body.context ?? {}
    const schemeId = body.schemeId as string | undefined

    let schemeOverride: NumberingSchemeRow | undefined
    if (schemeId) {
      const row = await db.numberingScheme.findUnique({ where: { id: schemeId } })
      if (row) {
        schemeOverride = {
          id: row.id,
          docType: row.docType,
          name: row.name,
          pattern: row.pattern,
          prefix: row.prefix,
          description: row.description,
          resetPolicy: row.resetPolicy,
          isActive: row.isActive,
        }
      }
    }

    const preview = await previewNextNumber(docType, ctx, schemeOverride)
    return NextResponse.json({ preview })
  } catch (err) {
    console.error('POST /api/numbering/preview', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
