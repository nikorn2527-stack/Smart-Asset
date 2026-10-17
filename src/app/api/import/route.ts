import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db, getBaseClient } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { resolveHeaderIndexes } from '@/lib/device-import-contract'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import {
  FIELD_MAPPINGS,
  STATUS_MAPPINGS,
  SOURCE_SHEET_REGISTRY,
  TEMPLATE_HEADERS,
  mapCsvRow,
  parseCsv as parseCsvLib,
  parseBool,
  parseDate,
  parseDateTime,
  toInt as toIntLib,
  toFloat as toFloatLib,
  type AppsScriptSource,
} from '@/lib/csv-field-mapping'

// ============================================================
// Excel / CSV Import — ข้อ 3: ดาต้าเบสขึ้นได้ง่าย แค่เอาไฟล์ Excel ขึ้น
// POST  /api/import?source=apps-script-*  → ดึง CSV จากระบบเก่า
// POST  /api/import                       → อัปโหลด CSV แบบเดิม (jobType)
// GET   /api/import                       → list recent ImportJob rows (history)
// GET   /api/import/[id]                  → fetch a single ImportJob (errors detail)
// ============================================================

type JobType =
  | 'device'
  | 'work-order'
  | 'stock'
  | 'meter-reading'
  | 'master-data'

const VALID_JOB_TYPES: Set<JobType> = new Set([
  'device',
  'work-order',
  'stock',
  'meter-reading',
  'master-data',
])

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB
// P1 Security: Limit max rows and cells to prevent DoS / memory exhaustion
const MAX_ROWS = 10000
const MAX_CELLS = 200000 // e.g. 10000 rows × 20 cols
const MAX_COLUMNS = 100

interface ImportError {
  row: number
  message: string
}

// ------------------------------------------------------------
// Server-side RFC-4180-ish CSV parser (handles quoted fields,
// escaped "" → ", commas/newlines inside quotes). No deps.
// P1 Security: Enforces row/cell/column limits to prevent DoS.
// ------------------------------------------------------------
function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  let cellCount = 0

  // P1 Security: CSV injection prevention — prefix dangerous formula
  // characters with a single quote (=, +, -, @) so spreadsheet apps
  // don't interpret them as formulas when the exported CSV is opened
  function sanitizeCell(val: string): string {
    if (val && /^[=+\-@]/.test(val)) {
      return `'${val}`
    }
    return val
  }

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
      continue
    }
    if (c === ',') {
      cur.push(sanitizeCell(field))
      field = ''
      cellCount++
      if (cellCount > MAX_CELLS) throw new Error('CSV exceeds max cell limit (' + MAX_CELLS + ')')
      if (cur.length > MAX_COLUMNS) throw new Error('CSV exceeds max column limit (' + MAX_COLUMNS + ')')
      continue
    }
    if (c === '\r') {
      if (src[i + 1] === '\n') i++
      cur.push(sanitizeCell(field))
      rows.push(cur)
      cellCount++
      if (rows.length > MAX_ROWS) throw new Error('CSV exceeds max row limit (' + MAX_ROWS + ')')
      cur = []
      field = ''
      continue
    }
    if (c === '\n') {
      cur.push(sanitizeCell(field))
      rows.push(cur)
      cellCount++
      if (rows.length > MAX_ROWS) throw new Error('CSV exceeds max row limit (' + MAX_ROWS + ')')
      cur = []
      field = ''
      continue
    }
    field += c
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(sanitizeCell(field))
    rows.push(cur)
  }
  // Drop a trailing empty row that often comes from a final newline.
  if (
    rows.length > 0 &&
    rows[rows.length - 1].length === 1 &&
    rows[rows.length - 1][0] === ''
  ) {
    rows.pop()
  }
  return rows
}

function toStr(v: string | undefined): string | null {
  if (v === undefined) return null
  const s = v.trim()
  return s === '' ? null : s
}

function toInt(v: string | undefined, fallback = 0): number {
  if (v === undefined) return fallback
  const t = v.trim()
  if (t === '') return fallback
  const n = Number(t)
  return Number.isFinite(n) ? Math.floor(n) : fallback
}

function toFloat(v: string | undefined): number | null {
  if (v === undefined) return null
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// ------------------------------------------------------------
// Per-type importers. Each returns { processed, errors }.
// ------------------------------------------------------------

async function importDevices(
  rows: string[][],
  headers: string[],
): Promise<{ processed: number; errors: ImportError[] }> {
  // Use alias-aware lookup so legacy/Thai headers (e.g. รหัสสินทรัพย์,
  // asset_no) work in addition to canonical camelCase names.
  // resolveHeaderIndexes() is the canonical alias resolver shared with
  // the Apps Script import mode (HEADER_ALIASES in device-import-contract.ts).
  const fields = resolveHeaderIndexes(headers)

  // Map canonical import-contract fields → import-route local column index.
  // For canonical fields not covered by HEADER_ALIASES (e.g. `name`), fall
  // back to the case-insensitive header name match.
  const fallbackIdx = (name: string): number =>
    headers.findIndex((h) => h.replace(/^\uFEFF/, '').trim().toLowerCase() === name.toLowerCase())

  const iAsset = fields.assetNo ?? fallbackIdx('assetCode')
  const iName = fallbackIdx('name')
  const iBrand = fields.brand ?? fallbackIdx('brand')
  const iModel = fields.model ?? fallbackIdx('model')
  const iType = fields.deviceType ?? fallbackIdx('type')
  const iSerial = fields.serial ?? fallbackIdx('serialNumber')
  const iStatus = fields.status ?? fallbackIdx('status')
  const iSite = fields.site ?? fallbackIdx('site')
  const iDept = fields.department ?? fallbackIdx('department')
  const iLoc = fields.location ?? fallbackIdx('location')
  const iPurchase = fields.installDate ?? fallbackIdx('purchaseDate')
  const iWarranty = fallbackIdx('warrantyMonths')

  const VALID_STATUSES = new Set([
    'active',
    'spare',
    'repair',
    'disposed',
    'in_stock',
  ])

  const errors: ImportError[] = []
  const seen = new Set<string>()
  const toInsert: Array<Record<string, unknown>> = []

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    const rowNum = r + 2 // data starts at row 2 (after header)
    const assetCode = toStr(row[iAsset]) ?? ''
    const name = toStr(row[iName])
    const brand = toStr(row[iBrand])
    const model = toStr(row[iModel])
    const type = toStr(row[iType])
    const status = toStr(row[iStatus]) ?? 'active'
    const site = toStr(row[iSite]) ?? 'HQ'

    if (!assetCode) {
      errors.push({ row: rowNum, message: 'ไม่มีรหัสอุปกรณ์ (assetCode)' })
      continue
    }
    if (!name) {
      errors.push({ row: rowNum, message: `ไม่มีชื่อ (assetCode=${assetCode})` })
      continue
    }
    if (!brand) {
      errors.push({ row: rowNum, message: `ไม่มีแบรนด์ (assetCode=${assetCode})` })
      continue
    }
    if (!model) {
      errors.push({ row: rowNum, message: `ไม่มีรุ่น (assetCode=${assetCode})` })
      continue
    }
    if (!type) {
      errors.push({ row: rowNum, message: `ไม่มีประเภท (assetCode=${assetCode})` })
      continue
    }
    if (status && !VALID_STATUSES.has(status)) {
      errors.push({
        row: rowNum,
        message: `สถานะไม่ถูกต้อง: "${status}" (assetCode=${assetCode})`,
      })
      continue
    }
    if (seen.has(assetCode)) {
      errors.push({ row: rowNum, message: `รหัสซ้ำในไฟล์: ${assetCode}` })
      continue
    }
    seen.add(assetCode)
    toInsert.push({
      assetCode,
      name,
      brand,
      model,
      type,
      serialNumber: toStr(row[iSerial]),
      status,
      site,
      department: toStr(row[iDept]),
      location: toStr(row[iLoc]),
      purchaseDate: toStr(row[iPurchase]),
      warrantyMonths: toInt(row[iWarranty], 12),
    })
  }

  if (toInsert.length === 0) return { processed: 0, errors }

  // Pre-filter assetCodes that already exist in DB.
  const existing = await db.device.findMany({
    where: { assetCode: { in: toInsert.map((r) => r.assetCode as string) } },
    select: { assetCode: true },
  })
  const existingSet = new Set(existing.map((d) => d.assetCode))
  const filtered = toInsert.filter((r) => {
    if (existingSet.has(r.assetCode as string)) {
      errors.push({
        row: 0,
        message: `มีอยู่แล้วในระบบ: ${r.assetCode}`,
      })
      return false
    }
    return true
  })

  if (filtered.length === 0) return { processed: 0, errors }

  // ── Phase A fix (CONSULTING-007): wrap device writes in a Prisma
  //    transaction so partial failures don't leave the DB in a torn
  //    state. Batches of BATCH_SIZE rows per transaction avoid long
  //    row-lock contention on large imports. If a batch fails, that
  //    batch is rolled back atomically and we abort the rest of the
  //    import — previously committed batches stay committed (we can't
  //    un-commit a closed transaction), but no half-batch writes leak.
  //
  //    Stock-in / stock-out / work-order / meter-reading sections are
  //    NOT yet wrapped (Phase B will consolidate those onto the
  //    /api/itam/devices/import contract endpoint). ──
  const BATCH_SIZE = 100
  const batches: Array<typeof filtered> = []
  for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
    batches.push(filtered.slice(i, i + BATCH_SIZE))
  }

  let processed = 0
  console.log(
    `[import][device] writing ${filtered.length} rows in ${batches.length} batch(es) of ≤${BATCH_SIZE}`,
  )

  try {
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b]
      const batchNo = b + 1
      console.log(
        `[import][device] batch ${batchNo}/${batches.length}: writing ${batch.length} rows`,
      )
      // Each batch runs in its own transaction so a single bad row
      // only rolls back its own batch — earlier batches stay put and
      // we surface a clear error to the caller with progress info.
      const batchCount = await getBaseClient().$transaction(async (tx) => {
        const result = await tx.device.createMany({
          data: batch.map((r) => ({
            assetCode: r.assetCode as string,
            name: r.name as string,
            brand: r.brand as string,
            model: r.model as string,
            type: r.type as string,
            serialNumber: r.serialNumber as string | null,
            status: r.status as string,
            site: r.site as string,
            department: r.department as string | null,
            location: r.location as string | null,
            purchaseDate: r.purchaseDate as string | null,
            warrantyMonths: r.warrantyMonths as number,
          })),
        })
        return result.count
      })
      processed += batchCount
      console.log(
        `[import][device] batch ${batchNo}/${batches.length}: committed ${batchCount} rows (cumulative ${processed}/${filtered.length})`,
      )
    }
    return { processed, errors }
  } catch (e) {
    // A batch failed → that batch's writes were rolled back by Prisma.
    // Earlier batches may already be committed; surface that fact so
    // the caller knows the import is partial.
    const committedBeforeFailure = processed
    console.error(
      `[import][device] batch failed after committing ${committedBeforeFailure}/${filtered.length} rows`,
      e,
    )
    errors.push({
      row: 0,
      message:
        (e instanceof Error ? e.message : 'DB error (device)') +
        ` — ${committedBeforeFailure}/${filtered.length} rows committed before failure (rolled back failed batch)`,
    })
    // Report the rows we did manage to commit so the user knows the
    // import wasn't a total loss. Without this, a 1000-row import
    // failing on row 750 would silently drop the 700 committed rows.
    return { processed: committedBeforeFailure, errors }
  }
}

