import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db, getBaseClient } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { fetchSheet } from '@/lib/google-sheets-service'
import {
  FIELD_MAPPINGS,
  STATUS_MAPPINGS,
  mapCsvRow,
  parseBool,
  parseDate,
  parseDateTime,
  toInt,
  toFloat,
} from '@/lib/csv-field-mapping'
import { normalizeStatus } from '@/lib/status-utils'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { verifyCronSecret } from '@/lib/cron-auth'

/**
 * GET /api/cron/sync-legacy
 *
 * Daily sync from legacy Google Sheets → ITAM-NextJS database.
 * Uses the Service-Account-backed Google Sheets API v4 (no public CSV export).
 *
 * SYNC-REWRITE-012: rewrote to cover ALL 12 legacy sheet tabs (previously
 * only Device / WorkOrder / StockItem). Each entity is fetched via
 * `fetchSheet()` (Sheets API v4 + Service Account), mapped through the
 * shared FIELD_MAPPINGS layer from `csv-field-mapping.ts`, and batch-upserted
 * inside `getBaseClient().$transaction` (BATCH_SIZE rows per tx — partial failures roll
 * back atomically per batch without aborting the rest of the sync).
 *
 * 12 entities synced (per qa-reports/LEGACY-FIELD-MAPPING-REFERENCE-008.md):
 *   ITAM (GOOGLE_SHEETS_ID_ITAM):
 *     1. All_Devices       → Device          (upsert by assetCode)
 *     2. Meter_Readings    → MeterReading    (lookup deviceId by assetCode)
 *     3. Location_History  → DeviceTransfer  (lookup deviceId by assetCode)
 *     4. User_Permissions  → User            (upsert by email)
 *     5. App_Settings      → AppSetting      (upsert by key)
 *     6. Master_Items      → MasterItem      (findFirst by category+code)
 *     7. Site_Attributes   → SiteAttribute + SiteRate (upsert by SiteCode)
 *   SERVICES (GOOGLE_SHEETS_ID_SERVICES):
 *     8. Data              → WorkOrder       (upsert by requestId; status via STATUS_MAPPINGS)
 *   STOCK (GOOGLE_SHEETS_ID_STOCK):
 *     9. Products          → StockItem       (upsert by productCode)
 *    10. StockIn           → StockTransaction (type=IN; lookup stockItemId)
 *    11. StockOut          → StockTransaction (type=OUT; lookup stockItemId)
 *    12. PurchaseOrders    → PurchaseOrder   (findFirst by poNumber)
 *
 * Safety features:
 *   - CRON_SECRET auth (Vercel cron auto-sends Bearer token)
 *   - Dry-run mode (?dryRun=1) → fetch + map but skip DB writes
 *   - Each entity wrapped in its own try/catch so one failure doesn't abort
 *     the other 11.
 *   - FK lookups (deviceId by assetCode, stockItemId by productCode) cached
 *     in a Map to avoid N+1 queries.
 *   - `clean()` strips null/undefined from update payload so existing DB
 *     values are preserved when the sheet has empty cells.
 *
 * Auth: CRON_SECRET (Vercel cron auto-sends this).
 */

export const maxDuration = 300

/** Rows per `getBaseClient().$transaction` batch. Larger = fewer tx roundtrips but bigger
 *  rollback blast radius on failure. 50 is a sane middle ground for PG. */
const BATCH_SIZE = 50

interface EntityResult {
  fetched: number
  updated: number
  errors: number
  error: string | null
}

function newResult(): EntityResult {
  return { fetched: 0, updated: 0, errors: 0, error: null }
}

/** Strip null/undefined values from the update payload so we don't
 *  overwrite existing DB data with null when a legacy sheet cell is empty.
 *  (Matches the existing device-sync behavior.) */
function clean<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== null && v !== undefined),
  ) as Partial<T>
}

type TxClient = Prisma.TransactionClient

/**
 * Batch upsert helper. Wraps each batch in `getBaseClient().$transaction` so a partial
 * failure rolls back atomically (the failing batch is dropped, earlier
 * committed batches survive — surfaced via the return count).
 *
 * `writeFn` is invoked once per row inside the tx; it should perform a
 * single upsert/create/update. Throws bubble up to the tx wrapper which
 * rolls back the entire batch.
 */
