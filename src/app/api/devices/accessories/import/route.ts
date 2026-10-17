import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { logAudit } from '@/lib/audit'
import { demoTag } from '@/lib/demo-mode'
import { parseCsv } from '@/lib/csv'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * POST /api/devices/accessories/import
 *
 * Bulk import accessories from a CSV file. Accepts multipart/form-data
 * with a `file` field (the CSV file). CSV header is required.
 *
 * CSV format (column order matters; first row must be the header):
 * ```csv
 * parent_asset_code,accessory_type,brand,model,serial_number,status,installed_date,remark
 * IT-00001,KEYBOARD,Logitech,K380,LOG-001,Active,2024-01-15,คีย์บอร์ดไร้สาย
 * IT-00001,MOUSE,Logitech,M330,LOG-002,Active,2024-01-15,
 * IT-00002,MONITOR,Dell,P2419H,DEL-003,Active,2024-01-20,
 * ```
 *
 * Match key for upsert: `(parentDeviceId, accessoryType, serialNumber)`.
 * When `serial_number` is empty, the row is ALWAYS created (no match key
 * possible — a device may legitimately have multiple un-numbered keyboards).
 *
 * Demo isolation:
 *   - If the parent Device isDemo=true, the new accessory is tagged
 *     isDemo=true (so demo data stays in the demo scope).
 *   - If the parent Device isDemo=false (real), the new accessory is tagged
 *     isDemo=false (real data).
 *
 * Response (200 OK):
 * ```json
 * {
 *   "data": {
 *     "total": 10,
 *     "created": 7,
 *     "updated": 1,
 *     "skipped": 2,
 *     "errors": [{ "row": 3, "message": "ไม่พบอุปกรณ์หลัก IT-99999" }]
 *   }
 * }
 * ```
 *
 * Audit + ImportJob: an ImportJob row + AuditLog entry is created.
 */

// Heavy operation — needs longer timeout (Vercel Hobby: max 60s)
export const maxDuration = 60

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_ROWS = 5000

// Canonical status map (accepts both short codes and full names).
const STATUS_CANONICAL: Record<string, string> = {
  active: 'Active',
  inactive: 'Inactive',
  'in repair': 'In Repair',
  repair: 'In Repair',
  disposed: 'Disposed',
  spare: 'In Stock',
  'in stock': 'In Stock',
}

interface CsvRow {
  parent_asset_code: string
  accessory_type: string
  brand: string
  model: string
  serial_number: string
  status: string
  installed_date: string
  remark: string
}

interface ImportError {
  row: number
  message: string
}

/** Trim a string field, returning null when empty/missing. */
function optStr(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  return String(v).trim()
}

function normaliseStatus(raw: string | null): string {
  if (!raw) return 'Active'
  const lower = raw.toLowerCase()
  return STATUS_CANONICAL[lower] ?? raw
}

/**
 * Build a CSV row record from a parsed CSV row, looking up columns by
 * header name (case-insensitive). Falls back to positional if the
 * header row is missing/blank.
 */
function rowToCsvRow(headers: string[], cells: string[]): CsvRow {
  const lookup = new Map<string, string>()
  headers.forEach((h, i) => {
    const key = (h || '').trim().toLowerCase()
    if (key) lookup.set(key, cells[i] ?? '')
  })

  // Positional fallback (matches the documented column order)
  const pos = (i: number) => cells[i] ?? ''
  const get = (key: string, fallbackIdx: number): string => {
    const v = lookup.get(key)
    return v === undefined ? pos(fallbackIdx) : v
  }

  return {
    parent_asset_code: get('parent_asset_code', 0).trim(),
    accessory_type: get('accessory_type', 1).trim(),
    brand: get('brand', 2).trim(),
    model: get('model', 3).trim(),
    serial_number: get('serial_number', 4).trim(),
    status: get('status', 5).trim(),
    installed_date: get('installed_date', 6).trim(),
    remark: get('remark', 7).trim(),
  }
}

