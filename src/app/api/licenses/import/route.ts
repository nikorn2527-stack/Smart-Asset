import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { logAudit } from '@/lib/audit'
import { demoTag } from '@/lib/demo-mode'
import { parseCsv } from '@/lib/csv'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * POST /api/licenses/import
 *
 * Bulk import software licenses from a CSV file. Accepts multipart/form-data
 * with a `file` field (the CSV file). CSV header is required.
 *
 * CSV format (column order matters; first row must be the header):
 * ```csv
 * asset_no,software,license_type,license_key,quantity,expiry_date,remark
 * IT-00001,Microsoft Office 365,Subscription,XXXX-XXXX-XXXX,5,2025-12-31,Office for 5 users
 * IT-00002,Adobe Acrobat Pro,Volume,YYYY-YYYY-YYYY,2,2025-06-30,
 * ```
 *
 * Match key for upsert:
 *   - If deviceId was resolved from asset_no: (deviceId, Software) — preferred
 *   - If deviceId could NOT be resolved but Asset_No is set: (Asset_No, Software)
 *
 * On match: UPDATE the existing license (preserves id + audit history).
 * On no match: CREATE a new license record with deviceId set (when the
 * device was found) and Asset_No set (always — preserves the legacy lookup).
 *
 * Demo isolation:
 *   - If the parent Device isDemo=true, the new license is tagged
 *     isDemo=true (so demo data stays in the demo scope).
 *   - If the parent Device isDemo=false (real), the new license is tagged
 *     isDemo=false (real data).
 *
 * Response (200 OK):
 * ```json
 * {
 *   "data": {
 *     "total": 10,
 *     "created": 7,
 *     "updated": 2,
 *     "skipped": 1,
 *     "errors": [{ "row": 3, "message": "ไม่พบอุปกรณ์ IT-99999" }]
 *   }
 * }
 * ```
 */

// Heavy operation — needs longer timeout (Vercel Hobby: max 60s)
export const maxDuration = 60

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_ROWS = 5000

interface CsvRow {
  asset_no: string
  software: string
  license_type: string
  license_key: string
  quantity: string
  expiry_date: string
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

/** Parse an Int; returns 1 when missing/invalid (licenses default to 1). */
function parseQuantity(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(1, Math.floor(v))
  if (typeof v === 'string') {
    const n = Number(v.trim())
    if (Number.isFinite(n) && n > 0) return Math.max(1, Math.floor(n))
  }
  return 1
}

/** Build a CSV row record from a parsed CSV row, looking up columns by
 *  header name (case-insensitive). Falls back to positional if the
 *  header row is missing/blank. */
function rowToCsvRow(headers: string[], cells: string[]): CsvRow {
  const lookup = new Map<string, string>()
  headers.forEach((h, i) => {
    const key = (h || '').trim().toLowerCase()
    if (key) lookup.set(key, cells[i] ?? '')
  })

  const pos = (i: number) => cells[i] ?? ''
  const get = (key: string, fallbackIdx: number): string => {
    const v = lookup.get(key)
    return v === undefined ? pos(fallbackIdx) : v
  }

  return {
    asset_no: get('asset_no', 0).trim(),
    software: get('software', 1).trim(),
    license_type: get('license_type', 2).trim(),
    license_key: get('license_key', 3).trim(),
    quantity: get('quantity', 4).trim(),
    expiry_date: get('expiry_date', 5).trim(),
    remark: get('remark', 6).trim(),
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
        jobType: 'licenses',
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
      if (!data.asset_no) {
        errors.push({ row: rowNum, message: 'ไม่มี asset_no' })
        return
      }
      if (!data.software) {
        errors.push({
          row: rowNum,
          message: `ไม่มี software (asset_no=${data.asset_no})`,
        })
        return
      }
      validRows.push({ row: rowNum, data })
    })

    // ── Resolve parent devices by assetCode (batch lookup) ──
    const assetNos = [...new Set(validRows.map((r) => r.data.asset_no))]
    const devices = await db.device.findMany({
      where: { assetCode: { in: assetNos } },
      select: { id: true, assetCode: true, isDemo: true },
    })
    const assetToDevice = new Map<
      string,
      { id: string; isDemo: boolean }
    >()
    for (const d of devices) {
      assetToDevice.set(d.assetCode, { id: d.id, isDemo: d.isDemo })
    }

