import { NextRequest, NextResponse } from 'next/server'
import { db, getBaseClient } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireAuth } from '@/lib/auth-middleware'

/**
 * GET /api/custom-fields/values/[targetEntity]/[targetId]
 *   Get all custom field values for a target record.
 *
 * PUT /api/custom-fields/values/[targetEntity]/[targetId]
 *   Upsert values (batch): { values: [{ fieldId, value }] }
 *   Each value is validated against the Definition's fieldType + options.
 *   organizationId comes from auth context — never from client.
 */

/**
 * Next.js 15+ (and 16, which this app runs) deliver dynamic route `params` as a
 * PROMISE. Declaring them synchronously made `params.targetId` / `params.id`
 * `undefined` at runtime — the handlers below now `await params`.
 */
interface Params {
  params: Promise<{ targetEntity: string; targetId: string }>
}

export async function GET(req: NextRequest, { params }: Params) {
  const { targetEntity, targetId } = await params
  const { requireAuth } = await import('@/lib/auth-middleware')
  const auth = await requireAuth(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // ── H-01 fix: GET ต้องตรวจ Target Record Authorization ด้วย ──
  const { getOrgScope } = await import('@/lib/org-scope')
  const orgScope = getOrgScope(auth.user)
  if (!orgScope.ok) {
    return NextResponse.json({ error: orgScope.error.message }, { status: orgScope.error.status })
  }
  const orgId = orgScope.organizationId

  // ตรวจ target record exists + org scope (เดียวกับ PUT)
  const ENTITY_MODEL_MAP_GET: Record<string, string> = {
    Device: 'device', WorkOrder: 'workOrder', StockItem: 'stockItem', MasterItem: 'masterItem',
  }
  const modelNameGet = ENTITY_MODEL_MAP_GET[targetEntity]
  if (modelNameGet) {
    const targetRecord = await (db as any)[modelNameGet].findFirst({
      where: { id: targetId, ...orgScope.where },
    })
    if (!targetRecord) {
      return NextResponse.json({ error: 'ไม่พบ target record' }, { status: 404 })
    }
  }

  const values = await db.customFieldValue.findMany({
    where: {
      organizationId: orgId,
      targetEntity,
      targetId,
    },
    include: { field: { include: { options: true } } },
  })

  return NextResponse.json({ values })
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { targetEntity, targetId } = await params
  const { requireAuth } = await import('@/lib/auth-middleware')
  const { getOrgScope } = await import('@/lib/org-scope')
  const auth = await requireAuth(req, 'DEVICE_EDIT')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // ── B-03 fix: ประกาศ orgScope ให้ถูกต้อง ──
  const orgScope = getOrgScope(auth.user)
  if (!orgScope.ok) {
    return NextResponse.json({ error: orgScope.error.message }, { status: orgScope.error.status })
  }
  const orgId = orgScope.organizationId

  const body = await req.json().catch(() => ({} as any))
  const { values } = body || {}

  if (!Array.isArray(values)) {
    return NextResponse.json({ error: 'values ต้องเป็น array' }, { status: 400 })
  }

  // ── H-03 fix: Target Record Authorization ──
  // ตรวจว่า targetId เป็น Record จริงและอยู่ใน Organization Scope
  const ENTITY_MODEL_MAP: Record<string, string> = {
    Device: 'device',
    WorkOrder: 'workOrder',
    StockItem: 'stockItem',
    MasterItem: 'masterItem',
  }
  const modelName = ENTITY_MODEL_MAP[targetEntity]
  if (!modelName) {
    return NextResponse.json({ error: 'targetEntity ไม่ถูกต้อง' }, { status: 400 })
  }

  // ตรวจ target record exists + org scope
  const targetRecord = await (db as any)[modelName].findFirst({
    where: { id: targetId, ...orgScope.where },
  })
  if (!targetRecord) {
    // ไม่เปิดเผยว่ามี record หรือไม่ — ตอบ 404 เฉยๆ
    return NextResponse.json({ error: 'ไม่พบ target record' }, { status: 404 })
  }

  const definitions = await db.customFieldDefinition.findMany({
    where: { organizationId: orgId, targetEntity: targetEntity, active: true },
    include: { options: true },
  })
  const defMap = new Map(definitions.map(d => [d.id, d]))

  // ── H-02 fix: Validate ทุกค่าก่อน แล้วค่อย Transaction ──
  // Phase 1: Validate all
  const validatedValues: Array<{ fieldId: string; valueJson: string; valueText: string | null; valueNumber: number | null; valueDate: Date | null }> = []
  const errors: string[] = []

  for (const v of values) {
    const { fieldId, value } = v
    const def = defMap.get(fieldId)
    if (!def) {
      errors.push(`fieldId ${fieldId} ไม่อยู่ใน organization หรือ targetEntity นี้`)
      continue
    }

    if (def.required && (value === null || value === undefined || value === '')) {
      errors.push(`field "${def.key}" เป็น required`)
      continue
    }

    let valueJson: string
    let valueText: string | null = null
    let valueNumber: number | null = null
    let valueDate: Date | null = null

    if (value === null || value === undefined || value === '') {
      valueJson = 'null'
    } else {
      switch (def.fieldType) {
        case 'integer': {
          const intVal = parseInt(value)
          if (isNaN(intVal)) { errors.push(`field "${def.key}" ต้องเป็น integer`); continue }
          valueJson = JSON.stringify(intVal); valueNumber = intVal; break
        }
        case 'decimal': {
          const decVal = parseFloat(value)
          if (isNaN(decVal)) { errors.push(`field "${def.key}" ต้องเป็น decimal`); continue }
          valueJson = JSON.stringify(decVal); valueNumber = decVal; break
        }
        case 'boolean': {
          const boolVal = value === true || value === 'true' || value === 1 || value === '1'
          valueJson = JSON.stringify(boolVal); break
        }
        case 'date':
        case 'datetime': {
          const dateVal = new Date(value)
          if (isNaN(dateVal.getTime())) { errors.push(`field "${def.key}" ต้องเป็น date ที่ถูกต้อง`); continue }
          valueJson = JSON.stringify(value); valueDate = dateVal; break
        }
        case 'select': {
          const opt = def.options.find(o => o.value === value)
          if (!opt) { errors.push(`field "${def.key}" value "${value}" ไม่อยู่ใน options`); continue }
          valueJson = JSON.stringify(value); valueText = String(value); break
        }
        case 'multiselect': {
          const arr = Array.isArray(value) ? value : [value]
          let valid = true
          for (const v of arr) {
            if (!def.options.find(o => o.value === v)) {
              errors.push(`field "${def.key}" value "${v}" ไม่อยู่ใน options`); valid = false; break
            }
          }
          if (!valid) continue
          valueJson = JSON.stringify(arr); valueText = arr.join(','); break
        }
        case 'email':
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            errors.push(`field "${def.key}" ต้องเป็น email ที่ถูกต้อง`); continue
          }
          valueJson = JSON.stringify(value); valueText = String(value); break
        case 'url':
          try { new URL(value) } catch { errors.push(`field "${def.key}" ต้องเป็น URL ที่ถูกต้อง`); continue }
          valueJson = JSON.stringify(value); valueText = String(value); break
        default:
          valueJson = JSON.stringify(value); valueText = String(value)
      }
    }

    // ── H-02 fix: เก็บค่าที่ validate ผ่านแล้ว ยังไม่ upsert ──
    validatedValues.push({ fieldId, valueJson, valueText, valueNumber, valueDate })
  }

  // ── H-02 fix: ถ้ามี error → ไม่เขียนอะไรเลย (Atomic) ──
  if (errors.length > 0) {
    return NextResponse.json({ error: 'Validation failed', errors }, { status: 400 })
  }

  // ── H-02 fix: ทุกค่าผ่าน validation แล้ว → ใช้ Transaction upsert ทีเดียว ──
  let upserted = 0
  await getBaseClient().$transaction(
    validatedValues.map(vv =>
      db.customFieldValue.upsert({
        where: {
          organizationId_fieldId_targetEntity_targetId: {
            organizationId: orgId,
            fieldId: vv.fieldId,
            targetEntity,
            targetId,
          },
        },
        create: {
          organizationId: orgId,
          fieldId: vv.fieldId,
          targetEntity,
          targetId,
          valueJson: vv.valueJson,
          valueText: vv.valueText,
          valueNumber: vv.valueNumber,
          valueDate: vv.valueDate,
          updatedBy: auth.row.username ?? auth.user.email,
        },
        update: {
          valueJson: vv.valueJson,
          valueText: vv.valueText,
          valueNumber: vv.valueNumber,
          valueDate: vv.valueDate,
          updatedBy: auth.row.username ?? auth.user.email,
        },
      })
    )
  )
  upserted = validatedValues.length

  await logAudit(
    'CUSTOM_FIELD_VALUE_UPDATE',
    targetEntity,
    targetId,
    `อัปเดต ${upserted} custom field values บน ${targetEntity} ${targetId}`,
    { count: upserted, organizationId: orgId },
    auth.row.username ?? auth.user.email,
  )

  return NextResponse.json({ upserted })
}