export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  // ── Auth: require DEVICE_EDIT (same as device import) ──
  const auth = await requireAuth(req, 'DEVICE_EDIT')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const user = auth.row

  try {
    // ── Parse multipart form ──
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'ไม่พบไฟล์ในคำขอ (field "file")' },
        { status: 400 },
      )
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'ไฟล์ว่างเปล่า' }, { status: 400 })
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `ไฟล์ใหญ่เกินไป (สูงสุด ${MAX_FILE_BYTES / 1024 / 1024} MB)` },
        { status: 400 },
      )
    }

    // ── Create ImportJob record ──
    const job = await db.importJob.create({
      data: {
        jobType: 'accessories',
        fileName: file.name,
        fileType: 'csv',
        status: 'processing',
        uploadedBy: user.username || user.email,
      },
    })

    // ── Parse CSV ──
    const text = await file.text()
    const grid = parseCsv(text)
    if (grid.length < 2) {
      await db.importJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          errors: 'ไฟล์ CSV ไม่มีข้อมูล (ต้องมีบรรทัดหัวคอลัมน์ + อย่างน้อย 1 แถว)',
        },
      })
      return NextResponse.json(
        { error: 'ไฟล์ CSV ไม่มีข้อมูล (ต้องมีบรรทัดหัวคอลัมน์ + อย่างน้อย 1 แถว)' },
        { status: 400 },
      )
    }

    const headers = grid[0]
    const dataRows = grid.slice(1)
    if (dataRows.length > MAX_ROWS) {
      await db.importJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          errors: `นำเข้าได้ไม่เกิน ${MAX_ROWS} รายการต่อครั้ง`,
        },
      })
      return NextResponse.json(
        { error: `นำเข้าได้ไม่เกิน ${MAX_ROWS} รายการต่อครั้ง` },
        { status: 400 },
      )
    }

    // ── Parse + validate each row ──
    const errors: ImportError[] = []
    const validRows: Array<{ row: number; data: CsvRow }> = []

    dataRows.forEach((cells, idx) => {
      const rowNum = idx + 2 // +1 for header, +1 for 1-based counting
      // Skip completely-empty rows (trailing newlines etc.)
      if (cells.length === 0 || (cells.length === 1 && cells[0] === '')) {
        return
      }
      const data = rowToCsvRow(headers, cells)
      if (!data.parent_asset_code) {
        errors.push({ row: rowNum, message: 'ไม่มี parent_asset_code' })
        return
      }
      if (!data.accessory_type) {
        errors.push({
          row: rowNum,
          message: `ไม่มี accessory_type (parent=${data.parent_asset_code})`,
        })
        return
      }
      validRows.push({ row: rowNum, data })
    })

    // ── Resolve parent devices by assetCode (batch lookup) ──
    const assetCodes = [...new Set(validRows.map((r) => r.data.parent_asset_code))]
    const devices = await db.device.findMany({
      where: { assetCode: { in: assetCodes } },
      select: { id: true, assetCode: true, isDemo: true },
    })
    const assetToDevice = new Map<
      string,
      { id: string; isDemo: boolean }
    >()
    for (const d of devices) {
      assetToDevice.set(d.assetCode, { id: d.id, isDemo: d.isDemo })
    }

    // ── Find existing accessories by match key (batch lookup) ──
    // Match key: (parentDeviceId, accessoryType, serialNumber)
    // When serialNumber is empty, ALWAYS create — no match key.
    const matchableRows = validRows.filter((r) => {
      const device = assetToDevice.get(r.data.parent_asset_code)
      return device && r.data.serial_number
    })
    const matchKeys = matchableRows.map(
      (r) =>
        `${assetToDevice.get(r.data.parent_asset_code)!.id}|${r.data.accessory_type}|${r.data.serial_number}`,
    )
    const existingAccessories =
      matchKeys.length > 0
        ? await db.deviceAccessory.findMany({
            where: {
              OR: matchableRows.map((r) => ({
                parentDeviceId: assetToDevice.get(r.data.parent_asset_code)!.id,
                accessoryType: r.data.accessory_type,
                serialNumber: r.data.serial_number,
              })),
            },
            select: { id: true, parentDeviceId: true, accessoryType: true, serialNumber: true },
          })
        : []
    const existingByKey = new Map<string, string>()
    for (const a of existingAccessories) {
      existingByKey.set(
        `${a.parentDeviceId}|${a.accessoryType}|${a.serialNumber ?? ''}`,
        a.id,
      )
    }

    // ── Process each valid row ──
    let created = 0
    let updated = 0
    let skipped = 0
    const errorsWithRow: ImportError[] = [...errors]

    for (const row of validRows) {
      const data = row.data
      const device = assetToDevice.get(data.parent_asset_code)
      if (!device) {
        errorsWithRow.push({
          row: row.row,
          message: `ไม่พบอุปกรณ์หลัก ${data.parent_asset_code}`,
        })
        skipped++
        continue
      }

      const matchKey = `${device.id}|${data.accessory_type}|${data.serial_number}`
      const existingId = data.serial_number ? existingByKey.get(matchKey) : undefined

      const payload = {
        parentDeviceId: device.id,
        accessoryType: data.accessory_type,
        brand: optStr(data.brand),
        model: optStr(data.model),
        serialNumber: optStr(data.serial_number),
        status: normaliseStatus(optStr(data.status)),
        installedDate: optStr(data.installed_date),
        remark: optStr(data.remark),
        // Tag isDemo from the parent device so demo data stays in scope.
        isDemo: device.isDemo,
      }

      if (existingId) {
        await db.deviceAccessory.update({
          where: { id: existingId },
          data: payload,
        })
        updated++
      } else {
        await db.deviceAccessory.create({
          data: { ...payload, ...demoTag(auth.user) },
        })
        created++
      }
    }

    // ── Update ImportJob status ──
    await db.importJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        totalRows: dataRows.length,
        processedRows: created + updated,
        errorRows: skipped + errors.length,
        completedAt: new Date(),
        errors: errorsWithRow.length > 0 ? JSON.stringify(errorsWithRow.slice(0, 50)) : null,
      },
    })

    // ── Audit log ──
    await logAudit(
      'IMPORT',
      'DeviceAccessory',
      null,
      `นำเข้าอุปกรณ์ต่อพ่วง CSV: เพิ่ม ${created}, อัปเดต ${updated}, ข้าม ${skipped}`,
      {
        fileName: file.name,
        fileType: 'csv',
        total: dataRows.length,
        created,
        updated,
        skipped,
        errorCount: errorsWithRow.length,
        errors: errorsWithRow.slice(0, 50),
        by: user.username || user.email,
      },
      user.username || user.email,
    )

    return NextResponse.json(
      {
        data: {
          total: dataRows.length,
          created,
          updated,
          skipped,
          errors: errorsWithRow,
          jobId: job.id,
        },
      },
      { status: 200 },
    )
  } catch (err) {
    console.error('POST /api/devices/accessories/import', err)
    const message =
      process.env.NODE_ENV === 'development'
        ? err instanceof Error
          ? err.message
          : 'Failed to import accessories'
        : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
