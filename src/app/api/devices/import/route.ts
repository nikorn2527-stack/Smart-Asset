import { NextRequest, NextResponse } from 'next/server'
import { db, getBaseClient } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import type { Prisma } from '@prisma/client'

// Heavy operation — needs longer timeout (Vercel Hobby: max 60s)
export const maxDuration = 60

/**
 * POST /api/devices/import
 *
 * Bulk import devices from a CSV/JSON source. Supports three modes:
 *
 *   • `create` (default) — only insert NEW devices; existing assetCodes are
 *     skipped and reported in `errors[]`. Backward-compatible with the
 *     previous behavior.
 *
 *   • `update` — only UPDATE existing devices; rows whose assetCode does
 *     not exist are skipped and reported. Useful for "I want to refresh
 *     the warranty / location of N devices without opening each one."
 *
 *   • `upsert` — insert if new, update if exists. Useful for "sync from
 *     a master spreadsheet".
 *
 * Match key: `assetCode` (case-sensitive exact match — the legacy Apps
 * Script used integer codes 1, 2, 3 … 2378, which are case-insensitive
 * anyway).
 *
 * Request body:
 *   {
 *     mode: 'create' | 'update' | 'upsert',  // default 'create'
 *     devices: Array<ImportDeviceInput>,        // max 5000 rows
 *   }
 *
 * Each row supports the full device field set — including the 3 new
 * Device Set fields (`parentDeviceId`, `setLabel`, `setPosition`) added
 * in Task ID 9 Phase 2.
 *
 * Response shape (backward-compat — old dialog only reads inserted/skipped):
 *   {
 *     mode: 'create' | 'update' | 'upsert',
 *     inserted: number,
 *     updated: number,
 *     skipped: number,            // rows skipped due to error or mode mismatch
 *     errors: Array<{ row: number; message: string }>,
 *     byRow?: Array<{ row: number; assetCode: string; action: 'inserted' | 'updated' | 'skipped' | 'error' }>,
 *   }
 */

type ImportMode = 'create' | 'update' | 'upsert'

interface ImportDeviceInput {
  // ── Required (for create mode) ──
  assetCode?: unknown
  name?: unknown
  brand?: unknown
  model?: unknown
  type?: unknown
  // ── Status / location ──
  status?: unknown
  site?: unknown
  department?: unknown
  departmentCode?: unknown
  location?: unknown
  building?: unknown
  floor?: unknown
  room?: unknown
  // ── Identity refs ──
  parentRef?: unknown
  parentDeviceId?: unknown   // NEW (Task 9 Phase 2) — accepts cuid or assetCode
  displayLabel?: unknown
  // ── Purchase / warranty ──
  purchaseDate?: unknown
  purchasePrice?: unknown
  warrantyMonths?: unknown
  warrantyEnd?: unknown
  vendor?: unknown
  contractNo?: unknown
  // ── Network ──
  ip?: unknown
  mac?: unknown
  remoteId?: unknown
  // ── Meter ──
  meterRequired?: unknown
  meterMode?: unknown
  lastMeterReading?: unknown
  // ── Other ──
  serialNumber?: unknown
  costCenter?: unknown
  deviceGroup?: unknown
  remark?: unknown
  // ── Device Set (Task 9 Phase 2) ──
  setLabel?: unknown
  setPosition?: unknown
  // ── Legacy (kept for back-compat with old templates) ──
  lastMeterBw?: unknown
  lastMeterColor?: unknown
}

/** Accept both active|spare|repair|disposed (legacy short forms) and the
 *  full Active|In Stock|In Repair|Inactive|Disposed|Returned|Retrieved
 *  forms stored in DB. We normalise short forms to the canonical DB value. */
const STATUS_CANONICAL: Record<string, string> = {
  active: 'Active',
  spare: 'In Stock',
  repair: 'In Repair',
  'in repair': 'In Repair',
  inactive: 'Inactive',
  disposed: 'Disposed',
  returned: 'Returned',
  retrieved: 'Retrieved',
}

