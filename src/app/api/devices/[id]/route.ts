import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { demoTag } from '@/lib/demo-mode'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/** Clamp warrantyMonths to 1..120, default 12. */
function clampWarrantyMonths(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 12
  return Math.max(1, Math.min(120, Math.round(n)))
}

/** Parse a Float; returns null when missing/invalid. */
function optFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, n)
}

/** Parse an Int; returns null when missing/invalid. */
function optInt(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(1, Math.round(n))
}

/** Trim a string field, returning null when empty/missing. */
function optStr(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  return String(v).trim()
}

/** Parse a boolean field; returns false when missing/invalid. */
function optBool(v: unknown): boolean {
  if (v === true || v === 'true' || v === 1 || v === 'TRUE' || v === 'True') return true
  return false
}

/** Helper: write a string field only when present in body. */
function setStr(field: string, body: Record<string, unknown>) {
  if (body[field] === undefined) return undefined
  return optStr(body[field])
}

/** Helper: write a boolean field only when present in body. */
function setBool(field: string, body: Record<string, unknown>) {
  if (body[field] === undefined) return undefined
  return optBool(body[field])
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const device = await db.device.findUnique({ where: { id } })
    if (!device) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ device })
  } catch (err) {
    console.error('GET /api/devices/[id]', err)
    return NextResponse.json({ error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to fetch device') : 'Internal server error' }, { status: 500 })
  }
}

const EDITABLE_FIELDS = [
  'assetCode',
  'name',
  'brand',
  'model',
  'type',
  'serialNumber',
  'status',
  'site',
  'assetSiteCode',
  'department',
  'departmentCode',
  'parentRef',
  'displayLabel',
  'location',
  'building',
  'floor',
  'room',
  'ip',
  'mac',
  'remoteId',
  'purchaseDate',
  'warrantyMonths',
  'warrantyEnd',
  'vendor',
  'contractNo',
  'uninstallDate',
  'meterRequired',
  'meterMode',
  'costCenter',
  'deviceGroup',
  'remark',
  'lastMeterReading',
  'purchasePrice',
  'salvageValue',
  'usefulLife',
  // Cascading master-data FKs (nullable, populated by the CascadingDropdown)
] as const

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'DEVICE_EDIT')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const body = (await req.json()) as Record<string, unknown>
    const before = await db.device.findUnique({ where: { id } })
    if (!before) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const updateData: Record<string, unknown> = {
      assetCode: body.assetCode !== undefined ? String(body.assetCode).trim() : undefined,
      name: body.name !== undefined ? String(body.name).trim() : undefined,
      brand: body.brand !== undefined ? String(body.brand).trim() : undefined,
      model: body.model !== undefined ? String(body.model).trim() : undefined,
      type: body.type !== undefined ? String(body.type).trim() : undefined,
      serialNumber: setStr('serialNumber', body),
      status: body.status !== undefined ? String(body.status).trim() : undefined,
      site: body.site !== undefined ? String(body.site).trim() : undefined,
      assetSiteCode: setStr('assetSiteCode', body),
      department: setStr('department', body),
      departmentCode: setStr('departmentCode', body),
      parentRef: setStr('parentRef', body),
      displayLabel: setStr('displayLabel', body),
      location: setStr('location', body),
      building: setStr('building', body),
      floor: setStr('floor', body),
      room: setStr('room', body),
      ip: setStr('ip', body),
      mac: setStr('mac', body),
      remoteId: setStr('remoteId', body),
      purchaseDate: setStr('purchaseDate', body),
      warrantyMonths:
        body.warrantyMonths !== undefined
          ? clampWarrantyMonths(body.warrantyMonths)
          : undefined,
      warrantyEnd: setStr('warrantyEnd', body),
      vendor: setStr('vendor', body),
      contractNo: setStr('contractNo', body),
      uninstallDate: setStr('uninstallDate', body),
      meterRequired: setBool('meterRequired', body),
      meterMode: setStr('meterMode', body),
      costCenter: setStr('costCenter', body),
      deviceGroup: setStr('deviceGroup', body),
      remark: setStr('remark', body),
      // ── Device Set fields (Task ID 9, Phase 2) ──
      parentDeviceId: setStr('parentDeviceId', body),
      setLabel: setStr('setLabel', body),
      setPosition:
        body.setPosition !== undefined
          ? optInt(body.setPosition)
          : undefined,
      purchasePrice:
        body.purchasePrice !== undefined
          ? optFloat(body.purchasePrice)
          : undefined,
      salvageValue:
        body.salvageValue !== undefined
          ? optFloat(body.salvageValue) ?? 0
          : undefined,
      usefulLife:
        body.usefulLife !== undefined ? optInt(body.usefulLife) : undefined,
      // Cascading master-data FKs (nullable)
    }

    // Status transition side effects (aligned with Apps Script DeviceService.gs)
    // - Retired/Returned/Inactive/Disposed  → set uninstallDate = today (if not already set)
    // - Active && purchaseDate is null       → set purchaseDate = today (install/reactivation date)
    // assetCode remains read-only (no changes here).
    let statusSideEffects: Record<string, unknown> = {}
    if (body.status !== undefined && body.status !== before.status) {
      const newStatus = String(body.status).trim()
      const today = new Date().toISOString().slice(0, 10)
      if (
        ['Retired', 'Returned', 'Inactive', 'Disposed', 'retired', 'returned', 'inactive', 'disposed'].includes(
          newStatus,
        )
      ) {
        if (!before.uninstallDate) statusSideEffects.uninstallDate = today
      } else if (newStatus === 'Active' || newStatus === 'active') {
        if (!before.purchaseDate) statusSideEffects.purchaseDate = today
      }
    }

    // ── Demo cross-contamination guard: Device Set parent move ──
    // If the client is changing `parentDeviceId`, ensure the new parent has
    // the same `isDemo` flag as this device. Otherwise a demo device could
    // be linked to a real device (or vice versa), which would make demo
    // cleanup unsafe.
    //
    // `updateData` is `Record<string, unknown>`, so narrow the value to a
    // real string before using it as a lookup key — passing `unknown`
    // through would reach Prisma's `where: { id }` as `{}` and throw at
    // runtime rather than being rejected by the compiler.
    const nextParentId =
      typeof updateData.parentDeviceId === 'string' ? updateData.parentDeviceId : null
    if (
      nextParentId !== null &&
      nextParentId !== before.parentDeviceId
    ) {
      const newParent = await db.device.findUnique({
        where: { id: nextParentId },
        select: { isDemo: true, status: true },
      })
      if (!newParent) {
        return NextResponse.json(
          { error: 'อุปกรณ์หลักในชุดที่ระบุไม่มีในระบบ', code: 'PARENT_NOT_FOUND' },
          { status: 404 },
        )
      }
      if (newParent.isDemo !== before.isDemo) {
        return NextResponse.json(
          {
            error:
              'อุปกรณ์หลักและอุปกรณ์ลูกมีสถานะ demo ต่างกัน — ไม่สามารถจัดเข้าชุดเดียวกันได้',
            code: 'DEMO_MISMATCH',
          },
          { status: 400 },
        )
      }
    }

    const updated = await db.device.update({
      where: { id },
      data: {
        ...updateData,
        ...statusSideEffects,
        ...demoTag(auth.user), // FIX-025: tag demo data for safe cleanup
      },
    })
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const k of EDITABLE_FIELDS) {
      const inBody = body[k] !== undefined
      const isSideEffect = Object.prototype.hasOwnProperty.call(statusSideEffects, k)
      if (inBody || isSideEffect) {
        const from = before[k as keyof typeof before]
        const to = updated[k as keyof typeof updated]
        if (String(from ?? '') !== String(to ?? '')) {
          changes[k] = { from, to }
        }
      }
    }
    await logAudit(
      'UPDATE',
      'Device',
      id,
      `แก้ไขอุปกรณ์ ${updated.assetCode}`,
      { changes },
      auth.user.email, // FIX-026: actor
    )

    // ── GAP-H08: Auto-sync new master data values ──
    // Legacy: DeviceService.gs lines 294-306 — when a device is updated with
    // a new Type/Brand/Model/Building/Floor/DeviceGroup value, that value is
    // automatically added to MasterItem if it doesn't already exist.
    const masterFields: Array<{ field: string; category: string }> = [
      { field: 'type', category: 'DeviceType' },
      { field: 'brand', category: 'Brand' },
      { field: 'building', category: 'Building' },
      { field: 'floor', category: 'Floor' },
      { field: 'deviceGroup', category: 'DeviceGroup' },
    ]
    for (const { field, category } of masterFields) {
      const newVal = updated[field as keyof typeof updated] as string | null
      if (newVal && typeof newVal === 'string' && newVal.trim()) {
        const trimmed = newVal.trim()
        // Check if this value exists in MasterItem
        const existing = await db.masterItem.findFirst({
          where: { category, label: trimmed },
          select: { id: true },
        })
        if (!existing) {
          // Auto-create new MasterItem entry
          await db.masterItem.create({
            data: {
              category,
              code: `${category.slice(0, 3).toUpperCase()}-${Date.now().toString(36)}`,
              label: trimmed,
              displayLabel: trimmed,
              siteCode: 'ALL',
              active: true,
            },
          }).catch(() => {
            // Ignore — best-effort, don't fail the device update
          })
        }
      }
    }

    return NextResponse.json({ device: updated })
  } catch (err) {
    console.error('PUT /api/devices/[id]', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to update device') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// PATCH /api/devices/[id] — delegate to PUT (partial update)
// Some frontend code uses PATCH instead of PUT; both should work.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  // Delegate to PUT — same handler accepts partial fields
  return PUT(req, { params })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'DEVICE_EDIT')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const { id } = await params
    const device = await db.device.findUnique({ where: { id } })
    if (!device) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    await db.device.delete({ where: { id } })
    await logAudit(
      'DELETE',
      'Device',
      id,
      `ลบอุปกรณ์ ${device.assetCode} (${device.name})`,
      undefined,
      auth.user.email, // FIX-026: actor
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/devices/[id]', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to delete device') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