async function importWorkOrders(
  rows: string[][],
  headers: string[],
): Promise<{ processed: number; errors: ImportError[] }> {
  const idx = (name: string) =>
    headers.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase())
  const iSubject = idx('subject')
  const iBuilding = idx('building')
  const iLocation = idx('location')
  const iDetails = idx('details')
  const iPriority = idx('priority')
  const iReporter = idx('reporterName')
  const iTel = idx('tel')
  // P1-R6 fix: field mapping — requestId + siteCode from CSV
  const iRequestId = idx('requestId')
  const iSiteCode = idx('siteCode')

  const VALID_PRIORITIES = new Set(['ปกติ', 'ปานกลาง', 'สูง', 'ด่วน'])
  const errors: ImportError[] = []
  let processed = 0

  // Generate WO numbers in bulk: find today's max seq, then increment.
  const now = new Date()
  const ymd =
    `${now.getFullYear()}` +
    `${String(now.getMonth() + 1).padStart(2, '0')}` +
    `${String(now.getDate()).padStart(2, '0')}`
  const prefix = `WO-${ymd}-`
  const lastWo = await db.workOrder.findFirst({
    where: { woNumber: { startsWith: prefix } },
    orderBy: { woNumber: 'desc' },
    select: { woNumber: true },
  })
  let seq = lastWo?.woNumber
    ? parseInt(lastWo.woNumber.match(/(\d+)$/)?.[1] ?? '0', 10)
    : 0

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    const rowNum = r + 2
    // F-04 fix: null-safe validation (toStr may return null when header/field doesn't exist)
    const subject = (toStr(row[iSubject]) ?? '').trim()
    if (!subject) {
      errors.push({ row: rowNum, message: 'ไม่มีประเภทปัญหา (subject)' })
      continue
    }
    // F-04 fix: null-safe requestId validation
    const requestId = (toStr(row[iRequestId]) ?? '').trim()
    if (!requestId) {
      errors.push({ row: rowNum, message: 'ไม่มี requestId (required field)' })
      continue
    }
    // F-04 fix: null-safe siteCode mapping
    const siteCode = (toStr(row[iSiteCode]) ?? '').trim() || null

    const priority = toStr(row[iPriority])
    const prPriority =
      priority && VALID_PRIORITIES.has(priority) ? priority : 'ปกติ'
    seq++
    const woNumber = `${prefix}${String(seq).padStart(3, '0')}`

    try {
      // Ensure woNumber uniqueness — fall back to null if collision.
      const collision = await db.workOrder.findUnique({
        where: { woNumber },
        select: { id: true },
      })
      const data = {
        requestId, // P1-R6 fix: populate requestId
        siteCode, // P1-R6 fix: populate siteCode
        subject,
        building: toStr(row[iBuilding]),
        location: toStr(row[iLocation]),
        details: toStr(row[iDetails]),
        priority: prPriority,
        reporterName: toStr(row[iReporter]),
        tel: toStr(row[iTel]),
        submissionSource: 'guest' as const,
        status: 'PENDING' as const,
      }
      const created = collision
        ? await db.workOrder.create({ data })
        : await db.workOrder.create({ data: { ...data, woNumber } })
      // F-01 fix: processed++ ONLY after AuditLog verification passes (fail-closed)
      // F-04 fix: AuditLog verification failure = validation error (422), not DB error (500)
      try {
        await logAudit(
          'WORK_ORDER_IMPORT',
          'WorkOrder',
          created.id,
          `CSV import สร้างใบงาน ${requestId}`,
          { source: 'csv-import', requestId, siteCode, subject },
          'system',
          siteCode,
        )
        // Explicit verification: confirm AuditLog was written (fail-closed)
        const auditCheck = await db.auditLog.findFirst({
          where: { entityId: created.id, action: 'WORK_ORDER_IMPORT' },
          select: { id: true },
        })
        if (!auditCheck) {
          // AuditLog not written → do NOT count as processed (fail-closed)
          errors.push({
            row: rowNum,
            message: `AuditLog verification failed for WorkOrder ${requestId}`,
          })
        } else {
          // AuditLog verified → only now count as processed
          processed++
        }
      } catch (auditErr) {
        // Verification query failed → do NOT count as processed (fail-closed)
        console.error('AuditLog verification error:', auditErr)
        errors.push({
          row: rowNum,
          message: `AuditLog verification error for WorkOrder ${requestId}`,
        })
      }
    } catch (e) {
      console.error('importWorkOrders create error', e)
      errors.push({
        row: rowNum,
        message: e instanceof Error ? e.message : 'DB error (work-order)',
      })
    }
  }
  return { processed, errors }
}

async function importStock(
  rows: string[][],
  headers: string[],
): Promise<{ processed: number; errors: ImportError[] }> {
  const idx = (name: string) =>
    headers.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase())
  const iCode = idx('productCode')
  const iName = idx('productName')
  const iCategory = idx('category')
  const iBrand = idx('brand')
  const iUnit = idx('unit')
  const iQty = idx('quantity')
  const iMin = idx('minQuantity')
  const iCost = idx('unitCost')
  const iLoc = idx('location')

  const errors: ImportError[] = []
  const seen = new Set<string>()
  const toInsert: Array<Record<string, unknown>> = []

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    const rowNum = r + 2
    const productCode = toStr(row[iCode]) ?? ''
    const productName = toStr(row[iName])

    if (!productCode) {
      errors.push({ row: rowNum, message: 'ไม่มีรหัสสินค้า (productCode)' })
      continue
    }
    if (!productName) {
      errors.push({
        row: rowNum,
        message: `ไม่มีชื่อสินค้า (productCode=${productCode})`,
      })
      continue
    }
    if (seen.has(productCode)) {
      errors.push({ row: rowNum, message: `รหัสซ้ำในไฟล์: ${productCode}` })
      continue
    }
    seen.add(productCode)
    toInsert.push({
      productCode,
      productName,
      category: toStr(row[iCategory]),
      brand: toStr(row[iBrand]),
      unit: toStr(row[iUnit]) ?? 'ชิ้น',
      quantity: toInt(row[iQty], 0),
      minQuantity: toInt(row[iMin], 0),
      unitCost: toFloat(row[iCost]),
      location: toStr(row[iLoc]),
    })
  }

  if (toInsert.length === 0) return { processed: 0, errors }

  const existing = await db.stockItem.findMany({
    where: { productCode: { in: toInsert.map((r) => r.productCode as string) } },
    select: { productCode: true },
  })
  const existingSet = new Set(existing.map((s) => s.productCode))
  const filtered = toInsert.filter((r) => {
    if (existingSet.has(r.productCode as string)) {
      errors.push({
        row: 0,
        message: `มีอยู่แล้วในระบบ: ${r.productCode}`,
      })
      return false
    }
    return true
  })

  if (filtered.length === 0) return { processed: 0, errors }

  try {
    const result = await db.stockItem.createMany({
      data: filtered.map((r) => ({
        productCode: r.productCode as string,
        productName: r.productName as string,
        category: r.category as string | null,
        brand: r.brand as string | null,
        unit: r.unit as string,
        quantity: r.quantity as number,
        minQuantity: r.minQuantity as number,
        unitCost: r.unitCost as number | null,
        location: r.location as string | null,
      })),
    })
    return { processed: result.count, errors }
  } catch (e) {
    console.error('importStock createMany error', e)
    errors.push({
      row: 0,
      message: e instanceof Error ? e.message : 'DB error (stock)',
    })
    return { processed: 0, errors }
  }
}

