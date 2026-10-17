import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { normalizeSiteCode } from '@/lib/site-scope'
import { demoTag, demoFilter } from '@/lib/demo-mode'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { getOrgScope } from '@/lib/org-scope'
import { allocateNextNumber, previewNextNumber } from '@/lib/numbering-engine'
import {
  clampPageAndLimit,
  buildPaginationMeta,
  emptyListResponse,
  getDeviceListFields,
  DEVICE_LIST_FIELDS,
} from '@/lib/devices-bounded-list'

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

export async function GET(req: NextRequest) {
  // ── Phase 4.3: Module availability gate ──
  // Returns 404 MODULE_DISABLED when the 'devices' module is disabled
  // in src/config/modules.ts. Done BEFORE auth so a disabled module has no
  // observable API surface at all (matches the pattern in /api/reports/*).
  const moduleCheck = await moduleUnavailableResponse('devices')
  if (moduleCheck) return moduleCheck

  // ── Authentication: require VIEW_DEVICES permission ──
  // Previously this route returned full device records (including
  // serialNumber, IP/MAC, vendor/contract info) with no auth check.
  // Now it enforces authentication and Site scope.
  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // ── Organization scope (Phase 1 multi-org) ──
  // Every business query must filter by organizationId to enforce tenant isolation.
  const orgScope = getOrgScope(auth.user)
  if (!orgScope.ok) {
    return NextResponse.json({ error: orgScope.error.message }, { status: orgScope.error.status })
  }
  // ── Build authorization context for Site scope ──
  // Uses buildAuthorizationContext() instead of reading auth.user.allowedSites
  // directly, so that UserSiteGrant is consulted first (dual-read).
  const ctx = await buildAuthorizationContext(
    auth.user,
    auth.row.id,
    auth.row.allowedSites,
  )
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim() ?? ''
    const status = searchParams.get('status')?.trim() ?? ''
    const siteParam = searchParams.get('site')?.trim() ?? ''
    // ── Device Set filter: parentDeviceId=ID returns only children in the set.
    // ── Device Set filter: parentDeviceId=none returns only top-level devices.
    // Used by the device detail sheet's "อุปกรณ์ในชุด" section.
    const parentDeviceIdParam = searchParams.get('parentDeviceId')?.trim() ?? ''
    const excludeReplaced = searchParams.get('excludeReplaced') === '1'
    // ── Bounded pagination: clamp page + limit to safe bounds ──
    // Previously: inline Math.min/Math.max with hardcoded 500/100.
    // Now: uses pure helper that also handles NaN, Infinity, fractional.
    // Hard upper bound: MAX_LIMIT=500, MAX_PAGE=10000 (prevents deep scans).
    const isMobile = searchParams.get('mobile') === '1'
    const { page, limit, skip } = clampPageAndLimit({
      page: Number(searchParams.get('page') ?? '1') || 1,
      limit: Number(searchParams.get('limit') ?? '100') || 100,
    })

    const where: Record<string, unknown> = { ...demoFilter(auth.user), ...orgScope.where }
    if (search) {
      // ── Search only NON-SENSITIVE fields ──────────────────────────
      // Audit (ITAM-02) REQUEST CHANGES: search clause included sensitive
      // fields (serialNumber, ip, mac, remoteId, contractNo, vendor).
      // Remove them from list-view search to enforce list-view minimization
      // contract. Sensitive fields are searchable in detail view only.
      //
      // SUFFIX-AWARE (SEARCH-FIX): for short numeric queries (e.g. "123"),
      // match the SUFFIX of assetCode (the field operators read off device
      // stickers). For non-numeric/longer queries, use contains (legacy).
      const { isNumericShortQuery } = await import('@/lib/suffix-search')
      const idFragment = isNumericShortQuery(search)
        ? { assetCode: { endsWith: search } }
        : { assetCode: { contains: search } }
      where.OR = [
        idFragment,
        { name: { contains: search } },
        { brand: { contains: search } },
        { model: { contains: search } },
        { building: { contains: search } },
        { floor: { contains: search } },
        { department: { contains: search } },
        { location: { contains: search } },
        { site: { contains: search } },
      ]
    }
    if (status) {
      // Map filter value → DB status strings.
      // The DB stores human-readable values like "Active", "In Repair",
      // "Pending Repair", "In Stock" etc. The filter dropdown sends short
      // codes like "active", "repair", "spare", "disposed".
      const STATUS_MAP: Record<string, string[]> = {
        active: ['Active'],
        spare: ['In Stock', 'Inactive', 'Spare'],
        repair: ['In Repair', 'Pending Repair'],
        disposed: ['Disposed', 'Retired'],
      }
      const dbStatuses = STATUS_MAP[status.toLowerCase()]
      if (dbStatuses && dbStatuses.length > 0) {
        where.status = { in: dbStatuses }
      } else {
        // Fallback: case-insensitive contains
        where.status = { contains: status, mode: 'insensitive' }
      }
    }

    // ── Device Set filter ──
    // parentDeviceId=ID  → only direct children of that device
    // parentDeviceId=none → only top-level devices (no parent)
    // omit                → no filter (children + top-level both returned)
    if (parentDeviceIdParam) {
      if (parentDeviceIdParam.toLowerCase() === 'none') {
        where.parentDeviceId = null
      } else {
        where.parentDeviceId = parentDeviceIdParam
      }
    }
    // excludeReplaced=1 → hide devices that have been replaced (replacedById != null)
    if (excludeReplaced) {
      where.replacedById = null
    }

    // ── Site scope enforcement via authorization context ──
    // superadmin → all sites (no filter, or explicit site filter if provided)
    // non-superadmin with specific Sites → filter to those Sites
    // non-superadmin with no Sites → return empty
    // explicit site=CODE → validate against user's scope (404 if out-of-scope)
    //
    // NOTE: Device.site stores the Thai site NAME (e.g. "ชื่อสาขา (e.g. สำนักงานใหญ่)"),
    // not the site CODE (e.g. "UDH"). So when the user picks a site code from
    // the dropdown, we must resolve it to the Thai name before filtering.
    if (ctx.isSuperAdmin || ctx.globalRole === "admin" || auth.isDemo) {
      if (siteParam) {
        // Resolve site code → Thai name via SiteAttribute
        const sa = await db.siteAttribute.findUnique({
          where: { SiteCode: normalizeSiteCode(siteParam) ?? '' },
          select: { SiteName: true },
        })
        where.site = sa?.SiteName ?? siteParam
      }
    } else if (ctx.siteScope.kind === 'sites' && ctx.siteScope.siteCodes.length > 0) {
      const allowed = ctx.siteScope.siteCodes
      if (siteParam) {
        const normalized = normalizeSiteCode(siteParam)
        if (!normalized || !allowed.includes(normalized)) {
          // Out-of-scope Site requested — return empty (don't reveal existence)
          return NextResponse.json(emptyListResponse(page, limit))
        }
        // Resolve site code → Thai name
        const sa = await db.siteAttribute.findUnique({
          where: { SiteCode: normalized },
          select: { SiteName: true },
        })
        where.site = sa?.SiteName ?? normalized
      } else {
        // No explicit site param → filter by all allowed site codes → resolve to Thai names
        const siteNames = await Promise.all(
          allowed.map(async (code) => {
            const sa = await db.siteAttribute.findUnique({
              where: { SiteCode: code },
              select: { SiteName: true },
            })
            return sa?.SiteName ?? code
          }),
        )
        where.site = { in: siteNames.filter(Boolean) }
      }
    } else {
      // kind === 'none' or legacy 'all' fallback — non-superadmin with no
      // explicit grants. Return empty (fail-closed).
      return NextResponse.json(emptyListResponse(page, limit))
    }

    // ── Explicit field selection (bounded list) ──
    // Previously: default include (returns all fields including IP/MAC/contract).
    // Now: explicit select — sensitive fields (serialNumber, ip, mac, contractNo,
    // vendor, purchasePrice, etc.) are excluded from list view. Detail view
    // (/api/devices/[id]) still returns full record with proper permission.
    // Mobile (?mobile=1) returns an even smaller subset for small screens.
    const selectFields = getDeviceListFields(isMobile)

    // Run count + page in parallel for efficiency
    const [devices, total] = await Promise.all([
      db.device.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          ...selectFields,
          // Latest meter reading is a derived field — keep as relation subquery
          meterReadings: {
            orderBy: { readingDate: 'desc' },
            take: 1,
            select: {
              readingMonth: true,
              readingDate: true,
              meterBw: true,
              meterColor: true,
              pagesBw: true,
              pagesColor: true,
            },
          },
        },
      }),
      db.device.count({ where }),
    ])
    // Annotate each device with `lastReadingMonth` + `lastMeterBw` + `lastMeterColor`
    // derived from its latest MeterReading record. The Device table has
    // lastMeterBw/lastMeterColor columns but they may not be kept in sync —
    // so we derive from the latest MeterReading for accuracy.
    const devicesWithMeter = devices.map((d) => {
      const latest = d.meterReadings?.[0]
      const { meterReadings, ...rest } = d
      return {
        ...rest,
        lastReadingMonth:
          latest?.readingMonth ?? latest?.readingDate?.slice(0, 7) ?? null,
        lastMeterBw: latest?.meterBw ?? rest.lastMeterBw ?? 0,
        lastMeterColor: latest?.meterColor ?? rest.lastMeterColor ?? 0,
      }
    })
    return NextResponse.json({
      devices: devicesWithMeter,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      // Additive: pagination metadata for client convenience.
      // Does NOT change existing fields — backward compatible.
      meta: buildPaginationMeta(total, page, limit),
      // Additive: indicate if mobile subset was returned.
      mobile: isMobile,
    })
  } catch (err) {
    console.error('GET /api/devices', err)
    return NextResponse.json(
      { error: 'Failed to fetch devices' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  // ── Phase 4.3: Module availability gate ──
  const moduleCheck = await moduleUnavailableResponse('devices')
  if (moduleCheck) return moduleCheck

  // ── Authentication: require DEVICE_EDIT permission ──
  // Previously this route treated auth as optional (fail-open), allowing
  // unauthenticated device creation. This is a Blocker security fix.
  // Demo mode is still supported: if the authenticated user is a demo user,
  // the created device is tagged with isDemo=true.
  const auth = await requireAuth(req, 'DEVICE_EDIT')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const demo = auth
  // ── Build authorization context for Site scope validation ──
  const ctx = await buildAuthorizationContext(
    auth.user,
    auth.row.id,
    auth.row.allowedSites,
  )

  try {
    const body = await req.json()
    // Apply defaults for optional fields that have sensible defaults
    if (!body.status) body.status = 'active'
    if (!body.site) body.site = 'HQ'

    // ── Flexible Numbering Engine: สร้าง assetCode อัตโนมัติถ้าผู้ใช้ไม่กรอก ──
    // ใช้รูปแบบจาก ตั้งค่า → รูปแบบเลขทะเบียน (เช่น 001-201-2569-00001)
    // ปีมาจากวันที่ซื้อ (purchaseDate) ของเครื่องนี้
    if (body.assetCode === undefined || body.assetCode === null || String(body.assetCode).trim() === '') {
      const generated = await allocateNextNumber('device', {
        type: body.type ?? null,
        site: body.site ?? null,
        purchaseDate: body.purchaseDate ?? null,
        departmentCode: body.departmentCode ?? null,
      })
      if (generated) body.assetCode = generated
    }

    const required = ['assetCode', 'name', 'brand', 'model', 'type']
    for (const k of required) {
      if (body[k] === undefined || body[k] === null || body[k] === '') {
        return NextResponse.json(
          { error: `Missing required field: ${k}` },
          { status: 400 },
        )
      }
    }

    // ── Validate that the caller can create devices at body.site ──
    // Non-superadmin must have an active Site grant for the target Site.
    // This prevents creating devices at Sites the user cannot access.
    const targetSite = normalizeSiteCode(body.site)
    if (!targetSite) {
      return NextResponse.json(
        { error: 'site ไม่ถูกต้อง' },
        { status: 400 },
      )
    }
    // ── B1 FIX (audit round 2): use canAtSite(targetSite, 'DEVICE_EDIT')
    // instead of canAccessSite(targetSite).
    // canAccessSite only checks that the user has ANY grant at the Site
    // (even a viewer grant). That allows privilege escalation via the
    // effective-permissions union: a user with admin role at UDH (which
    // grants DEVICE_EDIT) and viewer role at NKP would pass canAccessSite
    // ('NKP') even though viewer does NOT include DEVICE_EDIT. canAtSite
    // checks the role AT the target Site only, closing the leak.
    if (!ctx.isSuperAdmin && !ctx.canAtSite(targetSite, 'DEVICE_EDIT')) {
      return NextResponse.json(
        { error: `คุณไม่มีสิทธิ์สร้างอุปกรณ์ที่ Site '${targetSite}'` },
        { status: 403 },
      )
    }

    // ── Flexible Numbering Engine: ซิงก์เลขกับ sequence counter ──
    // ฟอร์มฝั่ง client เติม assetCode จาก "พรีวิว" (ไม่กินเลข) ดังนั้นตอน
    // บันทึกจริงเราต้องจัดสรรเลขแบบ atomic ใหม่ เพื่อไม่ให้เลขซ้ำเมื่อมี
    // การบันทึกพร้อมกัน หรือเมื่อผู้ใช้หลายคนเปิดฟอร์มพร้อมกัน
    // เงื่อนไข: แทนที่เฉพาะเมื่อรหัสที่ส่งมา === พรีวิวปัจจุบัน (แปลว่ามาจาก
    // auto-fill ไม่ใช่ผู้ใช้พิมพ์เอง) — ถ้าผู้ใช้พิมพ์เองจะใช้รหัสนั้นตรงๆ
    const numberingCtx = {
      type: body.type ?? null,
      site: targetSite,
      purchaseDate: body.purchaseDate ?? null,
      departmentCode: body.departmentCode ?? null,
    }
    const previewNow = await previewNextNumber('device', numberingCtx).catch(() => null)
    if (previewNow && String(body.assetCode).trim() === previewNow) {
      const allocated = await allocateNextNumber('device', numberingCtx).catch(() => null)
      if (allocated) body.assetCode = allocated
    }

    // สร้างพร้อม retry-on-P2002: ถ้ารหัสชนกับข้อมูลเดิม (เช่น import มาก่อน)
    // และมี scheme ที่ active — ขอเลขใหม่แบบ atomic แล้วลองใหม่
    let created: Awaited<ReturnType<typeof db.device.create>> | null = null
    let lastDupCode: string | null = null
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      try {
        created = await db.device.create({
          data: {
            assetCode: String(body.assetCode).trim(),
            name: String(body.name).trim(),
            brand: String(body.brand).trim(),
            model: String(body.model).trim(),
            type: String(body.type).trim(),
            serialNumber: optStr(body.serialNumber),
            status: String(body.status).trim(),
            site: targetSite,
            assetSiteCode: optStr(body.assetSiteCode),
            department: optStr(body.department),
            departmentCode: optStr(body.departmentCode),
            parentRef: optStr(body.parentRef),
            displayLabel: optStr(body.displayLabel),
            location: optStr(body.location),
            building: optStr(body.building),
            floor: optStr(body.floor),
            room: optStr(body.room),
            ip: optStr(body.ip),
            mac: optStr(body.mac),
            remoteId: optStr(body.remoteId),
            purchaseDate: optStr(body.purchaseDate),
            warrantyMonths: clampWarrantyMonths(body.warrantyMonths),
            purchasePrice: optFloat(body.purchasePrice),
            salvageValue: optFloat(body.salvageValue) ?? 0,
            usefulLife: optInt(body.usefulLife),
            warrantyEnd: optStr(body.warrantyEnd),
            vendor: optStr(body.vendor),
            contractNo: optStr(body.contractNo),
            uninstallDate: optStr(body.uninstallDate),
            meterRequired: optBool(body.meterRequired),
            meterMode: optStr(body.meterMode),
            costCenter: optStr(body.costCenter),
            deviceGroup: optStr(body.deviceGroup),
            remark: optStr(body.remark),
            // ── Device Set fields (Task ID 9, Phase 2) ──
            parentDeviceId: optStr(body.parentDeviceId),
            setLabel: optStr(body.setLabel),
            setPosition: optInt(body.setPosition),
            ...demoTag(demo?.user ?? null),
          },
        })
      } catch (err) {
        const code = (err as { code?: string }).code
        if (code === 'P2002') {
          lastDupCode = String(body.assetCode).trim()
          // ขอเลขใหม่จาก engine (เฉพาะเมื่อมี scheme ที่ active)
          const fresh = await allocateNextNumber('device', numberingCtx).catch(() => null)
          if (fresh && fresh !== body.assetCode) {
            body.assetCode = fresh
            continue
          }
          return NextResponse.json(
            { error: `รหัส "${lastDupCode}" ถูกใช้แล้ว — กรุณาใช้รหัสอื่น` },
            { status: 409 },
          )
        }
        throw err
      }
    }
    if (!created) {
      return NextResponse.json(
        { error: `รหัส "${lastDupCode}" ถูกใช้แล้ว — กรุณาใช้รหัสอื่น` },
        { status: 409 },
      )
    }
    await logAudit(
      'CREATE',
      'Device',
      created.id,
      `เพิ่มอุปกรณ์ ${created.assetCode} (${created.name})`,
      {
        assetCode: created.assetCode,
        name: created.name,
        brand: created.brand,
        type: created.type,
        site: created.site,
      },
      auth.user.email, // FIX-026: actor
    )

    // ── GAP-C01: Create INITIAL MeterReading for meterable devices ──
    // Legacy: DeviceService.gs lines 175-185 — when a printer is added with
    // initialMeter data, an INITIAL reading is saved so the first monthly
    // reading calculates pages = meter - initial (not meter - 0).
    if (created.meterRequired && body.initialMeter) {
      const im = body.initialMeter
      const hasBw = typeof im.meterBw === 'number' && isFinite(im.meterBw)
      const hasColor = typeof im.meterColor === 'number' && isFinite(im.meterColor)
      if (hasBw || hasColor) {
        const now = new Date()
        const readingMonth = im.readingMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        try {
          const reading = await db.meterReading.create({
            data: {
              deviceId: created.id,
              assetCode: created.assetCode,
              readingDate: im.readingDate || now.toISOString().slice(0, 10),
              readingMonth,
              meterBw: im.meterBw ?? 0,
              meterColor: im.meterColor ?? 0,
              pagesBw: 0, // INITIAL → pages = 0 (baseline)
              pagesColor: 0,
              prevMeterBw: 0,
              prevMeterColor: 0,
              readingType: 'INITIAL',
              readBy: auth.user.email || 'system',
              remark: im.remark || 'มิเตอร์ตั้งต้นตอนเพิ่มอุปกรณ์',
              ...demoTag(demo?.user ?? null),
            },
          })
          // Update device's lastMeter fields to match the INITIAL reading
          await db.device.update({
            where: { id: created.id },
            data: {
              lastMeterBw: im.meterBw ?? 0,
              lastMeterColor: im.meterColor ?? 0,
            },
          })
          console.log(`[devices] INITIAL reading created for ${created.assetCode}: bw=${im.meterBw ?? 0}, color=${im.meterColor ?? 0}`)
        } catch (e) {
          console.error('[devices] INITIAL meter reading failed:', e)
          // Don't fail device creation — just log the error
        }
      }
    }

    return NextResponse.json({ device: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/devices', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to create device') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