    // ── Find existing licenses by match key ──
    // Match key:
    //   - When deviceId was resolved: (deviceId, Software)
    //   - When deviceId NOT resolved: (Asset_No, Software)
    // We batch-query both sets.
    const deviceMatchRows = validRows.filter((r) => assetToDevice.has(r.data.asset_no))
    const assetOnlyMatchRows = validRows.filter((r) => !assetToDevice.has(r.data.asset_no))

    const existingByDevice =
      deviceMatchRows.length > 0
        ? await db.licenseRecord.findMany({
            where: {
              OR: deviceMatchRows.map((r) => ({
                deviceId: assetToDevice.get(r.data.asset_no)!.id,
                Software: r.data.software,
              })),
            },
            select: { id: true, deviceId: true, Software: true },
          })
        : []
    const existingByDeviceKey = new Map<string, string>()
    for (const l of existingByDevice) {
      existingByDeviceKey.set(`${l.deviceId}|${l.Software}`, l.id)
    }

    const existingByAsset =
      assetOnlyMatchRows.length > 0
        ? await db.licenseRecord.findMany({
            where: {
              OR: assetOnlyMatchRows.map((r) => ({
                Asset_No: r.data.asset_no,
                Software: r.data.software,
              })),
            },
            select: { id: true, Asset_No: true, Software: true },
          })
        : []
    const existingByAssetKey = new Map<string, string>()
    for (const l of existingByAsset) {
      existingByAssetKey.set(`${l.Asset_No}|${l.Software}`, l.id)
    }

    // ── Process each valid row ──
    let created = 0
    let updated = 0
    let skipped = 0
    const errorsWithRow: ImportError[] = [...errors]

    for (const row of validRows) {
      const data = row.data
      const device = assetToDevice.get(data.asset_no)

      if (!device) {
        // Device not found — fall back to Asset_No string only.
        // We still allow import (license without a real FK), but warn.
        const assetKey = `${data.asset_no}|${data.software}`
        const existingId = existingByAssetKey.get(assetKey)

        const payload = {
          License_ID: null,
          Asset_No: data.asset_no,
          Software: data.software,
          LicenseType: optStr(data.license_type),
          License_Key: optStr(data.license_key),
          Quantity: parseQuantity(data.quantity),
          Expiry_Date: optStr(data.expiry_date),
          Remark: optStr(data.remark),
          deviceId: null,
          // Tag with the actor's demo status — orphan license has no
          // parent device to copy isDemo from.
          ...demoTag(auth.user),
        }

        if (existingId) {
          await db.licenseRecord.update({
            where: { id: existingId },
            data: payload,
          })
          updated++
        } else {
          await db.licenseRecord.create({ data: payload })
          created++
        }
        errorsWithRow.push({
          row: row.row,
          message: `ไม่พบอุปกรณ์ ${data.asset_no} — นำเข้าโดยใช้ Asset_No string เท่านั้น (deviceId=NULL)`,
        })
        continue
      }

      // Device found — use real FK + Asset_No for back-compat.
      const matchKey = `${device.id}|${data.software}`
      const existingId = existingByDeviceKey.get(matchKey)

      const payload = {
        Asset_No: data.asset_no, // kept for legacy queries
        Software: data.software,
        LicenseType: optStr(data.license_type),
        License_Key: optStr(data.license_key),
        Quantity: parseQuantity(data.quantity),
        Expiry_Date: optStr(data.expiry_date),
        Remark: optStr(data.remark),
        deviceId: device.id,
        isActive: true,
        isDemo: device.isDemo,
      }

      if (existingId) {
        await db.licenseRecord.update({
          where: { id: existingId },
          data: payload,
        })
        updated++
      } else {
        await db.licenseRecord.create({
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
      'LicenseRecord',
      null,
      `นำเข้า License CSV: เพิ่ม ${created}, อัปเดต ${updated}, ข้าม ${skipped}`,
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
    console.error('POST /api/licenses/import', err)
    const message =
      process.env.NODE_ENV === 'development'
        ? err instanceof Error
          ? err.message
          : 'Failed to import licenses'
        : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