async function importMeterReadings(
  rows: string[][],
  headers: string[],
): Promise<{ processed: number; errors: ImportError[] }> {
  const idx = (name: string) =>
    headers.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase())
  const iAsset = idx('assetCode')
  const iDate = idx('readingDate')
  const iBw = idx('meterBw')
  const iColor = idx('meterColor')
  const iReadBy = idx('readBy')
  const iRemark = idx('remark')

  const errors: ImportError[] = []
  let processed = 0

  // Cache devices by assetCode AND by serialNumber to avoid N+1 queries.
  // SERIAL-FIRST (METER-LOOKUP-P0): the CSV column might contain either the
  // internal assetCode or the manufacturer serial. We fetch by both, build
  // two maps, and look up by assetCode first then serial as fallback.
  const identifiers = new Set<string>()
  for (const row of rows) {
    const ac = toStr(row[iAsset])
    if (ac) identifiers.add(ac)
  }
  const devices = await db.device.findMany({
    where: {
      OR: [
        { assetCode: { in: Array.from(identifiers) } },
        { serialNumber: { in: Array.from(identifiers) } },
      ],
    },
    select: {
      id: true,
      assetCode: true,
      serialNumber: true,
      lastMeterBw: true,
      lastMeterColor: true,
    },
  })
  const deviceByCode = new Map(devices.map((d) => [d.assetCode, d]))
  const deviceBySerial = new Map<string, typeof devices[number]>()
  for (const d of devices) {
    if (d.serialNumber) deviceBySerial.set(d.serialNumber, d)
  }

  // Track which devices need their last-meter values persisted.
  const updatesByDeviceId = new Map<string, { bw: number; color: number }>()

  // ── Phase 1: validation (no DB writes). ──
  // P1 FIX (AUDIT-FINDINGS-FIX-018): previously each `db.meterReading.create`
  // and `db.device.update` ran in its own implicit transaction, so a failure
  // midway left torn state (some meterReadings committed, some devices'
  // lastMeterBw/lastMeterColor stale). Now we validate every row first, then
  // wrap all the writes in a single `getBaseClient().$transaction` so partial failure
  // rolls back atomically.
  const readingsToInsert: Array<{
    deviceId: string
    assetCode: string
    readingDate: string
    readingMonth: string
    meterBw: number
    meterColor: number
    pagesBw: number
    pagesColor: number
    prevMeterBw: number
    prevMeterColor: number
    // MeterReading.readBy / remark are nullable columns, and `toStr()` returns
    // `string | null` for blank cells — so these must be nullable here too.
    readBy: string | null
    remark: string | null
    rowNum: number
  }> = []

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    const rowNum = r + 2
    const assetCode = toStr(row[iAsset])
    const readingDate = toStr(row[iDate])

    if (!assetCode) {
      errors.push({ row: rowNum, message: 'ไม่มีรหัสอุปกรณ์ (assetCode)' })
      continue
    }
    if (!readingDate) {
      errors.push({
        row: rowNum,
        message: `ไม่มีวันที่จด (readingDate) — assetCode=${assetCode}`,
      })
      continue
    }
    const device = deviceByCode.get(assetCode) ?? (assetCode ? deviceBySerial.get(assetCode) : undefined)
    if (!device) {
      errors.push({
        row: rowNum,
        message: `ไม่พบอุปกรณ์ในระบบ (ลองทั้ง assetCode และ serialNumber): ${assetCode}`,
      })
      continue
    }

    const meterBw = toInt(row[iBw], 0)
    const meterColor = toInt(row[iColor], 0)
    // Use the latest known prev value (either the original device value or
    // the value set by a previous row in this same file).
    const latest = updatesByDeviceId.get(device.id)
    const prevMeterBw = latest ? latest.bw : (device.lastMeterBw ?? 0)
    const prevMeterColor = latest ? latest.color : (device.lastMeterColor ?? 0)
    const pagesBw = Math.max(0, meterBw - prevMeterBw)
    const pagesColor = Math.max(0, meterColor - prevMeterColor)
    const readingMonth = readingDate.slice(0, 7) // YYYY-MM

    readingsToInsert.push({
      deviceId: device.id,
      // Always persist the canonical assetCode (NOT the user-input identifier,
      // which may have been the serial).
      assetCode: device.assetCode,
      readingDate,
      readingMonth,
      meterBw,
      meterColor,
      pagesBw,
      pagesColor,
      prevMeterBw,
      prevMeterColor,
      readBy: toStr(row[iReadBy]),
      remark: toStr(row[iRemark]),
      rowNum,
    })
    // Remember the new last-meter so the next row for this device sees it.
    updatesByDeviceId.set(device.id, { bw: meterBw, color: meterColor })
  }

  // ── Phase 2: writes (single transaction). ──
  // All `meterReading.create` calls + the trailing `device.update` calls run
  // inside one Prisma transaction. If any write fails, the entire batch
  // rolls back — no torn state.
  if (readingsToInsert.length > 0) {
    try {
      await getBaseClient().$transaction(async (tx) => {
        for (const r of readingsToInsert) {
          await tx.meterReading.create({
            data: {
              deviceId: r.deviceId,
              assetCode: r.assetCode,
              readingDate: r.readingDate,
              readingMonth: r.readingMonth,
              meterBw: r.meterBw,
              meterColor: r.meterColor,
              pagesBw: r.pagesBw,
              pagesColor: r.pagesColor,
              prevMeterBw: r.prevMeterBw,
              prevMeterColor: r.prevMeterColor,
              readingType: 'MONTHLY',
              readBy: r.readBy,
              remark: r.remark,
            },
          })
          processed++
        }

        // Persist the updated last-meter values back to the device rows
        // (inside the same transaction so they commit/roll back atomically
        // with the meterReadings).
        for (const [deviceId, val] of updatesByDeviceId) {
          await tx.device.update({
            where: { id: deviceId },
            data: { lastMeterBw: val.bw, lastMeterColor: val.color },
          })
        }
      })
    } catch (e) {
      console.error('importMeterReadings transaction error', e)
      // Transaction rolled back — nothing was committed. Surface a clear
      // error so the caller knows the import failed wholesale (rather than
      // the previous partial-success behaviour that left torn state).
      errors.push({
        row: 0,
        message:
          (e instanceof Error ? e.message : 'DB error (meter-reading)') +
          ` — transaction rolled back; 0/${readingsToInsert.length} rows committed`,
      })
      processed = 0
    }
  }

  return { processed, errors }
}

async function importMasterData(
  rows: string[][],
  headers: string[],
): Promise<{ processed: number; errors: ImportError[] }> {
  const idx = (name: string) =>
    headers.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase())
  const iCategory = idx('category')
  const iCode = idx('code')
  const iLabel = idx('label')
  const iParent = idx('parentRef')
  const iSite = idx('siteCode')

  const errors: ImportError[] = []
  let processed = 0

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    const rowNum = r + 2
    const category = toStr(row[iCategory])
    const code = toStr(row[iCode])
    const label = toStr(row[iLabel])

    if (!category) {
      errors.push({ row: rowNum, message: 'ไม่มีหมวดหมู่ (category)' })
      continue
    }
    if (!code) {
      errors.push({ row: rowNum, message: 'ไม่มีรหัส (code)' })
      continue
    }
    if (!label) {
      errors.push({
        row: rowNum,
        message: `ไม่มีชื่อแสดง (label) — code=${code}`,
      })
      continue
    }

    try {
      await db.masterItem.create({
        data: {
          category,
          code,
          label,
          parentRef: toStr(row[iParent]),
          siteCode: toStr(row[iSite]),
        },
      })
      processed++
    } catch (e) {
      console.error('importMasterData create error', e)
      errors.push({
        row: rowNum,
        message: e instanceof Error ? e.message : 'DB error (master-data)',
      })
    }
  }
  return { processed, errors }
}

function jobTypeLabel(t: JobType): string {
  switch (t) {
    case 'device':
      return 'อุปกรณ์'
    case 'work-order':
      return 'ใบแจ้งซ่อม'
    case 'stock':
      return 'สินค้าคงคลัง'
    case 'meter-reading':
      return 'การจดมิเตอร์'
    case 'master-data':
      return 'ข้อมูลมาตรฐาน'
    default:
      return t
  }
}

// ============================================================
// APPS-SCRIPT IMPORTERS — ดึง CSV จากระบบเก่าทั้ง 3 แอป
// ============================================================

interface AppsScriptResult {
  processed: number
  errors: ImportError[]
  warnings: string[]
  unmappedColumns: string[]
}

const emptyResult = (): AppsScriptResult => ({
  processed: 0,
  errors: [],
  warnings: [],
  unmappedColumns: [],
})