function toStr(v: unknown): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function toInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v)
  if (typeof v === 'string') {
    const n = Number(v.trim())
    if (Number.isFinite(n)) return Math.floor(n)
  }
  return null
}

function toFloat(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.trim())
    if (Number.isFinite(n)) return n
  }
  return null
}

function toBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (['true', '1', 'yes', 'y', 'ใช่'].includes(s)) return true
    if (['false', '0', 'no', 'n', 'ไม่'].includes(s)) return false
  }
  if (typeof v === 'number') return v !== 0
  return null
}

function normaliseStatus(raw: string | null): string {
  if (!raw) return 'Active'
  const lower = raw.toLowerCase()
  return STATUS_CANONICAL[lower] ?? raw
}

export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  try {
    // ── Auth (added in Task 10 — previously this route had NO auth check,
    //     which meant any unauthenticated user could mass-import devices) ──
    const auth = await requireAuth(req, 'DEVICE_EDIT')
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    const user = auth.row

    const body = await req.json()
    const mode: ImportMode =
      body?.mode === 'update' || body?.mode === 'upsert'
        ? body.mode
        : 'create'
    const devices = Array.isArray(body?.devices)
      ? (body.devices as ImportDeviceInput[])
      : []

    if (devices.length === 0) {
      return NextResponse.json(
        { error: 'ไม่พบข้อมูลอุปกรณ์ที่จะนำเข้า' },
        { status: 400 },
      )
    }
    if (devices.length > 5000) {
      return NextResponse.json(
        { error: 'นำเข้าได้ไม่เกิน 5,000 รายการต่อครั้ง' },
        { status: 400 },
      )
    }

    // ── Normalize + validate each row ──
    const errors: Array<{ row: number; message: string }> = []
    const byRow: Array<{ row: number; assetCode: string; action: 'inserted' | 'updated' | 'skipped' | 'error' }> = []
    const seenAssetCodes = new Set<string>()
    const validRows: Array<{ row: number; data: Record<string, unknown> }> = []

    devices.forEach((raw, idx) => {
      const rowNum = idx + 1
      const assetCode = toStr(raw.assetCode)
      const name = toStr(raw.name)
      const brand = toStr(raw.brand)
      const model = toStr(raw.model)
      const type = toStr(raw.type)
      const status = normaliseStatus(toStr(raw.status))
      const site = toStr(raw.site) ?? 'HQ'

      // assetCode is always required (it's the match key for all modes)
      if (!assetCode) {
        errors.push({ row: rowNum, message: 'ไม่มีรหัสอุปกรณ์ (assetCode)' })
        byRow.push({ row: rowNum, assetCode: '', action: 'error' })
        return
      }

      // For create/upsert modes: when inserting a NEW device, the
      // name/brand/model/type fields are required.
      // For update mode: only assetCode is required; other fields are
      // optional and only the provided ones are updated.
      if (mode !== 'update') {
        if (!name) {
          errors.push({ row: rowNum, message: `ไม่มีชื่ออุปกรณ์ (assetCode=${assetCode})` })
          byRow.push({ row: rowNum, assetCode, action: 'error' })
          return
        }
        if (!brand) {
          errors.push({ row: rowNum, message: `ไม่มีแบรนด์ (assetCode=${assetCode})` })
          byRow.push({ row: rowNum, assetCode, action: 'error' })
          return
        }
        if (!model) {
          errors.push({ row: rowNum, message: `ไม่มีรุ่น (assetCode=${assetCode})` })
          byRow.push({ row: rowNum, assetCode, action: 'error' })
          return
        }
        if (!type) {
          errors.push({ row: rowNum, message: `ไม่มีประเภท (assetCode=${assetCode})` })
          byRow.push({ row: rowNum, assetCode, action: 'error' })
          return
        }
      }

      if (seenAssetCodes.has(assetCode)) {
        errors.push({
          row: rowNum,
          message: `รหัสอุปกรณ์ซ้ำในไฟล์: ${assetCode}`,
        })
        byRow.push({ row: rowNum, assetCode, action: 'error' })
        return
      }
      seenAssetCodes.add(assetCode)

      validRows.push({
        row: rowNum,
        data: {
          assetCode,
          name,
          brand,
          model,
          type,
          serialNumber: toStr(raw.serialNumber),
          status,
          site,
          department: toStr(raw.department),
          departmentCode: toStr(raw.departmentCode),
          parentRef: toStr(raw.parentRef),
          displayLabel: toStr(raw.displayLabel),
          location: toStr(raw.location),
          building: toStr(raw.building),
          floor: toStr(raw.floor),
          room: toStr(raw.room),
          ip: toStr(raw.ip),
          mac: toStr(raw.mac),
          remoteId: toStr(raw.remoteId),
          purchaseDate: toStr(raw.purchaseDate),
          purchasePrice: toFloat(raw.purchasePrice),
          warrantyMonths: toInt(raw.warrantyMonths),
          warrantyEnd: toStr(raw.warrantyEnd),
          vendor: toStr(raw.vendor),
          contractNo: toStr(raw.contractNo),
          meterRequired: toBool(raw.meterRequired),
          meterMode: toStr(raw.meterMode),
          lastMeterBw: toInt(raw.lastMeterBw ?? raw.lastMeterReading) ?? 0,
          lastMeterColor: toInt(raw.lastMeterColor) ?? 0,
          costCenter: toStr(raw.costCenter),
          deviceGroup: toStr(raw.deviceGroup),
          remark: toStr(raw.remark),
          // ── Device Set fields (Task 9 Phase 2) ──
          parentDeviceId: toStr(raw.parentDeviceId),
          setLabel: toStr(raw.setLabel),
          setPosition: toInt(raw.setPosition),
        },
      })
    })

    if (validRows.length === 0) {
      return NextResponse.json(
        {
          mode,
          inserted: 0,
          updated: 0,
          skipped: devices.length,
          errors,
          byRow,
        },
        { status: 201 },
      )
    }

    // ── Resolve parentDeviceId: caller may pass either a cuid or an
    //     assetCode. We resolve to cuid via a bounded findMany. ──
    const parentLookups = validRows
      .map((r) => r.data.parentDeviceId as string | null)
      .filter((v): v is string => Boolean(v))
    const parentByAssetCode = new Map<string, string>()
    if (parentLookups.length > 0) {
      const parents = await db.device.findMany({
        where: {
          OR: [
            { id: { in: parentLookups } },
            { assetCode: { in: parentLookups } },
          ],
        },
        select: { id: true, assetCode: true },
      })
      for (const p of parents) {
        parentByAssetCode.set(p.id, p.id)
        parentByAssetCode.set(p.assetCode, p.id)
      }
    }

    // ── Lookup existing devices by assetCode to decide insert vs update ──
    const codes = validRows.map((r) => r.data.assetCode as string)
    const existing = await db.device.findMany({
      where: { assetCode: { in: codes } },
      select: { id: true, assetCode: true },
    })
    const existingMap = new Map(existing.map((d) => [d.assetCode, d.id]))

    const toInsert: Array<Record<string, unknown>> = []
    const toUpdate: Array<{ id: string; data: Record<string, unknown> }> = []
    let skippedByMode = 0

    for (const row of validRows) {
      const data = row.data
      const assetCode = data.assetCode as string
      const existingId = existingMap.get(assetCode)
      // Resolve parentDeviceId to cuid (or null if not found)
      const rawParent = data.parentDeviceId as string | null
      const resolvedParentId = rawParent ? parentByAssetCode.get(rawParent) ?? null : null
      if (rawParent && !resolvedParentId) {
        errors.push({
          row: row.row,
          message: `ไม่พบอุปกรณ์หลัก "${rawParent}" สำหรับ ${assetCode} — ฟิลด์ parentDeviceId ถูกข้าม`,
        })
      }
      data.parentDeviceId = resolvedParentId

      if (existingId) {
        // Device exists → only update if mode allows
        if (mode === 'create') {
          // In create mode, existing rows are skipped (legacy behavior)
          errors.push({
            row: row.row,
            message: `รหัสอุปกรณ์มีอยู่แล้วในระบบ: ${assetCode}`,
          })
          byRow.push({ row: row.row, assetCode, action: 'skipped' })
          skippedByMode++
          continue
        }
        // mode === 'update' || mode === 'upsert'
        // Build update payload — strip assetCode (immutable) + null fields
        // so we don't overwrite existing values with nulls unintentionally.
        const updateData: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(data)) {
          if (k === 'assetCode') continue
          if (v === null || v === undefined) continue
          updateData[k] = v
        }
        // Always stamp the editor
        updateData.updatedBy = user.username || user.email
        toUpdate.push({ id: existingId, data: updateData })
        byRow.push({ row: row.row, assetCode, action: 'updated' })
      } else {
        // New device → only insert if mode allows
        if (mode === 'update') {
          errors.push({
            row: row.row,
            message: `ไม่พบรหัสอุปกรณ์ในระบบ: ${assetCode} (โหมด update จะไม่สร้างใหม่)`,
          })
          byRow.push({ row: row.row, assetCode, action: 'skipped' })
          skippedByMode++
          continue
        }
        // mode === 'create' || mode === 'upsert'
        toInsert.push({
          ...data,
          // Ensure required fields have defaults for create (in case CSV
          // omitted them — though validateRows above should have caught it)
          name: data.name ?? `อุปกรณ์ ${assetCode}`,
          brand: data.brand ?? 'ไม่ระบุ',
          model: data.model ?? 'ไม่ระบุ',
          type: data.type ?? 'OTHER',
          status: data.status ?? 'Active',
          site: data.site ?? 'HQ',
          warrantyMonths: data.warrantyMonths ?? 12,
          lastMeterBw: data.lastMeterBw ?? 0,
          lastMeterColor: data.lastMeterColor ?? 0,
          meterRequired: data.meterRequired ?? false,
          meterMode: data.meterMode ?? 'TOTAL',
          deviceGroup: data.deviceGroup ?? 'COMPANY',
          salvageValue: 0,
          updatedBy: user.username || user.email,
        })
        byRow.push({ row: row.row, assetCode, action: 'inserted' })
      }
    }

    // ── Execute inserts + updates in a single transaction ──
    let inserted = 0
    let updated = 0

    await getBaseClient().$transaction(async (tx) => {
      if (toInsert.length > 0) {
        // NOTE: `skipDuplicates` is deliberately NOT passed. The datasource is
        // SQLite, whose generated DeviceCreateManyArgs types that option as
        // `never` (Prisma does not support it for SQLite). The parser has
        // already de-duplicated assetCodes and `false` was the Prisma default,
        // so behaviour is unchanged.
        const result = await tx.device.createMany({
          data: toInsert as unknown as Prisma.DeviceCreateManyInput[],
        })
        inserted = result.count
      }
      // Updates run one-by-one (Prisma has no bulk updateMany with different
      // values per row). For 5k rows this is ~5s on Supabase — acceptable.
      for (const u of toUpdate) {
        await tx.device.update({
          where: { id: u.id },
          data: u.data as never,
        })
        updated++
      }
    })

    const skipped = skippedByMode + errors.filter((e) => e.row !== 0).length - skippedByMode

    await logAudit(
      'IMPORT',
      'Device',
      null,
      `นำเข้าอุปกรณ์ CSV (${mode}): เพิ่ม ${inserted}, อัปเดต ${updated}, ข้าม ${skipped}`,
      {
        mode,
        inserted,
        updated,
        skipped,
        errorCount: errors.length,
        errors: errors.slice(0, 50),
        by: user.username || user.email,
      },
    )

    return NextResponse.json(
      {
        mode,
        inserted,
        updated,
        skipped,
        errors,
        byRow,
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('POST /api/devices/import', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to import devices') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