async function batchWrite<T>(
  rows: T[],
  writeFn: (row: T, tx: TxClient) => Promise<void>,
  label: string,
  dryRun: boolean,
): Promise<{ updated: number; errors: number; error: string | null }> {
  if (dryRun || rows.length === 0) {
    return { updated: 0, errors: 0, error: null }
  }
  let updated = 0
  let errors = 0
  let lastError: string | null = null
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    try {
      let batchOk = 0
      await getBaseClient().$transaction(async (tx) => {
        for (const row of batch) {
          await writeFn(row, tx)
          batchOk++
        }
      })
      updated += batchOk
    } catch (err) {
      errors += batch.length
      lastError = err instanceof Error ? err.message : String(err)
      console.error(
        `[sync-legacy][${label}] batch failed at offset ${i}/${rows.length}:`,
        err,
      )
    }
  }
  return { updated, errors, error: lastError }
}

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('sync')
  if (unavailable) return unavailable


  const auth = verifyCronSecret(req)
  if (auth) return auth

  // ── SPRINT-1 #4: phase-based sync to avoid Vercel 60s timeout ──
  // The original GET handler synced ALL 12 entities in a single request,
  // which takes 35-150s for ~25k rows — exceeding Vercel Hobby's 60s
  // function timeout. Entities 9-12 (StockItem/PurchaseOrder/StockIn/
  // StockOut — the business-critical ones) would be lost on timeout.
  //
  // Solution: accept `?phase=X` (1, 2, or 3) and delegate to the phase
  // route's logic (which syncs ~4 entities per phase, each phase ~20s).
  // If no `?phase` is provided, default to phase 1 (devices + meter +
  // transfers + users + settings + master + sites) so the existing
  // `vercel.json` cron schedule continues to work without config change.
  //
  // To run the full sync, call this route 3 times:
  //   curl /api/cron/sync-legacy?phase=1
  //   curl /api/cron/sync-legacy?phase=2
  //   curl /api/cron/sync-legacy?phase=3
  // (or use the dedicated /api/cron/sync-legacy/phase route)
  const phaseParam = req.nextUrl.searchParams.get('phase')
  if (phaseParam === '1' || phaseParam === '2' || phaseParam === '3') {
    // Delegate to the phase route's logic via internal fetch
    const baseUrl = new URL(req.url).origin
    const phaseUrl = `${baseUrl}/api/cron/sync-legacy/phase?phase=${phaseParam}${req.nextUrl.searchParams.get('dryRun') === '1' ? '&dryRun=1' : ''}`
    const cronSecret = process.env.CRON_SECRET
    const phaseRes = await fetch(phaseUrl, {
      headers: cronSecret ? { authorization: `Bearer ${cronSecret}` } : {},
    })
    const phaseBody = await phaseRes.json().catch(() => ({ error: 'phase fetch failed' }))
    return NextResponse.json({
      ok: phaseRes.ok,
      phase: parseInt(phaseParam, 10),
      delegated: true,
      ...phaseBody,
    }, { status: phaseRes.status })
  }

  // ── Default: full sync (legacy behavior) ──
  // WARNING: this will exceed Vercel Hobby's 60s timeout for large datasets.
  // Production should call with ?phase=1/2/3 instead.

  // ── Dry-run mode: fetch + map but skip DB writes ──
  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'
  const startTime = Date.now()

  const results = {
    dryRun,
    devices: newResult(),
    meterReadings: newResult(),
    deviceTransfers: newResult(),
    users: newResult(),
    appSettings: newResult(),
    masterItems: newResult(),
    siteAttributes: { ...newResult(), siteRates: 0 },
    workOrders: newResult(),
    stockItems: newResult(),
    stockTransactionsIn: newResult(),
    stockTransactionsOut: newResult(),
    purchaseOrders: newResult(),
  }

  // ── FK lookup caches (populated lazily as we sync) ──
  // assetCode → Device.id (used by MeterReading + DeviceTransfer)
  const assetCodeToDeviceId = new Map<string, string>()
  // productCode → StockItem.id (used by StockTransaction IN/OUT + PurchaseOrder)
  const productCodeToStockItemId = new Map<string, string>()

  try {
    // Pre-load existing Device + StockItem IDs so FK lookups resolve even for
    // rows whose parent entity wasn't re-synced in this run (e.g. a new
    // MeterReading for a device that's already in the DB from yesterday).
    const existingDevices = await db.device.findMany({
      select: { id: true, assetCode: true },
    })
    for (const d of existingDevices) assetCodeToDeviceId.set(d.assetCode, d.id)
    const existingStockItems = await db.stockItem.findMany({
      select: { id: true, productCode: true },
    })
    for (const si of existingStockItems)
      productCodeToStockItemId.set(si.productCode, si.id)

    // ════════════════════════════════════════════════════════════════
    // 1. Devices (ITAM: All_Devices)
    // ════════════════════════════════════════════════════════════════
    try {
      const { rows, error: sheetError } = await fetchSheet('itam', 'All_Devices')
      if (sheetError) { results.devices.error = sheetError; throw new Error('All_Devices: ' + sheetError) }
      results.devices.fetched = rows.length
      const mapped: Record<string, string>[] = []
      for (const row of rows) {
        const { data } = mapCsvRow(row, FIELD_MAPPINGS.device)
        if (!data.assetCode) {
          results.devices.errors++
          continue
        }
        mapped.push(data)
      }
      const res = await batchWrite(
        mapped,
        async (data, tx) => {
          const status = normalizeStatus(data.status) || 'Active'
          const payload = {
            assetCode: data.assetCode,
            name:
              data.brand && data.model
                ? `${data.brand} ${data.model}`
                : data.assetCode,
            brand: data.brand || '',
            model: data.model || '',
            type: data.type || '',
            serialNumber: data.serialNumber || null,
            status,
            site: data.site || '',
            department: data.department || null,
            departmentCode: data.departmentCode || null,
            assetSiteCode: data.assetSiteCode || null,
            location: data.location || null,
            building: data.building || null,
            floor: data.floor || null,
            contractNo: data.contractNo || null,
            vendor: data.vendor || null,
            ip: data.ip || null,
            mac: data.mac || null,
            remoteId: data.remoteId || null,
            installDate: data.installDate || null,
            uninstallDate: data.uninstallDate || null,
            warrantyEnd: data.warrantyEnd || null,
            deviceGroup: data.deviceGroup || null,
            costCenter: data.costCenter || null,
            meterRequired: parseBool(data.meterRequired),
            meterMode: data.meterMode || null,
            remark: data.remark || null,
            updatedBy: data.updatedBy || 'sync-legacy',
            isDemo: false,
          }
          const rec = await tx.device.upsert({
            where: { assetCode: payload.assetCode },
            create: payload,
            update: clean(payload),
          })
          assetCodeToDeviceId.set(rec.assetCode, rec.id)
        },
        'device',
        dryRun,
      )
      results.devices.updated += res.updated
      results.devices.errors += res.errors
      if (res.error) results.devices.error = res.error
    } catch (err) {
      results.devices.error = err instanceof Error ? err.message : String(err)
      console.error('[sync-legacy][device] section failed:', err)
    }

    // ════════════════════════════════════════════════════════════════
    // 2. MeterReadings (ITAM: Meter_Readings) — deviceId lookup by assetCode
    // ════════════════════════════════════════════════════════════════
    try {
      const { rows, error: sheetError } = await fetchSheet('itam', 'Meter_Readings')
      if (sheetError) { results.meterReadings.error = sheetError; throw new Error('Meter_Readings: ' + sheetError) }
      results.meterReadings.fetched = rows.length
      const mapped: Array<{ data: Record<string, string> }> = []
      for (const row of rows) {
        const { data } = mapCsvRow(row, FIELD_MAPPINGS.meterReading)
        // csv mapping: asset_no → 'deviceId' (the raw assetCode string)
        const assetCode = (data.deviceId ?? '').trim()
        const deviceId = assetCodeToDeviceId.get(assetCode)
        if (!deviceId) {
          results.meterReadings.errors++
          continue
        }
        const readingDate = parseDate(data.readingDate)
        if (!readingDate) {
          results.meterReadings.errors++
          continue
        }
        mapped.push({
          data: {
            ...data,
            _deviceId: deviceId,
            _assetCode: assetCode,
            _readingDate: readingDate,
          },
        })
      }
      const res = await batchWrite(
        mapped,
        async (row, tx) => {
          const data = row.data
          const deviceId = data._deviceId
          const assetCode = data._assetCode
          const readingDate = data._readingDate
          // csv mapping: reading_id → 'id' (raw legacy dedup string)
          const readingId = (data.id ?? '').trim() || null
          const payload = {
            readingId,
            deviceId,
            assetCode,
            readingDate,
            readingMonth: data.readingMonth || readingDate.slice(0, 7),
            meterBw: toInt(data.meterBw),
            meterColor: toInt(data.meterColor),
            pagesBw: toInt(data.pagesBw),
            pagesColor: toInt(data.pagesColor),
            prevMeterBw: toInt(data.prevMeterBw),
            prevMeterColor: toInt(data.prevMeterColor),
            readingType: data.readingType || null,
            readBy: data.readBy || null,
            remark: data.remark || null,
            siteAtReading: data.siteAtReading || null,
            buildingAtReading: data.buildingAtReading || null,
            floorAtReading: data.floorAtReading || null,
            departmentAtReading: data.departmentAtReading || null,
            isDemo: false,
          }
          if (readingId) {
            await tx.meterReading.upsert({
              where: { readingId },
              create: payload,
              update: clean(payload),
            })
          } else {
            // No dedup key → just create (legacy sheet row may lack reading_id).
            await tx.meterReading.create({ data: clean(payload) as Prisma.MeterReadingUncheckedCreateInput })
          }
        },
        'meterReading',
        dryRun,
      )
      results.meterReadings.updated += res.updated
      results.meterReadings.errors += res.errors
      if (res.error) results.meterReadings.error = res.error
    } catch (err) {
      results.meterReadings.error = err instanceof Error ? err.message : String(err)
      console.error('[sync-legacy][meterReading] section failed:', err)
    }

    // ════════════════════════════════════════════════════════════════
    // 3. DeviceTransfers (ITAM: Location_History) — deviceId lookup by assetCode
    // ════════════════════════════════════════════════════════════════
    try {
      const { rows, error: sheetError } = await fetchSheet('itam', 'Location_History')
      if (sheetError) { results.deviceTransfers.error = sheetError; throw new Error('Location_History: ' + sheetError) }
      results.deviceTransfers.fetched = rows.length
      const mapped: Array<{ data: Record<string, string> }> = []
      for (const row of rows) {
        const { data } = mapCsvRow(row, FIELD_MAPPINGS.deviceTransfer)
        // csv mapping: Asset_No → 'deviceId' (raw assetCode string)
        const assetCode = (data.deviceId ?? '').trim()
        const deviceId = assetCodeToDeviceId.get(assetCode)
        if (!deviceId) {
          results.deviceTransfers.errors++
          continue
        }
        mapped.push({
          data: { ...data, _deviceId: deviceId, _assetCode: assetCode },
        })
      }
      const res = await batchWrite(
        mapped,
        async (row, tx) => {
          const data = row.data
          const deviceId = data._deviceId
          const assetCode = data._assetCode
          // csv mapping: Log_ID → 'id' (raw legacy dedup string) → use as logId
          const logId = (data.id ?? '').trim() || null
          const transferDate =
            parseDate(data.transferDate) || new Date().toISOString().slice(0, 10)
          const payload = {
            logId,
            deviceId,
            assetCode,
            transferDate,
            fromSite: data.fromSite || null,
            toSite: data.toSite || 'ไม่ระบุ',
            fromDept: data.fromDept || null,
            toDept: data.toDept || null,
            fromDeptCode: data.fromDeptCode || null,
            toDeptCode: data.toDeptCode || null,
            fromBuilding: data.fromBuilding || null,
            toBuilding: data.toBuilding || null,
            fromFloor: data.fromFloor || null,
            toFloor: data.toFloor || null,
            fromLocation: data.fromLocation || null,
            toLocation: data.toLocation || null,
            movedBy: data.movedBy || null,
            reason: data.reason || null,
            isDemo: false,
          }
          if (logId) {
            await tx.deviceTransfer.upsert({
              where: { logId },
              create: payload,
              update: clean(payload),
            })
          } else {
            await tx.deviceTransfer.create({
              data: clean(payload) as Prisma.DeviceTransferUncheckedCreateInput,
            })
          }
        },
        'deviceTransfer',
        dryRun,
      )
      results.deviceTransfers.updated += res.updated
      results.deviceTransfers.errors += res.errors
      if (res.error) results.deviceTransfers.error = res.error
    } catch (err) {
      results.deviceTransfers.error = err instanceof Error ? err.message : String(err)
      console.error('[sync-legacy][deviceTransfer] section failed:', err)
    }

    // ════════════════════════════════════════════════════════════════
    // 4. Users (ITAM: User_Permissions)
    // ════════════════════════════════════════════════════════════════
    try {
      const { rows, error: sheetError } = await fetchSheet('itam', 'User_Permissions')
      if (sheetError) { results.users.error = sheetError; throw new Error('User_Permissions: ' + sheetError) }
      results.users.fetched = rows.length
      const mapped: Record<string, string>[] = []
      for (const row of rows) {
        const { data } = mapCsvRow(row, FIELD_MAPPINGS.user)
        if (!data.email) {
          results.users.errors++
          continue
        }
        mapped.push(data)
      }
      const res = await batchWrite(
        mapped,
        async (data, tx) => {
          const payload = {
            email: data.email,
            role: data.role || 'viewer',
            active: parseBool(data.active),
            name: data.name || null,
            username: data.username || null,
            passwordHash: data.passwordHash || null,
            remark: data.remark || null,
            allowedSites: data.allowedSites || null,
            lastLoginAt: data.lastLoginAt || null,
            isDemo: false,
          }
          await tx.user.upsert({
            where: { email: payload.email },
            create: payload,
            update: clean(payload),
          })
        },
        'user',
        dryRun,
      )
      results.users.updated += res.updated
      results.users.errors += res.errors
      if (res.error) results.users.error = res.error
    } catch (err) {
      results.users.error = err instanceof Error ? err.message : String(err)
      console.error('[sync-legacy][user] section failed:', err)
    }

    // ════════════════════════════════════════════════════════════════
    // 5. AppSettings (ITAM: App_Settings)
    //    NOTE: csv-field-mapping maps Description → 'remark', but AppSetting
    //    has no remark field. We omit it (constraint: skip fields not on model).
    // ════════════════════════════════════════════════════════════════
    try {
      const { rows, error: sheetError } = await fetchSheet('itam', 'App_Settings')
      if (sheetError) { results.appSettings.error = sheetError; throw new Error('App_Settings: ' + sheetError) }
      results.appSettings.fetched = rows.length
      const mapped: Record<string, string>[] = []
      for (const row of rows) {
        const { data } = mapCsvRow(row, FIELD_MAPPINGS.appSetting)
        if (!data.key) {
          results.appSettings.errors++
          continue
        }
        mapped.push(data)
      }
      const res = await batchWrite(
        mapped,
        async (data, tx) => {
          const payload = {
            key: data.key,
            value: data.value ?? '',
            isDemo: false,
          }
          await tx.appSetting.upsert({
            where: { key: payload.key },
            create: payload,
            update: clean(payload),
          })
        },
        'appSetting',
        dryRun,
      )
      results.appSettings.updated += res.updated
      results.appSettings.errors += res.errors
      if (res.error) results.appSettings.error = res.error
    } catch (err) {
      results.appSettings.error = err instanceof Error ? err.message : String(err)
      console.error('[sync-legacy][appSetting] section failed:', err)
    }

    // ════════════════════════════════════════════════════════════════
    // 6. MasterItems (ITAM: Master_Items)
    //    No @unique constraint → findFirst by (category, code), pre-cached.
    // ════════════════════════════════════════════════════════════════
    try {
      const { rows, error: sheetError } = await fetchSheet('itam', 'Master_Items')
      if (sheetError) { results.masterItems.error = sheetError; throw new Error('Master_Items: ' + sheetError) }
      results.masterItems.fetched = rows.length
      const mapped: Record<string, string>[] = []
      for (const row of rows) {
        const { data } = mapCsvRow(row, FIELD_MAPPINGS.masterItem)
        if (!data.category || !data.code) {
          results.masterItems.errors++
          continue
        }
        mapped.push(data)
      }
      // Pre-load existing items by (category, code) to dedup without N+1 queries
      const existingItems = await db.masterItem.findMany({
        select: { id: true, category: true, code: true },
      })
      const masterItemCache = new Map<string, string>()
      for (const mi of existingItems)
        masterItemCache.set(`${mi.category}|${mi.code}`, mi.id)
      const res = await batchWrite(
        mapped,
        async (data, tx) => {
          const payload = {
            category: data.category,
            code: data.code,
            label: data.label || '',
            parentRef: data.parentRef || null,
            displayLabel: data.displayLabel || null,
            siteCode: data.siteCode || null,
            active:
              data.active !== undefined && data.active !== ''
                ? parseBool(data.active)
                : true,
            isDemo: false,
          }
          const cacheKey = `${payload.category}|${payload.code}`
          const existingId = masterItemCache.get(cacheKey)
          if (existingId) {
            await tx.masterItem.update({
              where: { id: existingId },
              data: clean(payload),
            })
          } else {
            const created = await tx.masterItem.create({ data: payload })
            masterItemCache.set(cacheKey, created.id)
          }
        },
        'masterItem',
        dryRun,
      )
      results.masterItems.updated += res.updated
      results.masterItems.errors += res.errors
      if (res.error) results.masterItems.error = res.error
    } catch (err) {
      results.masterItems.error = err instanceof Error ? err.message : String(err)
      console.error('[sync-legacy][masterItem] section failed:', err)
    }

    // ════════════════════════════════════════════════════════════════
    // 7. SiteAttributes + SiteRates (ITAM: Site_Attributes)
    //    SiteAttribute.SiteCode is @unique → upsert.
    //    SiteRate has no @unique → findFirst by siteCode (pre-cached).
    //    We bypass FIELD_MAPPINGS.site here because the SiteAttribute
    //    PascalCase fields (SiteCode, PaperRateBW, …) match the sheet
    //    headers 1:1, so a direct read is simpler + more faithful.
    // ════════════════════════════════════════════════════════════════
    try {
      const { rows, error: sheetError } = await fetchSheet('itam', 'Site_Attributes')
      if (sheetError) { results.siteAttributes.error = sheetError; throw new Error('Site_Attributes: ' + sheetError) }
      results.siteAttributes.fetched = rows.length
      const mapped: Record<string, string>[] = []
      for (const row of rows) {
        const siteCode = (row.Site_Code ?? row.site_code ?? '').trim()
        if (!siteCode) {
          results.siteAttributes.errors++
          continue
        }
        mapped.push(row)
      }
      // Pre-load existing SiteRates by siteCode
      const existingRates = await db.siteRate.findMany({
        select: { id: true, siteCode: true },
      })
      const siteRateCache = new Map<string, string>()
      for (const sr of existingRates) siteRateCache.set(sr.siteCode, sr.id)
      let siteRatesCreated = 0
      const res = await batchWrite(
        mapped,
        async (row, tx) => {
          const siteCode = (row.Site_Code ?? row.site_code ?? '').trim()
          const siteName = (row.SiteName ?? row.sitename ?? '').trim()
          const lineOA = (row.LineOA ?? row.lineoa ?? '').trim()
          const hotline = (row.Hotline ?? row.hotline ?? '').trim()
          const paperRateBW = toFloat(row.PaperRateBW ?? row.paperratebw) ?? 0.5
          const paperRateColor =
            toFloat(row.PaperRateColor ?? row.paperratecolor) ?? 2.0
          // 7a. SiteAttribute (upsert by SiteCode)
          const saPayload = {
            SiteCode: siteCode,
            SiteName: siteName || null,
            LineOA: lineOA || null,
            Hotline: hotline || null,
            PaperRateBW: paperRateBW,
            PaperRateColor: paperRateColor,
            isDemo: false,
          }
          await tx.siteAttribute.upsert({
            where: { SiteCode: siteCode },
            create: saPayload,
            update: clean(saPayload),
          })
          // 7b. SiteRate (findFirst+update/create by siteCode)
          const srPayload = {
            siteCode,
            bwRate: paperRateBW,
            colorRate: paperRateColor,
            isDemo: false,
          }
          const existingId = siteRateCache.get(siteCode)
          if (existingId) {
            await tx.siteRate.update({
              where: { id: existingId },
              data: srPayload,
            })
          } else {
            const created = await tx.siteRate.create({ data: srPayload })
            siteRateCache.set(siteCode, created.id)
            siteRatesCreated++
          }
        },
        'siteAttribute',
        dryRun,
      )
      results.siteAttributes.updated += res.updated
      results.siteAttributes.errors += res.errors
      results.siteAttributes.siteRates = siteRatesCreated
      if (res.error) results.siteAttributes.error = res.error
    } catch (err) {
      results.siteAttributes.error = err instanceof Error ? err.message : String(err)
      console.error('[sync-legacy][siteAttribute] section failed:', err)
    }

    // ════════════════════════════════════════════════════════════════
    // 8. WorkOrders (Services: Data)
    //    Sheet tab is 'Data' (NOT 'All_WO' — bug fix per LEGACY-FIELD-MAPPING-008 §12).
    //    Status mapped via STATUS_MAPPINGS.workOrder (emoji Thai → enum).
    // ════════════════════════════════════════════════════════════════
    try {
      const { rows, error: sheetError } = await fetchSheet('services', 'Data')
      if (sheetError) { results.workOrders.error = sheetError; throw new Error('Data (WO): ' + sheetError) }
      results.workOrders.fetched = rows.length
      const mapped: Record<string, string>[] = []
      for (const row of rows) {
        const { data } = mapCsvRow(row, FIELD_MAPPINGS.workOrder)
        if (!data.requestId) {
          results.workOrders.errors++
          continue
        }
        mapped.push(data)
      }
      const res = await batchWrite(
        mapped,
        async (data, tx) => {
          const mappedStatus = data.status
            ? (STATUS_MAPPINGS.workOrder as Record<string, string>)[data.status]
            : undefined
          const status = mappedStatus || data.status || 'PENDING'
          const payload = {
            requestId: data.requestId,
            legacyJobNo: data.legacyJobNo || null,
            subject: data.subject || 'ไม่ระบุ',
            status,
            building: data.building || null,
            location: data.location || null,
            details: data.details || null,
            externalMeta: data.externalMeta || null,
            reporterName: data.reporterName || null,
            tel: data.tel || null,
            employeeCode: data.employeeCode || null,
            submissionSource: data.submissionSource || 'guest',
            picBefore: data.picBefore || null,
            picOnsite: data.picOnsite || null,
            picAfter: data.picAfter || null,
            detailsAdmin: data.detailsAdmin || null,
            dateAdmin: data.dateAdmin || null,
            acceptStatus: data.acceptStatus || null,
            editUnlockActive: parseBool(data.editUnlockActive),
            editUnlockBy: data.editUnlockBy || null,
            editUnlockAt: parseDateTime(data.editUnlockAt),
            editUnlockNote: data.editUnlockNote || null,
            workCompletedAt: parseDateTime(data.workCompletedAt),
            closedAt: parseDateTime(data.closedAt),
            canceledAt: parseDateTime(data.canceledAt),
            priority: data.priority || 'ปกติ',
            assignedTo: data.assignedTo || null,
            assignedBy: data.assignedBy || null,
            assignedAt: parseDateTime(data.assignedAt),
            assignmentNote: data.assignmentNote || null,
            trackable: parseBool(data.trackable),
            isDemo: false,
          }
          await tx.workOrder.upsert({
            where: { requestId: payload.requestId },
            create: payload,
            update: clean(payload),
          })
        },
        'workOrder',
        dryRun,
      )
      results.workOrders.updated += res.updated
      results.workOrders.errors += res.errors
      if (res.error) results.workOrders.error = res.error
    } catch (err) {
      results.workOrders.error = err instanceof Error ? err.message : String(err)
      console.error('[sync-legacy][workOrder] section failed:', err)
    }

    // ════════════════════════════════════════════════════════════════
    // 9. StockItems (Stock: Products)
    // ════════════════════════════════════════════════════════════════
    try {
      const { rows, error: sheetError } = await fetchSheet('stock', 'Products')
      if (sheetError) { results.stockItems.error = sheetError; throw new Error('Products: ' + sheetError) }
      results.stockItems.fetched = rows.length
      const mapped: Record<string, string>[] = []
      for (const row of rows) {
        const { data } = mapCsvRow(row, FIELD_MAPPINGS.stockItem)
        if (!data.productCode) {
          results.stockItems.errors++
          continue
        }
        mapped.push(data)
      }
      const res = await batchWrite(
        mapped,
        async (data, tx) => {
          const payload = {
            productCode: data.productCode,
            productName: data.productName || 'ไม่ระบุ',
            quantity: toInt(data.quantity),
            unit: data.unit || 'ชิ้น',
            unitCost: toFloat(data.unitCost),
            minQuantity: toInt(data.minQuantity),
            active:
              data.active !== undefined && data.active !== ''
                ? parseBool(data.active)
                : true,
            lastUpdated: data.updatedAt || null,
            isDemo: false,
          }
          const rec = await tx.stockItem.upsert({
            where: { productCode: payload.productCode },
            create: payload,
            update: clean(payload),
          })
          productCodeToStockItemId.set(rec.productCode, rec.id)
        },
        'stockItem',
        dryRun,
      )
      results.stockItems.updated += res.updated
      results.stockItems.errors += res.errors
      if (res.error) results.stockItems.error = res.error
    } catch (err) {
      results.stockItems.error = err instanceof Error ? err.message : String(err)
      console.error('[sync-legacy][stockItem] section failed:', err)
    }

    // ════════════════════════════════════════════════════════════════
    // 10. PurchaseOrders (Stock: PurchaseOrders)
    //     Runs BEFORE StockTransaction IN so the PO cache is ready (though
    //     StockTransaction stores purchaseOrderNo as a string, not FK — kept
    //     here for ordering clarity). PurchaseOrder.poNumber is NOT @unique →
    //     findFirst+update/create pattern (pre-cached by poNumber).
    //     Fields quantityOrdered/unitPrice/quantityReceived/stockItemId live
    //     on PurchaseOrderItem, not PurchaseOrder — skipped per task
    //     constraint "If a field doesn't exist in the Prisma model, skip it."
    // ════════════════════════════════════════════════════════════════
    try {
      const { rows, error: sheetError } = await fetchSheet('stock', 'PurchaseOrders')
      if (sheetError) { results.purchaseOrders.error = sheetError; throw new Error('PurchaseOrders: ' + sheetError) }
      results.purchaseOrders.fetched = rows.length
      const mapped: Record<string, string>[] = []
      for (const row of rows) {
        const { data } = mapCsvRow(row, FIELD_MAPPINGS.purchaseOrder)
        if (!data.poNumber) {
          results.purchaseOrders.errors++
          continue
        }
        mapped.push(data)
      }
      // Pre-load existing POs by poNumber (no @unique → use findFirst pattern)
      const existingPOs = await db.purchaseOrder.findMany({
        select: { id: true, poNumber: true },
      })
      const poCache = new Map<string, string>()
      for (const po of existingPOs)
        if (po.poNumber) poCache.set(po.poNumber, po.id)
      const res = await batchWrite(
        mapped,
        async (data, tx) => {
          let status = (data.status || 'open').trim()
          const poStatusMap = STATUS_MAPPINGS.purchaseOrder as Record<string, string>
          if (poStatusMap[status]) {
            status = poStatusMap[status]
          } else if (!['open', 'partial', 'received', 'cancelled'].includes(status)) {
            status = 'open'
          }
          const payload = {
            poNumber: data.poNumber,
            orderDate:
              parseDate(data.orderDate) || new Date().toISOString().slice(0, 10),
            supplier: data.supplier || null,
            status,
            totalValue: toFloat(data.totalValue),
            createdBy: data.createdBy || null,
            isDemo: false,
          }
          const existingId = poCache.get(payload.poNumber)
          if (existingId) {
            await tx.purchaseOrder.update({
              where: { id: existingId },
              data: clean(payload),
            })
          } else {
            const created = await tx.purchaseOrder.create({ data: payload })
            poCache.set(payload.poNumber, created.id)
          }
        },
        'purchaseOrder',
        dryRun,
      )
      results.purchaseOrders.updated += res.updated
      results.purchaseOrders.errors += res.errors
      if (res.error) results.purchaseOrders.error = res.error
    } catch (err) {
      results.purchaseOrders.error = err instanceof Error ? err.message : String(err)
      console.error('[sync-legacy][purchaseOrder] section failed:', err)
    }

    // ════════════════════════════════════════════════════════════════
    // 11. StockTransactions IN (Stock: StockIn) — stockItemId lookup by productCode
    //     StockTransaction has no @unique → findFirst+update/create by (txnNumber, type)
    //     (pre-cached in one query per batch).
    //     NOTE: csv-field-mapping maps PurchaseOrderNo → 'purchaseOrderId',
    //     but StockTransaction stores it as a plain string `purchaseOrderNo`
    //     (no FK). We map to `purchaseOrderNo` per the "skip fields not on
    //     model" constraint.
    // ════════════════════════════════════════════════════════════════
    try {
      const { rows, error: sheetError } = await fetchSheet('stock', 'StockIn')
      if (sheetError) { results.stockTransactionsIn.error = sheetError; throw new Error('StockIn: ' + sheetError) }
      results.stockTransactionsIn.fetched = rows.length
      const mapped: Array<{ data: Record<string, string> }> = []
      for (const row of rows) {
        const { data } = mapCsvRow(row, FIELD_MAPPINGS.stockIn)
        if (!data.txnNumber) {
          results.stockTransactionsIn.errors++
          continue
        }
        // csv mapping: ProductCode → 'stockItemId' (raw productCode string)
        const productCode = (data.stockItemId ?? '').trim()
        const stockItemId = productCode
          ? productCodeToStockItemId.get(productCode)
          : undefined
        if (!stockItemId) {
          results.stockTransactionsIn.errors++
          continue
        }
        mapped.push({
          data: { ...data, _stockItemId: stockItemId, _productCode: productCode },
        })
      }
      // Pre-load existing IN transactions by txnNumber for dedup
      const inTxnNumbers = mapped
        .map((m) => m.data.txnNumber!)
        .filter(Boolean)
      const existingInTxns =
        inTxnNumbers.length > 0
          ? await db.stockTransaction.findMany({
              where: { txnNumber: { in: inTxnNumbers }, type: 'IN' },
              select: { id: true, txnNumber: true },
            })
          : []
      const inTxnCache = new Map<string, string>()
      for (const t of existingInTxns)
        if (t.txnNumber) inTxnCache.set(t.txnNumber, t.id)
      const res = await batchWrite(
        mapped,
        async (row, tx) => {
          const data = row.data
          const stockItemId = data._stockItemId
          const productCode = data._productCode
          const payload = {
            txnNumber: data.txnNumber,
            stockItemId,
            productCode,
            type: 'IN' as const,
            quantity: toInt(data.quantity),
            cost: toFloat(data.cost),
            vendor: data.vendor || null,
            performedBy: data.performedBy || null,
            remark: data.remark || null,
            purchaseOrderNo: data.purchaseOrderId || null,
            txnDate:
              parseDate(data.txnDate) || new Date().toISOString().slice(0, 10),
            isDemo: false,
          }
          const existingId = payload.txnNumber
            ? inTxnCache.get(payload.txnNumber)
            : undefined
          if (existingId) {
            await tx.stockTransaction.update({
              where: { id: existingId },
              data: clean(payload),
            })
          } else {
            await tx.stockTransaction.create({ data: payload })
            if (payload.txnNumber) inTxnCache.set(payload.txnNumber, '')
          }
        },
        'stockTransactionIn',
        dryRun,
      )
      results.stockTransactionsIn.updated += res.updated
      results.stockTransactionsIn.errors += res.errors
      if (res.error) results.stockTransactionsIn.error = res.error
    } catch (err) {
      results.stockTransactionsIn.error =
        err instanceof Error ? err.message : String(err)
      console.error('[sync-legacy][stockTransactionIn] section failed:', err)
    }

    // ════════════════════════════════════════════════════════════════
    // 12. StockTransactions OUT (Stock: StockOut) — stockItemId lookup by productCode
    // ════════════════════════════════════════════════════════════════
    try {
      const { rows, error: sheetError } = await fetchSheet('stock', 'StockOut')
      if (sheetError) { results.stockTransactionsOut.error = sheetError; throw new Error('StockOut: ' + sheetError) }
      results.stockTransactionsOut.fetched = rows.length
      const mapped: Array<{ data: Record<string, string> }> = []
      for (const row of rows) {
        const { data } = mapCsvRow(row, FIELD_MAPPINGS.stockOut)
        if (!data.txnNumber) {
          results.stockTransactionsOut.errors++
          continue
        }
        const productCode = (data.stockItemId ?? '').trim()
        const stockItemId = productCode
          ? productCodeToStockItemId.get(productCode)
          : undefined
        if (!stockItemId) {
          results.stockTransactionsOut.errors++
          continue
        }
        mapped.push({
          data: { ...data, _stockItemId: stockItemId, _productCode: productCode },
        })
      }
      const outTxnNumbers = mapped
        .map((m) => m.data.txnNumber!)
        .filter(Boolean)
      const existingOutTxns =
        outTxnNumbers.length > 0
          ? await db.stockTransaction.findMany({
              where: { txnNumber: { in: outTxnNumbers }, type: 'OUT' },
              select: { id: true, txnNumber: true },
            })
          : []
      const outTxnCache = new Map<string, string>()
      for (const t of existingOutTxns)
        if (t.txnNumber) outTxnCache.set(t.txnNumber, t.id)
      const res = await batchWrite(
        mapped,
        async (row, tx) => {
          const data = row.data
          const stockItemId = data._stockItemId
          const productCode = data._productCode
          const payload = {
            txnNumber: data.txnNumber,
            stockItemId,
            productCode,
            type: 'OUT' as const,
            quantity: toInt(data.quantity),
            requester: data.requester || null,
            department: data.department || null,
            purpose: data.purpose || null,
            approver: data.approver || null,
            approvedAt: data.approvedAt || null,
            workOrderNo: data.workOrderNo || null,
            txnDate:
              parseDate(data.txnDate) || new Date().toISOString().slice(0, 10),
            isDemo: false,
          }
          const existingId = payload.txnNumber
            ? outTxnCache.get(payload.txnNumber)
            : undefined
          if (existingId) {
            await tx.stockTransaction.update({
              where: { id: existingId },
              data: clean(payload),
            })
          } else {
            await tx.stockTransaction.create({ data: payload })
            if (payload.txnNumber) outTxnCache.set(payload.txnNumber, '')
          }
        },
        'stockTransactionOut',
        dryRun,
      )
      results.stockTransactionsOut.updated += res.updated
      results.stockTransactionsOut.errors += res.errors
      if (res.error) results.stockTransactionsOut.error = res.error
    } catch (err) {
      results.stockTransactionsOut.error =
        err instanceof Error ? err.message : String(err)
      console.error('[sync-legacy][stockTransactionOut] section failed:', err)
    }

    // ── Audit log: one-line summary so the AuditLog table is searchable ──
    await logAudit(
      'SYNC',
      'Device',
      // `logAudit`'s entityId is `string | null` — pass a stable sentinel for a
// whole-run sync rather than `undefined`, which Prisma rejects at runtime.
'legacy-sync',
      `Legacy sync ${dryRun ? '(DRY-RUN) ' : ''}dev ${results.devices.updated}~/${results.devices.errors}e, ` +
        `meter ${results.meterReadings.updated}~/${results.meterReadings.errors}e, ` +
        `transfer ${results.deviceTransfers.updated}~/${results.deviceTransfers.errors}e, ` +
        `user ${results.users.updated}~/${results.users.errors}e, ` +
        `setting ${results.appSettings.updated}~/${results.appSettings.errors}e, ` +
        `master ${results.masterItems.updated}~/${results.masterItems.errors}e, ` +
        `site ${results.siteAttributes.updated}~/${results.siteAttributes.errors}e, ` +
        `wo ${results.workOrders.updated}~/${results.workOrders.errors}e, ` +
        `stock ${results.stockItems.updated}~/${results.stockItems.errors}e, ` +
        `txn-in ${results.stockTransactionsIn.updated}~/${results.stockTransactionsIn.errors}e, ` +
        `txn-out ${results.stockTransactionsOut.updated}~/${results.stockTransactionsOut.errors}e, ` +
        `po ${results.purchaseOrders.updated}~/${results.purchaseOrders.errors}e`,
      // logAudit's `detail` is `Record<string, unknown>` and it JSON.stringify's
      // internally — passing an already-stringified string here double-encoded it
      // into a quoted, escaped JSON string in the audit trail.
      { results: results as unknown as Record<string, unknown> },
    ).catch(() => {})

    return NextResponse.json({
      ok: true,
      dryRun,
      durationMs: Date.now() - startTime,
      results,
    })
  } catch (err) {
    console.error('[sync-legacy] fatal:', err)
    return NextResponse.json(
      { error: 'Sync failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