// ── IT-Asset: All_Devices → Device ─────────────────────────
async function importAppsScriptDevices(
  objects: Record<string, string>[],
): Promise<AppsScriptResult> {
  const result = emptyResult()
  const mapping = FIELD_MAPPINGS.device
  const seen = new Set<string>()
  const toInsert: Array<Record<string, unknown>> = []

  for (let r = 0; r < objects.length; r++) {
    const obj = objects[r]
    const rowNum = r + 2
    const { data, unmapped } = mapCsvRow(obj, mapping)
    if (unmapped.length) {
      result.warnings.push(
        `บรรทัด ${rowNum}: คอลัมน์ไม่ถูก map — ${unmapped.join(', ')}`,
      )
      for (const u of unmapped) {
        if (!result.unmappedColumns.includes(u)) result.unmappedColumns.push(u)
      }
    }

    const assetCode = (data.assetCode ?? '').trim()
    const brand = (data.brand ?? '').trim()
    const model = (data.model ?? '').trim()
    const type = (data.type ?? '').trim()

    if (!assetCode) {
      result.errors.push({ row: rowNum, message: 'ไม่มี asset_no' })
      continue
    }
    if (!brand || !model) {
      result.errors.push({
        row: rowNum,
        message: `ไม่มี brand/model (asset_no=${assetCode})`,
      })
      continue
    }
    if (!type) {
      result.errors.push({
        row: rowNum,
        message: `ไม่มี device_type (asset_no=${assetCode})`,
      })
      continue
    }
    if (seen.has(assetCode)) {
      result.errors.push({ row: rowNum, message: `รหัสซ้ำในไฟล์: ${assetCode}` })
      continue
    }
    seen.add(assetCode)

    // Status mapping
    let status = (data.status ?? 'active').trim()
    const lower = status.toLowerCase()
    if (STATUS_MAPPINGS.device[status]) {
      status = STATUS_MAPPINGS.device[status]
    } else if (STATUS_MAPPINGS.device[lower]) {
      status = STATUS_MAPPINGS.device[lower]
    } else if (
      !['active', 'spare', 'repair', 'disposed', 'in_stock'].includes(status)
    ) {
      status = 'active'
    }

    toInsert.push({
      assetCode,
      name: `${brand} ${model}`, // legacy ไม่มี name column → derive
      brand,
      model,
      type,
      serialNumber: data.serialNumber || null,
      status,
      site: data.site || 'HQ',
      department: data.department || null,
      departmentCode: data.departmentCode || null,
      location: data.location || null,
      building: data.building || null,
      floor: data.floor || null,
      ip: data.ip || null,
      mac: data.mac || null,
      remoteId: data.remoteId || null,
      purchaseDate: parseDate(data.purchaseDate),
      warrantyEnd:
        parseDate(data.warrantyEnd) ||
        parseDate((data as Record<string, string>).uninstall_date ?? ''),
      vendor: data.vendor || null,
      remark: data.remark || null,
      costCenter: data.costCenter || null,
      deviceGroup: data.deviceGroup || null,
      displayLabel: data.displayLabel || null,
      meterRequired: parseBool(data.meterRequired),
      meterMode: data.meterMode || null,
      updatedBy: data.updatedBy || 'apps-script-migration',
    })
  }

  if (toInsert.length === 0) return result

  // Skip existing assetCodes (no update-on-conflict for migration safety)
  const existing = await db.device.findMany({
    where: { assetCode: { in: toInsert.map((r) => r.assetCode as string) } },
    select: { assetCode: true },
  })
  const existingSet = new Set(existing.map((d) => d.assetCode))
  const filtered = toInsert.filter((r) => {
    if (existingSet.has(r.assetCode as string)) {
      result.errors.push({
        row: 0,
        message: `มีอยู่แล้วในระบบ: ${r.assetCode}`,
      })
      return false
    }
    return true
  })

  if (filtered.length === 0) return result

  try {
    const r = await db.device.createMany({
      data: filtered.map((r) => ({
        assetCode: r.assetCode as string,
        name: r.name as string,
        brand: r.brand as string,
        model: r.model as string,
        type: r.type as string,
        serialNumber: r.serialNumber as string | null,
        status: r.status as string,
        site: r.site as string,
        department: r.department as string | null,
        departmentCode: r.departmentCode as string | null,
        location: r.location as string | null,
        building: r.building as string | null,
        floor: r.floor as string | null,
        ip: r.ip as string | null,
        mac: r.mac as string | null,
        remoteId: r.remoteId as string | null,
        purchaseDate: r.purchaseDate as string | null,
        warrantyEnd: r.warrantyEnd as string | null,
        vendor: r.vendor as string | null,
        remark: r.remark as string | null,
        costCenter: r.costCenter as string | null,
        deviceGroup: r.deviceGroup as string | null,
        displayLabel: r.displayLabel as string | null,
        meterRequired: r.meterRequired as boolean,
        meterMode: r.meterMode as string | null,
        updatedBy: r.updatedBy as string,
      })),
    })
    result.processed = r.count
  } catch (e) {
    console.error('importAppsScriptDevices error', e)
    result.errors.push({
      row: 0,
      message: e instanceof Error ? e.message : 'DB error (apps-script device)',
    })
  }
  return result
}

// ── IT-Asset: Meter_Readings → MeterReading ─────────────────
async function importAppsScriptMeters(
  objects: Record<string, string>[],
): Promise<AppsScriptResult> {
  const result = emptyResult()
  const mapping = FIELD_MAPPINGS.meterReading

  // Collect distinct asset_no values for the lookup
  const codes = new Set<string>()
  for (const obj of objects) {
    const c = (obj.asset_no ?? obj.assetNo ?? '').trim()
    if (c) codes.add(c)
  }
  const devices = await db.device.findMany({
    where: { assetCode: { in: Array.from(codes) } },
    select: { id: true, assetCode: true, lastMeterBw: true, lastMeterColor: true },
  })
  const byCode = new Map(devices.map((d) => [d.assetCode, d]))
  const updatesByDevice = new Map<string, { bw: number; color: number }>()

  for (let r = 0; r < objects.length; r++) {
    const obj = objects[r]
    const rowNum = r + 2
    const { data, unmapped } = mapCsvRow(obj, mapping)
    if (unmapped.length) {
      result.warnings.push(
        `บรรทัด ${rowNum}: คอลัมน์ไม่ถูก map — ${unmapped.join(', ')}`,
      )
      for (const u of unmapped) {
        if (!result.unmappedColumns.includes(u)) result.unmappedColumns.push(u)
      }
    }

    const assetCode = (data.deviceId ?? '').trim() // mapped from asset_no
    const readingDate = parseDate(data.readingDate)
    if (!assetCode) {
      result.errors.push({ row: rowNum, message: 'ไม่มี asset_no' })
      continue
    }
    if (!readingDate) {
      result.errors.push({
        row: rowNum,
        message: `ไม่มี/รูปแบบวันที่ผิด (asset_no=${assetCode})`,
      })
      continue
    }
    const device = byCode.get(assetCode)
    if (!device) {
      result.errors.push({
        row: rowNum,
        message: `ไม่พบอุปกรณ์ในระบบ: ${assetCode}`,
      })
      continue
    }

    const meterBw = toIntLib(data.meterBw, 0)
    const meterColor = toIntLib(data.meterColor, 0)
    const prevMeterBw =
      data.prevMeterBw !== undefined && data.prevMeterBw !== ''
        ? toIntLib(data.prevMeterBw, 0)
        : (updatesByDevice.get(device.id)?.bw ?? device.lastMeterBw ?? 0)
    const prevMeterColor =
      data.prevMeterColor !== undefined && data.prevMeterColor !== ''
        ? toIntLib(data.prevMeterColor, 0)
        : (updatesByDevice.get(device.id)?.color ?? device.lastMeterColor ?? 0)
    const pagesBw =
      data.pagesBw !== undefined && data.pagesBw !== ''
        ? toIntLib(data.pagesBw, 0)
        : Math.max(0, meterBw - prevMeterBw)
    const pagesColor =
      data.pagesColor !== undefined && data.pagesColor !== ''
        ? toIntLib(data.pagesColor, 0)
        : Math.max(0, meterColor - prevMeterColor)

    try {
      await db.meterReading.create({
        data: {
          deviceId: device.id,
          readingDate,
          readingMonth: data.readingMonth || readingDate.slice(0, 7),
          meterBw,
          meterColor,
          pagesBw,
          pagesColor,
          prevMeterBw,
          prevMeterColor,
          readingType: data.readingType || 'MONTHLY',
          readBy: data.readBy || null,
          remark: data.remark || null,
          siteAtReading: data.siteAtReading || null,
          buildingAtReading: data.buildingAtReading || null,
          floorAtReading: data.floorAtReading || null,
          departmentAtReading: data.departmentAtReading || null,
        },
      })
      updatesByDevice.set(device.id, { bw: meterBw, color: meterColor })
      result.processed++
    } catch (e) {
      console.error('importAppsScriptMeters create error', e)
      result.errors.push({
        row: rowNum,
        message: e instanceof Error ? e.message : 'DB error (apps-script meter)',
      })
    }
  }

  // Persist last-meter values back to devices
  for (const [deviceId, val] of updatesByDevice) {
    try {
      await db.device.update({
        where: { id: deviceId },
        data: { lastMeterBw: val.bw, lastMeterColor: val.color },
      })
    } catch (e) {
      console.error('importAppsScriptMeters device update error', e)
    }
  }
  return result
}

