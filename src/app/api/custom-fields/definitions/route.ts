import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireAuth } from '@/lib/auth-middleware'

/**
 * GET /api/custom-fields/definitions?targetEntity=Device&includeOptions=true
 *   List CustomFieldDefinitions for the caller's organization + targetEntity.
 *   organizationId comes from auth context — NEVER from query param.
 *
 * POST /api/custom-fields/definitions
 *   Create a new CustomFieldDefinition. org-scoped.
 *   Body: { key, label, targetEntity, fieldType, required?, validationJson?, options?[] }
 */

export async function GET(req: NextRequest) {
  const { requireAuth } = await import('@/lib/auth-middleware')
  const auth = await requireAuth(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const url = new URL(req.url)
  const targetEntity = url.searchParams.get('targetEntity')
  const includeOptions = url.searchParams.get('includeOptions') === 'true'

  // Organization scope from auth context
  const orgId = auth.user.organizationId
  if (!orgId) {
    return NextResponse.json({ error: 'ผู้ใช้ไม่มี organization scope' }, { status: 400 })
  }

  const where: any = {
    organizationId: orgId,
    active: true,
  }
  if (targetEntity) where.targetEntity = targetEntity

  const definitions = await db.customFieldDefinition.findMany({
    where,
    include: { options: includeOptions ? true : false },
    orderBy: [{ section: 'asc' }, { sortOrder: 'asc' }],
  })

  return NextResponse.json({ definitions })
}

export async function POST(req: NextRequest) {
  const { requireAuth } = await import('@/lib/auth-middleware')
  const auth = await requireAuth(req, 'MASTER_DATA_EDIT')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await req.json().catch(() => ({} as any))
  const {
    key, label, description, targetEntity, fieldType, required,
    section, placeholder, sortOrder, validationJson, visibilityJson, options,
  } = body || {}

  if (!key || !label || !targetEntity || !fieldType) {
    return NextResponse.json(
      { error: 'ต้องระบุ key, label, targetEntity, fieldType' },
      { status: 400 },
    )
  }

  const orgId = auth.user.organizationId
  if (!orgId) {
    return NextResponse.json({ error: 'ผู้ใช้ไม่มี organization scope' }, { status: 400 })
  }

  // Validate key format (snake_case or kebab-case, lowercase)
  const normalizedKey = String(key).toLowerCase().trim()
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(normalizedKey)) {
    return NextResponse.json(
      { error: 'key ต้องเป็น snake_case/kebab-case ภาษาอังกฤษตัวเล็ก ขึ้นต้นด้วยตัวอักษร' },
      { status: 400 },
    )
  }

  // Reject secret-like keys
  const SECRET_PATTERNS = /password|secret|token|private_?key|api_?key|jwt/i
  if (SECRET_PATTERNS.test(normalizedKey)) {
    return NextResponse.json(
      { error: 'ห้ามใช้ key ที่คล้าย secret (password/secret/token/key)' },
      { status: 400 },
    )
  }

  const validFieldTypes = ['text', 'textarea', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'select', 'multiselect', 'email', 'url']
  if (!validFieldTypes.includes(fieldType)) {
    return NextResponse.json(
      { error: `fieldType ต้องเป็นหนึ่งใน: ${validFieldTypes.join(', ')}` },
      { status: 400 },
    )
  }

  // Check duplicate (orgId + targetEntity + key)
  const existing = await db.customFieldDefinition.findUnique({
    where: {
      organizationId_targetEntity_key: {
        organizationId: orgId,
        targetEntity,
        key: normalizedKey,
      },
    },
  })
  if (existing) {
    return NextResponse.json(
      { error: `key "${normalizedKey}" มีอยู่แล้วสำหรับ targetEntity=${targetEntity}` },
      { status: 409 },
    )
  }

  // Validate targetEntity against allowed list
  const validEntities = ['Device', 'WorkOrder', 'StockItem', 'MasterItem']
  if (!validEntities.includes(targetEntity)) {
    return NextResponse.json(
      { error: `targetEntity ต้องเป็นหนึ่งใน: ${validEntities.join(', ')}` },
      { status: 400 },
    )
  }

  // Create definition
  const def = await db.customFieldDefinition.create({
    data: {
      organizationId: orgId,
      key: normalizedKey,
      label: String(label).trim(),
      description: description ?? null,
      targetEntity,
      fieldType,
      required: !!required,
      section: section ?? null,
      placeholder: placeholder ?? null,
      sortOrder: sortOrder ?? 0,
      // Prisma `Json?` columns cannot receive a bare `null` — that is ambiguous
      // between "SQL NULL" and "JSON literal null". Use Prisma.DbNull for the
      // SQL NULL case and keep passing the raw JSON value otherwise.
      validationJson: validationJson
        ? typeof validationJson === 'string'
          ? validationJson
          : (validationJson as object)
        : Prisma.DbNull,
      visibilityJson: visibilityJson
        ? typeof visibilityJson === 'string'
          ? visibilityJson
          : (visibilityJson as object)
        : Prisma.DbNull,
      options: options && Array.isArray(options) && options.length > 0 ? {
        create: options.map((o: any, i: number) => ({
          value: String(o.value),
          label: String(o.label ?? o.value),
          sortOrder: o.sortOrder ?? i,
          active: o.active !== false,
        })),
      } : undefined,
    },
    include: { options: true },
  })

  await logAudit(
    'CUSTOM_FIELD_CREATE',
    'CustomFieldDefinition',
    def.id,
    `สร้าง custom field "${def.key}" (${def.label}) → ${def.targetEntity}`,
    { key: def.key, fieldType: def.fieldType, targetEntity: def.targetEntity, organizationId: orgId },
    auth.row.username ?? auth.user.email,
  )

  return NextResponse.json({ definition: def }, { status: 201 })
}