// ── IT-Asset: Location_History → DeviceTransfer ─────────────
async function importAppsScriptTransfers(
  objects: Record<string, string>[],
): Promise<AppsScriptResult> {
  const result = emptyResult()
  const mapping = FIELD_MAPPINGS.deviceTransfer

  const codes = new Set<string>()
  for (const obj of objects) {
    const c = (obj.Asset_No ?? obj.asset_no ?? '').trim()
    if (c) codes.add(c)
  }
  const devices = await db.device.findMany({
    where: { assetCode: { in: Array.from(codes) } },
    select: { id: true, assetCode: true },
  })
  const byCode = new Map(devices.map((d) => [d.assetCode, d.id]))

  for (let r = 0; r < objects.length; r++) {
    const obj = objects[r]
    const rowNum = r + 2
    const { data, unmapped } = mapCsvRow(obj, mapping)
    if (unmapped.length) {
      result.warnings.push(
        `บรรทัด ${rowNum}: คอลัมน์ไม่ถูก map — ${unmapped.join(', ')}`,
      )
      for (const u of unmapped) {
        if (!result.unmappedColumns.includes(u)) result.unmappedColumns.push(u)
      }
    }
    const assetCode = (data.deviceId ?? '').trim()
    const transferDate = parseDate(data.transferDate)
    if (!assetCode) {
      result.errors.push({ row: rowNum, message: 'ไม่มี Asset_No' })
      continue
    }
    if (!transferDate) {
      result.errors.push({
        row: rowNum,
        message: `ไม่มี/รูปแบบวันที่ผิด (Asset_No=${assetCode})`,
      })
      continue
    }
    const deviceId = byCode.get(assetCode)
    if (!deviceId) {
      result.errors.push({
        row: rowNum,
        message: `ไม่พบอุปกรณ์ในระบบ: ${assetCode}`,
      })
      continue
    }

    try {
      await db.deviceTransfer.create({
        data: {
          deviceId,
          fromSite: data.fromSite || null,
          toSite: data.toSite || '',
          // DeviceTransfer column names are fromDepartment / toDepartment /
          // fromDepartmentCode / toDepartmentCode — the Apps-Script payload
          // uses the shorter fromDept/toDept keys.
          fromDepartment: data.fromDept || null,
          toDepartment: data.toDept || null,
          fromDepartmentCode: data.fromDeptCode || null,
          toDepartmentCode: data.toDeptCode || null,
          reason: data.reason || null,
          transferDate,
          movedBy: data.movedBy || null,
        },
      })
      result.processed++
    } catch (e) {
      console.error('importAppsScriptTransfers error', e)
      result.errors.push({
        row: rowNum,
        message: e instanceof Error ? e.message : 'DB error (apps-script transfer)',
      })
    }
  }
  return result
}

// ── IT-Asset: User_Permissions → User ───────────────────────
async function importAppsScriptUsers(
  objects: Record<string, string>[],
): Promise<AppsScriptResult> {
  const result = emptyResult()
  const mapping = FIELD_MAPPINGS.user
  const seen = new Set<string>()

  for (let r = 0; r < objects.length; r++) {
    const obj = objects[r]
    const rowNum = r + 2
    const { data, unmapped } = mapCsvRow(obj, mapping)
    if (unmapped.length) {
      result.warnings.push(
        `บรรทัด ${rowNum}: คอลัมน์ไม่ถูก map — ${unmapped.join(', ')}`,
      )
      for (const u of unmapped) {
        if (!result.unmappedColumns.includes(u)) result.unmappedColumns.push(u)
      }
    }
    const email = (data.email ?? '').trim()
    if (!email) {
      result.errors.push({ row: rowNum, message: 'ไม่มี Email' })
      continue
    }
    if (seen.has(email.toLowerCase())) {
      result.errors.push({ row: rowNum, message: `Email ซ้ำในไฟล์: ${email}` })
      continue
    }
    seen.add(email.toLowerCase())

    try {
      const existing = await db.user.findUnique({ where: { email } })
      if (existing) {
        result.errors.push({
          row: 0,
          message: `มีผู้ใช้อยู่แล้ว: ${email}`,
        })
        continue
      }
      await db.user.create({
        data: {
          email,
          username: data.username || null,
          name: data.name || null,
          role: data.role || 'viewer',
          active: parseBool(data.active),
          passwordHash: data.passwordHash || null,
          allowedSites: data.allowedSites || null,
          lastLoginAt: parseDate(data.lastLoginAt),
        },
      })
      result.processed++
    } catch (e) {
      console.error('importAppsScriptUsers error', e)
      result.errors.push({
        row: rowNum,
        message: e instanceof Error ? e.message : 'DB error (apps-script user)',
      })
    }
  }
  return result
}

// ── IT-Asset: App_Settings → AppSetting ─────────────────────
async function importAppsScriptSettings(
  objects: Record<string, string>[],
): Promise<AppsScriptResult> {
  const result = emptyResult()
  const mapping = FIELD_MAPPINGS.appSetting
  for (let r = 0; r < objects.length; r++) {
    const obj = objects[r]
    const rowNum = r + 2
    const { data, unmapped } = mapCsvRow(obj, mapping)
    if (unmapped.length) {
      result.warnings.push(
        `บรรทัด ${rowNum}: คอลัมน์ไม่ถูก map — ${unmapped.join(', ')}`,
      )
      for (const u of unmapped) {
        if (!result.unmappedColumns.includes(u)) result.unmappedColumns.push(u)
      }
    }
    const key = (data.key ?? '').trim()
    const value = (data.value ?? '').trim()
    if (!key) {
      result.errors.push({ row: rowNum, message: 'ไม่มี Key' })
      continue
    }
    try {
      await db.appSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
      result.processed++
    } catch (e) {
      console.error('importAppsScriptSettings error', e)
      result.errors.push({
        row: rowNum,
        message: e instanceof Error ? e.message : 'DB error (apps-script setting)',
      })
    }
  }
  return result
}

// ── IT-Asset: Master_Items → MasterItem ─────────────────────
async function importAppsScriptMaster(
  objects: Record<string, string>[],
): Promise<AppsScriptResult> {
  const result = emptyResult()
  const mapping = FIELD_MAPPINGS.masterItem
  for (let r = 0; r < objects.length; r++) {
    const obj = objects[r]
    const rowNum = r + 2
    const { data, unmapped } = mapCsvRow(obj, mapping)
    if (unmapped.length) {
      result.warnings.push(
        `บรรทัด ${rowNum}: คอลัมน์ไม่ถูก map — ${unmapped.join(', ')}`,
      )
      for (const u of unmapped) {
        if (!result.unmappedColumns.includes(u)) result.unmappedColumns.push(u)
      }
    }
    const category = (data.category ?? '').trim()
    const code = (data.code ?? '').trim()
    const label = (data.label ?? '').trim()
    if (!category) {
      result.errors.push({ row: rowNum, message: 'ไม่มี CategoryKey' })
      continue
    }
    if (!code) {
      result.errors.push({ row: rowNum, message: 'ไม่มี ItemID' })
      continue
    }
    if (!label) {
      result.errors.push({
        row: rowNum,
        message: `ไม่มี Value (code=${code})`,
      })
      continue
    }
    try {
      await db.masterItem.create({
        data: {
          category,
          code,
          label,
          parentRef: data.parentRef || null,
          displayLabel: data.displayLabel || null,
          siteCode: data.siteCode || null,
          active: parseBool(data.active),
        },
      })
      result.processed++
    } catch (e) {
      console.error('importAppsScriptMaster error', e)
      result.errors.push({
        row: rowNum,
        message: e instanceof Error ? e.message : 'DB error (apps-script master)',
      })
    }
  }
  return result
}

// ── IT-Asset: Site_Attributes → Site + SiteRate ─────────────
async function importAppsScriptSites(
  objects: Record<string, string>[],
): Promise<AppsScriptResult> {
  const result = emptyResult()
  const mapping = FIELD_MAPPINGS.site
  for (let r = 0; r < objects.length; r++) {
    const obj = objects[r]
    const rowNum = r + 2
    const { data, unmapped } = mapCsvRow(obj, mapping)
    if (unmapped.length) {
      result.warnings.push(
        `บรรทัด ${rowNum}: คอลัมน์ไม่ถูก map — ${unmapped.join(', ')}`,
      )
      for (const u of unmapped) {
        if (!result.unmappedColumns.includes(u)) result.unmappedColumns.push(u)
      }
    }
    const code = (data.code ?? '').trim()
    const name = (data.name ?? '').trim()
    if (!code) {
      result.errors.push({ row: rowNum, message: 'ไม่มี Site_Code' })
      continue
    }
    if (!name) {
      result.errors.push({
        row: rowNum,
        message: `ไม่มี SiteName (code=${code})`,
      })
      continue
    }
    try {
      await db.site.upsert({
        where: { code },
        create: {
          code,
          name,
          phone: data.phone || null,
        },
        update: { name, phone: data.phone || null },
      })
      // Upsert site rate (only create-on-miss; do not overwrite existing)
      const bwRate = toFloatLib(data.bwRate)
      const colorRate = toFloatLib(data.colorRate)
      if (bwRate !== null || colorRate !== null) {
        const existing = await db.siteRate.findFirst({
          where: { siteCode: code },
        })
        if (!existing) {
          await db.siteRate.create({
            data: {
              siteCode: code,
              bwRate: bwRate ?? 0.5,
              colorRate: colorRate ?? 2.0,
            },
          })
        }
      }
      result.processed++
    } catch (e) {
      console.error('importAppsScriptSites error', e)
      result.errors.push({
        row: rowNum,
        message: e instanceof Error ? e.message : 'DB error (apps-script site)',
      })
    }
  }
  return result
}

// ── Stock: Products → StockItem ─────────────────────────────
async function importAppsScriptStockItems(
  objects: Record<string, string>[],
): Promise<AppsScriptResult> {
  const result = emptyResult()
  const mapping = FIELD_MAPPINGS.stockItem
  const seen = new Set<string>()
  const toInsert: Array<Record<string, unknown>> = []

  for (let r = 0; r < objects.length; r++) {
    const obj = objects[r]
    const rowNum = r + 2
    const { data, unmapped } = mapCsvRow(obj, mapping)
    if (unmapped.length) {
      result.warnings.push(
        `บรรทัด ${rowNum}: คอลัมน์ไม่ถูก map — ${unmapped.join(', ')}`,
      )
      for (const u of unmapped) {
        if (!result.unmappedColumns.includes(u)) result.unmappedColumns.push(u)
      }
    }
    const productCode = (data.productCode ?? '').trim()
    const productName = (data.productName ?? '').trim()
    if (!productCode) {
      result.errors.push({ row: rowNum, message: 'ไม่มี ProductCode' })
      continue
    }
    if (!productName) {
      result.errors.push({
        row: rowNum,
        message: `ไม่มี ProductName (code=${productCode})`,
      })
      continue
    }
    if (seen.has(productCode)) {
      result.errors.push({
        row: rowNum,
        message: `รหัสซ้ำในไฟล์: ${productCode}`,
      })
      continue
    }
    seen.add(productCode)

    // Active mapping: Active/Inactive → true/false
    let active = true
    if (data.active) {
      const v = STATUS_MAPPINGS.stockItem[data.active]
      if (v !== undefined) active = v === 'true'
      else active = parseBool(data.active)
    }

    toInsert.push({
      productCode,
      productName,
      unit: data.unit || 'ชิ้น',
      quantity: toIntLib(data.quantity, 0),
      minQuantity: toIntLib(data.minQuantity, 0),
      unitCost: toFloatLib(data.unitCost),
      active,
    })
  }

  if (toInsert.length === 0) return result

  const existing = await db.stockItem.findMany({
    where: { productCode: { in: toInsert.map((r) => r.productCode as string) } },
    select: { productCode: true },
  })
  const existingSet = new Set(existing.map((s) => s.productCode))
  const filtered = toInsert.filter((r) => {
    if (existingSet.has(r.productCode as string)) {
      result.errors.push({
        row: 0,
        message: `มีสินค้าอยู่แล้ว: ${r.productCode}`,
      })
      return false
    }
    return true
  })
  if (filtered.length === 0) return result

  try {
    const r = await db.stockItem.createMany({
      data: filtered.map((r) => ({
        productCode: r.productCode as string,
        productName: r.productName as string,
        unit: r.unit as string,
        quantity: r.quantity as number,
        minQuantity: r.minQuantity as number,
        unitCost: r.unitCost as number | null,
        active: r.active as boolean,
      })),
    })
    result.processed = r.count
  } catch (e) {
    console.error('importAppsScriptStockItems error', e)
    result.errors.push({
      row: 0,
      message: e instanceof Error ? e.message : 'DB error (apps-script stock-item)',
    })
  }
  return result
}

// ── Stock: StockIn / StockOut → StockTransaction ───────────
async function importAppsScriptStockTxns(
  objects: Record<string, string>[],
  type: 'IN' | 'OUT',
): Promise<AppsScriptResult> {
  const result = emptyResult()
  const mapping = type === 'IN' ? FIELD_MAPPINGS.stockIn : FIELD_MAPPINGS.stockOut

  // Collect distinct product codes for lookup
  const codes = new Set<string>()
  for (const obj of objects) {
    const c = (obj.ProductCode ?? obj.productCode ?? '').trim()
    if (c) codes.add(c)
  }
  const items = await db.stockItem.findMany({
    where: { productCode: { in: Array.from(codes) } },
    select: { id: true, productCode: true, quantity: true },
  })
  const byCode = new Map(items.map((i) => [i.productCode, i]))

  // Also collect WorkOrder numbers (StockOut may reference them)
  let woByNumber: Map<string, string> | null = null
  if (type === 'OUT') {
    const woNumbers = new Set<string>()
    for (const obj of objects) {
      const w = (obj.WorkOrderNo ?? obj.workOrderNo ?? '').trim()
      if (w) woNumbers.add(w)
    }
    if (woNumbers.size > 0) {
      const wos = await db.workOrder.findMany({
        where: { woNumber: { in: Array.from(woNumbers) } },
        select: { id: true, woNumber: true },
      })
      woByNumber = new Map(
        wos
          .filter((w) => w.woNumber !== null)
          .map((w) => [w.woNumber as string, w.id]),
      )
    }
  }

  for (let r = 0; r < objects.length; r++) {
    const obj = objects[r]
    const rowNum = r + 2
    const { data, unmapped } = mapCsvRow(obj, mapping)
    if (unmapped.length) {
      result.warnings.push(
        `บรรทัด ${rowNum}: คอลัมน์ไม่ถูก map — ${unmapped.join(', ')}`,
      )
      for (const u of unmapped) {
        if (!result.unmappedColumns.includes(u)) result.unmappedColumns.push(u)
      }
    }
    const productCode = (data.stockItemId ?? '').trim() // mapped from ProductCode
    const txnDate = parseDate(data.txnDate)
    if (!productCode) {
      result.errors.push({ row: rowNum, message: 'ไม่มี ProductCode' })
      continue
    }
    if (!txnDate) {
      result.errors.push({
        row: rowNum,
        message: `ไม่มี/รูปแบบ Date ผิด (code=${productCode})`,
      })
      continue
    }
    const item = byCode.get(productCode)
    if (!item) {
      result.errors.push({
        row: rowNum,
        message: `ไม่พบสินค้าในระบบ: ${productCode}`,
      })
      continue
    }

    const qty = toIntLib(data.quantity, 0)
    // Compute balanceAfter based on current quantity
    const newBalance =
      type === 'IN' ? item.quantity + qty : Math.max(0, item.quantity - qty)
    // Track updates
    item.quantity = newBalance

    let workOrderId: string | null = null
    if (type === 'OUT' && woByNumber && data.workOrderId) {
      workOrderId = woByNumber.get(data.workOrderId) ?? null
    }

    try {
      await db.stockTransaction.create({
        data: {
          txnNumber: data.txnNumber || null,
          stockItemId: item.id,
          type,
          quantity: qty,
          balanceAfter: newBalance,
          reason: data.reason || null,
          workOrderId,
          cost: type === 'IN' ? toFloatLib(data.cost) : null,
          vendor: type === 'IN' ? data.vendor || null : null,
          txnDate,
          performedBy: data.performedBy || null,
          remark: data.remark || null,
        },
      })
      // Update stock item quantity
      await db.stockItem.update({
        where: { id: item.id },
        data: { quantity: newBalance },
      })
      result.processed++
    } catch (e) {
      console.error('importAppsScriptStockTxns error', e)
      result.errors.push({
        row: rowNum,
        message: e instanceof Error ? e.message : 'DB error (apps-script stock-txn)',
      })
    }
  }
  return result
}

// ── Stock: PurchaseOrders → PurchaseOrder + Items ───────────
async function importAppsScriptPOs(
  objects: Record<string, string>[],
): Promise<AppsScriptResult> {
  const result = emptyResult()
  const mapping = FIELD_MAPPINGS.purchaseOrder

  const codes = new Set<string>()
  for (const obj of objects) {
    const c = (obj.ProductCode ?? obj.productCode ?? '').trim()
    if (c) codes.add(c)
  }
  const items = await db.stockItem.findMany({
    where: { productCode: { in: Array.from(codes) } },
    select: { id: true, productCode: true },
  })
  const byCode = new Map(items.map((i) => [i.productCode, i.id]))

  // Group rows by poNumber, then create PO + items
  const poGroups = new Map<
    string,
    {
      orderDate: string
      supplier: string | null
      status: string
      totalValue: number | null
      createdBy: string | null
      lines: Array<{
        productCode: string
        stockItemId: string | null
        quantityOrdered: number
        unitPrice: number | null
        totalValue: number | null
        quantityReceived: number
        rowNum: number
        unmapped: string[]
      }>
    }
  >()

  for (let r = 0; r < objects.length; r++) {
    const obj = objects[r]
    const rowNum = r + 2
    const { data, unmapped } = mapCsvRow(obj, mapping)
    if (unmapped.length) {
      result.warnings.push(
        `บรรทัด ${rowNum}: คอลัมน์ไม่ถูก map — ${unmapped.join(', ')}`,
      )
      for (const u of unmapped) {
        if (!result.unmappedColumns.includes(u)) result.unmappedColumns.push(u)
      }
    }
    const poNumber = (data.poNumber ?? '').trim()
    const orderDate = parseDate(data.orderDate)
    if (!poNumber) {
      result.errors.push({ row: rowNum, message: 'ไม่มี PurchaseOrderNo' })
      continue
    }
    if (!orderDate) {
      result.errors.push({
        row: rowNum,
        message: `ไม่มี/รูปแบบ OrderDate ผิด (PO=${poNumber})`,
      })
      continue
    }
    const productCode = (data.stockItemId ?? '').trim()
    const stockItemId = productCode ? byCode.get(productCode) ?? null : null
    if (productCode && !stockItemId) {
      result.errors.push({
        row: rowNum,
        message: `ไม่พบสินค้าในระบบ: ${productCode}`,
      })
    }

    let status = (data.status || 'open').trim()
    if (STATUS_MAPPINGS.purchaseOrder[status]) {
      status = STATUS_MAPPINGS.purchaseOrder[status]
    } else if (
      !['open', 'partial', 'received', 'cancelled'].includes(status)
    ) {
      status = 'open'
    }

    let group = poGroups.get(poNumber)
    if (!group) {
      group = {
        orderDate,
        supplier: data.supplier || null,
        status,
        totalValue: toFloatLib(data.totalValue),
        createdBy: data.createdBy || null,
        lines: [],
      }
      poGroups.set(poNumber, group)
    }
    group.lines.push({
      productCode,
      stockItemId: stockItemId ?? null,
      quantityOrdered: toIntLib(data.quantityOrdered, 0),
      unitPrice: toFloatLib(data.unitPrice),
      totalValue: toFloatLib(data.totalValue),
      quantityReceived: toIntLib(data.quantityReceived, 0),
      rowNum,
      unmapped,
    })
  }

  for (const [poNumber, g] of poGroups) {
    try {
      // PurchaseOrder.poNumber is nullable and NOT @unique, so Prisma's `upsert`
      // cannot target it. Do an explicit lookup instead: update the first
      // matching PO, or create one when none exists.
      const existingPo = await db.purchaseOrder.findFirst({
        where: { poNumber },
      })
      const po = existingPo
        ? await db.purchaseOrder.update({
            where: { id: existingPo.id },
            data: {
              orderDate: g.orderDate,
              supplier: g.supplier,
              status: g.status,
              totalValue: g.totalValue,
            },
          })
        : await db.purchaseOrder.create({
            data: {
              poNumber,
              orderDate: g.orderDate,
              supplier: g.supplier,
              status: g.status,
              totalValue: g.totalValue,
              createdBy: g.createdBy,
            },
          })
      // Insert line items (skip ones with missing stockItem)
      for (const line of g.lines) {
        if (!line.stockItemId) continue
        try {
          await db.purchaseOrderItem.create({
            data: {
              purchaseOrderId: po.id,
              stockItemId: line.stockItemId,
              quantityOrdered: line.quantityOrdered,
              quantityReceived: line.quantityReceived,
              unitPrice: line.unitPrice,
              totalValue: line.totalValue,
            },
          })
          result.processed++
        } catch (e) {
          console.error('importAppsScriptPOs line error', e)
          result.errors.push({
            row: line.rowNum,
            message: e instanceof Error ? e.message : 'DB error (PO line item)',
          })
        }
      }
    } catch (e) {
      console.error('importAppsScriptPOs error', e)
      result.errors.push({
        row: 0,
        message: e instanceof Error ? e.message : 'DB error (apps-script PO)',
      })
    }
  }
  return result
}

// ── Services: WorkOrder (JSON-flattened CSV) → WorkOrder ────
async function importAppsScriptWorkOrders(
  objects: Record<string, string>[],
): Promise<AppsScriptResult> {
  const result = emptyResult()
  const mapping = FIELD_MAPPINGS.workOrder

  // Generate WO numbers in bulk
  const now = new Date()
  const ymd =
    `${now.getFullYear()}` +
    `${String(now.getMonth() + 1).padStart(2, '0')}` +
    `${String(now.getDate()).padStart(2, '0')}`
  const prefix = `WO-${ymd}-`
  const lastWo = await db.workOrder.findFirst({
    where: { woNumber: { startsWith: prefix } },
    orderBy: { woNumber: 'desc' },
    select: { woNumber: true },
  })
  let seq = lastWo?.woNumber
    ? parseInt(lastWo.woNumber.match(/(\d+)$/)?.[1] ?? '0', 10)
    : 0

  for (let r = 0; r < objects.length; r++) {
    const obj = objects[r]
    const rowNum = r + 2
    const { data, unmapped } = mapCsvRow(obj, mapping)
    if (unmapped.length) {
      result.warnings.push(
        `บรรทัด ${rowNum}: คอลัมน์ไม่ถูก map — ${unmapped.join(', ')}`,
      )
      for (const u of unmapped) {
        if (!result.unmappedColumns.includes(u)) result.unmappedColumns.push(u)
      }
    }

    const subject = (data.subject ?? '').trim()
    if (!subject) {
      result.errors.push({ row: rowNum, message: 'ไม่มี subject' })
      continue
    }

    // Status mapping: emoji-Thai → enum
    let status = (data.status || 'PENDING').trim()
    if (STATUS_MAPPINGS.workOrder[status]) {
      status = STATUS_MAPPINGS.workOrder[status]
    } else {
      // Try matching the bare Thai text (no emoji prefix)
      for (const [k, v] of Object.entries(STATUS_MAPPINGS.workOrder)) {
        if (status.includes(k)) {
          status = v
          break
        }
      }
    }
    if (
      ![
        'PENDING',
        'IN_PROGRESS',
        'WAITING_PARTS',
        'COMPLETED',
        'CANCELLED',
      ].includes(status)
    ) {
      status = 'PENDING'
    }

    const requestId = (data.requestId ?? '').trim()
    // P1-R6 fix: required-field validation — requestId is required
    if (!requestId) {
      result.errors.push({ row: rowNum, message: 'ไม่มี requestId (required field)' })
      continue
    }
    // Dedup: skip if requestId already in DB
    const existing = await db.workOrder.findFirst({
      where: { requestId },
      select: { id: true },
    })
    if (existing) {
      result.errors.push({
        row: 0,
        message: `มีใบงานอยู่แล้ว (request_id=${requestId})`,
      })
      continue
    }

    // P1-R6 fix: field mapping — siteCode from CSV (via mapping)
    const siteCode = (data.siteCode ?? '').trim() || null

    seq++
    const woNumber = `${prefix}${String(seq).padStart(3, '0')}`

    // Ensure woNumber uniqueness (collision → drop woNumber)
    let useWoNumber: string | null = woNumber
    const collision = await db.workOrder.findUnique({
      where: { woNumber },
      select: { id: true },
    })
    if (collision) useWoNumber = null

    try {
      const created = await db.workOrder.create({
        data: {
          woNumber: useWoNumber ?? undefined,
          requestId,
          siteCode, // P1-R6 fix: populate siteCode
          subject,
          building: data.building || null,
          location: data.location || null,
          details: data.details || null,
          priority: data.priority || 'ปกติ',
          reporterName: data.reporterName || null,
          tel: data.tel || null,
          employeeCode: data.employeeCode || null,
          submissionSource: data.submissionSource || 'guest',
          trackable: parseBool(data.trackable),
          externalMeta: data.externalMeta || null,
          picBefore: data.picBefore || null,
          picOnsite: data.picOnsite || null,
          picAfter: data.picAfter || null,
          status,
          acceptStatus: data.acceptStatus || null,
          assignedTo: data.assignedTo || null,
          assignedBy: data.assignedBy || null,
          assignedAt: parseDateTime(data.assignedAt),
          assignmentNote: data.assignmentNote || null,
          detailsAdmin: data.detailsAdmin || null,
          dateAdmin: data.dateAdmin || null,
          editUnlockActive: parseBool(data.editUnlockActive),
          editUnlockBy: data.editUnlockBy || null,
          editUnlockAt: parseDateTime(data.editUnlockAt),
          editUnlockNote: data.editUnlockNote || null,
          workCompletedAt: parseDateTime(data.workCompletedAt),
          closedAt: parseDateTime(data.closedAt),
          canceledAt: parseDateTime(data.canceledAt),
        },
      })
      result.processed++
      // P1-R6 fix: per-record AuditLog
      await logAudit(
        'WORK_ORDER_IMPORT',
        'WorkOrder',
        created.id,
        `Apps Script import สร้างใบงาน ${requestId}`,
        { source: 'apps-script-import', requestId, siteCode, subject },
        'system',
        siteCode,
      )
    } catch (e) {
      console.error('importAppsScriptWorkOrders error', e)
      result.errors.push({
        row: rowNum,
        message: e instanceof Error ? e.message : 'DB error (apps-script work-order)',
      })
    }
  }
  return result
}

// ============================================================
// Dispatcher — given (source, sheetId), call the right importer
// ============================================================
async function dispatchAppsScriptImport(
  _source: AppsScriptSource,
  sheetId: string,
  objects: Record<string, string>[],
): Promise<AppsScriptResult> {
  switch (sheetId) {
    case 'itam-device':
      return importAppsScriptDevices(objects)
    case 'itam-meter':
      return importAppsScriptMeters(objects)
    case 'itam-transfer':
      return importAppsScriptTransfers(objects)
    case 'itam-users':
      return importAppsScriptUsers(objects)
    case 'itam-settings':
      return importAppsScriptSettings(objects)
    case 'itam-master':
      return importAppsScriptMaster(objects)
    case 'itam-sites':
      return importAppsScriptSites(objects)
    case 'stock-products':
      return importAppsScriptStockItems(objects)
    case 'stock-in':
      return importAppsScriptStockTxns(objects, 'IN')
    case 'stock-out':
      return importAppsScriptStockTxns(objects, 'OUT')
    case 'stock-po':
      return importAppsScriptPOs(objects)
    case 'services-workorders':
      return importAppsScriptWorkOrders(objects)
    default:
      return {
        processed: 0,
        errors: [{ row: 0, message: `sheetId ไม่รองรับ: ${sheetId}` }],
        warnings: [],
        unmappedColumns: [],
      }
  }
}

// ============================================================
// POST /api/import  — multipart/form-data
//   • ถ้ามี field `source` → Apps Script legacy import
//   • ถ้าไม่มี → ใช้ jobType แบบเดิม
// ============================================================
// Heavy operation — needs longer timeout (Vercel Hobby: max 60s)
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('import')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'IMPORT_DATA')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const form = await req.formData()
    const file = form.get('file')
    const source = String(form.get('source') ?? '').trim() as
      | AppsScriptSource
      | ''
    const sheetId = String(form.get('sheetId') ?? '').trim()

    // ── Apps Script legacy import path ─────────────────────────
    if (source) {
      const validSources: AppsScriptSource[] = [
        'apps-script-itam',
        'apps-script-services',
        'apps-script-stock',
      ]
      if (!validSources.includes(source)) {
        return NextResponse.json(
          { error: `source ไม่ถูกต้อง (ได้รับ: "${source}")` },
          { status: 400 },
        )
      }
      // Validate sheetId is registered under this source
      const srcCfg = SOURCE_SHEET_REGISTRY[source]
      const sheetCfg = srcCfg.sheets.find((s) => s.id === sheetId)
      if (!sheetCfg) {
        return NextResponse.json(
          {
            error: `sheetId "${sheetId}" ไม่อยู่ใน source "${source}"`,
            availableSheets: srcCfg.sheets.map((s) => s.id),
          },
          { status: 400 },
        )
      }
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

      const lower = file.name.toLowerCase()
      if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        return NextResponse.json(
          { error: 'Apps Script import รองรับเฉพาะ .csv เท่านั้น' },
          { status: 400 },
        )
      }

      // Create ImportJob with jobType=`legacy:{sheetId}` so history
      // can show what kind of import it was.
      const jobTypeLabel = `legacy:${sheetId}`
      const job = await db.importJob.create({
        data: {
          jobType: jobTypeLabel,
          fileName: file.name,
          fileType: 'csv',
          status: 'processing',
          uploadedBy: 'system',
        },
      })

      const text = await file.text()
      const grid = parseCsvLib(text)
      if (grid.length < 2) {
        const errMsg =
          'ไฟล์ CSV ไม่มีข้อมูล (ต้องมีบรรทัดหัวคอลัมน์ + อย่างน้อย 1 แถว)'
        const updated = await db.importJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            errors: JSON.stringify([{ row: 0, message: errMsg }]),
            completedAt: new Date(),
          },
        })
        return NextResponse.json(
          { job: updated, error: errMsg },
          { status: 400 },
        )
      }

      const headers = grid[0].map((h) => h.trim())
      const dataRows = grid
        .slice(1)
        .filter((r) => !(r.length === 1 && r[0] === ''))
      const totalRows = dataRows.length

      // Convert rows to objects keyed by header
      const objects: Record<string, string>[] = dataRows.map((row) => {
        const obj: Record<string, string> = {}
        headers.forEach((h, idx) => {
          obj[h] = (row[idx] ?? '').trim()
        })
        return obj
      })

      let result: AppsScriptResult
      try {
        result = await dispatchAppsScriptImport(source, sheetId, objects)
      } catch (e) {
        console.error('POST /api/import — apps-script importer threw', e)
        const errMsg =
          e instanceof Error ? e.message : 'Apps Script importer error'
        const updated = await db.importJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            totalRows,
            processedRows: 0,
            errorRows: totalRows,
            errors: JSON.stringify([{ row: 0, message: errMsg }]),
            completedAt: new Date(),
          },
        })
        return NextResponse.json(
          { job: updated, error: errMsg },
          { status: 500 },
        )
      }

      const errorRows = totalRows - result.processed
      const status =
        result.processed === 0 && totalRows > 0 ? 'failed' : 'completed'

      // Combine errors and warnings (warnings stored as row=0 entries marked "warning")
      const allErrors: ImportError[] = [...result.errors]
      for (const w of result.warnings.slice(0, 50)) {
        allErrors.push({ row: 0, message: `[warning] ${w}` })
      }

      const updated = await db.importJob.update({
        where: { id: job.id },
        data: {
          status,
          totalRows,
          processedRows: result.processed,
          errorRows,
          errors:
            allErrors.length > 0
              ? JSON.stringify(allErrors.slice(0, 200))
              : null,
          completedAt: new Date(),
        },
      })

      await logAudit(
        'IMPORT_LEGACY',
        sheetCfg.model.toUpperCase(),
        job.id,
        `ดึงข้อมูลจากระบบเก่า (${srcCfg.label} → ${sheetCfg.label}): ${result.processed}/${totalRows} แถว (${file.name})`,
        {
          source,
          sheetId,
          fileName: file.name,
          totalRows,
          processed: result.processed,
          errorCount: result.errors.length,
          unmappedColumns: result.unmappedColumns,
          warnings: result.warnings.slice(0, 20),
        },
      )

      return NextResponse.json(
        {
          job: updated,
          summary: {
            source,
            sheetId,
            sheetLabel: sheetCfg.label,
            model: sheetCfg.model,
            totalRows,
            processedRows: result.processed,
            errorRows,
            warnings: result.warnings.slice(0, 50),
            unmappedColumns: result.unmappedColumns,
            expectedHeaders:
              TEMPLATE_HEADERS[sheetId as keyof typeof TEMPLATE_HEADERS],
            actualHeaders: headers,
          },
        },
        { status: 201 },
      )
    }

    // ── Original (manual) import path ──────────────────────────
    const jobType = String(form.get('jobType') ?? '').trim() as JobType

    if (!VALID_JOB_TYPES.has(jobType)) {
      return NextResponse.json(
        { error: `jobType ไม่ถูกต้อง (ได้รับ: "${jobType}")` },
        { status: 400 },
      )
    }
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

    const fileName = file.name
    const lower = fileName.toLowerCase()
    const isCsv = lower.endsWith('.csv') || lower.endsWith('.txt')
    const isXlsx = lower.endsWith('.xlsx') || lower.endsWith('.xls')
    const fileType = isCsv ? 'csv' : isXlsx ? 'excel' : 'csv'

    // Create the ImportJob row first with status='processing'.
    const job = await db.importJob.create({
      data: {
        jobType,
        fileName,
        fileType,
        status: 'processing',
        uploadedBy: 'system',
      },
    })

    // Excel is accepted but not yet parsed — surface a friendly message.
    if (isXlsx) {
      const errMsg = 'กรุณาใช้ไฟล์ CSV (ยังไม่รองรับ .xlsx ในขณะนี้)'
      const updated = await db.importJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          errors: JSON.stringify([{ row: 0, message: errMsg }]),
          completedAt: new Date(),
        },
      })
      return NextResponse.json(
        { job: updated, error: errMsg },
        { status: 400 },
      )
    }

    // Read file as text and parse CSV.
    const text = await file.text()
    const grid = parseCsv(text)
    if (grid.length < 2) {
      const errMsg = 'ไฟล์ CSV ไม่มีข้อมูล (ต้องมีบรรทัดหัวคอลัมน์ + อย่างน้อย 1 แถว)'
      const updated = await db.importJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          errors: JSON.stringify([{ row: 0, message: errMsg }]),
          completedAt: new Date(),
        },
      })
      return NextResponse.json({ job: updated, error: errMsg }, { status: 400 })
    }

    const headers = grid[0].map((h) => h.trim())
    const dataRows = grid.slice(1).filter(
      (r) => !(r.length === 1 && r[0] === ''),
    )
    const totalRows = dataRows.length

    let result: { processed: number; errors: ImportError[] }
    try {
      // Test hook: controlled fault injection for importer-level DB failure test
      // When TEST_INJECT_IMPORTER_FAILURE=1 AND NODE_ENV !== 'production',
      // throws to simulate DB/infrastructure error.
      // Production guard: this hook is a no-op in production (NODE_ENV=production).
      if (process.env.TEST_INJECT_IMPORTER_FAILURE === '1' && process.env.NODE_ENV !== 'production') {
        throw new Error('Test-injected DB failure (TEST_INJECT_IMPORTER_FAILURE=1)')
      }
      switch (jobType) {
        case 'device':
          result = await importDevices(dataRows, headers)
          break
        case 'work-order':
          result = await importWorkOrders(dataRows, headers)
          break
        case 'stock':
          result = await importStock(dataRows, headers)
          break
        case 'meter-reading':
          result = await importMeterReadings(dataRows, headers)
          break
        case 'master-data':
          result = await importMasterData(dataRows, headers)
          break
        default:
          result = {
            processed: 0,
            errors: [{ row: 0, message: 'jobType ไม่รองรับ' }],
          }
      }
    } catch (e) {
      console.error('POST /api/import — importer threw', e)
      const errMsg = e instanceof Error ? e.message : 'Importer error'
      const updated = await db.importJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          totalRows,
          processedRows: 0,
          errorRows: totalRows,
          errors: JSON.stringify([{ row: 0, message: errMsg }]),
          completedAt: new Date(),
        },
      })
      // P1 fix (Audit re-review): importer catch is for UNEXPECTED DB/infrastructure
      // errors (Prisma exceptions, connection failures). These are NOT validation
      // errors (validation errors are pushed to errors[], not thrown).
      // Therefore: HTTP 500 (server error), NOT 422.
      return NextResponse.json({ job: updated, error: errMsg }, { status: 500 })
    }

    const errorRows = totalRows - result.processed
    const status = result.processed === 0 && totalRows > 0 ? 'failed' : 'completed'

    const updated = await db.importJob.update({
      where: { id: job.id },
      data: {
        status,
        totalRows,
        processedRows: result.processed,
        errorRows,
        errors:
          result.errors.length > 0
            ? JSON.stringify(result.errors.slice(0, 200))
            : null,
        completedAt: new Date(),
      },
    })

    await logAudit(
      'IMPORT',
      jobType.toUpperCase(),
      job.id,
      `นำเข้า${jobTypeLabel(jobType)}: ${result.processed}/${totalRows} แถว (${fileName})`,
      {
        jobType,
        fileName,
        totalRows,
        processed: result.processed,
        errorCount: result.errors.length,
        errors: result.errors.slice(0, 20),
      },
    )

    // F-03 fix: return 422 when there are validation errors, not 201
    // HTTP 201 = created successfully (no errors); HTTP 422 = validation errors present
    const finalErrorRows = totalRows - result.processed
    const httpStatus = finalErrorRows > 0 ? 422 : 201
    return NextResponse.json({ job: updated }, { status: httpStatus })
  } catch (err) {
    console.error('POST /api/import', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Import failed') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ============================================================
// GET /api/import  — recent ImportJob history (default 50)
// ============================================================
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('import')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'IMPORT_DATA')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const { searchParams } = new URL(req.url)
    const limit = Math.min(
      100,
      Math.max(1, Number(searchParams.get('limit') ?? '50') || 50),
    )
    const jobs = await db.importJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return NextResponse.json({ jobs })
  } catch (err) {
    console.error('GET /api/import', err)
    return NextResponse.json(
      { error: 'Failed to fetch import jobs' },
      { status: 500 },
    )
  }
}
